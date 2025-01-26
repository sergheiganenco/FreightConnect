module.exports = (io) => {
  const express = require('express');
  const router = express.Router();
  const auth = require('../middlewares/authMiddleware');
  const Load = require('../models/Load');

  // GET /api/loads
  // Update the carrier's load-fetching route to include all loads
  router.get('/', auth, async (req, res) => {
    try {
      if (req.user.role !== 'carrier') {
        return res.status(403).json({ error: 'Access denied: Only carriers can view this data' });
      }
      const loads = await Load.find({ status: 'open' });
      res.json(loads);
    } catch (err) {
      console.error('Error fetching loads:', err);
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
  

  return router;
};
