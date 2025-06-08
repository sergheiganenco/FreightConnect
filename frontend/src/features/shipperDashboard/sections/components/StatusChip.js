import React from "react";
import { Chip } from "@mui/material";

const palette = {
  open: { bg: "#e0f2fe", color: "#0284c7" },
  posted: { bg: "#d9f99d", color: "#15803d" },
  delivered: { bg: "#dcfce7", color: "#16a34a" },
  "in-transit": { bg: "#fef9c3", color: "#f59e0b" },
  accepted: { bg: "#ede9fe", color: "#7c3aed" },
  cancelled: { bg: "#fee2e2", color: "#ef4444" },
  "intransit": { bg: "#fef9c3", color: "#f59e0b" }
};
export default function StatusChip({ status }) {
  const s = (status || "").toLowerCase();
  const p = palette[s] || palette.open;
  return <Chip label={status} size="small" sx={{
    bgcolor: p.bg,
    color: p.color,
    fontWeight: 700,
    fontSize: 13,
    borderRadius: 2,
    px: 2,
    letterSpacing: 0.5,
    textTransform: "capitalize"
  }} />;
}
