import React from 'react';
import { useNavigate } from 'react-router-dom';

function Navbar() {
  const navigate = useNavigate();
  const token = localStorage.getItem('token'); // Check if token exists

  const handleLogout = () => {
    localStorage.removeItem('token'); // Clear the token
    navigate('/'); // Redirect to login page
  };

  return (
    <nav>
      <h1>FreightConnect</h1>
      <ul>
        {token ? (
          <>
            <li>
              <a href="/dashboard">Dashboard</a>
            </li>
            <li>
              <a href="/profile">Profile</a>
            </li>
            <li>
              <button onClick={handleLogout}>Logout</button>
            </li>
          </>
        ) : (
          <>
            <li>
              <a href="/">Login</a>
            </li>
            <li>
              <a href="/signup">Signup</a>
            </li>
          </>
        )}
      </ul>
    </nav>
  );
}

export default Navbar;
