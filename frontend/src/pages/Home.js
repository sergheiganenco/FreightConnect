// src/pages/Home.js
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Container, Typography, Button, Grid, Paper, Chip } from '@mui/material';
import { Handshake, ShieldCheck, FileSignature, MapPin } from 'lucide-react';
import { gradient, text, glassCard, buttonVariants, radius, brand, tint } from '../theme/tokens';
import { bodyText, focusSx } from '../components/PublicPage';
import LoadCard from '../features/carrierDashboard/sections/components/LoadCard';

// Example loads for the public preview — NOT live freight. Dates are relative to
// today so the cards never look stale.
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
  sample('Houston, TX', 'Kansas City, MO', 'Reefer', 40000, 742, 2150, 'open', 2, 27),
];

const shipperSteps = [
  ['Post the load', 'Pickup, delivery, equipment and a rate. Multi-stop, hazmat and reefer are supported.'],
  ['Choose your carrier', 'Take bids, book a carrier you already trust, or offer it to your own list first.'],
  ['Follow it to delivery', 'Live tracking, automatic status updates, and signed paperwork on the load.'],
];
const carrierSteps = [
  ['Find freight that fits', 'A load board with rate per mile and deadhead on each card, ranked by match score.'],
  ['Book or bid', 'One tap at the posted rate, or send your own price.'],
  ['Haul and get documented', 'E-signed bill of lading, proof of delivery and detention time recorded for you.'],
];

const benefits = [
  [Handshake, 'Deal directly', 'Shipper and carrier agree terms with each other. The software handles the rest.', brand.indigoLight],
  [ShieldCheck, 'Check before you book', 'A carrier\'s authority and insurance on file with FMCSA are checked before it can book.', '#34d399'],
  [MapPin, 'See where the freight is', 'Live GPS with the driver\'s consent, check calls without the phone calls, and early warnings.', brand.secondary],
  [FileSignature, 'Paperwork done as you go', 'Rate confirmation, e-signed bill of lading and proof of delivery, kept with the load.', '#fbbf24'],
];

function Steps({ title, steps }) {
  return (
    <Paper elevation={0} sx={{ ...glassCard.standard, borderRadius: `${radius.lg}px`, p: { xs: 2.5, md: 3.5 }, height: '100%' }}>
      <Typography component="h3" sx={{ fontWeight: 800, fontSize: '1.25rem', mb: 2 }}>{title}</Typography>
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 2 }}>
        {steps.map(([head, body], i) => (
          <Box component="li" key={head} sx={{ display: 'flex', gap: 2 }}>
            <Box
              aria-hidden="true"
              sx={{
                flex: '0 0 32px', height: 32, borderRadius: '50%', background: tint(brand.indigoLight, 0.2),
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem',
              }}
            >
              {i + 1}
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>{head}</Typography>
              <Typography variant="body2" sx={{ color: bodyText, lineHeight: 1.6 }}>{body}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

const h2Sx = { fontWeight: 800, fontSize: { xs: '1.5rem', md: '2rem' }, mb: 1 };

export default function Home() {
  const navigate = useNavigate();
  const ctaSx = { ...focusSx, minHeight: 48, px: 4, fontSize: '1rem', borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 700 };

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
      <Container maxWidth="lg" sx={{ px: { xs: 2, md: 4 } }}>
        {/* Hero */}
        <Box component="section" sx={{ maxWidth: 780, mb: { xs: 7, md: 10 }, mt: { xs: 2, md: 4 } }}>
          <Typography variant="h2" component="h1" sx={{ fontWeight: 800, fontSize: { xs: '2.1rem', md: '3.25rem' }, lineHeight: 1.12, mb: 2 }}>
            Freight, shipper to carrier, with no middleman.
          </Typography>
          <Typography sx={{ color: bodyText, fontSize: { xs: '1.05rem', md: '1.2rem' }, lineHeight: 1.6, mb: 4 }}>
            FreightConnect lets shippers and trucking companies find each other, agree a price and run the
            shipment in one place. The software does the vetting, matching, paperwork and status updates that a
            broker's office usually does.
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button component={Link} to="/signup" sx={{ ...buttonVariants.gradient, ...ctaSx }}>Get started</Button>
            <Button component={Link} to="/features" sx={{ ...buttonVariants.glass, ...ctaSx }}>See how it works</Button>
          </Box>
        </Box>

        {/* How it works */}
        <Box component="section" aria-labelledby="how-h" sx={{ mb: { xs: 7, md: 10 } }}>
          <Typography id="how-h" variant="h4" component="h2" sx={h2Sx}>How it works</Typography>
          <Typography sx={{ color: bodyText, mb: 3, maxWidth: 640 }}>
            Three steps on each side of the load.
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}><Steps title="If you ship freight" steps={shipperSteps} /></Grid>
            <Grid item xs={12} md={6}><Steps title="If you haul freight" steps={carrierSteps} /></Grid>
          </Grid>
        </Box>

        {/* Benefits */}
        <Box component="section" aria-labelledby="why-h" sx={{ mb: { xs: 7, md: 10 } }}>
          <Typography id="why-h" variant="h4" component="h2" sx={{ ...h2Sx, mb: 3 }}>What you get</Typography>
          <Grid container spacing={2}>
            {benefits.map(([Icon, title, desc, color]) => (
              <Grid item xs={12} sm={6} md={3} key={title}>
                <Paper elevation={0} sx={{ ...glassCard.standard, borderRadius: `${radius.lg}px`, p: 2.5, height: '100%' }}>
                  <Box sx={{ width: 40, height: 40, borderRadius: `${radius.sm}px`, mb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tint(color, 0.16), color }}>
                    <Icon size={20} aria-hidden="true" />
                  </Box>
                  <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem', mb: 0.5 }}>{title}</Typography>
                  <Typography variant="body2" sx={{ color: bodyText, lineHeight: 1.6 }}>{desc}</Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
          <Button component={Link} to="/features" sx={{ ...focusSx, mt: 2, minHeight: 44, textTransform: 'none', fontWeight: 600, color: text.primary, textDecoration: 'underline' }}>
            See every feature
          </Button>
        </Box>

        {/* Load board preview — the real carrier LoadCard fed with example data */}
        <Box component="section" aria-labelledby="board-h" sx={{ mb: { xs: 7, md: 10 } }}>
          <Chip
            label="Example loads — not live freight"
            sx={{ mb: 1.5, fontWeight: 700, bgcolor: 'rgba(251,191,36,0.18)', color: '#fde68a', border: '1px solid rgba(251,191,36,0.5)' }}
          />
          <Typography id="board-h" variant="h4" component="h2" sx={h2Sx}>What the load board looks like</Typography>
          <Typography sx={{ color: bodyText, mb: 3, maxWidth: 680 }}>
            Carriers see the rate, rate per mile, deadhead and pickup date on every card. These three are made-up
            examples to show the layout. Sign in to see live loads.
          </Typography>
          <Grid container spacing={2}>
            {sampleLoads.map((load) => (
              <Grid item xs={12} sm={6} md={4} key={load.origin + load.destination}>
                <LoadCard load={load} onClick={() => navigate('/login')} />
              </Grid>
            ))}
          </Grid>
          <Button component={Link} to="/login" sx={{ ...buttonVariants.glass, ...focusSx, mt: 3, minHeight: 48, px: 3, borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 600 }}>
            Sign in to see live loads
          </Button>
        </Box>

        {/* Early access */}
        <Paper elevation={0} component="section" aria-labelledby="early-h" sx={{ ...glassCard.elevated, borderRadius: `${radius.lg}px`, p: { xs: 3, md: 4 }, mb: { xs: 7, md: 10 } }}>
          <Typography id="early-h" variant="h5" component="h2" sx={{ fontWeight: 800, mb: 1 }}>Early access</Typography>
          <Typography sx={{ color: bodyText, maxWidth: 720, lineHeight: 1.65 }}>
            FreightConnect is in an early-access pilot. Loads, bids, tracking and paperwork work today. Payments
            through the platform are coming and are not switched on yet, so shippers and carriers settle directly
            for now. We are fixing things as we learn from real use.
          </Typography>
        </Paper>

        {/* Final CTA */}
        <Box component="section" sx={{ textAlign: 'center' }}>
          <Typography variant="h4" component="h2" sx={h2Sx}>Ready to try it?</Typography>
          <Typography sx={{ color: bodyText, mb: 3 }}>Create an account as a shipper or a carrier.</Typography>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button component={Link} to="/signup" sx={{ ...buttonVariants.gradient, ...ctaSx }}>Get started</Button>
            <Button component={Link} to="/contact" sx={{ ...buttonVariants.glass, ...ctaSx }}>Ask us a question</Button>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
