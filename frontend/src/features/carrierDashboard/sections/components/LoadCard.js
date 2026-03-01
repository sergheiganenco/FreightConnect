// src/features/carrierDashboard/components/LoadCard.jsx
import React from 'react';
import { Paper, Typography, Box, Chip } from '@mui/material';
import { motion } from 'framer-motion';
import StatusChip from './StatusChip';
import { status as ST, surface, shadow, statusColor } from '../../../../theme/tokens';

const fmtDate = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function LoadCard({ load, onClick }) {
  const origin      = load.origin      || 'Origin TBD';
  const destination = load.destination || 'Destination TBD';

  const pickupDate  = fmtDate(load.pickupTimeWindow?.start) || 'TBD';
  const deliveryDate = fmtDate(load.deliveryTimeWindow?.start);

  const rate =
    typeof load.rate === 'number'
      ? '$' + load.rate.toLocaleString()
      : 'Rate TBD';

  const equipment = load.equipmentType || null;
  const weight = load.loadWeight ? Number(load.loadWeight).toLocaleString() + ' lbs' : null;
  const accent = statusColor(load.status);

  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: shadow.card }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
    >
      <Paper
        onClick={onClick}
        sx={{
          p: 2,
          mb: 2,
          cursor: 'pointer',
          borderLeft: '6px solid ' + accent,
          borderRadius: 2,
          background: surface.glass,
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Title + status */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="subtitle1" fontWeight={700}>
            {load.title || (origin + ' \u2192 ' + destination)}
          </Typography>
          <StatusChip status={load.status || 'open'} />
        </Box>

        {/* Route */}
        {load.title && (
          <Typography variant="body2" color="text.secondary" mb={0.5}>
            {origin} {'\u2192'} {destination}
          </Typography>
        )}

        {/* Overweight badge — visible to carriers before accepting */}
        {load.overweightAcknowledged && (
          <Chip
            label={load.overweightPermitNumber ? `Overweight — Permit #${load.overweightPermitNumber}` : 'Overweight — Permit Required'}
            size="small"
            sx={{ mb: 0.5, bgcolor: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 700, fontSize: '0.75rem', border: '1px solid rgba(239,68,68,0.4)' }}
          />
        )}

        {/* Details row */}
        <Box display="flex" flexWrap="wrap" gap={1} alignItems="center" mt={0.5}>
          <Typography variant="body2" fontWeight={600} sx={{ color: ST.open }}>
            {rate}
          </Typography>
          {equipment && (
            <Chip label={equipment} size="small" sx={{ bgcolor: surface.glassBorder, color: '#e4e2f7', fontWeight: 600, fontSize: '0.8rem' }} />
          )}
          {weight && (
            <Typography variant="body2" color="text.secondary">{weight}</Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            Pickup {pickupDate}{deliveryDate ? ' \u2192 Del ' + deliveryDate : ''}
          </Typography>
        </Box>
      </Paper>
    </motion.div>
  );
}
