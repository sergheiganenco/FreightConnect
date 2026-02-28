const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { body } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const User = require('../models/User');
const fmcsaService = require('../services/fmcsaService');
const trustScoreService = require('../services/trustScoreService');

// Multer for verification document uploads
const docStorage = multer.diskStorage({
  destination: path.join(__dirname, '../public/documents/uploads'),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF and image files are allowed'));
  },
});

// ----------------------------------------
// POST /api/verification/carrier/start
// Submit MC/DOT number — trigger FMCSA lookup
// ----------------------------------------
router.post(
  '/carrier/start',
  auth,
  [
    body('mcNumber').optional().trim().notEmpty(),
    body('dotNumber').optional().trim().notEmpty(),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'carrier') {
        return res.status(403).json({ error: 'Only carriers can start carrier verification' });
      }

      const { mcNumber, dotNumber } = req.body;
      if (!mcNumber && !dotNumber) {
        return res.status(400).json({ error: 'Provide at least one of: mcNumber, dotNumber' });
      }

      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (!user.verification) user.verification = {};
      user.verification.status = 'pending';
      await user.save();

      // Run FMCSA lookup asynchronously — respond immediately with pending
      fmcsaService.runFullVerification(user, mcNumber, dotNumber).catch((err) =>
        console.error('Async FMCSA error:', err.message)
      );

      res.json({
        message: 'Verification started. Results will appear within a few seconds.',
        status: 'pending',
      });
    } catch (err) {
      console.error('Carrier verification start error:', err);
      res.status(500).json({ error: 'Failed to start verification' });
    }
  }
);

// ----------------------------------------
// GET /api/verification/carrier/status
// Get current verification status for the authenticated user
// ----------------------------------------
router.get('/carrier/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      'verification.status verification.fmcsaData verification.insurance verification.documentsOnFile verification.verifiedAt'
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user.verification || { status: 'unverified' });
  } catch (err) {
    console.error('Get verification status error:', err);
    res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});

// ----------------------------------------
// POST /api/verification/carrier/documents
// Upload a verification document (W-9, COI, etc.)
// ----------------------------------------
router.post('/carrier/documents', auth, docUpload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can upload verification documents' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { docType, expiresAt } = req.body;
    const allowedTypes = ['w9', 'coi', 'authority_letter', 'equipment_list', 'business_license'];
    if (!allowedTypes.includes(docType)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.verification) user.verification = { status: 'unverified', documentsOnFile: [] };
    if (!user.verification.documentsOnFile) user.verification.documentsOnFile = [];

    // Remove existing doc of same type
    user.verification.documentsOnFile = user.verification.documentsOnFile.filter(
      (d) => d.docType !== docType
    );

    user.verification.documentsOnFile.push({
      docType,
      filename: req.file.filename,
      uploadedAt: new Date(),
      verified: false,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    });

    await user.save();
    res.json({ message: 'Document uploaded successfully', docType, filename: req.file.filename });
  } catch (err) {
    console.error('Document upload error:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// ----------------------------------------
// GET /api/verification/trust-score
// Get own trust score with breakdown
// ----------------------------------------
router.get('/trust-score', auth, async (req, res) => {
  try {
    const breakdown = await trustScoreService.getScoreBreakdown(req.user.userId);
    res.json(breakdown);
  } catch (err) {
    console.error('Get trust score error:', err);
    res.status(500).json({ error: 'Failed to fetch trust score' });
  }
});

// ----------------------------------------
// GET /api/verification/trust-score/:userId
// Get another user's public trust score
// ----------------------------------------
router.get('/trust-score/:userId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      'name role trustScore verification.status createdAt'
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ts = user.trustScore || {};
    res.json({
      name: user.name,
      role: user.role,
      score: ts.score ?? 50,
      onTimeRate: ts.onTimeRate ?? 100,
      totalLoadsCompleted: ts.totalLoadsCompleted ?? 0,
      verificationStatus: user.verification?.status || 'unverified',
      memberSince: user.createdAt,
    });
  } catch (err) {
    console.error('Get public trust score error:', err);
    res.status(500).json({ error: 'Failed to fetch trust score' });
  }
});

// ----------------------------------------
// POST /api/verification/shipper/start
// Submit shipper business details
// ----------------------------------------
router.post(
  '/shipper/start',
  auth,
  [body('dunsNumber').optional().trim()],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'shipper') {
        return res.status(403).json({ error: 'Only shippers can use this route' });
      }
      const { dunsNumber } = req.body;
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (!user.shipperVerification) user.shipperVerification = {};
      if (dunsNumber) user.shipperVerification.dunsNumber = dunsNumber;
      user.shipperVerification.businessVerified = true; // Simplified: flag as verified
      await user.save();

      res.json({ message: 'Shipper verification submitted', shipperVerification: user.shipperVerification });
    } catch (err) {
      console.error('Shipper verification error:', err);
      res.status(500).json({ error: 'Failed to submit shipper verification' });
    }
  }
);

// ----------------------------------------
// PUT /api/verification/admin/override/:userId
// Admin manually sets verification status
// ----------------------------------------
router.put('/admin/override/:userId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { status } = req.body;
    const allowed = ['unverified', 'pending', 'verified', 'suspended', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.verification) user.verification = {};
    user.verification.status = status;
    if (status === 'verified') user.verification.verifiedAt = new Date();
    await user.save();

    res.json({ message: `Verification status set to ${status}`, userId: user._id, status });
  } catch (err) {
    console.error('Admin override error:', err);
    res.status(500).json({ error: 'Failed to override verification' });
  }
});

module.exports = router;
