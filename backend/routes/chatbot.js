// routes/chatbot.js
const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Load = require('../models/Load');

router.post('/voice-command', auth, async (req, res) => {
  const { command } = req.body;

  if (command.toLowerCase().includes("recommend")) {
    try {
      const activeLoad = await Load.findOne({
        acceptedBy: req.user.userId,
        status: { $in: ["accepted", "in-transit"] }
      });

      if (!activeLoad) {
        return res.json({ message: "You have no active loads. Please accept a load first." });
      }

      const recommendedLoads = await Load.find({
        origin: activeLoad.destination,
        status: "open"
      });

      if (recommendedLoads.length === 0) {
        return res.json({ message: "No recommended loads found near your destination." });
      }

      return res.json({
        message: `I found ${recommendedLoads.length} recommended loads near your destination.`,
        loads: recommendedLoads
      });

    } catch (error) {
      console.error("Error fetching recommended loads:", error);
      return res.status(500).json({ message: "An error occurred while fetching recommended loads." });
    }
  } else {
    res.json({ message: "Sorry, I didn't understand your command." });
  }
});

module.exports = router;
