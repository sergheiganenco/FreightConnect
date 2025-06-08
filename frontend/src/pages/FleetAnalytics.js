import React, { useEffect, useState } from "react";
import {
  Box, Grid, Card, CardContent, Typography, MenuItem, Select, Button, Stack, IconButton,
  Dialog, DialogTitle, DialogContent, Divider, useMediaQuery, Tooltip, Alert
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis, Legend } from "recharts";
import Papa from "papaparse";
import { saveAs } from "file-saver";
import axios from "axios";
import { PDFDownloadLink, Document, Page, Text, StyleSheet } from "@react-pdf/renderer";

// Theme & colors
const PURPLE_BG = "linear-gradient(135deg, #3a2fa4 0%, #7b2ff2 60%, #f357a8 100%)";
const CARD_BG = "#2c1363cc";
const PIE_COLORS = ["#3EC17C", "#4D96FF", "#FFC107", "#EB4D4B", "#ad88f8"];
const CHART_COLORS = ["#a082e0", "#3ec17c", "#ffc107", "#EB4D4B", "#ad88f8"];

// --- PDF Exporter ---
const styles = StyleSheet.create({
  page: { padding: 30 },
  section: { marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "bold", color: "#722ed1", marginBottom: 10 },
  label: { fontWeight: "bold", fontSize: 13, color: "#3a2fa4" },
  value: { fontSize: 12, marginBottom: 6 }
});
function FleetPDF({ rows }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Fleet Analytics Export</Text>
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

// --- Main Component ---
export default function FleetAnalytics() {
  // Filter state
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
  const [periods, setPeriods] = useState(["Last 4 Weeks", "Last 3 Months", "YTD"]);
  const [activity, setActivity] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [smartTips, setSmartTips] = useState([]);

  // Drill-down modal
  const [modal, setModal] = useState({ open: false, type: "", data: null });

  // Responsive
  const isMobile = useMediaQuery("(max-width:900px)");

  // --- Fetch options & initial data
  useEffect(() => {
    async function fetchAll() {
      // Fetch options (trucks, routes, etc.)
      const [tRes, rRes, cRes] = await Promise.all([
        axios.get("/api/trucks"),
        axios.get("/api/routes"),
        axios.get("/api/companies"),
      ]);
      setTrucks(tRes.data); setRoutes(rRes.data); setCompanies(cRes.data);
    }
    fetchAll();
  }, []);

  // --- Fetch analytics with current filters
  useEffect(() => {
    async function fetchAnalytics() {
      const res = await axios.get("/api/fleet/analytics", {
        params: { status, truck, route, company, period }
      });
      setMetrics(res.data.metrics);
      setData(res.data.charts);
      setStatusList(["All", ...res.data.statusList || []]);
      setActivity(res.data.activity || []);
      setAnomalies(res.data.anomalies || []);
      setSmartTips(res.data.smartTips || []);
    }
    fetchAnalytics();
  }, [status, truck, route, company, period]);

  // --- Export: Compose CSV rows
  const exportRows = (data.truckStats || []).map(t => ({
    Truck: t.name, Company: t.company, Driver: t.driver,
    Utilization: t.utilization, Miles: t.miles, Deadhead: t.deadhead,
    Profit: t.profit, LastMaintenance: t.lastMaint
  }));

  // --- CSV Export
  function downloadCSV() {
    const csv = Papa.unparse(exportRows);
    saveAs(new Blob([csv], { type: "text/csv" }), "fleet_analytics.csv");
  }

  // --- PDF Export
  function PDFExportButton() {
    return (
      <PDFDownloadLink
        document={<FleetPDF rows={exportRows} />}
        fileName="fleet_analytics.pdf"
        style={{
          textDecoration: "none",
          marginLeft: 12
        }}
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

  // --- Drilldown content
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
              {/* Add more as needed */}
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
              {/* Add more as needed */}
            </Box>
          </DialogContent>
        </Dialog>
      );
    }
    return null;
  }

  // --- Responsive layout
  const isXs = useMediaQuery("(max-width:600px)");

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
        color="#fff"
        sx={{ mb: 3, letterSpacing: 0.5, textShadow: "0 3px 24px #290d53a0" }}
      >
        Fleet & Operations Analytics
      </Typography>

      {/* ---- Smart Suggestions & Anomaly Alerts ---- */}
      <Stack direction="column" spacing={1} mb={2}>
        {anomalies.map((a, idx) => (
          <Alert key={idx} severity="error" sx={{ bgcolor: "#fff2", color: "#EB4D4B", fontWeight: 700 }}>
            {a}
          </Alert>
        ))}
        {smartTips.map((tip, idx) => (
          <Alert key={idx} severity="info" sx={{ bgcolor: "#fff2", color: "#7b2ff2", fontWeight: 700 }}>
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
          value={status}
          onChange={e => setStatus(e.target.value)}
          size="small"
          sx={{
            bgcolor: "#7b2ff2", color: "#fff", minWidth: 110,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          {statusList.map((s) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </Select>
        <Select
          value={truck}
          onChange={e => setTruck(e.target.value)}
          size="small"
          sx={{
            bgcolor: "#7b2ff2", color: "#fff", minWidth: 110,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          <MenuItem value="All">All Trucks</MenuItem>
          {trucks.map((t) => (
            <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>
          ))}
        </Select>
        <Select
          value={route}
          onChange={e => setRoute(e.target.value)}
          size="small"
          sx={{
            bgcolor: "#7b2ff2", color: "#fff", minWidth: 150,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          <MenuItem value="All">All Routes</MenuItem>
          {routes.map((r) => (
            <MenuItem key={r.id} value={r.route}>{r.route}</MenuItem>
          ))}
        </Select>
        <Select
          value={company}
          onChange={e => setCompany(e.target.value)}
          size="small"
          sx={{
            bgcolor: "#7b2ff2", color: "#fff", minWidth: 120,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: "#fff" }
          }}
        >
          <MenuItem value="All">All Companies</MenuItem>
          {companies.map((c) => (
            <MenuItem key={c.id} value={c.name}>{c.name}</MenuItem>
          ))}
        </Select>
        <Select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          size="small"
          sx={{
            bgcolor: "#7b2ff2", color: "#fff", minWidth: 150,
            borderRadius: 2, boxShadow: 1, fontWeight: 700,
            "& .MuiSelect-icon": { color: "#fff" }
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
            color: "#fff", borderColor: "#fff", borderRadius: 3,
            bgcolor: "#6225b2cc", fontWeight: 700, boxShadow: 2,
            "&:hover": { bgcolor: "#431882" }
          }}
        >
          Export CSV
        </Button>
        <PDFExportButton />
      </Stack>

      {/* ---- Admin Smart Cards ---- */}
      <Grid container spacing={2} mb={isXs ? 2 : 3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff" }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Utilization Rate</Typography>
              <Typography variant="h4" color="#3EC17C" fontWeight={900}>
                {metrics.utilization ? (metrics.utilization * 100).toFixed(0) + "%" : "-"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff" }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Deadhead Miles</Typography>
              <Typography variant="h4" color="#ffaf75" fontWeight={900}>
                {metrics.deadhead ? metrics.deadhead.toLocaleString() : "-"}
                <Typography component="span" fontSize="0.6em" color="#ffaf75" fontWeight={700}> mi</Typography>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff" }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Avg Loads/Truck</Typography>
              <Typography variant="h4" color="#4D96FF" fontWeight={900}>
                {metrics.avgLoads ? metrics.avgLoads : "-"}
                <Typography component="span" fontSize="0.6em" color="#4D96FF" fontWeight={700}>/wk</Typography>
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff" }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.11em" mb={1}>Profit/Load</Typography>
              <Typography variant="h4" color="#ad88f8" fontWeight={900}>
                {metrics.profit ? `$${metrics.profit}` : "-"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* ---- Main Charts & Insights ---- */}
      <Grid container spacing={2} mb={isXs ? 2 : 3}>
        {/* Utilization Line Chart */}
        <Grid item xs={12} md={4}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 240 }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1}>Fleet Utilization</Typography>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data.utilization || []}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3EC17C"
                    strokeWidth={3}
                    dot={{ fill: "#fff", stroke: "#3EC17C", r: 5 }}
                  />
                  <XAxis dataKey="week" tick={{ fill: "#fff" }} />
                  <YAxis hide />
                  <RechartsTooltip />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        {/* Revenue Line Chart */}
        <Grid item xs={12} md={4}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 240 }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1} color="#ffd86b">
                Revenue Trend
              </Typography>
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={data.revenue || []}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#ffd86b"
                    strokeWidth={3}
                    dot={{ fill: "#fff", stroke: "#ffd86b", r: 5 }}
                  />
                  <XAxis dataKey="week" tick={{ fill: "#fff" }} />
                  <YAxis hide />
                  <RechartsTooltip />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
        {/* Cost Pie */}
        <Grid item xs={12} md={4}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 240 }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1} color="#96ffed">
                Cost Breakdown
              </Typography>
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

      {/* ---- Drill-down, Top Routes, Load Status, Activity ---- */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 220, cursor: "pointer" }}
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
                  <YAxis type="category" dataKey="route" tick={{ fill: "#fff" }} />
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
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 220 }}>
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
            bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 220, cursor: "pointer",
            "&:hover": { boxShadow: 12, bgcolor: "#4d1c8dcc" }
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
          <Card sx={{ bgcolor: CARD_BG, borderRadius: 4, boxShadow: 6, color: "#fff", height: 220 }}>
            <CardContent>
              <Typography fontWeight={800} fontSize="1.13em" mb={1}>
                Recent Activity
              </Typography>
              {(activity || []).map((act, idx) => (
                <Box key={idx} mb={1.1}>
                  <Typography component="span" fontWeight={800} color="#fff" fontSize="0.97em">{act.date}</Typography>
                  <Typography component="span" fontWeight={600} color="#eee" fontSize="0.97em" ml={1}>{act.action}</Typography>
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
