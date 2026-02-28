// src/features/shared/KPICard.jsx
import React from "react";
import { Card, Typography, Box } from "@mui/material";
import BRAND from "../../config/branding";

export default function KPICard({ label, value, color = BRAND.primaryColor }) {
  return (
    <Card
      sx={{
        minWidth: 120,
        minHeight: 70,
        p: 2,
        bgcolor: BRAND.glass,
        borderLeft: `6px solid ${color}`,
        borderRadius: 3,
        boxShadow: 3,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        mr: 1.5,
      }}
      elevation={4}
    >
      <Typography variant="h5" fontWeight={700} color="#fff">
        {value}
      </Typography>
      <Typography variant="caption" color="#ddd">
        {label}
      </Typography>
    </Card>
  );
}
