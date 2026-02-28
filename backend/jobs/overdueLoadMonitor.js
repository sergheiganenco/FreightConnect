/**
 * Overdue Load Monitor
 *
 * Runs every hour. Finds loads that are still `accepted` or `in-transit`
 * but have passed their delivery window end. Creates a system Exception
 * (autoFlagged=true) and notifies both parties + admins so someone can
 * investigate without manual discovery.
 *
 * Only one exception is created per load (idempotent — checks before inserting).
 */

const cron = require('node-cron');
const Load = require('../models/Load');
const Exception = require('../models/Exception');
const { getIO } = require('../utils/socket');

function notify(userId, event, payload) {
  try { getIO().to(`user_${userId}`).emit(event, payload); } catch (_) {}
}

async function runOverdueCheck() {
  console.log('[OverdueMonitor] Running overdue load check...');
  const now = new Date();
  let flagged = 0;

  try {
    // Loads that are active but past their scheduled delivery window
    const overdueLoads = await Load.find({
      status: { $in: ['accepted', 'in-transit'] },
      'deliveryTimeWindow.end': { $lt: now },
    });

    for (const load of overdueLoads) {
      // Idempotent — skip if a system-flagged delay exception already exists
      const existing = await Exception.findOne({
        loadId: load._id,
        type: 'delay',
        autoFlagged: true,
      });
      if (existing) continue;

      const hoursLate = Math.round((now - load.deliveryTimeWindow.end) / (1000 * 60 * 60));
      const description =
        `Load was scheduled for delivery by ` +
        `${new Date(load.deliveryTimeWindow.end).toLocaleString()} ` +
        `but is still in "${load.status}" status — ${hoursLate} hour(s) overdue. ` +
        `System auto-flagged for review.`;

      const exception = await Exception.create({
        loadId: load._id,
        filedBy: load.postedBy,       // attributed to shipper; they "own" the delivery expectation
        filedByRole: 'system',
        type: 'delay',
        severity: hoursLate >= 24 ? 'high' : 'medium',
        title: `Delivery Overdue — ${hoursLate}h past window`,
        description,
        autoFlagged: true,
        notes: [{
          author: load.postedBy,
          authorRole: 'system',
          content: description,
        }],
      });

      flagged++;
      console.log(`[OverdueMonitor] Flagged load ${load._id} (${hoursLate}h overdue)`);

      // Notify both parties
      const notifyIds = [load.postedBy?.toString(), load.acceptedBy?.toString()].filter(Boolean);
      notifyIds.forEach(id => notify(id, 'exception:new', {
        exceptionId: exception._id,
        loadId: load._id,
        title: exception.title,
        type: 'delay',
        severity: exception.severity,
        autoFlagged: true,
      }));
    }

    console.log(`[OverdueMonitor] Check complete. Flagged ${flagged} new overdue load(s).`);
  } catch (err) {
    console.error('[OverdueMonitor] Error:', err);
  }
}

function start() {
  // Run every hour at :05 to stagger with other jobs
  cron.schedule('5 * * * *', runOverdueCheck);
  console.log('[OverdueMonitor] Scheduled — runs every hour at :05');
}

module.exports = { start, runOverdueCheck };
