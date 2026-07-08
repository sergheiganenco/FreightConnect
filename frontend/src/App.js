import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import Navbar from './components/Navbar';
import Footer from './components/FooterFull';
import OfflineDetector from './components/OfflineDetector';
import ChatProvider from './components/chat/ChatProvider';
import ErrorBoundary from './components/ErrorBoundary';
import TosGuardProvider from './components/TosGuardProvider';
import NotFound from './pages/NotFound';
import PrivateRoute, { RoleRoute } from './components/PrivateRoute';

/* marketing + auth pages (eager — first paint, no auth gate) */
import Home from './pages/Home';
import About from './pages/About';
import Features from './pages/Features';
import Contact from './pages/Contact';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';

/* dashboard + admin pages (lazy — split into their own chunks, loaded on demand) */
const AIInsightsPanel = lazy(() => import('./components/AIInsightsPanel'));
const CarrierScorecard = lazy(() => import('./components/CarrierScorecard'));
const ChatPage = lazy(() => import('./components/chat/ChatPage'));
const ShipperDashboard = lazy(() => import('./pages/shipper/ShipperDashboard'));
const ShipperPostLoad = lazy(() => import('./pages/shipper/ShipperPostLoad'));
const ShipperDocuments = lazy(() => import('./pages/shipper/ShipperDocuments'));
const ShipperLoadBoardSection = lazy(() => import('./features/shipperDashboard/sections/ShipperLoadBoardSection'));
const ShipperProfile = lazy(() => import('./pages/shipper/ShipperProfile'));
const CarrierDashboard = lazy(() => import('./pages/carrier/CarrierDashboard'));
const CarrierMyLoads = lazy(() => import('./pages/carrier/CarrierMyLoads'));
const Profile = lazy(() => import('./pages/carrier/CarrierProfile'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminProfile = lazy(() => import('./pages/admin/AdminProfile'));
const DocumentsSection = lazy(() => import('./features/carrierDashboard/sections/DocumentsSection'));
const CarrierLoadBoardSection = lazy(() => import('./features/carrierDashboard/sections/CarrierLoadBoardSection'));
const CarrierFleet = lazy(() => import('./pages/carrier/CarrierFleet'));
const CarrierDrivers = lazy(() => import('./pages/carrier/CarrierDrivers'));
const CarrierTeam = lazy(() => import('./pages/carrier/CarrierTeam'));
const CarrierFleetHOS = lazy(() => import('./pages/carrier/CarrierFleetHOS'));
const CarrierLiveMap = lazy(() => import('./pages/carrier/CarrierLiveMap'));
const FleetMap = lazy(() => import('./pages/FleetMap'));
const CarrierAnalytics = lazy(() => import('./pages/carrier/CarrierAnalytics'));
const CarrierVerification = lazy(() => import('./pages/carrier/CarrierVerification'));
const CarrierPayments = lazy(() => import('./pages/carrier/CarrierPayments'));
const CarrierNetwork = lazy(() => import('./pages/carrier/CarrierNetwork'));
const ShipperAnalytics = lazy(() => import('./pages/shipper/ShipperAnalytics'));
const ShipperPayments = lazy(() => import('./pages/shipper/ShipperPayments'));
const ShipperContracts = lazy(() => import('./pages/shipper/ShipperContracts'));
const CarrierContracts = lazy(() => import('./pages/carrier/CarrierContracts'));
const ShipperAppointments = lazy(() => import('./pages/shipper/ShipperAppointments'));
const CarrierAppointments = lazy(() => import('./pages/carrier/CarrierAppointments'));
const CarrierTripPlanning = lazy(() => import('./pages/carrier/CarrierTripPlanning'));
const CarrierELD = lazy(() => import('./pages/carrier/CarrierELD'));
const CarrierFactoring = lazy(() => import('./pages/carrier/CarrierFactoring'));
const CarrierTax = lazy(() => import('./pages/carrier/CarrierTax'));
const CarrierExpenses = lazy(() => import('./pages/carrier/CarrierExpenses'));
const ShipperEDI = lazy(() => import('./pages/shipper/ShipperEDI'));
const ShipperTax = lazy(() => import('./pages/shipper/ShipperTax'));
const ShipperVerification = lazy(() => import('./pages/shipper/ShipperVerification'));
const ShipperTeam = lazy(() => import('./pages/shipper/ShipperTeam'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview'));
const AdminLoads = lazy(() => import('./pages/admin/AdminLoads'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminCompanies = lazy(() => import('./pages/admin/AdminCompanies'));
const AdminExceptions = lazy(() => import('./pages/admin/AdminExceptions'));
const AdminVerifications = lazy(() => import('./pages/admin/AdminVerifications'));
const AdminLedger = lazy(() => import('./pages/admin/AdminLedger'));
const AdminReviewQueue = lazy(() => import('./pages/admin/AdminReviewQueue'));
const AdminFactoring = lazy(() => import('./pages/admin/AdminFactoring'));
const ShipperClaims = lazy(() => import('./pages/shipper/ShipperClaims'));
const CarrierClaims = lazy(() => import('./pages/carrier/CarrierClaims'));
const AdminClaims = lazy(() => import('./pages/admin/AdminClaims'));
const CarrierSettlements = lazy(() => import('./pages/carrier/CarrierSettlements'));
const CarrierIFTA = lazy(() => import('./pages/carrier/CarrierIFTA'));

// Fallback shown while a lazy route chunk loads.
function RouteFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <CircularProgress />
    </Box>
  );
}

// Wrapper so CarrierVerification gets an onComplete handler
function CarrierVerificationPage() {
  const navigate = useNavigate();
  return <CarrierVerification onComplete={() => navigate('/dashboard/carrier/loads')} />;
}

// The marketing Navbar/Footer must NOT render inside the authenticated dashboards
// — those have their own fixed AppBar. Rendering both stacked a second
// (absolute-positioned) top bar that scrolled away and dropped the marketing
// footer under the app. Gate the chrome off for /dashboard routes.
function MarketingChrome({ children }) {
  const { pathname } = useLocation();
  if (pathname.startsWith('/dashboard')) return null;
  return children;
}

function App() {
  return (
    <Router>
      <MarketingChrome><Navbar /></MarketingChrome>
      <OfflineDetector />
      <Box component="main" id="main-content">
        <Suspense fallback={<RouteFallback />}>
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
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          {/* Forced first-login / self-service password change (token required) */}
          <Route path="/change-password" element={<PrivateRoute><ChangePassword /></PrivateRoute>} />

          {/* Protected Shipper Dashboards */}
          <Route path="/dashboard/shipper" element={<RoleRoute role="shipper"><ChatProvider><ShipperDashboard /></ChatProvider></RoleRoute>}>
            <Route path="loads" element={<ShipperLoadBoardSection />} />
            <Route path="post-load" element={<ShipperPostLoad />} />
            <Route path="documents" element={<ShipperDocuments />} />
            <Route path="analytics" element={<ShipperAnalytics />} />
            <Route path="payments" element={<ShipperPayments />} />
            <Route path="contracts" element={<ShipperContracts />} />
            <Route path="appointments" element={<ShipperAppointments />} />
            <Route path="tax" element={<ShipperTax />} />
            <Route path="edi" element={<ShipperEDI />} />
            <Route path="team" element={<ShipperTeam />} />
            <Route path="claims" element={<ShipperClaims />} />
            <Route path="verification" element={<ShipperVerification />} />
            <Route path="ai-insights" element={<AIInsightsPanel />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="profile" element={<ShipperProfile />} />
            <Route index element={<ShipperLoadBoardSection />} />
          </Route>

          {/* Carrier Dashboard */}
          <Route path="/dashboard/carrier/*" element={<RoleRoute role="carrier"><ChatProvider><CarrierDashboard /></ChatProvider></RoleRoute>}>
            <Route index element={<Navigate to="loads" replace />} />
            <Route path="loads" element={<CarrierLoadBoardSection />} />
            <Route path="documents" element={<DocumentsSection />} />
            <Route path="my-loads" element={<CarrierMyLoads embedded />} />
            <Route path="fleet" element={<CarrierFleet />} />
            <Route path="fleet-hos" element={<CarrierFleetHOS />} />
            <Route path="drivers" element={<CarrierDrivers />} />
            <Route path="team" element={<CarrierTeam />} />
            <Route path="live-map" element={<CarrierLiveMap />} />
            <Route path="fleet-map" element={<FleetMap />} />
            <Route path="analytics" element={<CarrierAnalytics />} />
            <Route path="payments" element={<CarrierPayments />} />
            <Route path="contracts" element={<CarrierContracts />} />
            <Route path="appointments" element={<CarrierAppointments />} />
            <Route path="trips" element={<CarrierTripPlanning />} />
            <Route path="eld" element={<CarrierELD />} />
            <Route path="expenses" element={<CarrierExpenses />} />
            <Route path="factoring" element={<CarrierFactoring />} />
            <Route path="tax" element={<CarrierTax />} />
            <Route path="settlements" element={<CarrierSettlements />} />
            <Route path="ifta" element={<CarrierIFTA />} />
            <Route path="claims" element={<CarrierClaims />} />
            <Route path="network" element={<CarrierNetwork />} />
            <Route path="ai-insights" element={<AIInsightsPanel />} />
            <Route path="scorecard" element={<CarrierScorecard />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="profile" element={<Profile />} />
            <Route path="verification" element={<CarrierVerificationPage />} />
          </Route>

          {/* Enhanced Admin Dashboard */}
          <Route path="/dashboard/admin/*" element={<RoleRoute role="admin"><AdminDashboard /></RoleRoute>}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<AdminOverview />} />
            <Route path="loads" element={<AdminLoads />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="companies" element={<AdminCompanies />} />
            <Route path="verifications" element={<AdminVerifications />} />
            <Route path="exceptions" element={<AdminExceptions />} />
            <Route path="ledger" element={<AdminLedger />} />
            <Route path="review-queue" element={<AdminReviewQueue />} />
            <Route path="factoring" element={<AdminFactoring />} />
            <Route path="claims" element={<AdminClaims />} />
            <Route path="profile" element={<AdminProfile />} />
          </Route>

          {/* 404 -- catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </Box>
      <MarketingChrome><Footer /></MarketingChrome>
    </Router>
  );
}

function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <TosGuardProvider>
        <App />
      </TosGuardProvider>
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;
