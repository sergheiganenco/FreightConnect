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
const { createTestUser } = require('../helpers');
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
