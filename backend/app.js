require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const PDFDocument = require('pdfkit');

const app = express();
const server = http.createServer(app);

// Socket.IO Configuration
const io = new Server(server, { cors: { origin: '*' } });


app.use(cors({
  origin: 'http://localhost:3000', // or '*' for dev, but restrict in prod
  credentials: true,
}));

const { setIO } = require('./utils/socket');
setIO(io);

// Middleware
app.use(cors({ origin: '*', methods: 'GET,POST,PUT,DELETE', allowedHeaders: 'Content-Type, Authorization' }));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Verify uploads directory exists
const uploadPath = path.join(__dirname, 'public', 'documents', 'uploads');
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: uploadPath, // will be 'public/documents/uploads'
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// File upload route
app.post('/api/documents/upload', upload.single('file'), (req, res) => {
  res.json({ message: 'File uploaded successfully', filePath: req.file.path });
});

app.use((req, res, next) => {
  console.log('Received headers:', req.headers);  // explicitly log all headers
  next();
});

// Static uploads serving
app.use('/documents/uploads', express.static(path.join(__dirname, 'public/documents/uploads')));



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

// Root Route
app.get('/', (req, res) => res.send('API is running!'));

// Socket.IO connection logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('updateCarrierLocation', async ({ loadId, latitude, longitude }) => {
    try {
      const Load = require('./models/Load');
      await Load.findByIdAndUpdate(loadId, { carrierLocation: { latitude, longitude } });
      io.emit(`carrierLocationUpdate-${loadId}`, { latitude, longitude });
      console.log(`Updated location for Load ${loadId}: [${latitude}, ${longitude}]`);
    } catch (error) {
      console.error('Error updating carrier location:', error);
    }
  });

  socket.on('disconnect', () => console.log(`User disconnected: ${socket.id}`));
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
// Route for Fleet Analytics
const fleetAnalyticsRoutes = require('./routes/fleetAnalyticsRoutes');
app.use('/api/fleet/analytics', fleetAnalyticsRoutes);


// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
