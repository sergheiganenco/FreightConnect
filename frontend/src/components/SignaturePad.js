import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, Typography, Box,
} from '@mui/material';
import { surface, text, brand, gradient, shadow, darkFieldSx } from '../theme/tokens';

// Ink is dark so the exported PNG stays legible on white documents (BOL/POD).
const INK = text.dark;      // '#0f172a'
const PAPER = text.primary; // '#ffffff' — canvas background baked into the PNG
const CANVAS_HEIGHT = 200;

/**
 * SignaturePad — reusable, dependency-free signature capture dialog.
 *
 * Renders a plain <canvas> the user draws on with pointer/touch input, plus a
 * signer-name field. On Save it exports the drawing as a PNG data URL.
 *
 * @param {boolean}  open      - whether the dialog is open (controlled)
 * @param {function} onClose   - called when the dialog should close (Cancel / backdrop)
 * @param {function} onSave    - called with { dataUrl, signerName } when the user saves
 * @param {string}   title     - dialog heading (default 'Sign')
 * @param {string}   subtitle  - optional helper line under the heading
 */
export default function SignaturePad({ open, onClose, onSave, title = 'Sign', subtitle }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const [signerName, setSignerName] = useState('');
  const [hasStroke, setHasStroke] = useState(false);

  // Reset transient state whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) {
      setSignerName('');
      setHasStroke(false);
    }
  }, [open]);

  // Size the backing store to the rendered box (accounting for devicePixelRatio)
  // and paint the white "paper" background. Runs once the enter transition ends,
  // so getBoundingClientRect() reflects the final layout.
  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || canvas.clientWidth || 300;
    const cssHeight = rect.height || CANVAS_HEIGHT;

    // Assigning width/height clears the canvas and resets all context state.
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    ctx.scale(ratio, ratio);

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  // Translate a pointer or touch event into canvas-local CSS pixel coordinates.
  const pointFromEvent = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = (e.touches && e.touches[0])
      || (e.changedTouches && e.changedTouches[0])
      || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const startDraw = (e) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pointFromEvent(e);
    drawingRef.current = true;
    lastRef.current = p;
    // Draw a dot so a single tap still registers as a stroke.
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    setHasStroke(true);
  };

  const moveDraw = (e) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  // ── Pointer handlers (mouse / pen / touch on modern browsers) ──
  const handlePointerDown = (e) => {
    startDraw(e);
    if (e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
  };
  const handlePointerMove = (e) => moveDraw(e);
  const handlePointerUp = () => endDraw();

  // ── Touch handlers (fallback for browsers without Pointer Events) ──
  // When Pointer Events exist they already deliver touch input, so skip here
  // to avoid drawing each stroke twice. touch-action:none stops page scroll.
  const handleTouchStart = (e) => { if (!window.PointerEvent) startDraw(e); };
  const handleTouchMove = (e) => { if (!window.PointerEvent) moveDraw(e); };
  const handleTouchEnd = () => { if (!window.PointerEvent) endDraw(); };

  const handleClear = () => {
    setupCanvas();
    setHasStroke(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave({ dataUrl, signerName: signerName.trim() });
  };

  const canSave = hasStroke && signerName.trim().length > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEntered: setupCanvas }}
      PaperProps={{
        sx: {
          background: surface.cardBg,
          backdropFilter: 'blur(20px)',
          border: `1px solid ${surface.glassBorder}`,
          borderRadius: 3,
          boxShadow: shadow.modal,
        },
      }}
    >
      <DialogTitle sx={{ color: text.primary, pb: subtitle ? 0.5 : 2 }}>
        {title}
        {subtitle && (
          <Typography variant="body2" sx={{ color: text.secondary, mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <TextField
            label="Signer name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            fullWidth
            size="small"
            sx={{ ...darkFieldSx, mb: 2 }}
          />

          <Typography variant="caption" sx={{ color: text.muted, display: 'block', mb: 0.75 }}>
            Sign below
          </Typography>

          <Box
            sx={{
              position: 'relative',
              borderRadius: 2,
              overflow: 'hidden',
              border: `1px solid ${surface.glassBorder}`,
              boxShadow: `inset 0 0 0 1px ${surface.glassSubtle}`,
            }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                display: 'block',
                width: '100%',
                height: CANVAS_HEIGHT,
                background: PAPER,
                touchAction: 'none',
                cursor: 'crosshair',
              }}
            />
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button
              onClick={handleClear}
              disabled={!hasStroke}
              size="small"
              sx={{ color: brand.indigoLight, textTransform: 'none' }}
            >
              Clear
            </Button>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: text.muted }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave}
          sx={{
            background: gradient.primary,
            color: text.primary,
            borderRadius: 2,
            fontWeight: 600,
            '&:disabled': { opacity: 0.5, color: text.muted },
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
