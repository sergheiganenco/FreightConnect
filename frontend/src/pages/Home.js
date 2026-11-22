// src/pages/Home.js
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
import LoadCard from '../features/carrierDashboard/sections/components/LoadCard';

const accentColors = [brand.primary, brand.secondary, brand.indigo, '#34d399'];

// Sample loads for the public preview. Dates are relative to today so the
// section never looks stale.
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const sample = (origin, destination, equipmentType, loadWeight, tripMiles, rate, status, pickupIn, deadheadMiles) => ({
  origin, destination, equipmentType, loadWeight, tripMiles, rate, status, deadheadMiles,
  ratePerMile: rate / tripMiles,
  pickupTimeWindow: { start: inDays(pickupIn) },
  deliveryTimeWindow: { start: inDays(pickupIn + Math.ceil(tripMiles / 550)) },
});
const sampleLoads = [
  sample('Chicago, IL', 'Dallas, TX', 'Dry Van', 42000, 967, 2650, 'open', 1, 18),
  sample('Atlanta, GA', 'Miami, FL', 'Reefer', 38500, 662, 1950, 'open', 1, 42),
  sample('Los Angeles, CA', 'Phoenix, AZ', 'Flatbed', 45000, 373, 1250, 'accepted', 2),
  sample('Houston, TX', 'Kansas City, MO', 'Reefer', 40000, 742, 2150, 'open', 2, 27),
  sample('Columbus, OH', 'Charlotte, NC', 'Dry Van', 36000, 428, 1300, 'in-transit', 0),
  sample('Memphis, TN', 'Nashville, TN', 'Dry Van', 28000, 212, 850, 'open', 3, 9),
];

export default function Home() {
  const navigate = useNavigate();
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

        {/* Load board preview — the real carrier LoadCard fed with sample data */}
        <Box component="section" sx={{ mb: 8 }}>
          <Typography
            variant="h4"
            component="h2"
            sx={{ fontWeight: 800, textAlign: 'center', mb: 1, fontSize: { xs: '1.5rem', md: '2rem' } }}
          >
            See the load board
          </Typography>
          <Typography sx={{ color: text.secondary, textAlign: 'center', mb: 4 }}>
            Rate, rate per mile, deadhead and pickup dates on every card. Sample loads shown.
          </Typography>
          <Grid container spacing={2}>
            {sampleLoads.map((load) => (
              <Grid item xs={12} sm={6} md={4} key={load.origin + load.destination}>
                <LoadCard load={load} onClick={() => navigate('/signup')} />
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
