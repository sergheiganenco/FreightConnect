import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography,
  List, ListItem, ListItemText, Divider, Box
} from '@mui/material';
import { Save, RestorePage, DeleteForever } from '@mui/icons-material';
import { surface, text, brand, gradient, shadow } from '../theme/tokens';

const DRAFT_PREFIX = 'fc_draft_';
const SAVE_INTERVAL = 5000; // 5 seconds

/**
 * Hook: useDraftManager
 *
 * Manages auto-saving form data to localStorage.
 * Returns { hasDraft, draftData, saveDraft, clearDraft, showResumeDialog, setShowResumeDialog }
 *
 * @param {string} key - unique key for this draft (e.g., 'shipper_post_load')
 * @param {object} data - current form data
 * @param {function} setData - setter to restore form data
 */
export function useDraftManager(key, data, setData) {
  const storageKey = DRAFT_PREFIX + key;
  const [hasDraft, setHasDraft] = useState(false);
  const [draftData, setDraftData] = useState(null);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const lastSavedRef = useRef(null);
  const dataRef = useRef(data);

  // Keep dataRef in sync
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Check for existing draft on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.data && parsed.timestamp) {
          // Only show if draft is less than 24 hours old
          const ageMs = Date.now() - parsed.timestamp;
          if (ageMs < 86400000) {
            setDraftData(parsed.data);
            setHasDraft(true);
            setShowResumeDialog(true);
          } else {
            localStorage.removeItem(storageKey);
          }
        }
      }
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // Auto-save interval
  useEffect(() => {
    const interval = setInterval(() => {
      const currentData = dataRef.current;
      if (!currentData) return;

      const serialized = JSON.stringify(currentData);
      // Only save if data actually changed
      if (serialized !== lastSavedRef.current) {
        // Only save if form has meaningful content
        const hasContent = Object.values(currentData).some(v =>
          v !== '' && v !== null && v !== undefined && v !== 0 &&
          !(Array.isArray(v) && v.length === 0)
        );
        if (hasContent) {
          try {
            localStorage.setItem(storageKey, JSON.stringify({
              data: currentData,
              timestamp: Date.now(),
            }));
            lastSavedRef.current = serialized;
          } catch {
            // localStorage full
          }
        }
      }
    }, SAVE_INTERVAL);

    return () => clearInterval(interval);
  }, [storageKey]);

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        data: dataRef.current,
        timestamp: Date.now(),
      }));
    } catch {
      // ignore
    }
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setHasDraft(false);
    setDraftData(null);
    lastSavedRef.current = null;
  }, [storageKey]);

  const resumeDraft = useCallback(() => {
    if (draftData && setData) {
      setData(draftData);
    }
    setShowResumeDialog(false);
  }, [draftData, setData]);

  const discardDraft = useCallback(() => {
    clearDraft();
    setShowResumeDialog(false);
  }, [clearDraft]);

  return {
    hasDraft,
    draftData,
    saveDraft,
    clearDraft,
    resumeDraft,
    discardDraft,
    showResumeDialog,
    setShowResumeDialog,
  };
}

/**
 * DraftResumeDialog - shows when a saved draft is detected
 */
export function DraftResumeDialog({ open, draft, onResume, onDiscard }) {
  if (!draft) return null;

  // Build a preview of saved draft fields
  const previewItems = Object.entries(draft)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .slice(0, 8); // Show max 8 fields in preview

  return (
    <Dialog
      open={open}
      maxWidth="sm"
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
      <DialogTitle sx={{ color: text.primary, display: 'flex', alignItems: 'center', gap: 1 }}>
        <RestorePage sx={{ color: brand.primary }} />
        Resume Draft?
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ color: text.secondary, mb: 2 }}>
          You have an unsaved draft from a previous session. Would you like to resume?
        </Typography>
        {previewItems.length > 0 && (
          <Box sx={{
            background: surface.glass, borderRadius: 2,
            border: `1px solid ${surface.glassBorder}`, p: 1
          }}>
            <List dense disablePadding>
              {previewItems.map(([key, value], idx) => (
                <React.Fragment key={key}>
                  <ListItem>
                    <ListItemText
                      primary={key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                      secondary={
                        typeof value === 'object'
                          ? JSON.stringify(value).slice(0, 60) + (JSON.stringify(value).length > 60 ? '...' : '')
                          : String(value).slice(0, 60)
                      }
                      primaryTypographyProps={{ sx: { color: text.strong, fontSize: '0.85rem' } }}
                      secondaryTypographyProps={{ sx: { color: text.secondary, fontSize: '0.8rem' } }}
                    />
                  </ListItem>
                  {idx < previewItems.length - 1 && (
                    <Divider sx={{ borderColor: surface.glassBorder }} />
                  )}
                </React.Fragment>
              ))}
            </List>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onDiscard} startIcon={<DeleteForever />}
          sx={{ color: text.muted }}>
          Discard Draft
        </Button>
        <Button variant="contained" onClick={onResume} startIcon={<Save />}
          sx={{
            background: gradient.primary, color: text.primary,
            borderRadius: 2, fontWeight: 600,
          }}>
          Resume
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DraftResumeDialog;
