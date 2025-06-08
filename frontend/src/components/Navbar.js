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
  Chip
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';

export default function Navbar() {
  const [anchorEl, setAnchorEl] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  const token = localStorage.getItem('token');
  const role  = localStorage.getItem('role');     // "carrier" | "shipper" | "admin"

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/home');
  };

  const handleMenuOpen  = (e) => setAnchorEl(e.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);

  const isAuthPage = ['/login','/signup'].includes(location.pathname);

  // Correct profile route for all roles, fallback if role is missing
  const handleProfile = () => {
    if (role === "carrier" || role === "shipper" || role === "admin") {
      navigate(`/dashboard/${role}/profile`);
    } else {
      navigate('/profile'); // fallback for unexpected cases
    }
    handleMenuClose();
  };

  return (
    <AppBar
      position="absolute"
      elevation={0}
      sx={{
        background: 'transparent',
        color: 'white',
        py: 2
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        {/* Branding + role badge */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 'bold', cursor: 'pointer' }}
            onClick={() => navigate('/home')}
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
                color: 'white',
                borderColor: 'rgba(255,255,255,0.7)'
              }}
            />
          )}
        </Box>

        {token ? (
          <Box>
            <IconButton color="inherit" onClick={handleMenuOpen}>
              <AccountCircleIcon />
            </IconButton>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleMenuClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top',    horizontal: 'right' }}
            >
              <MenuItem onClick={handleProfile}>Profile</MenuItem>
              {/* For admin: add future admin-only links here */}
              <MenuItem
                onClick={() => {
                  handleLogout();
                  handleMenuClose();
                }}
              >
                Logout
              </MenuItem>
            </Menu>
          </Box>
        ) : (
          !isAuthPage && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Button onClick={() => navigate('/home')}     color="inherit">Home</Button>
              <Button onClick={() => navigate('/about')}    color="inherit">About</Button>
              <Button onClick={() => navigate('/features')} color="inherit">Features</Button>
              <Button onClick={() => navigate('/contact')}  color="inherit">Contact</Button>
              <Button onClick={() => navigate('/login')}    color="inherit">Login</Button>
              <Button
                onClick={() => navigate('/signup')}
                sx={{
                  backgroundColor: '#ffffff22',
                  color: 'white',
                  px: 2,
                  borderRadius: '12px',
                  fontWeight: 600,
                  '&:hover': { backgroundColor: '#ffffff44' },
                }}
              >
                Sign Up
              </Button>
            </Box>
          )
        )}
      </Toolbar>
    </AppBar>
  );
}
