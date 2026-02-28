import React, { useEffect, useState } from "react";
import { Box, Grid, Paper, Typography, CircularProgress, Stack } from "@mui/material";
import { Assignment, People, Warning, CheckCircle, AttachMoney } from "@mui/icons-material";
import api from "../../../services/api";

export default function OverviewSection() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/stats")
      .then(res => setStats(res.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Box textAlign="center" pt={6}><CircularProgress /></Box>;
  if (!stats) return <Box color="error.main" textAlign="center">Failed to load stats.</Box>;

  const cards = [
    {
      icon: <Assignment fontSize="large" sx={{ color: "#ffb700" }} />,
      label: "Pending Docs",
      value: stats.pendingDocs,
    },
    {
      icon: <CheckCircle fontSize="large" sx={{ color: "#22d39f" }} />,
      label: "Live Loads",
      value: stats.liveLoads,
    },
    {
      icon: <Warning fontSize="large" sx={{ color: "#ff2f72" }} />,
      label: "Flagged Issues",
      value: stats.flaggedIssues,
    },
    {
      icon: <People fontSize="large" sx={{ color: "#7e5dff" }} />,
      label: "Total Users",
      value: stats.users,
    },
    ...(typeof stats.revenue === "number"
      ? [{
          icon: <AttachMoney fontSize="large" sx={{ color: "#36cb6b" }} />,
          label: "Total Revenue",
          value: `$${stats.revenue.toLocaleString()}`,
        }]
      : []),
  ];

  return (
    <Box sx={{ mt: 3 }}>
      <Grid container spacing={3}>
        {cards.map(card => (
          <Grid item xs={12} sm={6} md={3} key={card.label}>
            <Paper
              elevation={3}
              sx={{
                py: 3,
                px: 2,
                borderRadius: 4,
                bgcolor: "rgba(255,255,255,0.09)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                minHeight: 130,
              }}
            >
              <Stack direction="row" alignItems="center" gap={2}>
                {card.icon}
                <Typography variant="h4" fontWeight={900} color="#fff">
                  {card.value}
                </Typography>
              </Stack>
              <Typography color="#f3f1fa" fontWeight={700} fontSize="1.09em" mt={2}>
                {card.label}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Typography mt={6} color="#eee" align="center" fontSize="1.11em">
        Use the navigation to manage users, review documents, and resolve flagged loads.
      </Typography>
    </Box>
  );
}
