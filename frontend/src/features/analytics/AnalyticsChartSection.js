// src/features/analytics/AnalyticsChartSection.jsx
import React from "react";
import { Box } from "@mui/material";
import { StatusPieChart, LoadsLineChart } from "../shared/AnalyticsCharts";

export default function AnalyticsChartSection({ statusData, timeData }) {
  return (
    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
      <StatusPieChart data={statusData} />
      <LoadsLineChart data={timeData} />
      {/* Add more charts as needed */}
    </Box>
  );
}
