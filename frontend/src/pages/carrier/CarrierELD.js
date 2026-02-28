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

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const STATUSES = [
  { key: 'OFF_DUTY',            label: 'Off Duty',          short: 'OFF',  color: '#6b7280', icon: <HotelIcon /> },
  { key: 'SLEEPER_BERTH',       label: 'Sleeper Berth',     short: 'SB',   color: '#8b5cf6', icon: <NightShelterIcon /> },
  { key: 'DRIVING',             label: 'Driving',           short: 'D',    color: '#10b981', icon: <DirectionsCarIcon /> },
  { key: 'ON_DUTY_NOT_DRIVING', label: 'On Duty (Not Drv)', short: 'ON',   color: '#f59e0b', icon: <WorkIcon /> },
];

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
  const barColor = p >= 90 ? '#ef4444' : p >= 70 ? '#f59e0b' : color;

  return (
    <Card
      sx={{
        bgcolor: 'rgba(124,140,248,0.10)',
        border: '1.5px solid rgba(255,255,255,0.10)',
        borderRadius: 3,
        p: 2,
        textAlign: 'center',
        minWidth: 160,
      }}
    >
      <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 0.5 }}>
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
      <Typography variant="caption" sx={{ color: '#6b7280' }}>
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
        color:       active ? '#fff' : meta.color,
        bgcolor:     active ? meta.color : 'transparent',
        fontWeight:  active ? 700 : 500,
        '&:hover':   { bgcolor: meta.color, color: '#fff', opacity: 0.9 },
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
              color: '#6b7280',
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
            <Typography variant="caption" sx={{ color: '#9ca3af' }}>{s.short}</Typography>
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

  // Certify dialog
  const [certifyDate, setCertifyDate] = useState('');
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

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const currentMeta   = statusMeta(today?.currentStatus);
  const driveUsed     = today ? (today.totals?.drivingMinutes || 0) : 0;
  const onDutyUsed    = today ? ((today.totals?.drivingMinutes || 0) + (today.totals?.onDutyNotDrivingMinutes || 0)) : 0;
  const cycleUsedMins = summary ? Math.round((summary.usedOnDutyHours || 0) * 60) : 0;
  const todayDate     = new Date().toISOString().slice(0, 10);

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2 }}>
        <TimerIcon sx={{ color: '#818cf8', fontSize: 32 }} />
        <Typography variant="h5" fontWeight={700} sx={{ color: '#fff' }}>
          ELD / Hours of Service
        </Typography>
        <IconButton onClick={fetchAll} size="small" sx={{ ml: 'auto', color: '#9ca3af' }}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Current Status */}
      <Card sx={{ bgcolor: 'rgba(124,140,248,0.10)', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#e5e7eb' }}>
              Current Status:
            </Typography>
            <Chip
              icon={currentMeta.icon}
              label={currentMeta.label}
              sx={{ bgcolor: currentMeta.color, color: '#fff', fontWeight: 700, fontSize: '0.9rem', px: 1 }}
            />
            {today?.liveActiveMinutes > 0 && (
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                Active for {fmtMinutes(today.liveActiveMinutes)}
              </Typography>
            )}
          </Box>

          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1.5 }}>Change Status:</Typography>
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
            color="#10b981"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <HosGauge
            label="On-Duty Window (14h)"
            used={onDutyUsed}
            total={840}
            color="#f59e0b"
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <HosGauge
            label="Cycle (70h / 8-day)"
            used={cycleUsedMins}
            total={4200}
            color="#6366f1"
          />
        </Grid>
      </Grid>

      {/* Today's remaining detail */}
      <Card sx={{ bgcolor: 'rgba(124,140,248,0.08)', border: '1.5px solid rgba(255,255,255,0.08)', borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>
            Today's HOS Detail
          </Typography>
          <Grid container spacing={2}>
            {[
              { label: 'Driving', mins: today?.totals?.drivingMinutes || 0, color: '#10b981' },
              { label: 'On-Duty (not drv)', mins: today?.totals?.onDutyNotDrivingMinutes || 0, color: '#f59e0b' },
              { label: 'Sleeper', mins: today?.totals?.sleeperMinutes || 0, color: '#8b5cf6' },
              { label: 'Off Duty', mins: today?.totals?.offDutyMinutes || 0, color: '#6b7280' },
            ].map(row => (
              <Grid item xs={6} sm={3} key={row.label}>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>{row.label}</Typography>
                <Typography variant="body1" sx={{ color: row.color, fontWeight: 700 }}>
                  {fmtMinutes(row.mins)}
                </Typography>
              </Grid>
            ))}
          </Grid>

          <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 1.5 }} />

          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Drive Remaining</Typography>
              <Typography variant="body1" sx={{ color: '#10b981', fontWeight: 700 }}>
                {fmtMinutes(today?.remaining?.driveMinutes ?? 660)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>On-Duty Remaining</Typography>
              <Typography variant="body1" sx={{ color: '#f59e0b', fontWeight: 700 }}>
                {fmtMinutes(today?.remaining?.onDutyMinutes ?? 840)}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Cycle Remaining</Typography>
              <Typography variant="body1" sx={{ color: '#6366f1', fontWeight: 700 }}>
                {summary ? `${summary.remainingCycleHours}h` : '--'}
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Cycle Used</Typography>
              <Typography variant="body1" sx={{ color: '#e5e7eb', fontWeight: 700 }}>
                {summary ? `${summary.usedOnDutyHours}h / 70h` : '--'}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card sx={{ bgcolor: 'rgba(124,140,248,0.08)', border: '1.5px solid rgba(255,255,255,0.08)', borderRadius: 3, mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 2 }}>
            Today's Timeline
          </Typography>
          <Timeline events={today?.events || []} liveActiveMinutes={today?.liveActiveMinutes} />
        </CardContent>
      </Card>

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
                  ? <ErrorIcon sx={{ color: '#ef4444', fontSize: 20 }} />
                  : <WarningAmberIcon sx={{ color: '#f59e0b', fontSize: 20 }} />}
                <Typography variant="body2" sx={{ color: v.severity === 'violation' ? '#fca5a5' : '#fde68a' }}>
                  {v.message}
                </Typography>
                <Chip
                  label={v.severity}
                  size="small"
                  sx={{
                    ml: 'auto',
                    bgcolor: v.severity === 'violation' ? '#ef4444' : '#f59e0b',
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
      <Card sx={{ bgcolor: 'rgba(124,140,248,0.08)', border: '1.5px solid rgba(255,255,255,0.08)', borderRadius: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 2 }}>
            8-Day Log History
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['Date', 'Driving', 'On-Duty', 'Violations', 'Certified', ''].map(h => (
                    <TableCell key={h} sx={{ color: '#9ca3af', borderColor: 'rgba(255,255,255,0.08)', fontWeight: 600 }}>
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
                    <TableRow key={log._id || log.date} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' } }}>
                      <TableCell sx={{ color: '#e5e7eb', borderColor: 'rgba(255,255,255,0.06)' }}>
                        {log.date}
                        {isToday && <Chip label="today" size="small" sx={{ ml: 1, bgcolor: '#6366f1', color: '#fff', fontSize: '0.65rem' }} />}
                      </TableCell>
                      <TableCell sx={{ color: '#10b981', borderColor: 'rgba(255,255,255,0.06)' }}>
                        {driveH}h
                      </TableCell>
                      <TableCell sx={{ color: '#f59e0b', borderColor: 'rgba(255,255,255,0.06)' }}>
                        {onDutyH}h
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        {(log.violations || []).length > 0 ? (
                          <Chip
                            label={(log.violations || []).length}
                            size="small"
                            icon={<ErrorIcon sx={{ fontSize: '14px !important' }} />}
                            sx={{ bgcolor: '#ef4444', color: '#fff', fontWeight: 700 }}
                          />
                        ) : (
                          <Typography variant="caption" sx={{ color: '#6b7280' }}>None</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        {log.certified ? (
                          <Chip icon={<VerifiedIcon />} label="Certified" size="small" sx={{ bgcolor: '#10b981', color: '#fff', fontWeight: 700 }} />
                        ) : (
                          <Typography variant="caption" sx={{ color: '#6b7280' }}>Pending</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                        {!log.certified && !isToday && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<VerifiedIcon />}
                            onClick={() => certifyLog(log.date)}
                            disabled={certifyLoading}
                            sx={{ borderColor: '#10b981', color: '#10b981', fontSize: '0.75rem' }}
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
                    <TableCell colSpan={6} sx={{ color: '#6b7280', textAlign: 'center', py: 3 }}>
                      No log history found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* 70h Cycle Detail */}
      {summary && (
        <Card sx={{ bgcolor: 'rgba(124,140,248,0.08)', border: '1.5px solid rgba(255,255,255,0.08)', borderRadius: 3, mt: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>
              70-Hour Cycle Detail (last 8 days)
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
              <Typography variant="body2" sx={{ color: '#9ca3af', minWidth: 120 }}>On-Duty Used:</Typography>
              <LinearProgress
                variant="determinate"
                value={pct(summary.usedOnDutyHours * 60, 4200)}
                sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { bgcolor: '#6366f1' } }}
              />
              <Typography variant="body2" sx={{ color: '#6366f1', fontWeight: 700, minWidth: 60 }}>
                {summary.usedOnDutyHours}h / 70h
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="body2" sx={{ color: '#9ca3af', minWidth: 120 }}>Drive Used:</Typography>
              <LinearProgress
                variant="determinate"
                value={pct(summary.usedDriveHours * 60, 4200)}
                sx={{ flex: 1, height: 10, borderRadius: 5, bgcolor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { bgcolor: '#10b981' } }}
              />
              <Typography variant="body2" sx={{ color: '#10b981', fontWeight: 700, minWidth: 60 }}>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, p: 1.5, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
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
            sx={{ mb: 2, input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' } } }}
            InputProps={{ endAdornment: <Typography variant="caption" sx={{ color: '#6b7280' }}>mi</Typography> }}
          />
          <TextField
            label="Notes (optional)"
            fullWidth
            size="small"
            multiline
            rows={2}
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            sx={{ input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root': { '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' }, color: '#fff' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setStatusDialog(false)} sx={{ color: '#9ca3af' }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitStatus}
            disabled={statusLoading}
            sx={{ bgcolor: statusMeta(pendingStatus).color, '&:hover': { bgcolor: statusMeta(pendingStatus).color, opacity: 0.85 } }}
          >
            {statusLoading ? <CircularProgress size={20} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
