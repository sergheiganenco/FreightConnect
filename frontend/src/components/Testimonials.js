// src/components/Testimonials.js
import React from 'react';
import { Box, Typography, Paper, Grid } from '@mui/material';
import { motion } from 'framer-motion';
import { glassCard, text } from '../theme/tokens';

const testimonials = [
  {
    quote: '"FreightConnect cut my empty miles in half and boosted revenue."',
    author: 'Jane Doe, Owner at Doe Transport',
  },
  {
    quote: '"Our logistics costs dropped by 20% thanks to AI-driven matching."',
    author: 'Global Foods Inc.',
  },
];

export default function Testimonials() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      <Box sx={{ py: 6 }}>
        <Typography variant="h4" fontWeight={700} textAlign="center" gutterBottom>
          What Our Users Say
        </Typography>
        <Grid container spacing={3} sx={{ mt: 2, justifyContent: 'center' }}>
          {testimonials.map((t, i) => (
            <Grid item xs={12} sm={6} key={i}>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.2 }}
              >
                <Paper sx={{ ...glassCard.standard, p: 3, height: '100%' }}>
                  <Typography variant="body1" sx={{ fontStyle: 'italic', mb: 2 }}>
                    {t.quote}
                  </Typography>
                  <Typography variant="body2" sx={{ color: text.secondary }}>
                    - {t.author}
                  </Typography>
                </Paper>
              </motion.div>
            </Grid>
          ))}
        </Grid>
      </Box>
    </motion.div>
  );
}
