import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Alert } from '@mui/material';
import PublicPage, { bodyText } from '../components/PublicPage';

const sections = [
  ['What we collect', 'Account and company details; load details; documents and photos you upload; messages; the GPS location of a truck, only with the carrier\'s consent and only while a load is active; and device and log data such as browser type and error logs.'],
  ['Why we use it', 'To run the service: create accounts, match and book loads, show tracking, generate documents, keep records of bookings and messages, check carrier authority and insurance, prevent fraud, and keep the service secure and working.'],
  ['Who can see it', 'The other party on a load sees the details they need for that load, such as company name, load information, documents, messages and, where consented, the truck\'s location. Service providers that host and run the app process data on our behalf. We do not sell your data.'],
  ['How long we keep it', 'We keep data for as long as your account is active and as needed to keep records of shipments, then delete or anonymise it when it is no longer needed.'],
  ['Your choices', 'You can ask to see, correct or delete your data. Carriers can decline or withdraw location consent, which stops tracking.'],
];

export default function Privacy() {
  return (
    <PublicPage maxWidth="md" title="Privacy Policy">
      <Alert severity="info" sx={{ mb: 4 }}>
        Draft for early access — last updated November 2026. This policy will be replaced by a final version.
      </Alert>
      {sections.map(([h, body]) => (
        <Box component="section" key={h} sx={{ mb: 3, maxWidth: 720 }}>
          <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1.25rem', mb: 0.5 }}>{h}</Typography>
          <Typography sx={{ color: bodyText, lineHeight: 1.7 }}>{body}</Typography>
        </Box>
      ))}
      <Typography sx={{ color: bodyText, lineHeight: 1.7, maxWidth: 720 }}>
        To ask for access or deletion, or with any privacy question, use the{' '}
        <Link to="/contact" style={{ color: '#fff' }}>Contact page</Link>. See also our{' '}
        <Link to="/terms-of-service" style={{ color: '#fff' }}>Terms of Service</Link>.
      </Typography>
    </PublicPage>
  );
}
