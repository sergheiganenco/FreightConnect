/**
 * The paperwork a load carries: what the posting route collects, what the bill of lading and
 * rate confirmation say (tested on their content, not the PDF bytes), and the two pickup signatures.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const Load = require('../../models/Load');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { documentContent, generateBOL, generateRateConfirmation } = require('../../utils/pdfGenerator');

jest.mock('axios');
jest.mock('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
app.use('/api/documents', require('../../routes/documentRoutes'));

const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const base = {
  title: 'Paint, 12 pallets', origin: 'Memphis, TN', destination: 'Nashville, TN', rate: 1000, equipmentType: 'Dry Van',
  originLat: 35.1495, originLng: -90.049, destinationLat: 36.1627, destinationLng: -86.7816,
};
const shipperUser = () => createTestUser({ role: 'shipper', companyName: 'Acme Paint', shipperVerification: { status: 'verified', paymentMethodVerified: true } });
const idOf = (r) => r.body._id || (r.body.load && r.body.load._id) || (r.body.data && r.body.data._id);

describe('posting collects what the paperwork needs', () => {
  test('a hazardous load is refused without its shipping name and emergency phone, and stored with them', async () => {
    const shipper = await shipperUser();
    const haz = { ...base, hazardousMaterial: true, hazmatClass: '3', dangerousGoodsUN: 'UN1263', hazmatPackingGroup: 'II' };
    const no = await request(app).post('/api/loads').set(bearer(shipper)).send(haz);
    expect(no.status).toBe(400);
    expect(no.body.error).toMatch(/emergency phone/);

    const yes = await request(app).post('/api/loads').set(bearer(shipper)).send({
      ...haz, hazmatShippingName: 'Paint', hazmatEmergencyPhone: '1-800-424-9300',
      pieceCount: 12, packageType: 'pallets', pickupNumber: 'PU-77', pickupHours: 'Mon-Fri 07:00-15:00',
      deliveryHours: '24 hours', deliveryContactEmail: 'dock@receiver.test', equipmentSubtype: 'Air ride',
      requiredEndorsements: ['hazmat'], termsAccepted: true,
    });
    expect(yes.status).toBe(201);
    const load = await Load.findById(idOf(yes));
    expect(load).toMatchObject({
      hazmatShippingName: 'Paint', hazmatEmergencyPhone: '1-800-424-9300', pieceCount: 12, packageType: 'pallets',
      pickupNumber: 'PU-77', pickupHours: 'Mon-Fri 07:00-15:00', deliveryHours: '24 hours',
      deliveryContactEmail: 'dock@receiver.test', equipmentSubtype: 'Air ride',
    });
    expect([...load.requiredEndorsements]).toEqual(['hazmat']);
    expect(load.termsAcceptedAt).toBeInstanceOf(Date);
  });

  test('bad values are refused: unknown endorsement, fractional pieces, a receiver email that is not one', async () => {
    const shipper = await shipperUser();
    for (const bad of [{ requiredEndorsements: ['forklift'] }, { pieceCount: 2.5 }, { pieceCount: 0 }, { deliveryContactEmail: 'not-an-email' }]) {
      const r = await request(app).post('/api/loads').set(bearer(shipper)).send({ ...base, ...bad });
      expect([r.status, Object.keys(bad)[0]]).toEqual([400, Object.keys(bad)[0]]);
    }
  });

  test('editing a load to non-hazardous clears the hazmat shipping details; the terms record cannot be edited', async () => {
    const shipper = await shipperUser();
    const load = await createTestLoad(shipper._id, {
      hazardousMaterial: true, hazmatClass: '3', dangerousGoodsUN: 'UN1263', hazmatShippingName: 'Paint', hazmatEmergencyPhone: '555',
    });
    const r = await request(app).put(`/api/loads/${load._id}`).set(bearer(shipper)).send({ hazardousMaterial: false, termsAcceptedAt: new Date() });
    expect(r.status).toBe(200);
    const after = await Load.findById(load._id);
    expect(after.hazmatShippingName).toBeFalsy();
    expect(after.hazmatEmergencyPhone).toBeFalsy();
    expect(after.termsAcceptedAt).toBeFalsy();
  });
});

describe('what the documents say', () => {
  const load = {
    _id: '64b000000000000000000001', title: 'Paint, 12 pallets', origin: 'Memphis, TN', destination: 'Nashville, TN',
    rate: 1000, equipmentType: 'Dry Van', loadWeight: 18000, pieceCount: 12, packageType: 'pallets',
    hazardousMaterial: true, hazmatClass: '3', dangerousGoodsUN: 'UN1263', hazmatShippingName: 'Paint', hazmatPackingGroup: 'II',
    hazmatEmergencyPhone: '1-800-424-9300', poNumber: 'PO-1', pickupNumber: 'PU-77', sealNumber: 'S-4411',
    pickupFacilityName: 'Acme Plant 2', pickupAddress: '1 Plant Rd, Memphis, TN 38101', pickupHours: 'Mon-Fri 07:00-15:00',
    deliveryFacilityName: 'Big Box DC', deliveryAddress: '9 Dock St, Nashville, TN 37201',
    assignedDriverName: 'Ann Driver', assignedTruckId: 'TRK-1',
    createdAt: new Date('2026-11-01T10:00:00Z'), acceptanceFingerprint: { at: new Date('2026-11-02T12:00:00Z') },
  };
  const flat = (sections) => Object.fromEntries(sections.flatMap((s) => s.rows));

  test('the bill of lading names both places, the count, the seal, the driver and the full hazmat line, and never the rate', () => {
    const rows = flat(documentContent.bolSections(load, { companyName: 'Haul Co' }, { companyName: 'Acme Paint' }));
    expect(rows['Shipping description']).toBe('UN1263, Paint, Class 3, PG II');
    expect(rows['24-hour emergency phone']).toBe('1-800-424-9300');
    expect(rows.Pieces).toBe('12 pallets');
    expect(rows['Seal number']).toBe('S-4411');
    expect(rows.Driver).toBe('Ann Driver');
    expect(rows['Truck / unit']).toBe('TRK-1');
    expect(rows['Pickup number']).toBe('PU-77');
    const text = JSON.stringify(documentContent.bolSections(load, {}, {}));
    expect(text).toContain('1 Plant Rd, Memphis, TN 38101');
    expect(text).toContain('9 Dock St, Nashville, TN 37201');
    expect(text).not.toMatch(/1,000\.00|\$1000/);
  });

  test('the rate confirmation states the real terms: fee and payout only when payments run through the platform', () => {
    const on = documentContent.rateConTerms({ ...load, paymentTerms: 'Quick pay' }, { feePct: 0.02, paymentsOn: true });
    expect(on).toMatchObject({ rateCents: 100000, feeCents: 2000, carrierReceivesCents: 98000 });
    const onRows = Object.fromEntries(on.rows);
    expect(onRows['Payment terms']).toBe('Quick pay');
    expect(onRows['Carrier receives']).toBe('$980.00');
    expect(onRows.Detention).toBe('$75.00 per hour after 2 free hours at a pickup or delivery stop');
    expect(onRows['Truck ordered, not used']).toMatch(/^\$250\.00/);

    const off = Object.fromEntries(documentContent.rateConTerms(load, { feePct: 0.02, paymentsOn: false }).rows);
    expect(off['Carrier receives']).toBeUndefined();
    expect(off['How payment is made']).toMatch(/^Directly between shipper and carrier/);
    expect(off['Payment terms']).toBe('Not stated by the shipper');
    expect(JSON.stringify(off)).not.toMatch(/Net 30/);

    const contract = Object.fromEntries(documentContent.rateConTerms(load, { detention: { freeMinutes: 60, rateCentsPerHour: 9000 }, tonuCents: 40000 }).rows);
    expect(contract.Detention).toBe('$90.00 per hour after 1 free hour at a pickup or delivery stop');
    expect(contract['Truck ordered, not used']).toMatch(/^\$400\.00/);
  });

  test('the acceptance record says who agreed and when, without printing a network address', () => {
    const rows = Object.fromEntries(documentContent.acceptanceRows({ ...load, acceptanceFingerprint: { at: load.acceptanceFingerprint.at, ip: '203.0.113.9' } }, { companyName: 'Haul Co' }, { companyName: 'Acme Paint' }));
    expect(rows.Shipper).toMatch(/Acme Paint.*posted this load Nov 1, 2026/);
    expect(rows.Carrier).toMatch(/booked electronically Nov 2, 2026/);
    expect(JSON.stringify(rows)).not.toContain('203.0.113.9');
  });

  test('both PDFs are produced for a load with every field and for one with almost none', async () => {
    for (const l of [load, { _id: '64b000000000000000000002', title: 'Bare', origin: 'A, TN', destination: 'B, TN', rate: 10, equipmentType: 'Flatbed' }]) {
      expect(await generateBOL({ ...l, pickupSignature: { dataUrl: PNG, signerName: 'Ann' }, shipperSignature: { dataUrl: PNG, signerName: 'Dock Dan' } }, {}, {})).toMatch(/-bol\.pdf$/);
      expect(await generateRateConfirmation(l, {}, {})).toMatch(/-ratecon\.pdf$/);
    }
  });
});

describe('two signatures at pickup', () => {
  test('the driver signs, then takes the shipper\'s signature on the same device; each lands in its own slot', async () => {
    const shipper = await shipperUser();
    const carrier = await createTestUser({ role: 'carrier' });
    const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: carrier._id });
    const sign = (u, body) => request(app).post(`/api/documents/${load._id}/pickup-signature`).set(bearer(u)).send({ dataUrl: PNG, ...body });

    expect((await sign(carrier, { signerName: 'Ann Driver' })).status).toBe(200);
    expect((await sign(carrier, { party: 'shipper' })).status).toBe(400); // the dock signer must be named
    const dock = await sign(carrier, { party: 'shipper', signerName: 'Dock Dan' });
    expect(dock.status).toBe(200);
    expect(dock.body.party).toBe('shipper');

    const after = await Load.findById(load._id);
    expect(after.pickupSignature.signerName).toBe('Ann Driver');
    expect(after.pickupSignature.signedByRole).toBe('carrier');
    expect(after.shipperSignature.signerName).toBe('Dock Dan');
    expect(after.shipperSignature.capturedByRole).toBe('carrier');
    expect(String(after.shipperSignature.capturedBy)).toBe(String(carrier._id));
    const at = documentContent.pickupSignatures(after);
    expect(at.driver.signerName).toBe('Ann Driver');
    expect(at.shipper.signerName).toBe('Dock Dan');

    // A shipper login signing goes to the shipper slot and leaves the driver's alone.
    expect((await sign(shipper, { signerName: 'Sam Shipper' })).status).toBe(200);
    const last = await Load.findById(load._id);
    expect(last.shipperSignature.signerName).toBe('Sam Shipper');
    expect(last.shipperSignature.capturedByRole).toBe('shipper');
    expect(last.pickupSignature.signerName).toBe('Ann Driver');
  });
});
