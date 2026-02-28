/**
 * ShipperEDI — Electronic Data Interchange Center
 *
 * Shippers can:
 *  • Upload / paste X12 EDI 204 (Load Tender) → parse preview → create Load
 *  • View all inbound/outbound EDI documents with status
 *  • Download EDI 214 (status updates) and 210 (invoices) for their loads
 *  • See parsed field breakdown for any inbound document
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Chip, CircularProgress,
  Alert, Divider, Grid, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Drawer, Stack, IconButton, Tabs, Tab, Tooltip,
} from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AddIcon from '@mui/icons-material/Add';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const STATUS_META = {
  received:     { label: 'Received',      color: '#9ca3af', icon: <HourglassEmptyIcon sx={{ fontSize: 14 }} /> },
  parsed:       { label: 'Parsed',        color: '#6366f1', icon: <CheckCircleIcon sx={{ fontSize: 14 }} /> },
  load_created: { label: 'Load Created',  color: '#10b981', icon: <LocalShippingIcon sx={{ fontSize: 14 }} /> },
  sent:         { label: 'Sent',          color: '#10b981', icon: <CheckCircleIcon sx={{ fontSize: 14 }} /> },
  error:        { label: 'Parse Error',   color: '#ef4444', icon: <ErrorIcon sx={{ fontSize: 14 }} /> },
};

const TYPE_META = {
  '204': { label: 'EDI 204 — Load Tender',        color: '#6366f1' },
  '214': { label: 'EDI 214 — Status Update',      color: '#f59e0b' },
  '210': { label: 'EDI 210 — Freight Invoice',    color: '#10b981' },
};

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.received;
  return (
    <Chip icon={m.icon} label={m.label} size="small"
      sx={{ bgcolor: `${m.color}22`, color: m.color, fontWeight: 700, border: `1px solid ${m.color}44`, fontSize: '0.72rem' }}
    />
  );
}

function fmtDate(dt) { return dt ? new Date(dt).toLocaleDateString() : '--'; }

const CARD_SX = {
  bgcolor: 'rgba(124,140,248,0.10)',
  border: '1.5px solid rgba(255,255,255,0.10)',
  borderRadius: 3,
};

const SAMPLE_204 = `ISA*00*          *00*          *ZZ*SHIPPER123      *ZZ*FREIGHTCONNECT *260101*1200*U*00401*000000001*0*P*>~
GS*SM*SHIPPER123*FREIGHTCONNECT*20260101*1200*1*X*004010~
ST*204*0001~
B2**FRTC*SHIP-001**BOL-2026-001*PP~
L11*PO-5001*PO~
L11*BOL-2026-001*BM~
G62*10*20260105~
G62*11*20260108~
N1*SH*ABC MANUFACTURING CO~
N3*1234 INDUSTRIAL BLVD~
N4*CHICAGO*IL*60601~
S5*1*LD~
N1*SF*CHICAGO WAREHOUSE~
N3*1234 INDUSTRIAL BLVD~
N4*CHICAGO*IL*60601~
S5*2*UL~
N1*ST*LA DISTRIBUTION CENTER~
N3*5678 HARBOR DR~
N4*LOS ANGELES*CA*90001~
OID***42000**L*24~
SE*19*0001~
GE*1*1~
IEA*1*000000001~`;

// ── Upload Dialog ─────────────────────────────────────────────────────────────
function UploadDialog({ open, onClose, onSuccess }) {
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [rawContent, setRawContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setRawContent(ev.target.result);
    reader.readAsText(file);
  };

  const submit = async () => {
    if (!rawContent.trim()) { setError('Paste or upload an EDI 204 document'); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/edi/inbound`, {
        method: 'POST', headers,
        body: JSON.stringify({ rawContent, type: '204' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      setRawContent(''); setError('');
      onSuccess(data);
    } catch {
      setError('Failed to upload EDI document');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: '#1e1b4b', color: '#fff', borderRadius: 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <UploadFileIcon sx={{ color: '#6366f1' }} />
        Upload EDI 204 — Load Tender
        <IconButton onClick={onClose} sx={{ ml: 'auto', color: '#9ca3af' }} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Button
          variant="outlined"
          component="label"
          startIcon={<UploadFileIcon />}
          sx={{ mb: 2, borderColor: '#6366f1', color: '#6366f1' }}
        >
          Upload .edi File
          <input type="file" accept=".edi,.txt,.x12" hidden onChange={handleFile} />
        </Button>

        <Typography variant="body2" sx={{ color: '#9ca3af', mb: 1 }}>Or paste EDI text:</Typography>
        <TextField
          multiline
          rows={12}
          fullWidth
          placeholder={SAMPLE_204}
          value={rawContent}
          onChange={e => setRawContent(e.target.value)}
          sx={{
            '& .MuiOutlinedInput-root': { color: '#c7d2fe', fontFamily: 'monospace', fontSize: '0.78rem', '& fieldset': { borderColor: 'rgba(255,255,255,0.2)' } },
          }}
        />
        <Button
          size="small"
          sx={{ mt: 1, color: '#9ca3af' }}
          onClick={() => setRawContent(SAMPLE_204)}
        >
          Load Sample EDI 204
        </Button>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: '#9ca3af' }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={loading || !rawContent.trim()}
          sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' } }}
        >
          {loading ? <CircularProgress size={20} /> : 'Parse & Upload'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Create Load from 204 Dialog ───────────────────────────────────────────────
function CreateLoadDialog({ doc, open, onClose, onSuccess }) {
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const p = doc?.parsedData || {};
  const originStr = [p.origin?.address, p.origin?.city, p.origin?.state].filter(Boolean).join(', ');
  const destStr   = [p.destination?.address, p.destination?.city, p.destination?.state].filter(Boolean).join(', ');

  const [origin, setOrigin]           = useState('');
  const [destination, setDestination] = useState('');
  const [rate, setRate]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    if (open) {
      setOrigin(originStr);
      setDestination(destStr);
      setRate(p.totalChargesCents ? (p.totalChargesCents / 100).toFixed(2) : '');
      setError('');
    }
    // eslint-disable-next-line
  }, [open, doc]);

  const submit = async () => {
    if (!origin || !destination || !rate) { setError('Origin, destination, and rate are required'); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/edi/${doc._id}/create-load`, {
        method: 'POST', headers,
        body: JSON.stringify({ origin, destination, rate: parseFloat(rate) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed'); return; }
      onSuccess(data.load);
    } catch {
      setError('Failed to create load');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: '#1e1b4b', color: '#fff', borderRadius: 3 } }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>Create Load from EDI 204</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mb: 2 }}>
          Review and confirm the fields parsed from the EDI document. You can edit them before creating the load.
        </Typography>
        {[
          { label: 'Origin', value: origin, set: setOrigin },
          { label: 'Destination', value: destination, set: setDestination },
          { label: 'Rate ($)', value: rate, set: setRate },
        ].map(f => (
          <TextField key={f.label} label={f.label} fullWidth size="small"
            value={f.value} onChange={e => f.set(e.target.value)}
            sx={{ mb: 1.5, input: { color: '#fff' }, label: { color: '#9ca3af' }, '& .MuiOutlinedInput-root fieldset': { borderColor: 'rgba(255,255,255,0.2)' } }}
          />
        ))}
        {p.equipment && <Typography variant="caption" sx={{ color: '#9ca3af' }}>Equipment: {p.equipment} • Weight: {p.weightLbs ? `${p.weightLbs} lbs` : 'N/A'}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: '#9ca3af' }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={loading}
          sx={{ bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' } }}
        >
          {loading ? <CircularProgress size={20} /> : 'Create Load'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Document Detail Drawer ────────────────────────────────────────────────────
function DetailDrawer({ doc, open, onClose, onCreateLoad }) {
  if (!doc) return null;
  const p = doc.parsedData || {};
  const tm = TYPE_META[doc.type] || {};

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 460 }, bgcolor: '#1a1740', color: '#fff', p: 3, overflowY: 'auto' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>{tm.label || doc.type}</Typography>
        <IconButton onClick={onClose} sx={{ ml: 'auto', color: '#9ca3af' }}><CloseIcon /></IconButton>
      </Box>

      <StatusChip status={doc.status} />
      <Typography variant="caption" sx={{ color: '#9ca3af', display: 'block', mt: 0.5, mb: 2 }}>
        {doc.direction === 'inbound' ? 'Received' : 'Generated'} {fmtDate(doc.createdAt)}
      </Typography>
      {doc.errorMessage && <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>{doc.errorMessage}</Alert>}

      {doc.load && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', mb: 1.5 }} />
          <Typography variant="body2" sx={{ color: '#9ca3af', mb: 0.5 }}>Linked Load</Typography>
          <Typography variant="body1" fontWeight={700} sx={{ color: '#10b981' }}>
            {doc.load.title || doc.load._id}
          </Typography>
        </>
      )}

      {doc.direction === 'inbound' && doc.type === '204' && doc.status === 'parsed' && (
        <Button
          variant="contained" startIcon={<AddIcon />} fullWidth
          onClick={() => onCreateLoad(doc)}
          sx={{ mt: 2, mb: 2, bgcolor: '#10b981', '&:hover': { bgcolor: '#059669' } }}
        >
          Create Load from this EDI 204
        </Button>
      )}

      {p.shipmentId && (
        <>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e5e7eb', mb: 1.5 }}>Parsed Fields</Typography>
          {[
            { label: 'Shipment ID',   value: p.shipmentId },
            { label: 'BOL Number',    value: p.bolNumber },
            { label: 'Ship Date',     value: p.shipDate },
            { label: 'Delivery Date', value: p.deliveryDate },
            { label: 'Equipment',     value: p.equipment },
            { label: 'Weight',        value: p.weightLbs ? `${p.weightLbs} lbs` : null },
            { label: 'Commodity',     value: p.commodity },
          ].filter(r => r.value).map(r => (
            <Box key={r.label} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="body2" sx={{ color: '#9ca3af' }}>{r.label}</Typography>
              <Typography variant="body2" sx={{ color: '#e5e7eb', fontWeight: 600 }}>{r.value}</Typography>
            </Box>
          ))}

          {(p.origin?.city || p.origin?.address) && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Origin</Typography>
              <Typography variant="body2" sx={{ color: '#e5e7eb' }}>
                {[p.origin.name, p.origin.address, p.origin.city, p.origin.state].filter(Boolean).join(', ')}
              </Typography>
            </Box>
          )}
          {(p.destination?.city || p.destination?.address) && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>Destination</Typography>
              <Typography variant="body2" sx={{ color: '#e5e7eb' }}>
                {[p.destination.name, p.destination.address, p.destination.city, p.destination.state].filter(Boolean).join(', ')}
              </Typography>
            </Box>
          )}

          {p.references?.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#9ca3af' }}>References</Typography>
              {p.references.map((r, i) => (
                <Typography key={i} variant="body2" sx={{ color: '#e5e7eb' }}>{r.qualifier}: {r.value}</Typography>
              ))}
            </Box>
          )}
        </>
      )}

      {/* Raw EDI toggle */}
      <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 2 }} />
      <details>
        <summary style={{ color: '#9ca3af', cursor: 'pointer', fontSize: '0.85rem', marginBottom: 8 }}>
          View Raw EDI
        </summary>
        <Box
          component="pre"
          sx={{
            bgcolor: 'rgba(0,0,0,0.4)', borderRadius: 1, p: 1.5,
            fontSize: '0.72rem', color: '#c7d2fe', fontFamily: 'monospace',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 300,
          }}
        >
          {doc.rawContent}
        </Box>
      </details>
    </Drawer>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ShipperEDI() {
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const [docs, setDocs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [tab, setTab]             = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detail, setDetail]       = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createDoc, setCreateDoc] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const fetchDocs = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/edi`, { headers });
      const data = await res.json();
      setDocs(Array.isArray(data) ? data : []);
      setError('');
    } catch {
      setError('Failed to load EDI documents');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const openDetail = async (doc) => {
    try {
      const res  = await fetch(`${API}/api/edi/${doc._id}`, { headers });
      const data = await res.json();
      setDetail(data);
      setDrawerOpen(true);
    } catch { setDetail(doc); setDrawerOpen(true); }
  };

  const filtered = tab === 0 ? docs
    : tab === 1 ? docs.filter(d => d.direction === 'inbound')
    : docs.filter(d => d.direction === 'outbound');

  // KPI stats
  const parsed     = docs.filter(d => d.status === 'parsed').length;
  const created    = docs.filter(d => d.status === 'load_created').length;
  const errors     = docs.filter(d => d.status === 'error').length;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 2 }}>
        <CodeIcon sx={{ color: '#6366f1', fontSize: 32 }} />
        <Box>
          <Typography variant="h5" fontWeight={700} sx={{ color: '#fff' }}>EDI Integration</Typography>
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            X12 EDI 204 (Load Tender) · 214 (Status) · 210 (Invoice)
          </Typography>
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <IconButton onClick={fetchDocs} size="small" sx={{ color: '#9ca3af' }}><RefreshIcon /></IconButton>
          <Button
            variant="contained" startIcon={<UploadFileIcon />}
            onClick={() => setUploadOpen(true)}
            sx={{ bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' } }}
          >
            Upload EDI 204
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {successMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMsg('')}>{successMsg}</Alert>}

      {/* KPIs */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Total Documents', value: docs.length, color: '#e5e7eb' },
          { label: 'Ready to Create Load', value: parsed, color: '#6366f1' },
          { label: 'Loads Created', value: created, color: '#10b981' },
          { label: 'Parse Errors', value: errors, color: errors > 0 ? '#ef4444' : '#6b7280' },
        ].map(k => (
          <Grid item xs={6} sm={3} key={k.label}>
            <Card sx={CARD_SX}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="caption" sx={{ color: '#9ca3af' }}>{k.label}</Typography>
                <Typography variant="h5" fontWeight={700} sx={{ color: k.color }}>{k.value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}
        TabIndicatorProps={{ sx: { bgcolor: '#6366f1' } }}
      >
        {['All', 'Inbound (204)', 'Outbound (214/210)'].map((label, i) => (
          <Tab key={i} label={label} sx={{ color: '#9ca3af', '&.Mui-selected': { color: '#fff' } }} />
        ))}
      </Tabs>

      {/* Document list */}
      <Card sx={CARD_SX}>
        <CardContent>
          {loading
            ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
            : filtered.length === 0
              ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <CodeIcon sx={{ fontSize: 48, color: '#374151', mb: 2 }} />
                  <Typography sx={{ color: '#6b7280' }}>No EDI documents yet</Typography>
                  <Button variant="contained" startIcon={<UploadFileIcon />}
                    onClick={() => setUploadOpen(true)}
                    sx={{ mt: 2, bgcolor: '#6366f1', '&:hover': { bgcolor: '#4f46e5' } }}
                  >
                    Upload Your First EDI 204
                  </Button>
                </Box>
              )
              : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {['Date', 'Type', 'Direction', 'Shipment/Load', 'Status', 'Actions'].map(h => (
                          <TableCell key={h} sx={{ color: '#9ca3af', borderColor: 'rgba(255,255,255,0.08)', fontWeight: 600 }}>{h}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filtered.map(doc => {
                        const tm = TYPE_META[doc.type] || {};
                        return (
                          <TableRow key={doc._id} hover
                            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' } }}
                            onClick={() => openDetail(doc)}
                          >
                            <TableCell sx={{ color: '#e5e7eb', borderColor: 'rgba(255,255,255,0.06)' }}>
                              {fmtDate(doc.createdAt)}
                            </TableCell>
                            <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                              <Chip label={doc.type} size="small"
                                sx={{ bgcolor: `${tm.color || '#6366f1'}22`, color: tm.color || '#6366f1', fontWeight: 700, fontSize: '0.72rem' }}
                              />
                            </TableCell>
                            <TableCell sx={{ color: '#9ca3af', borderColor: 'rgba(255,255,255,0.06)', textTransform: 'capitalize' }}>
                              {doc.direction}
                            </TableCell>
                            <TableCell sx={{ color: '#e5e7eb', borderColor: 'rgba(255,255,255,0.06)' }}>
                              {doc.load?.title || doc.parsedData?.shipmentId || doc.parsedData?.bolNumber || '--'}
                            </TableCell>
                            <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                              <StatusChip status={doc.status} />
                            </TableCell>
                            <TableCell sx={{ borderColor: 'rgba(255,255,255,0.06)' }}
                              onClick={e => e.stopPropagation()}
                            >
                              <Stack direction="row" spacing={0.5}>
                                <Tooltip title="View details">
                                  <IconButton size="small" sx={{ color: '#9ca3af' }}
                                    onClick={() => openDetail(doc)}
                                  >
                                    <InfoOutlinedIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                {doc.direction === 'inbound' && doc.status === 'parsed' && (
                                  <Tooltip title="Create Load">
                                    <IconButton size="small" sx={{ color: '#10b981' }}
                                      onClick={() => { setCreateDoc(doc); setCreateOpen(true); }}
                                    >
                                      <AddIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                                {doc.direction === 'outbound' && (
                                  <Tooltip title="Download">
                                    <IconButton size="small" sx={{ color: '#6366f1' }}
                                      onClick={() => {
                                        const token = localStorage.getItem('token');
                                        const url = doc.rawContent
                                          ? URL.createObjectURL(new Blob([doc.rawContent], { type: 'text/plain' }))
                                          : null;
                                        if (url) {
                                          const a = document.createElement('a');
                                          a.href = url; a.download = `EDI_${doc.type}_${doc._id}.edi`;
                                          a.click(); URL.revokeObjectURL(url);
                                        }
                                      }}
                                    >
                                      <DownloadIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Stack>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
              )
          }
        </CardContent>
      </Card>

      {/* Dialogs / Drawers */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={(doc) => {
          setUploadOpen(false);
          setDocs(prev => [doc, ...prev]);
          setDetail(doc);
          setDrawerOpen(true);
          setSuccessMsg(doc.status === 'parsed' ? 'EDI 204 parsed successfully!' : 'EDI document received (parse error — see details)');
        }}
      />
      <CreateLoadDialog
        doc={createDoc}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={(load) => {
          setCreateOpen(false);
          setDrawerOpen(false);
          fetchDocs();
          setSuccessMsg(`Load "${load.title}" created from EDI 204!`);
        }}
      />
      <DetailDrawer
        doc={detail}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreateLoad={(doc) => { setCreateDoc(doc); setCreateOpen(true); }}
      />
    </Box>
  );
}
