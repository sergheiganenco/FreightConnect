import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'; // Import Navigate
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ShipperDashboard from './pages/ShipperDashboard';
import CarrierDashboard from './pages/CarrierDashboard';
import CarrierMyLoads from './pages/CarrierMyLoads'; // NEW PAGE
import Profile from './pages/Profile';
import PrivateRoute from './components/PrivateRoute';
import DocumentsPage from './pages/DocumentsPage';

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/dashboard/shipper" element={<PrivateRoute><ShipperDashboard /></PrivateRoute>} />
        <Route path="/dashboard/carrier" element={<PrivateRoute><CarrierDashboard /></PrivateRoute>} />
        <Route path="/my-loads" element={<PrivateRoute><CarrierMyLoads/></PrivateRoute>} /> {/* NEW ROUTE */}
        <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" />} /> {/* Ensure Navigate is imported */}
        <Route path="/documents" element={<DocumentsPage />} />
      </Routes>
      <Footer />
    </Router>
  );
}

export default App;
