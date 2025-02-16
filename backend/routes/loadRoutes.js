module.exports = (io) => {
  const express = require('express');
  const router = express.Router();
  const auth = require('../middlewares/authMiddleware');
  const Load = require('../models/Load');
  const axios = require('axios');
  require('dotenv').config(); // Load environment variables

 // GET /api/loads (Return all loads, including accepted ones)
 router.get('/', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Access denied: Only carriers can view loads' });
    }

    // Fetch only open loads + loads accepted by this carrier
    const loads = await Load.find({
      $or: [
        { status: 'open' }, 
        { acceptedBy: req.user.userId } // Only loads accepted by this carrier
      ]
    });

    res.json(loads);
  } catch (err) {
    console.error('Error fetching loads:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/loads/accepted (Paginated)
router.get('/accepted', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Access denied: Only carriers can view accepted loads' });
    }

    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const acceptedLoads = await Load.find({ acceptedBy: req.user.userId })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Load.countDocuments({ acceptedBy: req.user.userId });

    res.json({
      loads: acceptedLoads,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
    });
  } catch (err) {
    console.error('Error fetching accepted loads:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


  // GET /api/loads/posted
  router.get('/posted', auth, async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Access denied: Only shippers can view their posted loads' });
      }
  
      const { status, sortBy, sortOrder } = req.query;
  
      let filters = { postedBy: req.user.userId };
      if (status) filters.status = status;
  
      const sortOptions = {};
      if (sortBy) sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
  
      const loads = await Load.find(filters).sort(sortOptions);
      res.json(loads);
    } catch (err) {
      console.error('Error fetching posted loads:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });
  

  // POST /api/loads
  router.post('/', auth, async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Access denied: Only shippers can post loads' });
      }
      const { title, origin, destination, rate, equipmentType } = req.body;

      const load = new Load({
        title,
        origin,
        destination,
        rate,
        equipmentType,
        status: 'open',
        postedBy: req.user.userId,
      });

      await load.save();
      io.emit('newLoadPosted', load);
      res.status(201).json({ message: 'Load posted successfully', load });
    } catch (err) {
      console.error('Error posting load:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  router.put('/:id/accept', auth, async (req, res) => {
    try {
      if (req.user.role !== 'carrier') {
        return res.status(403).json({ error: 'Access denied: Only carriers can accept loads' });
      }
  
      const loadId = req.params.id;
      const load = await Load.findById(loadId);
  
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }
  
      if (load.status !== 'open') {
        return res.status(400).json({ error: 'Only open loads can be accepted' });
      }
  
      load.status = 'accepted';
      load.acceptedBy = req.user.userId;
  
      await load.save();
  
      res.json({ message: 'Load accepted', load });
    } catch (err) {
      console.error('Error accepting load:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });
  
// GET /api/loads/accepted - Fetch loads accepted by the logged-in carrier
router.get('/accepted', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Access denied: Only carriers can view accepted loads' });
    }
    
    // Fetch loads where acceptedBy is the logged-in carrier
    const acceptedLoads = await Load.find({ acceptedBy: req.user.userId });
    res.json(acceptedLoads);
  } catch (err) {
    console.error('Error fetching accepted loads:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/loads/my-loads - Fetch loads accepted by the carrier
router.get('/my-loads', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Access denied: Only carriers can view this data' });
    }

    // Fetch loads where the current carrier is the acceptedBy user
    const loads = await Load.find({ acceptedBy: req.user.userId });

    res.json(loads);
  } catch (err) {
    console.error('Error fetching carrier loads:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/get-route', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Start and End locations are required' });
    }

    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API Key is missing in backend' });
    }

    const url = `https://api.openrouteservice.org/v2/directions/driving-hgv?api_key=${apiKey}&start=${start}&end=${end}`;

    console.log(`Fetching route from ${start} to ${end}`);

    const response = await axios.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching route:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch route' });
  }
});

  return router;
};
