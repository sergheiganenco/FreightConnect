// =========================================================
// src/features/carrierDashboa./components/LoadGrid.jsx
// =========================================================
import React from "react";
import { Grid, Typography } from "@mui/material";
import LoadCard from "./LoadCard";
import SkeletonLoadCard from "./SkeletonLoadCard";


export default function LoadGrid({ loads, loading, errorMsg, onSelect }) {
  if (loading) return <SkeletonLoadCard />;
  if (errorMsg) return <Typography color="error">{errorMsg}</Typography>;
  if (!loads.length) return <Typography>No loads found.</Typography>;

  // ── DEBUG: peek at the first load object ─────────────
  if (loads.length) {
    const l = loads[0];
    const ok = Object.keys(l).filter(k => k.toLowerCase().includes('origin'));
    const dk = Object.keys(l).filter(k => k.toLowerCase().includes('dest'));
    const rk = Object.keys(l).filter(k =>
      k.toLowerCase().includes('rate') ||
      k.toLowerCase().includes('price')
    );
  
    console.log('origin keys:', ok.join(', '));
    console.log('dest keys:',   dk.join(', '));
    console.log('rate keys:',   rk.join(', '));
    console.log('full sample (first 3 props):',
                JSON.stringify(Object.fromEntries(Object.entries(l).slice(0,3)), null, 2));
  }
  // ─────────────────────────────────────────────────────

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