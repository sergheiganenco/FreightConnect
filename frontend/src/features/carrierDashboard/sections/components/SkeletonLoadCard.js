// =========================================================
// src/features/carrierDashboard/components/SkeletonLoadCard.jsx
// =========================================================
import React from "react";
import { Paper, Skeleton } from "@mui/material";

export default function SkeletonLoadCard() {
  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Skeleton variant="rectangular" height={24} sx={{ mb: 1 }} />
      <Skeleton variant="text" width="60%" />
    </Paper>
  );
}