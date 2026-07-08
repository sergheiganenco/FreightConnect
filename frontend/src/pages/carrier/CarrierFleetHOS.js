import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Chip, CircularProgress, Alert, Stack, IconButton, Tooltip,
  Table, TableBody, TableCell, TableHead, TableRow, LinearProgress,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import api from '../../services/api';

const STATUS_COLOR = {
  DRIVING: 'error',
  ON_DUTY_NOT_DRIVING: 'warning',
  SLEEPER_BERTH: 'info',
  OFF_DUTY: 'success',
};
const STATUS_LABEL = {
  DRIVING: 'Driving',
  ON_DUTY_NOT_DRIVING: 'On duty',
  SLEEPER_BERTH: 'Sleeper',
  OFF_DUTY: 'Off duty',
};

const fmtHrs = (mins) => {
  const m = Math.max(0, Math.round(mins || 0));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

// 11h driving limit = 660 min; colour the bar by how little is left.
function RemainingBar({ minutes, limit }) {
  const pct = Math.max(0, Math.min(100, (minutes / limit) * 100));
  const color = minutes <= 30 ? 'error' : minutes <= 120 ? 'warning' : 'success';
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(minutes)} left</Typography>
      <LinearProgress variant="determinate" value={pct} color={color} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />
    </Box>
  );
}

export default function CarrierFleetHOS() {
  const [drivers, setDrivers] = useState([]);
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/eld/fleet');
      setDrivers(res.data.drivers || []);
      setDate(res.data.date || '');
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load fleet HOS');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>Fleet HOS</Typography>
          <Typography variant="body2" color="text.secondary">
            Live hours-of-service across your drivers{date ? ` — ${date}` : ''}. Advisory only, not a registered ELD.
          </Typography>
        </Box>
        <Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip>
      </Stack>

      {error && <Alert severity={error.includes('owners and dispatchers') ? 'info' : 'error'} sx={{ my: 2 }}>{error}</Alert>}

      {!error && (
        <>
          {/* Desktop / tablet: full table (md and up) */}
          <Paper variant="outlined" sx={{ mt: 2, overflowX: 'auto', display: { xs: 'none', md: 'block' } }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Driver</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Drove today</TableCell>
                  <TableCell>Drive remaining</TableCell>
                  <TableCell>14h window left</TableCell>
                  <TableCell align="center">Violations</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {drivers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        No driver logs yet today. Drivers appear here once they log a duty status.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {drivers.map((d) => (
                  <TableRow key={d.driverId}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {d.name}
                      {d.companyRole && d.companyRole !== 'owner' && (
                        <Chip size="small" label={d.companyRole} sx={{ ml: 1 }} variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={STATUS_LABEL[d.currentStatus] || d.currentStatus} color={STATUS_COLOR[d.currentStatus] || 'default'} />
                    </TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(d.drivingMinutesToday)}</TableCell>
                    <TableCell><RemainingBar minutes={d.driveRemainingMinutes} limit={660} /></TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(d.windowRemainingMinutes)}</TableCell>
                    <TableCell align="center">
                      {d.violations > 0
                        ? <Chip size="small" color="error" label={d.violations} />
                        : <Typography variant="body2" color="text.secondary">—</Typography>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          {/* Phone: stacked cards (below md) so nothing overflows the screen */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 2 }}>
            {drivers.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                  No driver logs yet today. Drivers appear here once they log a duty status.
                </Typography>
              </Paper>
            ) : drivers.map((d) => (
              <Paper key={d.driverId} variant="outlined" sx={{ p: 2, mb: 1.5 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
                  <Typography sx={{ fontWeight: 700, minWidth: 0, wordBreak: 'break-word' }}>
                    {d.name}
                    {d.companyRole && d.companyRole !== 'owner' && (
                      <Chip size="small" label={d.companyRole} sx={{ ml: 1 }} variant="outlined" />
                    )}
                  </Typography>
                  <Chip
                    size="small"
                    label={STATUS_LABEL[d.currentStatus] || d.currentStatus}
                    color={STATUS_COLOR[d.currentStatus] || 'default'}
                    sx={{ flexShrink: 0 }}
                  />
                </Stack>

                <Box sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block">Drive remaining</Typography>
                  <RemainingBar minutes={d.driveRemainingMinutes} limit={660} />
                </Box>

                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mt: 1.5 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">Drove today</Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(d.drivingMinutesToday)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">14h window left</Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHrs(d.windowRemainingMinutes)}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" color="text.secondary" display="block">Violations</Typography>
                    {d.violations > 0
                      ? <Chip size="small" color="error" label={d.violations} />
                      : <Typography variant="body2" color="text.secondary">—</Typography>}
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
