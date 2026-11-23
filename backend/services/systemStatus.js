/**
 * systemStatus.js — one honest answer to "is everything this platform depends on actually switched on?"
 * Reports only on/off facts, never a secret's value. Shown to admins (GET /api/admin/system-status).
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DOCS_DIR = path.join(__dirname, '..', 'public', 'documents');
const MARKER = path.join(DOCS_DIR, '.storage-marker');
const DAY_MS = 24 * 60 * 60 * 1000;
const bootedAt = Date.now() - Math.round(process.uptime() * 1000);

// What each connection is for, and whether the platform is unsafe to run for real customers without it.
const CONNECTIONS = [
  { key: 'payments', label: 'Payments (Stripe)', env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'], critical: false, off: 'Carriers cannot be paid through the platform.' },
  { key: 'email', label: 'Email', env: ['EMAIL_USER', 'EMAIL_PASS'], critical: true, off: 'Password reset and email notices send nothing.' },
  { key: 'carrierLookup', label: 'Carrier lookup (FMCSA)', env: ['FMCSA_API_KEY'], critical: true, off: 'Carrier verification cannot complete.' },
  { key: 'routing', label: 'Routes and ETA', env: ['ORS_API_KEY'], critical: false, off: 'Route lines and ETA estimates are unavailable.' },
  { key: 'ai', label: 'AI assistant', env: ['ANTHROPIC_API_KEY'], critical: false, off: 'Email import and AI review fall back to simple rules.' },
  { key: 'errorTracking', label: 'Error tracking', env: ['SENTRY_DSN'], critical: false, off: 'Server errors are only in the host log.' },
];

/**
 * Do uploaded files survive a redeploy? A marker file is written once; if it is older than this process, the folder
 * outlived at least one restart. `null` = cannot tell yet (first start since the marker was written).
 */
function storageStatus({ dir = DOCS_DIR, marker = MARKER, now = Date.now(), started = bootedAt } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(marker)) fs.writeFileSync(marker, new Date(now).toISOString());
    const writtenAt = new Date(fs.readFileSync(marker, 'utf8').trim()).getTime();
    return { writable: true, survivesRestart: Number.isFinite(writtenAt) && writtenAt < started - 1000 ? true : null };
  } catch (err) {
    return { writable: false, survivesRestart: false };
  }
}

function getSystemStatus(env = process.env) {
  const connections = CONNECTIONS.map((c) => {
    const on = c.env.every((k) => !!env[k]);
    return { key: c.key, label: c.label, on, critical: c.critical, note: on ? null : c.off };
  });
  const storage = storageStatus();
  const database = mongoose.connection.readyState === 1;
  const lastAt = require('../jobs/nightlyBackup').lastBackupAt();
  const backup = { lastAt, recent: !!lastAt && Date.now() - new Date(lastAt).getTime() < 2 * DAY_MS };
  const problems = [];
  if (!database) problems.push('The database is not connected.');
  if (!storage.writable) problems.push('Uploaded documents cannot be saved.');
  if (!backup.recent && env.NODE_ENV === 'production') problems.push(lastAt ? 'The last database backup is more than 2 days old.' : 'No database backup has been taken yet.');
  connections.filter((c) => !c.on && c.critical).forEach((c) => problems.push(`${c.label} is off. ${c.note}`));
  return { ok: problems.length === 0, problems, database, storage, backup, connections, startedAt: new Date(bootedAt).toISOString() };
}

module.exports = { getSystemStatus, storageStatus };
