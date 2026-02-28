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

const errorHandler = require('./middlewares/errorHandler');

// ── Startup validation ────────────────────────────────────────────────────────
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// CORS — single configuration driven by environment variable
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

// HTTP request logging (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Middleware
// Capture raw body for Stripe webhook signature verification
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl.startsWith('/api/payments/webhook')) {
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

// File upload route
app.post('/api/documents/upload', upload.single('file'), (req, res) => {
  res.json({ message: 'File uploaded successfully', filePath: req.file.path });
});

// Static uploads serving
app.use('/documents/uploads', express.static(path.join(__dirname, 'public/documents/uploads')));

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

// User Routes
const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

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
  socket.on('updateCarrierLocation', async ({ loadId, latitude, longitude }) => {
    try {
      const Load = require('./models/Load');
      await Load.findByIdAndUpdate(loadId, { carrierLocation: { latitude, longitude } });
      io.emit(`carrierLocationUpdate-${loadId}`, { latitude, longitude });
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
app.get('/api/get-route', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Missing start or end location' });

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

// ── 404 handler for unknown API routes ───────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

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
    require('./jobs/contractAutoPost').start();
    require('./jobs/contractMonitor').start();
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
