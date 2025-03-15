require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development; restrict in production
  },
});

// Middleware
app.use(cors({
  origin: '*',
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type, Authorization',
}));
app.use(express.json());

// MongoDB Connection
mongoose.set('strictQuery', false);
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Import and use user routes
const userRoutes = require('./routes/userRoutes');
app.use('/api/users', userRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('API is running!');
});

// Import and use load routes, passing `io` for real-time notifications
const loadRoutes = require('./routes/loadRoutes');
app.use('/api/loads', (req, res, next) => {
  req.io = io; // Attach io instance to req object
  loadRoutes(io)(req, res, next);
});

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Listen for carrier location updates
  socket.on("updateCarrierLocation", async ({ loadId, latitude, longitude }) => {
    try {
      const Load = require('./models/Load');

      // Update the carrier location in the database (persistent)
      await Load.findByIdAndUpdate(loadId, {
        carrierLocation: { latitude, longitude }
      });

      // Emit real-time location update to shippers tracking this specific load
      io.emit(`carrierLocationUpdate-${loadId}`, { latitude, longitude });

      console.log(`Updated location for Load ${loadId}: [${latitude}, ${longitude}]`);
    } catch (error) {
      console.error("Error updating carrier location:", error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Proxy API for fetching route data
app.get('/api/get-route', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Missing start or end location' });
    }

    console.log(`Fetching route for: ${start} → ${end}`);

    const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${process.env.ORS_API_KEY}&start=${start}&end=${end}`;
    console.log("Requesting ORS URL:", url);

    const response = await axios.get(url);
    console.log('Route Data:', response.data);

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching route:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || 'Failed to fetch route' });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
