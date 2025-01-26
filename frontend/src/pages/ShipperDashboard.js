import React, { useState, useEffect } from 'react';
import {
  TextField,
  Button,
  Grid,
  Typography,
  Select,
  MenuItem,
  Box,
  Paper,
  Snackbar,
  Alert,
} from '@mui/material';
import api from '../services/api';
import '../styles/Dashboard.css';

function ShipperDashboard() {
  const [loads, setLoads] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [newLoad, setNewLoad] = useState({
    title: '',
    origin: '',
    destination: '',
    rate: '',
    equipmentType: '',
  });
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [openSnackbar, setOpenSnackbar] = useState(false); // State for snackbar visibility

  useEffect(() => {
    const fetchPostedLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No token found');

        const response = await api.get('/loads/posted', {
          headers: { Authorization: `Bearer ${token}` },
          params: { status: statusFilter },
        });

        let sortedLoads = response.data;
        if (sortBy) {
          sortedLoads = [...sortedLoads].sort((a, b) =>
            sortBy === 'rateAsc' ? a.rate - b.rate : b.rate - a.rate
          );
        }

        setLoads(sortedLoads);
      } catch (err) {
        console.error('Error fetching posted loads:', err.response?.data || err.message);
        setError('Failed to fetch posted loads.');
      }
    };

    fetchPostedLoads();
  }, [statusFilter, sortBy]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');

      if (!newLoad.equipmentType) {
        setError('Equipment Type cannot be empty. Please select a type.');
        return;
      }

      const numericRate = parseFloat(newLoad.rate) || 0;

      const response = await api.post(
        '/loads',
        { ...newLoad, rate: numericRate },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Add the new load to the list and sort it (optional)
      setLoads((prevLoads) => [...prevLoads, response.data.load]);

      // Reset the form fields
      setNewLoad({
        title: '',
        origin: '',
        destination: '',
        rate: '',
        equipmentType: '',
      });

      // Show success message and snackbar
      setSuccessMessage('Load successfully posted!');
      setOpenSnackbar(true);

      setError(null);
    } catch (err) {
      console.error('Error posting load:', err.response?.data || err.message);
      setError('Failed to post load.');
    }
  };

  const handleCloseSnackbar = () => {
    setOpenSnackbar(false);
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Shipper Dashboard
      </Typography>

      {error && (
        <Typography variant="body1" color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {/* Snackbar for success message */}
      <Snackbar
        open={openSnackbar}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>

      {/* Post Load Form */}
      <Paper sx={{ p: 2, mb: 4 }} elevation={3}>
        <Typography variant="h6" gutterBottom>
          Post a New Load
        </Typography>
        <Box component="form" onSubmit={handleSubmit}>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Title"
                variant="outlined"
                fullWidth
                required
                value={newLoad.title}
                onChange={(e) => setNewLoad({ ...newLoad, title: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Origin"
                variant="outlined"
                fullWidth
                required
                value={newLoad.origin}
                onChange={(e) => setNewLoad({ ...newLoad, origin: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Destination"
                variant="outlined"
                fullWidth
                required
                value={newLoad.destination}
                onChange={(e) => setNewLoad({ ...newLoad, destination: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Rate"
                variant="outlined"
                type="number"
                fullWidth
                required
                value={newLoad.rate}
                onChange={(e) => setNewLoad({ ...newLoad, rate: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Equipment Type
              </Typography>
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
              </Select>
            </Grid>
          </Grid>
          <Button variant="contained" color="primary" type="submit" fullWidth>
            Post Load
          </Button>
        </Box>
      </Paper>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }} elevation={2}>
        <Typography variant="h6" gutterBottom>
          Filters
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            displayEmpty
            sx={{ width: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
            <MenuItem value="delivered">Delivered</MenuItem>
          </Select>
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            displayEmpty
            sx={{ width: 200 }}
          >
            <MenuItem value="">Sort By</MenuItem>
            <MenuItem value="rateAsc">Rate (Low to High)</MenuItem>
            <MenuItem value="rateDesc">Rate (High to Low)</MenuItem>
          </Select>
        </Box>
      </Paper>

      {/* Posted Loads */}
      <Typography variant="h5" gutterBottom>
        Your Posted Loads
      </Typography>
      {loads.length > 0 ? (
        <Box component="ul" sx={{ listStyle: 'none', pl: 0 }}>
          {loads.map((load) => (
            <Paper
              key={load._id}
              component="li"
              sx={{
                mb: 2,
                p: 2,
                border: '1px solid #ddd',
                borderRadius: 2,
                backgroundColor: '#fafafa',
              }}
              elevation={1}
            >
              <Typography variant="body1">
                <strong>{load.title}</strong> — {load.origin} to {load.destination} — $
                {load.rate} — Status: {load.status}
              </Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        <Typography>No posted loads found.</Typography>
      )}
    </Box>
  );
}

export default ShipperDashboard;
