/**
 * Checks a carrier/driver meets a load's equipment subtype + endorsement requirements.
 * Prevents mismatched or illegal load acceptance (e.g. hazmat without endorsement).
 *
 * When a driver is provided, stored credential expiry dates are enforced too:
 * an expired CDL / medical card / hazmat card must not satisfy eligibility.
 * Missing dates don't block (they may simply not be on file yet) — the
 * compliance-alerts endpoint nags about those separately.
 */
function isExpired(date) {
  if (!date) return false;
  const d = new Date(date);
  return !isNaN(d.getTime()) && d.getTime() <= Date.now();
}

const stateOf = (place) => { const m = /,\s*([A-Za-z]{2})\s*$/.exec(String(place || '')); return m ? m[1].toUpperCase() : null; };

function checkLoadEligibility({ load, carrier, driver }) {
  const reasons = [];

  // A load that crosses a state line needs for-hire operating authority, not just a DOT number.
  // Only a definite "none" from FMCSA blocks; an unknown record does not.
  const from = stateOf(load.origin), to = stateOf(load.destination);
  if (from && to && from !== to && carrier?.verification?.fmcsaData?.forHireAuthority === 'none') {
    reasons.push('This load crosses a state line, and FMCSA shows no active for-hire operating authority for your company');
  }
  const required = Array.isArray(load.requiredEndorsements) ? load.requiredEndorsements : [];

  // ── Driver credential expiry (any load — driving on these is illegal) ──
  if (driver) {
    if (isExpired(driver.licenseExpiry)) {
      reasons.push("Driver's license (CDL) has expired");
    }
    if (isExpired(driver.medicalCardExpiry)) {
      reasons.push("Driver's medical card has expired");
    }
  }

  if (required.length) {
    // Endorsements may be held at carrier level OR by the assigned driver
    const carrierEnd = (carrier && carrier.carrierEndorsements) || [];
    const driverEnd  = (driver && driver.endorsements) || [];
    const held = new Set([...carrierEnd, ...driverEnd]);
    for (const e of required) {
      if (!held.has(e)) reasons.push(`Missing required endorsement: ${e}`);
    }
  }

  // Hazmat load requires hazmat endorsement specifically
  if (load.hazardousMaterial) {
    const carrierEnd = (carrier && carrier.carrierEndorsements) || [];
    const driverEnd  = (driver && driver.endorsements) || [];
    if (![...carrierEnd, ...driverEnd].includes('hazmat')) {
      reasons.push('Hazmat load requires hazmat endorsement');
    } else if (driver && !driverEnd.includes('hazmat')) {
      // The endorsement is on a person's licence. A company-level flag cannot cover a named driver without it.
      reasons.push('This driver does not hold a hazmat endorsement');
    } else if (driver && isExpired(driver.hazmatExpiry)) {
      reasons.push("Driver's hazmat endorsement has expired");
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

module.exports = { checkLoadEligibility };
