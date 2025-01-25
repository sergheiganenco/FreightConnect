import React from 'react';
import CarrierDashboard from './CarrierDashboard';
import ShipperDashboard from './ShipperDashboard';

function Dashboard() {
  const user = JSON.parse(localStorage.getItem('user')); // Retrieve user details

  if (!user || !user.role) {
    return <p>Error: User role not found</p>; // Handle missing user/role
  }

  console.log('User role:', user.role); // Debugging log

  return (
    <div>
      <h1>Welcome to the Dashboard!</h1>
      {user.role === 'carrier' ? <CarrierDashboard /> : <ShipperDashboard />}
    </div>
  );
}

export default Dashboard;
