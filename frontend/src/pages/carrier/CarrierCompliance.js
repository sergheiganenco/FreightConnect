import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, Stack, Tabs, Tab, CircularProgress, Alert, TextField,
  Select, MenuItem, FormControl, InputLabel, FormControlLabel, Checkbox, RadioGroup, Radio,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, IconButton, Tooltip,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import api from '../../services/api';

/**
 * Inspections & documents.
 *  - Inspections: a driver files the vehicle inspection report; a truck reported unsafe stays out of
 *    service until a manager certifies the repair.
 *  - Documents: the papers a driver has to show at the roadside, with expiry dates the system warns about.
 * Drivers can file reports and read everything; only managers certify repairs and add or remove documents.
 */

const errMsg = (e, fallback) => e?.response?.data?.error || e?.response?.data?.errors?.[0]?.msg || fallback;
const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const day = (d) => (d ? new Date(d).toLocaleDateString([], { dateStyle: 'medium' }) : '');
const KIND_LABELS = {
  registration: 'Registration', annual_inspection: 'Annual inspection', insurance_card: 'Insurance card',
  ifta_license: 'IFTA licence', irp_cab_card: 'IRP cab card', permit: 'Permit', lease_agreement: 'Lease agreement',
  cdl: 'CDL', medical_card: 'Medical card', hazmat_endorsement: 'Hazmat endorsement', twic: 'TWIC', other: 'Other',
};
const SUBJECTS = [['truck', 'Truck'], ['trailer', 'Trailer'], ['driver', 'Driver'], ['company', 'Company']];

function expiryChip(expiresAt) {
  if (!expiresAt) return <Chip size="small" label="No expiry date" variant="outlined" />;
  const days = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (days < 0) return <Chip size="small" color="error" label={`Expired ${day(expiresAt)}`} />;
  if (days <= 30) return <Chip size="small" color="warning" label={`Expires ${day(expiresAt)}`} />;
  return <Chip size="small" color="success" variant="outlined" label={`Valid to ${day(expiresAt)}`} />;
}

const emptyReport = { truckId: '', trailerId: '', type: 'pre_trip', odometer: '', location: '', defects: {}, safeToOperate: 'yes', remarks: '', signedName: '' };
const emptyDoc = { subjectType: 'truck', subjectId: '', kind: 'registration', label: '', number: '', expiresAt: '', file: null };

export default function CarrierCompliance() {
  const isManager = (localStorage.getItem('companyRole') || 'owner') !== 'driver';
  const [tab, setTab] = useState(0);
  const [lists, setLists] = useState({ items: [], trucks: [], drivers: [] });
  const [reports, setReports] = useState(null);
  const [docs, setDocs] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);   // the inspection form, when open
  const [doc, setDoc] = useState(null);         // the document form, when open
  const [certify, setCertify] = useState(null); // { id, truckId, repaired, certifiedName, note }

  const load = useCallback(async () => {
    try {
      const [c, r, d] = await Promise.all([api.get('/dvir/checklist'), api.get('/dvir'), api.get('/compliance-docs')]);
      setLists({ items: c.data.data || [], trucks: c.data.trucks || [], drivers: c.data.drivers || [] });
      setReports(r.data.data || []);
      setDocs(d.data.data || []);
    } catch (e) {
      setMsg({ severity: 'error', text: errMsg(e, 'Could not load inspections and documents.') });
      setReports((p) => p || []); setDocs((p) => p || []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ severity: 'success', text: okText }); await load(); return true; }
    catch (e) { setMsg({ severity: 'error', text: errMsg(e, 'That did not work. Try again.') }); return false; }
    finally { setBusy(false); }
  };

  const submitReport = async () => {
    const defects = Object.entries(report.defects).filter(([, v]) => v.on).map(([item, v]) => ({ item, note: v.note || '' }));
    const ok = await run(() => api.post('/dvir', {
      truckId: report.truckId, trailerId: report.trailerId, type: report.type, odometer: report.odometer, location: report.location,
      defects, safeToOperate: report.safeToOperate === 'yes', remarks: report.remarks, signedName: report.signedName,
    }), 'Inspection report filed.');
    if (ok) setReport(null);
  };
  const submitDoc = async () => {
    const fd = new FormData();
    ['subjectType', 'subjectId', 'kind', 'label', 'number'].forEach((k) => { if (doc[k]) fd.append(k, doc[k]); });
    if (doc.expiresAt) fd.append('expiresAt', new Date(`${doc.expiresAt}T12:00:00`).toISOString());
    if (doc.file) fd.append('file', doc.file);
    const ok = await run(() => api.post('/compliance-docs', fd, { headers: { 'Content-Type': 'multipart/form-data' } }), 'Document saved.');
    if (ok) setDoc(null);
  };
  const submitCertify = async () => {
    const ok = await run(() => api.post(`/dvir/${certify.id}/certify`, { repaired: certify.repaired === 'yes', certifiedName: certify.certifiedName, note: certify.note }), 'Repair certified.');
    if (ok) setCertify(null);
  };
  const openFile = async (d) => {
    try {
      const res = await api.get(`/compliance-docs/${d._id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setMsg({ severity: 'error', text: 'Could not open the file.' }); }
  };
  const subjectName = (d) => {
    if (d.subjectType === 'company') return 'Company';
    if (d.subjectType === 'driver') return lists.drivers.find((x) => x.driverId === d.subjectId)?.name || 'Driver';
    return `${d.subjectType === 'truck' ? 'Truck' : 'Trailer'} ${d.subjectId}`;
  };

  const unsafeUnsigned = report && report.safeToOperate === 'no' && !Object.values(report.defects).some((v) => v.on);
  const reportReady = report && report.truckId && report.signedName.trim().length >= 2 && !unsafeUnsigned;
  const docReady = doc && (doc.subjectType === 'company' || doc.subjectId.trim());
  const outOfService = (reports || []).filter((r) => r.outOfService);

  return (
    <Box sx={{ maxWidth: 1000, mx: 'auto', pt: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <FactCheckIcon />
        <Typography variant="h5" component="h1" fontWeight={700}>Inspections & Documents</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Vehicle inspection reports, and the papers a driver has to show at the roadside. You are warned before a document expires.
      </Typography>

      {msg && <Alert severity={msg.severity} onClose={() => setMsg(null)} sx={{ mb: 2 }}>{msg.text}</Alert>}
      {outOfService.length > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Out of service: {[...new Set(outOfService.map((r) => `truck ${r.truckId}`))].join(', ')}. A truck reported unsafe cannot start a load until a manager certifies the repair.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }} variant="fullWidth">
        <Tab label="Inspections" />
        <Tab label="Documents" />
      </Tabs>

      {tab === 0 && (
        <Box>
          <Button variant="contained" onClick={() => setReport({ ...emptyReport, truckId: lists.trucks.length === 1 ? lists.trucks[0] : '' })} sx={{ mb: 2 }}>
            New inspection report
          </Button>
          {!reports ? <CircularProgress size={22} /> : reports.length === 0 ? (
            <Typography color="text.secondary">No inspection reports yet.</Typography>
          ) : (
            <Stack spacing={1.5}>
              {reports.map((r) => (
                <Paper key={r._id} sx={{ p: 2 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700}>
                        Truck {r.truckId}{r.trailerId ? ` · trailer ${r.trailerId}` : ''} · {r.type === 'pre_trip' ? 'Pre-trip' : 'Post-trip'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {fmt(r.createdAt)} · {r.driverName}{r.odometer ? ` · ${Number(r.odometer).toLocaleString()} mi` : ''}{r.location ? ` · ${r.location}` : ''}
                      </Typography>
                    </Box>
                    <Box>
                      {r.outOfService ? <Chip color="error" label="Out of service" />
                        : r.defects.length ? <Chip color={r.repair ? 'success' : 'warning'} label={r.repair ? 'Certified' : 'Defects noted'} />
                          : <Chip color="success" variant="outlined" label="No defects" />}
                    </Box>
                  </Stack>
                  {r.defects.length > 0 && (
                    <Box mt={1}>
                      {r.defects.map((d) => (
                        <Typography key={d.item} variant="body2" sx={{ overflowWrap: 'anywhere' }}>• {d.item}{d.note ? `: ${d.note}` : ''}</Typography>
                      ))}
                    </Box>
                  )}
                  {r.remarks && <Typography variant="body2" mt={1} sx={{ overflowWrap: 'anywhere' }}>{r.remarks}</Typography>}
                  {r.repair && (
                    <Typography variant="body2" color="text.secondary" mt={1} sx={{ overflowWrap: 'anywhere' }}>
                      {r.repair.repaired ? 'Repair certified' : 'Certified: no repair needed for safe operation'} by {r.repair.certifiedName}, {fmt(r.repair.at)}{r.repair.note ? `. ${r.repair.note}` : ''}
                    </Typography>
                  )}
                  {isManager && r.defects.length > 0 && !r.repair && (
                    <Button size="small" variant="outlined" sx={{ mt: 1.5 }}
                      onClick={() => setCertify({ id: r._id, truckId: r.truckId, repaired: 'yes', certifiedName: '', note: '' })}>
                      Certify repair
                    </Button>
                  )}
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {tab === 1 && (
        <Box>
          {isManager && <Button variant="contained" onClick={() => setDoc({ ...emptyDoc })} sx={{ mb: 2 }}>Add document</Button>}
          {!docs ? <CircularProgress size={22} /> : docs.length === 0 ? (
            <Typography color="text.secondary">No documents yet.{isManager ? '' : ' Your company office adds them.'}</Typography>
          ) : (
            <Stack spacing={1.5}>
              {docs.map((d) => (
                <Paper key={d._id} sx={{ p: 2 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{d.label || KIND_LABELS[d.kind] || d.kind}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {subjectName(d)}{d.label ? ` · ${KIND_LABELS[d.kind] || d.kind}` : ''}{d.number ? ` · No. ${d.number}` : ''}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {expiryChip(d.expiresAt)}
                      {d.hasFile && (
                        <Tooltip title="Open the document">
                          <IconButton aria-label="Open the document" onClick={() => openFile(d)}><VisibilityIcon /></IconButton>
                        </Tooltip>
                      )}
                      {isManager && (
                        <Tooltip title="Remove">
                          <IconButton aria-label="Remove document" disabled={busy}
                            onClick={() => window.confirm('Remove this document?') && run(() => api.delete(`/compliance-docs/${d._id}`), 'Document removed.')}>
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ── New inspection report ─────────────────────────────── */}
      <Dialog open={!!report} onClose={() => !busy && setReport(null)} fullWidth maxWidth="sm">
        <DialogTitle>Vehicle inspection report</DialogTitle>
        {report && (
          <DialogContent>
            <Stack spacing={2} mt={0.5}>
              <FormControl fullWidth required>
                <InputLabel>Truck</InputLabel>
                <Select label="Truck" value={report.truckId} onChange={(e) => setReport({ ...report, truckId: e.target.value })}>
                  {lists.trucks.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              {lists.trucks.length === 0 && <Alert severity="warning">Your company has no trucks on file. A manager adds them under Fleet.</Alert>}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Trailer number" fullWidth value={report.trailerId} inputProps={{ maxLength: 60 }}
                  onChange={(e) => setReport({ ...report, trailerId: e.target.value })} />
                <TextField label="Odometer" type="number" fullWidth value={report.odometer} inputProps={{ min: 0 }}
                  onChange={(e) => setReport({ ...report, odometer: e.target.value })} />
              </Stack>
              <RadioGroup row value={report.type} onChange={(e) => setReport({ ...report, type: e.target.value })}>
                <FormControlLabel value="pre_trip" control={<Radio />} label="Pre-trip" />
                <FormControlLabel value="post_trip" control={<Radio />} label="Post-trip" />
              </RadioGroup>
              <TextField label="Where" fullWidth value={report.location} inputProps={{ maxLength: 200 }} placeholder="City, state or yard"
                onChange={(e) => setReport({ ...report, location: e.target.value })} />
              <Divider />
              <Typography fontWeight={700}>Tick anything that has a defect</Typography>
              <Box>
                {lists.items.map((item) => {
                  const v = report.defects[item] || { on: false, note: '' };
                  const set = (patch) => setReport({ ...report, defects: { ...report.defects, [item]: { ...v, ...patch } } });
                  return (
                    <Box key={item}>
                      <FormControlLabel label={item} control={<Checkbox checked={v.on} onChange={(e) => set({ on: e.target.checked })} />} />
                      {v.on && (
                        <TextField size="small" fullWidth label={`What is wrong: ${item}`} value={v.note} inputProps={{ maxLength: 300 }}
                          onChange={(e) => set({ note: e.target.value })} sx={{ mb: 1 }} />
                      )}
                    </Box>
                  );
                })}
              </Box>
              <Divider />
              <Typography fontWeight={700}>Is the truck safe to operate?</Typography>
              <RadioGroup row value={report.safeToOperate} onChange={(e) => setReport({ ...report, safeToOperate: e.target.value })}>
                <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                <FormControlLabel value="no" control={<Radio />} label="No, out of service" />
              </RadioGroup>
              {report.safeToOperate === 'no' && (
                <Alert severity={unsafeUnsigned ? 'error' : 'warning'}>
                  {unsafeUnsigned ? 'Tick the defect that makes the truck unsafe.' : 'This truck will not be able to start a load until a manager certifies the repair.'}
                </Alert>
              )}
              <TextField label="Remarks" fullWidth multiline minRows={2} value={report.remarks} inputProps={{ maxLength: 1000 }}
                onChange={(e) => setReport({ ...report, remarks: e.target.value })} />
              <TextField label="Type your full name to sign" required fullWidth value={report.signedName} inputProps={{ maxLength: 120 }}
                onChange={(e) => setReport({ ...report, signedName: e.target.value })} />
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setReport(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={submitReport} disabled={busy || !reportReady}>Sign and file</Button>
        </DialogActions>
      </Dialog>

      {/* ── Certify repair ────────────────────────────────────── */}
      <Dialog open={!!certify} onClose={() => !busy && setCertify(null)} fullWidth maxWidth="xs">
        <DialogTitle>Certify repair{certify ? `: truck ${certify.truckId}` : ''}</DialogTitle>
        {certify && (
          <DialogContent>
            <Stack spacing={2} mt={0.5}>
              <RadioGroup value={certify.repaired} onChange={(e) => setCertify({ ...certify, repaired: e.target.value })}>
                <FormControlLabel value="yes" control={<Radio />} label="The defects were repaired" />
                <FormControlLabel value="no" control={<Radio />} label="No repair is needed for safe operation" />
              </RadioGroup>
              <TextField label="What was done" fullWidth multiline minRows={2} value={certify.note} inputProps={{ maxLength: 1000 }}
                onChange={(e) => setCertify({ ...certify, note: e.target.value })} />
              <TextField label="Type your full name to certify" required fullWidth value={certify.certifiedName} inputProps={{ maxLength: 120 }}
                onChange={(e) => setCertify({ ...certify, certifiedName: e.target.value })} />
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setCertify(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={submitCertify} disabled={busy || !certify || certify.certifiedName.trim().length < 2}>Certify</Button>
        </DialogActions>
      </Dialog>

      {/* ── Add document ──────────────────────────────────────── */}
      <Dialog open={!!doc} onClose={() => !busy && setDoc(null)} fullWidth maxWidth="sm">
        <DialogTitle>Add document</DialogTitle>
        {doc && (
          <DialogContent>
            <Stack spacing={2} mt={0.5}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>For</InputLabel>
                  <Select label="For" value={doc.subjectType} onChange={(e) => setDoc({ ...doc, subjectType: e.target.value, subjectId: '' })}>
                    {SUBJECTS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                  </Select>
                </FormControl>
                {doc.subjectType === 'truck' && (
                  <FormControl fullWidth required>
                    <InputLabel>Truck</InputLabel>
                    <Select label="Truck" value={doc.subjectId} onChange={(e) => setDoc({ ...doc, subjectId: e.target.value })}>
                      {lists.trucks.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}
                {doc.subjectType === 'driver' && (
                  <FormControl fullWidth required>
                    <InputLabel>Driver</InputLabel>
                    <Select label="Driver" value={doc.subjectId} onChange={(e) => setDoc({ ...doc, subjectId: e.target.value })}>
                      {lists.drivers.map((d) => <MenuItem key={d.driverId} value={d.driverId}>{d.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}
                {doc.subjectType === 'trailer' && (
                  <TextField label="Trailer number" required fullWidth value={doc.subjectId} inputProps={{ maxLength: 60 }}
                    onChange={(e) => setDoc({ ...doc, subjectId: e.target.value })} />
                )}
              </Stack>
              <FormControl fullWidth>
                <InputLabel>Document</InputLabel>
                <Select label="Document" value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>
                  {Object.entries(KIND_LABELS).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
                </Select>
              </FormControl>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Name (optional)" fullWidth value={doc.label} inputProps={{ maxLength: 120 }}
                  onChange={(e) => setDoc({ ...doc, label: e.target.value })} />
                <TextField label="Number (optional)" fullWidth value={doc.number} inputProps={{ maxLength: 80 }}
                  onChange={(e) => setDoc({ ...doc, number: e.target.value })} />
              </Stack>
              <TextField label="Expires" type="date" fullWidth value={doc.expiresAt} InputLabelProps={{ shrink: true }}
                onChange={(e) => setDoc({ ...doc, expiresAt: e.target.value })} helperText="You are warned 30, 14, 7, 3 and 1 days before, and on the day." />
              <Box>
                <Button variant="outlined" component="label">
                  {doc.file ? 'Change file' : 'Attach photo or PDF'}
                  <input hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setDoc({ ...doc, file: e.target.files?.[0] || null })} />
                </Button>
                {doc.file && <Typography variant="body2" mt={1} sx={{ overflowWrap: 'anywhere' }}>{doc.file.name}</Typography>}
              </Box>
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setDoc(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={submitDoc} disabled={busy || !docReady}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
