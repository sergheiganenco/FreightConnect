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

/**
 * COI-vendor provider seam. A paid vendor (Highway / RMIS / MyCarrierPortal)
 * returns real-time coverage with policy numbers, underwriters, and EXPIRY dates
 * — which then feed insuranceMonitor's expiry logic. Not callable without creds;
 * fails safe by returning null so the FMCSA baseline is used instead.
 */
async function getVendorInsurance(/* carrierData */) {
  const key = process.env.INSURANCE_VENDOR_API_KEY;
  if (!key) return null; // not configured → fall back to FMCSA
  // Intentionally not implemented until a vendor account exists. When wiring one:
  //   const res = await axios.get(`${process.env.INSURANCE_VENDOR_URL}/carriers/${dot}`,
  //     { headers: { Authorization: `Bearer ${key}` } });
  //   return mapVendorResponseToInsuranceSubdoc(res.data); // include real expiry dates
  return null;
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
  requiredBipdMinimum,
  MIN_BIPD_GENERAL,
  MIN_BIPD_HAZMAT,
  MIN_BIPD_HAZMAT_BULK,
};
