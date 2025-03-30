const { generateRateConfirmation } = require('../utils/pdfGenerator');
const { sendEmailWithAttachment } = require('../services/emailService');
const Load = require('../models/Load');
const User = require('../models/User');

exports.acceptLoadAndSendConfirmation = async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ message: "Load not found." });

    load.status = 'accepted';
    load.acceptedBy = req.user.id;
    await load.save();

    const carrier = await User.findById(req.user.id);

    const pdfPath = await generateRateConfirmation(load, carrier);

    sendEmailWithAttachment(carrier.email, "Rate Confirmation", pdfPath);

    res.json({ message: "Load accepted and Rate Confirmation sent." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error processing your request." });
  }
};
