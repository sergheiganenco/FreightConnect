import React, { useState, useEffect } from 'react';
import { TextField, Button } from '@mui/material';
import api from '../services/api';

function Profile() {
  const [profile, setProfile] = useState({ name: '', email: '' });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await api.get('/users/profile', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setProfile(response.data);
      } catch (err) {
        console.error('Error fetching profile:', err.response?.data || err.message);
        setError('Failed to fetch profile.');
      }
    };

    fetchProfile();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await api.put(
        '/users/profile',
        { name: profile.name, email: profile.email },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setSuccess('Profile updated successfully');
      setError(null);
    } catch (err) {
      console.error('Error updating profile:', err.response?.data || err.message);
      setError('Failed to update profile.');
      setSuccess(null);
    }
  };

  return (
    <div>
      <h2>User Profile</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {success && <p style={{ color: 'green' }}>{success}</p>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <TextField
          label="Name"
          variant="outlined"
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
          fullWidth
        />
        <TextField
          label="Email"
          variant="outlined"
          type="email"
          value={profile.email}
          onChange={(e) => setProfile({ ...profile, email: e.target.value })}
          fullWidth
        />
        <Button variant="contained" color="primary" type="submit">
          Update Profile
        </Button>
      </form>
    </div>
  );
}

export default Profile;
