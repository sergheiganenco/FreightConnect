/**
 * ReputationBadges — Trust badges + reputation summary for load details
 *
 * Shows the other party's reputation BEFORE you commit:
 *   - Carrier sees shipper's payment speed, facility wait times, reliability
 *   - Shipper sees carrier's on-time %, trust tier, insurance, claims history
 *
 * Also shows schedule conflict warnings when a carrier is about to accept.
 */
import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Stack, Chip, Tooltip, CircularProgress, Alert,
  Collapse, Button, Paper, Divider,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ScheduleIcon from '@mui/icons-material/Schedule';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ShieldIcon from '@mui/icons-material/Shield';
import StarIcon from '@mui/icons-material/Star';
import SecurityIcon from '@mui/icons-material/Security';
import PaymentsIcon from '@mui/icons-material/Payments';
import InventoryIcon from '@mui/icons-material/Inventory';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BlockIcon from '@mui/icons-material/Block';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import api from '../services/api';

// Map badge icon names to MUI components
const ICON_MAP = {
  verified: <VerifiedIcon fontSize="small" />,
  schedule: <ScheduleIcon fontSize="small" />,
  local_shipping: <LocalShippingIcon fontSize="small" />,
  trending_up: <TrendingUpIcon fontSize="small" />,
  shield: <ShieldIcon fontSize="small" />,
  star: <StarIcon fontSize="small" />,
  security: <SecurityIcon fontSize="small" />,
  payments: <PaymentsIcon fontSize="small" />,
  inventory: <InventoryIcon fontSize="small" />,
  verified_user: <VerifiedUserIcon fontSize="small" />,
};

const TIER_LABELS = {
  risk: 'At Risk',
  warning: 'Caution',
  trusted: 'Trusted',
};

const TIER_COLORS = {
  risk: '#ef4444',
  warning: '#fbbf24',
  trusted: '#34d399',
};

/**
 * ReputationSummary — shows counterparty reputation in LoadDetailsModal
 *
 * @param {string} userId - the OTHER party's user ID
 * @param {string} userRole - current user's role (carrier or shipper)
 * @param {string} loadId - for schedule conflict check (optional)
 * @param {string} loadStatus - load status (show schedule check only for 'open' loads)
 */
export default function ReputationBadges({ userId, userRole, loadId, loadStatus }) {
  const [reputation, setReputation] = useState(null);
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduleCheck, setScheduleCheck] = useState(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    async function fetchReputation() {
      setLoading(true);
      try {
        const [repRes, badgeRes] = await Promise.all([
          api.get(`/reputation/${userId}`),
          api.get(`/reputation/${userId}/badges`),
        ]);
        if (!cancelled) {
          setReputation(repRes.data);
          setBadges(badgeRes.data.badges || []);
        }
      } catch {
        // non-critical
      }
      if (!cancelled) setLoading(false);
    }

    fetchReputation();
    return () => { cancelled = true; };
  }, [userId]);

  // Schedule conflict check — carrier only, open loads only
  useEffect(() => {
    if (userRole !== 'carrier' || loadStatus !== 'open' || !loadId) return;

    async function fetchSchedule() {
      setScheduleLoading(true);
      try {
        const { data } = await api.get(`/loads/${loadId}/schedule-check`);
        setScheduleCheck(data);
      } catch {
        // non-critical
      }
      setScheduleLoading(false);
    }

    fetchSchedule();
  }, [userRole, loadId, loadStatus]);

  if (loading) {
    return (
      <Box sx={{ py: 1, textAlign: 'center' }}>
        <CircularProgress size={18} />
      </Box>
    );
  }

  if (!reputation) return null;

  const isViewingCarrier = reputation.role === 'carrier';
  const tier = reputation.trustScore?.tier || 'warning';

  return (
    <Box sx={{ mb: 2 }}>
      {/* ── Trust Summary Bar ────────────────────────────────────────── */}
      <Paper sx={{
        p: 2, borderRadius: 2,
        bgcolor: 'rgba(255,255,255,0.04)',
        border: `1.5px solid ${TIER_COLORS[tier]}33`,
      }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            {/* Trust score circle */}
            <Box sx={{
              width: 42, height: 42, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: `${TIER_COLORS[tier]}22`, border: `2px solid ${TIER_COLORS[tier]}`,
            }}>
              <Typography fontWeight={800} fontSize="0.85rem" color={TIER_COLORS[tier]}>
                {reputation.trustScore?.score ?? '—'}
              </Typography>
            </Box>

            <Box>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography fontWeight={700} color="#fff" fontSize="0.9rem">
                  {reputation.companyName || reputation.name}
                </Typography>
                <Chip
                  size="small"
                  label={TIER_LABELS[tier] || tier}
                  sx={{
                    height: 20, fontSize: '0.65rem', fontWeight: 700,
                    bgcolor: `${TIER_COLORS[tier]}22`, color: TIER_COLORS[tier],
                  }}
                />
              </Stack>
              <Typography variant="caption" color="rgba(255,255,255,0.5)">
                {reputation.stats.totalDelivered} loads delivered · {reputation.stats.memberMonths} months on platform
                {reputation.ratings.count > 0 && ` · ${reputation.ratings.overall.toFixed(1)}★ (${reputation.ratings.count} reviews)`}
              </Typography>
            </Box>
          </Stack>

          <Button
            size="small"
            onClick={() => setShowDetails(v => !v)}
            endIcon={showDetails ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.72rem' }}
          >
            {showDetails ? 'Less' : 'Details'}
          </Button>
        </Stack>

        {/* ── Badges Row ──────────────────────────────────────────────── */}
        {badges.length > 0 && (
          <Stack direction="row" spacing={0.5} mt={1.5} flexWrap="wrap" useFlexGap>
            {badges.map(b => (
              <Tooltip key={b.id} title={b.description}>
                <Chip
                  size="small"
                  icon={ICON_MAP[b.icon] || <VerifiedIcon fontSize="small" />}
                  label={b.label}
                  sx={{
                    height: 24, fontSize: '0.68rem', fontWeight: 600,
                    bgcolor: `${b.color}18`, color: b.color,
                    '& .MuiChip-icon': { color: b.color },
                  }}
                />
              </Tooltip>
            ))}
          </Stack>
        )}

        {/* ── Expanded Details ─────────────────────────────────────────── */}
        <Collapse in={showDetails}>
          <Divider sx={{ my: 1.5, borderColor: 'rgba(255,255,255,0.08)' }} />

          <Stack spacing={1}>
            {/* Key stats */}
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <StatItem label="On-Time Rate" value={`${reputation.stats.onTimeRate}%`}
                color={reputation.stats.onTimeRate >= 95 ? '#34d399' : reputation.stats.onTimeRate >= 85 ? '#fbbf24' : '#ef4444'} />
              <StatItem label="Cancel Rate" value={`${reputation.stats.cancellationRate}%`}
                color={reputation.stats.cancellationRate <= 3 ? '#34d399' : '#ef4444'} />
              {reputation.ratings.count > 0 && (
                <>
                  <StatItem label="Communication" value={`${reputation.ratings.communication.toFixed(1)}★`} color="#6366f1" />
                  <StatItem label="Punctuality" value={`${reputation.ratings.punctuality.toFixed(1)}★`} color="#6366f1" />
                </>
              )}
            </Stack>

            {/* Carrier-specific: insurance */}
            {isViewingCarrier && reputation.insuranceStatus && (
              <Stack direction="row" spacing={1}>
                <InsuranceChip label="Cargo" status={reputation.insuranceStatus.cargo} />
                <InsuranceChip label="Auto" status={reputation.insuranceStatus.auto} />
              </Stack>
            )}

            {/* Shipper-specific: facility wait times */}
            {!isViewingCarrier && reputation.facilityReputation && (
              <Paper sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <AccessTimeIcon sx={{ color: '#f97316', fontSize: 18 }} />
                  <Typography variant="caption" color="rgba(255,255,255,0.7)">
                    <strong style={{ color: '#fff' }}>Facility Wait:</strong> avg {reputation.facilityReputation.avgWaitMinutes} min
                    · detention {reputation.facilityReputation.detentionRate}% of visits
                    · {reputation.facilityReputation.totalVisits} recorded visits
                  </Typography>
                </Stack>
              </Paper>
            )}
          </Stack>
        </Collapse>
      </Paper>

      {/* ── Schedule Conflict Warnings (carrier only, open loads) ─────── */}
      {scheduleLoading && (
        <Box sx={{ mt: 1, textAlign: 'center' }}><CircularProgress size={16} /></Box>
      )}

      {scheduleCheck && scheduleCheck.conflicts?.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          {scheduleCheck.conflicts.map((c, i) => (
            <Alert
              key={i}
              severity={c.severity === 'blocking' ? 'error' : 'warning'}
              icon={c.severity === 'blocking' ? <BlockIcon /> : <WarningAmberIcon />}
              sx={{ mb: 0.5, borderRadius: 2, fontSize: '0.78rem' }}
            >
              <Typography variant="body2" fontWeight={600} fontSize="0.78rem">
                {c.severity === 'blocking' ? 'Schedule Conflict' : 'Schedule Warning'}
              </Typography>
              <Typography variant="caption">{c.message}</Typography>
            </Alert>
          ))}
        </Box>
      )}

      {scheduleCheck && scheduleCheck.conflicts?.length === 0 && (
        <Alert severity="success" sx={{ mt: 1, borderRadius: 2, fontSize: '0.75rem' }}>
          No schedule conflicts — this load fits your current schedule.
        </Alert>
      )}
    </Box>
  );
}

function StatItem({ label, value, color }) {
  return (
    <Box>
      <Typography variant="caption" color="rgba(255,255,255,0.4)" fontSize="0.65rem">{label}</Typography>
      <Typography fontWeight={700} color={color} fontSize="0.85rem">{value}</Typography>
    </Box>
  );
}

function InsuranceChip({ label, status }) {
  const color = status === 'valid' ? '#34d399' : status === 'expiring' ? '#fbbf24' : '#ef4444';
  return (
    <Chip
      size="small"
      icon={<SecurityIcon sx={{ fontSize: 14 }} />}
      label={`${label}: ${status}`}
      sx={{ height: 22, fontSize: '0.65rem', bgcolor: `${color}18`, color, '& .MuiChip-icon': { color } }}
    />
  );
}
