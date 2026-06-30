// src/features/shared/KPICard.jsx
import React from "react";
import { Card, Typography, Box } from "@mui/material";
import { brand, surface, shadow, radius, text } from "../../theme/tokens";

export default function KPICard({ label, value, color = brand.primary }) {
  return (
    <Card
      sx={{
        minWidth: 120,
        minHeight: 70,
        p: 2,
        bgcolor: surface.glass,
        borderLeft: `6px solid ${color}`,
        borderRadius: 3,
        boxShadow: shadow.card,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        mr: 1.5,
      }}
      elevation={4}
    >
      <Typography variant="h5" fontWeight={700} color={text.primary}>
        {value}
      </Typography>
      <Typography variant="caption" color={text.navInactive}>
        {label}
      </Typography>
    </Card>
  );
}
