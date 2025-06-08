import React from 'react';
import { Paper, Typography, Box, Chip } from '@mui/material';
import { motion } from 'framer-motion';
import { useTheme } from '@mui/material/styles';

// --- Copy helpers to keep consistent ---
const normalizeStatus = s =>
  (s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

const prettyStatus = s =>
  normalizeStatus(s)
    .split(" ")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const statusColors = {
  open: "#22d3ee",
  accepted: "#a78bfa",
  "in transit": "#fbbf24",
  delivered: "#34d399",
  // fallback: "#cbd5e1"
};

export default function LoadCard({ load, onClick }) {
  const theme = useTheme();

  // Resolve fields (can match Carrier code for date/rate/etc.)
  const origin = load.origin ?? 'Origin TBD';
  const destination = load.destination ?? 'Destination TBD';

  // Pickup date logic (robust)
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
    if (!isNaN(dateObj)) {
      pickupDate = dateObj.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }

  const rate =
    typeof load.rate === 'number'
      ? `$${load.rate.toLocaleString()}`
      : 'Rate TBD';

  const statusNorm = normalizeStatus(load.status);
  const chipColor = statusColors[statusNorm] || "#cbd5e1";

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
          cursor: onClick ? 'pointer' : 'default',
          borderLeft: `6px solid ${chipColor}`,
          borderRadius: 2,
          background: glass,
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Route line + status chip */}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={1}
        >
          <Typography variant="subtitle1" fontWeight={600}>
            {origin} → {destination}
          </Typography>
          <Chip
            label={prettyStatus(load.status)}
            size="small"
            sx={{
              bgcolor: chipColor,
              color: statusNorm === "open" ? "#0f172a" : "#18181b",
              fontWeight: 700,
              fontSize: "0.97rem",
              px: 2,
              boxShadow: "0 2px 8px #0001",
            }}
          />
        </Box>
        {/* meta row */}
        <Typography variant="body2" color="text.secondary">
          Pickup&nbsp;{pickupDate} | {rate}
        </Typography>
      </Paper>
    </motion.div>
  );
}
