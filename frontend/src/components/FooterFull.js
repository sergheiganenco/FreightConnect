import React from 'react';
import { Box, Typography, Grid, Stack, Divider } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { surface, text, gradient, focusRing } from '../theme/tokens';

const footerLinks = {
  Product: [
    { label: 'Features', path: '/features' },
    { label: 'How it works', path: '/about' },
    { label: 'For shippers', path: '/signup' },
    { label: 'For carriers', path: '/signup' },
    { label: 'Sign in', path: '/login' },
  ],
  Company: [
    { label: 'About', path: '/about' },
    { label: 'Contact', path: '/contact' },
  ],
  Legal: [
    { label: 'Terms of Service', path: '/terms-of-service' },
    { label: 'Privacy Policy', path: '/privacy-policy' },
  ],
};

const linkSx = {
  color: 'rgba(255,255,255,0.75)',
  fontSize: '0.9rem',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 32,
  '&:hover': { color: text.primary, textDecoration: 'underline' },
  '&:focus-visible': focusRing,
};

export default function FooterFull() {
  return (
    <Box
      component="footer"
      sx={{
        background: '#0a1628',
        borderTop: `1px solid ${surface.glassBorder}`,
        pt: 6,
        pb: 3,
        px: { xs: 3, md: 8 },
        overflowX: 'clip', // the Grid container's negative-margin spacing must not widen the page on phones
      }}
    >
      <Grid container spacing={4} sx={{ maxWidth: 1200, mx: 'auto' }}>
        <Grid item xs={12} md={4}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 700,
              background: gradient.primary,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              mb: 1,
            }}
          >
            FreightConnect
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, maxWidth: 320 }}>
            A freight marketplace where shippers and carriers deal with each other directly. In early access.
          </Typography>
        </Grid>

        {Object.entries(footerLinks).map(([heading, links]) => (
          <Grid item xs={6} sm={4} md={heading === 'Product' ? 3 : 2.5} key={heading}>
            <Typography component="h2" variant="subtitle2" sx={{ color: text.primary, fontWeight: 600, mb: 1.5 }}>
              {heading}
            </Typography>
            <Stack component="ul" spacing={0.5} sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {links.map((link) => (
                <li key={link.label}>
                  <Box
                    component={RouterLink}
                    to={link.path}
                    onClick={() => window.scrollTo(0, 0)}
                    sx={linkSx}
                  >
                    {link.label}
                  </Box>
                </li>
              ))}
            </Stack>
          </Grid>
        ))}
      </Grid>

      <Divider sx={{ borderColor: surface.glassBorder, mt: 4, mb: 3, maxWidth: 1200, mx: 'auto' }} />

      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>
          &copy; {new Date().getFullYear()} FreightConnect. All rights reserved.
        </Typography>
      </Box>
    </Box>
  );
}
