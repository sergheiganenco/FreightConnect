// =========================================================
// src/features/carrierDashboard/sections/components/LoadGrid.js
// =========================================================
import React from "react";
import { Grid, Box, Typography, Button } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import LoadCard from "./LoadCard";
import SkeletonLoadCard from "./SkeletonLoadCard";
import { text as T, semantic, surface } from "../../../../theme/tokens";

export default function LoadGrid({ loads = [], loading, errorMsg, onSelect, onRetry }) {
  if (loading) return <SkeletonLoadCard />;

  if (errorMsg) {
    return (
      <Box
        sx={{
          textAlign: "center",
          py: 8,
          px: 2,
          borderRadius: 3,
          background: surface.glassSubtle,
          border: `1px solid ${surface.glassBorder}`,
        }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 56, color: semantic.error, mb: 1.5, opacity: 0.85 }} />
        <Typography variant="h6" fontWeight={700} sx={{ color: T.primary, mb: 0.5 }}>
          Couldn't load your loads
        </Typography>
        <Typography variant="body2" sx={{ color: T.secondary, maxWidth: 420, mx: "auto", mb: 2.5 }}>
          {errorMsg || "Something went wrong while fetching loads."}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={onRetry ? onRetry : () => window.location.reload()}
          sx={{ color: T.primary, borderColor: surface.glassBorder, textTransform: "none" }}
        >
          Retry
        </Button>
      </Box>
    );
  }

  if (!loads.length) {
    return (
      <Box
        sx={{
          textAlign: "center",
          py: 8,
          px: 2,
          borderRadius: 3,
          background: surface.glassSubtle,
          border: `1px solid ${surface.glassBorder}`,
        }}
      >
        <LocalShippingIcon sx={{ fontSize: 56, color: T.muted, mb: 1.5 }} />
        <Typography variant="h6" fontWeight={700} sx={{ color: T.primary, mb: 0.5 }}>
          No loads match right now
        </Typography>
        <Typography variant="body2" sx={{ color: T.secondary, maxWidth: 440, mx: "auto" }}>
          Try widening your filters, or check the Recommended tab for AI-matched loads.
          New loads appear here in real time.
        </Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {loads.map((l) => (
        <Grid item xs={12} md={6} key={l._id}>
          <LoadCard load={l} onClick={() => onSelect(l)} />
        </Grid>
      ))}
    </Grid>
  );
}
