import React, { useState, useEffect } from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
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
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';

import SideNav from '../features/carrierDashboard/sections/components/SideNav';
import LogisticsAssistant from '../components/LogisticsAssistant';
import { DashboardProvider } from '../features/carrierDashboard/sections/context/DashboardContext';

export default function CarrierDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const role = localStorage.getItem('role') || 'guest';

  useEffect(() => {
    if (role === 'shipper') navigate('/dashboard/shipper', { replace: true });
    document.body.classList.add('dashboard-page');
    return () => document.body.classList.remove('dashboard-page');
  }, [role, navigate]);

  const theme = useTheme();
  const mdUp = useMediaQuery(theme.breakpoints.up('md'));

  const [drawerOpen, setDrawerOpen] = useState(mdUp);
  const [collapsed, setCollapsed] = useState(false);

  const [anchorEl, setAnchorEl] = useState(null);
  const profMenuOpen = Boolean(anchorEl);

  const fullW = 240;
  const miniW = 72;
  const drawerW = collapsed && mdUp ? miniW : fullW;

  // keep drawer in sync with viewport
  useEffect(() => {
    setDrawerOpen(mdUp);
    if (!mdUp) setCollapsed(false);
  }, [mdUp]);

  // Helper for nav: which section is active (for SideNav highlighting)
  const path = location.pathname;
  let currentSection = 'loads';
  if (path.includes('/documents')) currentSection = 'documents';
  else if (path.includes('/my-loads')) currentSection = 'myLoads';
  else if (path.includes('/fleet-map')) currentSection = 'fleetMap';
  else if (path.includes('/analytics')) currentSection = 'analytics';
  else if (path.includes('/fleet')) currentSection = 'fleet';   // <-- add this!
  else if (path.includes('/profile')) currentSection = 'profile';

  return (
    <DashboardProvider>
      <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: theme.palette.dashboardBg }}>
        {/* Top AppBar */}
        <AppBar
          elevation={0}
          sx={{
            backdropFilter: 'blur(24px)',
            background: theme.palette.glass,
            zIndex: theme.zIndex.drawer + 1,
          }}
        >
          <Toolbar>
            {!mdUp && (
              <IconButton onClick={() => setDrawerOpen(true)} sx={{ mr: 1 }}>
                <MenuIcon />
              </IconButton>
            )}

            <Typography variant="h6" fontWeight={700} mr={2}>
              FreightConnect
            </Typography>

            {role !== 'guest' && (
              <Chip
                size="small"
                label={role.toUpperCase()}
                sx={{
                  mr: 'auto',
                  bgcolor: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  fontWeight: 600,
                }}
              />
            )}

            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)}>
              <AccountCircleIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        {/* Profile menu */}
        <Menu
          anchorEl={anchorEl}
          open={profMenuOpen}
          onClose={() => setAnchorEl(null)}
          PaperProps={{ sx: { backdropFilter: 'blur(12px)', background: theme.palette.glass } }}
        >
          <MenuItem onClick={() => { navigate('/dashboard/carrier/profile'); setAnchorEl(null); }}>
            Profile
          </MenuItem>
          <MenuItem onClick={() => { localStorage.clear(); navigate('/'); }}>
            Logout
          </MenuItem>
        </Menu>

        {/* Side Drawer */}
        <Drawer
          variant={mdUp ? 'persistent' : 'temporary'}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          PaperProps={{
            sx: {
              width: drawerW,
              backdropFilter: 'blur(24px)',
              background: theme.palette.glass,
              borderRight: 'none',
              pt: 8, // space under AppBar
            },
          }}
        >
          {mdUp && (
            <IconButton onClick={() => setCollapsed(!collapsed)} sx={{ ml: collapsed ? 0.5 : 1.5, mb: 1 }}>
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          )}

          {/* Updated SideNav: highlight based on route, navigate via router */}
          <SideNav
            current={currentSection}
            collapsed={collapsed && mdUp}
            onSelect={(key) => {
              // Map key to route
              if (key === "loads") navigate("/dashboard/carrier/loads");
              else if (key === "documents") navigate("/dashboard/carrier/documents");
              else if (key === "myLoads") navigate("/dashboard/carrier/my-loads");
              else if (key === "fleet") navigate("/dashboard/carrier/fleet");
              else if (key === "fleetMap") navigate("/dashboard/carrier/fleet-map"); // <-- here
              else if (key === "analytics") navigate("/dashboard/carrier/analytics"); 
              else if (key === "profile") navigate("/dashboard/carrier/profile");
              if (!mdUp) setDrawerOpen(false);
            }}
          />
        </Drawer>

        {/* Main content: always render nested routes here */}
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

        <LogisticsAssistant />
      </Box>
    </DashboardProvider>
  );
}
