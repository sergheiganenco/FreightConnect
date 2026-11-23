import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Paper, Button, Grid } from '@mui/material';
import PublicPage, { bodyText, focusSx } from '../components/PublicPage';
import { glassCard, buttonVariants, radius } from '../theme/tokens';

const Section = ({ id, title, children }) => (
  <Box component="section" aria-labelledby={id} sx={{ mb: { xs: 4, md: 6 }, maxWidth: 760 }}>
    <Typography id={id} variant="h4" component="h2" sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', md: '1.875rem' }, mb: 1.5 }}>
      {title}
    </Typography>
    {children}
  </Box>
);

const P = ({ children }) => (
  <Typography sx={{ color: bodyText, lineHeight: 1.7, mb: 1.5 }}>{children}</Typography>
);

const Bullets = ({ items }) => (
  <Box component="ul" sx={{ color: bodyText, lineHeight: 1.7, pl: 3, m: 0 }}>
    {items.map((i) => <li key={i}>{i}</li>)}
  </Box>
);

export default function About() {
  return (
    <PublicPage
      title="About FreightConnect"
      intro="A freight marketplace where shippers and carriers deal with each other directly, and the software does the work a middleman's office would do."
    >
      <Section id="problem-h" title="The problem">
        <P>
          Moving a load usually means a broker sits between the shipper and the truck. The broker takes a cut of
          the rate, and details get lost on the way: the pickup time changes, the driver never hears, the shipper
          cannot tell where the freight is.
        </P>
      </Section>

      <Section id="what-h" title="What FreightConnect does instead">
        <P>
          The shipper and the carrier agree terms with each other. FreightConnect handles the parts around the
          deal:
        </P>
        <Bullets
          items={[
            'Checking: a carrier\'s authority and insurance on file with FMCSA are checked before it can book.',
            'Matching: carriers see loads ranked by a match score based on their lanes and equipment.',
            'Paperwork: rate confirmation, e-signed bill of lading and proof of delivery, stored with the load.',
            'Status updates: live tracking with consent, automatic check calls, and warnings for late pickups or deliveries.',
          ]}
        />
      </Section>

      <Section id="who-h" title="Who it is for">
        <Grid container spacing={2}>
          {[
            ['Shippers', 'Companies that have freight to move and want to choose their carrier and follow the shipment without a broker in between.'],
            ['Carriers and fleets', 'Owner-operators and trucking companies who want to find freight that fits, book it directly, and manage trucks, drivers and paperwork in one place.'],
          ].map(([t, d]) => (
            <Grid item xs={12} sm={6} key={t}>
              <Paper elevation={0} sx={{ ...glassCard.standard, borderRadius: `${radius.lg}px`, p: 2.5, height: '100%' }}>
                <Typography component="h3" sx={{ fontWeight: 700, mb: 0.5 }}>{t}</Typography>
                <Typography variant="body2" sx={{ color: bodyText, lineHeight: 1.6 }}>{d}</Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </Section>

      <Section id="safe-h" title="How it keeps both sides safe">
        <Bullets
          items={[
            'Authority and insurance checks, repeated on a schedule.',
            'Identity and anti-fraud checks when a load is booked.',
            'A pickup code so the right truck gets the freight.',
            'Photo evidence at pickup and delivery.',
            'Every booking, change and message recorded on the load, and a load cannot be booked twice.',
          ]}
        />
      </Section>

      <Section id="today-h" title="Where it is today">
        <P>
          FreightConnect is in an early-access pilot. Posting and booking loads,
          bidding, tracking, documents and the fleet tools are working. Payments through the platform are coming
          and are not switched on yet, so shippers and carriers settle with each other directly for now. We are
          still improving things as we learn from real use.
        </P>
      </Section>

      <Section id="contact-h" title="Get in touch">
        <P>Questions, feedback or a problem? Send us a message and we will reply by email.</P>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button component={Link} to="/contact" sx={{ ...buttonVariants.gradient, ...focusSx, minHeight: 48, px: 4, borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 700 }}>
            Contact us
          </Button>
          <Button component={Link} to="/features" sx={{ ...buttonVariants.glass, ...focusSx, minHeight: 48, px: 3, borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 600 }}>
            See the features
          </Button>
        </Box>
      </Section>
    </PublicPage>
  );
}
