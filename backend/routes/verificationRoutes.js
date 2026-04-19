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

// ========================================================================
//  SHIPPER VERIFICATION — Multi-step process
//
//  Step 1: Email domain check (auto on first call)
//  Step 2: Add payment method (Stripe customer + card/bank)
//  Step 3: Submit EIN + business details
//  Step 4: Upload supporting documents (optional, boosts trust)
//  Step 5: Admin review → verified status
//
//  Until Step 2 complete: shipper CANNOT post loads.
// ========================================================================

const shipperVerifService = require('../services/shipperVerificationService');

// GET /api/verification/shipper/status — full verification status + level
router.get('/shipper/status', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') {
      return res.status(403).json({ error: 'Only shippers' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const assessment = shipperVerifService.assessVerificationLevel(user);
    res.json({
      ...assessment,
      shipperVerification: {
        status: user.shipperVerification?.status || 'unverified',
        emailDomain: user.shipperVerification?.emailDomain,
        isFreeEmail: user.shipperVerification?.isFreeEmail,
        paymentMethodVerified: user.shipperVerification?.paymentMethodVerified || false,
        paymentMethodLast4: user.shipperVerification?.paymentMethodLast4,
        einVerified: user.shipperVerification?.einVerified || false,
        ein: user.shipperVerification?.ein,
        businessName: user.shipperVerification?.businessName,
        businessType: user.shipperVerification?.businessType,
        documentsOnFile: user.shipperVerification?.documentsOnFile || [],
      },
    });
  } catch (err) {
    console.error('Shipper verification status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/verification/shipper/email-check — Step 1: auto email domain check
router.post('/shipper/email-check', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Only shippers' });
    const result = await shipperVerifService.runEmailDomainCheck(req.user.userId);
    res.json({
      message: result.isFreeEmail
        ? 'Free email detected. Using a business email increases trust with carriers.'
        : 'Business email domain verified.',
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check email domain' });
  }
});

// POST /api/verification/shipper/ein — Step 3: submit EIN + business details
router.post(
  '/shipper/ein',
  auth,
  [
    body('ein').trim().notEmpty().withMessage('EIN is required'),
    body('businessName').optional().trim(),
    body('stateOfIncorporation').optional().trim(),
    body('businessType').optional().isIn(['llc', 'corporation', 'sole_proprietor', 'partnership', 'other']),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Only shippers' });

      const { ein, businessName, stateOfIncorporation, businessType } = req.body;
      const result = await shipperVerifService.submitEIN(
        req.user.userId, ein, businessName, stateOfIncorporation, businessType
      );

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({ message: 'EIN validated and business identity recorded.', maskedEIN: result.masked });
    } catch (err) {
      console.error('EIN submission error:', err);
      res.status(500).json({ error: 'Failed to submit EIN' });
    }
  }
);

// POST /api/verification/shipper/payment-method — Step 2: record payment method
router.post('/shipper/payment-method', auth, async (req, res) => {
  try {
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Only shippers' });

    const { stripeCustomerId, last4, type } = req.body;
    if (!stripeCustomerId || !last4) {
      return res.status(400).json({ error: 'stripeCustomerId and last4 are required' });
    }

    const result = await shipperVerifService.recordPaymentMethod(
      req.user.userId, stripeCustomerId, last4, type || 'card'
    );

    res.json({ message: 'Payment method verified. You can now post loads.', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record payment method' });
  }
});

// POST /api/verification/shipper/documents — Step 4: upload business documents
router.post('/shipper/documents', auth, docUpload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'shipper') return res.status(403).json({ error: 'Only shippers' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { docType } = req.body;
    const allowed = ['business_license', 'tax_certificate', 'insurance_coi', 'bank_letter'];
    if (!allowed.includes(docType)) {
      return res.status(400).json({ error: `Invalid document type. Allowed: ${allowed.join(', ')}` });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.shipperVerification) user.shipperVerification = {};
    if (!user.shipperVerification.documentsOnFile) user.shipperVerification.documentsOnFile = [];

    // Replace existing doc of same type
    user.shipperVerification.documentsOnFile = user.shipperVerification.documentsOnFile.filter(
      d => d.docType !== docType
    );
    user.shipperVerification.documentsOnFile.push({
      docType,
      filename: req.file.filename,
      uploadedAt: new Date(),
      verified: false,
    });

    await user.save();
    res.json({ message: 'Document uploaded', docType, filename: req.file.filename });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// PUT /api/verification/shipper/admin-review/:userId — Admin verifies/rejects shipper
router.put('/shipper/admin-review/:userId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { action, note } = req.body; // action: 'verify' | 'reject'
    if (!['verify', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be verify or reject' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role !== 'shipper') return res.status(400).json({ error: 'User is not a shipper' });

    if (!user.shipperVerification) user.shipperVerification = {};

    if (action === 'verify') {
      user.shipperVerification.status = 'verified';
      user.shipperVerification.verifiedAt = new Date();
      user.shipperVerification.verifiedBy = req.user.userId;
      user.shipperVerification.firstLoadEscrowRequired = false; // trusted shipper
    } else {
      user.shipperVerification.status = 'rejected';
      user.shipperVerification.rejectedAt = new Date();
      user.shipperVerification.rejectionNote = note || '';
    }

    await user.save();

    const { notifyUserSafe } = require('../utils/notifyUser');
    notifyUserSafe(user._id, {
      type: action === 'verify' ? 'shipper_verified' : 'shipper_rejected',
      title: action === 'verify' ? 'Account Verified' : 'Verification Rejected',
      body: action === 'verify'
        ? 'Your shipper account has been verified. Full platform access is now available.'
        : `Your verification was rejected: ${note || 'Contact support for details.'}`,
      link: '/dashboard/shipper/profile',
    });

    res.json({ message: `Shipper ${action === 'verify' ? 'verified' : 'rejected'}`, userId: user._id });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

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

// ── Admin: verify/reject a specific document (carrier or shipper) ────────────
router.put('/admin/document-review/:userId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { docType, action } = req.body; // action: 'verify' | 'reject'
    if (!['verify', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be verify or reject' });
    }

    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Check carrier docs
    let found = false;
    if (user.verification?.documentsOnFile) {
      const doc = user.verification.documentsOnFile.find(d => d.docType === docType);
      if (doc) {
        doc.verified = action === 'verify';
        found = true;
      }
    }

    // Check shipper docs
    if (!found && user.shipperVerification?.documentsOnFile) {
      const doc = user.shipperVerification.documentsOnFile.find(d => d.docType === docType);
      if (doc) {
        doc.verified = action === 'verify';
        found = true;
      }
    }

    if (!found) return res.status(404).json({ error: `Document type "${docType}" not found on file` });

    await user.save();

    const { notifyUserSafe } = require('../utils/notifyUser');
    notifyUserSafe(user._id, {
      type: action === 'verify' ? 'document_verified' : 'document_rejected',
      title: action === 'verify' ? 'Document Verified' : 'Document Rejected',
      body: `Your ${docType.replace(/_/g, ' ')} has been ${action === 'verify' ? 'verified' : 'rejected'} by admin.`,
      link: user.role === 'carrier' ? '/dashboard/carrier/verification' : '/dashboard/shipper/verification',
    });

    res.json({ message: `Document ${docType} ${action === 'verify' ? 'verified' : 'rejected'}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: list all pending verifications (both roles) ──────────────────────
router.get('/admin/pending', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { role } = req.query;
    const filter = {};

    if (role === 'carrier') {
      filter['verification.status'] = 'pending';
    } else if (role === 'shipper') {
      filter['shipperVerification.status'] = 'pending';
    } else {
      filter.$or = [
        { 'verification.status': 'pending' },
        { 'shipperVerification.status': 'pending' },
      ];
    }

    const users = await User.find(filter)
      .select('name email role companyName verification.status verification.documentsOnFile shipperVerification createdAt')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
