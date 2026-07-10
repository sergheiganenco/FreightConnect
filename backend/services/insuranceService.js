/**
 * insuranceService — real carrier insurance verification.
 *
 * Default source is the FEDERAL FMCSA record (free, authoritative): whether a
 * carrier has BIPD (auto/public liability) and cargo insurance ON FILE and the
 * amounts, evaluated against the FMCSA financial-responsibility minimums
 * (49 CFR §387). This is genuine verification — it confirms federally-filed,
 * active coverage meeting the legal minimum.
 *
 * What FMCSA does NOT give: policy expiry dates, policy numbers, or underwriter
 * names (those live in the L&I system / on the paper COI). For that depth,
 * connect a COI vendor (Highway, RMIS, MyCarrierPortal) by setting
 * INSURANCE_PROVIDER=vendor and the vendor creds — see getVendorInsurance().
 *
 * The result maps onto the User.verification.insurance sub-document so the
 * existing trust score, canAcceptLoads gate, and insuranceMonitor all just work.
 */

// FMCSA financial-responsibility minimums (49 CFR §387.9), in whole dollars.
const MIN_BIPD_GENERAL = 750000;    // general freight
const MIN_BIPD_HAZMAT = 1000000;    // most hazmat (some classes require $5M)
const MIN_BIPD_HAZMAT_BULK = 5000000; // bulk hazardous / certain materials

/** Required BIPD minimum for a carrier given what they haul. */
function requiredBipdMinimum({ hazmat = false, bulkHazmat = false } = {}) {
  if (bulkHazmat) return MIN_BIPD_HAZMAT_BULK;
  if (hazmat) return MIN_BIPD_HAZMAT;
  return MIN_BIPD_GENERAL;
}

/**
 * Evaluate FMCSA insurance-on-file into a verification.insurance-shaped result.
 * @param {object} carrierData - normalized FMCSA data (has .insuranceOnFile)
 * @param {object} opts - { hazmat, bulkHazmat }
 * @returns {{ status, source, autoLiability, cargoLiability, meetsFederalMinimum,
 *            requiredMinimum, reasons, lastChecked }}
 */
function evaluateFmcsa(carrierData, opts = {}) {
  const onFile = carrierData?.insuranceOnFile || {};
  const requiredMinimum = requiredBipdMinimum(opts);
  const reasons = [];
  const now = new Date();

  // No insurance fields in the federal record → honestly "unknown", not "lapsed".
  if (!onFile.hasData) {
    reasons.push('FMCSA record contains no insurance-on-file data — connect a COI vendor for full verification.');
    return {
      status: 'unknown',
      source: 'fmcsa',
      autoLiability: {},
      cargoLiability: {},
      meetsFederalMinimum: false,
      requiredMinimum,
      reasons,
      lastChecked: now,
    };
  }

  // BIPD (auto/public liability) — the legally required coverage.
  const bipdOnFile = onFile.bipdOnFile === true || (onFile.bipdOnFileAmount || 0) > 0;
  const bipdAmount = onFile.bipdOnFileAmount || null;
  // When we have an amount, hold it to the required minimum; when we only have a
  // Y/N flag, "on file" is the strongest signal FMCSA gives us.
  const bipdMeetsMin = bipdAmount != null ? bipdAmount >= requiredMinimum : bipdOnFile;

  if (!bipdOnFile) {
    reasons.push('No auto-liability (BIPD) insurance on file with FMCSA.');
  } else if (bipdAmount != null && bipdAmount < requiredMinimum) {
    reasons.push(`BIPD on file ($${bipdAmount.toLocaleString()}) is below the required $${requiredMinimum.toLocaleString()}.`);
  }

  const cargoOnFile = onFile.cargoOnFile === true;
  // Cargo is only a hard fail when FMCSA marks it required for this carrier.
  if (onFile.cargoRequired === true && !cargoOnFile) {
    reasons.push('Cargo insurance is required for this carrier but not on file.');
  }

  const meetsFederalMinimum =
    bipdOnFile && bipdMeetsMin && (onFile.cargoRequired !== true || cargoOnFile);

  return {
    // 'valid' when federally on file and meeting the minimum; 'lapsed' when a
    // required policy is missing/insufficient. (FMCSA gives no expiry, so we
    // don't emit 'expiring' from this source — the COI vendor path does.)
    status: meetsFederalMinimum ? 'valid' : 'lapsed',
    source: 'fmcsa',
    autoLiability: bipdOnFile ? { amount: bipdAmount, underwriter: null, policyNumber: null, expiry: null } : {},
    cargoLiability: cargoOnFile ? { amount: null, underwriter: null, policyNumber: null, expiry: null } : {},
    meetsFederalMinimum,
    requiredMinimum,
    reasons,
    lastChecked: now,
  };
}

const axios = require('axios');

const EXPIRY_WARNING_DAYS = 30;

// First defined value among candidate keys (handles vendor schema differences).
function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseAmount(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Map a COI-vendor response to one coverage policy { amount, expiry, underwriter,
 * policyNumber }. Vendors (Highway, RMIS, MyCarrierPortal) differ in field names,
 * so this checks common aliases; tune to your vendor's actual schema.
 */
function mapPolicy(node) {
  if (!node) return {};
  return {
    amount: parseAmount(pick(node, 'limit', 'amount', 'coverageLimit', 'limitAmount')),
    expiry: parseDate(pick(node, 'expirationDate', 'expiry', 'expiresAt', 'expiration', 'endDate', 'cancellationDate')),
    underwriter: pick(node, 'insurer', 'underwriter', 'insurerName', 'company', 'carrierName') || null,
    policyNumber: pick(node, 'policyNumber', 'policyNo', 'policy', 'number') || null,
  };
}

/**
 * Derive verification.insurance status from real policy expiry + amounts:
 *  - lapsed:   required BIPD missing/expired/below minimum
 *  - expiring: valid but earliest expiry within EXPIRY_WARNING_DAYS
 *  - valid:    on file, in force, meets minimum
 */
function statusFromPolicies({ autoLiability, cargoLiability }, requiredMinimum, cargoRequired) {
  const now = new Date();
  const bipdOk = autoLiability.amount != null && autoLiability.amount >= requiredMinimum;
  const bipdInForce = autoLiability.expiry ? autoLiability.expiry > now : bipdOk;
  const cargoInForce = cargoLiability.expiry ? cargoLiability.expiry > now : (cargoLiability.amount != null);

  if (!bipdOk || !bipdInForce || (cargoRequired && !cargoInForce)) return 'lapsed';

  const expiries = [autoLiability.expiry, cargoLiability.expiry].filter(Boolean).map((d) => d.getTime());
  if (expiries.length) {
    const soonest = new Date(Math.min(...expiries));
    const warnAt = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 86400000);
    if (soonest <= warnAt) return 'expiring';
  }
  return 'valid';
}

/**
 * COI-vendor provider. A paid vendor (Highway / RMIS / MyCarrierPortal) returns
 * real-time coverage with policy numbers, underwriters, and EXPIRY dates — which
 * then feed insuranceMonitor's expiry logic (auto-suspend on lapse). Fails safe:
 * returns null on missing config or any error so the FMCSA baseline is used.
 *
 * Config:
 *   INSURANCE_PROVIDER=vendor
 *   INSURANCE_VENDOR_API_KEY=...           (bearer token)
 *   INSURANCE_VENDOR_URL=https://api.vendor.com  (base; {dot} is appended)
 *   INSURANCE_VENDOR_PATH=/carriers/{dot}/insurance  (optional override; {dot}/{mc} substituted)
 */
async function getVendorInsurance(carrierData, opts = {}) {
  const key = process.env.INSURANCE_VENDOR_API_KEY;
  const base = process.env.INSURANCE_VENDOR_URL;
  if (!key || !base) return null; // not configured → fall back to FMCSA

  const dot = carrierData?.dotNumber;
  const mc = carrierData?.mcNumber;
  if (!dot && !mc) return null;

  const pathTpl = process.env.INSURANCE_VENDOR_PATH || '/carriers/{dot}/insurance';
  const path = pathTpl.replace('{dot}', encodeURIComponent(dot || '')).replace('{mc}', encodeURIComponent(mc || ''));
  const url = base.replace(/\/$/, '') + path;

  const res = await axios.get(url, {
    timeout: 10000,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });

  // Locate the insurance node across common response shapes.
  const body = res.data || {};
  const insNode = body.insurance || body.coverages || body.data?.insurance || body;
  const autoNode = pick(insNode, 'autoLiability', 'bipd', 'auto', 'publicLiability');
  const cargoNode = pick(insNode, 'cargo', 'cargoLiability', 'motorTruckCargo');
  if (!autoNode && !cargoNode) return null; // nothing usable → fall back

  const requiredMinimum = requiredBipdMinimum(opts);
  const autoLiability = mapPolicy(autoNode);
  const cargoLiability = mapPolicy(cargoNode);
  const cargoRequired = !!pick(insNode, 'cargoRequired');
  const status = statusFromPolicies({ autoLiability, cargoLiability }, requiredMinimum, cargoRequired);

  return {
    status,
    source: 'vendor',
    autoLiability,
    cargoLiability,
    meetsFederalMinimum: status !== 'lapsed',
    requiredMinimum,
    reasons: status === 'lapsed'
      ? ['Vendor COI shows expired or insufficient coverage.']
      : [],
    lastChecked: new Date(),
  };
}

/**
 * Verify a carrier's insurance. Uses the configured provider; always safe to call.
 * @param {object} carrierData - normalized FMCSA data
 * @param {object} opts - { hazmat, bulkHazmat }
 * @returns {Promise<object>} verification.insurance-shaped result
 */
async function verifyInsurance(carrierData, opts = {}) {
  if ((process.env.INSURANCE_PROVIDER || 'fmcsa') === 'vendor') {
    try {
      const vendor = await getVendorInsurance(carrierData, opts);
      if (vendor) return vendor;
    } catch (err) {
      console.error('[insuranceService] vendor lookup failed, falling back to FMCSA:', err.message);
    }
  }
  return evaluateFmcsa(carrierData, opts);
}

module.exports = {
  verifyInsurance,
  evaluateFmcsa,
  getVendorInsurance,
  mapPolicy,
  statusFromPolicies,
  requiredBipdMinimum,
  MIN_BIPD_GENERAL,
  MIN_BIPD_HAZMAT,
  MIN_BIPD_HAZMAT_BULK,
};
