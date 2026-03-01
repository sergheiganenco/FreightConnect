import React, { useEffect, useState } from "react";
import {
  Box, Grid, Card, CardContent, Typography, MenuItem, Select, Button, Stack, IconButton,
  Dialog, DialogContent, useMediaQuery, Alert
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import { LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, Legend } from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import axios from "axios";
import { gradient, surface, text as T, chart, brand, tint } from '../../theme/tokens';

const API_BASE = process.env.REACT_APP_API_URL || "";

const PIE_COLORS = chart.pie;
const CHART_COLORS = chart.line;
const PURPLE_BG = gradient.analyticsBg;
const CARD_BG = surface.cardBg;

export default function ShipperAnalytics() {
  // Filter state
  const [carrier, setCarrier] = useState("All");
  const [route, setRoute] = useState("All");
  const [company, setCompany] = useState("All");
  const [period, setPeriod] = useState("Last 4 Weeks");

  // Data
  const [metrics, setMetrics] = useState({});
  const [data, setData] = useState({
    carrierStats: [],
    utilization: [],
    revenue: [],
    costBreakdown: [],
    statusBreakdown: [],
    topRoutes: []
  });
  const [carriers, setCarriers] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [periods] = useState(["Last 4 Weeks", "Last 3 Months", "YTD"]);
  const [statusList, setStatusList] = useState(["All"]);
  const [activity, setActivity] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [smartTips, setSmartTips] = useState([]);
  const [loading, setLoading] = useState(true);

  // Responsive
  const isXs = useMediaQuery("(max-width:600px)");

  // --- Fetch options & initial data
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem("token");
        const [carrRes, rRes, compRes] = await Promise.all([
          axios.get(`${API_BASE}/shipper/analytics/carriers`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_BASE}/shipper/analytics/routes`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_BASE}/shipper/analytics/companies`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setCarriers(carrRes.data || []);
        setRoutes(rRes.data || []);
        setCompanies(compRes.data || []);
      } catch (err) {
        setCarriers([]);
        setRoutes([]);
        setCompanies([]);
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  // --- Fetch analytics with current filters
  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`${API_BASE}/shipper/analytics`, {
          params: { carrier, route, company, period },
          headers: { Authorization: `Bearer ${token}` }
        });
        const charts = res.data.charts || {};
        setMetrics(res.data.metrics || {});
        setData({
          carrierStats: charts.carrierStats || [],
          utilization: charts.utilization || [],
          revenue: charts.revenue || [],
          costBreakdown: charts.costBreakdown || [],
          statusBreakdown: charts.statusBreakdown || [],
          topRoutes: charts.topRoutes || [],
        });
        setStatusList(["All", ...(res.data.statusList || [])]);
        setActivity(res.data.activity || []);
        setAnomalies(res.data.anomalies || []);
        setSmartTips(res.data.smartTips || []);
      } catch (err) {
        setMetrics({});
        setData({
          carrierStats: [],
          utilization: [],
          revenue: [],
          costBreakdown: [],
          statusBreakdown: [],
          topRoutes: [],
        });
        setStatusList(["All"]);
        setActivity([]);
        setAnomalies([]);
        setSmartTips([]);
      }
      setLoading(false);
    };
    fetchAnalytics();
  }, [carrier, route, company, period]);

  // CSV Export
  function downloadCSV() {
    const csv = Papa.unparse(data.carrierStats || []);
    saveAs(new Blob([csv], { type: "text/csv" }), "shipper_carrier_stats.csv");
  }

  // Drilldown modal (optional, like carrier view)
  // ...left out for brevity, add if you want carrier/modal popups

  return (
    <Box
      sx={{
        minHeight: "100vh",
        py: { xs: 2, md: 4 },
        px: { xs: 1, md: 3 },
        bgcolor: PURPLE_BG,
        background: PURPLE_BG,
        position: "relative"
      }}
    >
      <Typography
        variant={isXs ? "h6" : "h4"}
        fontWeight={900}
        color={T.primary}
        sx={{ mb: 3, letterSpacing: 0.5, textShadow: "0 3px 24px #290d53a0" }}
      >
        Shipper Analytics Dashboard
      </Typography>
      {loading && <Alert severity="info" sx={{ mb: 2 }}>Loading analytics...</Alert>}

      {/* Smart Suggestions & Alerts */}
      <Stack direction="column" spacing={1} mb={2}>
        {anomalies.map((a, idx) => (
          <Alert key={idx} severity="error" sx={{ bgcolor: surface.glassSubtle, color: chart.red, fontWeight: 700 }}>
            {a}
          </Alert>
        ))}
        {smartTips.map((tip, idx) => (
          <Alert key={idx} severity="info" sx={{ bgcolor: surface.glassSubtle, color: brand.primary, fontWeight: 700 }}>
            {tip}
          </Alert>
        ))}
      </Stack>

      {/* ---- Filters ---- */}
      <Stack
        direction={isXs ? "column" : "row"}
        spacing={2}
        sx={{ mb: 3, alignItems: isXs ? "stretch" : "center" }}
      >
        <Select
          value={carrier}
          onChange={e => setCarrier(e.target.value)}
          size="small"
          sx={{
            bgcolor: brand.primary, color: T.primary, minWidth: 110,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: T.primary }
          }}
        >
         <MenuItem value="All" key="all-carriers">All Carriers</MenuItem>
          {carriers.map((c) => (
           <MenuItem key={c._id || c.name} value={c.name}>{c.name}</MenuItem>
          ))}
        </Select>
        <Select
          value={route}
          onChange={e => setRoute(e.target.value)}
          size="small"
          sx={{
            bgcolor: brand.primary, color: T.primary, minWidth: 150,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: T.primary }
          }}
        >
          <MenuItem value="All" key="all-routes">All Routes</MenuItem>
            {routes.map((r) => (
              <MenuItem key={r.route} value={r.route}>{r.route}</MenuItem>
          ))}
        </Select>
        <Select
          value={company}
          onChange={e => setCompany(e.target.value)}
          size="small"
          sx={{
            bgcolor: brand.primary, color: T.primary, minWidth: 120,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: T.primary }
          }}
        >
          <MenuItem value="All" key="all-companies">All Companies</MenuItem>
          {companies.map((c) => (
            <MenuItem key={c._id || c.name} value={c.name}>{c.name}</MenuItem>
          ))}
        </Select>
        <Select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          size="small"
          sx={{
            bgcolor: brand.primary, color: T.primary, minWidth: 150,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: T.primary }
          }}
        >
          {periods.map((p) => (
            <MenuItem key={p} value={p}>{p}</MenuItem>
          ))}
        </Select>
        <Box flex={1} />
        <Button
          onClick={downloadCSV}
          variant="outlined"
          startIcon={<DownloadIcon />}
          sx={{
            color: T.primary, borderColor: "#fff", borderRadius: 3,
            bgcolor: tint(brand.primary, 0.8), fontWeight: 700, boxShadow: 2,
            "&:hover": { bgcolor: brand.primary }
          }}
        >
          Export CSV
        </Button>
      </Stack>

      {/* --- Analytics Cards --- */}
      <Grid container spacing={2} mb={isXs ? 2 : 3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: T.primary }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Total Shipments</Typography>
              <Typography variant="h4" color={chart.green} fontWeight={900}>
                {metrics.totalShipments || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: T.primary }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Total Carriers</Typography>
              <Typography variant="h4" color={chart.blue} fontWeight={900}>
                {metrics.totalCarriers || (data.carrierStats ? data.carrierStats.length : 0)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: T.primary }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Total Spend</Typography>
              <Typography variant="h4" color={chart.gold} fontWeight={900}>
                {metrics.totalSpend ? `$${metrics.totalSpend.toLocaleString()}` : "$0"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        {/* Add more cards as needed */}
      </Grid>

      {/* --- Main Charts (example) --- */}
      <Grid container spacing={2} mb={isXs ? 2 : 3}>
        {/* Carrier Utilization */}
        <Grid item xs={12} md={6}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: T.primary, height: 300 }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1}>Carrier Utilization Over Time</Typography>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.utilization || []}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={chart.green}
                    strokeWidth={3}
                    dot={{ fill: T.primary, stroke: chart.green, r: 5 }}
                  />
                  <XAxis dataKey="week" tick={{ fill: T.primary }} />
                  <YAxis hide />
                  <RechartsTooltip />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        {/* Spend Breakdown Pie */}
        <Grid item xs={12} md={6}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: T.primary, height: 300 }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1}>Spend Breakdown</Typography>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={data.costBreakdown || []}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    label={({ name }) => name}
                  >
                    {(data.costBreakdown || []).map((entry, idx) => (
                      <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={20} />
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* --- Carrier Stats Table/List Example --- */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" color={T.primary} fontWeight={800} mb={1}>
          Carriers Used
        </Typography>
        <Grid container spacing={2}>
          {(data.carrierStats || []).map((carrier, idx) => (
            <Grid item xs={12} md={6} key={carrier.name || idx}>
              <Card sx={{ bgcolor: CARD_BG, color: T.primary }}>
                <CardContent>
                  <Typography fontWeight={700} fontSize="1.12em">{carrier.name}</Typography>
                  <Typography fontSize="0.95em">Shipments: {carrier.shipments || 0}</Typography>
                  <Typography fontSize="0.95em">Total Spend: ${Number(carrier.totalSpend).toLocaleString()}</Typography>
                  {/* Add more stats if you want */}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* --- Activity log (optional) --- */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" color={T.primary} fontWeight={800} mb={1}>
          Recent Activity
        </Typography>
        {activity.map((act, idx) => (
          <Box key={idx} mb={1.1}>
            <Typography component="span" fontWeight={800} color={T.primary} fontSize="0.97em">{act.date}</Typography>
            <Typography component="span" fontWeight={600} color={T.chartLabel} fontSize="0.97em" ml={1}>{act.action}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
