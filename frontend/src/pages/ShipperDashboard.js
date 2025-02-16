import React, { useState, useEffect } from 'react';
import {
  TextField, Button, Grid, Typography, Select, MenuItem, Box, Paper, Snackbar, Alert
} from '@mui/material';
import api from '../services/api';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';

const mapContainerStyle = { width: '100%', height: '400px' };
const defaultCenter = { lat: 39.8283, lng: -98.5795 };

function ShipperDashboard() {
  const [loads, setLoads] = useState([]);
  const [newLoad, setNewLoad] = useState({ title: '', origin: '', destination: '', rate: '', equipmentType: '' });
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [openSnackbar, setOpenSnackbar] = useState(false);

  useEffect(() => {
    const fetchPostedLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await api.get('/loads/posted', {
          headers: { Authorization: `Bearer ${token}` },
          params: { status: statusFilter },
        });
        setLoads(response.data);
      } catch (err) {
        console.error('Error fetching posted loads:', err);
      }
    };

    fetchPostedLoads();
  }, [statusFilter, sortBy]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      await api.post('/loads', newLoad, { headers: { Authorization: `Bearer ${token}` } });
      setNewLoad({ title: '', origin: '', destination: '', rate: '', equipmentType: '' });
      setOpenSnackbar(true);
    } catch (err) {
      console.error('Error posting load:', err);
    }
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 2 }}>
      <Typography variant="h4" gutterBottom>Shipper Dashboard</Typography>

      <Snackbar open={openSnackbar} autoHideDuration={3000} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity="success" sx={{ width: '100%' }}>Load successfully posted!</Alert>
      </Snackbar>

      <Paper sx={{ p: 2, mb: 4 }} elevation={3}>
        <Typography variant="h6" gutterBottom>Post a New Load</Typography>
        <Box component="form" onSubmit={handleSubmit}>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6}>
              <TextField label="Title" fullWidth required value={newLoad.title}
                onChange={(e) => setNewLoad({ ...newLoad, title: e.target.value })} />
            </Grid>
          </Grid>
          <Button variant="contained" color="primary" type="submit" fullWidth>Post Load</Button>
        </Box>
      </Paper>

      <LoadScript googleMapsApiKey="YOUR_GOOGLE_MAPS_API_KEY">
        <GoogleMap mapContainerStyle={mapContainerStyle} center={defaultCenter} zoom={4} />
      </LoadScript>
    </Box>
  );
}

export default ShipperDashboard;
