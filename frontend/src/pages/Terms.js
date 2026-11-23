import React from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Alert } from '@mui/material';
import PublicPage, { bodyText } from '../components/PublicPage';

const sections = [
  ['The service', 'FreightConnect is software that lets shippers and carriers find each other and manage a shipment: posting loads, bidding, tracking, documents and messages.'],
  ['Accounts and accurate information', 'You must give accurate information when you sign up and keep it up to date. You are responsible for activity under your account and for keeping your password secure. Carriers must keep their authority and insurance details current.'],
  ['Acceptable use', 'Do not post false or misleading loads, impersonate another person or company, interfere with the service, try to access other users\' data, or upload anything unlawful or harmful. We may suspend accounts that break these rules.'],
  ['Shippers and carriers contract with each other', 'FreightConnect is not a party to the agreement between a shipper and a carrier. Each is responsible for its own freight, insurance, licences, safety and legal obligations. Information shown on the platform, including authority and insurance checks and trust scores, is a tool to help you decide and is not a guarantee.'],
  ['Payments', 'During early access, payments are not processed through the platform. Shippers and carriers settle with each other directly.'],
  ['Early access, as is', 'The service is in an early-access pilot and is provided "as is" and "as available". It may change, be interrupted, or contain errors.'],
];

export default function Terms() {
  return (
    <PublicPage maxWidth="md" title="Terms of Service">
      <Alert severity="info" sx={{ mb: 4 }}>
        Draft for early access — last updated November 2026. These terms will be replaced by final terms.
      </Alert>
      {sections.map(([h, body]) => (
        <Box component="section" key={h} sx={{ mb: 3, maxWidth: 720 }}>
          <Typography component="h2" sx={{ fontWeight: 800, fontSize: '1.25rem', mb: 0.5 }}>{h}</Typography>
          <Typography sx={{ color: bodyText, lineHeight: 1.7 }}>{body}</Typography>
        </Box>
      ))}
      <Typography sx={{ color: bodyText, lineHeight: 1.7, maxWidth: 720 }}>
        Questions about these terms? Use the <Link to="/contact" style={{ color: '#fff' }}>Contact page</Link>. See
        also our <Link to="/privacy-policy" style={{ color: '#fff' }}>Privacy Policy</Link>.
      </Typography>
    </PublicPage>
  );
}
