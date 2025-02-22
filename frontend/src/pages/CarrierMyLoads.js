// src/pages/CarrierMyLoads.js
import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function CarrierMyLoads() {
  const [acceptedLoads, setAcceptedLoads] = useState([]);
  const [deliveredLoads, setDeliveredLoads] = useState([]);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  // Fetch loads from /api/loads and separate by status
  useEffect(() => {
    const fetchMyLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await api.get('/loads', {
          headers: { Authorization: `Bearer ${token}` },
        });
        // Filter loads into accepted and delivered
        const accepted = response.data.filter((load) => load.status === 'accepted');
        const delivered = response.data.filter((load) => load.status === 'delivered');
        setAcceptedLoads(accepted);
        setDeliveredLoads(delivered);
      } catch (err) {
        console.error('Error fetching loads:', err.response?.data || err.message);
        setError('Failed to fetch loads.');
      }
    };

    fetchMyLoads();
  }, []);

  const handleMarkDelivered = async (loadId) => {
    try {
      const token = localStorage.getItem('token');
      await api.put(`/loads/${loadId}/deliver`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Remove from accepted loads and add to delivered loads:
      setAcceptedLoads((prev) => prev.filter((load) => load._id !== loadId));
      // Optionally, you can fetch the delivered load details from the response
      // For simplicity, we just add a dummy delivered load entry:
      setDeliveredLoads((prev) => [...prev, { _id: loadId, status: 'delivered' }]);
    } catch (err) {
      console.error('Error marking load as delivered:', err);
      setError('Failed to mark load as delivered.');
    }
  };

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

      {/* Accepted Loads Section */}
      <Typography variant="h6" sx={{ mt: 2 }}>
        Accepted Loads
      </Typography>
      {acceptedLoads.length > 0 ? (
        <Box component="ul" sx={{ listStyle: 'none', pl: 0 }}>
          {acceptedLoads.map((load) => (
            <Paper key={load._id} component="li" sx={{ p: 2, mb: 2, backgroundColor: '#f5f5f5' }} elevation={1}>
              <Typography variant="h6">
                {load.title} — {load.origin} to {load.destination}
              </Typography>
              <Typography>
                <strong>Rate:</strong> ${load.rate} — <strong>Status:</strong> {load.status}
              </Typography>
              {load.status === 'accepted' && (
                <Button
                  variant="contained"
                  color="primary"
                  sx={{ mt: 1 }}
                  onClick={() => handleMarkDelivered(load._id)}
                >
                  Mark as Delivered
                </Button>
              )}
            </Paper>
          ))}
        </Box>
      ) : (
        <Typography>No accepted loads.</Typography>
      )}

      {/* Delivered Loads Section */}
      <Typography variant="h6" sx={{ mt: 4 }}>
        Delivered Loads
      </Typography>
      {deliveredLoads.length > 0 ? (
        <Box component="ul" sx={{ listStyle: 'none', pl: 0 }}>
          {deliveredLoads.map((load) => (
            <Paper key={load._id} component="li" sx={{ p: 2, mb: 2, backgroundColor: '#e0ffe0' }} elevation={1}>
              <Typography variant="h6">
                {load.title} — {load.origin} to {load.destination}
              </Typography>
              <Typography>
                <strong>Rate:</strong> ${load.rate} — <strong>Status:</strong> {load.status}
              </Typography>
              <Typography color="green" sx={{ mt: 1 }}>
                Delivered
              </Typography>
            </Paper>
          ))}
        </Box>
      ) : (
        <Typography>No delivered loads.</Typography>
      )}
    </Box>
  );
}

export default CarrierMyLoads;
