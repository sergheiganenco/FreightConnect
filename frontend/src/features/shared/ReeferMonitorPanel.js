/**
 * ReeferMonitorPanel — Temperature Monitoring for Reefer Loads
 *
 * Props:
 *  loadId     {string}  — Load._id
 *  role       {string}  — 'carrier' | 'shipper' | 'admin'
 *  reefer     {object}  — Load.reefer settings (passed from parent so we know thresholds)
 *
 * Features:
 *  • Latest temp + alert badge
 *  • 24h temperature chart (Recharts LineChart with min/max threshold reference lines)
 *  • Log new reading form (carrier only)
 *  • 24h stats (min / avg / max)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  Chip,
  Alert,
  CircularProgress,
  Grid,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AddIcon from '@mui/icons-material/Add';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function cToF(c) { return c != null ? Math.round((c * 9 / 5 + 32) * 10) / 10 : null; }
function fmtTemp(c, unit) {
  if (c == null) return '--';
  return unit === 'F' ? `${cToF(c)}°F` : `${c}°C`;
}
function fmtTime(dt) {
  return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CARD_SX = {
  bgcolor: 'rgba(124,140,248,0.08)',
  border: '1.5px solid rgba(255,255,255,0.10)',
  borderRadius: 3,
};

export default function ReeferMonitorPanel({ loadId, role, reefer: reeferProp }) {
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const [status, setStatus]     = useState(null);
  const [readings, setReadings] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [unit, setUnit]         = useState('F');

  // Log reading dialog (carrier only)
  const [logOpen, setLogOpen]   = useState(false);
  const [tempInput, setTempInput] = useState('');
  const [humInput, setHumInput]   = useState('');
  const [locInput, setLocInput]   = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [logLoading, setLogLoading] = useState(false);
  const [logAlert, setLogAlert]   = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [statRes, readRes] = await Promise.all([
        fetch(`${API}/api/reefer/status/${loadId}`,         { headers }),
        fetch(`${API}/api/reefer/readings/${loadId}?hours=24`, { headers }),
      ]);
      const [stat, read] = await Promise.all([statRes.json(), readRes.json()]);
      setStatus(stat);
      setReadings(Array.isArray(read.readings) ? read.readings : []);
    } catch {
      setError('Failed to load temperature data');
    } finally {
      setLoading(false);
    }
  }, [loadId]); // eslint-disable-line

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120000); // refresh every 2 min
    return () => clearInterval(iv);
  }, [fetchData]);

  const submitReading = async () => {
    const val = parseFloat(tempInput);
    if (!tempInput || isNaN(val)) { setLogAlert('Enter a valid temperature'); return; }
    setLogLoading(true);
    try {
      const body = unit === 'F' ? { tempF: val } : { tempC: val };
      if (humInput) body.humidity = parseFloat(humInput);
      if (locInput) body.location = locInput;
      if (noteInput) body.notes   = noteInput;

      const res  = await fetch(`${API}/api/reefer/readings/${loadId}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setLogAlert(data.error || 'Failed'); return; }

      setLogAlert('');
      setTempInput(''); setHumInput(''); setLocInput(''); setNoteInput('');
      setLogOpen(false);
      await fetchData();
    } catch {
      setLogAlert('Failed to log reading');
    } finally {
      setLogLoading(false);
    }
  };

  const reefer = reeferProp || status?.reefer;

  // Prepare chart data
  const chartData = readings.map(r => ({
    time:    fmtTime(r.recordedAt),
    temp:    unit === 'F' ? cToF(r.tempC) : r.tempC,
    isAlert: r.isAlert,
  }));

  const minLine = reefer?.targetMinC != null
    ? (unit === 'F' ? cToF(reefer.targetMinC) : reefer.targetMinC)
    : null;
  const maxLine = reefer?.targetMaxC != null
    ? (unit === 'F' ? cToF(reefer.targetMaxC) : reefer.targetMaxC)
    : null;

  const latestC  = status?.latest?.tempC;
  const inRange  = latestC != null && reefer?.enabled
    ? (reefer.targetMinC == null || latestC >= reefer.targetMinC) &&
      (reefer.targetMaxC == null || latestC <= reefer.targetMaxC)
    : true;

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={32} /></Box>;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <ThermostatIcon sx={{ color: '#60a5fa', fontSize: 26 }} />
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#e5e7eb' }}>
          Temperature Monitoring
        </Typography>
        <ToggleButtonGroup
          size="small"
          value={unit}
          exclusive
          onChange={(_, v) => v && setUnit(v)}
          sx={{ ml: 'auto' }}
        >
          <ToggleButton value="F" sx={{ color: '#9ca3af', '&.Mui-selected': { color: '#fff', bgcolor: '#6366f1' }, px: 1.5, py: 0.5, fontSize: '0.75rem' }}>°F</ToggleButton>
          <ToggleButton value="C" sx={{ color: '#9ca3af', '&.Mui-selected': { color: '#fff', bgcolor: '#6366f1' }, px: 1.5, py: 0.5, fontSize: '0.75rem' }}>°C</ToggleButton>
        </ToggleButtonGroup>
        {role === 'carrier' && (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setLogOpen(true)}
            sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' }, ml: 1 }}
          >
            Log Temp
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Target Range + Current Reading */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {/* Current temp */}
        <Grid item xs={6} sm={3}>
          <Card sx={CARD_SX}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Current Temp</Typography>
              <Typography variant="h5" sx={{ color: status?.currentAlert ? '#ef4444' : '#34d399', fontWeight: 700 }}>
                {latestC != null ? fmtTemp(latestC, unit) : '--'}
              </Typography>
              {status?.currentAlert
                ? <Chip icon={<WarningAmberIcon />} label="Alert" size="small" sx={{ bgcolor: '#ef4444', color: '#fff', mt: 0.5 }} />
                : latestC != null
                  ? <Chip icon={<CheckCircleIcon />} label="In Range" size="small" sx={{ bgcolor: '#10b981', color: '#fff', mt: 0.5 }} />
                  : null}
            </CardContent>
          </Card>
        </Grid>

        {/* Target range */}
        <Grid item xs={6} sm={3}>
          <Card sx={CARD_SX}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Target Range</Typography>
              <Typography variant="body1" sx={{ color: '#e5e7eb', fontWeight: 700 }}>
                {reefer?.enabled && (reefer.targetMinC != null || reefer.targetMaxC != null)
                  ? `${fmtTemp(reefer.targetMinC, unit)} – ${fmtTemp(reefer.targetMaxC, unit)}`
                  : 'Not set'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* 24h stats */}
        {status?.stats24h && (
          <>
            <Grid item xs={6} sm={3}>
              <Card sx={CARD_SX}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>24h Min / Max</Typography>
                  <Typography variant="body1" sx={{ color: '#60a5fa', fontWeight: 700 }}>
                    {fmtTemp(status.stats24h.minC, unit)} / {fmtTemp(status.stats24h.maxC, unit)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Card sx={CARD_SX}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>24h Avg / Readings</Typography>
                  <Typography variant="body1" sx={{ color: '#e5e7eb', fontWeight: 700 }}>
                    {fmtTemp(status.stats24h.avgC, unit)} / {status.stats24h.count}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </>
        )}

        {/* Alert count */}
        {status?.alertCount > 0 && (
          <Grid item xs={6} sm={3}>
            <Card sx={{ ...CARD_SX, borderColor: 'rgba(239,68,68,0.4)' }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>Total Alerts</Typography>
                <Typography variant="body1" sx={{ color: '#ef4444', fontWeight: 700 }}>
                  {status.alertCount}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Alert banner */}
      {status?.currentAlert && (
        <Alert severity="error" icon={<WarningAmberIcon />} sx={{ mb: 2, bgcolor: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}>
          {status.currentAlert}
        </Alert>
      )}

      {/* Temperature Chart */}
      {chartData.length > 0 ? (
        <Card sx={CARD_SX}>
          <CardContent>
            <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 1 }}>
              24-Hour Temperature History
            </Typography>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  tickLine={false}
                  unit={unit === 'F' ? '°F' : '°C'}
                  width={45}
                />
                <ReTooltip
                  contentStyle={{ background: '#1e1b4b', border: 'none', borderRadius: 8, color: '#e5e7eb' }}
                  formatter={v => [`${v}°${unit}`, 'Temp']}
                />
                {minLine != null && (
                  <ReferenceLine y={minLine} stroke="#3b82f6" strokeDasharray="4 2" label={{ value: `Min ${minLine}°${unit}`, fill: '#3b82f6', fontSize: 10, position: 'insideTopRight' }} />
                )}
                {maxLine != null && (
                  <ReferenceLine y={maxLine} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `Max ${maxLine}°${unit}`, fill: '#ef4444', fontSize: 10, position: 'insideTopRight' }} />
                )}
                <Line
                  type="monotone"
                  dataKey="temp"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={(props) => {
                    const d = chartData[props.index];
                    return <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill={d?.isAlert ? '#ef4444' : '#60a5fa'} />;
                  }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      ) : (
        <Typography variant="body2" sx={{ color: '#6b7280', textAlign: 'center', py: 3 }}>
          No temperature readings in the last 24 hours
        </Typography>
      )}

      {/* Log Reading Dialog */}
      <Dialog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        PaperProps={{ sx: { bgcolor: '#1e1b4b', color: '#fff', borderRadius: 3, minWidth: 340 } }}
      >
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ThermostatIcon sx={{ color: '#60a5fa' }} />
          Log Temperature Reading
        </DialogTitle>
        <DialogContent>
          {logAlert && <Alert severity="error" sx={{ mb: 2 }}>{logAlert}</Alert>}

          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              label={`Temperature (°${unit})`}
              type="number"
              value={tempInput}
              onChange={e => setTempInput(e.target.value)}
              fullWidth
              size="small"
              required
              sx={{ input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }}
            />
            <ToggleButtonGroup
              size="small"
              value={unit}
              exclusive
              onChange={(_, v) => v && setUnit(v)}
            >
              <ToggleButton value="F" sx={{ color: '#9ca3af', '&.Mui-selected': { color: '#fff', bgcolor: '#6366f1' } }}>°F</ToggleButton>
              <ToggleButton value="C" sx={{ color: '#9ca3af', '&.Mui-selected': { color: '#fff', bgcolor: '#6366f1' } }}>°C</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {reefer?.enabled && (
            <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 1.5 }}>
              Target: {fmtTemp(reefer.targetMinC, unit)} – {fmtTemp(reefer.targetMaxC, unit)}
            </Typography>
          )}

          <TextField
            label="Humidity % (optional)"
            type="number"
            value={humInput}
            onChange={e => setHumInput(e.target.value)}
            fullWidth size="small" sx={{ mb: 1.5, input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }}
          />
          <TextField
            label="Location (optional)"
            value={locInput}
            onChange={e => setLocInput(e.target.value)}
            fullWidth size="small" sx={{ mb: 1.5, input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }}
          />
          <TextField
            label="Notes (optional)"
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            fullWidth size="small" multiline rows={2}
            sx={{ input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root': { color: '#fff', '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' } } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setLogOpen(false)} sx={{ color: '#9ca3af' }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitReading}
            disabled={logLoading}
            sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' } }}
          >
            {logLoading ? <CircularProgress size={20} /> : 'Save Reading'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
