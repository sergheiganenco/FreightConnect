import React, { useState, useEffect } from 'react';
import {
  Box, Paper, Typography, CircularProgress, Alert, Grid, Chip,
  LinearProgress, Stack, Divider, Avatar
} from '@mui/material';
import {
  Star, Verified, Shield, WorkspacePremium, EmojiEvents,
  PersonOutline
} from '@mui/icons-material';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip as RTooltip, CartesianGrid
} from 'recharts';
import api from '../services/api';
import { surface, text, brand, chart, shadow, tint } from '../theme/tokens';

const glassCard = {
  background: surface.cardBg,
  backdropFilter: 'blur(20px)',
  border: `1px solid ${surface.glassBorder}`,
  borderRadius: 3,
  p: 3,
  boxShadow: shadow.card,
};

const TRUST_LEVELS = [
  { min: 0,  max: 19,  label: 'New',      color: '#94a3b8', icon: PersonOutline },
  { min: 20, max: 39,  label: 'Basic',    color: '#6366f1', icon: Shield },
  { min: 40, max: 59,  label: 'Verified', color: '#22d3ee', icon: Verified },
  { min: 60, max: 79,  label: 'Trusted',  color: '#34d399', icon: WorkspacePremium },
  { min: 80, max: 100, label: 'Elite',    color: '#fbbf24', icon: EmojiEvents },
];

function getTrustLevel(score) {
  return TRUST_LEVELS.find(l => score >= l.min && score <= l.max) || TRUST_LEVELS[0];
}

function CircularGauge({ value, size = 160, thickness = 8 }) {
  const level = getTrustLevel(value);
  const normalizedValue = Math.min(100, Math.max(0, value));

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      {/* Background circle */}
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={thickness}
        sx={{ color: surface.glass, position: 'absolute' }}
      />
      {/* Value circle */}
      <CircularProgress
        variant="determinate"
        value={normalizedValue}
        size={size}
        thickness={thickness}
        sx={{
          color: level.color,
          position: 'absolute',
          '& .MuiCircularProgress-circle': {
            strokeLinecap: 'round',
          },
        }}
      />
      {/* Center text */}
      <Box sx={{
        position: 'absolute', top: 0, left: 0, bottom: 0, right: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography variant="h3" sx={{ color: level.color, fontWeight: 800, lineHeight: 1 }}>
          {value}
        </Typography>
        <Typography variant="caption" sx={{ color: text.secondary, mt: 0.5 }}>
          / 100
        </Typography>
      </Box>
    </Box>
  );
}

function BreakdownBar({ label, value, maxValue = 100, color }) {
  const percent = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" sx={{ color: text.strong }}>{label}</Typography>
        <Typography variant="body2" sx={{ color: text.primary, fontWeight: 600 }}>
          {value}/{maxValue}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{
          height: 6,
          borderRadius: 3,
          backgroundColor: surface.glass,
          '& .MuiLinearProgress-bar': {
            borderRadius: 3,
            background: `linear-gradient(90deg, ${color}, ${tint(color, 0.7)})`,
          },
        }}
      />
    </Box>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{
      background: surface.modal, p: 1.5, borderRadius: 2,
      border: `1px solid ${surface.glassBorder}`,
    }}>
      <Typography variant="caption" sx={{ color: text.secondary }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: chart.purple, fontWeight: 600 }}>
        Score: {payload[0]?.value}
      </Typography>
    </Box>
  );
}

/**
 * CarrierScorecard - visual carrier trust scorecard
 *
 * @param {string} carrierId - the carrier user ID to display
 * @param {boolean} compact - if true, shows a smaller version
 */
export default function CarrierScorecard({ carrierId, compact = false }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!carrierId) return;
    setLoading(true);
    setError('');

    Promise.all([
      api.get(`/ratings/user/${carrierId}`).catch(() => ({ data: null })),
      api.get(`/ai/carrier-risk/${carrierId}`).catch(() => ({ data: null })),
    ])
      .then(([ratingsRes, riskRes]) => {
        // Build scorecard data from responses, with sensible defaults
        const ratings = ratingsRes.data;
        const risk = riskRes.data;

        setData({
          trustScore: ratings?.trustScore ?? risk?.trustScore ?? 0,
          verification: ratings?.verification ?? risk?.verification ?? 'unverified',
          breakdown: ratings?.breakdown ?? {
            equipment: { value: 0, max: 35 },
            rate: { value: 0, max: 25 },
            lane: { value: 0, max: 25 },
            trust: { value: 0, max: 15 },
          },
          recentRatings: ratings?.recentRatings ?? [],
          trend: ratings?.trend ?? [],
          avgRating: ratings?.avgRating ?? 0,
          totalRatings: ratings?.totalRatings ?? 0,
        });
      })
      .catch(() => {
        // If both fail, show mock/empty state
        setData({
          trustScore: 0,
          verification: 'unverified',
          breakdown: {
            equipment: { value: 0, max: 35 },
            rate: { value: 0, max: 25 },
            lane: { value: 0, max: 25 },
            trust: { value: 0, max: 15 },
          },
          recentRatings: [],
          trend: [],
          avgRating: 0,
          totalRatings: 0,
        });
      })
      .finally(() => setLoading(false));
  }, [carrierId]);

  if (loading) {
    return (
      <Box sx={{ ...glassCard, display: 'flex', justifyContent: 'center', py: 4 }}>
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

  if (!data) return null;

  const level = getTrustLevel(data.trustScore);
  const LevelIcon = level.icon;

  const verificationConfig = {
    unverified: { label: 'Unverified', color: '#94a3b8' },
    pending:    { label: 'Pending', color: '#fbbf24' },
    verified:   { label: 'FMCSA Verified', color: '#34d399' },
    suspended:  { label: 'Suspended', color: '#ef4444' },
    rejected:   { label: 'Rejected', color: '#ef4444' },
  };
  const verif = verificationConfig[data.verification] || verificationConfig.unverified;

  if (compact) {
    return (
      <Box sx={{
        ...glassCard, p: 2,
        display: 'flex', alignItems: 'center', gap: 2,
      }}>
        <CircularGauge value={data.trustScore} size={80} thickness={6} />
        <Box>
          <Chip
            icon={<LevelIcon sx={{ fontSize: 16 }} />}
            label={level.label}
            size="small"
            sx={{
              background: tint(level.color, 0.15),
              color: level.color,
              fontWeight: 600,
              '& .MuiChip-icon': { color: level.color },
              mb: 0.5,
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <Star sx={{ color: '#fbbf24', fontSize: 16 }} />
            <Typography variant="body2" sx={{ color: text.primary }}>
              {data.avgRating?.toFixed(1) || '0.0'} ({data.totalRatings} ratings)
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Paper sx={glassCard}>
      <Typography variant="h6" sx={{ color: text.primary, fontWeight: 700, mb: 3 }}>
        Carrier Trust Scorecard
      </Typography>

      <Grid container spacing={3}>
        {/* Left column: Gauge + Trust Level */}
        <Grid item xs={12} md={4} sx={{ textAlign: 'center' }}>
          <CircularGauge value={data.trustScore} />

          <Box sx={{ mt: 2 }}>
            <Chip
              icon={<LevelIcon />}
              label={level.label}
              sx={{
                background: tint(level.color, 0.15),
                color: level.color,
                fontWeight: 700,
                fontSize: '0.95rem',
                px: 1,
                '& .MuiChip-icon': { color: level.color },
              }}
            />
          </Box>

          {/* FMCSA Verification */}
          <Box sx={{ mt: 2 }}>
            <Chip
              icon={<Verified sx={{ fontSize: 16 }} />}
              label={verif.label}
              size="small"
              variant="outlined"
              sx={{
                borderColor: verif.color,
                color: verif.color,
                '& .MuiChip-icon': { color: verif.color },
              }}
            />
          </Box>

          {/* Average rating */}
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
            <Star sx={{ color: '#fbbf24', fontSize: 20 }} />
            <Typography variant="h6" sx={{ color: text.primary, fontWeight: 700 }}>
              {data.avgRating?.toFixed(1) || '0.0'}
            </Typography>
            <Typography variant="body2" sx={{ color: text.secondary }}>
              ({data.totalRatings} ratings)
            </Typography>
          </Box>
        </Grid>

        {/* Middle column: Breakdown bars */}
        <Grid item xs={12} md={4}>
          <Typography variant="subtitle2" sx={{ color: text.strong, mb: 2 }}>
            Score Breakdown
          </Typography>
          {data.breakdown && (
            <>
              <BreakdownBar
                label="Equipment Match"
                value={data.breakdown.equipment?.value ?? 0}
                maxValue={data.breakdown.equipment?.max ?? 35}
                color={chart.purple}
              />
              <BreakdownBar
                label="Rate Competitiveness"
                value={data.breakdown.rate?.value ?? 0}
                maxValue={data.breakdown.rate?.max ?? 25}
                color={chart.blue}
              />
              <BreakdownBar
                label="Lane & Region"
                value={data.breakdown.lane?.value ?? 0}
                maxValue={data.breakdown.lane?.max ?? 25}
                color={chart.green}
              />
              <BreakdownBar
                label="Trust & Safety"
                value={data.breakdown.trust?.value ?? 0}
                maxValue={data.breakdown.trust?.max ?? 15}
                color={chart.gold}
              />
            </>
          )}
        </Grid>

        {/* Right column: Trend chart */}
        <Grid item xs={12} md={4}>
          <Typography variant="subtitle2" sx={{ color: text.strong, mb: 2 }}>
            Performance Trend
          </Typography>
          {data.trend && data.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={surface.glassBorder} />
                <XAxis dataKey="period" tick={{ fill: text.secondary, fontSize: 11 }} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: text.secondary, fontSize: 11 }} axisLine={false} />
                <RTooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke={chart.purple}
                  strokeWidth={2}
                  dot={{ fill: chart.purple, r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{
              height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: surface.glass, borderRadius: 2,
            }}>
              <Typography variant="body2" sx={{ color: text.muted }}>
                Not enough data for trend
              </Typography>
            </Box>
          )}
        </Grid>

        {/* Recent Ratings */}
        {data.recentRatings && data.recentRatings.length > 0 && (
          <Grid item xs={12}>
            <Divider sx={{ borderColor: surface.glassBorder, mb: 2 }} />
            <Typography variant="subtitle2" sx={{ color: text.strong, mb: 1.5 }}>
              Recent Ratings
            </Typography>
            <Stack spacing={1}>
              {data.recentRatings.slice(0, 5).map((rating, idx) => (
                <Box key={idx} sx={{
                  display: 'flex', alignItems: 'center', gap: 2,
                  p: 1.5, borderRadius: 2, background: surface.glass,
                }}>
                  <Avatar sx={{ width: 32, height: 32, background: surface.glassActive, fontSize: '0.8rem' }}>
                    {rating.raterName?.[0] || '?'}
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ color: text.primary, fontWeight: 600 }}>
                        {rating.raterName || 'Anonymous'}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {[1, 2, 3, 4, 5].map(star => (
                          <Star
                            key={star}
                            sx={{
                              fontSize: 14,
                              color: star <= rating.overall ? '#fbbf24' : text.muted,
                            }}
                          />
                        ))}
                      </Box>
                    </Box>
                    {rating.comment && (
                      <Typography variant="caption" sx={{ color: text.secondary }}>
                        {rating.comment}
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="caption" sx={{ color: text.muted }}>
                    {rating.date ? new Date(rating.date).toLocaleDateString() : ''}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Grid>
        )}
      </Grid>
    </Paper>
  );
}
