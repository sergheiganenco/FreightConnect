/**
 * Unit: the carrier identity strings printed on rate confirmations, BOLs and
 * settlement statements. Tests the helper's output (PDFKit text is compressed/
 * subsetted, so the rendered PDFs are not text-searchable in tests); all five
 * carrier rows in pdfGenerator.js call this helper.
 */
const { carrierDocIdentity } = require('../../utils/pdfGenerator');

const typed = { name: 'Typed Name', companyName: 'Typed Co', mcNumber: '111111', dotNumber: '222222' };

describe('carrierDocIdentity', () => {
  test('verified carrier: FMCSA-record values win over differing profile values', () => {
    const c = { ...typed, verification: { status: 'verified', fmcsaData: { legalName: 'FMCSA Legal LLC', mcNumber: '999999', dotNumber: '888888' } } };
    expect(carrierDocIdentity(c)).toEqual({ name: 'FMCSA Legal LLC', mcNumber: '999999', dotNumber: '888888' });
  });

  test('unverified carrier: profile values, labelled self-reported', () => {
    const c = { ...typed, verification: { status: 'pending', fmcsaData: { legalName: 'FMCSA Legal LLC', mcNumber: '999999', dotNumber: '888888' } } };
    expect(carrierDocIdentity(c)).toEqual({ name: 'Typed Co (self-reported)', mcNumber: '111111 (self-reported)', dotNumber: '222222 (self-reported)' });
  });

  test('verified but FMCSA gave no MC: typed MC is shown only with the label', () => {
    const c = { ...typed, verification: { status: 'verified', fmcsaData: { legalName: 'FMCSA Legal LLC', dotNumber: '888888' } } };
    const id = carrierDocIdentity(c);
    expect(id.dotNumber).toBe('888888');
    expect(id.mcNumber).toBe('111111 (self-reported)');
  });

  test('nothing on file: N/A, no label', () => {
    expect(carrierDocIdentity(null)).toEqual({ name: 'N/A', mcNumber: 'N/A', dotNumber: 'N/A' });
    expect(carrierDocIdentity({})).toEqual({ name: 'N/A', mcNumber: 'N/A', dotNumber: 'N/A' });
  });
});
