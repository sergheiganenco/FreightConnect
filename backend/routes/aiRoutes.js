/**
 * AI Routes — API endpoints for the AI / autonomous agent subsystem.
 *
 * GET  /api/ai/status                         — all agent statuses (admin)
 * GET  /api/ai/market-insights                — market data by lane
 * GET  /api/ai/demand-forecast                — demand predictions by lane
 * GET  /api/ai/carrier-risk/:carrierId        — carrier risk score (admin or self)
 * POST /api/ai/agents/:name/toggle            — enable/disable an agent (admin)
 * GET  /api/ai/recommendations/:carrierId     — personalized load recommendations
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const { getOrchestrator } = require('../agents');
const MarketInsight = require('../models/MarketInsight');
const DemandForecast = require('../models/DemandForecast');
const User = require('../models/User');
const { findMatchesForCarrier } = require('../services/matchingService');

// ── GET /status — all agent statuses (admin only) ───────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }

    const orchestrator = getOrchestrator();
    if (!orchestrator) {
      return res.json({ agents: [], message: 'Agent system not initialized' });
    }

    res.json({ agents: orchestrator.getStatus() });
  } catch (err) {
    console.error('[aiRoutes] /status error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /insights — aggregated dashboard insights (heat map, forecast, rate trends, carrier risk) ──
router.get('/insights', auth, async (req, res) => {
  try {
    const Load = require('../models/Load');
    const stateOf = (s) => { const m = /,\s*([A-Z]{2})\b/.exec(s || ''); return m ? m[1] : (s || '').slice(0, 2).toUpperCase(); };
    const heatFor = (n) => (n >= 8 ? 'hot' : n >= 4 ? 'warm' : n >= 2 ? 'neutral' : n >= 1 ? 'cool' : 'cold');

    // Heat map: open loads grouped by lane (origin state → dest state)
    const openLoads = await Load.find({ status: 'open' }).select('origin destination rate rateCents').lean();
    const laneMap = new Map();
    for (const l of openLoads) {
      const key = `${stateOf(l.origin)}-${stateOf(l.destination)}`;
      const rate = l.rateCents != null ? l.rateCents / 100 : (l.rate || 0);
      const e = laneMap.get(key) || { origin: stateOf(l.origin), destination: stateOf(l.destination), count: 0, rateSum: 0 };
      e.count += 1; e.rateSum += rate; laneMap.set(key, e);
    }
    const heatMap = Array.from(laneMap.values()).sort((a, b) => b.count - a.count).slice(0, 6)
      .map((e) => ({ origin: e.origin, destination: e.destination, heat: heatFor(e.count), avgRate: Number(((e.rateSum / e.count) / 600).toFixed(2)) || 0 }));

    // Forecast: average load volume per day-of-week over the last 28 days
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const recent = await Load.find({ createdAt: { $gte: new Date(Date.now() - 28 * 86400000) } }).select('createdAt').lean();
    const byDow = [0, 0, 0, 0, 0, 0, 0];
    for (const l of recent) byDow[new Date(l.createdAt).getDay()]++;
    const forecast = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => {
      const avg = Math.round(byDow[dows.indexOf(day)] / 4);
      return { day, predicted: avg, actual: avg };
    });

    // Rate trends by equipment type (avg rate / ~600mi proxy)
    const eqAgg = await Load.aggregate([
      { $match: { rate: { $gt: 0 } } },
      { $group: { _id: '$equipmentType', avgRate: { $avg: '$rate' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 5 },
    ]);
    const rateTrends = eqAgg.filter((e) => e._id).map((e) => ({
      equipment: e._id, rate: Number((e.avgRate / 600).toFixed(2)) || 0, trend: 'stable', change: 0,
    }));

    // Carrier risk buckets from User.riskScore / verification status
    const carriers = await User.find({ role: 'carrier' }).select('riskScore verification.status').lean();
    const b = { low: 0, medium: 0, high: 0, flagged: 0 };
    for (const c of carriers) {
      const s = typeof c.riskScore === 'number' ? c.riskScore : null;
      if (c.verification?.status === 'suspended' || (s != null && s >= 90)) b.flagged++;
      else if (s != null && s >= 70) b.high++;
      else if (s != null && s >= 40) b.medium++;
      else b.low++;
    }
    const carrierRisk = [
      { label: 'Low Risk', count: b.low, color: '#34d399' },
      { label: 'Medium Risk', count: b.medium, color: '#fbbf24' },
      { label: 'High Risk', count: b.high, color: '#f97316' },
      { label: 'Flagged', count: b.flagged, color: '#ef4444' },
    ];

    res.json({ heatMap, forecast, rateTrends, carrierRisk });
  } catch (err) {
    console.error('[aiRoutes] /insights error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /market-insights?lane=IL-TX&equipment=Dry Van ───────────────────────
router.get('/market-insights', auth, async (req, res) => {
  try {
    const { lane, equipment } = req.query;

    const query = {};
    if (lane) query.lane = lane.toUpperCase();
    if (equipment) query.equipmentType = equipment;

    const insights = await MarketInsight.find(query)
      .sort({ calculatedAt: -1 })
      .limit(50)
      .lean();

    res.json({ insights });
  } catch (err) {
    console.error('[aiRoutes] /market-insights error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /demand-forecast?lane=IL-TX&equipment=Dry Van ───────────────────────
router.get('/demand-forecast', auth, async (req, res) => {
  try {
    const { lane, equipment } = req.query;

    const query = {};
    if (lane) query.lane = lane.toUpperCase();
    if (equipment) query.equipmentType = equipment;

    const forecasts = await DemandForecast.find(query)
      .sort({ calculatedAt: -1 })
      .limit(50)
      .lean();

    res.json({ forecasts });
  } catch (err) {
    console.error('[aiRoutes] /demand-forecast error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /carrier-risk/:carrierId — risk score (admin or self) ───────────────
router.get('/carrier-risk/:carrierId', auth, async (req, res) => {
  try {
    const { carrierId } = req.params;

    // Only admin or the carrier themselves can view
    if (req.user.role !== 'admin' && req.user.userId !== carrierId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const carrier = await User.findById(carrierId)
      .select('name companyName riskScore riskDetails verification.status trustScore')
      .lean();

    if (!carrier) {
      return res.status(404).json({ error: 'Carrier not found' });
    }

    res.json({
      carrierId,
      name: carrier.name,
      companyName: carrier.companyName,
      riskScore: carrier.riskScore ?? null,
      riskDetails: carrier.riskDetails ?? null,
      verificationStatus: carrier.verification?.status,
      trustScore: carrier.trustScore?.score ?? null,
    });
  } catch (err) {
    console.error('[aiRoutes] /carrier-risk error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /agents/:name/toggle — enable/disable agent (admin only) ───────────
router.post('/agents/:name/toggle', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin only' });
    }

    const orchestrator = getOrchestrator();
    if (!orchestrator) {
      return res.status(503).json({ error: 'Agent system not initialized' });
    }

    const agent = orchestrator.getAgent(req.params.name);
    if (!agent) {
      return res.status(404).json({ error: `Agent "${req.params.name}" not found` });
    }

    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Body must include { enabled: true|false }' });
    }

    if (enabled && !agent.enabled) {
      agent.setEnabled(true);
      agent.start();
    } else if (!enabled && agent.enabled) {
      agent.stop();
      agent.setEnabled(false);
    }

    res.json({ success: true, agent: agent.getStatus() });
  } catch (err) {
    console.error('[aiRoutes] /agents/toggle error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /recommendations/:carrierId — personalized AI load recommendations ──
router.get('/recommendations/:carrierId', auth, async (req, res) => {
  try {
    const { carrierId } = req.params;

    // Only admin or the carrier themselves
    if (req.user.role !== 'admin' && req.user.userId !== carrierId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const matches = await findMatchesForCarrier(carrierId, limit);

    // Enrich with market insight data where available
    const enriched = [];
    for (const { load, score } of matches) {
      let marketInsight = null;
      try {
        const oState = extractStateFromAddress(load.origin);
        const dState = extractStateFromAddress(load.destination);
        if (oState && dState) {
          marketInsight = await MarketInsight.findOne({
            lane: `${oState}-${dState}`,
            equipmentType: load.equipmentType,
          })
            .sort({ calculatedAt: -1 })
            .select('heatScore trend suggestedRateMinCents suggestedRateMaxCents')
            .lean();
        }
      } catch (_) { /* non-critical */ }

      enriched.push({ load, score, marketInsight });
    }

    res.json({ recommendations: enriched });
  } catch (err) {
    console.error('[aiRoutes] /recommendations error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Helper ──────────────────────────────────────────────────────────────────

function extractStateFromAddress(address) {
  if (!address) return null;
  const parts = address.split(',');
  const last = (parts[parts.length - 1] || '').trim();
  const match = last.match(/^([A-Za-z]{2})\b/);
  return match ? match[1].toUpperCase() : null;
}

module.exports = router;
