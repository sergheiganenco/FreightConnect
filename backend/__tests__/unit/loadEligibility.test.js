/**
 * Unit: checkLoadEligibility — endorsement presence AND credential expiry.
 *
 * An endorsement that has expired (or a driver with an expired CDL / medical
 * card) must not satisfy eligibility: hauling on expired credentials is
 * illegal, and the audit found expiry dates were stored but never enforced.
 */

const { checkLoadEligibility } = require('../../services/loadEligibility');

const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

describe('checkLoadEligibility — credential expiry enforcement', () => {
  test('driver with EXPIRED hazmat endorsement fails a hazmat load', () => {
    const result = checkLoadEligibility({
      load: { hazardousMaterial: true },
      carrier: { carrierEndorsements: [] },
      driver: { endorsements: ['hazmat'], hazmatExpiry: past },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/hazmat.*expired|expired.*hazmat/i);
  });

  test('driver with EXPIRED license fails any load', () => {
    const result = checkLoadEligibility({
      load: {},
      carrier: {},
      driver: { endorsements: [], licenseExpiry: past },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/license.*expired|expired.*license/i);
  });

  test('driver with EXPIRED medical card fails any load', () => {
    const result = checkLoadEligibility({
      load: {},
      carrier: {},
      driver: { endorsements: [], medicalCardExpiry: past },
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/medical.*expired|expired.*medical/i);
  });

  test('driver with current credentials passes a hazmat load', () => {
    const result = checkLoadEligibility({
      load: { hazardousMaterial: true },
      carrier: {},
      driver: {
        endorsements: ['hazmat'],
        hazmatExpiry: future,
        licenseExpiry: future,
        medicalCardExpiry: future,
      },
    });
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test('driver without expiry dates on file is not blocked (dates optional)', () => {
    const result = checkLoadEligibility({
      load: { hazardousMaterial: true },
      carrier: {},
      driver: { endorsements: ['hazmat'] },
    });
    expect(result.eligible).toBe(true);
  });

  test('carrier-level check without a driver is unchanged (endorsement presence)', () => {
    const ok = checkLoadEligibility({
      load: { hazardousMaterial: true },
      carrier: { carrierEndorsements: ['hazmat'] },
    });
    expect(ok.eligible).toBe(true);

    const missing = checkLoadEligibility({
      load: { hazardousMaterial: true },
      carrier: { carrierEndorsements: [] },
    });
    expect(missing.eligible).toBe(false);
  });
});
