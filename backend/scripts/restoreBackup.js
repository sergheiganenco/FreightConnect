#!/usr/bin/env node
/**
 * Restore a nightly backup folder into a database.
 *
 *   RESTORE_MONGO_URI="mongodb+srv://..." node scripts/restoreBackup.js <backup-folder> [--overwrite]
 *
 * The target is RESTORE_MONGO_URI on purpose (never MONGO_URI), so a restore cannot hit the live database by accident.
 * Without --overwrite it refuses any collection that already holds data.
 */
const mongoose = require('mongoose');
const { restoreBackup } = require('../jobs/nightlyBackup');

(async () => {
  const [folder, flag] = process.argv.slice(2);
  const uri = process.env.RESTORE_MONGO_URI;
  if (!folder || !uri) { console.error('Usage: RESTORE_MONGO_URI=... node scripts/restoreBackup.js <backup-folder> [--overwrite]'); process.exit(1); }
  await mongoose.connect(uri);
  try {
    const restored = await restoreBackup(folder, mongoose.connection.db, { overwrite: flag === '--overwrite' });
    console.log('Restored:', restored);
  } catch (err) {
    console.error('Restore failed:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
