// CarrierAnalytics.js

import React, { useEffect, useState } from "react";
import {
  Box, Grid, Card, CardContent, Typography, MenuItem, Select, Button, Stack,
  IconButton, Dialog, DialogTitle, DialogContent, useMediaQuery, Alert
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, Legend } from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import axios from "axios";
import { PDFDownloadLink, Document, Page, Text, StyleSheet } from "@react-pdf/renderer";

// COLORS
const PURPLE_BG = "linear-gradient(135deg, #48228b 0%, #8e42ec 60%, #f357a8 100%)";
const CARD_BG = "rgba(35,13,71,0.91)";
const PIE_COLORS = ["#3EC17C", "#4D96FF", "#FFD86B", "#EB4D4B", "#ad88f8"];
const CHART_COLORS = ["#a082e0", "#3ec17c", "#ffd86b", "#EB4D4B", "#ad88f8"];
const TEXT_MAIN = "#eaeaf6";
const TEXT_SUB = "#c5b4fa";
const BORDER_COLOR = "#ffffff20";

// PDF Styles
const styles = StyleSheet.create({
  page: { padding: 30 },
  section: { marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "bold", color: "#722ed1", marginBottom: 10 },
  label: { fontWeight: "bold", fontSize: 13, color: "#3a2fa4" },
  value: { fontSize: 12, marginBottom: 6 }
});
function CarrierPDF({ rows }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Carrier Analytics Export</Text>
        {rows.map((row, idx) => (
          <React.Fragment key={idx}>
            {Object.entries(row).map(([k, v]) => (
              <Text key={k}><Text style={styles.label}>{k}:</Text> <Text style={styles.value}>{v}</Text></Text>
            ))}
            <Text style={{ marginVertical: 3 }}>-----</Text>
          </React.Fragment>
        ))}
      </Page>
    </Document>
  );
}

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000/api";

export default function CarrierAnalytics() {
  // Filters
  const [status, setStatus] = useState("All");
  const [truck, setTruck] = useState("All");
  const [route, setRoute] = useState("All");
  const [company, setCompany] = useState("All");
  const [period, setPeriod] = useState("Last 4 Weeks");

  // Data
  const [metrics, setMetrics] = useState({});
  const [data, setData] = useState({});
  const [trucks, setTrucks] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [statusList, setStatusList] = useState(["All"]);
  const [periods] = useState(["Last 4 Weeks", "Last 3 Months", "YTD"]);
  const [activity, setActivity] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [smartTips, setSmartTips] = useState([]);
  const [modal, setModal] = useState({ open: false, type: "", data: null });

  const isXs = useMediaQuery("(max-width:600px)");

  // Fetch filter options
  useEffect(() => {
    async function fetchAll() {
      const token = localStorage.getItem('token');
      try {
        const [tRes, rRes, cRes] = await Promise.all([
          axios.get(`${API_BASE}/carrier/analytics/trucks`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_BASE}/carrier/analytics/routes`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${API_BASE}/carrier/analytics/companies`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setTrucks(tRes.data); setRoutes(rRes.data); setCompanies(cRes.data);
      } catch (err) {
        setTrucks([]); setRoutes([]); setCompanies([]);
      }
    }
    fetchAll();
  }, []);

  // Fetch analytics
  useEffect(() => {
    async function fetchAnalytics() {
      const token = localStorage.getItem('token');
      try {
        const res = await axios.get(`${API_BASE}/carrier/analytics`, {
          params: { status, truck, route, company, period },
          headers: { Authorization: `Bearer ${token}` }
        });
        setMetrics(res.data.metrics || {});
        setData(res.data.charts || {});
        setStatusList(["All", ...(res.data.statusList || [])]);
        setActivity(res.data.activity || []);
        setAnomalies(res.data.anomalies || []);
        setSmartTips(res.data.smartTips || []);
      } catch {
        setMetrics({});
        setData({});
        setActivity([]);
        setAnomalies([]);
        setSmartTips([]);
      }
    }
    fetchAnalytics();
  }, [status, truck, route, company, period]);

  // CSV/PDF Export
  const exportRows = (data.truckStats || []).map(t => ({
    Truck: t.name, Company: t.company, Driver: t.driver,
    Utilization: t.utilization, Miles: t.miles, Deadhead: t.deadhead,
    Profit: t.profit, LastMaintenance: t.lastMaint
  }));
  function downloadCSV() {
    const csv = Papa.unparse(exportRows);
    saveAs(new Blob([csv], { type: "text/csv" }), "carrier_analytics.csv");
  }
  function PDFExportButton() {
    return (
      <PDFDownloadLink
        document={<CarrierPDF rows={exportRows} />}
        fileName="carrier_analytics.pdf"
        style={{ textDecoration: "none", marginLeft: 12 }}
      >
        {({ loading }) => (
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<DownloadIcon />}
            sx={{
              ml: 1, borderColor: "#fff", color: "#fff", borderRadius: 3,
              fontWeight: 700, bgcolor: "#431882cc", boxShadow: 2,
              "&:hover": { bgcolor: "#32106b" }
            }}
            disabled={loading}
          >
            {loading ? "Preparing PDF..." : "Export PDF"}
          </Button>
        )}
      </PDFDownloadLink>
    );
  }

  // Modal
  function renderModal() {
    if (!modal.open || !modal.data) return null;
    if (modal.type === "truck") {
      const t = modal.data;
      return (
        <Dialog open onClose={() => setModal({ open: false })}>
          <DialogTitle>Truck: {t.name} (Driver: {t.driver})</DialogTitle>
          <DialogContent>
            <Box p={2}>
              <Typography><b>Utilization:</b> {(t.utilization * 100).toFixed(1)}%</Typography>
              <Typography><b>Miles driven:</b> {t.miles}</Typography>
              <Typography><b>Deadhead miles:</b> {t.deadhead}</Typography>
              <Typography><b>Profit:</b> ${t.profit}</Typography>
              <Typography><b>Last maintenance:</b> {t.lastMaint}</Typography>
              <Typography><b>Issues:</b> {t.issues > 0 ? <span style={{ color: "#EB4D4B" }}>{t.issues}</span> : "None"}</Typography>
            </Box>
          </DialogContent>
        </Dialog>
      );
    }
    if (modal.type === "route") {
      const r = modal.data;
      return (
        <Dialog open onClose={() => setModal({ open: false })}>
          <DialogTitle>Route: {r.route}</DialogTitle>
          <DialogContent>
            <Box p={2}>
              <Typography><b>Revenue:</b> ${r.revenue}</Typography>
              <Typography><b>Loads:</b> {r.loads}</Typography>
              <Typography><b>Profit:</b> ${r.profit}</Typography>
            </Box>
          </DialogContent>
        </Dialog>
      );
    }
    if (modal.type === "company") {
      const c = modal.data;
      return (
        <Dialog open onClose={() => setModal({ open: false })}>
          <DialogTitle>Company: {c.name}</DialogTitle>
          <DialogContent>
            <Box p={2}>
              <Typography><b>Trucks:</b> {c.truckCount}</Typography>
              <Typography><b>Total Revenue:</b> ${c.revenue}</Typography>
              <Typography><b>Loads:</b> {c.loads}</Typography>
            </Box>
          </DialogContent>
        </Dialog>
      );
    }
    return null;
  }

  // Main Render
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
        color={TEXT_MAIN}
        sx={{ mb: 3, letterSpacing: 0.5, textShadow: "0 3px 24px #290d53a0" }}
      >
        Carrier & Operations Analytics
      </Typography>

      {/* Alerts: Glass look */}
      <Stack direction="column" spacing={1} mb={2}>
        {anomalies.map((a, idx) => (
          <Alert
            key={idx}
            severity="error"
            sx={{
              bgcolor: "rgba(235,77,75,0.10)",
              color: "#EB4D4B",
              border: `1.5px solid ${BORDER_COLOR}`,
              borderRadius: 4,
              fontWeight: 700,
              backdropFilter: "blur(8px)"
            }}
            icon={<ErrorOutlineIcon sx={{ color: "#EB4D4B" }} />}
          >
            {a}
          </Alert>
        ))}
        {smartTips.map((tip, idx) => (
          <Alert
            key={idx}
            severity="info"
            sx={{
              bgcolor: "rgba(82,50,211,0.08)",
              color: "#7b2ff2",
              border: `1.5px solid ${BORDER_COLOR}`,
              borderRadius: 4,
              fontWeight: 700,
              backdropFilter: "blur(8px)"
            }}
            icon={<LightbulbOutlinedIcon sx={{ color: "#7b2ff2" }} />}
          >
            {tip}
          </Alert>
        ))}
      </Stack>

      {/* Filters */}
      <Stack
        direction={isXs ? "column" : "row"}
        spacing={2}
        sx={{ mb: 3, alignItems: isXs ? "stretch" : "center" }}
      >
        <Select value={status} onChange={e => setStatus(e.target.value)} size="small"
          sx={{
            bgcolor: "#8e42ec", color: "#fff", minWidth: 110,
            borderRadius: 3, fontWeight: 700, "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          {statusList.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </Select>
        <Select value={truck} onChange={e => setTruck(e.target.value)} size="small"
          sx={{
            bgcolor: "#8e42ec", color: "#fff", minWidth: 110,
            borderRadius: 3, fontWeight: 700, "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          <MenuItem value="All">All Trucks</MenuItem>
          {trucks.map((t) => <MenuItem key={t.id || t._id} value={t.name}>{t.name}</MenuItem>)}
        </Select>
        <Select value={route} onChange={e => setRoute(e.target.value)} size="small"
          sx={{
            bgcolor: "#8e42ec", color: "#fff", minWidth: 150,
            borderRadius: 3, fontWeight: 700, "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          <MenuItem value="All">All Routes</MenuItem>
          {routes.map((r) => <MenuItem key={r.id || r.route} value={r.route}>{r.route}</MenuItem>)}
        </Select>
        <Select value={company} onChange={e => setCompany(e.target.value)} size="small"
          sx={{
            bgcolor: "#8e42ec", color: "#fff", minWidth: 120,
            borderRadius: 3, fontWeight: 700, "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          <MenuItem value="All">All Companies</MenuItem>
          {companies.map((c) => <MenuItem key={c.id || c._id} value={c.name}>{c.name}</MenuItem>)}
        </Select>
        <Select value={period} onChange={e => setPeriod(e.target.value)} size="small"
          sx={{
            bgcolor: "#8e42ec", color: "#fff", minWidth: 150,
            borderRadius: 3, fontWeight: 700, "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          {periods.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
        </Select>
        <Box flex={1} />
        <Button
          onClick={downloadCSV}
          variant="outlined"
          startIcon={<DownloadIcon />}
          sx={{
            color: "#fff", borderColor: "#fff", borderRadius: 3,
            bgcolor: "#6825b2cc", fontWeight: 700, boxShadow: 2,
            "&:hover": { bgcolor: "#431882" }
          }}
        >
          Export CSV
        </Button>
        <PDFExportButton />
      </Stack>

      {/* Metrics & Charts */}
      <Grid container spacing={2} mb={isXs ? 2 : 3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{
            bgcolor: CARD_BG, borderRadius: 4, boxShadow: 7, color: TEXT_MAIN,
            border: `1.5px solid ${BORDER_COLOR}`, transition: "box-shadow 0.2s"
          }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.11em" color="#ffd86b" mb={1}>Utilization Rate</Typography>
              <Typography variant="h4" color="#3EC17C" fontWeight={900}>
                {metrics.utilization ? (metrics.utilization * 100).toFixed(0) + "%" : "-"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 7, color: TEXT_MAIN, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.11em" color="#ffd86b" mb={1}>Deadhead Miles</Typography>
              <Typography variant="h4" color="#ffaf75" fontWeight={900}>
                {metrics.deadhead ? metrics.deadhead.toLocaleString() : "-"}
                <Typography component="span" fontSize="0.6em" color="#ffaf75" fontWeight={700}> mi</Typography>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 7, color: TEXT_MAIN, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.11em" color="#ffd86b" mb={1}>Avg Loads/Truck</Typography>
              <Typography variant="h4" color="#4D96FF" fontWeight={900}>
                {metrics.avgLoads ? metrics.avgLoads : "-"}
                <Typography component="span" fontSize="0.6em" color="#4D96FF" fontWeight={700}>/wk</Typography>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 7, color: TEXT_MAIN, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.11em" color="#ffd86b" mb={1}>Profit/Load</Typography>
              <Typography variant="h4" color="#ad88f8" fontWeight={900}>
                {metrics.profit ? `$${metrics.profit}` : "-"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Charts & Insights */}
      <Grid container spacing={2} mb={isXs ? 2 : 3}>
        {/* Utilization Line Chart */}
        <Grid item xs={12} md={4}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 240, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.13em" mb={1} color="#3EC17C">Carrier Utilization</Typography>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data.utilization || []}>
                  <Line type="monotone" dataKey="value" stroke="#3EC17C" strokeWidth={3}
                    dot={{ fill: "#fff", stroke: "#3EC17C", r: 5 }} />
                  <XAxis dataKey="week" tick={{ fill: "#eaeaf6" }} />
                  <YAxis hide />
                  <RechartsTooltip />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        {/* Revenue Line Chart */}
        <Grid item xs={12} md={4}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 240, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.13em" mb={1} color="#ffd86b">Revenue Trend</Typography>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data.revenue || []}>
                  <Line type="monotone" dataKey="value" stroke="#ffd86b" strokeWidth={3}
                    dot={{ fill: "#fff", stroke: "#ffd86b", r: 5 }} />
                  <XAxis dataKey="week" tick={{ fill: "#eaeaf6" }} />
                  <YAxis hide />
                  <RechartsTooltip />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        {/* Cost Pie */}
        <Grid item xs={12} md={4}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 240, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={700} fontSize="1.13em" mb={1} color="#96ffed">Cost Breakdown</Typography>
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie
                    data={data.costBreakdown || []}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={32}
                    outerRadius={50}
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

      {/* Drill-down, Top Routes, Load Status, Activity */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <Card sx={{
            bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 220, border: `1.5px solid ${BORDER_COLOR}`, cursor: "pointer", transition: "box-shadow 0.2s", "&:hover": { boxShadow: 10, bgcolor: "#4a19d4" }
          }}
            onClick={() => setModal({ open: true, type: "route", data: data.topRoutes?.[0] })}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1} color="#ffd86b">
                Top Revenue Route
              </Typography>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart
                  layout="vertical"
                  data={data.topRoutes || []}
                  margin={{ left: 15 }}
                  barCategoryGap={8}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="route" tick={{ fill: "#eaeaf6" }} />
                  <Bar dataKey="revenue">
                    {(data.topRoutes || []).map((entry, idx) => (
                      <Cell key={entry.route} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                  <RechartsTooltip />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 220, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1} color="#a8d2ff">
                Load Status
              </Typography>
              <ResponsiveContainer width="100%" height={100}>
                <PieChart>
                  <Pie
                    data={data.statusBreakdown || []}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={50}
                    label={({ name }) => name}
                  >
                    {(data.statusBreakdown || []).map((entry, idx) => (
                      <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={20} />
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        {/* Drill-down (Best truck) */}
        <Grid item xs={12} md={3}>
          <Card sx={{
            bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 220, border: `1.5px solid ${BORDER_COLOR}`,
            cursor: "pointer", "&:hover": { boxShadow: 12, bgcolor: "#4d1c8dcc" }
          }}
            onClick={() => setModal({ open: true, type: "truck", data: data.truckStats?.[0] })}
          >
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1} color="#ffaf75">
                Best Performer: {data.truckStats?.[0]?.name}
                <IconButton size="small" sx={{ color: "#fff" }}>
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Typography>
              <Typography fontSize="1em" fontWeight={600} mb={1}>
                Utilization: {data.truckStats?.[0]?.utilization ? (data.truckStats[0].utilization * 100).toFixed(1) + "%" : "-"}
              </Typography>
              <Typography fontSize="0.98em" mb={0.5}>
                Profit: <b>${data.truckStats?.[0]?.profit?.toLocaleString() || "-"}</b>
              </Typography>
              <Typography fontSize="0.98em" color="#3EC17C">
                Miles: {data.truckStats?.[0]?.miles}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        {/* Recent Activity */}
        <Grid item xs={12} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: TEXT_MAIN, height: 220, border: `1.5px solid ${BORDER_COLOR}` }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1}>
                Recent Activity
              </Typography>
              {(activity || []).map((act, idx) => (
                <Box key={idx} mb={1.1}>
                  <Typography component="span" fontWeight={800} color={TEXT_MAIN} fontSize="0.97em">{act.date}</Typography>
                  <Typography component="span" fontWeight={600} color={TEXT_SUB} fontSize="0.97em" ml={1}>{act.action}</Typography>
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {renderModal()}
    </Box>
  );
}
