// src/components/Navbar.js
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  Box,
  IconButton,
  Menu,
  MenuItem,
  Chip,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Divider,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { disconnectSocket } from '../services/socket';
import { text as T, surface, brand, focusRing, tint } from '../theme/tokens';

const focusVisibleSx = {
  '&:focus-visible': focusRing,
};

const NAV_LINKS = [
  { label: 'Home',     path: '/home' },
  { label: 'About',    path: '/about' },
  { label: 'Features', path: '/features' },
  { label: 'Contact',  path: '/contact' },
];

export default function Navbar() {
  const [anchorEl, setAnchorEl] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const token = localStorage.getItem('token');
  const role  = localStorage.getItem('role');     // "carrier" | "shipper" | "admin"

  const handleLogout = () => {
    disconnectSocket();
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/home');
  };

  const handleMenuOpen  = (e) => setAnchorEl(e.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);

  const isAuthPage = ['/login', '/signup'].includes(location.pathname);

  const handleProfile = () => {
    if (role === 'carrier' || role === 'shipper' || role === 'admin') {
      navigate(`/dashboard/${role}/profile`);
    } else {
      navigate('/profile');
    }
    handleMenuClose();
  };

  const handleMobileNav = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <AppBar
      position="absolute"
      elevation={0}
      sx={{
        background: surface.appBar,
        backdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${surface.glassBorder}`,
        color: T.primary,
        py: 1,
      }}
    >
      {/* Skip to content link */}
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'absolute',
          left: '-9999px',
          '&:focus': {
            left: 16,
            top: 16,
            zIndex: 9999,
            background: brand.primary,
            color: '#fff',
            px: 2,
            py: 1,
            borderRadius: 2,
            textDecoration: 'none',
          },
        }}
      >
        Skip to content
      </Box>

      <Toolbar sx={{ justifyContent: 'space-between' }}>
        {/* Branding + role badge */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography
            variant="h6"
            component="button"
            aria-label="Go to home page"
            onClick={() => navigate('/home')}
            sx={{
              fontWeight: 'bold',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              color: 'inherit',
              font: 'inherit',
              p: 0,
              ...focusVisibleSx,
            }}
          >
            FreightConnect
          </Typography>
          {token && role && (
            <Chip
              label={role.toUpperCase()}
              size="small"
              variant="outlined"
              sx={{
                ml: 1,
                color: T.primary,
                borderColor: T.strong,
              }}
            />
          )}
        </Box>

        {token ? (
          /* ── Authenticated: profile menu ── */
          <Box>
            <IconButton
              color="inherit"
              onClick={handleMenuOpen}
              aria-label="Account settings"
              sx={focusVisibleSx}
            >
              <AccountCircleIcon />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{
                paper: {
                  sx: {
                    background: surface.appBar,
                    backdropFilter: 'blur(16px)',
                    border: `1px solid ${surface.glassBorder}`,
                    color: T.primary,
                  },
                },
              }}
            >
              <MenuItem onClick={handleProfile} sx={focusVisibleSx}>
                Profile
              </MenuItem>
              <MenuItem
                onClick={() => {
                  handleLogout();
                  handleMenuClose();
                }}
                sx={focusVisibleSx}
              >
                Logout
              </MenuItem>
            </Menu>
          </Box>
        ) : (
          !isAuthPage && (
            <>
              {/* ── Desktop nav links ── */}
              <Box
                sx={{
                  display: { xs: 'none', md: 'flex' },
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                {NAV_LINKS.map(({ label, path }) => (
                  <Button
                    key={path}
                    onClick={() => navigate(path)}
                    color="inherit"
                    sx={{
                      color: T.primary,
                      ...focusVisibleSx,
                    }}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  onClick={() => navigate('/login')}
                  color="inherit"
                  sx={{
                    color: T.primary,
                    ...focusVisibleSx,
                  }}
                >
                  Login
                </Button>
                <Button
                  onClick={() => navigate('/signup')}
                  sx={{
                    backgroundColor: surface.glassBadge,
                    color: T.primary,
                    px: 2,
                    borderRadius: '12px',
                    fontWeight: 600,
                    '&:hover': { backgroundColor: tint('#ffffff', 0.25) },
                    ...focusVisibleSx,
                  }}
                >
                  Sign Up
                </Button>
              </Box>

              {/* ── Mobile hamburger button ── */}
              <IconButton
                color="inherit"
                aria-label="Open navigation menu"
                onClick={() => setMobileOpen(true)}
                sx={{
                  display: { xs: 'flex', md: 'none' },
                  ...focusVisibleSx,
                }}
              >
                <MenuIcon />
              </IconButton>

              {/* ── Mobile drawer ── */}
              <Drawer
                anchor="right"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                PaperProps={{
                  sx: {
                    width: 260,
                    background: surface.appBar,
                    backdropFilter: 'blur(16px)',
                    color: T.primary,
                    borderLeft: `1px solid ${surface.glassBorder}`,
                  },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    p: 1,
                  }}
                >
                  <IconButton
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close navigation menu"
                    sx={{ color: T.primary, ...focusVisibleSx }}
                  >
                    <CloseIcon />
                  </IconButton>
                </Box>
                <Divider sx={{ borderColor: surface.glassBorder }} />
                <List>
                  {NAV_LINKS.map(({ label, path }) => (
                    <ListItemButton
                      key={path}
                      onClick={() => handleMobileNav(path)}
                      sx={{
                        color: T.primary,
                        '&:hover': { backgroundColor: surface.glassHover },
                        ...focusVisibleSx,
                      }}
                    >
                      <ListItemText primary={label} />
                    </ListItemButton>
                  ))}
                  <Divider sx={{ borderColor: surface.glassBorder, my: 1 }} />
                  <ListItemButton
                    onClick={() => handleMobileNav('/login')}
                    sx={{
                      color: T.primary,
                      '&:hover': { backgroundColor: surface.glassHover },
                      ...focusVisibleSx,
                    }}
                  >
                    <ListItemText primary="Login" />
                  </ListItemButton>
                  <ListItemButton
                    onClick={() => handleMobileNav('/signup')}
                    sx={{
                      color: T.primary,
                      '&:hover': { backgroundColor: surface.glassHover },
                      ...focusVisibleSx,
                    }}
                  >
                    <ListItemText
                      primary="Sign Up"
                      primaryTypographyProps={{ fontWeight: 600 }}
                    />
                  </ListItemButton>
                </List>
              </Drawer>
            </>
          )
        )}
      </Toolbar>
    </AppBar>
  );
}
