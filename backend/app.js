require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http'); // Required for integrating with Socket.IO
const { Server } = require('socket.io'); // Import Socket.IO

const app = express();
const server = http.createServer(app); // Create an HTTP server for Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development; restrict in production
  },
});

const axios = require('axios');

const ORS_API_KEY = process.env.ORS_API_KEY; // Store your OpenRouteService API Key in .env


// Middleware
app.use(cors({
  origin: '*', 
  methods: 'GET,POST,PUT,DELETE',
  allowedHeaders: 'Content-Type, Authorization'
}));
app.use(express.json());

// MongoDB Connection
mongoose.set('strictQuery', false);
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Import user routes
const userRoutes = require('./routes/userRoutes');

// Use the user routes with a prefix
app.use('/api/users', userRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('API is running!');
});

// Import and use load routes, passing `io` for real-time notifications
const loadRoutes = require('./routes/loadRoutes');
app.use('/api/loads', loadRoutes(io)); // Pass the `io` instance to load routes

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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
    console.log("Requesting ORS URL:", url); // Log URL before making the request

    const response = await axios.get(url);
    console.log('Route Data:', response.data);

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching route:', error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || 'Failed to fetch route' });
  }
});
