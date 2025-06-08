import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Grid,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Stack,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import '../styles/Dashboard.css';

export default function Profile() {
  const navigate = useNavigate();
  const role = localStorage.getItem('role') || 'guest';
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [editable, setEditable] = useState(false);
  const [error, setError] = useState();

  // Set dashboard background class
  useEffect(() => {
    document.body.classList.add('dashboard-page');
    return () => {
      document.body.classList.remove('dashboard-page');
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const { data } = await api.get('/users/profile', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUser(data);
        setForm(data);
      } catch (err) {
        setError('Could not load profile.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      const token = localStorage.getItem('token');
      await api.put('/users/profile', form, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(form);
      setEditable(false);
      setError(null);
    } catch {
      setError('Save failed. Try again.');
    }
  };

  const handleCancel = () => {
    setForm(user);   // Reset form to original user data
    setEditable(false);
    setError(null);
  };

  if (loading) {
    return (
      <Box
        sx={{
          height: '75vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress color="secondary" />
      </Box>
    );
  }

  return (
    <Box className="dashboard-wrapper" sx={{ minHeight: '100vh' }}>
      <Box sx={{ pt: 12, maxWidth: 700, mx: 'auto' }}>
        <Typography variant="h5" fontWeight={700} mb={3} sx={{ color: '#fff' }}>
          Profile
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Paper
          className="glass-card"
          sx={{
            p: 4,
            borderRadius: 4,
            background: 'rgba(60, 30, 120, 0.35)',
            boxShadow: '0 6px 32px 0 rgba(44,30,100,0.12)'
          }}
        >
          <Stack spacing={3}>
            <Grid container spacing={2}>
              {[
                ['Name', 'name'],
                ['Email', 'email'],
                ['Phone', 'phone'],
                ['Company Name', 'companyName'],
              ].map(([label, key]) => (
                <Grid item xs={12} sm={6} key={key}>
                  <TextField
                    label={label}
                    fullWidth
                    variant="filled"
                    value={form[key] || ''}
                    disabled={!editable}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                    slotProps={{
                      input: {
                        sx: {
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: '1.09rem',
                          WebkitTextFillColor: '#fff',
                        }
                      },
                      root: {
                        sx: {
                          bgcolor: 'rgba(30,30,50,0.65)',
                          borderRadius: 2,
                          boxShadow: '0 2px 10px 0 rgba(60,30,120,0.10)',
                        }
                      },
                      label: {
                        sx: {
                          color: '#fff',
                          fontWeight: 600,
                          opacity: 1,
                          fontSize: '1.03rem',
                          '&.Mui-focused': {
                            color: '#fff',
                            opacity: 1,
                          }
                        }
                      }
                    }}
                    InputProps={{
                      disableUnderline: true
                    }}
                  />
                </Grid>
              ))}
            </Grid>
            <Box sx={{ display: 'flex', gap: 2 }}>
              {!editable ? (
                <Button
                  className="btn-gradient"
                  onClick={() => setEditable(true)}
                >
                  Edit Profile
                </Button>
              ) : (
                <>
                  <Button
                    className="btn-gradient"
                    onClick={handleSave}
                  >
                    Save Changes
                  </Button>
                  <Button
                    variant="outlined"
                    sx={{ color: '#fff', borderColor: '#fff' }}
                    onClick={handleCancel}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </Box>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
