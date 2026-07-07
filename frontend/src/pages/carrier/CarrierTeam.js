import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, Chip, CircularProgress, Alert,
  Table, TableBody, TableCell, TableHead, TableRow, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  FormControl, InputLabel, Select, MenuItem, Stack,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import api from '../../services/api';

const ROLE_LABEL = { owner: 'Owner', dispatcher: 'Dispatcher', driver: 'Driver' };
const ROLE_COLOR = { owner: 'primary', dispatcher: 'info', driver: 'default' };

export default function CarrierTeam() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', companyRole: 'dispatcher' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/users/team');
      setMembers(res.data.members || []);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load your team');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleField = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const addMember = async () => {
    setSaving(true);
    setFormError('');
    try {
      await api.post('/users/team', form);
      setDialogOpen(false);
      setForm({ name: '', email: '', password: '', companyRole: 'dispatcher' });
      await load();
    } catch (err) {
      setFormError(err.response?.data?.error || (err.response?.data?.errors?.[0]?.msg) || 'Could not add member');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m) => {
    try {
      await api.patch(`/users/team/${m._id}`, { active: !m.active });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update member');
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={800}>Team</Typography>
          <Typography variant="body2" color="text.secondary">
            Dispatcher and driver logins under your company. They act on your company's behalf.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setDialogOpen(true)}>
          Add member
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ my: 2 }} onClose={() => setError('')}>{error}</Alert>}

      <Paper variant="outlined" sx={{ mt: 2, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No team members yet. Add a dispatcher or driver to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {members.map((m) => (
              <TableRow key={m._id} sx={{ opacity: m.active ? 1 : 0.55 }}>
                <TableCell sx={{ fontWeight: 600 }}>{m.name}</TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  <Chip size="small" label={ROLE_LABEL[m.companyRole] || m.companyRole} color={ROLE_COLOR[m.companyRole] || 'default'} />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={m.active ? 'Active' : 'Deactivated'}
                    color={m.active ? 'success' : 'default'}
                    variant={m.active ? 'filled' : 'outlined'}
                  />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={m.active ? 'Deactivate (blocks login)' : 'Reactivate'}>
                    <IconButton size="small" onClick={() => toggleActive(m)} color={m.active ? 'error' : 'success'}>
                      {m.active ? <BlockIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add team member</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField label="Full name" name="name" value={form.name} onChange={handleField} fullWidth size="small" />
            <TextField label="Email" name="email" type="email" value={form.email} onChange={handleField} fullWidth size="small" />
            <TextField
              label="Temporary password" name="password" type="password"
              value={form.password} onChange={handleField} fullWidth size="small"
              helperText="At least 8 characters. Share it with them to sign in."
            />
            <FormControl fullWidth size="small">
              <InputLabel>Role</InputLabel>
              <Select label="Role" name="companyRole" value={form.companyRole} onChange={handleField}>
                <MenuItem value="dispatcher">Dispatcher — books &amp; manages loads and fleet</MenuItem>
                <MenuItem value="driver">Driver — accepts loads, logs HOS, uploads POD</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={addMember} disabled={saving}>
            {saving ? 'Adding…' : 'Add member'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
