/**
 * AdminVerifications.js
 *
 * Admin verification queue for carriers and shippers.
 *
 * Features:
 *  - Two tabs: Carriers / Shippers with count badges
 *  - Carrier cards: name, email, company, MC/DOT, FMCSA status, documents w/ verify/reject per doc
 *  - Shipper cards: name, email, company, EIN (masked), email domain badge, payment status, documents
 *  - Approve / Reject per user (rejection requires note)
 *  - Loading spinner, empty state, success/error snackbar, refresh button
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Stack, Chip, CircularProgress, Paper, Button,
  Tabs, Tab, Badge, IconButton, Tooltip, Snackbar, Alert, TextField,
  Collapse,
} from '@mui/material';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import BusinessIcon from '@mui/icons-material/Business';
import EmailIcon from '@mui/icons-material/Email';
import DescriptionIcon from '@mui/icons-material/Description';
import api from '../../services/api';
import { brand, semantic, surface, text as T, tint, gradient } from '../../theme/tokens';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function maskEIN(ein) {
  if (!ein) return 'N/A';
  const s = String(ein).replace(/\D/g, '');
  if (s.length < 4) return '***';
  return '***-**-' + s.slice(-4);
}

function isFreeDomain(email) {
  if (!email) return true;
  const free = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'mail.com', 'protonmail.com'];
  const domain = email.split('@')[1]?.toLowerCase();
  return free.includes(domain);
}

function getVerificationLevel(user) {
  let level = 0;
  const v = user.verification || {};
  if (v.emailVerified) level++;
  if (v.documentsOnFile?.length > 0) level++;
  if (v.paymentMethodVerified) level++;
  if (v.status === 'verified') level++;
  return level;
}

// ── Document row ─────────────────────────────────────────────────────────────

function DocumentRow({ doc, userId, role, onAction }) {
  const [acting, setActing] = useState(false);

  const handleDocAction = async (action) => {
    setActing(true);
    try {
      await api.put(`/verification/admin/document-review/${userId}`, {
        docType: doc.type || doc.docType,
        action,
      });
      onAction(true, `Document ${action === 'verify' ? 'verified' : 'rejected'}`);
    } catch (err) {
      onAction(false, err.response?.data?.error || `Failed to ${action} document`);
    }
    setActing(false);
  };

  const isVerified = doc.verified || doc.status === 'verified';
  const isRejected = doc.status === 'rejected';

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: surface.glassSubtle,
        border: `1px solid ${surface.glassBorder}`,
      }}
    >
      <DescriptionIcon sx={{ color: brand.indigoLight, fontSize: 20 }} />
      <Box flex={1} minWidth={0}>
        <Typography variant="body2" fontWeight={700} sx={{ color: T.primary }}>
          {doc.type || doc.docType || 'Document'}
        </Typography>
        {doc.filename && (
          <Typography variant="caption" sx={{ color: T.muted }}>
            {doc.filename}
          </Typography>
        )}
        {doc.uploadedAt && (
          <Typography variant="caption" sx={{ color: T.muted, display: 'block' }}>
            Uploaded: {fmtDate(doc.uploadedAt)}
          </Typography>
        )}
      </Box>
      <Chip
        label={isVerified ? 'Verified' : isRejected ? 'Rejected' : 'Pending'}
        size="small"
        sx={{
          bgcolor: isVerified
            ? tint(semantic.success, 0.15)
            : isRejected
              ? tint(semantic.error, 0.15)
              : tint(semantic.warning, 0.15),
          color: isVerified ? semantic.success : isRejected ? semantic.error : semantic.warning,
          fontWeight: 700,
          fontSize: '0.68rem',
        }}
      />
      {!isVerified && (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Verify document">
            <span>
              <IconButton
                size="small"
                disabled={acting}
                onClick={() => handleDocAction('verify')}
                sx={{ color: semantic.success, '&:hover': { bgcolor: tint(semantic.success, 0.12) } }}
              >
                {acting ? <CircularProgress size={16} /> : <CheckCircleIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Reject document">
            <span>
              <IconButton
                size="small"
                disabled={acting}
                onClick={() => handleDocAction('reject')}
                sx={{ color: semantic.error, '&:hover': { bgcolor: tint(semantic.error, 0.12) } }}
              >
                <CancelIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}
    </Stack>
  );
}

// ── Carrier Card ─────────────────────────────────────────────────────────────

function CarrierCard({ user, onAction }) {
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState(false);

  const v = user.verification || {};
  const docs = v.documentsOnFile || [];

  const handleOverride = async (status) => {
    if (status === 'rejected' && !rejectNote.trim()) {
      setShowRejectNote(true);
      return;
    }
    setActing(true);
    try {
      await api.put(`/verification/admin/override/${user._id}`, {
        status,
        note: rejectNote.trim() || undefined,
      });
      onAction(true, `Carrier ${status === 'verified' ? 'approved' : 'rejected'}`);
      setShowRejectNote(false);
      setRejectNote('');
    } catch (err) {
      onAction(false, err.response?.data?.error || `Failed to ${status} carrier`);
    }
    setActing(false);
  };

  return (
    <Paper
      elevation={6}
      sx={{
        background: gradient.background,
        borderRadius: 4,
        px: { xs: 2, sm: 3 },
        py: 2.5,
        border: `1px solid ${surface.indigoBorderLight}`,
        transition: 'border-color 0.15s',
        '&:hover': { borderColor: brand.indigo },
      }}
    >
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5} mb={2}>
        <Box flex={1}>
          <Typography fontWeight={800} fontSize="1.1rem" sx={{ color: T.primary, mb: 0.25 }}>
            {user.name || 'N/A'}
          </Typography>
          <Typography variant="body2" sx={{ color: T.secondary }}>
            {user.email}
          </Typography>
          {user.companyName && (
            <Stack direction="row" alignItems="center" spacing={0.5} mt={0.5}>
              <BusinessIcon sx={{ color: brand.indigoLight, fontSize: 16 }} />
              <Typography variant="body2" sx={{ color: T.strong }}>
                {user.companyName}
              </Typography>
            </Stack>
          )}
        </Box>
        <Stack alignItems="flex-end" spacing={0.5}>
          <Chip
            label={v.status || 'pending'}
            size="small"
            sx={{
              bgcolor: tint(semantic.warning, 0.15),
              color: semantic.warning,
              fontWeight: 700,
              fontSize: '0.72rem',
              textTransform: 'capitalize',
            }}
          />
        </Stack>
      </Stack>

      {/* MC/DOT and FMCSA */}
      <Stack direction="row" spacing={2} mb={2} flexWrap="wrap" gap={1}>
        {v.fmcsaData?.mcNumber && (
          <Chip label={`MC# ${v.fmcsaData.mcNumber}`} size="small"
                sx={{ bgcolor: surface.glass, color: T.primary, fontWeight: 600 }} />
        )}
        {v.fmcsaData?.dotNumber && (
          <Chip label={`DOT# ${v.fmcsaData.dotNumber}`} size="small"
                sx={{ bgcolor: surface.glass, color: T.primary, fontWeight: 600 }} />
        )}
        {v.fmcsaData?.allowedToOperate != null && (
          <Chip
            label={v.fmcsaData.allowedToOperate ? 'FMCSA: Authorized' : 'FMCSA: Not Authorized'}
            size="small"
            sx={{
              bgcolor: v.fmcsaData.allowedToOperate ? tint(semantic.success, 0.15) : tint(semantic.error, 0.15),
              color: v.fmcsaData.allowedToOperate ? semantic.success : semantic.error,
              fontWeight: 700,
            }}
          />
        )}
        {v.fmcsaData?.companyName && (
          <Typography variant="caption" sx={{ color: T.muted, alignSelf: 'center' }}>
            FMCSA Name: {v.fmcsaData.companyName}
          </Typography>
        )}
      </Stack>

      {/* Documents */}
      {docs.length > 0 && (
        <Box mb={2}>
          <Typography variant="caption" sx={{ color: brand.indigoLight, fontWeight: 700, mb: 1, display: 'block' }}>
            DOCUMENTS ({docs.length})
          </Typography>
          <Stack spacing={1}>
            {docs.map((doc, i) => (
              <DocumentRow
                key={doc._id || i}
                doc={doc}
                userId={user._id}
                role="carrier"
                onAction={onAction}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Reject note */}
      <Collapse in={showRejectNote}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={3}
          placeholder="Rejection reason (required)..."
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          sx={{
            mb: 2,
            '& .MuiInputBase-root': { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
          }}
        />
      </Collapse>

      {/* Action buttons */}
      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button
          variant="contained"
          size="small"
          disabled={acting}
          onClick={() => handleOverride('verified')}
          startIcon={acting ? <CircularProgress size={14} /> : <CheckCircleIcon />}
          sx={{
            bgcolor: semantic.success,
            color: '#fff',
            borderRadius: 9999,
            fontWeight: 700,
            '&:hover': { bgcolor: '#2bb886' },
          }}
        >
          Approve Carrier
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={acting}
          onClick={() => handleOverride('rejected')}
          startIcon={<CancelIcon />}
          sx={{
            borderColor: semantic.error,
            color: semantic.error,
            borderRadius: 9999,
            fontWeight: 700,
            '&:hover': { bgcolor: tint(semantic.error, 0.12) },
          }}
        >
          Reject Carrier
        </Button>
      </Stack>
    </Paper>
  );
}

// ── Shipper Card ─────────────────────────────────────────────────────────────

function ShipperCard({ user, onAction }) {
  const [showRejectNote, setShowRejectNote] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [acting, setActing] = useState(false);

  const v = user.verification || {};
  const docs = v.documentsOnFile || [];
  const level = getVerificationLevel(user);
  const freeDomain = isFreeDomain(user.email);

  const handleShipperReview = async (action) => {
    if (action === 'reject' && !rejectNote.trim()) {
      setShowRejectNote(true);
      return;
    }
    setActing(true);
    try {
      await api.put(`/verification/shipper/admin-review/${user._id}`, {
        action,
        note: rejectNote.trim() || undefined,
      });
      onAction(true, `Shipper ${action === 'verify' ? 'approved' : 'rejected'}`);
      setShowRejectNote(false);
      setRejectNote('');
    } catch (err) {
      onAction(false, err.response?.data?.error || `Failed to ${action} shipper`);
    }
    setActing(false);
  };

  return (
    <Paper
      elevation={6}
      sx={{
        background: gradient.background,
        borderRadius: 4,
        px: { xs: 2, sm: 3 },
        py: 2.5,
        border: `1px solid ${surface.indigoBorderLight}`,
        transition: 'border-color 0.15s',
        '&:hover': { borderColor: brand.indigo },
      }}
    >
      {/* Header */}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5} mb={2}>
        <Box flex={1}>
          <Typography fontWeight={800} fontSize="1.1rem" sx={{ color: T.primary, mb: 0.25 }}>
            {user.name || 'N/A'}
          </Typography>
          <Typography variant="body2" sx={{ color: T.secondary }}>
            {user.email}
          </Typography>
          {user.companyName && (
            <Stack direction="row" alignItems="center" spacing={0.5} mt={0.5}>
              <BusinessIcon sx={{ color: brand.indigoLight, fontSize: 16 }} />
              <Typography variant="body2" sx={{ color: T.strong }}>
                {user.companyName}
              </Typography>
            </Stack>
          )}
        </Box>
        <Stack alignItems="flex-end" spacing={0.5}>
          <Chip
            label={v.status || 'pending'}
            size="small"
            sx={{
              bgcolor: tint(semantic.warning, 0.15),
              color: semantic.warning,
              fontWeight: 700,
              fontSize: '0.72rem',
              textTransform: 'capitalize',
            }}
          />
          {/* Verification level */}
          <Chip
            label={`Level ${level}/4`}
            size="small"
            sx={{
              bgcolor: level >= 3 ? tint(semantic.success, 0.15) : level >= 2 ? tint(semantic.warning, 0.15) : tint(semantic.error, 0.15),
              color: level >= 3 ? semantic.success : level >= 2 ? semantic.warning : semantic.error,
              fontWeight: 700,
              fontSize: '0.68rem',
            }}
          />
        </Stack>
      </Stack>

      {/* Details row */}
      <Stack direction="row" spacing={2} mb={2} flexWrap="wrap" gap={1}>
        {/* EIN masked */}
        {v.ein && (
          <Chip label={`EIN: ${maskEIN(v.ein)}`} size="small"
                sx={{ bgcolor: surface.glass, color: T.primary, fontWeight: 600 }} />
        )}
        {/* Email domain badge */}
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <EmailIcon sx={{ fontSize: 16, color: T.muted }} />
          <Chip
            label={freeDomain ? 'Free email' : 'Business email'}
            size="small"
            sx={{
              bgcolor: freeDomain ? tint(semantic.warning, 0.15) : tint(semantic.success, 0.15),
              color: freeDomain ? semantic.warning : semantic.success,
              fontWeight: 700,
              fontSize: '0.65rem',
            }}
          />
        </Stack>
        {/* Payment method */}
        <Chip
          label={v.paymentMethodVerified ? 'Payment verified' : 'No payment method'}
          size="small"
          sx={{
            bgcolor: v.paymentMethodVerified ? tint(semantic.success, 0.15) : tint(semantic.muted, 0.15),
            color: v.paymentMethodVerified ? semantic.success : semantic.muted,
            fontWeight: 700,
            fontSize: '0.65rem',
          }}
        />
      </Stack>

      {/* Documents */}
      {docs.length > 0 && (
        <Box mb={2}>
          <Typography variant="caption" sx={{ color: brand.indigoLight, fontWeight: 700, mb: 1, display: 'block' }}>
            DOCUMENTS ({docs.length})
          </Typography>
          <Stack spacing={1}>
            {docs.map((doc, i) => (
              <DocumentRow
                key={doc._id || i}
                doc={doc}
                userId={user._id}
                role="shipper"
                onAction={onAction}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Reject note */}
      <Collapse in={showRejectNote}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={3}
          placeholder="Rejection reason (required)..."
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          sx={{
            mb: 2,
            '& .MuiInputBase-root': { bgcolor: surface.glass, color: T.primary, borderRadius: 2 },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: surface.glassBorder },
          }}
        />
      </Collapse>

      {/* Action buttons */}
      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button
          variant="contained"
          size="small"
          disabled={acting}
          onClick={() => handleShipperReview('verify')}
          startIcon={acting ? <CircularProgress size={14} /> : <CheckCircleIcon />}
          sx={{
            bgcolor: semantic.success,
            color: '#fff',
            borderRadius: 9999,
            fontWeight: 700,
            '&:hover': { bgcolor: '#2bb886' },
          }}
        >
          Approve Shipper
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={acting}
          onClick={() => handleShipperReview('reject')}
          startIcon={<CancelIcon />}
          sx={{
            borderColor: semantic.error,
            color: semantic.error,
            borderRadius: 9999,
            fontWeight: 700,
            '&:hover': { bgcolor: tint(semantic.error, 0.12) },
          }}
        >
          Reject Shipper
        </Button>
      </Stack>
    </Paper>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AdminVerifications() {
  const [tab, setTab] = useState(0);
  const [carriers, setCarriers] = useState([]);
  const [shippers, setShippers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/verification/admin/pending');
      const users = Array.isArray(data) ? data : (data.users || []);
      setCarriers(users.filter((u) => u.role === 'carrier'));
      setShippers(users.filter((u) => u.role === 'shipper'));
    } catch {
      setSnack({ open: true, severity: 'error', message: 'Failed to load pending verifications' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleAction = (success, message) => {
    setSnack({ open: true, severity: success ? 'success' : 'error', message });
    if (success) fetchPending();
  };

  return (
    <Box sx={{ pb: 6 }}>
      {/* Page header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        mb={3}
        gap={2}
      >
        <Box>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <VerifiedUserIcon sx={{ color: brand.indigo, fontSize: 28 }} />
            <Typography variant="h4" fontWeight={900} sx={{ color: T.primary, letterSpacing: 1 }}>
              Verifications
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: T.secondary, mt: 0.5 }}>
            Review and approve pending carrier and shipper verifications
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton
            onClick={fetchPending}
            sx={{
              bgcolor: surface.glass,
              color: T.primary,
              '&:hover': { bgcolor: surface.glassHover },
            }}
          >
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 3,
          '& .MuiTab-root': {
            color: T.secondary,
            fontWeight: 700,
            textTransform: 'none',
            fontSize: '1rem',
          },
          '& .Mui-selected': { color: brand.indigo },
          '& .MuiTabs-indicator': { bgcolor: brand.indigo },
        }}
      >
        <Tab
          label={
            <Badge badgeContent={carriers.length} color="primary" max={99}
                   sx={{ '& .MuiBadge-badge': { bgcolor: brand.pink, color: '#fff', fontWeight: 700 } }}>
              <Box sx={{ pr: carriers.length > 0 ? 2 : 0 }}>Carriers</Box>
            </Badge>
          }
        />
        <Tab
          label={
            <Badge badgeContent={shippers.length} color="primary" max={99}
                   sx={{ '& .MuiBadge-badge': { bgcolor: brand.pink, color: '#fff', fontWeight: 700 } }}>
              <Box sx={{ pr: shippers.length > 0 ? 2 : 0 }}>Shippers</Box>
            </Badge>
          }
        />
      </Tabs>

      {/* Content */}
      {loading ? (
        <Stack alignItems="center" mt={8}>
          <CircularProgress sx={{ color: brand.indigo }} />
        </Stack>
      ) : tab === 0 ? (
        carriers.length === 0 ? (
          <Typography sx={{ color: T.muted, textAlign: 'center', mt: 8 }}>
            No pending carrier verifications
          </Typography>
        ) : (
          <Stack spacing={2}>
            {carriers.map((user) => (
              <CarrierCard key={user._id} user={user} onAction={handleAction} />
            ))}
          </Stack>
        )
      ) : shippers.length === 0 ? (
        <Typography sx={{ color: T.muted, textAlign: 'center', mt: 8 }}>
          No pending shipper verifications
        </Typography>
      ) : (
        <Stack spacing={2}>
          {shippers.map((user) => (
            <ShipperCard key={user._id} user={user} onAction={handleAction} />
          ))}
        </Stack>
      )}

      {/* Snackbar */}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          sx={{ fontWeight: 600 }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
