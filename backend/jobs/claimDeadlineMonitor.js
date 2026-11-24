/**
 * Cargo claim clocks (49 CFR 370).
 *
 * A carrier must acknowledge a cargo claim in writing within 30 days and pay it, decline it or make
 * a firm offer within 120 days. This job reminds the carrier before each date and tells the admins
 * when one is missed. Each notice is sent once (Claim.deadlineNotices).
 */
const cron = require('node-cron');
const Claim = require('../models/Claim');
const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');

const DAY = 86400000;
const day = (d) => new Date(d).toISOString().slice(0, 10);

// [key, applies(claim, now), who, title, body]
const NOTICES = [
  ['ack_7', (c, now) => !c.acknowledgedAt && c.deadlines.acknowledgeBy - now <= 7 * DAY, 'carrier',
    'Cargo claim: acknowledge within 7 days', (c) => `A cargo claim on your load must be acknowledged by ${day(c.deadlines.acknowledgeBy)}.`],
  ['ack_over', (c, now) => !c.acknowledgedAt && c.deadlines.acknowledgeBy < now, 'both',
    'Cargo claim: acknowledgment is overdue', (c) => `The 30 days to acknowledge this cargo claim ended ${day(c.deadlines.acknowledgeBy)}.`],
  ['dec_14', (c, now) => c.deadlines.decideBy - now <= 14 * DAY, 'both',
    'Cargo claim: decision due in 14 days', (c) => `This cargo claim must be paid, declined or answered with a firm offer by ${day(c.deadlines.decideBy)}.`],
  ['dec_over', (c, now) => c.deadlines.decideBy < now, 'both',
    'Cargo claim: decision is overdue', (c) => `The 120 days to decide this cargo claim ended ${day(c.deadlines.decideBy)}.`],
];

async function runClaimDeadlines(now = new Date()) {
  let sent = 0;
  const claims = await Claim.find({ status: { $in: ['open', 'investigating'] }, 'deadlines.decideBy': { $ne: null } })
    .select('respondent deadlines acknowledgedAt deadlineNotices loadId').lean();
  for (const c of claims) {
    for (const [key, applies, who, title, body] of NOTICES) {
      if ((c.deadlineNotices || []).includes(key) || !applies(c, now)) continue;
      // Claim the notice first, so two runs cannot both send it.
      const won = await Claim.updateOne({ _id: c._id, deadlineNotices: { $ne: key } }, { $addToSet: { deadlineNotices: key } });
      if (!won.modifiedCount) continue;
      const payload = { type: 'claim:deadline', title, body: body(c), metadata: { claimId: c._id, loadId: c.loadId, notice: key, priority: 'high' } };
      await notifyUserSafe(String(c.respondent), { ...payload, link: '/dashboard/carrier/claims' });
      if (who === 'both') await notifyAdmins({ ...payload, link: '/dashboard/admin/claims' });
      sent++;
    }
  }
  if (sent) console.log(`[ClaimDeadlines] notices sent: ${sent}`);
  return { sent };
}

function start() {
  cron.schedule('15 8 * * *', () => { runClaimDeadlines().catch((e) => console.error('[ClaimDeadlines] run failed:', e.message)); });
  console.log('[ClaimDeadlines] Scheduled — runs daily at 08:15');
}

module.exports = { start, runClaimDeadlines };
