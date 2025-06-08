// ── src/pages/CarrierMyLoads.js ─────────────────────────────────
import React, { useState, useEffect, useMemo } from 'react';
import {
  Typography,
  Box,
  Paper,
  Grid,
  CircularProgress,
  Snackbar,
  Alert,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Skeleton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import api from '../services/api';
import StatusChip from '../features/carrierDashboard/sections/components/StatusChip';
import LoadDetailsModal from '../components/LoadDetailsModal';

export default function CarrierMyLoads({ embedded = false }) {
  const theme = useTheme();

  /* ── state ────────────────────────────────────────────────── */
  const [loads, setLoads] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snack, setSnack] = useState(false);

  // state for modal
  const [selected, setSelected] = useState(null);

  /* ── fetch loads once ─────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const { data } = await api.get('/loads/my-loads', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLoads(data);
      } catch (err) {
        setError('Failed to fetch loads. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── sort helper ──────────────────────────────────────────── */
  const sortLoads = (list) => {
    const rank = { accepted: 0, 'in-transit': 1, delivered: 2 };
    return [...list].sort((a, b) => {
      const rA = rank[a.status] ?? 99;
      const rB = rank[b.status] ?? 99;
      if (rA !== rB) return rA - rB;
      if (a.status === 'delivered' && b.status === 'delivered') {
        const dateA = new Date(a.deliveredAt || a.updatedAt || 0).getTime();
        const dateB = new Date(b.deliveredAt || b.updatedAt || 0).getTime();
        return dateB - dateA;
      }
      return 0;
    });
  };

  /* ── filtered + sorted list (memoised) ────────────────────── */
  const viewLoads = useMemo(() => {
    const base =
      statusFilter === 'all'
        ? loads
        : loads.filter((l) => l.status === statusFilter);
    return sortLoads(base);
  }, [loads, statusFilter]);

  /* ── update status on dropdown change ─────────────────────── */
  const updateStatus = async (id, newStatus) => {
    try {
      const token = localStorage.getItem('token');
      await api.put(
        `/loads/${id}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLoads((prev) =>
        prev.map((l) =>
          l._id === id
            ? { ...l, status: newStatus, updatedAt: new Date().toISOString() }
            : l
        )
      );
      setSnack(true);
    } catch (err) {
      setError('Failed to update status.');
      console.error(err);
    }
  };

  /* ── accent colours for card strips ───────────────────────── */
  const accent = {
    accepted: '#a78bfa',
    'in-transit': '#fbbf24',
    delivered: '#34d399',
    open: '#22d3ee',
  };

  /* ── UI ───────────────────────────────────────────────────── */
  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', pt: embedded ? 0 : 2 }}>
      {!embedded && (
        <Typography variant="h4" fontWeight={700} mb={2}>
          My Loads
        </Typography>
      )}

      {/* filter dropdown */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Status</InputLabel>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
            <MenuItem value="in-transit">In Transit</MenuItem>
            <MenuItem value="delivered">Delivered</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Grid item xs={12} md={6} key={i}>
              <Skeleton
                variant="rectangular"
                height={120}
                sx={{ borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)' }}
              />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Grid container spacing={2}>
          {viewLoads.length ? (
            viewLoads.map((l) => (
              <Grid item xs={12} md={6} key={l._id}>
                <Paper
                  className="glass-card"
                  sx={{
                    p: 2,
                    borderLeft: `6px solid ${accent[l.status] || accent.open}`,
                    cursor: 'pointer'
                  }}
                  onClick={() => setSelected(l)}
                >
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                    mb={1}
                  >
                    <Typography fontWeight={600}>
                      {l.origin} → {l.destination}
                    </Typography>
                    <FormControl
                      size="small"
                      sx={{ minWidth: 140 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        value={l.status}
                        onChange={(e) => updateStatus(l._id, e.target.value)}
                      >
                        <MenuItem value="accepted">Accepted</MenuItem>
                        <MenuItem value="in-transit">In Transit</MenuItem>
                        <MenuItem value="delivered">Delivered</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>

                  <Typography variant="body2" color="text.secondary" mb={1}>
                    Rate: ${l.rate.toLocaleString()}
                  </Typography>

                  {l.status === 'delivered' && (
                    <Box
                      sx={{
                        mt: 1,
                        px: 1.5,
                        py: 0.5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1,
                        bgcolor: 'rgba(52,211,153,0.15)',
                        borderRadius: 1,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <Typography
                        variant="body2"
                        sx={{ color: '#34d399', fontWeight: 600 }}
                      >
                        Delivered
                      </Typography>
                    </Box>
                  )}

                  {l.status !== 'delivered' && (
                    <StatusChip status={l.status} />
                  )}
                </Paper>
              </Grid>
            ))
          ) : (
            <Typography>No loads match this filter.</Typography>
          )}
        </Grid>
      )}

      {/* success snackbar */}
      <Snackbar
        open={snack}
        autoHideDuration={3000}
        onClose={() => setSnack(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Status updated!
        </Alert>
      </Snackbar>

      {/* details modal */}
      {selected && (
        <LoadDetailsModal
          load={selected}
          userRole="carrier"
          onClose={() => setSelected(null)}
          onLoadAccepted={(id) => {
            // remove from list immediately if you like:
            setLoads((prev) => prev.filter((l) => l._id !== id));
            setSelected(null);
          }}
        />
      )}
    </Box>
  );
}
