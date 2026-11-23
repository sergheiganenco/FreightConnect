// Shared shell for the public (logged-out) pages: background, width, heading.
import React from 'react';
import { Box, Container, Typography } from '@mui/material';
import { text, focusRing } from '../theme/tokens';

// Body copy colour with enough contrast on the purple gradient.
export const bodyText = 'rgba(255,255,255,0.82)';

// Visible keyboard focus for links/buttons on the public pages.
export const focusSx = { '&:focus-visible': focusRing };

export default function PublicPage({ title, intro, maxWidth = 'lg', children }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        // One continuous dark base; the colour glow sits only in the top block and fades out before the first card.
        background: 'radial-gradient(ellipse 90% 640px at 50% 0, rgba(106,31,207,0.75) 0%, rgba(31,45,255,0.35) 45%, rgba(13,13,53,0) 100%) no-repeat top, #0d0d35',
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
