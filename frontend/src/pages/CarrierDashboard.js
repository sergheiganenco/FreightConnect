import React, { useState, useEffect } from 'react';
import { TextField, Select, MenuItem, Button, Typography } from '@mui/material';
import api from '../services/api';
import '../styles/Dashboard.css';

function CarrierDashboard() {
  const [loads, setLoads] = useState([]);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState('');
  const [error, setError] = useState(null);

  // Fetch loads on component mount or when filters change
  useEffect(() => {
    const fetchLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await api.get('/loads', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLoads(response.data);
      } catch (err) {
        console.error('Error fetching loads:', err.response?.data || err.message);
        setError('Failed to fetch loads.');
      }
    };

    fetchLoads();
  }, []);

  // Filter and sort loads dynamically
  const filteredLoads = loads
    .filter((load) =>
      [load.origin, load.destination, load.equipmentType, load.rate.toString()]
        .some((value) => value.toLowerCase().includes(filter.toLowerCase()))
    )
    .sort((a, b) => {
      if (sortBy === 'rateAsc') return a.rate - b.rate;
      if (sortBy === 'rateDesc') return b.rate - a.rate;
      return 0;
    });

  // Accept load handler
  const handleAccept = async (loadId) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');
      await api.put(`/loads/${loadId}/accept`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLoads((prevLoads) =>
        prevLoads.map((load) =>
          load._id === loadId ? { ...load, status: 'accepted' } : load
        )
      );
    } catch (err) {
      console.error('Error accepting load:', err.response?.data || err.message);
      setError('Failed to accept load.');
    }
  };

  return (
    <div>
      <Typography variant="h4" gutterBottom>
        Carrier Dashboard
      </Typography>
      {error && <Typography style={{ color: 'red' }}>{error}</Typography>}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <TextField
          label="Search by origin, destination, or rate"
          variant="outlined"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          displayEmpty
          style={{ width: '200px' }}
        >
          <MenuItem value="">Sort By</MenuItem>
          <MenuItem value="rateAsc">Rate (Low to High)</MenuItem>
          <MenuItem value="rateDesc">Rate (High to Low)</MenuItem>
        </Select>
      </div>
      <Typography variant="h5" gutterBottom>
        Available Loads
      </Typography>
      <ul>
        {filteredLoads.length > 0 ? (
          filteredLoads.map((load) => (
            <li key={load._id} style={{ marginBottom: '1rem' }}>
              <Typography>
                <strong>{load.title}</strong> — {load.origin} to {load.destination} — ${load.rate} —{' '}
                Status: {load.status}
              </Typography>
              {load.status === 'open' && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => handleAccept(load._id)}
                  style={{ marginTop: '10px' }}
                >
                  Accept
                </Button>
              )}
            </li>
          ))
        ) : (
          <Typography>No loads available.</Typography>
        )}
      </ul>
    </div>
  );
}

export default CarrierDashboard;
