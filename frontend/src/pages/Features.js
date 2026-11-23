// src/pages/Features.js
import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Grid, Paper, Button } from '@mui/material';
import {
  PackagePlus, Upload, Users, Gavel, Pencil, ShieldCheck, MapPin, PhoneCall, AlertTriangle,
  LifeBuoy, KeyRound, Camera, FileSignature, CalendarClock, Repeat, FileWarning, BarChart3,
  UserCog, Route, Gauge, Navigation, Truck, LayoutDashboard, UserCheck, Clock, Undo2, Timer,
  Folder, Wallet, Fuel, Landmark, Network, MessageSquare, Bell, SearchCheck, RefreshCw,
  Fingerprint, ScrollText, Lock, Receipt, Handshake, Zap, Sparkles,
} from 'lucide-react';
import PublicPage, { bodyText, focusSx } from '../components/PublicPage';
import { glassCard, brand, tint, radius, buttonVariants } from '../theme/tokens';

const sections = [
  {
    id: 'shippers',
    title: 'For shippers',
    color: brand.indigoLight,
    intro: 'Post freight, choose who hauls it, and follow it to the dock.',
    items: [
      [PackagePlus, 'Post in minutes', 'Multi-stop loads, hazmat, reefer temperature ranges, pickup and delivery windows.'],
      [Upload, 'Bring loads in', 'Import from a spreadsheet, an email, or EDI instead of retyping.'],
      [Users, 'Choose your audience', 'Public board, your private carrier list, or offer a load to your own carriers one at a time.'],
      [Gavel, 'Set the rate', 'Name a price, then take bids or counter-offers from carriers.'],
      [Pencil, 'Edit open loads safely', 'Change an open load; carriers who already engaged are protected from changed terms.'],
      [SearchCheck, 'Know who you book', 'See a carrier\'s authority and insurance status and trust score, with on-time rate and cancellations.'],
      [MapPin, 'Live GPS tracking', 'Follow the truck on the map, with the driver\'s consent.'],
      [PhoneCall, 'Automatic check calls', 'Status updates arrive on their own, so nobody has to phone for them.'],
      [AlertTriangle, 'Early warnings', 'Late-pickup and delivery-delay alerts before they become a problem.'],
    ],
  },
  {
    id: 'shippers-2',
    title: 'More for shippers',
    color: brand.indigoLight,
    items: [
      [LifeBuoy, 'Standby carriers', 'Other carriers who bid can be lined up as backups if a truck falls through.'],
      [KeyRound, 'Pickup code', 'The right truck gets the freight; the wrong one does not.'],
      [Camera, 'Photo evidence', 'Photos at pickup and delivery are stored on the load.'],
      [CalendarClock, 'Appointments', 'Book dock times with the facility and the carrier.'],
      [Repeat, 'Contracts and recurring lanes', 'Agree rates for regular lanes and post repeat loads automatically.'],
      [FileWarning, 'Claims and disputes', 'Raise a cargo claim or dispute with photos and documents attached.'],
      [BarChart3, 'Analytics and scorecards', 'Track your loads and on-time performance over time.'],
      [UserCog, 'Team accounts', 'Invite colleagues and give each a role.'],
    ],
  },
  {
    id: 'carriers',
    title: 'For carriers and fleets',
    color: brand.secondary,
    intro: 'Find freight that fits your trucks and run the fleet from one screen.',
    items: [
      [Gauge, 'A load board that shows the numbers', 'Rate per mile and deadhead on every card, plus a match score based on your lanes and equipment.'],
      [Zap, 'One-tap booking or bidding', 'Book at the posted rate or send your own price.'],
      [Navigation, 'Autopilot trip planning', 'Chains loads for a truck within hours-of-service limits and shows the net after costs.'],
      [LayoutDashboard, 'Dispatch board', 'See every truck, booking and deadline for the whole fleet.'],
      [Truck, 'Fleet and drivers', 'Manage trucks and drivers; drivers get their own logins.'],
      [Clock, 'Hours of service', 'See the driving and on-duty hours each driver has left.'],
      [Route, 'Trip planning', 'Plan a route and the stops along it.'],
      [Undo2, 'Return-load suggestions', 'Ideas for freight to bring a truck home loaded.'],
      [Network, 'Carrier network', 'Work with other carriers and share capacity.'],
    ],
  },
  {
    id: 'carriers-2',
    title: 'Day to day on the road',
    color: brand.secondary,
    items: [
      [Timer, 'Detention tracked for you', 'Time at the dock is recorded automatically.'],
      [MessageSquare, 'Chat per load', 'One thread for each booking, kept with the load.'],
      [Bell, 'Notifications', 'Bids, changes and warnings reach you as they happen.'],
      [UserCheck, 'Your standing', 'On-time rate and trust score that shippers can see.'],
    ],
  },
  {
    id: 'trust',
    title: 'Trust and safety',
    color: '#34d399',
    intro: 'Both sides can see who they are dealing with.',
    items: [
      [ShieldCheck, 'Authority and insurance checks', 'A carrier\'s authority and insurance on file with FMCSA are checked before it can book.'],
      [RefreshCw, 'Re-checked on a schedule', 'Checks repeat automatically, not just at sign-up.'],
      [Fingerprint, 'Identity checks at booking', 'Anti-fraud checks run when a load is booked.'],
      [ScrollText, 'A record of everything', 'Every booking, change and message is recorded on the load.'],
      [Lock, 'No double booking', 'A load can only be booked once.'],
    ],
  },
  {
    id: 'paperwork',
    title: 'Paperwork and money',
    color: '#fbbf24',
    intro: 'The documents and records that usually eat a dispatcher\'s evening.',
    items: [
      [FileSignature, 'Bills of lading and proof of delivery', 'E-signed at pickup and delivery; the rate confirmation is generated for you.'],
      [Folder, 'Documents in one place', 'Everything for a load, findable later.'],
      [Timer, 'Detention charges', 'Calculated from the time recorded at the dock.'],
      [Wallet, 'Driver settlements', 'Pay statements for your drivers.'],
      [Fuel, 'IFTA fuel-tax worksheet', 'A quarterly worksheet to fill in and keep.'],
      [Landmark, 'Factoring requests', 'Request early payment on a delivered load from inside the platform.'],
      [Receipt, 'Tax records', 'Summaries and exports for year-end.'],
    ],
  },
];

function FeatureSection({ section }) {
  return (
    <Box component="section" aria-labelledby={`${section.id}-h`} sx={{ mb: { xs: 5, md: 7 } }}>
      <Typography
        id={`${section.id}-h`}
        variant="h4"
        component="h2"
        sx={{ fontWeight: 800, fontSize: { xs: '1.5rem', md: '1.875rem' }, mb: 0.5 }}
      >
        {section.title}
      </Typography>
      {section.intro && (
        <Typography sx={{ color: bodyText, mb: 2.5, maxWidth: 680 }}>{section.intro}</Typography>
      )}
      <Grid container spacing={2} sx={{ mt: section.intro ? 0 : 1.5 }}>
        {section.items.map(([Icon, title, desc]) => (
          <Grid item xs={12} sm={6} md={4} key={title}>
            <Paper
              elevation={0}
              sx={{ ...glassCard.standard, borderRadius: radius.lg, p: 2.5, height: '100%' }}
            >
              <Box
                sx={{
                  width: 40, height: 40, borderRadius: `${radius.sm}px`, mb: 1.5,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: tint(section.color, 0.16), color: section.color,
                }}
              >
                <Icon size={20} aria-hidden="true" />
              </Box>
              <Typography component="h3" sx={{ fontWeight: 700, fontSize: '1rem', mb: 0.5 }}>{title}</Typography>
              <Typography variant="body2" sx={{ color: bodyText, lineHeight: 1.6 }}>{desc}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export default function Features() {
  return (
    <PublicPage
      title="What FreightConnect does"
      intro="One place for shippers and carriers to find each other, agree a price, and run the shipment from pickup to proof of delivery. Some of these tools are still being polished in early access."
    >
      {sections.map((s) => <FeatureSection key={s.id} section={s} />)}

      <Paper elevation={0} sx={{ ...glassCard.subtle, p: 3, mb: 5, maxWidth: 760 }}>
        <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1.25rem', mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Sparkles size={20} aria-hidden="true" /> Coming next
        </Typography>
        <Typography sx={{ color: bodyText }}>
          Payments through the platform. They are not switched on in early access; shippers and carriers settle
          directly for now.
        </Typography>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button
          component={Link}
          to="/signup"
          sx={{ ...buttonVariants.gradient, ...focusSx, px: 4, minHeight: 48, borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 700 }}
        >
          Get started
        </Button>
        <Button
          component={Link}
          to="/contact"
          startIcon={<Handshake size={18} aria-hidden="true" />}
          sx={{ ...buttonVariants.glass, ...focusSx, px: 3, minHeight: 48, borderRadius: `${radius.md}px`, textTransform: 'none', fontWeight: 600 }}
        >
          Ask us a question
        </Button>
      </Box>
    </PublicPage>
  );
}
