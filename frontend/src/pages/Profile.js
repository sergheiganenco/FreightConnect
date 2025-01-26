import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TextField, Button, Typography, Grid, CircularProgress } from '@mui/material';
import api from '../services/api';

export default function Profile() {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editable, setEditable] = useState(false);
  const [updatedUser, setUpdatedUser] = useState({});
  const navigate = useNavigate();

  // Fetch user profile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('No token found');
        const response = await api.get('/users/profile', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(response.data);
        setUpdatedUser(response.data);
      } catch (err) {
        console.error('Error fetching profile:', err.response?.data || err.message);
        setError('Failed to fetch profile.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  // Save updated profile
  const handleSave = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('No token found');
      await api.put('/users/profile', updatedUser, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Sync user with updated data
      setUser(updatedUser);
      setEditable(false);
      setError(null);
    } catch (err) {
      console.error('Error updating profile:', err.response?.data || err.message);
      setError('Failed to update profile.');
    }
  };

  // Navigate back to the correct dashboard
  const handleBackToDashboard = () => {
    const role = localStorage.getItem('role');
    console.log('Role in handleBackToDashboard:', role); // Debug log
    if (role === 'carrier') {
      navigate('/dashboard/carrier');
    } else if (role === 'shipper') {
      navigate('/dashboard/shipper');
    } else {
      navigate('/'); // fallback if no role found
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '70vh',
        }}
      >
        <CircularProgress />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <Typography variant="h4" gutterBottom>
        Profile
      </Typography>

      {error && (
        <Typography color="error" style={{ marginBottom: '1rem' }}>
          {error}
        </Typography>
      )}

      {user && (
        <Grid container spacing={3}>
          {/* Name Field */}
          <Grid item xs={12}>
            <TextField
              label="Name"
              variant="outlined"
              fullWidth
              value={updatedUser.name || ''}
              onChange={(e) =>
                setUpdatedUser({ ...updatedUser, name: e.target.value })
              }
              disabled={!editable}
            />
          </Grid>

          {/* Email Field */}
          <Grid item xs={12}>
            <TextField
              label="Email"
              variant="outlined"
              fullWidth
              value={updatedUser.email || ''}
              onChange={(e) =>
                setUpdatedUser({ ...updatedUser, email: e.target.value })
              }
              disabled={!editable}
            />
          </Grid>

          {/* Phone Field */}
          <Grid item xs={12}>
            <TextField
              label="Phone"
              variant="outlined"
              fullWidth
              value={updatedUser.phone || ''}
              onChange={(e) =>
                setUpdatedUser({ ...updatedUser, phone: e.target.value })
              }
              disabled={!editable}
            />
          </Grid>

          {/* Company Name Field */}
          <Grid item xs={12}>
            <TextField
              label="Company Name"
              variant="outlined"
              fullWidth
              value={updatedUser.companyName || ''}
              onChange={(e) =>
                setUpdatedUser({ ...updatedUser, companyName: e.target.value })
              }
              disabled={!editable}
            />
          </Grid>

          {/* Actions: Edit/Save and Back to Dashboard */}
          <Grid item xs={12}>
            {!editable ? (
              <Button
                variant="contained"
                color="primary"
                onClick={() => setEditable(true)}
                style={{ marginRight: '10px' }}
              >
                Edit Profile
              </Button>
            ) : (
              <Button
                variant="contained"
                color="secondary"
                onClick={handleSave}
                style={{ marginRight: '10px' }}
              >
                Save Changes
              </Button>
            )}
            <Button variant="outlined" onClick={handleBackToDashboard}>
              Back to Dashboard
            </Button>
          </Grid>
        </Grid>
      )}
    </div>
  );
}
