import React, { useState } from 'react';
import {
  Box, Typography, CircularProgress, Tooltip, Dialog, DialogTitle,
  DialogContent, Chip, LinearProgress, IconButton, Stack, Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VerifiedIcon from '@mui/icons-material/Verified';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BlockIcon from '@mui/icons-material/Block';
import { semantic, status as ST, surface, text as T, tint } from '../theme/tokens';

function getColor(score) {
  if (score >= 70) return semantic.success;
  if (score >= 40) return semantic.warning;
  return semantic.error;
}

function getTier(score) {
  if (score >= 70) return 'Trusted';
  if (score >= 40) return 'Fair';
  return 'At Risk';
}

function VerificationChip({ status }) {
  const map = {
    verified: { label: 'Verified', color: semantic.success, icon: <VerifiedIcon sx={{ fontSize: 14 }} /> },
    pending: { label: 'Pending', color: semantic.warning, icon: <WarningAmberIcon sx={{ fontSize: 14 }} /> },
    unverified: { label: 'Unverified', color: semantic.muted, icon: null },
    suspended: { label: 'Suspended', color: semantic.error, icon: <BlockIcon sx={{ fontSize: 14 }} /> },
    rejected: { label: 'Rejected', color: semantic.error, icon: <BlockIcon sx={{ fontSize: 14 }} /> },
  };
  const cfg = map[status] || map.unverified;
  return (
    <Chip
      size="small"
      icon={cfg.icon}
      label={cfg.label}
      sx={{
        background: tint(cfg.color, 0.13),
        color: cfg.color,
        border: `1px solid ${tint(cfg.color, 0.27)}`,
        fontWeight: 700,
        fontSize: '0.7rem',
      }}
    />
  );
}

function ScoreBreakdownDialog({ open, onClose, breakdown }) {
  if (!breakdown) return null;
  const { score, onTimeRate, cancellationRate, claimsCount, disputeResolutionRate, totalLoadsCompleted, verificationStatus, history } = breakdown;
  const color = getColor(score);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          background: surface.modal,
          backdropFilter: 'blur(24px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: 3,
          minWidth: 340,
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 0 }}>
        <Typography fontWeight={700}>Trust Score Breakdown</Typography>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent>
        {/* Score ring */}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress
              variant="determinate"
              value={score}
              size={100}
              thickness={6}
              sx={{ color }}
            />
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="h5" fontWeight={800} sx={{ color }}>{score}</Typography>
              <Typography variant="caption" sx={{ color: T.secondary }}>{getTier(score)}</Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <VerificationChip status={verificationStatus} />
        </Box>

        <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />

        <Stack spacing={1.5}>
          {[
            { label: 'On-Time Rate', value: `${onTimeRate ?? 100}%`, bar: onTimeRate ?? 100, color: semantic.success },
            { label: 'Dispute Resolution', value: `${disputeResolutionRate ?? 100}%`, bar: disputeResolutionRate ?? 100, color: ST.accepted },
            { label: 'Loads Completed', value: totalLoadsCompleted ?? 0, bar: Math.min((totalLoadsCompleted ?? 0) * 2, 100), color: ST.open },
            { label: 'Cancellation Rate', value: `${cancellationRate ?? 0}%`, bar: 100 - (cancellationRate ?? 0), color: semantic.warning },
            { label: 'Claims Filed', value: claimsCount ?? 0, bar: Math.max(0, 100 - (claimsCount ?? 0) * 20), color: ST.disputed },
          ].map(({ label, value, bar, color: barColor }) => (
            <Box key={label}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" sx={{ color: T.secondary }}>{label}</Typography>
                <Typography variant="caption" fontWeight={700} sx={{ color: T.primary }}>{value}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={bar}
                sx={{ height: 5, borderRadius: 2, bgcolor: surface.glassHover, '& .MuiLinearProgress-bar': { background: barColor, borderRadius: 2 } }}
              />
            </Box>
          ))}
        </Stack>

        {history && history.length > 0 && (
          <>
            <Divider sx={{ borderColor: surface.glassBorder, my: 2 }} />
            <Typography variant="caption" sx={{ color: T.muted, display: 'block', mb: 1 }}>
              RECENT HISTORY
            </Typography>
            <Stack spacing={0.5}>
              {history.slice().reverse().slice(0, 5).map((h, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: T.secondary }}>{h.reason}</Typography>
                  <Typography variant="caption" sx={{ color: h.change >= 0 ? semantic.success : semantic.error, fontWeight: 700 }}>
                    {h.change >= 0 ? '+' : ''}{h.change}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * TrustScoreBadge — compact circular badge
 * Props:
 *   score: number (0-100)
 *   verificationStatus: string
 *   breakdown: object (full breakdown from API, optional)
 *   size: 'sm' | 'md' | 'lg' (default 'md')
 *   showLabel: bool
 */
export default function TrustScoreBadge({ score = 50, verificationStatus = 'unverified', breakdown = null, size = 'md', showLabel = false }) {
  const [open, setOpen] = useState(false);
  const color = getColor(score);
  const tier = getTier(score);

  const sizes = { sm: 40, md: 56, lg: 80 };
  const px = sizes[size] || 56;
  const thickness = size === 'lg' ? 5 : 4;

  return (
    <>
      <Tooltip title={`Trust Score: ${score}/100 — ${tier}. Click for details.`}>
        <Box
          onClick={() => breakdown && setOpen(true)}
          sx={{
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5,
            cursor: breakdown ? 'pointer' : 'default',
          }}
        >
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress
              variant="determinate"
              value={score}
              size={px}
              thickness={thickness}
              sx={{ color }}
            />
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ fontSize: px * 0.28, fontWeight: 800, color, lineHeight: 1 }}>
                {score}
              </Typography>
              {size === 'lg' && (
                <Typography sx={{ fontSize: '0.55rem', color: T.muted, lineHeight: 1 }}>
                  /100
                </Typography>
              )}
            </Box>
          </Box>
          {showLabel && (
            <Typography variant="caption" sx={{ color, fontWeight: 700, fontSize: '0.65rem' }}>
              {tier}
            </Typography>
          )}
        </Box>
      </Tooltip>

      <ScoreBreakdownDialog
        open={open}
        onClose={() => setOpen(false)}
        breakdown={breakdown}
      />
    </>
  );
}
