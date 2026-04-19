import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Tooltip,
  Collapse,
  Stack,
} from '@mui/material';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import PlaceIcon from '@mui/icons-material/Place';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import StarIcon from '@mui/icons-material/Star';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import api from '../services/api';

/**
 * ReturnLoadSuggestions — Displays nearby return loads to reduce deadhead miles.
 *
 * Props:
 *   loadId        (string)   — The current load ID to find return loads from its destination
 *   lat           (number)   — Alternative: search from a specific latitude
 *   lng           (number)   — Alternative: search from a specific longitude
 *   equipmentType (string)   — Optional equipment type filter
 *   onViewLoad    (function) — Called with load object when "View Details" is clicked
 */
export default function ReturnLoadSuggestions({ loadId, lat, lng, equipmentType, onViewLoad }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [sourceInfo, setSourceInfo] = useState(null);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (loadId) {
        res = await api.get(`/return-loads/${loadId}`);
      } else if (lat != null && lng != null) {
        const params = { lat, lng };
        if (equipmentType) params.equipmentType = equipmentType;
        res = await api.get('/return-loads/from-location', { params });
      } else {
        setLoading(false);
        return;
      }

      const data = res.data;
      setSuggestions(data.suggestions || []);
      setSourceInfo(data.sourceLoad || { destination: `${lat}, ${lng}` });
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to load return suggestions';
      setError(msg);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [loadId, lat, lng, equipmentType]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getScoreColor = (score) => {
    if (score >= 75) return '#4caf50';
    if (score >= 50) return '#ff9800';
    return '#f44336';
  };

  const destinationLabel = sourceInfo?.destination || 'this location';

  return (
    <Paper
      elevation={0}
      sx={{
        bgcolor: 'rgba(124,140,248,0.08)',
        border: '1.5px solid rgba(255,255,255,0.10)',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'rgba(124,140,248,0.12)' },
        }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <TrendingDownIcon sx={{ color: '#7c8cf8', fontSize: 28 }} />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#fff', fontSize: '1.1rem' }}>
              Reduce Deadhead
            </Typography>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }}>
              Return loads near {destinationLabel}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {suggestions.length > 0 && (
            <Chip
              label={`${suggestions.length} found`}
              size="small"
              sx={{
                bgcolor: 'rgba(76,175,80,0.2)',
                color: '#4caf50',
                fontWeight: 600,
                fontSize: '0.75rem',
              }}
            />
          )}
          <Tooltip title="Refresh suggestions">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); fetchSuggestions(); }}
              sx={{ color: 'rgba(255,255,255,0.5)' }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {expanded ? (
            <ExpandLessIcon sx={{ color: 'rgba(255,255,255,0.5)' }} />
          ) : (
            <ExpandMoreIcon sx={{ color: 'rgba(255,255,255,0.5)' }} />
          )}
        </Box>
      </Box>

      <Collapse in={expanded}>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        <Box sx={{ p: 2 }}>
          {/* Loading state */}
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} sx={{ color: '#7c8cf8' }} />
            </Box>
          )}

          {/* Error state */}
          {error && !loading && (
            <Alert
              severity="warning"
              sx={{
                bgcolor: 'rgba(255,152,0,0.1)',
                color: '#ffb74d',
                border: '1px solid rgba(255,152,0,0.2)',
                '& .MuiAlert-icon': { color: '#ffb74d' },
              }}
            >
              {error}
            </Alert>
          )}

          {/* Empty state */}
          {!loading && !error && suggestions.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <LocalShippingIcon sx={{ fontSize: 48, color: 'rgba(255,255,255,0.2)', mb: 1 }} />
              <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
                No return loads found near {destinationLabel}
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.35)', mt: 0.5 }}>
                Check back later as new loads are posted
              </Typography>
            </Box>
          )}

          {/* Suggestions list */}
          {!loading && suggestions.length > 0 && (
            <Stack spacing={1.5}>
              {suggestions.map((s) => (
                <Paper
                  key={s.load._id}
                  elevation={0}
                  sx={{
                    bgcolor: 'rgba(124,140,248,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 2,
                    p: 2,
                    transition: 'all 0.2s',
                    '&:hover': {
                      bgcolor: 'rgba(124,140,248,0.14)',
                      borderColor: 'rgba(167,139,250,0.3)',
                    },
                  }}
                >
                  {/* Top row: title + score badge */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 700, color: '#fff', fontSize: '0.95rem', flex: 1, mr: 1 }}
                    >
                      {s.load.title}
                    </Typography>
                    <Chip
                      label={`${s.matchScore}% match`}
                      size="small"
                      sx={{
                        bgcolor: `${getScoreColor(s.matchScore)}22`,
                        color: getScoreColor(s.matchScore),
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        minWidth: 80,
                      }}
                    />
                  </Box>

                  {/* Route line */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                    <PlaceIcon sx={{ fontSize: 16, color: '#4caf50' }} />
                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem' }}>
                      {s.load.origin}
                    </Typography>
                    <ArrowForwardIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', mx: 0.5 }} />
                    <PlaceIcon sx={{ fontSize: 16, color: '#f44336' }} />
                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem' }}>
                      {s.load.destination}
                    </Typography>
                  </Box>

                  {/* Details row */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1.5 }}>
                    <Chip
                      label={`$${s.load.rate?.toLocaleString()}`}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(76,175,80,0.15)',
                        color: '#81c784',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                      }}
                    />
                    {s.ratePerMile != null && (
                      <Chip
                        label={`$${s.ratePerMile}/mi`}
                        size="small"
                        variant="outlined"
                        sx={{
                          borderColor: 'rgba(255,255,255,0.15)',
                          color: 'rgba(255,255,255,0.6)',
                          fontSize: '0.75rem',
                        }}
                      />
                    )}
                    <Chip
                      label={`${s.distanceFromLocation} mi away`}
                      size="small"
                      variant="outlined"
                      sx={{
                        borderColor: 'rgba(255,255,255,0.15)',
                        color: 'rgba(255,255,255,0.6)',
                        fontSize: '0.75rem',
                      }}
                    />
                    {s.load.equipmentType && (
                      <Chip
                        icon={<LocalShippingIcon sx={{ fontSize: 14 }} />}
                        label={s.load.equipmentType}
                        size="small"
                        variant="outlined"
                        sx={{
                          borderColor: s.equipmentMatch ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.15)',
                          color: s.equipmentMatch ? '#81c784' : 'rgba(255,255,255,0.6)',
                          fontSize: '0.75rem',
                          '& .MuiChip-icon': {
                            color: s.equipmentMatch ? '#81c784' : 'rgba(255,255,255,0.4)',
                          },
                        }}
                      />
                    )}
                    {s.familiarLane && (
                      <Chip
                        icon={<StarIcon sx={{ fontSize: 14 }} />}
                        label="Familiar lane"
                        size="small"
                        sx={{
                          bgcolor: 'rgba(255,193,7,0.15)',
                          color: '#ffd54f',
                          fontSize: '0.72rem',
                          '& .MuiChip-icon': { color: '#ffd54f' },
                        }}
                      />
                    )}
                  </Box>

                  {/* Pickup window */}
                  {s.load.pickupTimeWindow?.start && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                      <AccessTimeIcon sx={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }} />
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                        Pickup: {formatDate(s.load.pickupTimeWindow.start)}
                        {s.load.pickupTimeWindow.end && ` - ${formatDate(s.load.pickupTimeWindow.end)}`}
                      </Typography>
                    </Box>
                  )}

                  {/* Action */}
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => onViewLoad && onViewLoad(s.load)}
                    sx={{
                      borderColor: 'rgba(124,140,248,0.4)',
                      color: '#7c8cf8',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                      textTransform: 'none',
                      '&:hover': {
                        borderColor: '#7c8cf8',
                        bgcolor: 'rgba(124,140,248,0.1)',
                      },
                    }}
                  >
                    View Details
                  </Button>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
