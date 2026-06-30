// GpsConsentCard.js — carrier-facing GPS tracking consent (privacy).
// Lets a carrier grant or withdraw consent for background location tracking,
// which gates the backend's /api/tracking/location ingestion.
import React, { useEffect, useState } from 'react';
import { Paper, Typography, Stack, Switch, Chip, Alert, CircularProgress } from '@mui/material';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import api from '../services/api';

export default function GpsConsentCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [granted, setGranted] = useState(false);
  const [grantedAt, setGrantedAt] = useState(null);
  const [error, setError] = useState('');

  const loadStatus = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/tracking/consent');
      setGranted(Boolean(data?.gpsConsent?.granted));
      setGrantedAt(data?.gpsConsent?.grantedAt || null);
    } catch (_) {
      setError('Could not load consent status.');
    }
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  const toggle = async (next) => {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/tracking/consent', { granted: next, version: 'v1' });
      setGranted(Boolean(data?.gpsConsent?.granted));
      setGrantedAt(data?.gpsConsent?.grantedAt || null);
    } catch (_) {
      setError('Could not update consent.');
    }
    setSaving(false);
  };

  return (
    <Paper sx={{ p: 3, borderRadius: 3, mb: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <LocationOnIcon color="primary" />
        <Typography variant="h6" fontWeight={800}>GPS Tracking Consent</Typography>
        {!loading && (
          <Chip size="small" label={granted ? 'Enabled' : 'Disabled'} color={granted ? 'success' : 'default'} />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        FreightConnect uses your device location only while you're hauling a load — to
        share live ETA with the shipper, auto-document detention at facilities, and plan
        routes. We don't track you off-duty, and you can withdraw consent at any time.
        Location history is retained to support detention and dispute claims.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? (
        <CircularProgress size={22} />
      ) : (
        <Stack direction="row" alignItems="center" spacing={1}>
          <Switch checked={granted} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          <Typography variant="body2">
            {granted
              ? `Consent granted${grantedAt ? ' on ' + new Date(grantedAt).toLocaleDateString() : ''}`
              : 'Allow background GPS while on a load'}
          </Typography>
          {saving && <CircularProgress size={16} />}
        </Stack>
      )}
    </Paper>
  );
}
