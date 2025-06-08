import React, { useState, useEffect } from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import {
  Box,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Drawer,
  Menu,
  MenuItem,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import SideNav from '../../features/shipperDashboard/sections/components/SideNav';

// If you want to highlight the active section based on route:
const sectionFromPath = (pathname) => {
  if (pathname.includes('/post-load')) return 'post-load';
  if (pathname.includes('/documents')) return 'documents';
  if (pathname.includes('/profile')) return 'profile';
  return 'loads';
};

export default function ShipperDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const mdUp = useMediaQuery(theme.breakpoints.up('md'));

  const [drawerOpen, setDrawerOpen] = useState(mdUp);
  const [collapsed, setCollapsed] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const profMenuOpen = Boolean(anchorEl);

  const fullW = 240;
  const miniW = 72;
  const drawerW = collapsed && mdUp ? miniW : fullW;

  useEffect(() => {
    setDrawerOpen(mdUp);
    if (!mdUp) setCollapsed(false);
    // Match carrier: set body class for CSS background fallback
    document.body.classList.add('dashboard-page');
    return () => document.body.classList.remove('dashboard-page');
  }, [mdUp]);

  const path = location.pathname;
  const currentSection = sectionFromPath(path);

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        bgcolor: theme.palette?.dashboardBg || undefined,
        background: theme.palette?.dashboardBg
          ? undefined
          : 'linear-gradient(135deg, #1f2dff 0%, #6a1fcf 40%, #e1129a 100%)',
      }}
      className="dashboard-page"
    >
      {/* AppBar */}
      <AppBar
        elevation={0}
        sx={{
          backdropFilter: 'blur(24px)',
          background: theme.palette?.glass || 'rgba(34, 25, 84, 0.92)',
          zIndex: theme.zIndex.drawer + 1,
          borderBottom: '1.5px solid rgba(255,255,255,0.10)',
        }}
      >
        <Toolbar>
          {!mdUp && (
            <IconButton onClick={() => setDrawerOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}

          <Typography variant="h6" fontWeight={700} mr={2} letterSpacing={1}>
            FreightConnect
          </Typography>

          <Box sx={{ flex: 1 }} />

          <IconButton onClick={e => setAnchorEl(e.currentTarget)} sx={{ ml: 1 }}>
            {/* Optional: Add user avatar or icon here if needed */}
            <ChevronRightIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Profile/Logout Menu (optional, can remove if not needed) */}
      <Menu
        anchorEl={anchorEl}
        open={profMenuOpen}
        onClose={() => setAnchorEl(null)}
        PaperProps={{
          sx: {
            backdropFilter: 'blur(12px)',
            background: theme.palette?.glass || 'rgba(34, 25, 84, 0.96)',
            color: "#fff",
          }
        }}
      >
        <MenuItem onClick={() => { navigate('/dashboard/shipper/profile'); setAnchorEl(null); }}>
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
            background: theme.palette?.glass || 'rgba(34, 25, 84, 0.92)',
            borderRight: 'none',
            pt: 8,
          },
        }}
      >
        {mdUp && (
          <IconButton onClick={() => setCollapsed(!collapsed)} sx={{ ml: collapsed ? 0.5 : 1.5, mb: 1 }}>
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        )}
        <SideNav
          current={currentSection}
          collapsed={collapsed && mdUp}
          onSelect={key => {
            if (key === 'loads') navigate('/dashboard/shipper/loads');
            else if (key === 'post-load') navigate('/dashboard/shipper/post-load');
            else if (key === 'documents') navigate('/dashboard/shipper/documents');
            else if (key === 'profile') navigate('/dashboard/shipper/profile');
            if (!mdUp) setDrawerOpen(false);
          }}
        />
      </Drawer>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flex: 1,
          pt: 11,
          ml: { md: `${drawerW}px` },
          px: { xs: 2, md: 4 },
          background: 'none',
        }}
      >
        <Outlet />
      </Box>
    </Box>
  );
}
