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

// Middleware
app.use(cors());
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
