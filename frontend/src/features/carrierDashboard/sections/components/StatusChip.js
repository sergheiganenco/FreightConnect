// =========================================================
// src/features/carrierDashboard/components/StatusChip.jsx
// =========================================================
import React from "react";
import { Chip } from "@mui/material";

const palette = {
  open: { bg: "#e0f2fe", color: "#0284c7" },
  accepted: { bg: "#ede9fe", color: "#7c3aed" },
  inTransit: { bg: "#fef9c3", color: "#f59e0b" },
  delivered: { bg: "#dcfce7", color: "#16a34a" },
};
export default function StatusChip({ status }) {
  const p = palette[status] || palette.open;
  return <Chip label={status} size="small" sx={{ bgcolor: p.bg, color: p.color, textTransform: "capitalize" }} />;
}