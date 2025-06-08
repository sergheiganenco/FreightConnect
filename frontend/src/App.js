import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

/* marketing pages */
import Home from './pages/Home';
import About from './pages/About';
import Features from './pages/Features';
import Contact from './pages/Contact';

/* auth and dashboard pages */
import Login from './pages/Login';
import Signup from './pages/Signup';
import ShipperDashboard from './pages/shipper/ShipperDashboard';
import ShipperPostLoad from './pages/shipper/ShipperPostLoad';
import ShipperDocuments from './pages/shipper/ShipperDocuments';
import ShipperLoadBoardSection from './features/shipperDashboard/sections/ShipperLoadBoardSection';
import ShipperProfile from './pages/shipper/ShipperProfile';
import CarrierDashboard from './pages/CarrierDashboard';
import CarrierMyLoads from './pages/CarrierMyLoads';
import Profile from './pages/Profile';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminProfile from './pages/admin/AdminProfile';
import DocumentsSection from './features/carrierDashboard/sections/DocumentsSection';
import CarrierLoadBoardSection from './features/carrierDashboard/sections/CarrierLoadBoardSection';
import CarrierFleet from './pages/CarrierFleet';
import PrivateRoute from './components/PrivateRoute';
import CarrierLiveMap from './pages/CarrierLiveMap';
import FleetMap from './pages/FleetMap';
import FleetAnalytics from './pages/FleetAnalytics';

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        {/* Public Marketing Pages */}
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/features" element={<Features />} />
        <Route path="/contact" element={<Contact />} />
        
        {/* Auth Pages */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Protected Shipper Dashboards */}
        <Route path="/dashboard/shipper" element={<ShipperDashboard />}>
          <Route path="loads" element={<ShipperLoadBoardSection />} />        {/* This should show list/grid of loads */}
          <Route path="post-load" element={<ShipperPostLoad />} /> {/* This is the post form */}
          <Route path="documents" element={<ShipperDocuments />} />
          <Route path="profile" element={<ShipperProfile />} />
          <Route index element={<ShipperLoadBoardSection />} />               {/* Default page */}
        </Route>

        {/* NESTED Carrier Dashboard */}
        <Route path="/dashboard/carrier/*" element={<PrivateRoute><CarrierDashboard /></PrivateRoute>}>
          <Route index element={<Navigate to="loads" replace />} />
          <Route path="loads" element={<CarrierLoadBoardSection />} />
          <Route path="documents" element={<DocumentsSection />} />
          <Route path="my-loads" element={<CarrierMyLoads embedded />} />
          <Route path="fleet" element={<CarrierFleet />} />   
          <Route path="live-map" element={<CarrierLiveMap />} />
          <Route path="fleet-map" element={<FleetMap />} />
          <Route path="analytics" element={<FleetAnalytics />} />
          <Route path="profile" element={<Profile />} />
        </Route>

        {/* Admin Dashboard */}
        <Route path="/dashboard/admin/*" element={<PrivateRoute><AdminDashboard /></PrivateRoute>}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<div>Admin Overview (analytics, stats, etc)</div>} />
          <Route path="loads" element={<div>All Loads Management</div>} />
          <Route path="users" element={<div>User Management</div>} />
          <Route path="profile" element={<AdminProfile />} />
        </Route>

        {/* Catch-all redirects to Home */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <Footer />
    </Router>
  );
}

export default App;
