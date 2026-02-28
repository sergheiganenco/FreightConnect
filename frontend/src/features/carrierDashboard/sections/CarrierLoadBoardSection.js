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

function MatchScoreBadge({ score }) {
  const color = score >= 70 ? '#34d399' : score >= 40 ? '#fbbf24' : '#ef4444';
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
          '& .MuiTab-root': { color: 'rgba(255,255,255,0.5)', textTransform: 'none', fontWeight: 600 },
          '& .Mui-selected': { color: '#fff' },
          '& .MuiTabs-indicator': { background: 'linear-gradient(90deg,#6a1fcf,#e1129a)' },
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
            <Typography sx={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', py: 4 }}>
              {recError}
            </Typography>
          )}
          {!recLoading && !recError && recommended.length === 0 && (
            <Typography sx={{ color: 'rgba(255,255,255,0.35)', textAlign: 'center', py: 4 }}>
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
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    '&:hover': { background: 'rgba(106,31,207,0.12)', borderColor: 'rgba(106,31,207,0.35)' },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{load.title}</Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.45)' }}>
                      {load.origin} → {load.destination}
                    </Typography>
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ ml: 2 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: '#34d399', whiteSpace: 'nowrap' }}>
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
