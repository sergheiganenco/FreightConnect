// src/pages/admin/AdminDashboard.js

import React, { useState, useEffect } from "react";
import { useNavigate, Outlet, useLocation } from "react-router-dom";
import {
  Box,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Drawer,
  Chip,
  Menu,
  MenuItem,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import SideNav from '../../features/adminDashboard/section/components/SideNav';
import NotificationBell from '../../features/shared/NotificationBell';
import { disconnectSocket } from '../../services/socket';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const mdUp = useMediaQuery(theme.breakpoints.up("md"));
  const [drawerOpen, setDrawerOpen] = useState(mdUp);
  const [collapsed, setCollapsed] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const profMenuOpen = Boolean(anchorEl);

  // Defensive: Role check (centralize in context in future)
  const role = localStorage.getItem("role") || "guest";
  useEffect(() => {
    if (role === "carrier") navigate("/dashboard/carrier", { replace: true });
    else if (role === "shipper") navigate("/dashboard/shipper", { replace: true });
    else if (role !== "admin") navigate("/", { replace: true }); // if not admin, go home
    document.body.classList.add("dashboard-page");
    return () => document.body.classList.remove("dashboard-page");
    // eslint-disable-next-line
  }, [role, navigate]);

  // Keep drawer in sync with viewport size
  useEffect(() => {
    setDrawerOpen(mdUp);
    if (!mdUp) setCollapsed(false);
  }, [mdUp]);

  // Section highlight logic
  const path = location.pathname;
  let currentSection = "overview";
  if (path.includes("/loads")) currentSection = "loads";
  else if (path.includes("/users")) currentSection = "users";
  else if (path.includes("/companies")) currentSection = "companies";
  else if (path.includes("/exceptions")) currentSection = "exceptions";
  else if (path.includes("/profile")) currentSection = "profile";

  // Responsive drawer width
  const fullW = 240;
  const miniW = 72;
  const drawerW = collapsed && mdUp ? miniW : fullW;

  // Navigation and menu actions
  const handleNav = (key) => {
    if (key === "overview") navigate("/dashboard/admin/overview");
    else if (key === "loads") navigate("/dashboard/admin/loads");
    else if (key === "users") navigate("/dashboard/admin/users");
    else if (key === "companies") navigate("/dashboard/admin/companies");
    else if (key === "exceptions") navigate("/dashboard/admin/exceptions");
    else if (key === "profile") navigate("/dashboard/admin/profile");
    if (!mdUp) setDrawerOpen(false);
  };

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", width: "100vw" }}>
      {/* Top AppBar */}
      <AppBar
        elevation={0}
        sx={{
          backdropFilter: "blur(24px)",
          background: theme.palette.glass || "rgba(34, 25, 84, 0.92)",
          zIndex: theme.zIndex.drawer + 1,
        }}
      >
        <Toolbar>
          {!mdUp && (
            <IconButton
              onClick={() => setDrawerOpen(true)}
              sx={{ mr: 1 }}
              aria-label="Open navigation"
              edge="start"
            >
              <MenuIcon />
            </IconButton>
          )}

          <Typography variant="h6" fontWeight={700} mr={2} letterSpacing={1}>
            FreightConnect
          </Typography>

          <Chip
            size="small"
            label="ADMIN"
            sx={{
              mr: "auto",
              bgcolor: "#f04ca7",
              color: "#fff",
              fontWeight: 700,
              fontSize: "1em",
              letterSpacing: 1,
            }}
            tabIndex={-1}
            aria-label="Admin role"
          />

          <NotificationBell />
          <IconButton
            onClick={(e) => setAnchorEl(e.currentTarget)}
            edge="end"
            aria-label="Profile menu"
            aria-haspopup="true"
          >
            <AccountCircleIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Profile/Logout menu */}
      <Menu
        anchorEl={anchorEl}
        open={profMenuOpen}
        onClose={() => setAnchorEl(null)}
        PaperProps={{
          sx: { backdropFilter: "blur(12px)", background: theme.palette.glass || "rgba(34,25,84,0.96)" },
        }}
      >
        <MenuItem
          onClick={() => {
            navigate("/dashboard/admin/profile");
            setAnchorEl(null);
          }}
        >
          Profile
        </MenuItem>
        <MenuItem
          onClick={() => {
            disconnectSocket();
            localStorage.clear();
            navigate("/");
          }}
        >
          Logout
        </MenuItem>
      </Menu>

      {/* Side Drawer */}
      <Drawer
        variant={mdUp ? "persistent" : "temporary"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            width: drawerW,
            backdropFilter: "blur(24px)",
            background: theme.palette.glass || "rgba(34, 25, 84, 0.92)",
            borderRight: "none",
            pt: 8, // space under AppBar
          },
        }}
      >
        {mdUp && (
          <IconButton
            onClick={() => setCollapsed(!collapsed)}
            sx={{ ml: collapsed ? 0.5 : 1.5, mb: 1 }}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        )}

        <SideNav
          current={currentSection}
          collapsed={collapsed && mdUp}
          onSelect={handleNav}
        />
      </Drawer>

      {/* Main Content: always render nested routes here */}
      <Box
        component="main"
        sx={{
          flex: 1,
          pt: 11, // space below AppBar
          ml: { md: `${drawerW}px` }, // push content next to drawer
          px: { xs: 2, md: 4 },
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
