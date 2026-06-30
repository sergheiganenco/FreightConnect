// src/features/shipperDashboard/sections/components/LoadGrid.js
import React from "react";
import { Grid, Box, Typography, Button } from "@mui/material";
import Inventory2Icon from "@mui/icons-material/Inventory2";
import PostAddIcon from "@mui/icons-material/PostAdd";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import LoadCard from "./LoadCard";
import SkeletonLoadCard from "../../../carrierDashboard/sections/components/SkeletonLoadCard"; // reuse if available
import { text as T, semantic, surface, brand } from "../../../../theme/tokens";

export default function LoadGrid({ loads = [], loading, errorMsg, onSelect, onPostLoad, onRetry }) {
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
          {errorMsg || "Something went wrong while fetching your loads."}
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
        <Inventory2Icon sx={{ fontSize: 56, color: T.muted, mb: 1.5 }} />
        <Typography variant="h6" fontWeight={700} sx={{ color: T.primary, mb: 0.5 }}>
          No loads yet
        </Typography>
        <Typography variant="body2" sx={{ color: T.secondary, maxWidth: 420, mx: "auto", mb: onPostLoad ? 2.5 : 0 }}>
          Post your first load to start matching with verified carriers.
        </Typography>
        {onPostLoad && (
          <Button
            variant="contained"
            startIcon={<PostAddIcon />}
            onClick={onPostLoad}
            sx={{
              bgcolor: brand.primary,
              color: T.primary,
              textTransform: "none",
              fontWeight: 700,
              "&:hover": { bgcolor: brand.secondary },
            }}
          >
            Post a Load
          </Button>
        )}
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {loads.map((l) => (
        <Grid item xs={12} md={6} key={l._id || l.id}>
          <LoadCard load={l} onClick={() => onSelect && onSelect(l)} />
        </Grid>
      ))}
    </Grid>
  );
}
