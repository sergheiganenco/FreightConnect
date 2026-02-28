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

import SideNav from '../../features/carrierDashboard/sections/components/SideNav';
import LogisticsAssistant from '../../components/LogisticsAssistant';
import { DashboardProvider } from '../../features/carrierDashboard/sections/context/DashboardContext';
import NotificationBell from '../../features/shared/NotificationBell';
import { disconnectSocket } from '../../services/socket';

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
  else if (path.includes('/payments')) currentSection = 'payments';
  else if (path.includes('/contracts')) currentSection = 'contracts';
  else if (path.includes('/appointments')) currentSection = 'appointments';
  else if (path.includes('/trips')) currentSection = 'trips';
  else if (path.includes('/eld')) currentSection = 'eld';
  else if (path.includes('/factoring')) currentSection = 'factoring';
  else if (path.includes('/tax')) currentSection = 'tax';
  else if (path.includes('/network')) currentSection = 'network';
  else if (path.includes('/fleet')) currentSection = 'fleet';
  else if (path.includes('/chat')) currentSection = 'chat';
  else if (path.includes('/verification')) currentSection = 'verification';
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

            <NotificationBell />
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
          <MenuItem onClick={() => { disconnectSocket(); localStorage.clear(); navigate('/'); }}>
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
              else if (key === "fleetMap") navigate("/dashboard/carrier/fleet-map");
              else if (key === "analytics") navigate("/dashboard/carrier/analytics");
              else if (key === "payments") navigate("/dashboard/carrier/payments");
              else if (key === "contracts") navigate("/dashboard/carrier/contracts");
              else if (key === "appointments") navigate("/dashboard/carrier/appointments");
              else if (key === "trips") navigate("/dashboard/carrier/trips");
              else if (key === "eld") navigate("/dashboard/carrier/eld");
              else if (key === "factoring") navigate("/dashboard/carrier/factoring");
              else if (key === "tax") navigate("/dashboard/carrier/tax");
              else if (key === "network") navigate("/dashboard/carrier/network");
              else if (key === "chat") navigate("/dashboard/carrier/chat");
              else if (key === "verification") navigate("/dashboard/carrier/verification");
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
