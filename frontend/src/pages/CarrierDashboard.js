import React, { useState, useEffect } from 'react';
import { TextField, Button } from '@mui/material';
import api from '../services/api';

function CarrierDashboard() {
  const [loads, setLoads] = useState([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

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

  const filteredLoads = loads.filter(
    (load) =>
      load.origin.toLowerCase().includes(filter.toLowerCase()) ||
      load.destination.toLowerCase().includes(filter.toLowerCase()) ||
      load.rate.toString().includes(filter)
  );

  return (
    <div>
      <h2>Carrier Dashboard</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <TextField
        label="Search by origin, destination, or rate"
        variant="outlined"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: '1rem', width: '100%' }}
      />
      <ul>
        {filteredLoads.map((load) => (
          <li key={load._id} style={{ marginBottom: '1rem' }}>
            <p>
              <strong>{load.title}</strong> — {load.origin} to {load.destination} — ${load.rate} —{' '}
              Status: {load.status}
            </p>
            {load.status === 'open' && (
              <Button
                variant="contained"
                color="primary"
                onClick={() => handleAccept(load._id)}
              >
                Accept
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CarrierDashboard;
