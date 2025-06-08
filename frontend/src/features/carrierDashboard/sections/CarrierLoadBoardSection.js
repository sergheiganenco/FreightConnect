// ── src/features/carrierDashboard/sections/LoadBoardSection.jsx
import React, { useState } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import FilterAltIcon from '@mui/icons-material/FilterAlt';

import { useCarrierLoads  } from '../hooks/useCarrierLoads';
import FilterDrawer from './components/FilterDrawer';
import LoadGrid     from './components/LoadGrid';
import LoadDetailsModal from '../../../components/LoadDetailsModal'; // keep path

export default function CarrierLoadBoardSection() {
  /* fetch + setter come from the hook */
  const {
    loads,
    setLoads,      // ← we’ll mutate this on accept
    isLoading,
    error,
    filters,
    setFilters,
  } = useCarrierLoads ();

  const [selected, setSelected] = useState(null);
  const [drawer,   setDrawer]   = useState(false);

  /* remove a load from the open list the moment it’s accepted */
  const handleAccepted = (id) =>
    setLoads((prev) => prev.filter((l) => l._id !== id));

  return (
    <Box>
      {/* header */}
      <Box
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}
      >
        <Typography variant="h5" fontWeight={700}>Loads</Typography>
        <IconButton onClick={() => setDrawer(true)}>
          <FilterAltIcon />
        </IconButton>
      </Box>

      {/* filter drawer */}
      <FilterDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        filters={filters}
        setFilters={setFilters}
      />

      {/* grid */}
      <LoadGrid
        loads={loads}
        loading={isLoading}
        errorMsg={error}
        onSelect={setSelected}
      />

      {/* modal */}
      {selected && (
        <LoadDetailsModal
          load={selected}
          userRole="carrier"
          onClose={() => setSelected(null)}
          onLoadAccepted={handleAccepted}
        />
      )}
    </Box>
  );
}
