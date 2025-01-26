import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, unstable_HistoryRouter as HistoryRouter } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ShipperDashboard from './pages/ShipperDashboard';
import CarrierDashboard from './pages/CarrierDashboard';
import Profile from './pages/Profile';
import PrivateRoute from './components/PrivateRoute';

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Navbar />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/dashboard/shipper"
          element={<PrivateRoute><ShipperDashboard /></PrivateRoute>}
        />
        <Route
          path="/dashboard/carrier"
          element={<PrivateRoute><CarrierDashboard /></PrivateRoute>}
        />
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
        {/* Catch-all route to handle unmatched URLs */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <Footer />
    </Router>
  );
}

export default App;
