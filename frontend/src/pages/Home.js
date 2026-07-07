// src/pages/Home.js
import React from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, FileText, Eye, Ban } from 'lucide-react';
import { motion } from 'framer-motion';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Paper,
} from '@mui/material';
import {
  gradient,
  text,
  brand,
  tint,
  radius,
  glassCard,
  buttonVariants,
} from '../theme/tokens';
import Testimonials from '../components/Testimonials';

const accentColors = [brand.primary, brand.secondary, brand.indigo, '#34d399'];

export default function Home() {
  const benefits = [
    {
      icon: <Sparkles size={24} />,
      title: 'AI-Powered Load Matching',
      desc: 'Match loads with carriers automatically to maximize utilization.',
    },
    {
      icon: <FileText size={24} />,
      title: 'Automated Documents',
      desc: 'Generate & store BOL, rate cons, PODs without manual entry.',
    },
    {
      icon: <Eye size={24} />,
      title: 'Real-Time Visibility',
      desc: 'Live GPS tracking and predictive ETAs for every shipment.',
    },
    {
      icon: <Ban size={24} />,
      title: 'Zero Broker Fees',
      desc: 'Connect directly — keep the margin you earn.',
    },
  ];

  return (
    <Box
      component="main"
      id="main-content"
      sx={{
        minHeight: '100vh',
        background: gradient.dashboardBg,
        backgroundAttachment: 'fixed',
        color: text.primary,
        pt: 12,
        pb: 8,
      }}
    >
      <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <Box component="section" sx={{ textAlign: 'center', mb: 8, mt: 4 }}>
            <Typography
              variant="h2"
              component="h1"
              sx={{
                fontWeight: 800,
                fontSize: { xs: '2rem', md: '3rem' },
                mb: 2,
              }}
            >
              Transform Your Freight Operations with AI
            </Typography>
            <Typography
              variant="h6"
              sx={{
                color: text.secondary,
                maxWidth: 600,
                mx: 'auto',
                mb: 4,
              }}
            >
              Optimize logistics with intelligent load matching, automated
              document processing, and real-time visibility.
            </Typography>
            <Button
              component={Link}
              to="/signup"
              sx={{
                ...buttonVariants.gradient,
                px: 4,
                py: 1.5,
                fontSize: '1.1rem',
                borderRadius: radius.md,
                textTransform: 'none',
                fontWeight: 700,
              }}
            >
              Get Started Free
            </Button>
          </Box>
        </motion.div>

        {/* Feature cards */}
        <Box component="section" sx={{ mb: 8 }}>
          <Grid container spacing={3}>
            {benefits.map((b, idx) => (
              <Grid item xs={12} sm={6} md={3} key={b.title}>
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: idx * 0.1 }}
                  style={{ height: '100%' }}
                >
                  <Paper
                    elevation={0}
                    sx={{
                      ...glassCard.standard,
                      p: 3,
                      height: '100%',
                      borderLeft: `4px solid ${accentColors[idx]}`,
                      transition: 'transform 0.2s',
                      '&:hover': { transform: 'translateY(-4px)' },
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: radius.sm,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: tint(accentColors[idx], 0.15),
                        mb: 2,
                        color: accentColors[idx],
                      }}
                    >
                      {b.icon}
                    </Box>
                    <Typography
                      variant="h6"
                      component="h3"
                      sx={{ fontWeight: 700, mb: 1, fontSize: '1rem' }}
                    >
                      {b.title}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ color: text.secondary, lineHeight: 1.6 }}
                    >
                      {b.desc}
                    </Typography>
                  </Paper>
                </motion.div>
              </Grid>
            ))}
          </Grid>
        </Box>

        {/* Testimonials */}
        <Testimonials />
      </Container>
    </Box>
  );
}
