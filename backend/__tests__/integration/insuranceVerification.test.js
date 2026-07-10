/**
 * Insurance verification — real FMCSA insurance-on-file evaluation.
 *
 * Verifies the parser (fmcsaService.extractInsuranceOnFile) and the evaluator
 * (insuranceService.evaluateFmcsa) against the FMCSA financial-responsibility
 * minimums (49 CFR §387): $750k BIPD general freight, $1M hazmat.
 */

const fmcsaService = require('../../services/fmcsaService');
const insuranceService = require('../../services/insuranceService');

// Build normalized carrier data from a raw QCMobile-shaped carrier record.
const mk = (carrier) => fmcsaService.normalizeCarrierData({ content: { carrier } });

describe('FMCSA insurance parsing', () => {
  test('BIPD amount in thousands is converted to whole dollars', () => {
    const d = mk({ bipdInsuranceOnFile: '1000', bipdInsuranceRequired: 'Y' });
    expect(d.insuranceOnFile.bipdOnFile).toBe(true);
    expect(d.insuranceOnFile.bipdOnFileAmount).toBe(1000000);
    expect(d.insuranceOnFile.bipdRequired).toBe(true);
    expect(d.insuranceOnFile.hasData).toBe(true);
  });

  test('Y/N flag (no amount) is read as on-file boolean, not an amount', () => {
    const d = mk({ bipdInsuranceOnFile: 'Y', cargoInsuranceOnFile: 'N' });
    expect(d.insuranceOnFile.bipdOnFile).toBe(true);
    expect(d.insuranceOnFile.bipdOnFileAmount).toBeNull();
    expect(d.insuranceOnFile.cargoOnFile).toBe(false);
  });

  test('record with no insurance fields reports hasData=false', () => {
    const d = mk({ legalName: 'Acme Trucking' });
    expect(d.insuranceOnFile.hasData).toBe(false);
  });
});

describe('Insurance evaluation vs federal minimums', () => {
  test('$1M BIPD on file (general freight) → valid, meets minimum', () => {
    const r = insuranceService.evaluateFmcsa(mk({ bipdInsuranceOnFile: '1000', cargoInsuranceOnFile: 'Y' }), {});
    expect(r.status).toBe('valid');
    expect(r.meetsFederalMinimum).toBe(true);
    expect(r.requiredMinimum).toBe(750000);
    expect(r.source).toBe('fmcsa');
    expect(r.autoLiability.amount).toBe(1000000);
  });

  test('$500k BIPD is below the $750k general-freight minimum → lapsed', () => {
    const r = insuranceService.evaluateFmcsa(mk({ bipdInsuranceOnFile: '500', bipdInsuranceRequired: 'Y' }), {});
    expect(r.status).toBe('lapsed');
    expect(r.meetsFederalMinimum).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/below the required/i);
  });

  test('hazmat requires $1M — $750k fails, $1M passes', () => {
    const fail = insuranceService.evaluateFmcsa(mk({ bipdInsuranceOnFile: '750' }), { hazmat: true });
    expect(fail.requiredMinimum).toBe(1000000);
    expect(fail.status).toBe('lapsed');

    const pass = insuranceService.evaluateFmcsa(mk({ bipdInsuranceOnFile: '1000' }), { hazmat: true });
    expect(pass.status).toBe('valid');
    expect(pass.meetsFederalMinimum).toBe(true);
  });

  test('cargo required but not on file → lapsed with a clear reason', () => {
    const r = insuranceService.evaluateFmcsa(
      mk({ bipdInsuranceOnFile: '1000', cargoInsuranceRequired: 'Y', cargoInsuranceOnFile: 'N' }), {});
    expect(r.status).toBe('lapsed');
    expect(r.reasons.join(' ')).toMatch(/cargo insurance is required/i);
  });

  test('no federal insurance data → unknown (honest), never a false "no coverage"', () => {
    const r = insuranceService.evaluateFmcsa(mk({ legalName: 'Acme' }), {});
    expect(r.status).toBe('unknown');
    expect(r.meetsFederalMinimum).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/connect a coi vendor/i);
  });

  test('Y/N-only on-file (no amount) is treated as meeting minimum on the flag', () => {
    const r = insuranceService.evaluateFmcsa(mk({ bipdInsuranceOnFile: 'Y', bipdInsuranceRequired: 'Y' }), {});
    expect(r.status).toBe('valid');
    expect(r.meetsFederalMinimum).toBe(true);
  });
});
