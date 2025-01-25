module.exports = (io) => {
  const express = require('express');
  const router = express.Router();
  const auth = require('../middlewares/authMiddleware');
  const Load = require('../models/Load');

  // GET /api/loads
  router.get('/', auth, async (req, res) => {
    try {
      const loads = await Load.find();
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
      const loads = await Load.find({ postedBy: req.user.userId });
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

  return router;
};
