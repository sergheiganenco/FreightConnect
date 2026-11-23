// src/features/carrierDashboard/components/LoadCard.jsx
import React from 'react';
import { Paper, Typography, Box, Chip, Tooltip } from '@mui/material';
import { motion } from 'framer-motion';
import StatusChip from './StatusChip';
import { status as ST, surface, shadow, statusColor } from '../../../../theme/tokens';

const fmtDate = (raw) => {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// cents -> "$1,234.56" / "-$12.30" (display only; math stays in integer cents)
const fmtMoney = (cents) =>
  (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  // Lane economics (annotated by the load board's geo search).
  const tripMiles = Number.isFinite(load.tripMiles) ? load.tripMiles : null;
  const rpm = Number.isFinite(load.ratePerMile) ? load.ratePerMile : null;
  const deadhead = Number.isFinite(load.deadheadMiles) ? load.deadheadMiles : null;

  // Estimated profit (integer cents from the server); null/absent => show nothing.
  const eco = load.economics || null;
  const loss = eco && eco.profitCents < 0;
  const profitFg = loss ? '#ef4444' : '#34d399';
  const profitBg = loss ? 'rgba(239,68,68,0.15)' : 'rgba(52,211,153,0.15)';

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

        {load.loadVisibility === 'tender' && load.status === 'open' && (
          <Chip
            label={`Offered to you${load.tender?.expiresAt ? ` — answer by ${new Date(load.tender.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`}
            size="small"
            sx={{ mb: 0.5, bgcolor: 'rgba(124,140,248,0.2)', color: '#c7d2fe', fontWeight: 700, fontSize: '0.75rem', border: '1px solid rgba(124,140,248,0.5)' }}
          />
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
          {rpm != null && (
            <Chip
              label={`$${rpm.toFixed(2)}/mi`}
              size="small"
              sx={{ bgcolor: 'rgba(52,211,153,0.15)', color: '#34d399', fontWeight: 700, fontSize: '0.8rem', border: '1px solid rgba(52,211,153,0.35)' }}
            />
          )}
          {equipment && (
            <Chip label={equipment} size="small" sx={{ bgcolor: surface.glassBorder, color: '#e4e2f7', fontWeight: 600, fontSize: '0.8rem' }} />
          )}
          {weight && (
            <Typography variant="body2" color="text.secondary">{weight}</Typography>
          )}
        </Box>

        {/* Miles row */}
        <Box display="flex" flexWrap="wrap" gap={1.5} alignItems="center" mt={0.5}>
          {tripMiles != null && (
            <Typography variant="body2" color="text.secondary">{tripMiles.toLocaleString()} mi trip</Typography>
          )}
          {deadhead != null && (
            <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 600 }}>
              {deadhead.toLocaleString()} mi deadhead
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            Pickup {pickupDate}{deliveryDate ? ' \u2192 Del ' + deliveryDate : ''}
          </Typography>
        </Box>

        {/* Estimated profit (server-computed from the carrier's own cost/mile) */}
        {eco && (
          <Box display="flex" flexWrap="wrap" gap={1} alignItems="center" mt={0.5}>
            <Tooltip title={`Estimate: rate minus your cost/mile x ${eco.totalMiles.toLocaleString()} ${eco.milesBasis === 'road' ? 'road' : 'straight-line'} miles (${eco.includesDeadhead ? 'incl.' : 'excl.'} deadhead${eco.includesDeadhead ? ', straight-line' : ''}). ${eco.milesBasis === 'road' ? '' : 'Real road miles are higher, so actual profit is likely lower. '}Excludes tolls, detention and accessorials.`}>
              <Chip
                label={`Est. profit ${fmtMoney(eco.profitCents)}`}
                size="small"
                sx={{ bgcolor: profitBg, color: profitFg, fontWeight: 700, fontSize: '0.8rem', border: '1px solid ' + profitFg }}
              />
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              {fmtMoney(eco.profitPerMileCents)}/mi &middot; est., {eco.milesBasis === 'road' ? 'road' : 'straight-line'} miles{eco.includesDeadhead ? '' : ', excl. deadhead'}
            </Typography>
          </Box>
        )}
      </Paper>
    </motion.div>
  );
}
