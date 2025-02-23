// src/pages/ShipperPostLoad.js
import React, { useState } from 'react';
import {
  TextField,
  Button,
  Grid,
  Typography,
  Box,
  Paper,
  Snackbar,
  Alert,
  Select,
  MenuItem,
} from '@mui/material';
import api from '../services/api';

function ShipperPostLoad() {
  const [newLoad, setNewLoad] = useState({
    title: '',
    origin: '',
    destination: '',
    rate: '',
    equipmentType: '',
  });
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!newLoad.equipmentType) {
        setError('Equipment Type is required.');
        return;
      }

      const token = localStorage.getItem('token');
      await api.post(
        '/loads',
        {
          title: newLoad.title,
          origin: newLoad.origin,
          destination: newLoad.destination,
          rate: newLoad.rate,
          equipmentType: newLoad.equipmentType,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Reset form
      setNewLoad({
        title: '',
        origin: '',
        destination: '',
        rate: '',
        equipmentType: '',
      });
      setOpenSnackbar(true);
      setError('');
    } catch (err) {
      console.error('Error posting load:', err);
      setError('Failed to post load. Please check all fields and try again.');
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 4 }} elevation={3}>
      <Typography variant="h6" gutterBottom>
        Post a New Load
      </Typography>
      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Title"
              fullWidth
              required
              value={newLoad.title}
              onChange={(e) =>
                setNewLoad({ ...newLoad, title: e.target.value })
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Origin"
              fullWidth
              required
              value={newLoad.origin}
              onChange={(e) =>
                setNewLoad({ ...newLoad, origin: e.target.value })
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Destination"
              fullWidth
              required
              value={newLoad.destination}
              onChange={(e) =>
                setNewLoad({ ...newLoad, destination: e.target.value })
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Rate"
              fullWidth
              required
              value={newLoad.rate}
              onChange={(e) =>
                setNewLoad({ ...newLoad, rate: e.target.value })
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Equipment Type *
            </Typography>
            <Select
              fullWidth
              displayEmpty
              required
              value={newLoad.equipmentType}
              onChange={(e) =>
                setNewLoad({ ...newLoad, equipmentType: e.target.value })
              }
            >
              <MenuItem value="">
                <em>Select Type</em>
              </MenuItem>
              <MenuItem value="Flatbed">Flatbed</MenuItem>
              <MenuItem value="Reefer">Reefer</MenuItem>
              <MenuItem value="Dry Van">Dry Van</MenuItem>
              <MenuItem value="Car Hauler">Car Hauler</MenuItem>
            </Select>
          </Grid>
        </Grid>
        <Button variant="contained" color="primary" type="submit" fullWidth>
          Post Load
        </Button>
      </Box>
      <Snackbar
        open={openSnackbar}
        autoHideDuration={3000}
        onClose={() => setOpenSnackbar(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Load successfully posted!
        </Alert>
      </Snackbar>
      {error && (
        <Typography variant="body1" color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}
    </Paper>
  );
}

export default ShipperPostLoad;
