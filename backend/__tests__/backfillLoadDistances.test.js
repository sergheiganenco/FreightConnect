/**
 * Backfill script: eligibility, dry run, consecutive-failure abort.
 * Routing helper is mocked; no network. Runs against in-memory Mongo via setup.js.
 */
require('./setup');
jest.mock('../services/routingService', () => ({ loadDistanceFields: jest.fn() }));

const Load = require('../models/Load');
const { loadDistanceFields } = require('../services/routingService');
const { backfill, parseArgs } = require('../scripts/backfillLoadDistances');
const { createTestUser, createTestLoad } = require('./helpers');

const ok = async () => ({ distanceMiles: 123.4, distanceSource: 'ors' });
const fail = async () => ({ distanceMiles: null, distanceSource: null });

describe('backfillLoadDistances', () => {
  let shipper;
  beforeEach(async () => {
    loadDistanceFields.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    shipper = await createTestUser({ role: 'shipper' });
  });

  afterEach(() => jest.restoreAllMocks());

  const run = (opts = {}) => backfill({ delayMs: 0, ...opts });

  test('updates only eligible loads; skips stops, existing distance, missing coords', async () => {
    loadDistanceFields.mockImplementation(ok);
    const eligible = await createTestLoad(shipper._id, {});
    const withStops = await createTestLoad(shipper._id, {
      stops: [{ sequence: 1, type: 'pickup', address: 'Gary, IN', lat: 41.6, lng: -87.3 }],
    });
    const hasDistance = await createTestLoad(shipper._id, { distanceMiles: 500, distanceSource: 'ors' });
    const noCoords = await createTestLoad(shipper._id, { destinationLat: null });

    const summary = await run();

    expect(loadDistanceFields).toHaveBeenCalledTimes(1);
    expect(loadDistanceFields.mock.calls[0][0]._id.toString()).toBe(eligible._id.toString());
    expect(summary).toMatchObject({ scanned: 1, updated: 1, skipped: 0, failed: 0, aborted: false });
    const after = await Load.findById(eligible._id);
    expect(after.distanceMiles).toBe(123.4);
    expect(after.distanceSource).toBe('ors');
    expect((await Load.findById(withStops._id)).distanceMiles).toBeNull();
    expect((await Load.findById(hasDistance._id)).distanceMiles).toBe(500);
    expect((await Load.findById(noCoords._id)).distanceMiles).toBeNull();
  });

  test('dry run makes no routing calls and writes nothing', async () => {
    loadDistanceFields.mockImplementation(ok);
    const a = await createTestLoad(shipper._id, {});
    await createTestLoad(shipper._id, {});

    const summary = await run({ dryRun: true });

    expect(summary.wouldProcess).toBe(2);
    expect(loadDistanceFields).not.toHaveBeenCalled();
    expect((await Load.findById(a._id)).distanceMiles).toBeNull();
  });

  test('stops after 5 consecutive failures and writes nothing for them', async () => {
    loadDistanceFields.mockImplementation(fail);
    for (let i = 0; i < 7; i++) await createTestLoad(shipper._id, {});

    const summary = await run();

    expect(loadDistanceFields).toHaveBeenCalledTimes(5);
    expect(summary).toMatchObject({ scanned: 5, updated: 0, failed: 5, aborted: true });
    expect(await Load.countDocuments({ distanceMiles: { $ne: null } })).toBe(0);
  });

  test('a success resets the consecutive-failure streak', async () => {
    // 4 fail, 1 succeeds, then 4 fail: never 5 in a row, so all 9 are processed.
    for (let i = 0; i < 9; i++) await createTestLoad(shipper._id, {});
    loadDistanceFields
      .mockImplementationOnce(fail).mockImplementationOnce(fail)
      .mockImplementationOnce(fail).mockImplementationOnce(fail)
      .mockImplementationOnce(ok)
      .mockImplementation(fail);

    const summary = await run();

    expect(loadDistanceFields).toHaveBeenCalledTimes(9);
    expect(summary).toMatchObject({ scanned: 9, updated: 1, failed: 8, aborted: false });
  });

  test('parseArgs reads flags and rejects bad input', () => {
    expect(parseArgs(['--dry-run', '--limit=3', '--delay-ms=0'])).toEqual({ dryRun: true, limit: 3, delayMs: 0 });
    expect(parseArgs([])).toEqual({ dryRun: false, limit: 0, delayMs: 1500 });
    expect(() => parseArgs(['--limit=abc'])).toThrow();
    expect(() => parseArgs(['--bogus'])).toThrow();
  });
});
