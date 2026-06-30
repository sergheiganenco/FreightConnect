/**
 * CarrierRiskAgent — continuously scores carrier risk based on performance.
 *
 * Runs every 15 minutes. For each carrier, calculates:
 *   - On-time delivery rate
 *   - Exception / dispute rate
 *   - HOS violation count (last 30 days)
 *   - Insurance status
 *   - Trust score
 *
 * Composite risk score 0–100 (lower = less risky):
 *   0–30   = low risk
 *   31–70  = moderate risk
 *   71–90  = high risk  → admin notification
 *   91–100 = critical   → queue for human review (recommend suspension)
 *
 * IMPORTANT: this agent NEVER auto-suspends a carrier. A critical score
 * creates a ReviewQueue entry that an admin must approve before any
 * suspension takes effect — keeping a human in the loop.
 *
 * Updates User.riskScore and User.riskDetails.
 */

const { Agent } = require('./AgentFramework');
const User = require('../models/User');
const Load = require('../models/Load');
const Exception = require('../models/Exception');
const ReviewQueue = require('../models/ReviewQueue');
const { notifyUserSafe } = require('../utils/notifyUser');

/** Check if ELDLog model exists (optional dependency) */
let ELDLog;
try {
  ELDLog = require('../models/ELDLog');
} catch (_) {
  ELDLog = null;
}

class CarrierRiskAgent extends Agent {
  constructor() {
    super('CarrierRiskAgent', { intervalMs: 15 * 60_000 }); // every 15 min
  }

  /** @returns {Promise<number>} number of carriers scored */
  async execute() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let scored = 0;

    // Stream carriers via cursor to avoid loading the entire collection into memory.
    const cursor = User.find({ role: 'carrier' })
      .select('_id name companyName verification trustScore fleet riskScore')
      .lean()
      .cursor();

    for (let carrier = await cursor.next(); carrier != null; carrier = await cursor.next()) {
      try {
        const cid = carrier._id;

        // ── 1. Delivery performance ────────────────────────────────────
        const deliveredLoads = await Load.countDocuments({
          acceptedBy: cid,
          status: 'delivered',
        });
        const totalAccepted = await Load.countDocuments({
          acceptedBy: cid,
          status: { $in: ['accepted', 'in-transit', 'delivered', 'cancelled'] },
        });

        // Late deliveries: delivered after delivery window end
        const lateDeliveries = await Load.countDocuments({
          acceptedBy: cid,
          status: 'delivered',
          deliveredAt: { $exists: true },
          'deliveryTimeWindow.end': { $exists: true },
          $expr: { $gt: ['$deliveredAt', '$deliveryTimeWindow.end'] },
        });

        const onTimeRate = deliveredLoads > 0
          ? (deliveredLoads - lateDeliveries) / deliveredLoads
          : 1;

        // ── 2. Exception / dispute rate ────────────────────────────────
        // Fetch the carrier's load IDs once and reuse for both exception queries
        // (was N+1: two separate Load.find().select() array fetches per carrier).
        const carrierLoadIds = await Load.distinct('_id', { acceptedBy: cid });

        const exceptions = await Exception.countDocuments({
          $or: [
            { filedBy: cid },
            { loadId: { $in: carrierLoadIds } },
          ],
          createdAt: { $gte: thirtyDaysAgo },
        });

        const disputes = await Exception.countDocuments({
          type: 'dispute',
          loadId: { $in: carrierLoadIds },
          createdAt: { $gte: thirtyDaysAgo },
        });

        const exceptionRate = totalAccepted > 0 ? exceptions / totalAccepted : 0;
        const disputeRate = totalAccepted > 0 ? disputes / totalAccepted : 0;

        // ── 3. HOS violations (last 30 days) ──────────────────────────
        let hosViolations = 0;
        if (ELDLog) {
          const violationDocs = await ELDLog.find({
            driver: cid,
            date: { $gte: thirtyDaysAgo },
            'violations.0': { $exists: true },
          })
            .select('violations')
            .lean();

          hosViolations = violationDocs.reduce(
            (sum, doc) => sum + (doc.violations?.length || 0),
            0
          );
        }

        // ── 4. Insurance status ────────────────────────────────────────
        const insuranceStatus = carrier.verification?.insurance?.status || 'unknown';
        const insuranceRisk = insuranceStatus === 'valid' ? 0
          : insuranceStatus === 'expiring' ? 15
          : insuranceStatus === 'lapsed' ? 40
          : 20; // unknown

        // ── 5. Trust score (inverse — high trust = low risk) ──────────
        const trustScore = carrier.trustScore?.score ?? 50;

        // ── Composite risk score ───────────────────────────────────────
        // Weight: on-time 25%, exceptions 20%, disputes 20%, HOS 15%, insurance 10%, trust 10%
        const riskComponents = {
          onTimePenalty: Math.round((1 - onTimeRate) * 100 * 0.25),    // 0–25
          exceptionPenalty: Math.round(Math.min(1, exceptionRate * 5) * 100 * 0.20), // 0–20
          disputePenalty: Math.round(Math.min(1, disputeRate * 10) * 100 * 0.20),    // 0–20
          hosPenalty: Math.round(Math.min(1, hosViolations / 10) * 100 * 0.15),      // 0–15
          insurancePenalty: Math.round(insuranceRisk * 0.10),           // 0–10 (from 0–40 range)
          trustPenalty: Math.round((1 - trustScore / 100) * 100 * 0.10), // 0–10
        };

        let riskScore = Object.values(riskComponents).reduce((s, v) => s + v, 0);
        riskScore = Math.max(0, Math.min(100, riskScore));

        const riskDetails = {
          onTimeRate: Math.round(onTimeRate * 100),
          exceptionRate: Math.round(exceptionRate * 100),
          disputeRate: Math.round(disputeRate * 100),
          hosViolations,
          insuranceStatus,
          trustScore,
          deliveredLoads,
          totalAccepted,
          components: riskComponents,
          calculatedAt: new Date(),
        };

        // ── Update carrier ─────────────────────────────────────────────
        // NOTE: we only ever update the score/details automatically.
        // Suspension is NEVER applied here — it requires human approval
        // via the ReviewQueue.
        const updateFields = { riskScore, riskDetails };

        // Critical risk (>90): queue for human review recommending suspension.
        // We do NOT touch verification.status — an admin must approve first.
        if (riskScore > 90 && carrier.verification?.status === 'verified') {
          // Avoid creating a duplicate review every 15-min cycle.
          const existing = await ReviewQueue.findOne({
            subjectUser: cid,
            type: 'carrier_suspension',
            status: 'pending',
          }).select('_id').lean();

          if (!existing) {
            const reason = `AI risk engine flagged critical risk score ${riskScore}/100 — suspension recommended pending human review.`;

            await ReviewQueue.create({
              type: 'carrier_suspension',
              subjectUser: cid,
              severity: 'critical',
              status: 'pending',
              reason,
              riskScore,
              details: riskDetails,
              recommendedAction: 'suspend',
            });

            // Notify admins that a carrier needs review (no auto-suspension).
            const admins = await User.find({ role: 'admin' }).select('_id').lean();
            for (const admin of admins) {
              await notifyUserSafe(admin._id, {
                type: 'ai:riskAlert',
                title: `Carrier flagged for review: Risk ${riskScore}`,
                body: `${carrier.companyName || carrier.name} (${cid}) flagged by AI risk engine — suspension recommended, awaiting admin review.`,
                link: '/dashboard/admin/review-queue',
                metadata: { carrierId: cid, riskScore, recommendedAction: 'suspend' },
              });
            }

            console.log(`[CarrierRiskAgent] Queued carrier ${cid} for human review (risk: ${riskScore})`);
          }
        }
        // High risk (71–90) — notify admin but don't suspend or queue.
        else if (riskScore > 70) {
          const admins = await User.find({ role: 'admin' }).select('_id').lean();
          for (const admin of admins) {
            await notifyUserSafe(admin._id, {
              type: 'ai:riskAlert',
              title: `High-risk carrier: ${carrier.companyName || carrier.name}`,
              body: `Risk score ${riskScore}/100 — review recommended`,
              link: '/dashboard/admin/users',
              metadata: { carrierId: cid, riskScore },
            });
          }
        }

        await User.updateOne({ _id: cid }, { $set: updateFields });
        scored++;
      } catch (err) {
        console.error(`[CarrierRiskAgent] Error scoring carrier ${carrier._id}:`, err.message);
      }
    }

    return scored;
  }
}

module.exports = CarrierRiskAgent;
