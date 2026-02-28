import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ChatProvider from './components/chat/ChatProvider';
import ChatPage from './components/chat/ChatPage';
import ErrorBoundary from './components/ErrorBoundary';
import NotFound from './pages/NotFound';

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
import CarrierDashboard from './pages/carrier/CarrierDashboard';
import CarrierMyLoads from './pages/carrier/CarrierMyLoads';
import Profile from './pages/carrier/CarrierProfile';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminProfile from './pages/admin/AdminProfile';
import DocumentsSection from './features/carrierDashboard/sections/DocumentsSection';
import CarrierLoadBoardSection from './features/carrierDashboard/sections/CarrierLoadBoardSection';
import CarrierFleet from './pages/carrier/CarrierFleet';
import PrivateRoute from './components/PrivateRoute';
import CarrierLiveMap from './pages/carrier/CarrierLiveMap';
import FleetMap from './pages/FleetMap';
import CarrierAnalytics from './pages/carrier/CarrierAnalytics';
import CarrierVerification from './pages/carrier/CarrierVerification';
import CarrierPayments from './pages/carrier/CarrierPayments';
import CarrierNetwork from './pages/carrier/CarrierNetwork';
import ShipperAnalytics from './pages/shipper/ShipperAnalytics';
import ShipperPayments from './pages/shipper/ShipperPayments';
import ShipperContracts from './pages/shipper/ShipperContracts';
import CarrierContracts from './pages/carrier/CarrierContracts';
import ShipperAppointments from './pages/shipper/ShipperAppointments';
import CarrierAppointments from './pages/carrier/CarrierAppointments';
import CarrierTripPlanning from './pages/carrier/CarrierTripPlanning';
import CarrierELD from './pages/carrier/CarrierELD';
import CarrierFactoring from './pages/carrier/CarrierFactoring';
import CarrierTax from './pages/carrier/CarrierTax';
import ShipperEDI from './pages/shipper/ShipperEDI';
import ShipperTax from './pages/shipper/ShipperTax';

// --- Real Admin Pages ---
import AdminOverview from './pages/admin/AdminOverview';
import AdminLoads from './pages/admin/AdminLoads';
import AdminUsers from './pages/admin/AdminUsers';
import AdminCompanies from './pages/admin/AdminCompanies';
import AdminExceptions from './pages/admin/AdminExceptions';

// Wrapper so CarrierVerification gets an onComplete handler
function CarrierVerificationPage() {
  const navigate = useNavigate();
  return <CarrierVerification onComplete={() => navigate('/dashboard/carrier/loads')} />;
}

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
        <Route path="/dashboard/shipper" element={<PrivateRoute><ChatProvider><ShipperDashboard /></ChatProvider></PrivateRoute>}>
          <Route path="loads" element={<ShipperLoadBoardSection />} />
          <Route path="post-load" element={<ShipperPostLoad />} />
          <Route path="documents" element={<ShipperDocuments />} />
          <Route path="analytics" element={<ShipperAnalytics />} />
          <Route path="payments" element={<ShipperPayments />} />
          <Route path="contracts" element={<ShipperContracts />} />
          <Route path="appointments" element={<ShipperAppointments />} />
          <Route path="tax" element={<ShipperTax />} />
          <Route path="edi" element={<ShipperEDI />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="profile" element={<ShipperProfile />} />
          <Route index element={<ShipperLoadBoardSection />} />
        </Route>

        {/* Carrier Dashboard */}
        <Route path="/dashboard/carrier/*" element={<PrivateRoute><ChatProvider><CarrierDashboard /></ChatProvider></PrivateRoute>}>
          <Route index element={<Navigate to="loads" replace />} />
          <Route path="loads" element={<CarrierLoadBoardSection />} />
          <Route path="documents" element={<DocumentsSection />} />
          <Route path="my-loads" element={<CarrierMyLoads embedded />} />
          <Route path="fleet" element={<CarrierFleet />} />
          <Route path="live-map" element={<CarrierLiveMap />} />
          <Route path="fleet-map" element={<FleetMap />} />
          <Route path="analytics" element={<CarrierAnalytics />} />
          <Route path="payments" element={<CarrierPayments />} />
          <Route path="contracts" element={<CarrierContracts />} />
          <Route path="appointments" element={<CarrierAppointments />} />
          <Route path="trips" element={<CarrierTripPlanning />} />
          <Route path="eld" element={<CarrierELD />} />
          <Route path="factoring" element={<CarrierFactoring />} />
          <Route path="tax" element={<CarrierTax />} />
          <Route path="network" element={<CarrierNetwork />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="profile" element={<Profile />} />
          <Route path="verification" element={<CarrierVerificationPage />} />
        </Route>

        {/* Enhanced Admin Dashboard */}
        <Route path="/dashboard/admin/*" element={<PrivateRoute><AdminDashboard /></PrivateRoute>}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<AdminOverview />} />
          <Route path="loads" element={<AdminLoads />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="companies" element={<AdminCompanies />} />
          <Route path="exceptions" element={<AdminExceptions />} />
          <Route path="profile" element={<AdminProfile />} />
        </Route>

        {/* 404 — catch-all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </Router>
  );
}

function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;
