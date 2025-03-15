// src/pages/ShipperPostLoad.js
import React, { useState } from 'react';
import {
  TextField, Button, Grid, Typography, Box, Paper, Snackbar, Alert, Select, MenuItem, FormControlLabel, Switch
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import api from '../services/api';
import cities from '../data/usCities.json'; // Import the static dataset

function ShipperPostLoad() {
  const [newLoad, setNewLoad] = useState({
    title: '',
    origin: '',
    destination: '',
    rate: '',
    equipmentType: '',
    pickupStart: '',
    pickupEnd: '',
    deliveryStart: '',
    deliveryEnd: '',
    loadWeight: '',
    loadLength: '',
    loadWidth: '',
    loadHeight: '',
    commodityType: '',
    specialInstructions: '',
    hazardousMaterial: false
  });
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    if (!newLoad.title || !newLoad.origin || !newLoad.destination || !newLoad.rate || !newLoad.equipmentType) {
      setError('Please fill out all required fields.');
      setOpenSnackbar(true);
      return;
    }
  
    // Validate Pickup and Delivery Time Windows
    if (new Date(newLoad.pickupStart) >= new Date(newLoad.pickupEnd)) {
      setError('Pickup start time must be before end time.');
      setOpenSnackbar(true);
      return;
    }
  
    if (new Date(newLoad.deliveryStart) >= new Date(newLoad.deliveryEnd)) {
      setError('Delivery start time must be before end time.');
      setOpenSnackbar(true);
      return;
    }
  
    // Validate load dimensions and weight
    if (Number(newLoad.loadWeight) <= 0 || Number(newLoad.loadLength) <= 0 || Number(newLoad.loadWidth) <= 0 || Number(newLoad.loadHeight) <= 0) {
      setError('Weight and dimensions must be positive numbers.');
      setOpenSnackbar(true);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await api.post(
        '/loads',
        {
          title: newLoad.title,
          origin: newLoad.origin,
          destination: newLoad.destination,
          rate: newLoad.rate,
          equipmentType: newLoad.equipmentType,
          pickupTimeWindow: { start: newLoad.pickupStart, end: newLoad.pickupEnd },
          deliveryTimeWindow: { start: newLoad.deliveryStart, end: newLoad.deliveryEnd },
          loadWeight: newLoad.loadWeight,
          loadDimensions: {
            length: newLoad.loadLength,
            width: newLoad.loadWidth,
            height: newLoad.loadHeight
          },
          commodityType: newLoad.commodityType,
          specialInstructions: newLoad.specialInstructions,
          hazardousMaterial: newLoad.hazardousMaterial
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
        pickupStart: '',
        pickupEnd: '',
        deliveryStart: '',
        deliveryEnd: '',
        loadWeight: '',
        loadLength: '',
        loadWidth: '',
        loadHeight: '',
        commodityType: '',
        specialInstructions: '',
        hazardousMaterial: false
      });

      // Show success message
      setError('');
      setOpenSnackbar(true);
    } catch (err) {
      console.error('Error posting load:', err);
      setError('Failed to post load. Please check all fields and try again.');
      setOpenSnackbar(true);
    }
  };

  return (
    <Paper sx={{ p: 2, mb: 4 }} elevation={3}>
      <Typography variant="h6" gutterBottom>
        Post a New Load
      </Typography>
      <Box component="form" onSubmit={handleSubmit}>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* Basic Load Information */}
          <Grid item xs={12} sm={6}>
            <TextField
              label="Title"
              fullWidth
              required
              value={newLoad.title}
              onChange={(e) => setNewLoad({ ...newLoad, title: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={cities}
              getOptionLabel={(option) => option.label}
              onChange={(event, newValue) => {
                setNewLoad({ ...newLoad, origin: newValue ? newValue.label : '' });
              }}
              renderInput={(params) => <TextField {...params} label="Origin" required />}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={cities}
              getOptionLabel={(option) => option.label}
              onChange={(event, newValue) => {
                setNewLoad({ ...newLoad, destination: newValue ? newValue.label : '' });
              }}
              renderInput={(params) => <TextField {...params} label="Destination" required />}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Rate"
              fullWidth
              required
              type="number"
              value={newLoad.rate}
              onChange={(e) => setNewLoad({ ...newLoad, rate: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="subtitle2">Equipment Type *</Typography>
            <Select
              fullWidth
              displayEmpty
              required
              value={newLoad.equipmentType}
              onChange={(e) => setNewLoad({ ...newLoad, equipmentType: e.target.value })}
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
          {/* Time Windows */}
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Start Time"
              fullWidth
              type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={newLoad.pickupStart}
              onChange={(e) => setNewLoad({ ...newLoad, pickupStart: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup End Time"
              fullWidth
              type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={newLoad.pickupEnd}
              onChange={(e) => setNewLoad({ ...newLoad, pickupEnd: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Start Time"
              fullWidth
              type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={newLoad.deliveryStart}
              onChange={(e) => setNewLoad({ ...newLoad, deliveryStart: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery End Time"
              fullWidth
              type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={newLoad.deliveryEnd}
              onChange={(e) => setNewLoad({ ...newLoad, deliveryEnd: e.target.value })}
            />
          </Grid>
          {/* Load Specifications */}
          <Grid item xs={12} sm={4}>
            <TextField
              label="Load Weight"
              fullWidth
              type="number"
              value={newLoad.loadWeight}
              onChange={(e) => setNewLoad({ ...newLoad, loadWeight: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={8}>
            <Typography variant="subtitle2">Load Dimensions (L x W x H)</Typography>
            <Grid container spacing={1}>
              <Grid item xs={4}>
                <TextField
                  label="Length"
                  fullWidth
                  type="number"
                  value={newLoad.loadLength}
                  onChange={(e) => setNewLoad({ ...newLoad, loadLength: e.target.value })}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  label="Width"
                  fullWidth
                  type="number"
                  value={newLoad.loadWidth}
                  onChange={(e) => setNewLoad({ ...newLoad, loadWidth: e.target.value })}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  label="Height"
                  fullWidth
                  type="number"
                  value={newLoad.loadHeight}
                  onChange={(e) => setNewLoad({ ...newLoad, loadHeight: e.target.value })}
                />
              </Grid>
            </Grid>
          </Grid>
          {/* Additional Details */}
          <Grid item xs={12}>
            <TextField
              label="Commodity Type"
              fullWidth
              value={newLoad.commodityType}
              onChange={(e) => setNewLoad({ ...newLoad, commodityType: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Special Instructions"
              fullWidth
              multiline
              rows={3}
              value={newLoad.specialInstructions}
              onChange={(e) => setNewLoad({ ...newLoad, specialInstructions: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={newLoad.hazardousMaterial}
                  onChange={(e) => setNewLoad({ ...newLoad, hazardousMaterial: e.target.checked })}
                />
              }
              label="Hazardous Material"
            />
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
        <Alert severity={error ? 'error' : 'success'} sx={{ width: '100%' }}>
          {error ? error : 'Load successfully posted!'}
        </Alert>
      </Snackbar>
    </Paper>
  );
}

export default ShipperPostLoad;