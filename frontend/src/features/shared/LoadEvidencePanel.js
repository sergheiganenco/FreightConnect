/**
 * LoadEvidencePanel — photo record at pickup and delivery (backend routes/evidenceRoutes.js).
 *
 * Shared by shipper, carrier and admin: same list for every party. Photos are private, so
 * each thumbnail is fetched through the axios instance (JWT header) as a blob and shown
 * via an object URL (revoked on unmount) - no tokens in URLs.
 * The carrier also gets "Add photo" per stage that is currently open; `readOnly` hides it
 * (used by the claims views).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, FormControl, InputLabel, LinearProgress,
  MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import api from '../../services/api';
import { semantic, surface, text as T } from '../../theme/tokens';

const KINDS = ['cargo', 'seal', 'damage', 'paperwork', 'other'];
const STAGES = [{ key: 'pickup', label: 'Pickup photos', where: 'pickup' }, { key: 'delivery', label: 'Delivery photos', where: 'delivery' }];
const errMsg = (e, fallback) => e?.response?.data?.error || fallback;

const getPosition = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMeters: p.coords.accuracy }),
    () => resolve(null),
    { timeout: 8000, maximumAge: 60000 },
  );
});

export default function LoadEvidencePanel({ loadId, userRole, readOnly = false }) {
  const [data, setData] = useState(null);          // { required, canAdd, items }
  const [urls, setUrls] = useState({});            // evidenceId -> object URL
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ stage: null, kind: 'cargo', sealNumber: '', note: '' });
  const [viewing, setViewing] = useState(null);
  const fileRef = useRef(null);
  const made = useRef([]);                         // object URLs to revoke on unmount

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get(`/loads/${loadId}/evidence`);
      setData(res.data); setErr(null);
    } catch (e) { setErr(errMsg(e, 'Photo record unavailable')); }
  }, [loadId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { made.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  useEffect(() => {
    if (!data) return;
    data.items.filter((it) => !urls[it._id]).forEach(async (it) => {
      try {
        const res = await api.get(`/loads/${loadId}/evidence/${it._id}/file`, { responseType: 'blob' });
        const u = URL.createObjectURL(res.data);
        made.current.push(u);
        setUrls((p) => ({ ...p, [it._id]: u }));
      } catch { /* thumbnail stays blank; metadata still shows */ }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loadId]);

  if (!data && !err) return <Box my={2}><CircularProgress size={18} /></Box>;
  if (!data) return <Alert severity="warning" sx={{ my: 1 }}>{err}</Alert>;

  const isCarrier = userRole === 'carrier' && !readOnly;

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const pos = await getPosition();
      const fd = new FormData();
      fd.append('stage', form.stage);
      fd.append('kind', form.kind);
      if (form.sealNumber.trim()) fd.append('sealNumber', form.sealNumber.trim());
      if (form.note.trim()) fd.append('note', form.note.trim());
      if (file.lastModified) fd.append('capturedAt', new Date(file.lastModified).toISOString());
      if (pos) Object.entries(pos).forEach(([k, v]) => fd.append(k, v));
      fd.append('file', file);
      await api.post(`/loads/${loadId}/evidence`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg({ severity: pos ? 'success' : 'info', text: pos ? 'Photo added.' : 'Photo added, marked "location not provided" (location access was unavailable).' });
      setForm({ stage: null, kind: 'cargo', sealNumber: '', note: '' });
      await load();
    } catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'Upload failed') }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const remove = async (it) => {
    setBusy(true); setMsg(null);
    try { await api.delete(`/loads/${loadId}/evidence/${it._id}`); await load(); }
    catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'Could not remove photo') }); }
    finally { setBusy(false); }
  };

  return (
    <Box mb={2} p={2} sx={{ borderRadius: 2, border: `1px solid ${surface.glassBorder}`, bgcolor: surface.glassLight }}>
      <Typography variant="subtitle2" fontWeight={700} gutterBottom>Photo record</Typography>
      {STAGES.map(({ key, label, where }) => {
        const items = data.items.filter((i) => i.stage === key);
        return (
          <Box key={key} mb={1.5}>
            <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
              <Typography variant="body2" fontWeight={700}>{label}</Typography>
              {data.required[key] && <Chip size="small" label="Required by shipper" sx={{ color: semantic.warning, fontSize: '0.65rem' }} />}
              {isCarrier && data.canAdd[key] && form.stage !== key && (
                <Button size="small" startIcon={<PhotoCameraIcon />} onClick={() => setForm((f) => ({ ...f, stage: key }))}>Add photo</Button>
              )}
            </Stack>

            {isCarrier && form.stage === key && (
              <Stack spacing={1} mb={1} sx={{ maxWidth: 420 }}>
                <FormControl size="small">
                  <InputLabel>Kind</InputLabel>
                  <Select label="Kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                    {KINDS.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField size="small" label="Seal number (optional)" value={form.sealNumber} inputProps={{ maxLength: 40 }}
                  onChange={(e) => setForm((f) => ({ ...f, sealNumber: e.target.value }))} />
                <TextField size="small" label="Note (optional)" value={form.note} inputProps={{ maxLength: 300 }}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                <Typography variant="caption" sx={{ color: T.secondary }}>
                  Your browser will ask for your location. If you decline, the photo is saved marked "location not provided".
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button component="label" size="small" variant="contained" disabled={busy}>
                    Take / choose photo
                    <input ref={fileRef} hidden type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
                      onChange={(e) => upload(e.target.files && e.target.files[0])} />
                  </Button>
                  <Button size="small" disabled={busy} onClick={() => setForm((f) => ({ ...f, stage: null }))}>Cancel</Button>
                </Stack>
                {busy && <LinearProgress />}
              </Stack>
            )}

            {items.length === 0 && <Typography variant="caption" sx={{ color: T.secondary }}>No {where} photos yet.</Typography>}
            <Stack direction="row" flexWrap="wrap" gap={1.5}>
              {items.map((it) => {
                const far = it.facilityDistanceMiles == null || it.facilityDistanceMiles > 1;
                return (
                  <Box key={it._id} sx={{ width: 190 }}>
                    <Box onClick={() => urls[it._id] && setViewing(urls[it._id])}
                      sx={{ height: 120, borderRadius: 1, overflow: 'hidden', bgcolor: 'rgba(0,0,0,0.25)', cursor: 'pointer' }}>
                      {urls[it._id] && <img src={urls[it._id]} alt={`${it.stage} ${it.kind}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </Box>
                    <Typography variant="caption" display="block" fontWeight={700}>{it.kind}{it.sealNumber ? ` - seal ${it.sealNumber}` : ''}</Typography>
                    <Typography variant="caption" display="block" sx={{ color: T.secondary }}>
                      {new Date(it.uploadedAt).toLocaleString()}{it.uploadedByName ? ` by ${it.uploadedByName}` : ''}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ color: far ? semantic.warning : T.secondary, fontWeight: far ? 700 : 400 }}>
                      {it.facilityDistanceMiles == null ? 'Location not provided' : `${it.facilityDistanceMiles.toFixed(1)} mi from ${where} location`}
                    </Typography>
                    {it.note && <Typography variant="caption" display="block" sx={{ color: T.secondary }}>{it.note}</Typography>}
                    <Tooltip title="Fingerprint (SHA-256) of the stored photo. If the file were changed in any way, this would no longer match.">
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: T.secondary }}>{(it.sha256 || '').slice(0, 12)}</Typography>
                    </Tooltip>
                    {isCarrier && it.deletable && (
                      <Button size="small" color="error" disabled={busy} onClick={() => remove(it)} sx={{ display: 'block' }}>Remove</Button>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        );
      })}
      {msg && <Alert severity={msg.severity} sx={{ mt: 1 }}>{msg.text}</Alert>}
      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="lg">
        {viewing && <img src={viewing} alt="Evidence" style={{ maxWidth: '100%', maxHeight: '90vh' }} />}
      </Dialog>
    </Box>
  );
}
