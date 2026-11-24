/**
 * Integration: FMCSA authority re-verification monitor.
 *
 * The audit found FMCSA authority was checked exactly once (onboarding) and
 * never again — verifyCarrierFMCSA was dead code. This job re-checks verified
 * carriers on a schedule and suspends any whose authority is revoked or whose
 * safety rating turns unsatisfactory. Only the external FMCSA API is mocked.
 */

require('../setup');

jest.mock('../../services/fmcsaService', () => ({
  lookupByDOT: jest.fn(),
  lookupByMC: jest.fn(),
  // Mirror of the real authority check: authorized-for-property/active/authorized
  verifyAuthority: (data) =>
    ['authorized for property', 'active', 'authorized'].includes(
      String((data && data.operatingStatus) || '').toLowerCase()
    ),
}));

const fmcsaService = require('../../services/fmcsaService');
const User = require('../../models/User');
const { createTestUser, createTestLoad } = require('../helpers');
const { runFmcsaCheck } = require('../../jobs/fmcsaMonitor');
const { runInsuranceCheck } = require('../../jobs/insuranceMonitor');

async function createVerifiedCarrier(overrides = {}) {
  return createTestUser({
    role: 'carrier',
    dotNumber: '1234567',
    verification: {
      status: 'verified',
      dotNumber: '1234567',
      insurance: { status: 'valid' },
      fmcsaData: { legalName: 'Test Trucking LLC', operatingStatus: 'AUTHORIZED FOR Property' },
    },
    fleet: [{ truckId: 'TRUCK-1', status: 'Available' }],
    ...overrides,
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('fmcsaMonitor — authority re-verification', () => {
  test('suspends a verified carrier whose authority is revoked', async () => {
    const carrier = await createVerifiedCarrier();
    fmcsaService.lookupByDOT.mockResolvedValue({
      legalName: 'Test Trucking LLC',
      dotNumber: '1234567',
      operatingStatus: 'OUT-OF-SERVICE',
      safetyRating: 'None',
    });

    await runFmcsaCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('suspended');
    expect(fresh.verification.fmcsaData.operatingStatus).toBe('OUT-OF-SERVICE');
    expect(fresh.verification.fmcsaData.lastChecked).toBeTruthy();
  });

  test('suspends a verified carrier with an unsatisfactory safety rating', async () => {
    const carrier = await createVerifiedCarrier();
    fmcsaService.lookupByDOT.mockResolvedValue({
      legalName: 'Test Trucking LLC',
      dotNumber: '1234567',
      operatingStatus: 'AUTHORIZED FOR Property',
      safetyRating: 'Unsatisfactory',
    });

    await runFmcsaCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('suspended');
  });

  test('keeps an authorized carrier verified and stamps lastChecked', async () => {
    const carrier = await createVerifiedCarrier();
    fmcsaService.lookupByDOT.mockResolvedValue({
      legalName: 'Test Trucking LLC',
      dotNumber: '1234567',
      operatingStatus: 'AUTHORIZED FOR Property',
      safetyRating: 'Satisfactory',
    });

    await runFmcsaCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');
    expect(fresh.verification.fmcsaData.lastChecked).toBeTruthy();
  });

  test('does NOT suspend anyone when the FMCSA API is unavailable (fail-open on availability)', async () => {
    const carrier = await createVerifiedCarrier();
    fmcsaService.lookupByDOT.mockRejectedValue(new Error('FMCSA API timeout'));

    await runFmcsaCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');
  });

  test('skips carriers with no DOT number on file', async () => {
    const carrier = await createVerifiedCarrier({
      dotNumber: undefined,
      verification: { status: 'verified', insurance: { status: 'valid' } },
    });

    await runFmcsaCheck();

    expect(fmcsaService.lookupByDOT).not.toHaveBeenCalled();
    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');
  });
});

describe('fmcsaMonitor — confirmed-DOT identity', () => {
  test('re-checks the FMCSA-confirmed DOT, not the typed one', async () => {
    await createVerifiedCarrier({
      verification: { status: 'verified', dotNumber: '1111111', fmcsaData: { legalName: 'T', dotNumber: '2222222' } },
    });
    fmcsaService.lookupByDOT.mockResolvedValue({ legalName: 'T', dotNumber: '2222222', operatingStatus: 'AUTHORIZED FOR Property' });
    await runFmcsaCheck();
    expect(fmcsaService.lookupByDOT).toHaveBeenCalledWith('2222222');
  });

  test('ignores (no suspend, no overwrite) a result for a different DOT or with no DOT', async () => {
    const carrier = await createVerifiedCarrier();
    for (const bad of [{ dotNumber: '9999999' }, {}]) {
      fmcsaService.lookupByDOT.mockResolvedValue({ legalName: 'Other Co', operatingStatus: 'OUT-OF-SERVICE', ...bad });
      await runFmcsaCheck();
      const fresh = await User.findById(carrier._id);
      expect(fresh.verification.status).toBe('verified');
      expect(fresh.verification.fmcsaData.legalName).toBe('Test Trucking LLC');
    }
  });
});

describe('fmcsaMonitor — unconfirmed identity fails closed', () => {
  const Notification = require('../../models/Notification');
  const { evaluateBookingGate } = require('../../services/bookingGuard');
  const OK = { legalName: 'Test Trucking LLC', dotNumber: '1234567', mcNumber: '765432', operatingStatus: 'AUTHORIZED FOR Property', safetyRating: 'Satisfactory' };
  const unmatched = () => fmcsaService.lookupByDOT.mockResolvedValue({ legalName: 'Other Co', dotNumber: '9999999', operatingStatus: 'AUTHORIZED FOR Property' });
  const outage = () => fmcsaService.lookupByDOT.mockRejectedValue(new Error('FMCSA API timeout'));

  async function canBook(carrier) {
    const shipper = await createTestUser({ role: 'shipper' });
    const load = await createTestLoad(shipper._id);
    return evaluateBookingGate({ load, carrierId: carrier._id });
  }

  test('no confirmed DOT: confirms with the previously verified number when FMCSA matches', async () => {
    const carrier = await createVerifiedCarrier({ dotNumber: '5555555' }); // typed profile DOT must be ignored
    fmcsaService.lookupByDOT.mockResolvedValue(OK);
    await runFmcsaCheck();
    expect(fmcsaService.lookupByDOT).toHaveBeenCalledWith('1234567');
    expect(fmcsaService.lookupByDOT).not.toHaveBeenCalledWith('5555555');
    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');
    expect(fresh.verification.fmcsaData.dotNumber).toBe('1234567');
    expect(fresh.verification.fmcsaData.mcNumber).toBe('765432');
    expect(fresh.verification.fmcsaFailures).toBe(0);
  });

  test('profile dotNumber is never used: no confirmed or verified DOT => counted failure, no lookup', async () => {
    const carrier = await createVerifiedCarrier({
      dotNumber: '5555555',
      verification: { status: 'verified', insurance: { status: 'valid' }, fmcsaData: { legalName: 'T' } },
    });
    await runFmcsaCheck();
    expect(fmcsaService.lookupByDOT).not.toHaveBeenCalled();
    expect((await User.findById(carrier._id)).verification.fmcsaFailures).toBe(1);
  });

  test('an invalid stored DOT counts as a failure (not an outage)', async () => {
    const carrier = await createVerifiedCarrier({
      verification: { status: 'verified', fmcsaData: { legalName: 'T', dotNumber: 'abc' } },
    });
    fmcsaService.lookupByDOT.mockRejectedValue(Object.assign(new Error('Invalid DOT number'), { code: 'INVALID_INPUT' }));
    await runFmcsaCheck();
    expect((await User.findById(carrier._id)).verification.fmcsaFailures).toBe(1);
  });

  test('3 consecutive unmatched results: suspended (fmcsa_unconfirmed), not bookable, notified once', async () => {
    const carrier = await createVerifiedCarrier();
    expect((await canBook(carrier)).allowed).toBe(true);
    unmatched();
    await runFmcsaCheck();
    await runFmcsaCheck();
    expect((await User.findById(carrier._id)).verification.status).toBe('verified');
    await runFmcsaCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('suspended');
    expect(fresh.verification.suspensionReason).toBe('fmcsa_unconfirmed');
    expect(fresh.verification.fmcsaFailures).toBe(3);
    expect(fresh.verification.fmcsaLastFailure.reason).toMatch(/did not match/);
    const gate = await canBook(carrier);
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/suspended/);

    await runFmcsaCheck(); // still suspended carriers are re-checked, but not re-notified
    expect((await User.findById(carrier._id)).verification.fmcsaFailures).toBe(4);
    expect(await Notification.countDocuments({ userId: carrier._id, type: 'verification:suspended' })).toBe(1);
  });

  test('outages never count and never change status', async () => {
    const carrier = await createVerifiedCarrier();
    outage();
    for (let i = 0; i < 4; i += 1) await runFmcsaCheck();
    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');
    expect(fresh.verification.fmcsaFailures || 0).toBe(0);
  });

  test('a matched check resets the counter and lifts ONLY the fmcsa_unconfirmed suspension', async () => {
    const parked = await createVerifiedCarrier({
      verification: { status: 'suspended', suspensionReason: 'fmcsa_unconfirmed', fmcsaFailures: 3, dotNumber: '1234567', fmcsaData: { legalName: 'T', dotNumber: '1234567' } },
    });
    const insurance = await createVerifiedCarrier({
      verification: { status: 'suspended', suspensionReason: 'insurance', dotNumber: '1234567', fmcsaData: { legalName: 'T', dotNumber: '1234567' } },
    });
    fmcsaService.lookupByDOT.mockResolvedValue(OK);
    await runFmcsaCheck();

    const a = await User.findById(parked._id);
    expect(a.verification.status).toBe('verified');
    expect(a.verification.suspensionReason).toBeFalsy();
    expect(a.verification.fmcsaFailures).toBe(0);
    const b = await User.findById(insurance._id);
    expect(b.verification.status).toBe('suspended');
    expect(b.verification.suspensionReason).toBe('insurance');
  });

  test('a matched check with revoked authority re-suspends for authority, not unconfirmed', async () => {
    const parked = await createVerifiedCarrier({
      verification: { status: 'suspended', suspensionReason: 'fmcsa_unconfirmed', fmcsaFailures: 3, fmcsaData: { legalName: 'T', dotNumber: '1234567' } },
    });
    fmcsaService.lookupByDOT.mockResolvedValue({ ...OK, operatingStatus: 'OUT-OF-SERVICE' });
    await runFmcsaCheck();
    const fresh = await User.findById(parked._id);
    expect(fresh.verification.status).toBe('suspended');
    expect(fresh.verification.suspensionReason).toBe('fmcsa_authority');
  });
});

describe('insuranceMonitor — does not resurrect FMCSA-revoked carriers', () => {
  test('insurance renewal must NOT restore a carrier whose FMCSA authority is revoked', async () => {
    const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    await createVerifiedCarrier({
      verification: {
        status: 'suspended', // suspended by the FMCSA monitor
        insurance: {
          status: 'expiring', // was flagged expiring, then the carrier renewed
          cargoLiability: { expiry: future },
        },
        fmcsaData: { legalName: 'Test Trucking LLC', operatingStatus: 'OUT-OF-SERVICE' },
      },
    });

    await runInsuranceCheck();

    const fresh = await User.findOne({ 'verification.fmcsaData.operatingStatus': 'OUT-OF-SERVICE' });
    expect(fresh.verification.insurance.status).toBe('valid'); // insurance itself is fine now
    expect(fresh.verification.status).toBe('suspended');       // but authority is still revoked
  });

  test('insurance renewal still restores a carrier whose FMCSA authority is fine', async () => {
    const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const carrier = await createVerifiedCarrier({
      verification: {
        status: 'suspended',
        suspensionReason: 'insurance', // suspended BY the insurance monitor
        insurance: {
          status: 'lapsed',
          cargoLiability: { expiry: future }, // renewed
        },
        fmcsaData: { legalName: 'Test Trucking LLC', operatingStatus: 'AUTHORIZED FOR Property' },
      },
    });

    await runInsuranceCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');
    expect(fresh.verification.suspensionReason).toBeFalsy();
  });

  test('insurance renewal must NOT restore a fraud/admin-suspended carrier (no insurance reason)', async () => {
    const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const carrier = await createVerifiedCarrier({
      verification: {
        status: 'suspended', // e.g. fraudMonitor/admin — suspensionReason not set
        insurance: { status: 'lapsed', cargoLiability: { expiry: future } },
        fmcsaData: { legalName: 'Test Trucking LLC', operatingStatus: 'AUTHORIZED FOR Property' },
      },
    });

    await runInsuranceCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.insurance.status).toBe('valid');
    expect(fresh.verification.status).toBe('suspended'); // unrelated suspension survives
  });

  test('renewal into the 30-day expiring window still lifts an insurance suspension', async () => {
    const in25Days = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);
    const carrier = await createVerifiedCarrier({
      verification: {
        status: 'suspended',
        suspensionReason: 'insurance',
        insurance: { status: 'lapsed', cargoLiability: { expiry: in25Days } }, // renewed, expiring soon
        fmcsaData: { legalName: 'Test Trucking LLC', operatingStatus: 'AUTHORIZED FOR Property' },
      },
    });

    await runInsuranceCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.status).toBe('verified');       // account restored
    expect(fresh.verification.insurance.status).toBe('expiring'); // but still nagged
  });

  test('a future cargo policy must not mask an EXPIRED auto-liability policy', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    const carrier = await createVerifiedCarrier({
      verification: {
        status: 'verified',
        insurance: {
          status: 'valid',
          cargoLiability: { expiry: future },
          autoLiability: { expiry: past }, // expired!
        },
      },
    });

    await runInsuranceCheck();

    const fresh = await User.findById(carrier._id);
    expect(fresh.verification.insurance.status).toBe('lapsed');
    expect(fresh.verification.status).toBe('suspended');
  });
});

describe('nightly insurance re-check', () => {
  const Notification = require('../../models/Notification');
  const authorized = (onFile) => ({ dotNumber: '1234567', legalName: 'Test Trucking LLC', operatingStatus: 'AUTHORIZED FOR Property', insuranceOnFile: onFile });

  test('a policy cancelled after onboarding is caught, the carrier is told once, and it clears when the record is good again', async () => {
    const carrier = await createVerifiedCarrier();
    fmcsaService.lookupByDOT.mockResolvedValue(authorized({ hasData: true, bipdOnFile: false, bipdOnFileAmount: 0 }));
    await runFmcsaCheck();
    await runFmcsaCheck();
    let after = await User.findById(carrier._id);
    expect(after.verification.insurance.status).toBe('lapsed');
    expect(after.verification.status).toBe('verified'); // authority is fine; booking is blocked by the insurance status
    expect(await Notification.countDocuments({ userId: carrier._id, type: 'verification:insurance_lapsed' })).toBe(1);

    fmcsaService.lookupByDOT.mockResolvedValue(authorized({ hasData: true, bipdOnFile: true, bipdOnFileAmount: 1000000 }));
    await runFmcsaCheck();
    after = await User.findById(carrier._id);
    expect(after.verification.insurance.status).toBe('valid');
    expect(after.verification.insurance.meetsFederalMinimum).toBe(true);
  });

  test('a good federal record never overrides or clears what a certificate says', async () => {
    const soon = new Date(Date.now() + 200 * 86400000);
    const manual = (status) => ({ status, source: 'manual', autoLiability: { amount: 1000000, expiry: soon } });
    const good = authorized({ hasData: true, bipdOnFile: true, bipdOnFileAmount: 1000000 });
    const missing = authorized({ hasData: true, bipdOnFile: false, bipdOnFileAmount: 0 });

    // A certificate marked lapsed stays lapsed when FMCSA looks fine.
    const a = await createVerifiedCarrier({ verification: { status: 'verified', dotNumber: '1234567', insurance: manual('lapsed'), fmcsaData: { legalName: 'Test Trucking LLC', operatingStatus: 'AUTHORIZED FOR Property' } } });
    fmcsaService.lookupByDOT.mockResolvedValue(good);
    await runFmcsaCheck();
    let after = await User.findById(a._id);
    expect(after.verification.insurance.status).toBe('lapsed');
    expect(after.verification.insurance.source).toBe('manual');

    // A federal lapse over a valid certificate: status goes to lapsed, the certificate's dates are kept,
    // and the certificate's expiry check cannot lift it while FMCSA still shows the policy missing.
    await User.updateOne({ _id: a._id }, { $set: { 'verification.insurance': manual('valid') } });
    fmcsaService.lookupByDOT.mockResolvedValue(missing);
    await runFmcsaCheck();
    await runInsuranceCheck();
    after = await User.findById(a._id);
    expect(after.verification.insurance.status).toBe('lapsed');
    expect(after.verification.insurance.source).toBe('manual');
    expect(after.verification.insurance.autoLiability.expiry).toEqual(soon);
    expect(after.verification.insurance.fmcsaLapsedAt).toBeTruthy();

    // FMCSA good again: only the marker is lifted; the certificate's own check then restores the status.
    fmcsaService.lookupByDOT.mockResolvedValue(good);
    await runFmcsaCheck();
    after = await User.findById(a._id);
    expect(after.verification.insurance.fmcsaLapsedAt).toBeNull();
    expect(after.verification.insurance.status).toBe('lapsed');
    await runInsuranceCheck();
    expect((await User.findById(a._id)).verification.insurance.status).toBe('valid');
  });

  test('a record with no insurance fields changes nothing', async () => {
    const carrier = await createVerifiedCarrier();
    fmcsaService.lookupByDOT.mockResolvedValue(authorized(undefined));
    await runFmcsaCheck();
    expect((await User.findById(carrier._id)).verification.insurance.status).toBe('valid');
  });
});
