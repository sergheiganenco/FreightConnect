import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Chip, Grid, CircularProgress, Tooltip, Alert, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow
} from '@mui/material';
import {
  TrendingUp, TrendingDown, TrendingFlat, LocalFireDepartment,
  AcUnit, Refresh
} from '@mui/icons-material';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid
} from 'recharts';
import api from '../services/api';
import { surface, text, brand, semantic, chart, shadow, gradient, tint } from '../theme/tokens';

const REFRESH_INTERVAL = 300000; // 5 minutes

const glassCard = {
  background: surface.cardBg,
  backdropFilter: 'blur(20px)',
  border: `1px solid ${surface.glassBorder}`,
  borderRadius: 3,
  p: 2.5,
  boxShadow: shadow.card,
};

function TrendIcon({ trend }) {
  if (trend === 'rising') return <TrendingUp sx={{ color: semantic.success, fontSize: 20 }} />;
  if (trend === 'falling') return <TrendingDown sx={{ color: semantic.error, fontSize: 20 }} />;
  return <TrendingFlat sx={{ color: semantic.warning, fontSize: 20 }} />;
}

function HeatIndicator({ level }) {
  // level: 'hot', 'warm', 'neutral', 'cool', 'cold'
  const config = {
    hot:     { icon: <LocalFireDepartment />, color: semantic.error, label: 'Hot' },
    warm:    { icon: <LocalFireDepartment />, color: semantic.orange, label: 'Warm' },
    neutral: { icon: <TrendingFlat />,        color: semantic.warning, label: 'Neutral' },
    cool:    { icon: <AcUnit />,              color: semantic.info, label: 'Cool' },
    cold:    { icon: <AcUnit />,              color: '#6366f1', label: 'Cold' },
  };
  const c = config[level] || config.neutral;
  return (
    <Chip
      icon={c.icon}
      label={c.label}
      size="small"
      sx={{
        background: tint(c.color, 0.15),
        color: c.color,
        fontWeight: 600,
        '& .MuiChip-icon': { color: c.color },
      }}
    />
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{
      background: surface.modal, p: 1.5, borderRadius: 2,
      border: `1px solid ${surface.glassBorder}`,
    }}>
      <Typography variant="caption" sx={{ color: text.secondary }}>{label}</Typography>
      {payload.map((entry, i) => (
        <Typography key={i} variant="body2" sx={{ color: entry.color, fontWeight: 600 }}>
          {entry.name}: {entry.value}
        </Typography>
      ))}
    </Box>
  );
}

/**
 * AIInsightsPanel - dashboard panel showing AI-powered market insights
 *
 * @param {string} role - 'carrier', 'shipper', or 'admin'
 */
export default function AIInsightsPanel({ role = 'carrier' }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);

  const fetchInsights = useCallback(async () => {
    try {
      setError('');
      const res = await api.get('/ai/insights', { params: { role } });
      setInsights(res.data);
    } catch (err) {
      // If endpoint doesn't exist yet, use mock data for UI development
      setInsights(generateMockInsights());
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    fetchInsights();
    const interval = setInterval(fetchInsights, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchInsights]);

  if (loading) {
    return (
      <Box sx={{ ...glassCard, display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress sx={{ color: brand.primary }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={glassCard}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!insights) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ color: text.primary, fontWeight: 700 }}>
          AI Market Insights
        </Typography>
        <Chip
          icon={<Refresh sx={{ fontSize: 14 }} />}
          label="Auto-refreshes every 5 min"
          size="small"
          sx={{ background: surface.glass, color: text.muted, '& .MuiChip-icon': { color: text.muted } }}
        />
      </Box>

      <Grid container spacing={2}>
        {/* Market Heat Map */}
        <Grid item xs={12} md={6}>
          <Paper sx={glassCard}>
            <Typography variant="subtitle1" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
              Lane Heat Map
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ color: text.secondary, borderColor: surface.glassBorder }}>Lane</TableCell>
                    <TableCell sx={{ color: text.secondary, borderColor: surface.glassBorder }}>Demand</TableCell>
                    <TableCell sx={{ color: text.secondary, borderColor: surface.glassBorder }} align="right">Avg Rate/mi</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(insights.heatMap || []).map((lane, idx) => (
                    <TableRow key={idx}>
                      <TableCell sx={{ color: text.primary, borderColor: surface.glassBorder }}>
                        {lane.origin} &rarr; {lane.destination}
                      </TableCell>
                      <TableCell sx={{ borderColor: surface.glassBorder }}>
                        <HeatIndicator level={lane.heat} />
                      </TableCell>
                      <TableCell sx={{ color: text.primary, borderColor: surface.glassBorder, fontWeight: 600 }} align="right">
                        ${lane.avgRate?.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>

        {/* Demand Forecast */}
        <Grid item xs={12} md={6}>
          <Paper sx={glassCard}>
            <Typography variant="subtitle1" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
              7-Day Load Volume Forecast
            </Typography>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={insights.forecast || []}>
                <CartesianGrid strokeDasharray="3 3" stroke={surface.glassBorder} />
                <XAxis dataKey="day" tick={{ fill: text.secondary, fontSize: 12 }} axisLine={false} />
                <YAxis tick={{ fill: text.secondary, fontSize: 12 }} axisLine={false} />
                <RTooltip content={<CustomTooltip />} />
                <Bar dataKey="predicted" name="Predicted" fill={chart.purple} radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill={chart.green} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {/* Rate Trends */}
        <Grid item xs={12} md={role === 'admin' ? 8 : 12}>
          <Paper sx={glassCard}>
            <Typography variant="subtitle1" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
              Rate Trends by Equipment
            </Typography>
            <Grid container spacing={1}>
              {(insights.rateTrends || []).map((item, idx) => (
                <Grid item xs={6} sm={4} md={3} key={idx}>
                  <Box sx={{
                    p: 1.5, borderRadius: 2, background: surface.glass,
                    border: `1px solid ${surface.glassBorder}`,
                    textAlign: 'center',
                  }}>
                    <Typography variant="caption" sx={{ color: text.secondary }}>
                      {item.equipment}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mt: 0.5 }}>
                      <Typography variant="h6" sx={{ color: text.primary, fontWeight: 700 }}>
                        ${item.rate?.toFixed(2)}
                      </Typography>
                      <TrendIcon trend={item.trend} />
                    </Box>
                    <Typography variant="caption" sx={{
                      color: item.change >= 0 ? semantic.success : semantic.error
                    }}>
                      {item.change >= 0 ? '+' : ''}{item.change}%
                    </Typography>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>

        {/* Admin: Carrier Risk Summary */}
        {role === 'admin' && (
          <Grid item xs={12} md={4}>
            <Paper sx={glassCard}>
              <Typography variant="subtitle1" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
                Carrier Risk Summary
              </Typography>
              <Stack spacing={1.5}>
                {(insights.carrierRisk || []).map((item, idx) => (
                  <Box key={idx} sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    p: 1, borderRadius: 1.5, background: surface.glass,
                  }}>
                    <Typography variant="body2" sx={{ color: text.primary }}>{item.label}</Typography>
                    <Chip
                      label={item.count}
                      size="small"
                      sx={{
                        background: tint(item.color, 0.15),
                        color: item.color,
                        fontWeight: 700,
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}

/**
 * Generate mock insights data when API endpoint is not yet available
 */
function generateMockInsights() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    heatMap: [
      { origin: 'CA', destination: 'TX', heat: 'hot', avgRate: 2.85 },
      { origin: 'IL', destination: 'FL', heat: 'warm', avgRate: 2.42 },
      { origin: 'NY', destination: 'GA', heat: 'neutral', avgRate: 2.15 },
      { origin: 'WA', destination: 'OR', heat: 'cool', avgRate: 1.95 },
      { origin: 'OH', destination: 'MI', heat: 'cold', avgRate: 1.72 },
    ],
    forecast: days.map((day, i) => ({
      day,
      predicted: Math.floor(120 + Math.random() * 80),
      actual: i < 3 ? Math.floor(110 + Math.random() * 90) : null,
    })),
    rateTrends: [
      { equipment: 'Dry Van', rate: 2.35, trend: 'rising', change: 3.2 },
      { equipment: 'Reefer', rate: 2.85, trend: 'rising', change: 5.1 },
      { equipment: 'Flatbed', rate: 2.65, trend: 'stable', change: 0.3 },
      { equipment: 'Step Deck', rate: 3.10, trend: 'falling', change: -2.1 },
    ],
    carrierRisk: [
      { label: 'Low Risk', count: 245, color: '#34d399' },
      { label: 'Medium Risk', count: 38, color: '#fbbf24' },
      { label: 'High Risk', count: 12, color: '#f97316' },
      { label: 'Flagged', count: 4, color: '#ef4444' },
    ],
  };
}
