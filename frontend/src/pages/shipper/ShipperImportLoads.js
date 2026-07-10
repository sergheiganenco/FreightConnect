import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  Chip,
  MenuItem,
  Checkbox,
  Divider,
  CircularProgress,
  Stack,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import api from '../../services/api';

const EQUIPMENT_TYPES = [
  'Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Lowboy',
  'Tanker', 'Box Truck', 'Power Only', 'Conestoga', 'RGN',
];

const EXAMPLE = `1. Chicago, IL to Dallas, TX - Dry Van - 42,000 lbs - $2,400 - load #A123
2. Atlanta, GA -> Miami, FL, Reefer, $1,900, ref BX-9981
3. Reno, NV to Boise, ID | Flatbed | $1,250`;

const confidenceColor = (c) => (c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'default');

// A parsed load becomes a postable row; missing rate/equipment are editable.
function toRow(load) {
  return {
    origin: load.origin || '',
    destination: load.destination || '',
    equipmentType: load.equipmentType || '',
    rate: load.rate != null ? String(load.rate) : '',
    loadWeight: load.loadWeight != null ? String(load.loadWeight) : '',
    externalRef: load.externalRef || '',
    title: load.title || '',
    confidence: load.confidence || 'low',
    include: true,
  };
}

const isComplete = (r) =>
  r.origin.trim() && r.destination.trim() && r.equipmentType && Number(r.rate) > 0;

export default function ShipperImportLoads() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState(null); // null = not parsed yet
  const [source, setSource] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { created, failed }

  const parse = async () => {
    setError('');
    setResult(null);
    setParsing(true);
    try {
      const { data } = await api.post('/enterprise/loads/parse', { text });
      const loads = data?.data?.loads || [];
      setRows(loads.map(toRow));
      setSource(data?.data?.source || null);
      setWarnings(data?.data?.warnings || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to parse loads');
    } finally {
      setParsing(false);
    }
  };

  const updateRow = (i, patch) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const selected = rows ? rows.filter((r) => r.include) : [];
  const postable = selected.filter(isComplete);

  const post = async () => {
    setError('');
    setPosting(true);
    try {
      const loads = postable.map((r) => ({
        title: r.title || `${r.origin} → ${r.destination}${r.equipmentType ? ` (${r.equipmentType})` : ''}`,
        origin: r.origin.trim(),
        destination: r.destination.trim(),
        equipmentType: r.equipmentType,
        rate: Number(r.rate),
        loadWeight: r.loadWeight ? Number(r.loadWeight) : undefined,
        externalRef: r.externalRef || undefined,
        source: 'email',
      }));
      const { data } = await api.post('/enterprise/loads/bulk', { loads });
      setResult({
        created: data?.summary?.created ?? (data?.created?.length || 0),
        failed: data?.summary?.failed ?? (data?.errors?.length || 0),
        errors: data?.errors || [],
      });
      setRows(null);
      setText('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to post loads');
    } finally {
      setPosting(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 0, md: 1 }, maxWidth: 1000 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Import Loads from Email
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Paste a broker/shipper email or a load list. We'll pull out the lanes, rates, and equipment
        so you can review and post them — no manual re-typing.
      </Typography>

      {result && (
        <Alert
          severity={result.created > 0 ? 'success' : 'warning'}
          sx={{ mb: 2 }}
          onClose={() => setResult(null)}
        >
          Posted {result.created} load{result.created === 1 ? '' : 's'}
          {result.failed > 0 ? ` — ${result.failed} failed` : ''}.
          {result.errors?.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2 }}>
              {result.errors.slice(0, 5).map((e, i) => (
                <li key={i}><Typography variant="caption">{e.title}: {e.error}</Typography></li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper elevation={0} sx={{ p: 2, mb: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
        <TextField
          fullWidth
          multiline
          minRows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Paste your load email here, e.g.\n\n${EXAMPLE}`}
          disabled={parsing}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            startIcon={parsing ? <CircularProgress size={18} color="inherit" /> : <AutoFixHighIcon />}
            onClick={parse}
            disabled={parsing || !text.trim()}
          >
            {parsing ? 'Parsing…' : 'Parse loads'}
          </Button>
          {text && (
            <Button variant="text" color="inherit" onClick={() => { setText(''); setRows(null); setResult(null); }} disabled={parsing}>
              Clear
            </Button>
          )}
        </Stack>
      </Paper>

      {warnings?.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {warnings.map((w, i) => <div key={i}>{w}</div>)}
        </Alert>
      )}

      {rows && rows.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No loads found. Each load needs at least an origin and destination, e.g. “Chicago, IL to Dallas, TX”.
        </Alert>
      )}

      {rows && rows.length > 0 && (
        <>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              Review {rows.length} load{rows.length === 1 ? '' : 's'}
            </Typography>
            {source && (
              <Chip
                size="small"
                label={source === 'llm' ? 'AI-parsed' : 'auto-parsed'}
                color={source === 'llm' ? 'primary' : 'default'}
                variant="outlined"
              />
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Fill in anything missing (a load needs an origin, destination, equipment, and rate to post).
          </Typography>

          <Stack spacing={1.5} sx={{ mb: 2 }}>
            {rows.map((r, i) => {
              const complete = isComplete(r);
              return (
                <Paper
                  key={i}
                  elevation={0}
                  sx={{
                    p: 1.5,
                    border: '1px solid',
                    borderColor: r.include && !complete ? 'warning.main' : 'divider',
                    opacity: r.include ? 1 : 0.55,
                  }}
                >
                  <Stack direction="row" alignItems="flex-start" spacing={1}>
                    <Checkbox
                      checked={r.include}
                      onChange={(e) => updateRow(i, { include: e.target.checked })}
                      sx={{ mt: -0.5 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                        <TextField label="Origin" size="small" value={r.origin}
                          onChange={(e) => updateRow(i, { origin: e.target.value })} />
                        <TextField label="Destination" size="small" value={r.destination}
                          onChange={(e) => updateRow(i, { destination: e.target.value })} />
                        <TextField label="Equipment" size="small" select value={r.equipmentType}
                          onChange={(e) => updateRow(i, { equipmentType: e.target.value })}
                          error={r.include && !r.equipmentType}>
                          <MenuItem value=""><em>— select —</em></MenuItem>
                          {EQUIPMENT_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                        </TextField>
                        <TextField label="Rate ($)" size="small" type="number" value={r.rate}
                          onChange={(e) => updateRow(i, { rate: e.target.value })}
                          error={r.include && !(Number(r.rate) > 0)} />
                        <TextField label="Weight (lbs)" size="small" type="number" value={r.loadWeight}
                          onChange={(e) => updateRow(i, { loadWeight: e.target.value })} />
                        <TextField label="Reference" size="small" value={r.externalRef}
                          onChange={(e) => updateRow(i, { externalRef: e.target.value })} />
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                        <Chip size="small" label={`${r.confidence} confidence`} color={confidenceColor(r.confidence)} variant="outlined" />
                        {r.include && !complete && (
                          <Typography variant="caption" color="warning.main">
                            Needs equipment and a rate before it can post
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>

          <Divider sx={{ mb: 2 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <Button
              variant="contained"
              startIcon={posting ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
              onClick={post}
              disabled={posting || postable.length === 0}
            >
              {posting ? 'Posting…' : `Post ${postable.length} load${postable.length === 1 ? '' : 's'}`}
            </Button>
            {selected.length > postable.length && (
              <Typography variant="caption" color="text.secondary">
                {selected.length - postable.length} selected load{selected.length - postable.length === 1 ? '' : 's'} still missing equipment or rate.
              </Typography>
            )}
          </Stack>
        </>
      )}
    </Box>
  );
}
