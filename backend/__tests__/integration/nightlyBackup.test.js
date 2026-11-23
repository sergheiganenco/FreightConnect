/** Integration: a backup holds every record, restores exactly (dates and ids intact), refuses to overwrite, and old ones are pruned. */
require('../setup');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { createTestUser, createTestLoad } = require('../helpers');
const { runBackup, restoreBackup, listBackups, lastBackupAt } = require('../../jobs/nightlyBackup');

test('backup → restore round trip; an untested backup is not a backup', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-backup-'));
  const shipper = await createTestUser({ role: 'shipper' });
  const load = await createTestLoad(shipper._id, { status: 'open' });
  const db = mongoose.connection.db;
  const before = await db.collection('loads').findOne({ _id: load._id });

  const { dir: folder, counts } = await runBackup({ dir, now: new Date('2026-01-05T08:20:00Z') });
  expect(counts.users).toBe(1);
  expect(counts.loads).toBe(1);
  expect(listBackups(dir)).toEqual(['2026-01-05T08-20-00Z']);
  expect(lastBackupAt(dir)).toBe('2026-01-05T08:20:00.000Z');

  await expect(restoreBackup(folder, db)).rejects.toThrow(/already holds data/); // never silently over live data
  await db.collection('loads').deleteMany({});
  await db.collection('users').deleteMany({});
  const restored = await restoreBackup(folder, db, { overwrite: true });
  expect(restored.loads).toBe(1);
  const after = await db.collection('loads').findOne({ _id: load._id });
  expect(after).toEqual(before); // ObjectIds and Dates come back as the same types and values
  expect(after.createdAt).toBeInstanceOf(Date);
  expect(await db.collection('users').countDocuments({ _id: shipper._id })).toBe(1);

  // only the newest `keep` complete backups stay; an unfinished one is never listed
  for (const d of ['06', '07', '08']) await runBackup({ dir, keep: 2, now: new Date(`2026-01-${d}T08:20:00Z`) });
  fs.mkdirSync(path.join(dir, '.partial-2026-01-09T08-20-00Z'));
  expect(listBackups(dir)).toEqual(['2026-01-08T08-20-00Z', '2026-01-07T08-20-00Z']);
});
