import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Box, Tabs, Tab, Typography } from "@mui/material";

const tabs = [
  { label: "Overview", value: "overview" },
  { label: "All Loads", value: "loads" },
  { label: "Users", value: "users" },
  { label: "Profile", value: "profile" }
];

export default function AdminDashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentTab = React.useMemo(() => {
    const path = location.pathname.split("/dashboard/admin/")[1];
    const idx = tabs.findIndex(tab => path?.startsWith(tab.value));
    return idx === -1 ? 0 : idx;
  }, [location.pathname]);
  const handleTabChange = (_, v) => {
    navigate(tabs[v].value);
  };

  return (
    <Box sx={{ width: "100%" }}>
      <Typography variant="h5" sx={{ mt: 2, mb: 2, textAlign: "center" }}>
        Admin Dashboard
      </Typography>
      <Tabs value={currentTab} onChange={handleTabChange} centered>
        {tabs.map((tab, i) => (
          <Tab key={tab.value} label={tab.label} />
        ))}
      </Tabs>
      <Box sx={{ mt: 3 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
