import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/** Requires a valid auth token. Redirects to /login (remembering the path) if not logged in. */
function PrivateRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}

/**
 * Requires a valid token AND a specific role.
 * Carriers hitting a shipper route (or vice versa) are redirected to their own dashboard.
 *
 * Usage: <RoleRoute role="shipper">...</RoleRoute>
 */
export function RoleRoute({ children, role }) {
  const location = useLocation();
  const token = localStorage.getItem('token');
  const userRole = localStorage.getItem('role');

  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // Admin-created accounts must set their own password before using the app.
  if (localStorage.getItem('mustChangePassword') === '1') {
    return <Navigate to="/change-password" replace />;
  }
  if (userRole !== role) {
    // Redirect to the user's correct dashboard instead of showing a blank/error page
    const dashboardMap = { carrier: '/dashboard/carrier', shipper: '/dashboard/shipper', admin: '/dashboard/admin' };
    return <Navigate to={dashboardMap[userRole] || '/'} replace />;
  }
  return children;
}

export default PrivateRoute;
