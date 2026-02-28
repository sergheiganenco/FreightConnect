/**
 * ediParser.js — X12 EDI Parser & Generator
 *
 * Handles:
 *   parseEDI204(rawText) → structured load tender fields
 *   generateEDI214(load, statusCode) → X12 214 status update string
 *   generateEDI210(load, invoice)    → X12 210 freight invoice string
 */

// ── Segment parsing helpers ────────────────────────────────────────────────────

function splitSegments(raw) {
  // Detect segment terminator (usually ~ but may vary)
  // ISA is exactly 106 chars; segment terminator is char at position 105
  const trimmed = raw.replace(/\r?\n/g, '').trim();
  const segTerm = trimmed[105] || '~';
  const elemSep = trimmed[3] || '*';
  return {
    segments: trimmed.split(segTerm).map(s => s.trim()).filter(Boolean),
    elemSep,
  };
}

function parseSegment(seg, elemSep) {
  return seg.split(elemSep);
}

function padRight(str, len, char = ' ') {
  return String(str || '').padEnd(len, char);
}

function ediDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10).replace(/-/g, '').slice(2); // YYMMDD
}

function ediTime() {
  const d = new Date();
  return d.toTimeString().slice(0, 5).replace(':', ''); // HHMM
}

function controlNum(n = 1) {
  return String(n).padStart(9, '0');
}

// ── EDI 204 Parser ─────────────────────────────────────────────────────────────
/**
 * Parses an X12 204 (Motor Carrier Load Tender) into a structured object
 * suitable for creating a FreightConnect Load.
 *
 * Returns:
 * {
 *   shipmentId, bolNumber, paymentMethod,
 *   shipDate, deliveryDate,
 *   shipper: { name, address, city, state, zip },
 *   origin:  { name, address, city, state, zip },
 *   destination: { name, address, city, state, zip },
 *   stops: [{ sequence, type, name, address, city, state, zip, date }],
 *   equipment, weightLbs, commodity, totalChargesCents,
 *   references: [{ qualifier, value }],
 *   senderISAId, receiverISAId, isaControlNum, interchangeDate,
 * }
 */
function parseEDI204(rawText) {
  const { segments, elemSep } = splitSegments(rawText);
  const result = {
    shipmentId: null, bolNumber: null, paymentMethod: null,
    shipDate: null, deliveryDate: null,
    shipper: {}, origin: {}, destination: {},
    stops: [],
    equipment: null, weightLbs: null, commodity: null, totalChargesCents: null,
    references: [],
    senderISAId: null, receiverISAId: null, isaControlNum: null, interchangeDate: null,
  };

  // Collect N1→N3→N4 blocks and S5 stop blocks
  let currentParty = null;  // 'shipper' | 'origin' | 'destination' | 'stop'
  let currentStop  = null;

  for (const seg of segments) {
    const parts = parseSegment(seg, elemSep);
    const id    = parts[0];

    if (id === 'ISA') {
      result.senderISAId    = parts[6]?.trim();
      result.receiverISAId  = parts[8]?.trim();
      result.interchangeDate = parts[9];
      result.isaControlNum  = parts[13];
      continue;
    }

    if (id === 'B2') {
      // B2*scac*carrierName*shipmentId*xxx*bolNum*paymentMethod
      result.shipmentId   = parts[3] || null;
      result.bolNumber    = parts[5] || null;
      result.paymentMethod = parts[6] || null;
      continue;
    }

    if (id === 'L11') {
      // L11*referenceValue*qualifier*description
      result.references.push({ qualifier: parts[2], value: parts[1] });
      if (parts[2] === 'BM') result.bolNumber = result.bolNumber || parts[1];
      continue;
    }

    if (id === 'G62') {
      // G62*qualifier*date   — 10=ship date, 11=delivery date, 37=actual arrival
      const q = parts[1];
      const rawDate = parts[2]; // CCYYMMDD or YYMMDD
      let dateStr = null;
      if (rawDate && rawDate.length === 8) {
        dateStr = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      } else if (rawDate && rawDate.length === 6) {
        dateStr = `20${rawDate.slice(0, 2)}-${rawDate.slice(2, 4)}-${rawDate.slice(4, 6)}`;
      }
      if (q === '10') result.shipDate    = dateStr;
      if (q === '11') result.deliveryDate = dateStr;
      continue;
    }

    if (id === 'N7') {
      // N7*equip*equipNum*weight*xxx*xxx*xxx*xxx*equipType
      const et = parts[8];
      if (et === 'TL')  result.equipment = 'Dry Van';
      else if (et === 'RF') result.equipment = 'Reefer';
      else if (et === 'FT') result.equipment = 'Flatbed';
      else if (et === 'BT') result.equipment = 'Box Truck';
      else if (et)      result.equipment = et;
      continue;
    }

    if (id === 'N1') {
      // N1*entityQual*name*identCode*identValue
      const qual = parts[1];
      const name = parts[2];
      if (qual === 'SH') { result.shipper.name = name; currentParty = 'shipper'; currentStop = null; }
      else if (qual === 'SF' || qual === 'SN') { result.origin.name = name; currentParty = 'origin'; currentStop = null; }
      else if (qual === 'ST' || qual === 'CN') { result.destination.name = name; currentParty = 'destination'; currentStop = null; }
      else if (currentStop) { currentStop.name = name; currentParty = 'stop'; }
      continue;
    }

    if (id === 'N3') {
      // N3*addressLine1*addressLine2
      const addr = [parts[1], parts[2]].filter(Boolean).join(', ');
      if (currentParty === 'shipper')      result.shipper.address = addr;
      else if (currentParty === 'origin')  result.origin.address = addr;
      else if (currentParty === 'destination') result.destination.address = addr;
      else if (currentParty === 'stop' && currentStop) currentStop.address = addr;
      continue;
    }

    if (id === 'N4') {
      // N4*city*state*zip*country
      const geo = { city: parts[1], state: parts[2], zip: parts[3] };
      if (currentParty === 'shipper')      Object.assign(result.shipper, geo);
      else if (currentParty === 'origin')  Object.assign(result.origin, geo);
      else if (currentParty === 'destination') Object.assign(result.destination, geo);
      else if (currentParty === 'stop' && currentStop) Object.assign(currentStop, geo);
      continue;
    }

    if (id === 'S5') {
      // S5*stopSequence*stopReasonCode*weight*weightUnit*volume*volumeUnit
      // stopReasonCode: LD=loading, UL=unloading, CL=consolidation
      currentStop = {
        sequence: parseInt(parts[1], 10) || result.stops.length + 1,
        type: parts[2] === 'UL' || parts[2] === 'D' ? 'delivery' : 'pickup',
        name: null, address: null, city: null, state: null, zip: null, date: null,
      };
      currentParty = 'stop';
      result.stops.push(currentStop);
      continue;
    }

    if (id === 'OID') {
      // OID*xxx*orderNum*weight*weightUnit*weightQual*pieces*commodity*freightAmt
      if (parts[3]) result.weightLbs = parseFloat(parts[3]) || null;
      if (parts[7]) result.commodity = parts[7];
      if (parts[8]) result.totalChargesCents = Math.round(parseFloat(parts[8]) * 100) || null;
      continue;
    }

    if (id === 'AT5') {
      // AT5 — commodity / special handling
      if (parts[1]) result.commodity = result.commodity || parts[1];
      continue;
    }
  }

  // Fallback: if origin/destination are empty, derive from stops
  if (!result.origin.city && result.stops.length > 0) {
    const firstPickup = result.stops.find(s => s.type === 'pickup') || result.stops[0];
    Object.assign(result.origin, firstPickup);
  }
  if (!result.destination.city && result.stops.length > 1) {
    const lastDel = [...result.stops].reverse().find(s => s.type === 'delivery') || result.stops[result.stops.length - 1];
    Object.assign(result.destination, lastDel);
  }

  return result;
}

// ── Load tender → Load field mapping ──────────────────────────────────────────
/**
 * Converts parsed EDI 204 data into Load model fields.
 */
function edi204ToLoadFields(parsed) {
  const originStr      = [parsed.origin.address, parsed.origin.city, parsed.origin.state, parsed.origin.zip].filter(Boolean).join(', ');
  const destinationStr = [parsed.destination.address, parsed.destination.city, parsed.destination.state, parsed.destination.zip].filter(Boolean).join(', ');

  const bolRef = parsed.references.find(r => r.qualifier === 'BM');
  const poRef  = parsed.references.find(r => r.qualifier === 'PO' || r.qualifier === '92');

  return {
    title:          `EDI Load ${parsed.shipmentId || parsed.bolNumber || Date.now()}`,
    origin:         originStr || parsed.origin.city || 'TBD',
    destination:    destinationStr || parsed.destination.city || 'TBD',
    rate:           parsed.totalChargesCents ? parsed.totalChargesCents / 100 : 0,
    equipmentType:  parsed.equipment || 'Dry Van',
    loadWeight:     parsed.weightLbs,
    commodityType:  parsed.commodity,
    specialInstructions: bolRef ? `BOL: ${bolRef.value}` : undefined,
    pickupTimeWindow: parsed.shipDate
      ? { start: new Date(parsed.shipDate), end: new Date(parsed.shipDate) }
      : undefined,
    deliveryTimeWindow: parsed.deliveryDate
      ? { start: new Date(parsed.deliveryDate), end: new Date(parsed.deliveryDate) }
      : undefined,
  };
}

// ── EDI 214 Generator ─────────────────────────────────────────────────────────
/**
 * Generates an X12 214 (Shipment Status) document for a load.
 *
 * statusCode: AT7 codes —
 *   'X3' = Delivery appointment scheduled
 *   'X1' = Loaded on truck (in-transit)
 *   'D1' = Delivery complete
 *   'A9' = Refused by consignee
 *   'AF' = Out for delivery
 */
function generateEDI214(load, statusCode = 'X1') {
  const ctrl = controlNum(1);
  const date = ediDate();
  const time = ediTime();
  const senderId   = padRight('FREIGHTCONNECT', 15);
  const receiverId = padRight('SHIPPER', 15);

  const STATUS_LABELS = {
    X3: 'Delivery Appointment Scheduled',
    X1: 'In Transit',
    D1: 'Delivered',
    A9: 'Refused by Consignee',
    AF: 'Out for Delivery',
  };

  const lines = [
    `ISA*00*          *00*          *ZZ*${senderId}*ZZ*${receiverId}*${date}*${time}*U*00401*${ctrl}*0*P*>`,
    `GS*QM*FREIGHTCONNECT*SHIPPER*${date}*${time}*1*X*004010`,
    `ST*214*0001`,
    `B10*${load._id}*${load.title || 'LOAD'}*FRTC`,
    `L11*${load._id}*SI`,
    `L11*${load.documents?.bol || 'NOBOL'}*BM`,
    `LX*1`,
    `AT7*${statusCode}*NS*${STATUS_LABELS[statusCode] || statusCode}**${date}*${time}`,
    `MS1*${load.destination || ''}`,
    `SE*9*0001`,
    `GE*1*1`,
    `IEA*1*${ctrl}`,
  ];

  return lines.join('~\n') + '~';
}

// ── EDI 210 Generator ─────────────────────────────────────────────────────────
/**
 * Generates an X12 210 (Motor Carrier Freight Invoice) for a delivered load.
 */
function generateEDI210(load, carrier, shipper) {
  const ctrl = controlNum(1);
  const date = ediDate();
  const time = ediTime();
  const senderId   = padRight('FREIGHTCONNECT', 15);
  const receiverId = padRight('SHIPPER', 15);
  const rateStr    = (load.rate || 0).toFixed(2);
  const carrierName = padRight((carrier?.companyName || carrier?.name || 'CARRIER').toUpperCase(), 60);

  const lines = [
    `ISA*00*          *00*          *ZZ*${senderId}*ZZ*${receiverId}*${date}*${time}*U*00401*${ctrl}*0*P*>`,
    `GS*IM*FREIGHTCONNECT*SHIPPER*${date}*${time}*1*X*004010`,
    `ST*210*0001`,
    `B3*${carrier?.mcNumber || 'MCXXXXX'}*${load._id}*${load.documents?.bol || 'NOBOL'}***${date}*${rateStr}*CC*${date}`,
    `C3*USD`,
    `N1*BT*${shipper?.companyName || shipper?.name || 'SHIPPER'}`,
    `N1*SE*${carrierName}`,
    `N1*SF*${load.origin || ''}`,
    `N1*ST*${load.destination || ''}`,
    `LX*1`,
    `L1*1***${rateStr}*FR*1**400`,
    `L3*${load.loadWeight || 0}*G*${rateStr}**${rateStr}`,
    `SE*13*0001`,
    `GE*1*1`,
    `IEA*1*${ctrl}`,
  ];

  return lines.join('~\n') + '~';
}

module.exports = { parseEDI204, edi204ToLoadFields, generateEDI214, generateEDI210 };
