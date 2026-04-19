import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Stack, Typography, Tooltip, Alert
} from '@mui/material';
import { BookmarkBorder, Bookmark, Delete, Add, FilterList } from '@mui/icons-material';
import { surface, text, brand, gradient, shadow, darkFieldSx } from '../theme/tokens';

const STORAGE_KEY = 'fc_saved_filters';

function loadSavedFilters(namespace) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[namespace] || [];
  } catch {
    return [];
  }
}

function persistFilters(namespace, filters) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[namespace] = filters;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * SavedFilters - displays saved filter presets as chips with quick-apply
 *
 * @param {object} currentFilters - the currently active filter values
 * @param {function} onApplyFilter - callback to apply a saved filter set
 * @param {string} namespace - unique key to separate filter sets (e.g., 'carrier_loadboard')
 */
export function SavedFilters({ currentFilters, onApplyFilter, namespace = 'default' }) {
  const [presets, setPresets] = useState([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [activePreset, setActivePreset] = useState(null);

  useEffect(() => {
    setPresets(loadSavedFilters(namespace));
  }, [namespace]);

  const handleApply = useCallback((preset) => {
    setActivePreset(preset.name);
    if (onApplyFilter) onApplyFilter(preset.filters);
  }, [onApplyFilter]);

  const handleDelete = useCallback((name) => {
    const updated = presets.filter(p => p.name !== name);
    setPresets(updated);
    persistFilters(namespace, updated);
    if (activePreset === name) setActivePreset(null);
  }, [presets, namespace, activePreset]);

  const handleSave = useCallback((name) => {
    if (!name.trim()) return;
    const existing = presets.filter(p => p.name !== name.trim());
    const updated = [...existing, { name: name.trim(), filters: currentFilters, createdAt: Date.now() }];
    setPresets(updated);
    persistFilters(namespace, updated);
    setSaveOpen(false);
  }, [presets, currentFilters, namespace]);

  if (presets.length === 0 && !currentFilters) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
      <FilterList sx={{ color: text.muted, fontSize: 18 }} />
      <Typography variant="caption" sx={{ color: text.muted, mr: 0.5 }}>
        Saved:
      </Typography>

      {presets.map((preset) => (
        <Chip
          key={preset.name}
          label={preset.name}
          size="small"
          icon={activePreset === preset.name ? <Bookmark sx={{ fontSize: 16 }} /> : <BookmarkBorder sx={{ fontSize: 16 }} />}
          onClick={() => handleApply(preset)}
          onDelete={() => handleDelete(preset.name)}
          deleteIcon={<Delete sx={{ fontSize: 14 }} />}
          sx={{
            background: activePreset === preset.name ? surface.glassActive : surface.glass,
            color: activePreset === preset.name ? text.primary : text.strong,
            border: `1px solid ${activePreset === preset.name ? brand.primary : surface.glassBorder}`,
            '&:hover': { background: surface.glassHover },
            '& .MuiChip-icon': { color: activePreset === preset.name ? brand.primary : text.muted },
            '& .MuiChip-deleteIcon': { color: text.muted, '&:hover': { color: '#ef4444' } },
          }}
        />
      ))}

      <Tooltip title="Save current filters">
        <Chip
          icon={<Add sx={{ fontSize: 16 }} />}
          label="Save"
          size="small"
          onClick={() => setSaveOpen(true)}
          sx={{
            background: 'transparent',
            color: text.muted,
            border: `1px dashed ${surface.glassBorder}`,
            '&:hover': { background: surface.glass, color: text.primary },
            '& .MuiChip-icon': { color: text.muted },
          }}
        />
      </Tooltip>

      <SaveFilterDialog
        open={saveOpen}
        filters={currentFilters}
        onSave={handleSave}
        onClose={() => setSaveOpen(false)}
        existingNames={presets.map(p => p.name)}
      />
    </Box>
  );
}

/**
 * SaveFilterDialog - dialog to name and save the current filter set
 */
export function SaveFilterDialog({ open, filters, onSave, onClose, existingNames = [] }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setError('');
    }
  }, [open]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }
    if (name.trim().length > 30) {
      setError('Name must be 30 characters or less');
      return;
    }
    onSave(name.trim());
  };

  const filterEntries = filters
    ? Object.entries(filters).filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== 'all')
    : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          background: surface.cardBg,
          backdropFilter: 'blur(20px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: 3,
          boxShadow: shadow.modal,
        }
      }}
    >
      <DialogTitle sx={{ color: text.primary }}>Save Filter Preset</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Preset Name"
          placeholder="e.g., East Coast Reefer"
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
          sx={{ mt: 1, ...darkFieldSx }}
          helperText={error || `${name.length}/30 characters`}
          error={!!error}
        />

        {filterEntries.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ color: text.muted }}>
              Filters to save:
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
              {filterEntries.map(([key, value]) => (
                <Chip
                  key={key}
                  label={`${key}: ${value}`}
                  size="small"
                  sx={{
                    background: surface.glass,
                    color: text.strong,
                    border: `1px solid ${surface.glassBorder}`,
                    fontSize: '0.75rem',
                    mb: 0.5,
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {existingNames.includes(name.trim()) && name.trim() && (
          <Alert severity="info" sx={{ mt: 1, fontSize: '0.8rem' }}>
            This will overwrite the existing "{name.trim()}" preset.
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: text.muted }}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit}
          sx={{
            background: gradient.primary, color: text.primary,
            borderRadius: 2, fontWeight: 600,
          }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default SavedFilters;
