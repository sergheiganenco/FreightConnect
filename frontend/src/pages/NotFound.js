import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import SearchOffIcon from '@mui/icons-material/SearchOff';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { brand, glassCard, text } from '../theme/tokens';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse 90% 640px at 50% 0, rgba(106,31,207,0.75) 0%, rgba(31,45,255,0.35) 45%, rgba(13,13,53,0) 100%) no-repeat top, #0d0d35',
        color: text.primary,
        p: 2,
      }}
    >
      <Paper
        sx={{
          p: { xs: 4, md: 6 },
          maxWidth: 520,
          width: '100%',
          ...glassCard.standard,
          textAlign: 'center',
        }}
      >
        <SearchOffIcon sx={{ fontSize: 72, color: brand.indigoLight, mb: 2 }} />

        <Typography
          variant="h1"
          fontWeight={900}
          sx={{ fontSize: { xs: '4rem', md: '6rem' }, color: brand.indigoLight, lineHeight: 1 }}
        >
          404
        </Typography>

        <Typography variant="h5" fontWeight={800} mt={1} mb={1} color={text.primary}>
          Page not found
        </Typography>

        <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.82)' }} mb={4}>
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
              borderColor: brand.indigoLight,
              color: text.primary,
              fontWeight: 700,
              borderRadius: 9999,
              px: 3,
              '&:hover': { bgcolor: 'rgba(255,255,255,0.08)', borderColor: '#fff' },
            }}
          >
            Go Back
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
