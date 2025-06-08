// ── src/features/carrierDashboard/components/LoadCard.jsx
import React from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { motion } from 'framer-motion';
import { useTheme } from '@mui/material/styles';
import StatusChip from './StatusChip';

export default function LoadCard({ load, onClick }) {
  const theme = useTheme();

  /* -----------------------------------------
     Resolve payload fields (+ fall-backs)
  ----------------------------------------- */
  const origin      = load.origin      ?? 'Origin TBD';
  const destination = load.destination ?? 'Destination TBD';

 // ---------- Pickup date (robust) ----------
const pickupDateRaw =
  load.pickupDate ??
  load.pickupStart ??  
  load.pickup_time ??
  load.pickupTime ??
  load.pickupStart ??
  load?.pickupTimeWindow?.start ??
  null;

let pickupDate = 'TBD';
if (pickupDateRaw) {
  const dateObj = new Date(pickupDateRaw);
  // Only accept if it’s a valid date
  if (!isNaN(dateObj)) {
    pickupDate = dateObj.toLocaleDateString(undefined, {
      month: 'short',
      day:   'numeric',
      year:  'numeric',
    });
  }
}

  const rate =
    typeof load.rate === 'number'
      ? `$${load.rate.toLocaleString()}`
      : 'Rate TBD';

  /* -----------------------------------------
     Accent colours (theme-first, then default)
  ----------------------------------------- */
  const accentPalette = theme.palette?.accent || {
    open: '#22d3ee',
    accepted: '#a78bfa',
    inTransit: '#fbbf24',
    delivered: '#34d399',
  };

  const accent = accentPalette[load.status] ?? accentPalette.open;

  /* glass background tint */
  const glass = theme.palette?.glass || 'rgba(255,255,255,0.06)';

  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <Paper
        onClick={onClick}
        sx={{
          p: 2,
          mb: 2,
          cursor: 'pointer',
          borderLeft: `6px solid ${accent}`,
          borderRadius: 2,
          background: glass,
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* route line + status */}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={1}
        >
          <Typography variant="subtitle1" fontWeight={600}>
            {origin} → {destination}
          </Typography>
          <StatusChip status={load.status ?? 'open'} />
        </Box>

        {/* meta row */}
        <Typography variant="body2" color="text.secondary">
          Pickup&nbsp;{pickupDate} | {rate}
        </Typography>
      </Paper>
    </motion.div>
  );
}
