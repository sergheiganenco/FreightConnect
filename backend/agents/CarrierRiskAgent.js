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
 *   91–100 = critical   → auto-suspend carrier
 *
 * Updates User.riskScore and User.riskDetails.
 */

const { Agent } = require('./AgentFramework');
const User = require('../models/User');
const Load = require('../models/Load');
const Exception = require('../models/Exception');
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
    const carriers = await User.find({ role: 'carrier' })
      .select('_id name companyName verification trustScore fleet riskScore')
      .lean();

    if (carriers.length === 0) return 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let scored = 0;

    for (const carrier of carriers) {
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
        const exceptions = await Exception.countDocuments({
          $or: [
            { filedBy: cid },
            { loadId: { $in: await Load.find({ acceptedBy: cid }).select('_id').lean().then(ls => ls.map(l => l._id)) } },
          ],
          createdAt: { $gte: thirtyDaysAgo },
        });

        const disputes = await Exception.countDocuments({
          type: 'dispute',
          loadId: { $in: await Load.find({ acceptedBy: cid }).select('_id').lean().then(ls => ls.map(l => l._id)) },
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
        const updateFields = { riskScore, riskDetails };

        // Auto-suspend if score > 90
        if (riskScore > 90 && carrier.verification?.status === 'verified') {
          updateFields['verification.status'] = 'suspended';

          await notifyUserSafe(cid, {
            type: 'ai:riskSuspension',
            title: 'Account Suspended: High Risk Score',
            body: `Your risk score is ${riskScore}/100. Your account has been suspended pending review.`,
            link: '/dashboard/carrier/profile',
            metadata: { riskScore, riskDetails },
          });

          // Notify admins
          const admins = await User.find({ role: 'admin' }).select('_id').lean();
          for (const admin of admins) {
            await notifyUserSafe(admin._id, {
              type: 'ai:riskAlert',
              title: `Carrier auto-suspended: Risk ${riskScore}`,
              body: `${carrier.companyName || carrier.name} (${cid}) suspended by AI risk engine`,
              link: '/dashboard/admin/users',
              metadata: { carrierId: cid, riskScore },
            });
          }

          console.log(`[CarrierRiskAgent] Auto-suspended carrier ${cid} (risk: ${riskScore})`);
        }
        // Flag high risk (71–90) — notify admin but don't suspend
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
