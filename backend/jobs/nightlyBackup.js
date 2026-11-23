/**
 * nightlyBackup.js — a full copy of the database, every night, kept on the documents disk.
 *
 * The database lives at the database host; this copy lives on the app's own persistent disk, so losing either one
 * alone loses nothing. No external tools: each collection is written as one gzipped file of typed JSON lines
 * (dates and ids survive the round trip). The last KEEP nights are kept. Restore with scripts/restoreBackup.js.
 *
 * ponytail: the copy is not encrypted. Anyone who can read this disk can already read the database password next to
 * it, so encryption here would protect nothing; add it when backups are shipped to storage outside this server.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const cron = require('node-cron');
const mongoose = require('mongoose');

const { EJSON } = mongoose.mongo.BSON || require('bson');
const BACKUP_DIR = path.join(__dirname, '..', 'public', 'documents', 'backups'); // on the persistent disk; never served (see app.js)
const KEEP = 7;
const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

async function runBackup({ dir = BACKUP_DIR, keep = KEEP, db = mongoose.connection.db, now = new Date() } = {}) {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
  const tmp = path.join(dir, `.partial-${stamp}`);
  fs.mkdirSync(tmp, { recursive: true });
  const counts = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (name.startsWith('system.')) continue;
    let n = 0;
    const lines = async function* () {
      for await (const doc of db.collection(name).find({})) { n += 1; yield EJSON.stringify(doc, { relaxed: false }) + '\n'; }
    };
    await pipeline(Readable.from(lines()), zlib.createGzip(), fs.createWriteStream(path.join(tmp, `${name}.jsonl.gz`)));
    counts[name] = n;
  }
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ takenAt: now.toISOString(), counts }, null, 2));
  const final = path.join(dir, stamp);
  fs.renameSync(tmp, final); // a backup folder with a proper name is always a complete one
  for (const old of listBackups(dir).slice(keep)) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  return { dir: final, counts };
}

/** Complete backups, newest first. */
function listBackups(dir = BACKUP_DIR) {
  try { return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse(); } catch (_) { return []; }
}

function lastBackupAt(dir = BACKUP_DIR) {
  const [latest] = listBackups(dir);
  if (!latest) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, latest, 'manifest.json'), 'utf8')).takenAt; } catch (_) { return null; }
}

/** Put a backup folder back into `db`. Refuses a database that already holds data unless `overwrite` is set. */
async function restoreBackup(folder, db, { overwrite = false } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  if (!overwrite) {
    for (const name of Object.keys(manifest.counts)) {
      if (await db.collection(name).estimatedDocumentCount()) throw new Error(`"${name}" already holds data. Restore into an empty database, or pass overwrite.`);
    }
  }
  const restored = {};
  for (const name of Object.keys(manifest.counts)) {
    // ponytail: a collection file is read whole into memory; stream it line by line if one ever outgrows memory.
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(folder, `${name}.jsonl.gz`))).toString('utf8').split('\n');
    if (overwrite) await db.collection(name).deleteMany({});
    let batch = []; let n = 0;
    const flush = async () => { if (batch.length) { await db.collection(name).insertMany(batch, { ordered: true }); n += batch.length; batch = []; } };
    for (const line of lines) {
      if (!line) continue;
      batch.push(EJSON.parse(line, { relaxed: false }));
      if (batch.length >= 500) await flush();
    }
    await flush();
    if (n !== manifest.counts[name]) throw new Error(`"${name}": restored ${n} of ${manifest.counts[name]} records`);
    restored[name] = n;
  }
  return restored;
}

function start() {
  if (process.env.BACKUPS === 'off') return;
  const safe = () => runBackup().then((r) => console.log(`[backup] saved ${Object.keys(r.counts).length} collections`)).catch((e) => console.error('[backup] FAILED:', e.message));
  cron.schedule('20 8 * * *', safe); // 08:20 UTC, about 3am US Eastern
  // First start with no backup at all (or a day-old one): take one shortly after boot instead of waiting for the night.
  const last = lastBackupAt();
  if (!last || Date.now() - new Date(last).getTime() > 26 * 60 * 60 * 1000) setTimeout(safe, 60 * 1000).unref();
}

module.exports = { start, runBackup, restoreBackup, listBackups, lastBackupAt, BACKUP_DIR };
