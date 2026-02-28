import React, { useState } from 'react';
import {
  Box, Typography, CircularProgress, Tooltip, Dialog, DialogTitle,
  DialogContent, Chip, LinearProgress, IconButton, Stack, Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VerifiedIcon from '@mui/icons-material/Verified';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BlockIcon from '@mui/icons-material/Block';

function getColor(score) {
  if (score >= 70) return '#34d399';
  if (score >= 40) return '#fbbf24';
  return '#ef4444';
}

function getTier(score) {
  if (score >= 70) return 'Trusted';
  if (score >= 40) return 'Fair';
  return 'At Risk';
}

function VerificationChip({ status }) {
  const map = {
    verified: { label: 'Verified', color: '#34d399', icon: <VerifiedIcon sx={{ fontSize: 14 }} /> },
    pending: { label: 'Pending', color: '#fbbf24', icon: <WarningAmberIcon sx={{ fontSize: 14 }} /> },
    unverified: { label: 'Unverified', color: '#9ca3af', icon: null },
    suspended: { label: 'Suspended', color: '#ef4444', icon: <BlockIcon sx={{ fontSize: 14 }} /> },
    rejected: { label: 'Rejected', color: '#ef4444', icon: <BlockIcon sx={{ fontSize: 14 }} /> },
  };
  const cfg = map[status] || map.unverified;
  return (
    <Chip
      size="small"
      icon={cfg.icon}
      label={cfg.label}
      sx={{
        background: `${cfg.color}22`,
        color: cfg.color,
        border: `1px solid ${cfg.color}44`,
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
          background: 'rgba(15,10,40,0.95)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.1)',
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
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>{getTier(score)}</Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <VerificationChip status={verificationStatus} />
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', mb: 2 }} />

        <Stack spacing={1.5}>
          {[
            { label: 'On-Time Rate', value: `${onTimeRate ?? 100}%`, bar: onTimeRate ?? 100, color: '#34d399' },
            { label: 'Dispute Resolution', value: `${disputeResolutionRate ?? 100}%`, bar: disputeResolutionRate ?? 100, color: '#a78bfa' },
            { label: 'Loads Completed', value: totalLoadsCompleted ?? 0, bar: Math.min((totalLoadsCompleted ?? 0) * 2, 100), color: '#22d3ee' },
            { label: 'Cancellation Rate', value: `${cancellationRate ?? 0}%`, bar: 100 - (cancellationRate ?? 0), color: '#fbbf24' },
            { label: 'Claims Filed', value: claimsCount ?? 0, bar: Math.max(0, 100 - (claimsCount ?? 0) * 20), color: '#f87171' },
          ].map(({ label, value, bar, color: barColor }) => (
            <Box key={label}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)' }}>{label}</Typography>
                <Typography variant="caption" fontWeight={700} sx={{ color: 'rgba(255,255,255,0.9)' }}>{value}</Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={bar}
                sx={{ height: 5, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.08)', '& .MuiLinearProgress-bar': { background: barColor, borderRadius: 2 } }}
              />
            </Box>
          ))}
        </Stack>

        {history && history.length > 0 && (
          <>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 2 }} />
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', display: 'block', mb: 1 }}>
              RECENT HISTORY
            </Typography>
            <Stack spacing={0.5}>
              {history.slice().reverse().slice(0, 5).map((h, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>{h.reason}</Typography>
                  <Typography variant="caption" sx={{ color: h.change >= 0 ? '#34d399' : '#ef4444', fontWeight: 700 }}>
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
                <Typography sx={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1 }}>
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
