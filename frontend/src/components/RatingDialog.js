import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Rating,
  TextField, Typography, Stack, Box, CircularProgress, Alert, Divider
} from '@mui/material';
import { Star, StarBorder } from '@mui/icons-material';
import api from '../services/api';
import { surface, text, brand, gradient, shadow, darkFieldSx } from '../theme/tokens';

const CARRIER_CATEGORIES = [
  { key: 'communication', label: 'Communication' },
  { key: 'punctuality', label: 'Punctuality' },
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'cargoHandling', label: 'Cargo Handling' },
];

const SHIPPER_CATEGORIES = [
  { key: 'communication', label: 'Communication' },
  { key: 'professionalism', label: 'Professionalism' },
  { key: 'paymentSpeed', label: 'Payment Speed' },
];

/**
 * RatingDialog - post-delivery rating component
 *
 * @param {boolean} open - whether dialog is open
 * @param {function} onClose - close handler
 * @param {string} loadId - the load being rated
 * @param {string} ratedUserId - the user being rated
 * @param {string} ratingRole - role of the person being rated ('carrier' or 'shipper')
 * @param {function} onSubmitted - callback after successful submission
 */
export default function RatingDialog({ open, onClose, loadId, ratedUserId, ratingRole, onSubmitted }) {
  const [overall, setOverall] = useState(0);
  const [categories, setCategories] = useState({});
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [alreadyRated, setAlreadyRated] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const categoryList = ratingRole === 'carrier' ? CARRIER_CATEGORIES : SHIPPER_CATEGORIES;

  // Check if already rated on open
  useEffect(() => {
    if (!open || !loadId) return;
    setCheckingExisting(true);
    setAlreadyRated(false);
    setError('');
    setSuccess(false);
    setOverall(0);
    setCategories({});
    setComment('');

    api.get(`/ratings/check/${loadId}`)
      .then(res => {
        if (res.data?.exists) {
          setAlreadyRated(true);
        }
      })
      .catch(() => {
        // Endpoint may not exist yet - allow rating
      })
      .finally(() => setCheckingExisting(false));
  }, [open, loadId]);

  const handleCategoryChange = (key, value) => {
    setCategories(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (overall === 0) {
      setError('Please provide an overall rating');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/ratings', {
        loadId,
        ratedUserId,
        ratingRole,
        overall,
        categories,
        comment: comment.trim(),
      });
      setSuccess(true);
      setTimeout(() => {
        if (onSubmitted) onSubmitted();
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit rating');
    } finally {
      setLoading(false);
    }
  };

  const ratingLabels = {
    1: 'Poor',
    2: 'Below Average',
    3: 'Average',
    4: 'Good',
    5: 'Excellent',
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
        <Star sx={{ color: '#fbbf24' }} />
        Rate {ratingRole === 'carrier' ? 'Carrier' : 'Shipper'}
      </DialogTitle>

      <DialogContent>
        {checkingExisting ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress sx={{ color: brand.primary }} />
          </Box>
        ) : alreadyRated ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            You have already submitted a rating for this load.
          </Alert>
        ) : success ? (
          <Alert severity="success" sx={{ mt: 1 }}>
            Rating submitted successfully. Thank you!
          </Alert>
        ) : (
          <Stack spacing={3} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            {/* Overall Rating */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="subtitle1" sx={{ color: text.primary, mb: 1, fontWeight: 600 }}>
                Overall Rating
              </Typography>
              <Rating
                value={overall}
                onChange={(_, v) => setOverall(v)}
                size="large"
                icon={<Star sx={{ fontSize: 40, color: '#fbbf24' }} />}
                emptyIcon={<StarBorder sx={{ fontSize: 40, color: text.muted }} />}
              />
              {overall > 0 && (
                <Typography variant="body2" sx={{ color: text.secondary, mt: 0.5 }}>
                  {ratingLabels[overall]}
                </Typography>
              )}
            </Box>

            <Divider sx={{ borderColor: surface.glassBorder }} />

            {/* Category Ratings */}
            <Box>
              <Typography variant="subtitle2" sx={{ color: text.strong, mb: 2 }}>
                Category Ratings (optional)
              </Typography>
              <Stack spacing={2}>
                {categoryList.map(({ key, label }) => (
                  <Box key={key} sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    px: 2, py: 1, borderRadius: 2,
                    background: surface.glass,
                  }}>
                    <Typography variant="body2" sx={{ color: text.primary }}>{label}</Typography>
                    <Rating
                      value={categories[key] || 0}
                      onChange={(_, v) => handleCategoryChange(key, v)}
                      size="small"
                      icon={<Star sx={{ color: '#fbbf24' }} />}
                      emptyIcon={<StarBorder sx={{ color: text.muted }} />}
                    />
                  </Box>
                ))}
              </Stack>
            </Box>

            <Divider sx={{ borderColor: surface.glassBorder }} />

            {/* Comment */}
            <Box>
              <Typography variant="subtitle2" sx={{ color: text.strong, mb: 1 }}>
                Comment (optional)
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={3}
                placeholder="Share your experience..."
                value={comment}
                onChange={e => {
                  if (e.target.value.length <= 500) setComment(e.target.value);
                }}
                sx={darkFieldSx}
                helperText={`${comment.length}/500 characters`}
                FormHelperTextProps={{ sx: { color: text.muted, textAlign: 'right' } }}
              />
            </Box>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: text.muted }}>
          {alreadyRated || success ? 'Close' : 'Cancel'}
        </Button>
        {!alreadyRated && !success && !checkingExisting && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || overall === 0}
            sx={{
              background: gradient.primary, color: text.primary,
              borderRadius: 2, fontWeight: 600,
              '&:disabled': { opacity: 0.5 },
            }}
          >
            {loading ? <CircularProgress size={22} sx={{ color: text.primary }} /> : 'Submit Rating'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
