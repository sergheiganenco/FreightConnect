import React, { useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography, Box,
} from '@mui/material';
import Papa from 'papaparse';
import api from '../../services/api';
import { surface, text as T, brand, radius } from '../../theme/tokens';

/**
 * Bulk CSV import: choose file -> parse in browser -> server dryRun -> preview -> confirm.
 * props: open, onClose, onImported(count), title, endpoint, bodyKey,
 *   columns [{ name, required, note }], example (array of strings, same order as columns),
 *   templateName, toRow?(record) -> row object (default: non-empty trimmed values)
 */
export default function CsvImportDialog({
  open, onClose, onImported, title, endpoint, bodyKey, columns, example, templateName, toRow,
}) {
  const [rows, setRows] = useState(null);
  const [warning, setWarning] = useState('');
  const [report, setReport] = useState(null); // dryRun result { count, errors }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setRows(null); setWarning(''); setReport(null); setError(''); setBusy(false); };
  const close = () => { reset(); onClose(); };

  const templateHref = () => {
    const csv = Papa.unparse([columns.map((c) => c.name), example]);
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  };

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    reset();
    try {
      const raw = (await file.text()).replace(/^﻿/, '');
      const parsed = Papa.parse(raw, { header: true, skipEmptyLines: 'greedy' });
      const byLower = Object.fromEntries(columns.map((c) => [c.name.toLowerCase(), c.name]));
      const headers = (parsed.meta.fields || []).map((h) => h.trim());
      const unknown = headers.filter((h) => h && !byLower[h.toLowerCase()]);
      const missing = columns.filter((c) => c.required && !headers.some((h) => h.toLowerCase() === c.name.toLowerCase()));
      if (missing.length) {
        setError(`Missing required column(s): ${missing.map((c) => c.name).join(', ')}.`);
        return;
      }
      if (unknown.length) setWarning(`Ignoring unknown column(s): ${unknown.join(', ')}.`);
      const out = parsed.data.map((rec) => {
        const norm = {};
        Object.entries(rec).forEach(([k, v]) => {
          const name = byLower[k.trim().toLowerCase()];
          if (name && typeof v === 'string' && v.trim() !== '') norm[name] = v.trim();
        });
        return toRow ? toRow(norm) : norm;
      });
      if (!out.length) { setError('The file has no data rows.'); return; }
      setRows(out);
      setBusy(true);
      const { data } = await api.post(`${endpoint}?dryRun=true`, { [bodyKey]: out });
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not read or validate the file.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(endpoint, { [bodyKey]: rows });
      onImported(data.added);
      close();
    } catch (err) {
      const errs = err.response?.data?.errors;
      if (errs) setReport({ count: rows.length, errors: errs });
      setError(err.response?.data?.error || 'Import failed.');
      setBusy(false);
    }
  }

  const valid = report && report.errors.length === 0;

  return (
    <Dialog open={open} onClose={close} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: surface.modal, color: T.primary, borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" sx={{ color: T.secondary }}>
            CSV with a header row. Columns (* required):{' '}
            {columns.map((c) => `${c.name}${c.required ? '*' : ''}${c.note ? ` (${c.note})` : ''}`).join(', ')}.
            All rows are validated first; if any row is invalid nothing is imported.{' '}
            <Link href={templateHref()} download={templateName}>Download template</Link>
          </Typography>
          <Box>
            <Button variant="outlined" component="label" disabled={busy}>
              Choose CSV file
              <input type="file" accept=".csv,text/csv" hidden onChange={onFile} />
            </Button>
            {busy && <CircularProgress size={20} sx={{ ml: 2, verticalAlign: 'middle' }} />}
          </Box>
          {warning && <Alert severity="warning">{warning}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {report && (
            <>
              <Typography fontWeight={700}>
                {report.count} row(s) read — {valid ? 'all rows valid' : `${report.errors.length} error(s)`}
              </Typography>
              {!valid && (
                <Box sx={{ maxHeight: 260, overflow: 'auto' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow><TableCell>Row</TableCell><TableCell>Field</TableCell><TableCell>Problem</TableCell></TableRow>
                    </TableHead>
                    <TableBody>
                      {report.errors.slice(0, 200).map((er, i) => (
                        <TableRow key={i}><TableCell>{er.row}</TableCell><TableCell>{er.field}</TableCell><TableCell>{er.message}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {report.errors.length > 200 && (
                    <Typography variant="caption">Showing the first 200 errors.</Typography>
                  )}
                </Box>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} sx={{ color: T.secondary }}>Cancel</Button>
        <Button variant="contained" onClick={confirm} disabled={!valid || busy}
          sx={{ bgcolor: brand.indigo, borderRadius: radius.pill, fontWeight: 700 }}>
          Confirm import
        </Button>
      </DialogActions>
    </Dialog>
  );
}
