/**
 * Shipper Analytics Routes
 *
 * GET /api/shipper/analytics          — main analytics dashboard data
 * GET /api/shipper/analytics/carriers — carriers used (for filter dropdown)
 * GET /api/shipper/analytics/routes   — distinct routes (for filter dropdown)
 */

const express = require('express');
const router = express.Router();
const Load = require('../models/Load');
const User = require('../models/User');
const auth = require('../middlewares/authMiddleware');

// Utility: week label for chart grouping
function weekOfYear(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

// ── GET /api/shipper/analytics ────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const shipperId = req.user.userId;

    // Period filter
    const { period } = req.query;
    let startDate = new Date();
    startDate.setDate(startDate.getDate() - 28); // default 4 weeks
    if (period === 'Last 3 Months') {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
    } else if (period === 'YTD') {
      startDate = new Date(new Date().getFullYear(), 0, 1);
    }

    // Fetch all loads posted by this shipper
    const allLoads = await Load.find({
      postedBy: shipperId,
      createdAt: { $gte: startDate },
    }).lean();

    // ── Core metrics ──────────────────────────────────────────────────────────
    const totalShipments = allLoads.length;
    const delivered      = allLoads.filter(l => l.status === 'delivered').length;
    const inTransit      = allLoads.filter(l => l.status === 'in-transit').length;
    const open           = allLoads.filter(l => l.status === 'open').length;
    const totalSpend     = allLoads
      .filter(l => l.status === 'delivered')
      .reduce((sum, l) => sum + (l.rate || 0), 0);

    // Unique carriers used
    const carrierIds = [
      ...new Set(
        allLoads.map(l => l.acceptedBy?.toString()).filter(Boolean)
      ),
    ];
    const totalCarriers = carrierIds.length;

    // ── Carrier usage stats ───────────────────────────────────────────────────
    const carriersUsed = await User.find({ _id: { $in: carrierIds } })
      .select('_id name companyName email')
      .lean();

    const carrierStats = carriersUsed.map(carrier => {
      const loads = allLoads.filter(
        l => l.acceptedBy?.toString() === carrier._id.toString()
      );
      return {
        carrierId:  carrier._id,
        name:       carrier.companyName || carrier.name,
        email:      carrier.email,
        shipments:  loads.length,
        totalSpend: loads
          .filter(l => l.status === 'delivered')
          .reduce((sum, l) => sum + (l.rate || 0), 0),
        onTime: loads.filter(l => l.status === 'delivered').length,
      };
    }).sort((a, b) => b.totalSpend - a.totalSpend);

    // ── Weekly chart data ─────────────────────────────────────────────────────
    const weekStats = {};
    allLoads.forEach(l => {
      const week = weekOfYear(l.createdAt || new Date());
      if (!weekStats[week]) weekStats[week] = { loads: 0, spend: 0 };
      weekStats[week].loads += 1;
      if (l.status === 'delivered') weekStats[week].spend += l.rate || 0;
    });
    const utilization = Object.entries(weekStats)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([week, d]) => ({ week, value: d.loads }));
    const spendTrend = Object.entries(weekStats)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([week, d]) => ({ week, value: d.spend }));

    // ── Spend breakdown (estimated) ───────────────────────────────────────────
    const costBreakdown = [
      { name: 'Freight',      value: Math.round(totalSpend * 0.70) },
      { name: 'Fuel Surcharge',value: Math.round(totalSpend * 0.15) },
      { name: 'Accessorials', value: Math.round(totalSpend * 0.10) },
      { name: 'Insurance',    value: Math.round(totalSpend * 0.05) },
    ];

    // ── Top routes ────────────────────────────────────────────────────────────
    const routeMap = {};
    allLoads.forEach(l => {
      const key = `${l.origin} → ${l.destination}`;
      if (!routeMap[key]) routeMap[key] = { route: key, spend: 0, loads: 0 };
      routeMap[key].spend += l.rate || 0;
      routeMap[key].loads += 1;
    });
    const topRoutes = Object.values(routeMap)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

    // ── Status pie ────────────────────────────────────────────────────────────
    const statusBreakdown = [
      { name: 'Delivered',  value: delivered },
      { name: 'In Transit', value: inTransit },
      { name: 'Open',       value: open },
    ].filter(s => s.value > 0);

    // ── Activity feed ─────────────────────────────────────────────────────────
    const activity = [...allLoads]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 7)
      .map(l => ({
        date:   new Date(l.createdAt).toISOString().slice(0, 10),
        action: `Load "${l.title}" — ${l.status}`,
      }));

    res.json({
      metrics: {
        totalShipments,
        totalCarriers,
        totalSpend,
        delivered,
        inTransit,
        open,
        avgCostPerShipment: delivered > 0
          ? Math.round(totalSpend / delivered)
          : 0,
      },
      charts: {
        utilization,
        spendTrend,
        costBreakdown,
        topRoutes,
        statusBreakdown,
        carrierStats,
      },
      activity,
    });

  } catch (err) {
    console.error('Shipper Analytics error:', err);
    res.status(500).json({ error: 'Shipper analytics error' });
  }
});

// ── GET /api/shipper/analytics/carriers ──────────────────────────────────────
router.get('/carriers', auth, async (req, res) => {
  try {
    const loads = await Load.find({ postedBy: req.user.userId })
      .select('acceptedBy')
      .lean();
    const carrierIds = [
      ...new Set(loads.map(l => l.acceptedBy?.toString()).filter(Boolean)),
    ];
    const carriers = await User.find({ _id: { $in: carrierIds } })
      .select('_id name companyName email')
      .lean();
    res.json(carriers);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching carriers' });
  }
});

// ── GET /api/shipper/analytics/routes ────────────────────────────────────────
router.get('/routes', auth, async (req, res) => {
  try {
    const loads = await Load.find({ postedBy: req.user.userId })
      .select('origin destination')
      .lean();
    const uniqueRoutes = [
      ...new Set(loads.map(l => `${l.origin} → ${l.destination}`)),
    ].map(route => ({ route }));
    res.json(uniqueRoutes);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching routes' });
  }
});

// ── GET /api/shipper/analytics/companies — shipper company info ───────────────
router.get('/companies', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('companyName companyId').lean();
    res.json([{ _id: user?.companyId, name: user?.companyName || '—' }]);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching company' });
  }
});

module.exports = router;
