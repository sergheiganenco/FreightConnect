import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { brand, gradient, surface } from '../theme/tokens';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: gradient.dashboardBg,
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
        <SearchOffIcon sx={{ fontSize: 72, color: brand.indigo, mb: 2, opacity: 0.85 }} />

        <Typography
          variant="h1"
          fontWeight={900}
          sx={{ fontSize: { xs: '4rem', md: '6rem' }, color: brand.indigo, lineHeight: 1 }}
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
              bgcolor: brand.indigo,
              fontWeight: 700,
              borderRadius: 9999,
              px: 3,
              '&:hover': { bgcolor: brand.indigo },
            }}
          >
            Go Home
          </Button>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(-1)}
            sx={{
              borderColor: brand.indigo,
              color: brand.indigo,
              fontWeight: 700,
              borderRadius: 9999,
              px: 3,
              '&:hover': { bgcolor: surface.indigoTintLight, borderColor: brand.indigo },
            }}
          >
            Go Back
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
