/**
 * Carrier Analytics Routes
 *
 * GET /api/carrier/analytics        — main analytics dashboard data
 * GET /api/carrier/analytics/routes — distinct routes for filter dropdown
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

// ── GET /api/carrier/analytics ────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const carrierId = req.user.userId;

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

    // Fetch this carrier's loads (accepted by them)
    const allLoads = await Load.find({
      acceptedBy: carrierId,
      createdAt: { $gte: startDate },
    }).lean();

    // Fetch carrier user for fleet info
    const carrierUser = await User.findById(carrierId).select('fleet companyName name').lean();
    const fleet = carrierUser?.fleet || [];

    // ── Core metrics ──────────────────────────────────────────────────────────
    const delivered  = allLoads.filter(l => l.status === 'delivered').length;
    const inTransit  = allLoads.filter(l => l.status === 'in-transit').length;
    const open       = allLoads.filter(l => l.status === 'open' || l.status === 'accepted').length;
    const totalRevenue = allLoads
      .filter(l => l.status === 'delivered')
      .reduce((sum, l) => sum + (l.rate || 0), 0);

    // ── Weekly chart data ─────────────────────────────────────────────────────
    const weekStats = {};
    allLoads.forEach(l => {
      const week = weekOfYear(l.createdAt || new Date());
      if (!weekStats[week]) weekStats[week] = { loads: 0, revenue: 0 };
      weekStats[week].loads += 1;
      if (l.status === 'delivered') weekStats[week].revenue += l.rate || 0;
    });
    const utilization = Object.entries(weekStats)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([week, d]) => ({ week, value: d.loads }));
    const revenue = Object.entries(weekStats)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([week, d]) => ({ week, value: d.revenue }));

    // ── Cost breakdown (estimated from revenue) ───────────────────────────────
    const costBreakdown = [
      { name: 'Fuel',        value: Math.round(totalRevenue * 0.35) },
      { name: 'Maintenance', value: Math.round(totalRevenue * 0.18) },
      { name: 'Insurance',   value: Math.round(totalRevenue * 0.12) },
      { name: 'Payroll',     value: Math.round(totalRevenue * 0.25) },
      { name: 'Tolls',       value: Math.round(totalRevenue * 0.10) },
    ];

    // ── Top revenue routes ────────────────────────────────────────────────────
    const routeMap = {};
    allLoads.forEach(l => {
      const key = `${l.origin} → ${l.destination}`;
      if (!routeMap[key]) routeMap[key] = { route: key, revenue: 0, loads: 0 };
      routeMap[key].revenue += l.rate || 0;
      routeMap[key].loads   += 1;
    });
    const topRoutes = Object.values(routeMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(r => ({ ...r, profit: Math.round(r.revenue * 0.25) }));

    // ── Status pie ────────────────────────────────────────────────────────────
    const statusBreakdown = [
      { name: 'Delivered',  value: delivered },
      { name: 'In Transit', value: inTransit },
      { name: 'Active',     value: open },
    ].filter(s => s.value > 0);

    // ── Fleet / truck stats from embedded fleet ───────────────────────────────
    const truckStats = fleet.map(t => {
      // Count loads assigned to this truck
      const truckLoads = allLoads.filter(l => l.assignedTruckId === t.truckId);
      const truckRevenue = truckLoads
        .filter(l => l.status === 'delivered')
        .reduce((sum, l) => sum + (l.rate || 0), 0);
      return {
        name:        t.truckId,
        driver:      t.driverName || '—',
        status:      t.status,
        loadsCount:  truckLoads.length,
        revenue:     truckRevenue,
        utilization: fleet.length > 0
          ? parseFloat((truckLoads.length / Math.max(allLoads.length, 1)).toFixed(2))
          : 0,
      };
    });

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
        totalLoads:   allLoads.length,
        delivered,
        inTransit,
        open,
        totalRevenue,
        fleetSize:    fleet.length,
        activeTrips:  inTransit,
        avgRevenuePerLoad: allLoads.length
          ? Math.round(totalRevenue / Math.max(delivered, 1))
          : 0,
      },
      charts: {
        utilization,
        revenue,
        costBreakdown,
        topRoutes,
        statusBreakdown,
        truckStats,
      },
      activity,
    });

  } catch (err) {
    console.error('Carrier Analytics error:', err);
    res.status(500).json({ error: 'Carrier analytics error' });
  }
});

// ── GET /api/carrier/analytics/trucks — fleet list for filter dropdown ────────
router.get('/trucks', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('fleet').lean();
    res.json((user?.fleet || []).map(t => ({
      _id:        t.truckId,
      name:       t.truckId,
      driverName: t.driverName || '—',
      status:     t.status,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Error fetching trucks' });
  }
});

// ── GET /api/carrier/analytics/routes — filter dropdown ──────────────────────
router.get('/routes', auth, async (req, res) => {
  try {
    const loads = await Load.find({ acceptedBy: req.user.userId })
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

// ── GET /api/carrier/analytics/companies — company info for filter ────────────
router.get('/companies', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('companyName companyId').lean();
    res.json([{ _id: user?.companyId, name: user?.companyName || '—' }]);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching company' });
  }
});

module.exports = router;
