// src/pages/ReceiveDelivery.js — public, no-account page for the receiving dock.
// Reached by scanning the QR code the driver shows (/receive/:token). Mobile-first. Never shows the rate.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import api, { API_BASE } from '../services/api';
import SignaturePad from '../components/SignaturePad';

const fmt = (d) => (d ? new Date(d).toLocaleString() : null);
const Row = ({ label, value }) => (value ? (
  <Typography variant="body2"><Box component="span" sx={{ color: 'text.secondary' }}>{label}: </Box>{value}</Typography>
) : null);

export default function ReceiveDelivery() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [note, setNote] = useState('');
  const [padOpen, setPadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState(null);

  useEffect(() => {
    api.get(`/receive/${token}`)
      .then(({ data }) => setInfo(data))
      .catch((e) => {
        const st = e?.response?.status;
        setLoadError(st === 404 || st === 410 || !e?.response
          ? 'This delivery link is invalid or has expired. Ask the driver to show a new code.'
          : (e.response.data?.error || 'Could not load this page. Try again shortly.'));
      });
  }, [token]);

  const sign = async ({ dataUrl, signerName }) => {
    setPadOpen(false);
    setBusy(true);
    setSignError(null);
    try {
      const { data } = await api.post(`/receive/${token}/sign`, { dataUrl, signerName, note });
      setInfo((i) => ({ ...i, state: 'signed', signed: data.signed }));
    } catch (e) {
      setSignError(e?.response?.data?.error || 'The signature could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const c = info?.carrier;
  const refs = info?.references || {};

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', p: 2, pt: 3 }}>
      <Box sx={{ width: '100%', maxWidth: 520 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5, px: 0.5 }}>FreightConnect</Typography>
        <Paper sx={{ width: '100%', p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" fontWeight={800} sx={{ mb: 2, lineHeight: 1.3 }}>Delivery documents</Typography>
          {!info && !loadError && <CircularProgress />}
          {loadError && <Alert severity="error">{loadError}</Alert>}

          {info && info.state === 'not_booked' && (
            <Alert severity="warning">This load is not currently booked to a carrier. Do not accept freight based on this page.</Alert>
          )}

          {info && info.state !== 'not_booked' && (
            <>
              <Typography variant="body1" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{info.loadTitle}</Typography>
              <Stack spacing={0.25} mt={1}>
                <Row label="From" value={[info.shipperName, info.origin].filter(Boolean).join(', ')} />
                <Row label="Deliver to" value={[info.facility, info.address || info.destination].filter(Boolean).join(', ')} />
                <Row label="Delivery window" value={info.deliveryWindow?.start && `${fmt(info.deliveryWindow.start)}${info.deliveryWindow.end ? ` to ${fmt(info.deliveryWindow.end)}` : ''}`} />
                <Row label="PO" value={refs.po} />
                <Row label="Shipper reference" value={refs.shipper} />
                <Row label="Your reference" value={refs.consignee} />
                <Row label="Freight" value={[info.commodity, info.weightLbs && `${Number(info.weightLbs).toLocaleString()} lbs`, info.equipmentType].filter(Boolean).join(' · ')} />
              </Stack>
              {info.hazardous && <Alert severity="warning" sx={{ mt: 1 }}>Hazardous material. See the bill of lading for instructions.</Alert>}

              <Box my={2} p={1.5} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Typography variant="caption">Carrier booked for this load</Typography>
                <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{c?.companyName}</Typography>
                <Typography variant="body2">MC {c?.mcNumber || 'not confirmed'} · DOT {c?.dotNumber || 'not confirmed'}{c?.authorityOnFile ? ' (from FMCSA record)' : ''}</Typography>
                {(info.driverName || info.truckId) && (
                  <Typography variant="body2">{[info.driverName && `Driver: ${info.driverName}`, info.truckId && `Truck: ${info.truckId}`].filter(Boolean).join(' · ')}</Typography>
                )}
              </Box>

              <Button fullWidth variant="outlined" component="a" href={`${API_BASE}/receive/${token}/bol`} target="_blank" rel="noopener noreferrer" sx={{ mb: 2 }}>
                Open bill of lading
              </Button>

              {info.state === 'awaiting_pickup' && (
                <Alert severity="info">This load has not been picked up yet. You can sign here when the truck arrives.</Alert>
              )}

              {info.signed && (
                <Alert severity="success">
                  Signed for by {info.signed.by || 'the receiver'} on {fmt(info.signed.at)}.
                  {info.signed.note && <Typography variant="body2" sx={{ mt: 0.5 }}>Note recorded: {info.signed.note}</Typography>}
                  <Typography variant="body2" sx={{ mt: 0.5 }}>The shipper and carrier have been notified. Open the bill of lading above to keep a signed copy.</Typography>
                </Alert>
              )}

              {info.state === 'delivered' && !info.signed && (
                <Alert severity="info">This load has already been marked delivered.</Alert>
              )}

              {info.state === 'ready' && (
                <>
                  <TextField
                    fullWidth multiline minRows={2} label="Shortage or damage (optional)"
                    helperText="Leave empty if everything arrived complete and in good condition."
                    value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                  />
                  <Button fullWidth size="large" variant="contained" sx={{ mt: 2, py: 1.5 }} onClick={() => setPadOpen(true)} disabled={busy}>
                    {busy ? <CircularProgress size={22} /> : 'Sign for this delivery'}
                  </Button>
                  {signError && <Alert severity="error" sx={{ mt: 2 }}>{signError}</Alert>}
                </>
              )}
            </>
          )}
        </Paper>
      </Box>
      <SignaturePad
        open={padOpen}
        title="Receiver signature"
        subtitle="Type your name and sign to confirm you received this freight. Any note you entered is recorded with your signature."
        onClose={() => setPadOpen(false)}
        onSave={sign}
      />
    </Box>
  );
}
