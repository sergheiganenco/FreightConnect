// src/features/shared/AnalyticsCharts.jsx
import React from "react";
import { Box, Typography } from "@mui/material";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from "recharts";
import BRAND from "../../config/branding";

// Sample data; replace with API data
const statusData = [
  { name: "Delivered", value: 21 },
  { name: "In Transit", value: 6 },
  { name: "Open", value: 2 },
  { name: "Refused", value: 1 },
];
const statusColors = [BRAND.accentColor, "#fbbf24", "#22d3ee", "#ef4444"];

export function StatusPieChart({ data = statusData }) {
  return (
    <Box sx={{ width: "100%", height: 240, bgcolor: BRAND.glass, borderRadius: 4, p: 2, mt: 2 }}>
      <Typography color="#fff" mb={1} fontWeight={700}>Load Status Breakdown</Typography>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={60}>
            {data.map((entry, idx) => (
              <Cell key={entry.name} fill={statusColors[idx % statusColors.length]} />
            ))}
          </Pie>
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function LoadsLineChart({ data }) {
  // Data should be [{date: "2024-07-01", posted: 2, delivered: 1}, ...]
  return (
    <Box sx={{ width: "100%", height: 240, bgcolor: BRAND.glass, borderRadius: 4, p: 2, mt: 2 }}>
      <Typography color="#fff" mb={1} fontWeight={700}>Loads Over Time</Typography>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#ccc" />
          <YAxis stroke="#ccc" />
          <Tooltip />
          <Line type="monotone" dataKey="posted" stroke={BRAND.primaryColor} strokeWidth={2} />
          <Line type="monotone" dataKey="delivered" stroke={BRAND.accentColor} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
