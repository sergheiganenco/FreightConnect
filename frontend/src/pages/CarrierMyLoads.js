import React, { useState, useEffect } from 'react';
import {
  Typography,
  Box,
  Paper,
  Button,
  MenuItem,
  Grid,
  CircularProgress,
  Snackbar,
  Alert,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function CarrierMyLoads() {
  const [loads, setLoads] = useState([]);
  const [filteredLoads, setFilteredLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();

  // Fetch loads on component mount
  useEffect(() => {
    const fetchMyLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await api.get('/loads/my-loads', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLoads(response.data);
        setFilteredLoads(response.data);
      } catch (err) {
        setError('Failed to fetch loads. Please try again later.');
        console.error('Error fetching loads:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMyLoads();
  }, []);

  // Filter loads based on status
  useEffect(() => {
    if (statusFilter === 'all') {
      setFilteredLoads(loads);
    } else {
      setFilteredLoads(loads.filter((load) => load.status === statusFilter));
    }
  }, [statusFilter, loads]);

  // Handle status change for a load
  const handleStatusChange = async (loadId, newStatus) => {
    try {
      const token = localStorage.getItem('token');
      await api.put(
        `/loads/${loadId}/status`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setLoads((prev) =>
        prev.map((load) => (load._id === loadId ? { ...load, status: newStatus } : load))
      );
      setSnackbarOpen(true);
    } catch (err) {
      setError('Failed to update load status. Please try again.');
      console.error('Status update error:', err);
    }
  };

  // Close Snackbar
  const handleSnackbarClose = () => {
    setSnackbarOpen(false);
  };

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        My Loads
      </Typography>

      {/* Back to Dashboard Button */}
      <Button
        variant="contained"
        color="secondary"
        onClick={() => navigate('/dashboard/carrier')}
        sx={{ mb: 3 }}
      >
        Back to Dashboard
      </Button>

      {/* Status Filter */}
      <Box sx={{ mb: 3 }}>
        <FormControl variant="outlined" sx={{ minWidth: 180 }}>
          <InputLabel>Filter by Status</InputLabel>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            label="Filter by Status"
            size="small"
            sx={{ backgroundColor: '#f0f4f8', borderRadius: 2 }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="accepted">Accepted</MenuItem>
            <MenuItem value="in-transit">In Transit</MenuItem>
            <MenuItem value="delivered">Delivered</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Error Message */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Loading State */}
      {loading ? (
        <Box display="flex" justifyContent="center" alignItems="center" height="200px">
          <CircularProgress />
          <Typography variant="body1" sx={{ ml: 2 }}>
            Loading loads...
          </Typography>
        </Box>
      ) : (
        /* Loads List */
        <Grid container spacing={3}>
          {filteredLoads.length > 0 ? (
            filteredLoads.map((load) => (
              <Grid item xs={12} key={load._id}>
                <Paper
                  sx={{
                    p: 3,
                    backgroundColor: load.status === 'delivered' ? '#e8f5e9' : '#ffffff',
                    borderRadius: 3,
                    boxShadow: 3,
                  }}
                >
                  <Typography variant="h6" gutterBottom>
                    {load.title} — {load.origin} to {load.destination}
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    <strong>Rate:</strong> ${load.rate}
                  </Typography>
                  <Typography variant="body1" gutterBottom>
                    <strong>Status:</strong> {load.status}
                  </Typography>

                  {/* Status Change Dropdown */}
                  {load.status !== 'delivered' && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>
                        Update Status:
                      </Typography>
                      <FormControl variant="outlined" sx={{ minWidth: 150 }}>
                        <Select
                          value={load.status}
                          onChange={(e) => handleStatusChange(load._id, e.target.value)}
                          variant="outlined"
                          size="small"
                          sx={{ backgroundColor: '#eef4ff', borderRadius: 2 }}
                        >
                          <MenuItem value="accepted">Accepted</MenuItem>
                          <MenuItem value="in-transit">In Transit</MenuItem>
                          <MenuItem value="delivered">Delivered</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                  )}

                  {/* Delivered Message */}
                  {load.status === 'delivered' && (
                    <Typography color="success.main" sx={{ mt: 2 }}>
                      Load delivered successfully
                    </Typography>
                  )}
                </Paper>
              </Grid>
            ))
          ) : (
            <Typography variant="body1" sx={{ mt: 2 }}>
              No loads found.
            </Typography>
          )}
        </Grid>
      )}

      {/* Success Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Load status updated successfully!
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default CarrierMyLoads;