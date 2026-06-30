/**
 * Checks a carrier/driver meets a load's equipment subtype + endorsement requirements.
 * Prevents mismatched or illegal load acceptance (e.g. hazmat without endorsement).
 */
function checkLoadEligibility({ load, carrier, driver }) {
  const reasons = [];
  const required = Array.isArray(load.requiredEndorsements) ? load.requiredEndorsements : [];

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
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

module.exports = { checkLoadEligibility };
