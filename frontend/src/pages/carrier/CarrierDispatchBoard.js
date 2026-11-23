/**
 * CarrierDispatchBoard -- every truck, what it is doing now, what is next, what needs attention.
 * One request per refresh (GET /dispatch/board); the server does all the aggregation.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Paper, Stack, Chip, Button, IconButton, TextField, InputAdornment, CircularProgress,
  Alert, Collapse, TablePagination, Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import api from '../../services/api';
import LoadDetailsModal from '../../components/LoadDetailsModal';
import { glassCard, text as T, semantic, tint } from '../../theme/tokens';

const REFRESH_MS = 60000;
const SEARCH_DEBOUNCE_MS = 300;

const STATE_META = {
  needs_attention: { label: 'Needs attention', color: semantic.error },
  in_transit: { label: 'In transit', color: semantic.info },
  booked: { label: 'Booked', color: '#818cf8' },
  idle: { label: 'Idle', color: semantic.success },
  out_of_service: { label: 'Out of service', color: semantic.muted },
};
const TILES = [...Object.keys(STATE_META), 'unassigned'];

const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const ageText = (min) => (min >= 120 ? `${Math.round(min / 60)} h ago` : min < 1 ? 'just now' : `${min} min ago`);
const nextText = (ev) => (ev ? `${ev.type === 'pickup' ? 'Pickup' : 'Deliver'} by ${fmtTime(ev.at)}` : null);

function Tile({ id, label, color, count, active, onClick }) {
  return (
    <Paper
      component="button" type="button" onClick={onClick} aria-pressed={active}
      sx={{
        ...glassCard.standard, p: 1.5, textAlign: 'left', cursor: 'pointer', minWidth: 0, font: 'inherit',
        border: `1px solid ${active ? color : 'rgba(255,255,255,0.1)'}`, bgcolor: active ? tint(color, 0.15) : undefined,
      }}
    >
      <Typography variant="h5" fontWeight={800} sx={{ color }}>{count ?? '–'}</Typography>
      <Typography variant="caption" sx={{ color: T.strong }} data-tile={id}>{label}</Typography>
    </Paper>
  );
}

function LoadLine({ load }) {
  if (!load) return <Typography variant="body2" sx={{ color: T.muted }}>No load</Typography>;
  const next = nextText(load.nextEvent);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" sx={{ color: T.primary }} noWrap>{load.origin} → {load.destination}</Typography>
      <Typography variant="caption" sx={{ color: T.secondary }}>{load.title}{next ? ` · ${next}` : ''}</Typography>
    </Box>
  );
}

function TruckRow({ row, onOpen, onPlan }) {
  const meta = STATE_META[row.state];
  const p = row.position;
  return (
    <Paper sx={{ ...glassCard.subtle, p: 1.5, borderLeft: `3px solid ${meta.color}` }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ sm: 'center' }}>
        <Box sx={{ width: { sm: 150 }, flexShrink: 0 }}>
          <Typography fontWeight={800} sx={{ color: T.primary }}>{row.truckId}</Typography>
          <Typography variant="caption" sx={{ color: T.secondary }}>{row.driverName || 'No driver'}</Typography>
        </Box>
        <Box sx={{ width: { sm: 130 }, flexShrink: 0 }}>
          <Chip size="small" label={meta.label} sx={{ bgcolor: tint(meta.color, 0.2), color: meta.color, fontWeight: 700 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <LoadLine load={row.currentLoad} />
          {row.nextLoads > 0 && <Typography variant="caption" sx={{ color: T.muted }}>+{row.nextLoads} more booked</Typography>}
          {row.reasons.map((r) => (
            <Typography key={r} variant="body2" sx={{ color: semantic.warning, fontWeight: 600 }}>{r}</Typography>
          ))}
        </Box>
        <Box sx={{ width: { sm: 120 }, flexShrink: 0 }}>
          <Typography variant="caption" sx={{ color: T.secondary }}>
            {p ? `Position ${ageText(p.ageMinutes)}${p.confirmed ? '' : ' (unconfirmed)'}` : 'No position'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          {row.currentLoad && <Button size="small" variant="outlined" sx={{ color: "#c4b5fd" }} onClick={() => onOpen(row.currentLoad._id)}>Open load</Button>}
          {row.state === 'idle' && <Button size="small" variant="contained" onClick={() => onPlan(row.truckId)}>Plan loads</Button>}
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function CarrierDispatchBoard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [state, setState] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [selected, setSelected] = useState(null);
  const [openError, setOpenError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput.trim()); setPage(1); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    const mine = ++seq.current; // ignore out-of-order responses
    try {
      const params = { page, pageSize };
      if (state) params.state = state;
      if (q) params.q = q;
      const res = await api.get('/dispatch/board', { params });
      if (mine !== seq.current) return;
      setData(res.data.data);
      setUpdatedAt(new Date());
      setError('');
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Could not load the dispatch board.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [page, pageSize, state, q]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Auto-refresh while the tab is visible; skip ticks while hidden and catch up when it becomes visible again.
  useEffect(() => {
    const tick = () => { if (!document.hidden) load(); };
    const id = setInterval(tick, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const openLoad = async (id) => {
    setOpenError('');
    try {
      const res = await api.get(`/loads/${id}`);
      setSelected(res.data);
    } catch (err) {
      setOpenError(err.response?.data?.error || 'Could not open that load.');
    }
  };

  const pickTile = (id) => {
    if (id === 'unassigned') { setShowUnassigned((v) => !v); return; }
    setState((cur) => (cur === id ? '' : id));
    setPage(1);
  };

  const summary = data?.summary;
  const noTrucks = data && data.totalTrucks === 0;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={2} flexWrap="wrap">
        <Typography variant="h5" fontWeight={800} sx={{ color: T.primary, flex: 1 }}>Dispatch Board</Typography>
        {updatedAt && <Typography variant="caption" sx={{ color: T.secondary }}>Updated {updatedAt.toLocaleTimeString()}</Typography>}
        <Tooltip title="Refresh">
          <span><IconButton onClick={() => { setLoading(true); load(); }} disabled={loading} aria-label="Refresh" sx={{ color: T.primary }}><RefreshIcon /></IconButton></span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {openError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setOpenError('')}>{openError}</Alert>}
      {data?.truncated && <Alert severity="warning" sx={{ mb: 2 }}>You have a very large number of active loads; only the earliest are shown.</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(6, 1fr)' }, gap: 1.5, mb: 2 }}>
        {TILES.map((id) => (
          <Tile
            key={id} id={id}
            label={id === 'unassigned' ? 'Loads without a truck' : STATE_META[id].label}
            color={id === 'unassigned' ? semantic.orange : STATE_META[id].color}
            count={summary?.[id]}
            active={id === 'unassigned' ? showUnassigned : state === id}
            onClick={() => pickTile(id)}
          />
        ))}
      </Box>

      <Collapse in={showUnassigned} unmountOnExit>
        <Paper sx={{ ...glassCard.standard, p: 2, mb: 2 }}>
          <Typography fontWeight={700} sx={{ color: T.primary }} mb={1}>
            Loads without a truck ({data?.unassigned.total ?? 0})
          </Typography>
          {data?.unassigned.total === 0 && <Typography variant="body2" sx={{ color: T.secondary }}>Every booked load has a truck.</Typography>}
          <Stack spacing={1}>
            {(data?.unassigned.loads || []).map((l) => (
              <Stack key={l._id} direction="row" alignItems="center" spacing={2}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <LoadLine load={l} />
                </Box>
                <Button size="small" variant="outlined" sx={{ color: "#c4b5fd" }} onClick={() => openLoad(l._id)}>Open load</Button>
              </Stack>
            ))}
          </Stack>
          {data && data.unassigned.total > data.unassigned.loads.length && (
            <Typography variant="caption" sx={{ color: T.secondary }}>Showing the first {data.unassigned.loads.length}.</Typography>
          )}
        </Paper>
      </Collapse>

      <TextField
        size="small" fullWidth value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search truck, driver, load, origin or destination"
        inputProps={{ maxLength: 100, 'aria-label': 'Search trucks' }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
        sx={{ mb: 2, input: { color: T.primary } }}
      />

      {loading && !data && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress /></Box>}

      {noTrucks && (
        <Paper sx={{ ...glassCard.subtle, p: 4, textAlign: 'center' }}>
          <Typography sx={{ color: T.primary }} mb={1}>You have no trucks yet.</Typography>
          <Button component={RouterLink} to="/dashboard/carrier/fleet" variant="contained">Add trucks in Fleet</Button>
        </Paper>
      )}

      {data && !noTrucks && data.totalRows === 0 && (
        <Paper sx={{ ...glassCard.subtle, p: 4, textAlign: 'center' }}>
          <Typography sx={{ color: T.secondary }}>No trucks match{state ? ` "${STATE_META[state].label}"` : ''}{q ? ` "${q}"` : ''}.</Typography>
        </Paper>
      )}

      <Stack spacing={1}>
        {(data?.trucks || []).map((r) => (
          <TruckRow key={r.truckId} row={r} onOpen={openLoad} onPlan={(id) => navigate(`/dashboard/carrier/autopilot?truckId=${encodeURIComponent(id)}`)} />
        ))}
      </Stack>

      {data && data.totalRows > 0 && (
        <TablePagination
          component="div" count={data.totalRows} page={data.page - 1}
          onPageChange={(_, p) => setPage(p + 1)}
          rowsPerPage={pageSize} rowsPerPageOptions={[10, 25, 50, 100]}
          onRowsPerPageChange={(e) => { setPageSize(+e.target.value); setPage(1); }}
          sx={{ color: T.primary, '& .MuiSvgIcon-root': { color: T.primary } }}
        />
      )}

      {selected && (
        <LoadDetailsModal
          load={selected} userRole="carrier"
          onClose={() => { setSelected(null); load(); }}
          onLoadAccepted={() => { setSelected(null); load(); }}
        />
      )}
    </Box>
  );
}
