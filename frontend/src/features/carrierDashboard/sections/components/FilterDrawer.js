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
} from "@mui/material";
import { useTheme } from "@mui/material/styles";

export default function FilterDrawer({ open, onClose, filters, setFilters }) {
  const theme = useTheme();
  const handle = (e) => setFilters({ ...filters, [e.target.name]: e.target.value });

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 320,
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

        <TextField size="small" label="Equipment" name="equipmentType" value={filters.equipmentType} onChange={handle} />
        <TextField size="small" label="Min Rate" name="minRate" type="number" value={filters.minRate} onChange={handle} />
        <TextField size="small" label="Max Rate" name="maxRate" type="number" value={filters.maxRate} onChange={handle} />

        <Button variant="contained" onClick={onClose} sx={{ background: 'linear-gradient(90deg,#ec4899,#9333ea)' }}>
          Apply
        </Button>
      </Stack>
    </Drawer>
  );
}