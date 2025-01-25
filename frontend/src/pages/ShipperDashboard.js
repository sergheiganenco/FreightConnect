import React, { useState, useEffect } from 'react';
import { TextField, Button, Grid } from '@mui/material';
import api from '../services/api';

function ShipperDashboard() {
  const [loads, setLoads] = useState([]);
  const [error, setError] = useState(null);
  const [newLoad, setNewLoad] = useState({
    title: '',
    origin: '',
    destination: '',
    rate: '',
    equipmentType: '',
  });

  useEffect(() => {
    const fetchPostedLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await api.get('/loads/posted', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLoads(response.data);
      } catch (err) {
        console.error('Error fetching posted loads:', err.response?.data || err.message);
        setError('Failed to fetch posted loads.');
      }
    };

    fetchPostedLoads();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');
      await api.post(
        '/loads',
        { ...newLoad },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setNewLoad({ title: '', origin: '', destination: '', rate: '', equipmentType: '' });
      setError(null);
      const response = await api.get('/loads/posted', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setLoads(response.data);
    } catch (err) {
      console.error('Error posting load:', err.response?.data || err.message);
      setError('Failed to post load.');
    }
  };

  return (
    <div>
      <h2>Shipper Dashboard</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit} style={{ marginBottom: '2rem' }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Title"
              variant="outlined"
              fullWidth
              value={newLoad.title}
              onChange={(e) => setNewLoad({ ...newLoad, title: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Origin"
              variant="outlined"
              fullWidth
              value={newLoad.origin}
              onChange={(e) => setNewLoad({ ...newLoad, origin: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Destination"
              variant="outlined"
              fullWidth
              value={newLoad.destination}
              onChange={(e) => setNewLoad({ ...newLoad, destination: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Rate"
              variant="outlined"
              type="number"
              fullWidth
              value={newLoad.rate}
              onChange={(e) => setNewLoad({ ...newLoad, rate: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Equipment Type"
              variant="outlined"
              fullWidth
              value={newLoad.equipmentType}
              onChange={(e) => setNewLoad({ ...newLoad, equipmentType: e.target.value })}
              required
            />
          </Grid>
          <Grid item xs={12}>
            <Button variant="contained" color="primary" type="submit" fullWidth>
              Post Load
            </Button>
          </Grid>
        </Grid>
      </form>
      <h3>Your Posted Loads</h3>
      <ul>
        {loads.map((load) => (
          <li key={load._id} style={{ marginBottom: '1rem' }}>
            <p>
              <strong>{load.title}</strong> — {load.origin} to {load.destination} — ${load.rate} —{' '}
              Status: {load.status}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ShipperDashboard;
