#!/usr/bin/env node
/**
 * backfillLoadDistances.js — fill in road miles (ORS) for loads that have none.
 *
 * Selects loads with distanceMiles null, all four endpoint coordinates present,
 * and no intermediate stops. Newest first. Writes via updateOne guarded by
 * distanceMiles: null, so a value written concurrently is never overwritten.
 *
 * Usage (from backend/):
 *   node scripts/backfillLoadDistances.js [--dry-run] [--limit=N] [--delay-ms=N]
 *
 *   --dry-run     count eligible loads only; no routing calls, no writes
 *   --limit=N     process at most N loads (0 = all, default)
 *   --delay-ms=N  pause between ORS calls (default 1500; free tier is rate limited)
 *
 * Exit codes: 0 normal completion, 1 config/usage/DB error (nothing changed),
 *             2 aborted after 5 consecutive routing failures (likely quota/outage).
 */

const path = require('path');
const mongoose = require('mongoose');
const Load = require('../models/Load');
const { loadDistanceFields } = require('../services/routingService');

const DEFAULT_DELAY_MS = 1500;
const MAX_CONSECUTIVE_FAILURES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function eligibleQuery() {
  return {
    distanceMiles: null,
    originLat: { $type: 'number' },
    originLng: { $type: 'number' },
    destinationLat: { $type: 'number' },
    destinationLng: { $type: 'number' },
    $or: [{ stops: { $exists: false } }, { stops: { $size: 0 } }],
  };
}

async function backfill({ dryRun = false, limit = 0, delayMs = DEFAULT_DELAY_MS } = {}) {
  const query = eligibleQuery();
  const summary = { scanned: 0, updated: 0, skipped: 0, failed: 0, aborted: false };

  if (dryRun) {
    const total = await Load.countDocuments(query);
    const n = limit > 0 ? Math.min(total, limit) : total;
    console.log(`[backfill] dry run: ${n} load(s) would be processed. No routing calls or writes made.`);
    return { ...summary, wouldProcess: n };
  }

  let q = Load.find(query).sort({ createdAt: -1 });
  if (limit > 0) q = q.limit(limit);

  let consecutiveFailures = 0;
  for await (const load of q.cursor()) {
    if (summary.scanned > 0 && delayMs > 0) await sleep(delayMs);
    summary.scanned++;

    const fields = await loadDistanceFields(load);
    if (fields.distanceMiles == null) {
      summary.failed++;
      consecutiveFailures++;
      console.warn(`[backfill] no route for load ${load._id} (${consecutiveFailures} in a row)`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        summary.aborted = true;
        console.error(`[backfill] ${MAX_CONSECUTIVE_FAILURES} consecutive failures: likely ORS quota or outage. Stopping early; re-run later.`);
        break;
      }
      continue;
    }
    consecutiveFailures = 0;

    const res = await Load.updateOne({ _id: load._id, distanceMiles: null }, { $set: fields });
    if (res.modifiedCount === 1) summary.updated++;
    else summary.skipped++; // filled concurrently since the query ran
  }

  console.log(
    `[backfill] summary: scanned=${summary.scanned} updated=${summary.updated} ` +
    `skipped=${summary.skipped} failed=${summary.failed}${summary.aborted ? ' (ABORTED)' : ''}`
  );
  return summary;
}

function parseArgs(argv) {
  const out = { dryRun: false, limit: 0, delayMs: DEFAULT_DELAY_MS };
  const toInt = (arg) => {
    const n = Number(arg.slice(arg.indexOf('=') + 1));
    if (!Number.isInteger(n) || n < 0) throw new Error(`${arg} must be a non-negative integer`);
    return n;
  };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--limit=')) out.limit = toInt(arg);
    else if (arg.startsWith('--delay-ms=')) out.delayMs = toInt(arg);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`[backfill] ${err.message}`);
    return 1;
  }
  if (!process.env.ORS_API_KEY) {
    console.error('[backfill] ORS_API_KEY is not set (backend/.env). Nothing was changed.');
    return 1;
  }
  if (!process.env.MONGO_URI) {
    console.error('[backfill] MONGO_URI is not set (backend/.env). Nothing was changed.');
    return 1;
  }

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const summary = await backfill(opts);
    return summary.aborted ? 2 : 0;
  } catch (err) {
    console.error('[backfill] failed:', err.message);
    return 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  main().then((code) => process.exit(code));
}

module.exports = { backfill, eligibleQuery, parseArgs, main };
