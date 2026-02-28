import React from 'react';
import { Navigate } from 'react-router-dom';

/** Requires a valid auth token. Redirects to / if not logged in. */
function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/" replace />;
}

/**
 * Requires a valid token AND a specific role.
 * Carriers hitting a shipper route (or vice versa) are redirected to their own dashboard.
 *
 * Usage: <RoleRoute role="shipper">...</RoleRoute>
 */
export function RoleRoute({ children, role }) {
  const token = localStorage.getItem('token');
  const userRole = localStorage.getItem('role');

  if (!token) return <Navigate to="/" replace />;
  if (userRole !== role) {
    // Redirect to the user's correct dashboard instead of showing a blank/error page
    const dashboardMap = { carrier: '/dashboard/carrier', admin: '/dashboard/admin' };
    return <Navigate to={dashboardMap[userRole] || '/'} replace />;
  }
  return children;
}

export default PrivateRoute;
