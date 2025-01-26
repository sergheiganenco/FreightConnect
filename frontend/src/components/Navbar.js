import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Box, Button } from '@mui/material';

function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();

  // Retrieve token and role from localStorage
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  // Determine if we're on the Login or Signup pages
  const isLoginOrSignup = location.pathname === '/' || location.pathname === '/signup';

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    navigate('/');
  };

  // Clicking the brand name
  const handleBrandClick = () => {
    if (token) {
      // Navigate to the appropriate dashboard based on role
      if (role === 'carrier') {
        navigate('/dashboard/carrier');
      } else {
        navigate('/dashboard/shipper');
      }
    } else {
      // If not logged in, go to login
      navigate('/');
    }
  };

  return (
    <AppBar position="static" sx={{ mb: 2 }}>
      <Toolbar>
        {/* Brand */}
        <Typography
          variant="h6"
          sx={{ flexGrow: 1, cursor: 'pointer' }}
          onClick={handleBrandClick}
        >
          FreightConnect
        </Typography>

        {/* Hide nav buttons if on Login or Signup */}
        {!isLoginOrSignup && (
          <>
            {token ? (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button color="inherit" onClick={() => navigate('/profile')}>
                  Profile
                </Button>
                <Button
                  color="secondary"
                  variant="contained"
                  onClick={handleLogout}
                >
                  Logout
                </Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button color="inherit" onClick={() => navigate('/')}>
                  Login
                </Button>
                <Button color="inherit" onClick={() => navigate('/signup')}>
                  Sign Up
                </Button>
              </Box>
            )}
          </>
        )}
      </Toolbar>
    </AppBar>
  );
}

export default Navbar;
