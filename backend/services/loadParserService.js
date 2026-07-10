/**
 * loadParserService — turn a free-text load offer (a forwarded broker/shipper
 * email, a pasted load list, an OCR'd rate sheet) into structured load objects
 * ready for review or creation.
 *
 * Two engines, one interface:
 *   • Heuristic parser (default, always available) — deterministic regex
 *     extraction of lane, rate, equipment, weight, etc. Works with NO API key
 *     and is the tested path.
 *   • Claude parser (opt-in) — when ANTHROPIC_API_KEY is set, calls the
 *     Anthropic Messages API over HTTPS (via axios, matching this backend's
 *     existing external-API pattern in fmcsaService). On ANY error or missing
 *     key it falls back to the heuristic parser, so the seam never breaks a
 *     request. Set LOAD_PARSER_MODEL to pick a cheaper model (e.g. a Haiku-class
 *     model) for high-volume extraction; defaults to claude-opus-4-8.
 *
 * Every parsed load is normalized to the same shape the Load model / enterprise
 * bulk-create endpoint expects, then re-validated on the way in — the LLM is
 * never trusted to produce a directly-persistable object.
 */

const axios = require('axios');

const MAX_INPUT_CHARS = 20000; // bound the work; longer input is truncated + warned

// Canonical equipment types (must match the keys used elsewhere, e.g. enterprise BASE_CPM).
// Ordered most-specific-first so "step deck" wins over "deck", "dry van" over "van".
const EQUIPMENT_PATTERNS = [
  [/\bpower[\s-]?only\b/i, 'Power Only'],
  [/\bstep[\s-]?deck\b/i, 'Step Deck'],
  [/\bbox[\s-]?truck\b|\bstraight[\s-]?truck\b/i, 'Box Truck'],
  [/\bconestoga\b/i, 'Conestoga'],
  [/\brgn\b|removable\s+gooseneck/i, 'RGN'],
  [/\blow[\s-]?boy\b/i, 'Lowboy'],
  [/\breefer\b|refrigerated|temp(?:erature)?[\s-]?control/i, 'Reefer'],
  [/\bflat[\s-]?bed\b/i, 'Flatbed'],
  [/\btanker\b|\btank\b/i, 'Tanker'],
  [/\bdry[\s-]?van\b|\bvan\b/i, 'Dry Van'],
];

/** Map a free-text equipment mention to a canonical type, or null if none found. */
function normalizeEquipment(text) {
  if (!text) return null;
  for (const [re, canonical] of EQUIPMENT_PATTERNS) {
    if (re.test(text)) return canonical;
  }
  return null;
}

/** Parse a money mention to whole dollars (integer), or null. Rejects implausible figures. */
function parseRateDollars(block) {
  if (!block) return null;
  // Prefer an amount that follows a rate keyword.
  const keyed = block.match(
    /(?:rate|pay|all[\s-]?in|total|offer|price|linehaul)[^\d$]{0,12}\$?\s*([\d]{2,3}(?:,\d{3})+|\d{3,6})(?:\.\d{2})?/i
  );
  const candidates = [];
  if (keyed) candidates.push(keyed[1]);
  // Otherwise gather all $-prefixed amounts.
  const dollarRe = /\$\s*([\d]{1,3}(?:,\d{3})+|\d{2,6})(?:\.\d{2})?/g;
  let m;
  while ((m = dollarRe.exec(block)) !== null) candidates.push(m[1]);

  const nums = candidates
    .map((s) => parseInt(String(s).replace(/,/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n >= 50 && n <= 100000); // plausible line-haul range

  if (nums.length === 0) return null;
  // If a keyed amount was found and is plausible, trust it; else take the largest.
  if (keyed) {
    const keyedNum = parseInt(String(keyed[1]).replace(/,/g, ''), 10);
    if (keyedNum >= 50 && keyedNum <= 100000) return keyedNum;
  }
  return Math.max(...nums);
}

/** Parse a weight mention to pounds (integer), or null. */
function parseWeightLbs(block) {
  if (!block) return null;
  const m = block.match(/([\d]{1,3}(?:,\d{3})+|\d{3,6})\s*(?:lbs?\b|pounds?\b|#)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}

// A "City, ST" token. City is 1–3 words (bounded so it doesn't swallow the
// leading prose of a sentence); state is a US 2-letter code (kept broad).
const CITY = "[A-Za-z][A-Za-z.'\\-]*(?:\\s+[A-Za-z][A-Za-z.'\\-]*){0,2}";
const CITY_STATE = `${CITY},\\s*[A-Za-z]{2}\\b`;
const CONNECTOR = "(?:->|=>|→|—|–|-|\\bto\\b|\\bthru\\b|\\bvia\\b|>)";

// Leading words to strip off a captured city (sentence filler, PU/DEL markers).
const CITY_FILLER = new Set([
  'from', 'to', 'going', 'load', 'loads', 'the', 'a', 'an', 'and', 'of', 'for',
  'pu', 'del', 'pickup', 'pick', 'up', 'delivery', 'deliver', 'at', 'in', 'near',
  'origin', 'destination', 'dest', 'ship', 'is', 'we', 'have', 'this', 'out',
  'will', 'need', 'available', 'hauling', 'run', 'get', 'moving',
]);

/**
 * Extract an origin → destination lane from a text block.
 * Tries a connector-joined pair first (Chicago, IL to Dallas, TX), then falls
 * back to the first two "City, ST" tokens in order.
 * @returns {{origin: string, destination: string} | null}
 */
function extractLane(block) {
  if (!block) return null;
  const paired = new RegExp(`(${CITY_STATE})\\s*${CONNECTOR}\\s*(${CITY_STATE})`, 'i');
  const p = block.match(paired);
  if (p) return { origin: cleanPlace(p[1]), destination: cleanPlace(p[2]) };

  const single = new RegExp(CITY_STATE, 'gi');
  const found = block.match(single);
  if (found && found.length >= 2) {
    return { origin: cleanPlace(found[0]), destination: cleanPlace(found[1]) };
  }
  return null;
}

/**
 * Normalize a "City, ST" string: strip leading filler words, title-case any
 * all-lowercase city words (preserving already-cased names like "McAllen"),
 * and upper-case the state.
 */
function cleanPlace(s) {
  const t = String(s).trim().replace(/\s+/g, ' ');
  const m = t.match(/^(.*?),\s*([A-Za-z]{2})\b/);
  if (!m) return t;
  const state = m[2].toUpperCase();
  const words = m[1].split(' ').filter(Boolean);
  while (words.length > 1 && CITY_FILLER.has(words[0].toLowerCase())) words.shift();
  const cased = words.map((w) =>
    w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w
  );
  return `${cased.join(' ')}, ${state}`;
}

/** Pull a source/reference id (load #, order #, ref) for dedup, or null. */
function extractExternalRef(block) {
  if (!block) return null;
  const m = block.match(/(?:load|order|ref(?:erence)?|shipment)\s*#?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,20})/i)
    || block.match(/#\s*([A-Z0-9][A-Z0-9-]{2,20})/);
  return m ? m[1].toUpperCase() : null;
}

/** Split raw text into per-load records. */
function splitRecords(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim());
  const laneLines = nonEmpty.filter((l) => extractLane(l));

  // Flat-list mode: most non-empty lines are self-contained "O -> D ..." rows.
  if (laneLines.length >= 2 && laneLines.length >= nonEmpty.length * 0.5) {
    return laneLines;
  }

  // Block mode: group by blank lines or enumerators (1. / 2) / Load 1: / - ).
  const blocks = [];
  let current = [];
  const isEnumerator = (l) => /^\s*(?:\d+[.)]|load\s*\d+\s*[:.)-]|[-*•])\s/i.test(l);
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) { blocks.push(current.join('\n')); current = []; }
      continue;
    }
    if (isEnumerator(line) && current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks.length ? blocks : [text];
}

/** Build a human title from a normalized load. */
function makeTitle(load) {
  const lane = load.origin && load.destination ? `${load.origin} → ${load.destination}` : (load.origin || load.destination || 'Load');
  return load.equipmentType ? `${lane} (${load.equipmentType})` : lane;
}

/** Turn one record into a normalized load object with a confidence + warnings. */
function normalizeRecord(block) {
  const lane = extractLane(block);
  if (!lane) return null; // no lane → not a load

  const rate = parseRateDollars(block);
  const equipmentType = normalizeEquipment(block);
  const loadWeight = parseWeightLbs(block);
  const externalRef = extractExternalRef(block);

  const warnings = [];
  if (rate == null) warnings.push('rate not detected');
  if (!equipmentType) warnings.push('equipment type not detected');

  // Confidence: lane is required; rate + equipment are the value-bearing fields.
  const have = [true, rate != null, !!equipmentType].filter(Boolean).length;
  const confidence = have >= 3 ? 'high' : have === 2 ? 'medium' : 'low';

  const load = {
    origin: lane.origin,
    destination: lane.destination,
    rate: rate ?? null,
    equipmentType: equipmentType ?? null,
    loadWeight: loadWeight ?? null,
    externalRef: externalRef ?? null,
    source: 'email',
    confidence,
    warnings,
    raw: block.trim().slice(0, 500),
  };
  load.title = makeTitle(load);
  return load;
}

/** Heuristic (regex) parser — always available, no API key needed. */
function heuristicParse(text) {
  const truncated = text.length > MAX_INPUT_CHARS;
  const body = truncated ? text.slice(0, MAX_INPUT_CHARS) : text;
  const records = splitRecords(body);
  const loads = [];
  for (const rec of records) {
    const load = normalizeRecord(rec);
    if (load) loads.push(load);
  }
  const warnings = [];
  if (truncated) warnings.push(`input truncated to ${MAX_INPUT_CHARS} characters`);
  if (loads.length === 0) warnings.push('no loads detected — need at least an origin and destination (e.g. "Chicago, IL to Dallas, TX")');
  return { source: 'heuristic', loads, warnings };
}

// JSON schema the LLM must return (structured outputs).
const LLM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    loads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          origin: { type: 'string' },
          destination: { type: 'string' },
          rate: { type: ['number', 'null'] },
          equipmentType: { type: ['string', 'null'] },
          loadWeight: { type: ['number', 'null'] },
          commodityType: { type: ['string', 'null'] },
          externalRef: { type: ['string', 'null'] },
        },
        required: ['origin', 'destination'],
      },
    },
  },
  required: ['loads'],
};

/**
 * Claude parser — extract loads via the Anthropic Messages API (raw HTTPS).
 * Throws on any failure so the caller can fall back to the heuristic parser.
 */
async function parseWithClaude(text, { model, timeoutMs = 20000 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const chosenModel = model || process.env.LOAD_PARSER_MODEL || 'claude-opus-4-8';
  const system =
    'You extract freight loads from messy text (forwarded broker emails, pasted load lists, rate sheets). ' +
    'Return ONLY loads you can find. For each load, origin and destination are required (format "City, ST"). ' +
    'rate is the line-haul price in whole US dollars (a number, not a string) or null. ' +
    'equipmentType is one of: Dry Van, Reefer, Flatbed, Step Deck, Lowboy, Tanker, Box Truck, Power Only, Conestoga, RGN — or null. ' +
    'loadWeight is pounds (number) or null. Do not invent data; use null when unsure.';

  const { data } = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: chosenModel,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: text.slice(0, MAX_INPUT_CHARS) }],
      output_config: { format: { type: 'json_schema', schema: LLM_SCHEMA } },
    },
    {
      timeout: timeoutMs,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text block in Claude response');
  const parsed = JSON.parse(textBlock.text);
  const rawLoads = Array.isArray(parsed.loads) ? parsed.loads : [];

  // Re-normalize + re-validate — never trust the model to produce a persistable object.
  const loads = [];
  for (const l of rawLoads) {
    if (!l || !l.origin || !l.destination) continue;
    const equipmentType = normalizeEquipment(l.equipmentType) || null;
    const rate = Number.isFinite(l.rate) && l.rate >= 50 && l.rate <= 100000 ? Math.round(l.rate) : null;
    const loadWeight = Number.isFinite(l.loadWeight) && l.loadWeight > 0 && l.loadWeight <= 100000 ? Math.round(l.loadWeight) : null;
    const warnings = [];
    if (rate == null) warnings.push('rate not detected');
    if (!equipmentType) warnings.push('equipment type not detected');
    const have = [true, rate != null, !!equipmentType].filter(Boolean).length;
    const load = {
      origin: cleanPlace(l.origin),
      destination: cleanPlace(l.destination),
      rate,
      equipmentType,
      loadWeight,
      commodityType: typeof l.commodityType === 'string' ? l.commodityType.slice(0, 120) : null,
      externalRef: l.externalRef ? String(l.externalRef).toUpperCase().slice(0, 40) : null,
      source: 'email',
      confidence: have >= 3 ? 'high' : have === 2 ? 'medium' : 'low',
      warnings,
    };
    load.title = makeTitle(load);
    loads.push(load);
  }
  return { source: 'llm', model: chosenModel, loads, warnings: [] };
}

/**
 * Parse loads from free text. Uses Claude when ANTHROPIC_API_KEY is set;
 * otherwise (or on any LLM error) uses the heuristic parser.
 * @param {string} text
 * @param {{ engine?: 'auto'|'heuristic'|'llm', model?: string }} [opts]
 */
async function parseLoads(text, opts = {}) {
  const input = String(text || '').trim();
  if (!input) return { source: 'heuristic', loads: [], warnings: ['empty input'] };

  const engine = opts.engine || 'auto';
  const canLLM = !!process.env.ANTHROPIC_API_KEY;

  if (engine === 'heuristic' || (engine === 'auto' && !canLLM)) {
    return heuristicParse(input);
  }

  try {
    return await parseWithClaude(input, opts);
  } catch (err) {
    if (engine === 'llm') throw err; // caller explicitly demanded the LLM
    // auto: fall back to heuristic, note why.
    const result = heuristicParse(input);
    result.warnings = [...result.warnings, `AI parser unavailable (${err.message}); used heuristic parser`];
    result.fellBackFromLLM = true;
    return result;
  }
}

module.exports = {
  parseLoads,
  heuristicParse,
  parseWithClaude,
  // exported for unit tests / reuse
  normalizeEquipment,
  parseRateDollars,
  parseWeightLbs,
  extractLane,
  extractExternalRef,
  normalizeRecord,
  splitRecords,
};
