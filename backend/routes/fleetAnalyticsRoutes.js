const express = require('express');
const router = express.Router();
const Load = require('../models/Load');
const Truck = require('../models/Truck');     // You must have a Truck model!
const User = require('../models/User');
const Company = require('../models/Company'); // You must have a Company model!
const dayjs = require('dayjs');

// --- Utility to format week number ---
function weekOfYear(date) {
  const firstDay = dayjs(date).startOf('year');
  const week = Math.ceil(dayjs(date).diff(firstDay, 'day') / 7) + 1;
  return `${dayjs(date).year()}-W${week}`;
}

// --- Main Analytics Route ---
router.get('/', async (req, res) => {
  try {
    // --- Filters from query ---
    const { status, truck, route, company, period } = req.query;

    // --- Time Period Filter ---
    let startDate = dayjs().subtract(4, 'week').startOf('day'); // Default: last 4 weeks
    if (period === 'Last 3 Months') startDate = dayjs().subtract(3, 'month').startOf('day');
    if (period === 'YTD') startDate = dayjs().startOf('year');

    // --- Load Filters ---
    let loadFilter = { createdAt: { $gte: startDate.toDate() } };
    if (status && status !== 'All') loadFilter.status = status;
    // (For real: filter by truck, company, route...)

    // --- Aggregations ---
    const allLoads = await Load.find(loadFilter).lean();
    const allTrucks = await Truck.find().lean();
    const allCompanies = await Company.find().lean();

    // --- Metrics ---
    const delivered = allLoads.filter(l => l.status === "delivered").length;
    const inTransit = allLoads.filter(l => l.status === "in-transit").length;
    const open = allLoads.filter(l => l.status === "open").length;
    const totalRevenue = allLoads.filter(l => l.status === "delivered").reduce((sum, l) => sum + (l.rate || 0), 0);

    // --- Utilization & Revenue Chart (per week) ---
    let weekStats = {};
    allLoads.forEach(l => {
      const week = weekOfYear(l.createdAt || l.updatedAt || new Date());
      if (!weekStats[week]) weekStats[week] = { loads: 0, revenue: 0 };
      weekStats[week].loads += 1;
      if (l.status === "delivered") weekStats[week].revenue += l.rate || 0;
    });
    const utilization = Object.entries(weekStats).map(([week, d]) => ({ week, value: d.loads }));
    const revenue = Object.entries(weekStats).map(([week, d]) => ({ week, value: d.revenue }));

    // --- Cost Breakdown (dummy data for demo) ---
    const costBreakdown = [
      { name: "Fuel", value: Math.round(totalRevenue * 0.35) },
      { name: "Maintenance", value: Math.round(totalRevenue * 0.18) },
      { name: "Insurance", value: Math.round(totalRevenue * 0.12) },
      { name: "Payroll", value: Math.round(totalRevenue * 0.25) },
      { name: "Tolls", value: Math.round(totalRevenue * 0.10) }
    ];

    // --- Top Revenue Routes (dummy) ---
    const routeRevenueMap = {};
    allLoads.forEach(l => {
      const r = `${l.origin} → ${l.destination}`;
      if (!routeRevenueMap[r]) routeRevenueMap[r] = { route: r, revenue: 0, loads: 0, profit: 0 };
      routeRevenueMap[r].revenue += l.rate || 0;
      routeRevenueMap[r].loads += 1;
      routeRevenueMap[r].profit += (l.rate || 0) * 0.25; // Dummy profit
    });
    const topRoutes = Object.values(routeRevenueMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // --- Status Breakdown Pie ---
    const statuses = ["delivered", "in-transit", "open"];
    const statusBreakdown = statuses.map(s => ({
      name: s.charAt(0).toUpperCase() + s.slice(1),
      value: allLoads.filter(l => l.status === s).length
    }));

    // --- Truck Stats (dummy) ---
    const truckStats = allTrucks.map(t => ({
      name: t.name || t._id,
      company: t.company || "-",
      driver: t.driverName || "-",
      utilization: Math.random(), // Dummy random value
      miles: 1000 + Math.floor(Math.random() * 5000),
      deadhead: 100 + Math.floor(Math.random() * 800),
      profit: 3000 + Math.floor(Math.random() * 5000),
      lastMaint: dayjs().subtract(Math.floor(Math.random() * 60), 'days').format("YYYY-MM-DD"),
      issues: Math.floor(Math.random() * 2)
    }));

    // --- Status list for filter ---
    const statusList = ["Delivered", "Open", "In-Transit"];

    // --- Activity log (dummy) ---
    const activity = allLoads.slice(0, 7).map(l => ({
      date: dayjs(l.createdAt).format("YYYY-MM-DD"),
      action: `Load ${l.title} (${l.status})`
    }));

    // --- Company Stats (dummy drilldown) ---
    const companyStats = allCompanies.map(c => ({
      name: c.name,
      truckCount: (allTrucks.filter(t => String(t.company) === String(c._id))).length,
      revenue: Math.round(Math.random() * 500000),
      loads: Math.floor(Math.random() * 80)
    }));

    // --- Smart Suggestions & Anomalies (dummy) ---
    const anomalies = [
      "Unusually high deadhead miles on Truck #41 last week.",
      "3 loads were late due to weather in Texas corridor."
    ];
    const smartTips = [
      "Try assigning more loads near Dallas for higher utilization.",
      "Reefer fleet: Schedule preventative maintenance before July."
    ];

    // --- Return final analytics object ---
    res.json({
      metrics: {
        totalLoads: allLoads.length,
        delivered,
        inTransit,
        open,
        totalRevenue,
        utilization: allTrucks.length ? delivered / allTrucks.length : 0,
        deadhead: truckStats.reduce((sum, t) => sum + t.deadhead, 0),
        avgLoads: allTrucks.length ? (allLoads.length / allTrucks.length).toFixed(1) : 0,
        profit: truckStats.reduce((sum, t) => sum + t.profit, 0),
      },
      charts: {
        utilization,
        revenue,
        costBreakdown,
        topRoutes,
        statusBreakdown,
        truckStats,
        companyStats,
      },
      statusList,
      activity,
      anomalies,
      smartTips
    });

  } catch (err) {
    console.error("Fleet Analytics error:", err);
    res.status(500).json({ error: "Fleet analytics error" });
  }
});

module.exports = router;
