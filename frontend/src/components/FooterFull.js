import React from 'react';
import { Box, Typography, Grid, Link, Stack, IconButton, Divider } from '@mui/material';
import { LinkedIn, Twitter } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { surface, text, gradient } from '../theme/tokens';

const footerLinks = {
  product: [
    { label: 'Features', path: '/features' },
    { label: 'Pricing', path: '/features' },
    { label: 'Load Board', path: '/login' },
    { label: 'Carrier Network', path: '/login' },
    { label: 'Mobile App', path: '/features' },
  ],
  company: [
    { label: 'About', path: '/about' },
    { label: 'Contact', path: '/contact' },
    { label: 'Blog', path: '/about' },
    { label: 'Careers', path: '/about' },
    { label: 'Partners', path: '/contact' },
  ],
  legal: [
    { label: 'Terms of Service', path: '/terms' },
    { label: 'Privacy Policy', path: '/privacy' },
    { label: 'FMCSA Compliance', path: '/compliance' },
    { label: 'Cookie Policy', path: '/cookies' },
  ],
};

export default function FooterFull() {
  const navigate = useNavigate();

  const handleLinkClick = (path) => {
    navigate(path);
    window.scrollTo(0, 0);
  };

  return (
    <Box
      component="footer"
      sx={{
        background: '#0a1628',
        borderTop: `1px solid ${surface.glassBorder}`,
        pt: 6,
        pb: 3,
        px: { xs: 3, md: 8 },
      }}
    >
      <Grid container spacing={4} sx={{ maxWidth: 1200, mx: 'auto' }}>
        {/* Column 1: Brand */}
        <Grid item xs={12} md={3}>
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
          <Typography variant="body2" sx={{ color: text.secondary, lineHeight: 1.6 }}>
            Zero Broker Fees. Direct Freight Marketplace.
          </Typography>
          <Typography variant="body2" sx={{ color: text.muted, mt: 1, lineHeight: 1.6 }}>
            Connecting shippers and carriers directly, eliminating middlemen, and automating
            every function of freight brokerage.
          </Typography>
        </Grid>

        {/* Column 2: Product */}
        <Grid item xs={6} sm={4} md={3}>
          <Typography variant="subtitle2" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
            Product
          </Typography>
          <Stack spacing={1}>
            {footerLinks.product.map((link) => (
              <Link
                key={link.label}
                component="button"
                underline="none"
                onClick={() => handleLinkClick(link.path)}
                sx={{
                  color: text.secondary,
                  fontSize: '0.875rem',
                  textAlign: 'left',
                  '&:hover': { color: text.primary },
                  transition: 'color 0.2s',
                }}
              >
                {link.label}
              </Link>
            ))}
          </Stack>
        </Grid>

        {/* Column 3: Company */}
        <Grid item xs={6} sm={4} md={3}>
          <Typography variant="subtitle2" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
            Company
          </Typography>
          <Stack spacing={1}>
            {footerLinks.company.map((link) => (
              <Link
                key={link.label}
                component="button"
                underline="none"
                onClick={() => handleLinkClick(link.path)}
                sx={{
                  color: text.secondary,
                  fontSize: '0.875rem',
                  textAlign: 'left',
                  '&:hover': { color: text.primary },
                  transition: 'color 0.2s',
                }}
              >
                {link.label}
              </Link>
            ))}
          </Stack>
        </Grid>

        {/* Column 4: Legal */}
        <Grid item xs={6} sm={4} md={3}>
          <Typography variant="subtitle2" sx={{ color: text.primary, fontWeight: 600, mb: 2 }}>
            Legal
          </Typography>
          <Stack spacing={1}>
            {footerLinks.legal.map((link) => (
              <Link
                key={link.label}
                component="button"
                underline="none"
                onClick={() => handleLinkClick(link.path)}
                sx={{
                  color: text.secondary,
                  fontSize: '0.875rem',
                  textAlign: 'left',
                  '&:hover': { color: text.primary },
                  transition: 'color 0.2s',
                }}
              >
                {link.label}
              </Link>
            ))}
          </Stack>
        </Grid>
      </Grid>

      {/* Bottom bar */}
      <Divider sx={{ borderColor: surface.glassBorder, mt: 4, mb: 3, maxWidth: 1200, mx: 'auto' }} />

      <Box sx={{
        maxWidth: 1200, mx: 'auto',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 2,
      }}>
        <Typography variant="body2" sx={{ color: text.muted }}>
          &copy; {new Date().getFullYear()} FreightConnect. All rights reserved.
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* SOC2 badge placeholder */}
          <Box sx={{
            px: 1.5, py: 0.5, borderRadius: 1,
            border: `1px solid ${surface.glassBorder}`,
            display: 'flex', alignItems: 'center', gap: 0.5,
          }}>
            <Typography variant="caption" sx={{ color: text.muted, fontWeight: 600, letterSpacing: 1 }}>
              SOC 2
            </Typography>
          </Box>

          {/* Social icons */}
          <Stack direction="row" spacing={0.5}>
            <IconButton
              size="small"
              aria-label="LinkedIn"
              sx={{ color: text.muted, '&:hover': { color: text.primary } }}
              onClick={() => window.open('https://linkedin.com', '_blank', 'noopener')}
            >
              <LinkedIn fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label="Twitter"
              sx={{ color: text.muted, '&:hover': { color: text.primary } }}
              onClick={() => window.open('https://twitter.com', '_blank', 'noopener')}
            >
              <Twitter fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
