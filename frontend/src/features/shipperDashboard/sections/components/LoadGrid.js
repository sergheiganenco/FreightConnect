// src/features/shipperDashboard/sections/components/LoadGrid.js
import React from "react";
import { Grid, Typography } from "@mui/material";
import LoadCard from "./LoadCard";
import SkeletonLoadCard from "../../../carrierDashboard/sections/components/SkeletonLoadCard"; // reuse if available

export default function LoadGrid({ loads = [], loading, errorMsg, onSelect }) {
  if (loading) return <SkeletonLoadCard />;
  if (errorMsg) return <Typography color="error">{errorMsg}</Typography>;
  if (!loads.length) return <Typography>No loads found.</Typography>;

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
