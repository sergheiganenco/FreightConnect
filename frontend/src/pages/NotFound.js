import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1f2dff 0%, #6a1fcf 40%, #e1129a 100%)',
        p: 2,
      }}
    >
      <Paper
        sx={{
          p: { xs: 4, md: 6 },
          maxWidth: 520,
          width: '100%',
          borderRadius: 5,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 24px 80px rgba(31,45,255,0.18)',
        }}
      >
        <SearchOffIcon sx={{ fontSize: 72, color: '#6366f1', mb: 2, opacity: 0.85 }} />

        <Typography
          variant="h1"
          fontWeight={900}
          sx={{ fontSize: { xs: '4rem', md: '6rem' }, color: '#6366f1', lineHeight: 1 }}
        >
          404
        </Typography>

        <Typography variant="h5" fontWeight={800} mt={1} mb={1} color="#1e1e2e">
          Page not found
        </Typography>

        <Typography variant="body1" color="text.secondary" mb={4}>
          The page you're looking for doesn't exist or has been moved.
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<HomeIcon />}
            onClick={() => navigate('/')}
            sx={{
              bgcolor: '#6366f1',
              fontWeight: 700,
              borderRadius: 9999,
              px: 3,
              '&:hover': { bgcolor: '#4f46e5' },
            }}
          >
            Go Home
          </Button>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(-1)}
            sx={{
              borderColor: '#6366f1',
              color: '#6366f1',
              fontWeight: 700,
              borderRadius: 9999,
              px: 3,
              '&:hover': { bgcolor: 'rgba(99,102,241,0.06)', borderColor: '#4f46e5' },
            }}
          >
            Go Back
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
