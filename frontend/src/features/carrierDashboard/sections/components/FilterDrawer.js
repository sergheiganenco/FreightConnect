// =============================
// src/features/carrierDashboard/components/FilterDrawer.jsx
// =============================
import React from "react";
import {
  Drawer,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Divider,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { gradient } from '../../../../theme/tokens';
import LocationAutocomplete from '../../../../components/LocationAutocomplete';

const RADII = [25, 50, 75, 100, 150, 250];

export default function FilterDrawer({ open, onClose, filters, setFilters }) {
  const theme = useTheme();
  const handle = (e) => setFilters({ ...filters, [e.target.name]: e.target.value });

  // LocationAutocomplete returns { label, lat, lng } (or null when cleared).
  const setPlace = (prefix) => (place) =>
    setFilters({
      ...filters,
      [`${prefix}Label`]: place?.label || '',
      [`${prefix}Lat`]: place ? Number(place.lat) : undefined,
      [`${prefix}Lng`]: place ? Number(place.lng) : undefined,
      // Default the radius as soon as a place is chosen so the search is active.
      [`${prefix}Radius`]:
        filters[`${prefix}Radius`] || (place ? 75 : undefined),
    });

  const clearLane = () =>
    setFilters({
      ...filters,
      originLabel: '', originLat: undefined, originLng: undefined, originRadius: undefined,
      destLabel: '', destLat: undefined, destLng: undefined, destRadius: undefined,
    });

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 340,
          background: theme.palette.glass,
          backdropFilter: 'blur(24px)',
          p: 3,
        },
      }}
    >
      <Stack spacing={2}>
        <FormControl fullWidth size="small">
          <InputLabel>Status</InputLabel>
          <Select label="Status" name="status" value={filters.status} onChange={handle}>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
          </Select>
        </FormControl>

        <TextField size="small" label="Equipment" name="equipmentType" value={filters.equipmentType || ''} onChange={handle} />
        <TextField size="small" label="Min Rate" name="minRate" type="number" value={filters.minRate || ''} onChange={handle} />
        <TextField size="small" label="Max Rate" name="maxRate" type="number" value={filters.maxRate || ''} onChange={handle} />

        <Divider />
        <Typography variant="overline" sx={{ letterSpacing: '0.08em', opacity: 0.8 }}>
          Lane search
        </Typography>

        <LocationAutocomplete label="Pick up near" value={filters.originLabel} onChange={setPlace('origin')} />
        <FormControl fullWidth size="small" disabled={!filters.originLat}>
          <InputLabel>Pickup radius</InputLabel>
          <Select label="Pickup radius" name="originRadius" value={filters.originRadius || 75} onChange={handle}>
            {RADII.map((r) => <MenuItem key={r} value={r}>{r} mi</MenuItem>)}
          </Select>
        </FormControl>

        <LocationAutocomplete label="Deliver near (optional)" value={filters.destLabel} onChange={setPlace('dest')} />
        <FormControl fullWidth size="small" disabled={!filters.destLat}>
          <InputLabel>Delivery radius</InputLabel>
          <Select label="Delivery radius" name="destRadius" value={filters.destRadius || 75} onChange={handle}>
            {RADII.map((r) => <MenuItem key={r} value={r}>{r} mi</MenuItem>)}
          </Select>
        </FormControl>

        {(filters.originLat || filters.destLat) && (
          <Button size="small" onClick={clearLane} sx={{ color: 'text.secondary' }}>
            Clear lane
          </Button>
        )}

        <Button variant="contained" onClick={onClose} sx={{ background: gradient.primary }}>
          Apply
        </Button>
      </Stack>
    </Drawer>
  );
}