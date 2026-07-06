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

function checkLoadEligibility({ load, carrier, driver }) {
  const reasons = [];
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
    } else if (driver && driverEnd.includes('hazmat') && !carrierEnd.includes('hazmat')
               && isExpired(driver.hazmatExpiry)) {
      // The hazmat qualification comes from the driver — their card must be current
      reasons.push("Driver's hazmat endorsement has expired");
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

module.exports = { checkLoadEligibility };
