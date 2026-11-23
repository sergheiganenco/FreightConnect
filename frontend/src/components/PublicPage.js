// Shared shell for the public (logged-out) pages: background, width, heading.
import React from 'react';
import { Box, Container, Typography } from '@mui/material';
import { gradient, text, focusRing } from '../theme/tokens';

// Body copy colour with enough contrast on the purple gradient.
export const bodyText = 'rgba(255,255,255,0.82)';

// Visible keyboard focus for links/buttons on the public pages.
export const focusSx = { '&:focus-visible': focusRing };

export default function PublicPage({ title, intro, maxWidth = 'lg', children }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: gradient.dashboardBg,
        backgroundAttachment: 'fixed',
        color: text.primary,
        pt: { xs: 11, md: 13 },
        pb: { xs: 6, md: 10 },
        overflowX: 'clip',
      }}
    >
      <Container maxWidth={maxWidth} sx={{ px: { xs: 2, md: 4 } }}>
        {title && (
          <Box sx={{ mb: { xs: 4, md: 6 }, maxWidth: 760 }}>
            <Typography
              variant="h3"
              component="h1"
              sx={{ fontWeight: 800, fontSize: { xs: '2rem', md: '2.75rem' }, lineHeight: 1.15, mb: 2 }}
            >
              {title}
            </Typography>
            {intro && (
              <Typography sx={{ color: bodyText, fontSize: { xs: '1rem', md: '1.125rem' }, lineHeight: 1.65 }}>
                {intro}
              </Typography>
            )}
          </Box>
        )}
        {children}
      </Container>
    </Box>
  );
}
