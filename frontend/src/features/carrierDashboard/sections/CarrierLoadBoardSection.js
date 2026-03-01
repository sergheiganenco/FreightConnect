import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, IconButton, Tabs, Tab, Chip, CircularProgress,
  Stack, Tooltip,
} from '@mui/material';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

import { useCarrierLoads } from '../hooks/useCarrierLoads';
import FilterDrawer from './components/FilterDrawer';
import LoadGrid from './components/LoadGrid';
import LoadDetailsModal from '../../../components/LoadDetailsModal';
import api from '../../../services/api';
import { semantic, surface, text as T, brand, tint, gradient } from '../../../theme/tokens';

function MatchScoreBadge({ score }) {
  const color = score >= 70 ? semantic.success : score >= 40 ? semantic.warning : semantic.error;
  return (
    <Tooltip title={`Match score: ${score}/100`} arrow>
      <Chip
        icon={<AutoAwesomeIcon sx={{ fontSize: 14, color: `${color} !important` }} />}
        label={`${score}%`}
        size="small"
        sx={{
          bgcolor: `${color}18`,
          color,
          fontWeight: 700,
          fontSize: '0.7rem',
          height: 22,
        }}
      />
    </Tooltip>
  );
}

export default function CarrierLoadBoardSection() {
  const {
    loads,
    setLoads,
    isLoading,
    error,
    filters,
    setFilters,
  } = useCarrierLoads();

  const [selected, setSelected] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState(0); // 0 = All Loads, 1 = Recommended

  const [recommended, setRecommended] = useState([]);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState('');

  const fetchRecommended = useCallback(async () => {
    setRecLoading(true);
    setRecError('');
    try {
      const { data } = await api.get('/loads/recommended');
      setRecommended(data); // [{load, score}]
    } catch {
      setRecError('Could not load recommendations. Set your preferences in Profile to get matches.');
    } finally {
      setRecLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 1) fetchRecommended();
  }, [tab, fetchRecommended]);

  const handleAccepted = (id) =>
    setLoads((prev) => prev.filter((l) => l._id !== id));

  const handleAcceptedRec = (id) =>
    setRecommended((prev) => prev.filter((r) => r.load._id !== id));

  return (
    <Box>
      {/* header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={700}>Loads</Typography>
        {tab === 0 && (
          <IconButton onClick={() => setDrawer(true)}>
            <FilterAltIcon />
          </IconButton>
        )}
      </Box>

      {/* tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{
          mb: 2,
          '& .MuiTab-root': { color: T.secondary, textTransform: 'none', fontWeight: 600 },
          '& .Mui-selected': { color: T.primary },
          '& .MuiTabs-indicator': { background: gradient.primary },
        }}
      >
        <Tab label="All Loads" />
        <Tab
          label={
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <AutoAwesomeIcon sx={{ fontSize: 16 }} />
              <span>Recommended</span>
            </Stack>
          }
        />
      </Tabs>

      {/* filter drawer — only on All tab */}
      <FilterDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        filters={filters}
        setFilters={setFilters}
      />

      {/* All Loads tab */}
      {tab === 0 && (
        <LoadGrid
          loads={loads}
          loading={isLoading}
          errorMsg={error}
          onSelect={setSelected}
        />
      )}

      {/* Recommended tab */}
      {tab === 1 && (
        <Box>
          {recLoading && (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <CircularProgress size={32} />
            </Box>
          )}
          {recError && (
            <Typography sx={{ color: T.muted, textAlign: 'center', py: 4 }}>
              {recError}
            </Typography>
          )}
          {!recLoading && !recError && recommended.length === 0 && (
            <Typography sx={{ color: T.hint, textAlign: 'center', py: 4 }}>
              No recommendations yet. Set your preferences in Profile → Matching Preferences.
            </Typography>
          )}
          {!recLoading && recommended.length > 0 && (
            <Stack spacing={0}>
              {recommended.map(({ load, score }) => (
                <Box
                  key={load._id}
                  onClick={() => setSelected(load)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    px: 2,
                    py: 1.5,
                    mb: 1,
                    borderRadius: 2,
                    background: surface.glassLight,
                    border: `1px solid ${surface.glassHover}`,
                    cursor: 'pointer',
                    '&:hover': { background: tint(brand.primary, 0.12), borderColor: tint(brand.primary, 0.35) },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{load.title}</Typography>
                    <Typography variant="caption" sx={{ color: T.muted }}>
                      {load.origin} → {load.destination}
                    </Typography>
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ ml: 2 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: semantic.success, whiteSpace: 'nowrap' }}>
                      ${load.rate?.toLocaleString()}
                    </Typography>
                    <MatchScoreBadge score={score} />
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* modal */}
      {selected && (
        <LoadDetailsModal
          load={selected}
          userRole="carrier"
          onClose={() => setSelected(null)}
          onLoadAccepted={tab === 0 ? handleAccepted : handleAcceptedRec}
        />
      )}
    </Box>
  );
}
