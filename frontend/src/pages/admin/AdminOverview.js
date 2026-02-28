import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  Grid,
  CircularProgress,
  Button,
  Stack,
  Card,
  CardContent,
  CardActionArea,
  Chip,
  Divider,
  IconButton,
  Alert,
} from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import AssignmentLateIcon from "@mui/icons-material/AssignmentLate";
import PeopleIcon from "@mui/icons-material/People";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import ListAltIcon from "@mui/icons-material/ListAlt";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import api from "../../services/api";
import { useNavigate } from "react-router-dom";

const CARD_COLORS = [
  "linear-gradient(135deg,#4732f5 0%,#e1129a 100%)",
  "linear-gradient(135deg,#1f2dff 0%,#6a1fcf 70%,#e1129a 100%)",
  "linear-gradient(135deg,#332b67 0%,#f04ca7 100%)",
  "linear-gradient(135deg,#322460 0%,#994bb5 80%,#f160a5 100%)",
  "linear-gradient(135deg,#222 0%,#8e44ad 100%)",
];

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  // Fetch admin stats + recent activity
  const fetchAll = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [{ data: s }, { data: act }] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/activity"),
      ]);
      setStats(s);
      setActivity(Array.isArray(act) ? act : []);
    } catch (e) {
      setErr(e?.response?.data?.error || "Failed to load admin data");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Card configuration: icon, label, value, color, route
  const cards = [
    {
      icon: <DescriptionIcon sx={{ fontSize: 40, color: "#ffd965" }} />,
      label: "Pending Docs",
      value: stats?.pendingDocs ?? 0,
      color: CARD_COLORS[0],
      onClick: () => navigate("/dashboard/admin/loads?filter=pending-docs"),
    },
    {
      icon: <ListAltIcon sx={{ fontSize: 40, color: "#97d8f5" }} />,
      label: "Live Loads",
      value: stats?.liveLoads ?? 0,
      color: CARD_COLORS[1],
      onClick: () => navigate("/dashboard/admin/loads?filter=live"),
    },
    {
      icon: <AssignmentLateIcon sx={{ fontSize: 40, color: "#f08383" }} />,
      label: "Flagged Issues",
      value: stats?.flaggedIssues ?? 0,
      color: CARD_COLORS[2],
      onClick: () => navigate("/dashboard/admin/loads?filter=flagged"),
    },
    {
      icon: <PeopleIcon sx={{ fontSize: 40, color: "#c7ffdc" }} />,
      label: "Users",
      value: stats?.users ?? 0,
      color: CARD_COLORS[3],
      onClick: () => navigate("/dashboard/admin/users"),
    },
    {
      icon: <AttachMoneyIcon sx={{ fontSize: 40, color: "#ffe76c" }} />,
      label: "Revenue (YTD)",
      value: stats?.revenue ? `$${stats.revenue.toLocaleString()}` : "$0",
      color: CARD_COLORS[4],
      onClick: null,
    },
  ];

  return (
    <Box sx={{ width: "100%", maxWidth: 1100, mx: "auto", py: 4 }}>
      <Stack direction="row" alignItems="center" spacing={2} mb={2}>
        <Typography
          variant="h3"
          fontWeight={900}
          color="#fff"
          letterSpacing={1}
          sx={{ flex: 1 }}
        >
          Admin Overview
        </Typography>
        <IconButton onClick={fetchAll} color="secondary" size="large">
          <RefreshIcon />
        </IconButton>
      </Stack>
      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
      {loading ? (
        <Box py={10} display="flex" justifyContent="center">
          <CircularProgress size={38} />
        </Box>
      ) : (
        <>
          <Grid container spacing={3} mb={3}>
            {cards.map((card, idx) => (
              <Grid key={card.label} item xs={12} sm={6} md={4} lg={2.4}>
                <Card
                  sx={{
                    background: card.color,
                    color: "#fff",
                    boxShadow: "0 6px 40px #1e034320",
                    borderRadius: 5,
                    minHeight: 130,
                  }}
                  elevation={0}
                >
                  <CardActionArea
                    disabled={!card.onClick}
                    onClick={card.onClick}
                    sx={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center" }}
                  >
                    <CardContent sx={{ textAlign: "center", py: 3 }}>
                      {card.icon}
                      <Typography fontSize={32} fontWeight={900} color="#fff" mt={1}>
                        {card.value}
                      </Typography>
                      <Typography fontSize={17} fontWeight={700} color="#fff" letterSpacing={0.7}>
                        {card.label}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Stack direction="row" spacing={2} mb={3} justifyContent="center">
            <Button
              size="large"
              sx={{
                bgcolor: "#f5c542",
                color: "#5a3258",
                fontWeight: 800,
                borderRadius: 99,
                fontSize: "1.13em",
                px: 4,
                boxShadow: "0 1px 8px #f5c54244",
                "&:hover": { bgcolor: "#ffd76c" },
              }}
              onClick={() => navigate("/dashboard/admin/loads?filter=pending-docs")}
            >
              Review Pending Docs
            </Button>
            <Button
              size="large"
              sx={{
                bgcolor: "#f04ca7",
                color: "#fff",
                fontWeight: 800,
                borderRadius: 99,
                fontSize: "1.13em",
                px: 4,
                boxShadow: "0 1px 8px #f04ca744",
                "&:hover": { bgcolor: "#d12e8b" },
              }}
              onClick={() => navigate("/dashboard/admin/loads?filter=flagged")}
            >
              View Flagged Issues
            </Button>
            <Button
              size="large"
              sx={{
                bgcolor: "#a88ff8",
                color: "#fff",
                fontWeight: 800,
                borderRadius: 99,
                fontSize: "1.13em",
                px: 4,
                boxShadow: "0 1px 8px #a88ff844",
                "&:hover": { bgcolor: "#8a6bd6" },
              }}
              onClick={() => navigate("/dashboard/admin/users")}
            >
              Manage Users
            </Button>
          </Stack>
          <Divider sx={{ my: 3, borderColor: "#fff3" }} />
          <Box>
            <Typography variant="h6" color="#fff" fontWeight={800} mb={2}>
              Recent Activity
            </Typography>
            {activity.length === 0 ? (
              <Typography color="#fff9" mb={3}>
                No recent activity found.
              </Typography>
            ) : (
              <Stack spacing={2}>
                {activity.map((a, i) => (
                  <Box
                    key={a._id || i}
                    sx={{
                      bgcolor: "rgba(255,255,255,0.04)",
                      borderRadius: 3,
                      px: 2,
                      py: 1,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                    }}
                  >
                    <ErrorOutlineIcon sx={{ color: "#f04ca7" }} />
                    <Typography fontWeight={600}>{a.description || "Activity"}</Typography>
                    <Chip
                      label={new Date(a.date).toLocaleString()}
                      size="small"
                      sx={{
                        ml: "auto",
                        bgcolor: "#f7e6ff33",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: "0.92em",
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
