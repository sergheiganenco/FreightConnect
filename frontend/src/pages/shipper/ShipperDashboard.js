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
  Dialog,
  Button,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';

import SideNav from '../../features/shipperDashboard/sections/components/SideNav';
import NotificationBell from '../../features/shared/NotificationBell';
import { disconnectSocket } from '../../services/socket';
import { brand, surface, gradient } from '../../theme/tokens';
import VerificationBanner from '../../components/VerificationBanner';
import OnboardingWizard from '../../components/OnboardingWizard';
import api from '../../services/api';

// Utility to highlight nav based on route:
const sectionFromPath = (pathname) => {
  if (pathname.includes('/post-load')) return 'post-load';
  if (pathname.includes('/contracts')) return 'contracts';
  if (pathname.includes('/appointments')) return 'appointments';
  if (pathname.includes('/documents')) return 'documents';
  if (pathname.includes('/analytics')) return 'analytics';
  if (pathname.includes('/payments')) return 'payments';
  if (pathname.includes('/ai-insights')) return 'ai-insights';
  if (pathname.includes('/tax')) return 'tax';
  if (pathname.includes('/edi')) return 'edi';
  if (pathname.includes('/claims')) return 'claims';
  if (pathname.includes('/team')) return 'team';
  if (pathname.includes('/verification')) return 'verification';
  if (pathname.includes('/chat')) return 'chat';
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

  // First-run onboarding wizard
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    let active = true;
    api.get('/users/me')
      .then(({ data }) => {
        if (active && data && data.onboardingComplete !== true) {
          setShowOnboarding(true);
        }
      })
      .catch(() => { /* non-blocking: never trap the user */ });
    return () => { active = false; };
  }, []);

  const finishOnboarding = async () => {
    try {
      await api.put('/users/me/onboarding-complete');
    } catch (_) { /* ignore — close regardless so the user is never trapped */ }
    setShowOnboarding(false);
  };

  const fullW = 240;
  const miniW = 72;
  const drawerW = collapsed && mdUp ? miniW : fullW;

  useEffect(() => {
    setDrawerOpen(mdUp);
    if (!mdUp) setCollapsed(false);
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
          : gradient.dashboardBg,
      }}
    >
      {/* AppBar */}
      <AppBar
        elevation={0}
        sx={{
          backdropFilter: 'blur(24px)',
          background: theme.palette?.glass || surface.appBar,
          zIndex: theme.zIndex.drawer + 1,
          borderBottom: `1.5px solid ${surface.glassBorder}`,
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

          <Chip
            size="small"
            label="SHIPPER"
            sx={{
              mr: 'auto',
              bgcolor: `${brand.indigo}e0`,
              color: '#fff',
              fontWeight: 700,
              letterSpacing: 1,
            }}
          />

          <NotificationBell />
          <IconButton onClick={e => setAnchorEl(e.currentTarget)}>
            <AccountCircleIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Profile/Logout Menu */}
      <Menu
        anchorEl={anchorEl}
        open={profMenuOpen}
        onClose={() => setAnchorEl(null)}
        PaperProps={{
          sx: {
            backdropFilter: 'blur(12px)',
            background: theme.palette?.glass || surface.appBar,
            color: '#fff',
          }
        }}
      >
        <MenuItem onClick={() => { navigate('/dashboard/shipper/profile'); setAnchorEl(null); }}>
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
            background: theme.palette?.glass || surface.appBar,
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
            else if (key === 'contracts') navigate('/dashboard/shipper/contracts');
            else if (key === 'appointments') navigate('/dashboard/shipper/appointments');
            else if (key === 'documents') navigate('/dashboard/shipper/documents');
            else if (key === 'analytics') navigate('/dashboard/shipper/analytics');
            else if (key === 'payments') navigate('/dashboard/shipper/payments');
            else if (key === 'ai-insights') navigate('/dashboard/shipper/ai-insights');
            else if (key === 'tax') navigate('/dashboard/shipper/tax');
            else if (key === 'edi') navigate('/dashboard/shipper/edi');
            else if (key === 'claims') navigate('/dashboard/shipper/claims');
            else if (key === 'team') navigate('/dashboard/shipper/team');
            else if (key === 'verification') navigate('/dashboard/shipper/verification');
            else if (key === 'chat') navigate('/dashboard/shipper/chat');
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
        <VerificationBanner role="shipper" />
        <Outlet />
      </Box>

      {/* First-run onboarding wizard (skippable, persisted server-side) */}
      <Dialog
        fullScreen
        open={showOnboarding}
        aria-labelledby="shipper-onboarding"
      >
        <Box sx={{ position: 'relative' }}>
          <Button
            onClick={finishOnboarding}
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              zIndex: 2,
              color: '#fff',
            }}
          >
            Skip for now
          </Button>
          <OnboardingWizard role="shipper" onComplete={finishOnboarding} />
        </Box>
      </Dialog>
    </Box>
  );
}
