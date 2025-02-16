import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function CarrierMyLoads() {
  const [acceptedLoads, setAcceptedLoads] = useState([]);
  const [error, setError] = useState(null);
  const navigate = useNavigate(); // Hook for navigation

  // Fetch only "accepted" loads
  useEffect(() => {
    const fetchAcceptedLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No token found');

        const response = await api.get('/loads', {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Filter loads that are "accepted" only
        const myLoads = response.data.filter((load) => load.status === 'accepted');
        setAcceptedLoads(myLoads);
      } catch (err) {
        console.error('Error fetching loads:', err.response?.data || err.message);
        setError('Failed to fetch loads.');
      }
    };

    fetchAcceptedLoads();
  }, []);

  return (
    <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 2 }}>
      <Typography variant="h4" gutterBottom>
        My Loads
      </Typography>

      {/* Back to Dashboard Button */}
      <Button
        variant="contained"
        color="secondary"
        onClick={() => navigate('/dashboard/carrier')}
        sx={{ mb: 2 }}
      >
        Back to Dashboard
      </Button>

      {error && <Typography variant="body1" color="error">{error}</Typography>}

      {/* Accepted Loads */}
      {acceptedLoads.length > 0 ? (
        <Box component="ul" sx={{ listStyle: 'none', pl: 0 }}>
          {acceptedLoads.map((load) => (
            <Paper key={load._id} component="li" sx={{ p: 2, mb: 2, backgroundColor: '#f5f5f5' }} elevation={1}>
              <Typography>
                <strong>{load.title}</strong> — {load.origin} to {load.destination} — ${load.rate} — Status: {load.status}
              </Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        <Typography>No accepted loads yet.</Typography>
      )}
    </Box>
  );
}

export default CarrierMyLoads;
