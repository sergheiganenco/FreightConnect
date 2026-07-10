const axios = require('axios');

const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services/carriers';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache: { key -> { data, cachedAt } }
const cache = new Map();

function fromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function toCache(key, data) {
  cache.set(key, { data, cachedAt: Date.now() });
}

// Retry with exponential backoff
async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await axios.get(url, { timeout: 10000 });
      return res.data;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }
  }
}

// Interpret a 'Y'/'N'-style flag. Returns true/false, or null when absent so the
// caller can tell "not on file" (N) apart from "unknown" (field missing).
function flagYN(v) {
  if (v === true || v === false) return v;
  const s = (v ?? '').toString().trim().toLowerCase();
  if (s === '') return null;
  if (s === 'y' || s === 'yes' || s === '1' || s === 'true') return true;
  if (s === 'n' || s === 'no' || s === '0' || s === 'false') return false;
  return null;
}

// Parse an FMCSA insurance amount to whole dollars. QCMobile reports BIPD amounts
// in THOUSANDS (e.g. "750" ⇒ $750,000); some records already give full dollars.
// A 'Y'/'N' flag is not an amount → null.
function parseInsuranceAmount(v) {
  if (v == null) return null;
  const s = v.toString().trim();
  if (/^[yn]$/i.test(s)) return null; // it's a flag, not a number
  const n = Number(s.replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n <= 0) return null;
  return n < 100000 ? Math.round(n * 1000) : Math.round(n);
}

// Extract the insurance-on-file view from the raw QCMobile carrier record.
// FMCSA reports whether BIPD (auto liability) and cargo insurance are ON FILE and
// the amounts/requirements — NOT policy expiry (that lives in the L&I system / a
// COI vendor). All fields default to null ("unknown") when the record omits them,
// so a missing feed never looks like "no coverage".
function extractInsuranceOnFile(c) {
  const bipdOnFileFlag = flagYN(c.bipdInsuranceOnFile);
  const bipdAmount = parseInsuranceAmount(c.bipdInsuranceOnFile);
  return {
    // BIPD == auto/public liability
    bipdOnFile: bipdAmount != null ? true : bipdOnFileFlag,
    bipdOnFileAmount: bipdAmount, // whole dollars, or null when only a Y/N flag is given
    bipdRequired: flagYN(c.bipdInsuranceRequired),
    bipdRequiredAmount: parseInsuranceAmount(c.bipdRequiredAmount),
    cargoOnFile: flagYN(c.cargoInsuranceOnFile),
    cargoRequired: flagYN(c.cargoInsuranceRequired),
    bondOnFile: flagYN(c.bondInsuranceOnFile),
    // true only when the record actually carried any insurance field
    hasData: [c.bipdInsuranceOnFile, c.bipdInsuranceRequired, c.cargoInsuranceOnFile]
      .some((v) => v != null && v !== ''),
  };
}

// Normalize FMCSA carrier response into a flat object.
// The real QCMobile API nests the carrier under content.carrier and returns
// allowedToOperate as 'Y'/'N', statusCode as 'A'/'I', safetyRating as a letter
// code ('S'/'C'/'U' or null), and an oosDate when the carrier is out of service.
function normalizeCarrierData(raw) {
  const c = raw?.content?.carrier || raw?.content || raw?.carrier || raw || {};
  const allowed = (c.allowedToOperate ?? c.operating_status ?? '').toString().trim();
  return {
    legalName: c.legalName || c.legal_name || null,
    dbaName: c.dbaName || c.dba_name || null,
    entityType: c.entityType || c.entity_type || null,
    // 'Y'/'N' from the live API, or a status string from legacy/mock data.
    allowedToOperate: allowed || null,
    operatingStatus: allowed || null,
    // 'A' (active) / 'I' (inactive) operating-authority status, when present.
    authorityStatusCode: c.statusCode || null,
    // Letter code ('S'/'C'/'U') or word; null when unrated.
    safetyRating: c.safetyRating || c.safety_rating || null,
    // Out of service if an OOS date is on file.
    outOfService: !!(c.oosDate || c.outOfService),
    oosDate: c.oosDate || null,
    dotNumber: c.dotNumber || c.dot_number || null,
    mcNumber: c.mcNumber || c.mc_mx_ff_number || c.docketNumber || null,
    phone: c.telephone || c.phone || null,
    // Real insurance-on-file signal (BIPD/cargo). null fields ⇒ unknown.
    insuranceOnFile: extractInsuranceOnFile(c),
  };
}

// True if the carrier's safety rating is Unsatisfactory ('U' letter code or the word).
function isUnsatisfactory(carrierData) {
  const r = (carrierData?.safetyRating || '').toString().trim().toLowerCase();
  return r === 'u' || r === 'unsatisfactory';
}

/**
 * Lookup carrier by MC number
 */
async function lookupByMC(mcNumber) {
  const key = `mc_${mcNumber}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const apiKey = process.env.FMCSA_API_KEY;
  if (!apiKey) throw new Error('FMCSA_API_KEY not configured');

  const url = `${FMCSA_BASE}/docket-number/${mcNumber}?webKey=${apiKey}`;
  const raw = await fetchWithRetry(url);
  const data = normalizeCarrierData(raw);
  toCache(key, data);
  return data;
}

/**
 * Lookup carrier by DOT number
 */
async function lookupByDOT(dotNumber) {
  const key = `dot_${dotNumber}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const apiKey = process.env.FMCSA_API_KEY;
  if (!apiKey) throw new Error('FMCSA_API_KEY not configured');

  const url = `${FMCSA_BASE}/${dotNumber}?webKey=${apiKey}`;
  const raw = await fetchWithRetry(url);
  const data = normalizeCarrierData(raw);
  toCache(key, data);
  return data;
}

/**
 * Verify that a carrier is legally authorized to operate: allowed to operate,
 * not under an out-of-service order, and not rated Unsatisfactory.
 */
function verifyAuthority(carrierData) {
  if (!carrierData) return false;
  // Hard fails independent of the operating flag.
  if (carrierData.outOfService) return false;
  if (isUnsatisfactory(carrierData)) return false;
  // Inactive operating authority (statusCode 'I') is not authorized.
  const code = (carrierData.authorityStatusCode || '').toString().trim().toUpperCase();
  if (code === 'I') return false;

  const allowed = (carrierData.allowedToOperate || carrierData.operatingStatus || '')
    .toString().trim().toLowerCase();
  // Live API returns 'Y'/'N'; legacy/mock data uses descriptive strings.
  return (
    allowed === 'y' ||
    allowed === 'yes' ||
    allowed === 'authorized for property' ||
    allowed === 'active' ||
    allowed === 'authorized'
  );
}

/**
 * Run full FMCSA verification for a user and update their record
 * Returns: { success, data, error }
 */
async function runFullVerification(user, mcNumber, dotNumber) {
  try {
    let fmcsaData = null;

    if (mcNumber) {
      fmcsaData = await lookupByMC(mcNumber);
    } else if (dotNumber) {
      fmcsaData = await lookupByDOT(dotNumber);
    }

    if (!fmcsaData) {
      return { success: false, error: 'No FMCSA record found for provided MC/DOT number' };
    }

    const isAuthorized = verifyAuthority(fmcsaData);

    user.verification = user.verification || {};
    user.verification.mcNumber = mcNumber || user.verification.mcNumber;
    user.verification.dotNumber = dotNumber || user.verification.dotNumber;
    user.verification.fmcsaData = {
      ...fmcsaData,
      lastChecked: new Date(),
    };
    user.verification.status = isAuthorized ? 'verified' : 'rejected';
    if (isAuthorized) user.verification.verifiedAt = new Date();

    // ── Real insurance verification (FMCSA insurance-on-file) ──────────────────
    // Populate verification.insurance from the federal record so the trust score,
    // canAcceptLoads gate, and insuranceMonitor operate on real data. Kept
    // separate from the authority verdict (a required-fail is surfaced, not a
    // hard block — authority is the legal gate). Best-effort; never fails the run.
    try {
      const insuranceService = require('./insuranceService');
      const hazmat = Array.isArray(user.carrierEndorsements)
        && user.carrierEndorsements.includes('hazmat');
      const result = await insuranceService.verifyInsurance(fmcsaData, { hazmat });
      user.verification.insurance = {
        cargoLiability: result.cargoLiability || {},
        autoLiability: result.autoLiability || {},
        status: result.status,
        source: result.source,
        meetsFederalMinimum: result.meetsFederalMinimum,
        requiredMinimum: result.requiredMinimum,
        lastChecked: result.lastChecked,
      };
    } catch (insErr) {
      console.error('[FMCSA] insurance evaluation failed (non-fatal):', insErr.message);
    }

    await user.save();
    return {
      success: true,
      data: fmcsaData,
      authorized: isAuthorized,
      insurance: user.verification.insurance,
    };
  } catch (err) {
    console.error('FMCSA verification error:', err.message);
    // Network failure → set to pending for retry
    if (user.verification) {
      user.verification.status = 'pending';
      user.verification.mcNumber = mcNumber || user.verification.mcNumber;
      user.verification.dotNumber = dotNumber || user.verification.dotNumber;
      await user.save();
    }
    return { success: false, error: 'FMCSA service unavailable — set to pending for retry' };
  }
}

module.exports = {
  lookupByMC, lookupByDOT, verifyAuthority, isUnsatisfactory, runFullVerification,
  normalizeCarrierData, extractInsuranceOnFile,
};
