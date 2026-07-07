// src/pages/Features.js
import React from 'react';
import { Box, Container, Paper, Typography, Grid } from '@mui/material';
import { Sparkles, FileText, Eye, Ban } from 'lucide-react';
import { motion } from 'framer-motion';
import { gradient, text, glassCard, brand } from '../theme/tokens';

const features = [
  {
    icon: <Sparkles />,
    title: 'AI Matching',
    desc: 'Maximize fleet utilization automatically.',
    color: brand.primary,
  },
  {
    icon: <FileText />,
    title: 'Auto Documents',
    desc: 'Instant BOL, rate con, POD generation.',
    color: brand.secondary,
  },
  {
    icon: <Eye />,
    title: 'Live Tracking',
    desc: 'GPS + predictive ETAs on every shipment.',
    color: brand.indigo,
  },
  {
    icon: <Ban />,
    title: 'No Broker Fees',
    desc: 'Keep your full margin--book directly.',
    color: brand.indigoLight,
  },
];

export default function Features() {
  return (
    <Box sx={{ minHeight: '100vh', background: gradient.dashboardBg, backgroundAttachment: 'fixed', color: text.primary, pt: 12, pb: 8 }}>
      <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
        <Paper sx={{ ...glassCard.elevated, p: { xs: 3, md: 5 } }}>
          <Typography variant="h3" fontWeight={700} gutterBottom textAlign="center">
            Platform Features
          </Typography>
          <Grid container spacing={3} sx={{ mt: 2 }}>
            {features.map((f, i) => (
              <Grid item xs={12} sm={6} md={3} key={f.title}>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                >
                  <Paper
                    sx={{
                      ...glassCard.standard,
                      p: 3,
                      textAlign: 'center',
                      height: '100%',
                      borderTop: `3px solid ${f.color}`,
                    }}
                  >
                    <Box sx={{ color: f.color, mb: 2, display: 'flex', justifyContent: 'center' }}>
                      {f.icon}
                    </Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {f.title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: text.secondary }}>
                      {f.desc}
                    </Typography>
                  </Paper>
                </motion.div>
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Container>
    </Box>
  );
}
