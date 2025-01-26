import React from 'react';
import { Box, Typography } from '@mui/material';

function Footer() {
  return (
    <Box component="footer" sx={{ padding: 2, textAlign: 'center', backgroundColor: '#f8f9fa' }}>
      <Typography variant="body2">
        © 2025 FreightConnect. All rights reserved.
      </Typography>
    </Box>
  );
}

export default Footer;
