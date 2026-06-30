#!/usr/bin/env node
/**
 * MongoDB backup script — thin wrapper around `mongodump`.
 *
 * Dumps the database referenced by MONGO_URI into a timestamped folder under
 * ./backups (relative to the backend root). Designed to be defensive: it does
 * not require any npm packages and degrades gracefully if `mongodump` is not
 * installed on the host.
 *
 * Usage:
 *   node scripts/backup.js
 *
 * Requirements:
 *   - MongoDB Database Tools (provides `mongodump`):
 *       https://www.mongodb.com/docs/database-tools/installation/
 *   - MONGO_URI set in the environment (or backend/.env)
 *
 * Cron suggestion (Linux/macOS) — daily at 02:00, logging to backup.log:
 *   0 2 * * * cd /path/to/freightconnect/backend && \
 *     /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1
 *
 * Windows Task Scheduler equivalent:
 *   schtasks /Create /SC DAILY /ST 02:00 /TN "FreightConnectBackup" \
 *     /TR "node C:\path\to\freightconnect\backend\scripts\backup.js"
 *
 * Tip: prune old backups periodically (e.g. keep last 14 days) and copy the
 * dump folder off-box (S3, GCS, another volume) for true disaster recovery.
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('[backup] MONGO_URI is not set. Cannot run backup.');
  process.exit(1);
}

// Timestamped output folder: ./backups/2026-06-07T12-30-00
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupsRoot = path.join(__dirname, '..', 'backups');
const outDir = path.join(backupsRoot, timestamp);

try {
  fs.mkdirSync(outDir, { recursive: true });
} catch (err) {
  console.error('[backup] Failed to create backup directory:', err.message);
  process.exit(1);
}

console.log(`[backup] Starting mongodump → ${outDir}`);

// --uri keeps credentials out of argv where possible (still visible to ps; on a
// shared host prefer a config file / env. Acceptable for a defensive wrapper.)
const args = ['--uri', MONGO_URI, '--out', outDir];

const child = spawn('mongodump', args, { stdio: 'inherit' });

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('\n[backup] `mongodump` was not found on this system.');
    console.error('[backup] Install the MongoDB Database Tools, then re-run:');
    console.error('         https://www.mongodb.com/docs/database-tools/installation/');
    console.error('[backup] After install, ensure `mongodump` is on your PATH.');
    process.exit(127);
  }
  console.error('[backup] Failed to start mongodump:', err.message);
  process.exit(1);
});

child.on('close', (code) => {
  if (code === 0) {
    console.log(`[backup] Backup completed successfully → ${outDir}`);
    process.exit(0);
  }
  console.error(`[backup] mongodump exited with code ${code}`);
  process.exit(code || 1);
});
