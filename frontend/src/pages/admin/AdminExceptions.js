/**
 * AdminExceptions.js
 *
 * Admin view of all filed exceptions across the platform.
 *
 * Features:
 *  - Filter by status (all / open / investigating / resolved / dismissed)
 *  - Filter by type (all / dispute / delay / cargo_damage / etc.)
 *  - Paginated list cards
 *  - Click to open detail drawer: view notes thread, update status, add note
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Chip, CircularProgress, Pagination,
  FormControl, InputLabel, Select, MenuItem, Paper, Button,
  Drawer, Divider, TextField, Alert, IconButton, Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SendIcon from '@mui/icons-material/Send';
import api from '../../services/api';

const STATUS_OPTIONS = [
  { value: 'all',           label: 'All Statuses' },
  { value: 'open',          label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'resolved',      label: 'Resolved' },
  { value: 'dismissed',     label: 'Dismissed' },
];

const TYPE_OPTIONS = [
  { value: 'all',           label: 'All Types' },
  { value: 'dispute',       label: 'Dispute' },
  { value: 'delay',         label: 'Delay' },
  { value: 'cargo_damage',  label: 'Cargo Damage' },
  { value: 'missed_pickup', label: 'Missed Pickup' },
  { value: 'overcharge',    label: 'Overcharge' },
  { value: 'other',         label: 'Other' },
];

const SEVERITY_COLOR = { low: '#94a3b8', medium: '#fbbf24', high: '#f97316', critical: '#ef4444' };
const STATUS_COLOR   = { open: '#6366f1', investigating: '#fbbf24', resolved: '#34d399', dismissed: '#94a3b8' };

const PAGE_SIZE = 10;

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function SeverityChip({ severity }) {
  return (
    <Chip
      label={severity}
      size="small"
      sx={{
        bgcolor: `${SEVERITY_COLOR[severity] || '#94a3b8'}22`,
        color: SEVERITY_COLOR[severity] || '#94a3b8',
        fontWeight: 700, fontSize: '0.68rem', textTransform: 'capitalize',
      }}
    />
  );
}

function StatusChipEl({ status }) {
  return (
    <Chip
      label={status}
      size="small"
      sx={{
        bgcolor: `${STATUS_COLOR[status] || '#94a3b8'}22`,
        color: STATUS_COLOR[status] || '#94a3b8',
        fontWeight: 700, fontSize: '0.68rem', textTransform: 'capitalize',
      }}
    />
  );
}

// ── Detail Drawer ──────────────────────────────────────────────────────────
function ExceptionDrawer({ exception, onClose, onUpdated }) {
  const [newStatus, setNewStatus] = useState(exception?.status || 'open');
  const [resolution, setResolution] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (exception) {
      setNewStatus(exception.status);
      setResolution('');
      setNoteContent('');
      setError('');
      setSuccess('');
    }
  }, [exception?._id]);

  const handleStatusUpdate = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/exceptions/${exception._id}/status`, {
        status: newStatus,
        resolution: resolution.trim() || undefined,
      });
      setSuccess('Status updated.');
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status');
    }
    setSaving(false);
  };

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/exceptions/${exception._id}/notes`, { content: noteContent.trim() });
      setNoteContent('');
      setSuccess('Note added.');
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add note');
    }
    setSaving(false);
  };

  if (!exception) return null;

  const load = exception.loadId;

  return (
    <Drawer
      anchor="right"
      open={!!exception}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100vw', sm: 520 },
          bgcolor: '#1a1035',
          color: '#fff',
          p: 3,
          overflowY: 'auto',
        },
      }}
    >
      {/* Header */}
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={2}>
        <Box flex={1}>
          <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
            <WarningAmberIcon sx={{ color: SEVERITY_COLOR[exception.severity], fontSize: 22 }} />
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.2 }}>
              {exception.title}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" gap={0.5}>
            <SeverityChip severity={exception.severity} />
            <StatusChipEl status={exception.status} />
            <Chip label={exception.type.replace('_', ' ')} size="small"
                  sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: '#c4b5fd', fontWeight: 600, fontSize: '0.68rem', textTransform: 'capitalize' }} />
            {exception.autoFlagged && (
              <Chip label="Auto-flagged" size="small"
                    sx={{ bgcolor: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 700, fontSize: '0.68rem' }} />
            )}
          </Stack>
        </Box>
        <IconButton onClick={onClose} sx={{ color: '#fff', mt: -0.5 }}><CloseIcon /></IconButton>
      </Stack>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

      {/* Load info */}
      {load && (
        <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)' }}>
          <Typography variant="caption" sx={{ color: '#a78bfa', fontWeight: 700, display: 'block', mb: 0.25 }}>
            LOAD
          </Typography>
          <Typography fontWeight={700} fontSize="0.95rem">
            {load.origin} → {load.destination}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.55)' }}>
            {load.title} · Status: {load.status}
          </Typography>
        </Box>
      )}

      {/* Filed by */}
      <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.05)' }}>
        <Typography variant="caption" sx={{ color: '#a78bfa', fontWeight: 700, display: 'block', mb: 0.25 }}>
          FILED BY
        </Typography>
        <Typography fontWeight={700} fontSize="0.95rem">
          {exception.filedBy?.name || 'N/A'}
          {exception.filedBy?.companyName ? ` · ${exception.filedBy.companyName}` : ''}
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.55)' }}>
          {exception.filedBy?.email} · Role: {exception.filedByRole}
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)', display: 'block', mt: 0.25 }}>
          Filed {fmtDate(exception.createdAt)}
        </Typography>
      </Box>

      {/* Description */}
      <Typography variant="caption" sx={{ color: '#a78bfa', fontWeight: 700, display: 'block', mb: 0.5 }}>
        DESCRIPTION
      </Typography>
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)', mb: 2, lineHeight: 1.6 }}>
        {exception.description}
      </Typography>

      {exception.claimAmount && (
        <Box mb={2} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)' }}>
          <Typography variant="body2" fontWeight={700} sx={{ color: '#f97316' }}>
            Claim Amount: ${exception.claimAmount.toLocaleString()}
          </Typography>
        </Box>
      )}

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

      {/* Notes thread */}
      <Typography variant="caption" sx={{ color: '#a78bfa', fontWeight: 700, display: 'block', mb: 1 }}>
        NOTES ({exception.notes?.length || 0})
      </Typography>
      <Stack spacing={1} mb={2}>
        {(exception.notes || []).map((note, i) => (
          <Box key={note._id || i} sx={{
            p: 1.5, borderRadius: 2,
            bgcolor: note.authorRole === 'admin' ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${note.authorRole === 'admin' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.08)'}`,
          }}>
            <Stack direction="row" justifyContent="space-between" mb={0.25}>
              <Typography variant="caption" fontWeight={700} sx={{ color: note.authorRole === 'admin' ? '#818cf8' : '#c4b5fd', textTransform: 'capitalize' }}>
                {note.authorRole === 'system' ? 'System' : note.author?.name || note.authorRole}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>
                {fmtDate(note.createdAt)}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 }}>
              {note.content}
            </Typography>
          </Box>
        ))}
        {(!exception.notes || exception.notes.length === 0) && (
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)' }}>No notes yet.</Typography>
        )}
      </Stack>

      {/* Add note */}
      <Stack direction="row" spacing={1} mb={2}>
        <TextField
          size="small" fullWidth multiline maxRows={3}
          placeholder="Add a note…"
          value={noteContent}
          onChange={e => setNoteContent(e.target.value)}
          sx={{
            '& .MuiInputBase-root': { bgcolor: 'rgba(255,255,255,0.07)', color: '#fff', borderRadius: 2 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
          }}
        />
        <Tooltip title="Add note">
          <span>
            <IconButton
              onClick={handleAddNote}
              disabled={saving || !noteContent.trim()}
              sx={{ bgcolor: '#6366f1', color: '#fff', borderRadius: 2, '&:hover': { bgcolor: '#4f46e5' }, '&.Mui-disabled': { bgcolor: 'rgba(99,102,241,0.3)' } }}
            >
              {saving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <SendIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

      {/* Status update */}
      <Typography variant="caption" sx={{ color: '#a78bfa', fontWeight: 700, display: 'block', mb: 1 }}>
        UPDATE STATUS
      </Typography>
      <Stack spacing={1.5}>
        <FormControl size="small" fullWidth>
          <InputLabel sx={{ color: 'rgba(255,255,255,0.6)' }}>Status</InputLabel>
          <Select
            value={newStatus}
            label="Status"
            onChange={e => setNewStatus(e.target.value)}
            sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.07)', '& .MuiSvgIcon-root': { color: '#fff' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' } }}
          >
            {STATUS_OPTIONS.filter(s => s.value !== 'all').map(s => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {['resolved', 'dismissed'].includes(newStatus) && (
          <TextField
            size="small" fullWidth
            label="Resolution note (optional)"
            value={resolution}
            onChange={e => setResolution(e.target.value)}
            sx={{
              '& .MuiInputBase-root': { bgcolor: 'rgba(255,255,255,0.07)', color: '#fff', borderRadius: 2 },
              '& label': { color: 'rgba(255,255,255,0.55)' },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
            }}
          />
        )}
        {error && <Alert severity="error" sx={{ py: 0 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ py: 0 }}>{success}</Alert>}
        <Button
          variant="contained"
          onClick={handleStatusUpdate}
          disabled={saving || newStatus === exception.status}
          sx={{ bgcolor: '#f04ca7', borderRadius: 9999, fontWeight: 700, '&:hover': { bgcolor: '#d63a90' } }}
        >
          {saving ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : 'Update Status'}
        </Button>
      </Stack>
    </Drawer>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function AdminExceptions() {
  const [exceptions, setExceptions] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const fetchExceptions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: PAGE_SIZE });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const { data } = await api.get(`/exceptions?${params}`);
      setExceptions(data.exceptions || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch { /* silent */ }
    setLoading(false);
  }, [page, statusFilter, typeFilter]);

  useEffect(() => { fetchExceptions(); }, [fetchExceptions]);
  useEffect(() => { setPage(1); }, [statusFilter, typeFilter]);

  // Re-fetch detail when admin updates an exception (to refresh notes/status)
  const handleUpdated = async () => {
    fetchExceptions();
    if (selected) {
      try {
        const { data } = await api.get(`/exceptions/${selected._id}`);
        setSelected(data);
      } catch { /* ignore */ }
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      {/* Page header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }}
             justifyContent="space-between" mb={3} gap={2}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <WarningAmberIcon sx={{ color: '#f97316', fontSize: 28 }} />
            <Typography variant="h4" fontWeight={900} sx={{ color: '#fff', letterSpacing: 1 }}>
              Exceptions
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mt: 0.5 }}>
            {total} exception{total !== 1 ? 's' : ''} filed across the platform
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel sx={{ color: '#fff' }}>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={e => setStatusFilter(e.target.value)}
              sx={{ bgcolor: '#4c318f', color: '#fff', borderRadius: 2, '& .MuiSvgIcon-root': { color: '#fff' } }}
            >
              {STATUS_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel sx={{ color: '#fff' }}>Type</InputLabel>
            <Select
              value={typeFilter}
              label="Type"
              onChange={e => setTypeFilter(e.target.value)}
              sx={{ bgcolor: '#4c318f', color: '#fff', borderRadius: 2, '& .MuiSvgIcon-root': { color: '#fff' } }}
            >
              {TYPE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      </Stack>

      {/* List */}
      {loading ? (
        <Stack alignItems="center" mt={8}><CircularProgress sx={{ color: '#a78bfa' }} /></Stack>
      ) : exceptions.length === 0 ? (
        <Typography sx={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', mt: 8 }}>
          No exceptions match the current filters.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {exceptions.map(exc => {
            const load = exc.loadId;
            return (
              <Paper
                key={exc._id}
                elevation={6}
                onClick={() => setSelected(exc)}
                sx={{
                  background: 'linear-gradient(135deg,#1e1050 60%,#2d1b69 100%)',
                  borderRadius: 4,
                  px: { xs: 2, sm: 3 },
                  py: 2,
                  cursor: 'pointer',
                  border: `1px solid ${SEVERITY_COLOR[exc.severity]}33`,
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                  '&:hover': {
                    borderColor: SEVERITY_COLOR[exc.severity],
                    boxShadow: `0 0 0 2px ${SEVERITY_COLOR[exc.severity]}40`,
                  },
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
                  {/* Left */}
                  <Box flex={1} minWidth={0}>
                    <Stack direction="row" alignItems="center" spacing={1} mb={0.5} flexWrap="wrap">
                      <Typography fontWeight={800} sx={{ color: '#fff', fontSize: '1rem' }}>
                        {exc.title}
                      </Typography>
                      {exc.autoFlagged && (
                        <Chip label="Auto-flagged" size="small"
                              sx={{ bgcolor: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 700, fontSize: '0.62rem' }} />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={0.75} flexWrap="wrap" gap={0.5} mb={1}>
                      <SeverityChip severity={exc.severity} />
                      <StatusChipEl status={exc.status} />
                      <Chip label={exc.type.replace('_', ' ')} size="small"
                            sx={{ bgcolor: 'rgba(255,255,255,0.07)', color: '#c4b5fd', fontWeight: 600, fontSize: '0.65rem', textTransform: 'capitalize' }} />
                    </Stack>
                    {load && (
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)', display: 'block' }}>
                        Load: {load.origin} → {load.destination} · {load.title}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)' }}>
                      Filed by {exc.filedBy?.name || exc.filedByRole} · {fmtDate(exc.createdAt)}
                    </Typography>
                  </Box>

                  {/* Right */}
                  <Stack alignItems="flex-end" justifyContent="center" spacing={0.75} flexShrink={0}>
                    {exc.claimAmount && (
                      <Typography fontWeight={800} sx={{ color: '#f97316', fontSize: '1.1rem' }}>
                        ${exc.claimAmount.toLocaleString()}
                      </Typography>
                    )}
                    <Chip
                      label={`${exc.notes?.length || 0} note${exc.notes?.length !== 1 ? 's' : ''}`}
                      size="small"
                      sx={{ bgcolor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)', fontSize: '0.68rem' }}
                    />
                    <Button
                      size="small" variant="outlined"
                      sx={{ borderColor: '#f04ca7', color: '#f04ca7', borderRadius: 9999, fontSize: '0.72rem', fontWeight: 700, '&:hover': { bgcolor: 'rgba(240,76,167,0.1)' } }}
                      onClick={e => { e.stopPropagation(); setSelected(exc); }}
                    >
                      Manage
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <Stack direction="row" justifyContent="center" mt={4}>
          <Pagination
            count={pages}
            page={page}
            onChange={(_, val) => setPage(val)}
            sx={{
              '& .MuiPaginationItem-root': {
                bgcolor: '#4c318f', color: '#fff', borderRadius: 2, fontWeight: 700,
                '&.Mui-selected': { bgcolor: '#f04ca7', color: '#fff' },
              },
            }}
          />
        </Stack>
      )}

      {/* Detail Drawer */}
      <ExceptionDrawer
        exception={selected}
        onClose={() => setSelected(null)}
        onUpdated={handleUpdated}
      />
    </Box>
  );
}
