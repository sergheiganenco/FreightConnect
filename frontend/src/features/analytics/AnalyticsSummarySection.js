// src/features/analytics/AnalyticsSummarySection.jsx
import React from "react";
import { Box } from "@mui/material";
import KPICard from "../shared/KPICard";

export default function AnalyticsSummarySection({ kpis }) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 2 }}>
      {kpis.map((kpi) => (
        <KPICard key={kpi.label} label={kpi.label} value={kpi.value} color={kpi.color} />
      ))}
    </Box>
  );
}
