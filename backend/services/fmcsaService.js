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

// Normalize FMCSA carrier response into a flat object
function normalizeCarrierData(raw) {
  const c = raw?.content || raw?.carrier || raw || {};
  return {
    legalName: c.legalName || c.legal_name || null,
    dbaName: c.dbaName || c.dba_name || null,
    entityType: c.entityType || c.entity_type || null,
    operatingStatus: c.allowedToOperate || c.operating_status || null,
    safetyRating: c.safetyRating || c.safety_rating || null,
    dotNumber: c.dotNumber || c.dot_number || null,
    mcNumber: c.mcNumber || c.mc_mx_ff_number || null,
    phone: c.telephone || null,
  };
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
 * Verify that a carrier's operating authority is active
 */
function verifyAuthority(carrierData) {
  if (!carrierData) return false;
  const status = (carrierData.operatingStatus || '').toLowerCase();
  return status === 'authorized for property' || status === 'active' || status === 'authorized';
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

    await user.save();
    return { success: true, data: fmcsaData, authorized: isAuthorized };
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

module.exports = { lookupByMC, lookupByDOT, verifyAuthority, runFullVerification };
