/**
 * Fraud Monitor — Background Job
 *
 * Runs every 6 hours. Executes all fraud detection patterns,
 * creates FraudAlert records, notifies admins, and auto-suspends
 * accounts with critical fraud scores.
 */

const cron = require('node-cron');
const { runAllDetections } = require('../services/fraudDetectionService');

async function runFraudScan() {
  console.log('[FraudMonitor] Starting fraud detection scan...');

  try {
    const results = await runAllDetections();

    console.log(
      `[FraudMonitor] Scan complete. ` +
      `Double-brokering: ${results.doubleBrokering}, ` +
      `Identity: ${results.identityRedFlags}, ` +
      `Price manipulation: ${results.priceManipulation}, ` +
      `Unusual activity: ${results.unusualActivity}, ` +
      `Auto-suspended: ${results.autoSuspended}, ` +
      `Total new alerts: ${results.total}`
    );
  } catch (err) {
    console.error('[FraudMonitor] Error during fraud scan:', err.message);
  }
}

function start() {
  // Run every 6 hours at :15 past the hour (0:15, 6:15, 12:15, 18:15)
  cron.schedule('15 */6 * * *', runFraudScan);
  console.log('[FraudMonitor] Scheduled — runs every 6 hours at :15');
}

module.exports = { start, runFraudScan };
