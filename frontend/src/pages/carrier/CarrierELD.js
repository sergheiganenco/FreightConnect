import { API_ROOT } from "../../services/api";
/**
 * CarrierELD — Hours of Service / Electronic Logging Dashboard
 *
 * Displays:
 *  • Current duty status selector (OFF_DUTY / SLEEPER / DRIVING / ON_DUTY)
 *  • Live HOS gauges (drive remaining, on-duty remaining, 70-hour cycle)
 *  • Today's duty-status timeline
 *  • 7-day log history table
 *  • Violations list
 *  • Certify button for past days
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Divider,
  Grid,
  Tooltip,
  IconButton,
  MenuItem,
  Stack,
} from '@mui/material';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import HotelIcon from '@mui/icons-material/Hotel';
import WorkIcon from '@mui/icons-material/Work';
import NightShelterIcon from '@mui/icons-material/NightShelter';
import VerifiedIcon from '@mui/icons-material/Verified';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import TimerIcon from '@mui/icons-material/Timer';
import CommuteIcon from '@mui/icons-material/Commute';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import { semantic, brand, surface } from '../../theme/tokens';

// Normalize to origin so `${API}/api/...` never doubles `/api`
// (REACT_APP_API_URL is conventionally http://host/api).
const API = API_ROOT;

const STATUSES = [
  { key: 'OFF_DUTY',            label: 'Off Duty',          short: 'OFF',  color: semantic.muted, icon: <HotelIcon /> },
  { key: 'SLEEPER_BERTH',       label: 'Sleeper Berth',     short: 'SB',   color: '#a78bfa', icon: <NightShelterIcon /> },
  { key: 'DRIVING',             label: 'Driving',           short: 'D',    color: semantic.success, icon: <DirectionsCarIcon /> },
  { key: 'ON_DUTY_NOT_DRIVING', label: 'On Duty (Not Drv)', short: 'ON',   color: semantic.warning, icon: <WorkIcon /> },
  // Personal conveyance counts as off duty and a yard move as on duty; both need a reason.
  { key: 'PERSONAL_CONVEYANCE', label: 'Personal Use',      short: 'PC',   color: '#38bdf8', icon: <CommuteIcon />, needsNote: true },
  { key: 'YARD_MOVE',           label: 'Yard Move',         short: 'YM',   color: '#fb923c', icon: <WarehouseIcon />, needsNote: true },
];

const TIME_ZONES = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
  ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
];
const fieldSx = { input: { color: '#fff' }, label: { color: semantic.muted }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' }, color: '#fff' }, '& .MuiSvgIcon-root': { color: semantic.muted } };
// <input type="datetime-local"> wants local wall time without a zone.
const toLocalInput = (d) => { const t = new Date(d); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function statusMeta(key) {
  return STATUSES.find(s => s.key === key) || STATUSES[0];
}

function fmtMinutes(mins) {
  if (mins == null) return '--';
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.round(Math.abs(mins) % 60);
  const sign = mins < 0 ? '-' : '';
  return `${sign}${h}h ${m.toString().padStart(2, '0')}m`;
}

function fmtTime(dt) {
  if (!dt) return '--';
  return new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function pct(used, total) {
  return Math.min(100, Math.round((used / total) * 100));
}

// ── Gauge Component ────────────────────────────────────────────────────────────
function HosGauge({ label, used, total, color }) {
  const remaining = total - (used || 0);
  const p = pct(used, total);
  const barColor = p >= 90 ? semantic.error : p >= 70 ? semantic.warning : color;

  return (
    <Card
      sx={{
        bgcolor: surface.indigoTint,
        border: `1.5px solid ${surface.glassBorder}`,
        borderRadius: 3,
        p: 2,
        textAlign: 'center',
        minWidth: 160,
      }}
    >
      <Typography variant="caption" sx={{ color: semantic.muted, display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
        <CircularProgress
          variant="determinate"
          value={p}
          size={80}
          thickness={5}
          sx={{ color: barColor }}
        />
        <Box
          sx={{
            top: 0, left: 0, bottom: 0, right: 0,
            position: 'absolute',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="caption" sx={{ color: '#e5e7eb', fontWeight: 700, fontSize: '0.75rem' }}>
            {p}%
          </Typography>
        </Box>
      </Box>
      <Typography variant="body2" sx={{ color: barColor, fontWeight: 700 }}>
        {fmtMinutes(remaining)} left
      </Typography>
      <Typography variant="caption" sx={{ color: semantic.muted }}>
        of {fmtMinutes(total)}
      </Typography>
    </Card>
  );
}

// ── StatusButton ───────────────────────────────────────────────────────────────
function StatusButton({ meta, active, onClick, disabled }) {
  return (
    <Button
      variant={active ? 'contained' : 'outlined'}
      startIcon={meta.icon}
      onClick={() => onClick(meta.key)}
      disabled={disabled}
      sx={{
        borderColor: meta.color,
        color:       active ? '#0f172a' : meta.color,
        bgcolor:     active ? meta.color : 'transparent',
        fontWeight:  active ? 700 : 500,
        '&:hover':   { bgcolor: meta.color, color: '#0f172a', opacity: 0.9 },
        minWidth: 140,
      }}
    >
      {meta.label}
    </Button>
  );
}

// ── Timeline Row ───────────────────────────────────────────────────────────────
function Timeline({ events = [], liveActiveMinutes }) {
  const totalMins = 24 * 60;
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  return (
    <Box sx={{ mt: 1 }}>
      {/* Time axis */}
      <Box sx={{ display: 'flex', mb: 0.5, px: 0.5 }}>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => (
          <Typography
            key={h}
            variant="caption"
            sx={{
              position: 'absolute',
              left: `${(h / 24) * 100}%`,
              transform: 'translateX(-50%)',
              color: semantic.muted,
              fontSize: '0.65rem',
            }}
          >
            {h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
          </Typography>
        ))}
      </Box>

      <Box sx={{ position: 'relative', height: 32, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1, overflow: 'hidden', mt: 2 }}>
        {events.map((ev, i) => {
          const start = new Date(ev.startTime);
          const end   = ev.endTime ? new Date(ev.endTime) : now;
          const startMin = (start - midnight) / 60000;
          const durMin   = Math.max(1, (end - start) / 60000);
          const left  = Math.max(0, Math.min(100, (startMin / totalMins) * 100));
          const width = Math.max(0.4, Math.min(100 - left, (durMin / totalMins) * 100));
          const meta  = statusMeta(ev.status);
          return (
            <Tooltip
              key={i}
              title={`${meta.label}: ${fmtTime(ev.startTime)} → ${ev.endTime ? fmtTime(ev.endTime) : 'now'} (${fmtMinutes(ev.durationMinutes || Math.round(durMin))})`}
              arrow
            >
              <Box
                sx={{
                  position: 'absolute',
                  left:   `${left}%`,
                  width:  `${width}%`,
                  height: '100%',
                  bgcolor: meta.color,
                  opacity: 0.85,
                  borderRight: '1px solid rgba(0,0,0,0.3)',
                }}
              />
            </Tooltip>
          );
        })}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
        {STATUSES.map(s => (
          <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 12, bgcolor: s.color, borderRadius: 0.5 }} />
            <Typography variant="caption" sx={{ color: semantic.muted }}>{s.short}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function CarrierELD() {
  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const [today, setToday]       = useState(null);
  const [summary, setSummary]   = useState(null);
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError]       = useState('');

  // Status change dialog
  const [statusDialog, setStatusDialog] = useState(false);
  const [pendingStatus, setPendingStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [statusOdometer, setStatusOdometer] = useState('');

  // Correcting an entry, the company settings, the printable record
  const [editing, setEditing] = useState(null); // { _id, status, startTime, note }
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const isManager = (localStorage.getItem('companyRole') || 'owner') !== 'driver';

  // Certify dialog
  const [certifyLoading, setCertifyLoading] = useState(false);

  const refreshInterval = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const [todayRes, summaryRes, logsRes] = await Promise.all([
        fetch(`${API}/api/eld/today`,   { headers }),
        fetch(`${API}/api/eld/summary`, { headers }),
        fetch(`${API}/api/eld/logs?days=8`, { headers }),
      ]);
      const [t, s, l] = await Promise.all([todayRes.json(), summaryRes.json(), logsRes.json()]);
      setToday(t);
      setSettings((cur) => cur || t.settings || null);
      setSummary(s);
      setLogs(Array.isArray(l) ? l : []);
      setError('');
    } catch {
      setError('Failed to fetch ELD data');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    fetchAll();
    // Refresh every 60 seconds to keep live minutes accurate
    refreshInterval.current = setInterval(fetchAll, 60000);
    return () => clearInterval(refreshInterval.current);
  }, [fetchAll]);

  const handleStatusClick = (statusKey) => {
    if (today?.currentStatus === statusKey) return;
    setPendingStatus(statusKey);
    setStatusNote('');
    setStatusOdometer('');
    setStatusDialog(true);
  };

  const submitStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch(`${API}/api/eld/status`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          status:   pendingStatus,
          notes:    statusNote || undefined,
          odometer: statusOdometer ? parseFloat(statusOdometer) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to update status'); return; }
      setToday(data);
      setStatusDialog(false);
      await fetchAll();
    } catch {
      setError('Failed to update status');
    } finally {
      setStatusLoading(false);
    }
  };

  const certifyLog = async (date) => {
    setCertifyLoading(true);
    try {
      const res = await fetch(`${API}/api/eld/certify/${date}`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to certify'); return; }
      await fetchAll();
    } catch {
      setError('Failed to certify log');
    } finally {
      setCertifyLoading(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/eld/events/${editing._id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editing.status, startTime: new Date(editing.startTime).toISOString(), note: editing.note }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not correct the entry'); return; }
      setEditing(null);
      await fetchAll();
    } catch {
      setError('Could not correct the entry');
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (next) => {
    setSettings(next);
    try {
      const res = await fetch(`${API}/api/eld/settings`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save the settings'); return; }
      await fetchAll();
    } catch {
      setError('Could not save the settings');
    }
  };

  const downloadRecord = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/eld/record/pdf`, { headers });
      if (!res.ok) { setError('Could not build the record'); return; }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'duty-status-record.pdf'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError('Could not build the record');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const currentMeta   = statusMeta(today?.currentStatus);
  // The gauges follow the current shift and the weekly cycle, not the calendar day.
  const clock         = today?.clock || {};
  const driveUsed     = clock.driveMinutesUsed || 0;
  const onDutyUsed    = clock.windowElapsedMinutes || 0;
  const cycleUsedMins = clock.cycleUsedMinutes || 0;
  const cycleHours    = clock.cycleHours || 70;
  const cycleDays     = clock.cycleDays || 8;
  const todayDate     = today?.date || new Date().toISOString().slice(0, 10);
  const entries       = logs.flatMap((l) => (l.events || []).map((e) => ({ ...e, date: l.date })))
    .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2 }}>
        <TimerIcon sx={{ color: brand.indigoLight, fontSize: 32 }} />
        <Typography variant="h5" fontWeight={700} sx={{ color: '#fff' }}>
          HOS Advisor
        </Typography>
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={downloadRecord} disabled={busy}
          sx={{ ml: 'auto', borderColor: surface.glassBorder, color: '#e5e7eb' }}>
          8-day record
        </Button>
        <IconButton onClick={fetchAll} size="small" aria-label="Refresh" sx={{ color: semantic.muted }}>
          <RefreshIcon />
        </IconButton>
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        This is an advisory Hours-of-Service planner, <strong>not an FMCSA-registered ELD</strong>.
        It follows the federal rules (11 and 14 hours, the 30-minute break, split sleeper, the weekly
        limit and the 34-hour restart) from what you enter here, but this tool does not satisfy the 49&nbsp;CFR&nbsp;395.8 records-of-duty-status
        requirement — keep using your registered ELD as your legal log of record.
      </Alert>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Current Status */}
      <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassBadge}`, borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#e5e7eb' }}>
              Current Status:
            </Typography>
            <Chip
              icon={currentMeta.icon}
              label={currentMeta.label}
              sx={{ bgcolor: currentMeta.color, color: '#0f172a', fontWeight: 700, fontSize: '0.9rem', px: 1 }}
            />
            {today?.liveActiveMinutes > 0 && (
              <Typography variant="caption" sx={{ color: semantic.muted }}>
                Active for {fmtMinutes(today.liveActiveMinutes)}
              </Typography>
            )}
            {clock.splitSleeper && <Chip size="small" label="Split sleeper in use" sx={{ bgcolor: '#a78bfa', color: '#0f172a', fontWeight: 700 }} />}
          </Box>

          <Typography variant="body2" sx={{ color: semantic.muted, mb: 1.5 }}>Change Status:</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {STATUSES.map(s => (
              <StatusButton
                key={s.key}
                meta={s}
                active={today?.currentStatus === s.key}
                onClick={handleStatusClick}
                disabled={statusLoading}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* HOS Gauges */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <HosGauge
            label="Drive Time (11h limit)"
            used={driveUsed}
            total={660}
            color={semantic.success}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <HosGauge
            label="On-Duty Window (14h)"
            used={onDutyUsed}
            total={840}
            color={semantic.warning}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <HosGauge
            label={`Cycle (${cycleHours}h / ${cycleDays}-day)`}
            used={cycleUsedMins}
            total={cycleHours * 60}
            color={brand.indigo}
          />
        </Grid>
      </Grid>

      {/* Today's remaining detail */}
      <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassHover}`, borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>
            Today's HOS Detail
          </Typography>
          <Grid container spacing={2}>
            {[
              { label: 'Driving', mins: today?.totals?.drivingMinutes || 0, color: semantic.success },
              { label: 'On-Duty (not drv)', mins: today?.totals?.onDutyNotDrivingMinutes || 0, color: semantic.warning },
              { label: 'Sleeper', mins: today?.totals?.sleeperMinutes || 0, color: '#a78bfa' },
              { label: 'Off Duty', mins: today?.totals?.offDutyMinutes || 0, color: semantic.muted },
            ].map(row => (
              <Grid item xs={6} sm={3} key={row.label}>
                <Typography variant="caption" sx={{ color: semantic.muted }}>{row.label}</Typography>
                <Typography variant="body1" sx={{ color: row.color, fontWeight: 700 }}>
                  {fmtMinutes(row.mins)}
                </Typography>
              </Grid>
            ))}
          </Grid>

          <Divider sx={{ borderColor: surface.glassHover, my: 1.5 }} />

          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: semantic.muted }}>Drive Remaining</Typography>
              <Typography variant="body1" sx={{ color: semantic.success, fontWeight: 700 }}>
                {fmtMinutes(today?.remaining?.driveMinutes ?? 660)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: semantic.muted }}>On-Duty Remaining</Typography>
              <Typography variant="body1" sx={{ color: semantic.warning, fontWeight: 700 }}>
                {fmtMinutes(today?.remaining?.onDutyMinutes ?? 840)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: semantic.muted }}>Cycle Remaining</Typography>
              <Typography variant="body1" sx={{ color: '#818cf8', fontWeight: 700 }}>
                {summary ? `${summary.remainingCycleHours}h` : '--'}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: semantic.muted }}>Cycle Used</Typography>
              <Typography variant="body1" sx={{ color: '#e5e7eb', fontWeight: 700 }}>
                {summary ? `${summary.usedOnDutyHours}h / ${cycleHours}h` : '--'}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassHover}`, borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 2 }}>
            Today's Timeline
          </Typography>
          <Timeline events={today?.events || []} liveActiveMinutes={today?.liveActiveMinutes} />
          {today?.carriedOver && (
            <Typography variant="caption" sx={{ color: semantic.muted, display: 'block', mt: 1 }}>
              {statusMeta(today.carriedOver.status).label} since {new Date(today.carriedOver.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (started on an earlier day).
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Entries, with corrections */}
      <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassHover}`, borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 0.5 }}>
            Entries (last 8 days)
          </Typography>
          <Typography variant="caption" sx={{ color: semantic.muted, display: 'block', mb: 1.5 }}>
            Picked the wrong status or time? Correct it and say why. The original stays on the record.
          </Typography>
          {entries.length === 0 && <Typography variant="body2" sx={{ color: semantic.muted }}>No entries yet.</Typography>}
          <Stack spacing={0.5} sx={{ maxHeight: 320, overflowY: 'auto' }}>
            {entries.map((e) => (
              <Box key={e._id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: `1px solid ${surface.glass}` }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusMeta(e.status).color, flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ color: '#e5e7eb', fontWeight: 600 }}>
                    {statusMeta(e.status).label}
                  </Typography>
                  <Typography variant="caption" sx={{ color: semantic.muted, display: 'block', wordBreak: 'break-word' }}>
                    {new Date(e.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{e.notes ? ` · ${e.notes}` : ''}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Correct this entry" sx={{ color: semantic.muted }}
                  onClick={() => setEditing({ _id: e._id, status: e.status, startTime: toLocalInput(e.startTime), note: '' })}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>

      {/* Company settings */}
      {settings && (
        <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassHover}`, borderRadius: 3, mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>
              Company hours settings
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select size="small" label="Weekly limit" value={settings.cycle} disabled={!isManager} fullWidth sx={fieldSx}
                onChange={(e) => saveSettings({ ...settings, cycle: e.target.value })}>
                <MenuItem value="70_8">70 hours in 8 days (runs every day)</MenuItem>
                <MenuItem value="60_7">60 hours in 7 days</MenuItem>
              </TextField>
              <TextField select size="small" label="Home time zone" value={settings.timeZone} disabled={!isManager} fullWidth sx={fieldSx}
                onChange={(e) => saveSettings({ ...settings, timeZone: e.target.value })}>
                {TIME_ZONES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                {!TIME_ZONES.some(([v]) => v === settings.timeZone) && <MenuItem value={settings.timeZone}>{settings.timeZone}</MenuItem>}
              </TextField>
            </Stack>
            <Typography variant="caption" sx={{ color: semantic.muted, display: 'block', mt: 1 }}>
              A log day starts at midnight in the home time zone.{!isManager ? ' Only the owner or a dispatcher can change these.' : ''}
              {clock.cycleRestartAt ? ` Weekly hours restarted after 34 hours of rest on ${new Date(clock.cycleRestartAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Violations */}
      {today?.violations?.length > 0 && (
        <Card sx={{ bgcolor: 'rgba(239,68,68,0.10)', border: '1.5px solid rgba(239,68,68,0.35)', borderRadius: 3, mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#fca5a5', mb: 1.5 }}>
              HOS Violations / Warnings
            </Typography>
            {today.violations.map((v, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                {v.severity === 'violation'
                  ? <ErrorIcon sx={{ color: semantic.error, fontSize: 20 }} />
                  : <WarningAmberIcon sx={{ color: semantic.warning, fontSize: 20 }} />}
                <Typography variant="body2" sx={{ color: v.severity === 'violation' ? '#fca5a5' : '#fde68a' }}>
                  {v.message}
                </Typography>
                <Chip
                  label={v.severity}
                  size="small"
                  sx={{
                    ml: 'auto',
                    bgcolor: v.severity === 'violation' ? semantic.error : semantic.warning,
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                  }}
                />
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 8-Day Log History */}
      <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassHover}`, borderRadius: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 2 }}>
            8-Day Log History
          </Typography>
          {/* Desktop / tablet: full table (md and up) */}
          <Box sx={{ overflowX: 'auto', display: { xs: 'none', md: 'block' } }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Date', 'Driving', 'On-Duty', 'Violations', 'Certified', ''].map(h => (
                    <TableCell key={h} sx={{ color: semantic.muted, borderColor: surface.glassHover, fontWeight: 600 }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map(log => {
                  const driveH  = Math.round((log.totals?.drivingMinutes || 0) / 60 * 10) / 10;
                  const onDutyH = Math.round(((log.totals?.drivingMinutes || 0) + (log.totals?.onDutyNotDrivingMinutes || 0)) / 60 * 10) / 10;
                  const isToday = log.date === todayDate;
                  return (
                    <TableRow key={log._id || log.date} hover sx={{ '&:hover': { bgcolor: surface.glassLight } }}>
                      <TableCell sx={{ color: '#e5e7eb', borderColor: surface.glass }}>
                        {log.date}
                        {isToday && <Chip label="today" size="small" sx={{ ml: 1, bgcolor: brand.indigo, color: '#fff', fontSize: '0.65rem' }} />}
                      </TableCell>
                      <TableCell sx={{ color: semantic.success, borderColor: surface.glass }}>
                        {driveH}h
                      </TableCell>
                      <TableCell sx={{ color: semantic.warning, borderColor: surface.glass }}>
                        {onDutyH}h
                      </TableCell>
                      <TableCell sx={{ borderColor: surface.glass }}>
                        {(log.violations || []).length > 0 ? (
                          <Chip
                            label={(log.violations || []).length}
                            size="small"
                            icon={<ErrorIcon sx={{ fontSize: '14px !important' }} />}
                            sx={{ bgcolor: semantic.error, color: '#fff', fontWeight: 700 }}
                          />
                        ) : (
                          <Typography variant="caption" sx={{ color: semantic.muted }}>None</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ borderColor: surface.glass }}>
                        {log.certified ? (
                          <Chip icon={<VerifiedIcon />} label="Certified" size="small" sx={{ bgcolor: semantic.success, color: '#fff', fontWeight: 700 }} />
                        ) : (
                          <Typography variant="caption" sx={{ color: semantic.muted }}>Pending</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ borderColor: surface.glass }}>
                        {!log.certified && !isToday && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<VerifiedIcon />}
                            onClick={() => certifyLog(log.date)}
                            disabled={certifyLoading}
                            sx={{ borderColor: semantic.success, color: semantic.success, fontSize: '0.75rem' }}
                          >
                            Certify
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ color: semantic.muted, textAlign: 'center', py: 3 }}>
                      No log history found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>

          {/* Phone: stacked cards (below md) so the wide table never overflows the screen */}
          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
            {logs.length === 0 ? (
              <Typography variant="caption" sx={{ color: semantic.muted, textAlign: 'center', display: 'block', py: 3 }}>
                No log history found
              </Typography>
            ) : logs.map(log => {
              const driveH  = Math.round((log.totals?.drivingMinutes || 0) / 60 * 10) / 10;
              const onDutyH = Math.round(((log.totals?.drivingMinutes || 0) + (log.totals?.onDutyNotDrivingMinutes || 0)) / 60 * 10) / 10;
              const isToday = log.date === todayDate;
              const violationCount = (log.violations || []).length;
              const canCertify = !log.certified && !isToday;
              return (
                <Box
                  key={log._id || log.date}
                  sx={{ p: 2, mb: 1.5, borderRadius: 2, bgcolor: surface.glass, border: `1px solid ${surface.glassHover}` }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Typography sx={{ color: '#e5e7eb', fontWeight: 700 }}>{log.date}</Typography>
                      {isToday && <Chip label="today" size="small" sx={{ bgcolor: brand.indigo, color: '#fff', fontSize: '0.65rem' }} />}
                    </Box>
                    {log.certified ? (
                      <Chip icon={<VerifiedIcon />} label="Certified" size="small" sx={{ bgcolor: semantic.success, color: '#fff', fontWeight: 700, flexShrink: 0 }} />
                    ) : (
                      <Typography variant="caption" sx={{ color: semantic.muted, flexShrink: 0 }}>Pending</Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    <Box>
                      <Typography variant="caption" sx={{ color: semantic.muted, display: 'block' }}>Driving</Typography>
                      <Typography variant="body2" sx={{ color: semantic.success, fontWeight: 700 }}>{driveH}h</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: semantic.muted, display: 'block' }}>On-Duty</Typography>
                      <Typography variant="body2" sx={{ color: semantic.warning, fontWeight: 700 }}>{onDutyH}h</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" sx={{ color: semantic.muted, display: 'block', mb: 0.5 }}>Violations</Typography>
                      {violationCount > 0 ? (
                        <Chip
                          label={violationCount}
                          size="small"
                          icon={<ErrorIcon sx={{ fontSize: '14px !important' }} />}
                          sx={{ bgcolor: semantic.error, color: '#fff', fontWeight: 700 }}
                        />
                      ) : (
                        <Typography variant="body2" sx={{ color: semantic.muted }}>None</Typography>
                      )}
                    </Box>
                  </Box>
                  {canCertify && (
                    <Button
                      size="small"
                      variant="outlined"
                      fullWidth
                      startIcon={<VerifiedIcon />}
                      onClick={() => certifyLog(log.date)}
                      disabled={certifyLoading}
                      sx={{ borderColor: semantic.success, color: semantic.success, fontSize: '0.75rem', mt: 1.5 }}
                    >
                      Certify
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
        </CardContent>
      </Card>

      {/* 70h Cycle Detail */}
      {summary && (
        <Card sx={{ bgcolor: surface.indigoTint, border: `1.5px solid ${surface.glassHover}`, borderRadius: 3, mt: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>
              {cycleHours}-Hour Cycle Detail (last {cycleDays} days)
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
              <Typography variant="body2" sx={{ color: semantic.muted, minWidth: 120 }}>On-Duty Used:</Typography>
              <LinearProgress
                variant="determinate"
                value={pct(summary.usedOnDutyHours * 60, cycleHours * 60)}
                sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: surface.glassBorder, '& .MuiLinearProgress-bar': { bgcolor: brand.indigo } }}
              />
              <Typography variant="body2" sx={{ color: '#818cf8', fontWeight: 700, minWidth: 60 }}>
                {summary.usedOnDutyHours}h / {cycleHours}h
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ color: semantic.muted, minWidth: 120 }}>Drive Used:</Typography>
              <LinearProgress
                variant="determinate"
                value={pct(summary.usedDriveHours * 60, cycleHours * 60)}
                sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: surface.glassBorder, '& .MuiLinearProgress-bar': { bgcolor: semantic.success } }}
              />
              <Typography variant="body2" sx={{ color: semantic.success, fontWeight: 700, minWidth: 60 }}>
                {summary.usedDriveHours}h
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Status Change Dialog */}
      <Dialog
        open={statusDialog}
        onClose={() => setStatusDialog(false)}
        PaperProps={{ sx: { bgcolor: '#1e1b4b', color: '#fff', borderRadius: 3, minWidth: 340 } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Change Status to: {statusMeta(pendingStatus).label}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5, bgcolor: surface.glass, borderRadius: 2 }}>
            <Box sx={{ color: statusMeta(pendingStatus).color }}>{statusMeta(pendingStatus).icon}</Box>
            <Typography sx={{ color: statusMeta(pendingStatus).color, fontWeight: 700 }}>
              {statusMeta(pendingStatus).label}
            </Typography>
          </Box>
          <TextField
            label="Odometer (optional)"
            type="number"
            fullWidth
            size="small"
            value={statusOdometer}
            onChange={e => setStatusOdometer(e.target.value)}
            sx={{ mb: 2, input: { color: '#fff' }, label: { color: semantic.muted }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' } } }}
            InputProps={{ endAdornment: <Typography variant="caption" sx={{ color: semantic.muted }}>mi</Typography> }}
          />
          <TextField
            label={statusMeta(pendingStatus).needsNote ? 'Reason (required)' : 'Notes (optional)'}
            required={!!statusMeta(pendingStatus).needsNote}
            fullWidth
            size="small"
            multiline
            rows={2}
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            sx={{ input: { color: '#fff' }, label: { color: semantic.muted }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' }, color: '#fff' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setStatusDialog(false)} sx={{ color: semantic.muted }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitStatus}
            disabled={statusLoading || (!!statusMeta(pendingStatus).needsNote && !statusNote.trim())}
            sx={{ bgcolor: statusMeta(pendingStatus).color, color: '#0f172a', '&:hover': { bgcolor: statusMeta(pendingStatus).color, opacity: 0.85 } }}
          >
            {statusLoading ? <CircularProgress size={20} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Correct an entry */}
      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="xs"
        PaperProps={{ sx: { bgcolor: '#1e1b4b', color: '#fff', borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Correct this entry</DialogTitle>
        {editing && (
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField select size="small" label="Status" value={editing.status} sx={fieldSx}
                onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {STATUSES.map((s) => <MenuItem key={s.key} value={s.key}>{s.label}</MenuItem>)}
              </TextField>
              <TextField size="small" type="datetime-local" label="Started at" value={editing.startTime} sx={fieldSx}
                InputLabelProps={{ shrink: true }} onChange={(e) => setEditing({ ...editing, startTime: e.target.value })} />
              <TextField size="small" label="Why are you correcting it? (required)" value={editing.note} multiline rows={2} sx={fieldSx}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
              <Typography variant="caption" sx={{ color: semantic.muted }}>
                A corrected day has to be certified again.
              </Typography>
            </Stack>
          </DialogContent>
        )}
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditing(null)} sx={{ color: semantic.muted }}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={busy || !editing || editing.note.trim().length < 4 || !editing.startTime}>
            Save correction
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
