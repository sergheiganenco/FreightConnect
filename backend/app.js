require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const helmet = require('helmet');

const compression = require('compression');
const errorHandler = require('./middlewares/errorHandler');
const { apiLimiter } = require('./middlewares/rateLimiter');
const auth = require('./middlewares/authMiddleware');
const { sanitizeInput } = require('./middlewares/sanitize');
const { requestId } = require('./middlewares/requestId');
const { apiKeyAuth } = require('./middlewares/apiKeyAuth');

// ── Sentry error tracking (guarded — optional dep + env-gated) ─────────────────
let Sentry = null;
if (process.env.SENTRY_DSN) {
  try { Sentry = require('@sentry/node'); Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || 'development', tracesSampleRate: 0.1 }); console.log('[Startup] Sentry error tracking enabled'); }
  catch (e) { console.warn('[Startup] Sentry requested but @sentry/node not installed'); }
}

// ── Startup validation ────────────────────────────────────────────────────────
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error('[Startup] JWT_SECRET is too weak (<32 chars). Use a 64+ char random string.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}

// Warn about optional keys that degrade specific features
const OPTIONAL_ENV = {
  ORS_API_KEY: 'Route visualization & ETA calculation',
  STRIPE_SECRET_KEY: 'Payment processing (escrow, payouts)',
  STRIPE_WEBHOOK_SECRET: 'Payment webhook verification',
  FMCSA_API_KEY: 'Carrier FMCSA verification',
  EMAIL_USER: 'Email notifications & verification',
  EMAIL_PASS: 'Email notifications & verification',
};
const missingOptional = Object.entries(OPTIONAL_ENV).filter(([k]) => !process.env[k]);
if (missingOptional.length) {
  console.warn(`[Startup] Optional env vars not set (features degraded):`);
  missingOptional.forEach(([k, desc]) => console.warn(`  - ${k}: ${desc}`));
}

const app = express();
const server = http.createServer(app);

// ── Production configuration ─────────────────────────────────────────────────
// Trust proxy, HTTPS redirect, compression, static frontend serving
if (process.env.NODE_ENV === 'production') {
  require('./config/production')(app);
}

// Security headers
app.use(helmet());

// CORS — single configuration driven by environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
}));

// Socket.IO — same CORS policy
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const { setIO } = require('./utils/socket');
setIO(io);

// ── Socket.IO Redis adapter (guarded — optional deps + env-gated) ──────────────
// Enables multi-instance / horizontal scaling so socket events fan out across nodes.
if (process.env.REDIS_URL) {
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => { io.adapter(createAdapter(pubClient, subClient)); console.log('[Startup] Socket.IO Redis adapter enabled (multi-instance ready)'); })
      .catch(e => console.warn('[Startup] Redis adapter failed:', e.message));
  } catch (e) { console.warn('[Startup] Redis adapter requested but packages not installed'); }
}

// HTTP request logging (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Middleware
// Capture raw body for Stripe webhook signature verification
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    // Both Stripe and ELD provider webhooks need the raw body for HMAC signature verification.
    if (
      req.originalUrl.startsWith('/api/payments/webhook') ||
      req.originalUrl.startsWith('/api/eld-integration/webhook')
    ) {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Verify uploads directory exists
const uploadPath = path.join(__dirname, 'public', 'documents', 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: uploadPath, // will be 'public/documents/uploads'
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB cap

// ── Security middleware ──────────────────────────────────────────────────────
app.use(requestId);       // Attach unique request ID for tracing
app.use(sanitizeInput);   // Strip NoSQL injection operators from all inputs
app.use(apiKeyAuth);      // API key auth (falls through to JWT if no key)

// Apply rate limiter to all API routes
app.use('/api/', apiLimiter);

// ToS guard — block users who haven't accepted current Terms of Service
const tosGuard = require('./middlewares/tosGuard');
app.use('/api/', tosGuard);

// File upload route — requires auth
app.post('/api/documents/upload', auth, upload.single('file'), (req, res) => {
  res.json({ message: 'File uploaded successfully', filePath: req.file.path });
});

// Static uploads serving. nosniff everywhere; dispute evidence is served as an
// attachment (never rendered/executed inline) with a locked-down CSP — defense
// in depth against stored XSS from uploaded files.
const nosniff = (res) => res.setHeader('X-Content-Type-Options', 'nosniff');
app.use('/documents/uploads', express.static(path.join(__dirname, 'public/documents/uploads'), { setHeaders: nosniff }));
app.use('/documents/receipts', express.static(path.join(__dirname, 'public/documents/receipts'), { setHeaders: nosniff }));
app.use('/documents/evidence', express.static(path.join(__dirname, 'public/documents/evidence'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  },
}));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  // 0=disconnected 1=connected 2=connecting 3=disconnecting
  const dbStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || 'unknown';
  res.json({
    status: dbState === 1 ? 'ok' : 'degraded',
    db: dbStatus,
    uptime: Math.floor(process.uptime()),
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Root Route
app.get('/', (req, res) => res.send('FreightConnect API is running!'));

// ToS Routes
const tosRoutes = require('./routes/tosRoutes');
app.use('/api/tos', tosRoutes);

// User Routes
const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

// Driver Routes (fleet driver roster + compliance alerts)
const driverRoutes = require('./routes/driverRoutes');
app.use('/api/drivers', driverRoutes);

// Factoring NOA Routes (UCC §9-406 payment redirection — admin verify/release)
const factoringAssignmentRoutes = require('./routes/factoringAssignmentRoutes');
app.use('/api/factoring-assignments', factoringAssignmentRoutes);

// Load Routes
const loadRoutes = require('./routes/loadRoutes')(io); // call with io ONCE
app.use('/api/loads', loadRoutes); // use as router middleware

// Document Routes
const documentRoutes = require('./routes/documentRoutes');
app.use('/api/documents', documentRoutes);

// Chatbot Routes
const chatbotRoutes = require('./routes/chatbot');
app.use('/api/chatbot', chatbotRoutes);

// Socket.IO — authenticate every connection via JWT
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.userRole = decoded.role;
    next();
  } catch {
    next(new Error('Authentication error'));
  }
});

// Socket.IO connection logic
io.on('connection', (socket) => {
  // Auto-join personal room for targeted notifications (load match alerts, etc.)
  socket.join(`user_${socket.userId}`);

  // ── Carrier location tracking ──────────────────────────────────
  socket.on('updateCarrierLocation', async ({ loadId, latitude, longitude, speed, heading, accuracy, source }) => {
    try {
      // Delegate to the unified tracking service: it updates Load.carrierLocation,
      // appends a TrackingEvent breadcrumb, runs the geofence/dwell check, and emits
      // 'carrierLocationUpdate' to the shipper + carrier personal rooms.
      const trackingService = require('./services/trackingService');
      await trackingService.recordLocation({
        loadId,
        latitude,
        longitude,
        speed,
        heading,
        accuracy,
        source: source || 'browser',
      });
    } catch (error) {
      console.error('Error updating carrier location:', error);
    }
  });

  // ── Chat: join / leave channel rooms ───────────────────────────
  socket.on('joinChannel', ({ channelId }) => {
    if (channelId) socket.join(channelId);
  });

  socket.on('leaveChannel', ({ channelId }) => {
    if (channelId) socket.leave(channelId);
  });

  // ── Chat: typing indicators ─────────────────────────────────────
  socket.on('typing', ({ channelId }) => {
    socket.to(channelId).emit('userTyping', {
      channelId,
      userId: socket.userId,
    });
  });

  socket.on('stopTyping', ({ channelId }) => {
    socket.to(channelId).emit('userStoppedTyping', {
      channelId,
      userId: socket.userId,
    });
  });

  // ── Chat: read receipts ─────────────────────────────────────────
  socket.on('markRead', ({ channelId }) => {
    socket.to(channelId).emit('readReceipt', {
      channelId,
      userId: socket.userId,
      readAt: new Date(),
    });
  });

  socket.on('disconnect', () => {});
});

// Route Proxy for fetching external routes
app.get('/api/get-route', auth, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Missing start or end location' });

    if (!process.env.ORS_API_KEY) {
      return res.status(503).json({
        error: 'Route service not configured (ORS_API_KEY missing)',
        fallback: true,
        message: 'Route visualization unavailable. Load details and acceptance still work.',
      });
    }

    const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${process.env.ORS_API_KEY}&start=${start}&end=${end}`;
    const response = await axios.get(url);

    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.response?.data || 'Failed to fetch route' });
  }
});

// Route for Carrier Analytics
const carrierAnalyticsRoutes = require('./routes/carrierAnalyticsRoutes');
app.use('/api/carrier/analytics', carrierAnalyticsRoutes);

// Route for Shipper Analytics
const shipperAnalyticsRoutes = require('./routes/shipperAnalyticsRoutes');
app.use('/api/shipper/analytics', shipperAnalyticsRoutes);

// Route for Admin
const adminRoutes = require('./routes/adminRoutes');
app.use('/api/admin', adminRoutes);

// Route for Admin Companies
const adminFleetRoutes = require('./routes/adminFleetRoutes');
app.use('/api/admin', adminFleetRoutes);

// Chat Routes
const chatRoutes = require('./routes/chatRoutes');
app.use('/api/chat', chatRoutes);

// Verification Routes
const verificationRoutes = require('./routes/verificationRoutes');
app.use('/api/verification', verificationRoutes);

// Bid Routes
const bidRoutes = require('./routes/bidRoutes');
app.use('/api/bids', bidRoutes);

// Payment Routes (includes Stripe Connect + webhook)
const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payments', paymentRoutes);

// Exception Routes
const exceptionRoutes = require('./routes/exceptionRoutes');
app.use('/api/exceptions', exceptionRoutes);

// Notification Routes
const notificationRoutes = require('./routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

// Carrier Network Routes
const capacityRoutes = require('./routes/capacityRoutes');
app.use('/api/capacity', capacityRoutes);

const partnershipRoutes = require('./routes/partnershipRoutes');
app.use('/api/partnerships', partnershipRoutes);

// Contract Routes
const contractRoutes = require('./routes/contractRoutes');
app.use('/api/contracts', contractRoutes);

// Appointment Routes
const appointmentRoutes = require('./routes/appointmentRoutes');
app.use('/api/appointments', appointmentRoutes);

// Trip Routes
const tripRoutes = require('./routes/tripRoutes');
app.use('/api/trips', tripRoutes);

// ELD Routes
const eldRoutes = require('./routes/eldRoutes');
app.use('/api/eld', eldRoutes);

// ELD Integration Routes (provider webhooks + connection management)
const eldIntegrationRoutes = require('./routes/eldIntegrationRoutes');
app.use('/api/eld-integration', eldIntegrationRoutes);

// Reefer Temperature Routes
const reeferRoutes = require('./routes/reeferRoutes');
app.use('/api/reefer', reeferRoutes);

// Factoring Routes
const factoringRoutes = require('./routes/factoringRoutes');
app.use('/api/factoring', factoringRoutes);

// EDI Routes
const ediRoutes = require('./routes/ediRoutes');
app.use('/api/edi', ediRoutes);

// Tax & Compliance Routes
const taxRoutes = require('./routes/taxRoutes');
app.use('/api/tax', taxRoutes);

// Expense Tracking Routes
const expenseRoutes = require('./routes/expenseRoutes');
app.use('/api/expenses', expenseRoutes);

// Free third-party tracker ingest (OwnTracks / Traccar) — mount BEFORE /api/tracking
// so the deeper /ingest/* paths resolve before trackingRoutes' /:loadId.
const trackingIngestRoutes = require('./routes/trackingIngestRoutes');
app.use('/api/tracking/ingest', trackingIngestRoutes);

const trackingRoutes = require('./routes/trackingRoutes');
app.use('/api/tracking', trackingRoutes);

// Enterprise API Routes (API keys, webhooks, bulk operations, market data)
const enterpriseRoutes = require('./routes/enterpriseRoutes');
app.use('/api/enterprise', enterpriseRoutes);

const ratingRoutes = require('./routes/ratingRoutes');
app.use('/api/ratings', ratingRoutes);

// Preferred Carrier Routes
const preferredCarrierRoutes = require('./routes/preferredCarrierRoutes');
app.use('/api/preferred-carriers', preferredCarrierRoutes);

// Detention & Dwell Time Routes
const detentionRoutes = require('./routes/detentionRoutes');
app.use('/api/detention', detentionRoutes);

// Reputation & Trust Badge Routes
const reputationRoutes = require('./routes/reputationRoutes');
app.use('/api/reputation', reputationRoutes);

// Return Load Suggestions Routes
const returnLoadRoutes = require('./routes/returnLoadRoutes');
app.use('/api/return-loads', returnLoadRoutes);

// Public Tracking Portal Routes
const trackingPortalRoutes = require('./routes/trackingPortalRoutes');
app.use('/api/tracking-portal', trackingPortalRoutes);

// QuickPay Routes
const quickPayRoutes = require('./routes/quickPayRoutes');
app.use('/api/quickpay', quickPayRoutes);

// AI Agent Routes
const aiRoutes = require('./routes/aiRoutes');
app.use('/api/ai', aiRoutes);

// Fraud Detection Routes (admin)
const fraudRoutes = require('./routes/fraudRoutes');
app.use('/api/fraud', fraudRoutes);

// Ledger Routes (double-entry accounting)
app.use('/api/ledger', require('./routes/ledgerRoutes'));

// Review Queue Routes (manual review / moderation)
app.use('/api/review-queue', require('./routes/reviewQueueRoutes'));

// ── Client-side routing catch-all (production only) ─────────────────────────
// Serves index.html for any non-API route so React Router handles navigation.
// Must be AFTER all /api routes and BEFORE the 404 handler.
if (process.env.NODE_ENV === 'production') {
  const fs = require('fs');
  const buildPath = path.resolve(__dirname, 'frontend-build');
  const fallbackPath = path.resolve(__dirname, '..', 'frontend', 'build');
  const staticPath = fs.existsSync(buildPath) ? buildPath : fallbackPath;
  const indexPath = path.join(staticPath, 'index.html');

  if (fs.existsSync(indexPath)) {
    app.get('*', (req, res) => {
      res.sendFile(indexPath);
    });
  }
}

// ── 404 handler for unknown API routes ───────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// ── Sentry error capture (guarded — only active if Sentry initialized) ────────
app.use((err, req, res, next) => { if (Sentry) Sentry.captureException(err); next(err); });

// ── Global error handler (must be last middleware) ────────────────────────────
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[Server] FreightConnect API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  // Start background jobs (skip in test environment)
  if (process.env.NODE_ENV !== 'test') {
    require('./jobs/insuranceMonitor').start();
    require('./jobs/overdueLoadMonitor').start();
    require('./jobs/escrowExpiryMonitor').start();
    require('./jobs/contractAutoPost').start();
    require('./jobs/contractMonitor').start();
    require('./jobs/loadAlertDigest').start();
    require('./jobs/invoiceEmailer').start();
    require('./jobs/fraudMonitor').start();
    require('./jobs/eldPoller').start();
    // AI Agents
    require('./agents').initializeAgents();
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`[Server] ${signal} received — shutting down gracefully`);
  server.close(async () => {
    console.log('[Server] HTTP server closed');
    try {
      await mongoose.connection.close();
      console.log('[Server] MongoDB connection closed');
    } catch (err) {
      console.error('[Server] Error closing MongoDB:', err.message);
    }
    process.exit(0);
  });

  // Force exit after 10 seconds if still hanging
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Unhandled rejection / exception logging (non-fatal in dev, fatal in prod)
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
  if (process.env.NODE_ENV === 'production') shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  shutdown('uncaughtException');
});
