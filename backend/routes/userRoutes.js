// routes/userRoutes.js
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body } = require("express-validator");
const User = require("../models/User");
const Load = require("../models/Load");
const auth = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const { authLimiter } = require("../middlewares/rateLimiter");
const { managerOnly } = require("../middlewares/companyRoles");

const router = express.Router();
const { getIO } = require('../utils/socket');
const { notifyUserSafe } = require('../utils/notifyUser');
const multer = require('multer');
const upload = multer({ dest: 'uploads/', limits: { fileSize: 15 * 1024 * 1024 } });
const Company = require('../models/Company');
const companyNormalize = require('../utils/companyNormalize');
const { generateBOL } = require('../utils/pdfGenerator');
const crypto = require('crypto');
const { sendEmailWithAttachment, sendEmail } = require('../services/emailService');
const verificationService = require('../services/verificationService');
const mfaService = require('../services/mfaService');



// ----------------------
// 1) Signup Route

const signupValidation = [
  body("name").trim().notEmpty().withMessage("Name is required"),
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter")
    .matches(/[a-z]/).withMessage("Password must contain at least one lowercase letter")
    .matches(/[0-9]/).withMessage("Password must contain at least one number")
    .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage("Password must contain at least one special character"),
  body("role").isIn(["carrier", "shipper", "admin"]).withMessage("Role must be carrier, shipper, or admin"),
  body("companyName")
    .if(body("role").isIn(["carrier", "shipper"]))
    .trim()
    .notEmpty()
    .withMessage("Company name is required for carriers and shippers"),
];

router.post("/signup", authLimiter, signupValidation, validate, async (req, res) => {
  try {
    const { name, email, password, role, companyName, tosAccepted } = req.body;

    // 1. Input validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if ((role === "carrier" || role === "shipper") && !companyName) {
      return res.status(400).json({ error: "Company Name is required" });
    }

    // 2. Check for existing user by email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists with this email" });
    }

    // 3. Normalize company name, handle company upsert
    let company = null;
    let companyId = null;
    if ((role === "carrier" || role === "shipper") && companyName) {
      const normName = companyNormalize(companyName);
      if (!normName) return res.status(400).json({ error: "Invalid company name" });

      company = await Company.findOneAndUpdate(
        { normalized: normName },
        {
          $setOnInsert: {
            name: companyName,
            normalized: normName,
            type: role,
            status: "active"
          }
        },
        { upsert: true, new: true }
      );
      companyId = company._id;
    }

    // 4. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 5. Create and save user (linked to company if set)
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      companyName: companyName || undefined,
      companyId: companyId || undefined,
      ...(tosAccepted ? {
        tosAccepted: true,
        tosAcceptedAt: new Date(),
        tosVersion: '1.0',
        tosIpAddress: ipAddress,
      } : {}),
    });
    await newUser.save();

    // 5b. Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    newUser.emailVerificationToken = verificationToken;
    newUser.emailVerified = false;
    await newUser.save();

    // 5c. Send verification email (non-blocking)
    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${verificationToken}&email=${encodeURIComponent(email)}`;
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Verify your FreightConnect email',
        html: `<h2>Welcome to FreightConnect!</h2><p>Click the link below to verify your email:</p><p><a href="${verifyUrl}">Verify Email</a></p><p>This link expires in 24 hours.</p>`,
      });
    } catch (emailErr) {
      console.error('[Signup] Email send failed (non-fatal):', emailErr.message);
    }

    // 6. Respond
    return res.status(201).json({
      message: "User created successfully",
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        companyName: newUser.companyName,
        companyId: newUser.companyId
      }
    });
  } catch (err) {
    console.error("Error in /signup:", err);
    if (err.code === 11000) {
      return res.status(400).json({ error: "A company with this normalized name already exists." });
    }
    return res.status(500).json({ error: "Server error" });
  }
});
// ----------------------
// 1b) Email Verification
// ----------------------
router.get('/verify-email', async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) return res.status(400).json({ error: 'Missing token or email' });

    const user = await User.findOne({ email, emailVerificationToken: token });
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification link' });

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    console.error('[VerifyEmail] Error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ----------------------
// 1c) Forgot Password
// ----------------------
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      user.set('passwordResetToken', token);
      user.set('passwordResetExpires', new Date(Date.now() + 3600000)); // 1 hour
      await user.save();

      const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
      try {
        await sendEmail({
          to: email,
          subject: 'Reset your FreightConnect password',
          html: `<h2>Password Reset</h2><p>You requested a password reset. Click the link below to set a new password:</p><p><a href="${resetUrl}">Reset Password</a></p><p>This link expires in 1 hour. If you did not request this, you can safely ignore this email.</p>`,
        });
      } catch (emailErr) {
        console.error('[ForgotPassword] Email send failed (non-fatal):', emailErr.message);
      }
    }

    // Always return the same response to prevent email enumeration
    return res.json({ message: 'If an account exists, a reset link has been sent.' });
  } catch (err) {
    console.error('[ForgotPassword] Error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ----------------------
// 1d) Reset Password
// ----------------------
const resetPasswordValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character'),
];

router.post('/reset-password', authLimiter, resetPasswordValidation, validate, async (req, res) => {
  try {
    const { email, token, password } = req.body;

    const user = await User.findOne({
      email,
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.set('passwordResetToken', undefined);
    user.set('passwordResetExpires', undefined);
    await user.save();

    return res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('[ResetPassword] Error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ----------------------
// Change password (authenticated) — used for the forced first-login change and
// self-service changes. Clears mustChangePassword on success.
// ----------------------
const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
];

router.post('/change-password', auth, changePasswordValidation, validate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.userId).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Current password is incorrect' });

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from the current password' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();

    return res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[ChangePassword] Error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ----------------------
// 2) Login Route
// ----------------------
const loginValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password").notEmpty().withMessage("Password is required"),
];

router.post("/login", authLimiter, loginValidation, validate, async (req, res) => {
  const { email, password, mfaToken } = req.body;
  try {
    // Re-query mfa.secret too (select:false on both password and mfa.secret)
    const user = await User.findOne({ email }).select('+password +mfa.secret');
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Deactivated sub-accounts cannot log in.
    if (user.active === false) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your company administrator.' });
    }

    // ── MFA enforcement ──────────────────────────────────────────
    if (user.mfa && user.mfa.enabled) {
      // No code provided yet — tell the client to prompt for it (do NOT issue JWT)
      if (!mfaToken) {
        return res.status(200).json({ mfaRequired: true });
      }
      let mfaValid = false;
      try {
        mfaValid = mfaService.verifyToken(user.mfa.secret, mfaToken);
      } catch (mfaErr) {
        // MFA library unavailable — treat as a server-side failure
        console.error('[Login] MFA verification error:', mfaErr.message);
        return res.status(503).json({ error: 'MFA not available' });
      }
      if (!mfaValid) {
        return res.status(401).json({ error: 'Invalid MFA code' });
      }
    }

    const token = jwt.sign(
      {
        userId: user._id,
        role: user.role,
        companyRole: user.companyRole || 'owner',
        // The company this session acts for (owner id).
        companyOwnerId: String(user.parentAccountId || user._id),
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyRole: user.companyRole || 'owner',
        emailVerified: user.emailVerified !== false,
        mustChangePassword: user.mustChangePassword === true,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// ----------------------
// 2a) MFA — Setup / Enable / Disable
// ----------------------

// POST /api/users/mfa/setup — generate a secret (not enabled yet), return otpauthUrl + qr
router.post('/mfa/setup', auth, async (req, res) => {
  try {
    if (!mfaService.isAvailable()) {
      return res.status(503).json({ error: 'MFA not available' });
    }
    const user = await User.findById(req.user.userId).select('+mfa.secret');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { base32, otpauthUrl } = mfaService.generateSecret(user.email);
    user.mfa.secret = base32;
    user.mfa.enabled = false; // not enabled until verified
    await user.save();

    const qr = await mfaService.qrDataUrl(otpauthUrl);
    return res.json({ otpauthUrl, qr });
  } catch (err) {
    console.error('[MFA setup] Error:', err.message);
    return res.status(500).json({ error: 'Failed to set up MFA' });
  }
});

// POST /api/users/mfa/enable — verify token, then enable MFA
router.post('/mfa/enable', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'MFA token is required' });

    const user = await User.findById(req.user.userId).select('+mfa.secret');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.mfa || !user.mfa.secret) {
      return res.status(400).json({ error: 'MFA not set up. Call /mfa/setup first.' });
    }

    let valid = false;
    try {
      valid = mfaService.verifyToken(user.mfa.secret, token);
    } catch (mfaErr) {
      return res.status(503).json({ error: 'MFA not available' });
    }
    if (!valid) return res.status(400).json({ error: 'Invalid MFA code' });

    user.mfa.enabled = true;
    user.mfa.verifiedAt = new Date();
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('[MFA enable] Error:', err.message);
    return res.status(500).json({ error: 'Failed to enable MFA' });
  }
});

// POST /api/users/mfa/disable — verify token, then disable MFA + clear secret
router.post('/mfa/disable', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'MFA token is required' });

    const user = await User.findById(req.user.userId).select('+mfa.secret');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.mfa || !user.mfa.enabled || !user.mfa.secret) {
      return res.status(400).json({ error: 'MFA is not enabled' });
    }

    let valid = false;
    try {
      valid = mfaService.verifyToken(user.mfa.secret, token);
    } catch (mfaErr) {
      return res.status(503).json({ error: 'MFA not available' });
    }
    if (!valid) return res.status(400).json({ error: 'Invalid MFA code' });

    user.mfa.enabled = false;
    user.mfa.secret = null;
    user.mfa.verifiedAt = null;
    await user.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('[MFA disable] Error:', err.message);
    return res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

// ----------------------
// 2b) Refresh Token
// ----------------------
router.post('/refresh-token', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[RefreshToken] Error:', err.message);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// ----------------------
// 3) WhoAmI Route
// ----------------------
router.get("/whoami", auth, (req, res) => {
  // Returns the user object from the auth middleware
  res.json({ user: req.user });
});

// POST /api/users/push-token — register an Expo push token for this device
router.post('/push-token', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token is required' });
    await User.updateOne({ _id: req.user.userId }, { $addToSet: { pushTokens: token } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[push-token register] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/users/push-token — unregister a token (on logout)
router.delete('/push-token', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (token) await User.updateOne({ _id: req.user.userId }, { $pull: { pushTokens: token } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ----------------------
// 3b) Company team (sub-accounts): dispatchers & drivers under one company
// ----------------------

// Load the acting user and confirm they are a company OWNER (only owners manage the team).
async function requireOwner(req, res) {
  const owner = await User.findById(req.user.userId).select('companyRole companyId companyName role active');
  if (!owner) { res.status(404).json({ error: 'User not found' }); return null; }
  if (owner.companyRole !== 'owner') {
    res.status(403).json({ error: 'Only the company owner can manage team members' });
    return null;
  }
  return owner;
}

// GET /api/users/team — list the owner's sub-accounts
router.get('/team', auth, async (req, res) => {
  try {
    const owner = await requireOwner(req, res);
    if (!owner) return;
    const members = await User.find({ parentAccountId: owner._id })
      .select('name email companyRole active createdAt')
      .sort({ createdAt: -1 });
    res.json({ members });
  } catch (err) {
    console.error('[team] list failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/team — owner creates a dispatcher or driver sub-account
router.post('/team',
  auth,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('companyRole').isIn(['dispatcher', 'driver']).withMessage('companyRole must be dispatcher or driver'),
  ],
  validate,
  async (req, res) => {
    try {
      const owner = await requireOwner(req, res);
      if (!owner) return;

      const { name, email, password, companyRole } = req.body;
      const existing = await User.findOne({ email });
      if (existing) return res.status(400).json({ error: 'A user already exists with this email' });

      const hashedPassword = await bcrypt.hash(password, 10);
      const member = await User.create({
        name,
        email,
        password: hashedPassword,
        // Sub-accounts inherit the company's marketplace role + company identity.
        role: owner.role,
        companyRole,
        parentAccountId: owner._id,
        companyId: owner.companyId || undefined,
        companyName: owner.companyName || undefined,
        emailVerified: true, // provisioned by a trusted owner, not self-signup
        active: true,
      });

      res.status(201).json({
        member: {
          _id: member._id, name: member.name, email: member.email,
          companyRole: member.companyRole, active: member.active,
        },
      });
    } catch (err) {
      if (err.code === 11000) return res.status(400).json({ error: 'A user already exists with this email' });
      console.error('[team] create failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// PATCH /api/users/team/:id — owner updates a sub-account (name / active toggle)
router.patch('/team/:id', auth, async (req, res) => {
  try {
    const owner = await requireOwner(req, res);
    if (!owner) return;

    const member = await User.findById(req.params.id);
    if (!member || String(member.parentAccountId) !== String(owner._id)) {
      return res.status(404).json({ error: 'Team member not found' });
    }

    if (typeof req.body.name === 'string' && req.body.name.trim()) member.name = req.body.name.trim();
    if (typeof req.body.active === 'boolean') member.active = req.body.active;
    if (['dispatcher', 'driver'].includes(req.body.companyRole)) member.companyRole = req.body.companyRole;
    await member.save();

    // Make an active-status change take effect immediately (bypass the TTL cache),
    // so a deactivated member's existing token stops working right away.
    auth.invalidateActive(member._id);

    res.json({
      member: {
        _id: member._id, name: member.name, email: member.email,
        companyRole: member.companyRole, active: member.active,
      },
    });
  } catch (err) {
    console.error('[team] update failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ----------------------
// 4) Get User Profile
// GET user profile
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});
// PUT user profile
router.put('/me', auth, async (req, res) => {
  try {
    const { name, email, phone, companyName, mcNumber, dotNumber, type } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.name = name ?? user.name;
    user.email = email ?? user.email;
    user.phone = phone ?? user.phone;
    user.companyName = companyName ?? user.companyName;
    if (typeof mcNumber !== 'undefined') user.mcNumber = mcNumber;
    if (typeof dotNumber !== 'undefined') user.dotNumber = dotNumber;

    let company = null;
    if (companyName) {
      const norm = companyNormalize(companyName);

      // Try to find by normalized name
      company = await Company.findOne({ normalized: norm });

      if (!company) {
        // Create new company if not found
        company = await Company.create({
          name: companyName,
          normalized: norm,
          mcNumber,
          dotNumber,
          type: type || undefined,
          status: 'active'
        });
      } else if (company.name !== companyName) {
        // If name was changed but normalized matches (e.g. LLC added/removed)
        company.name = companyName;
        if (typeof mcNumber !== 'undefined') company.mcNumber = mcNumber;
        if (typeof dotNumber !== 'undefined') company.dotNumber = dotNumber;
        if (typeof type !== 'undefined') company.type = type;
        await company.save();
      }
      user.companyId = company._id;
      user.companyName = company.name;
    }

    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (err) {
    console.error("PUT /me error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

router.post('/me/upload-doc', auth, upload.single('file'), async (req, res) => {
  try {
    const docType = req.body.docType; // "insurance", "authority", "business_license", etc.
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    // Save file info to user.documents
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.documents) user.documents = {};
    user.documents[docType] = {
      url: `/uploads/${req.file.filename}`, // Or your cloud storage url
      uploaded: true,
      name: req.file.originalname
    };
    await user.save();
    res.json(user.documents[docType]);
  } catch (err) {
    console.error("Upload doc error:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

//Get Fleet (all trucks for logged-in carrier)
router.get('/fleet', auth, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers have fleets" });
    }
    // The fleet lives on the company owner; a dispatcher/driver sees the company fleet.
    const user = await User.findById(req.user.companyOwnerId || req.user.userId).select("fleet");
    if (!user) {
      return res.status(404).json({ error: "Carrier not found" });
    }
    res.json({ fleet: user.fleet });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fleet" });
  }
});

// Add a Truck to Fleet (owner/dispatcher only)
router.post('/fleet', auth, managerOnly, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can add trucks" });
    }
    const { truckId, driverName, status } = req.body;
    if (!truckId) return res.status(400).json({ error: "Truck ID is required" });

    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user) return res.status(404).json({ error: "Carrier not found" });

    // Prevent duplicate truck IDs in the fleet
    if (user.fleet.some(t => t.truckId === truckId)) {
      return res.status(409).json({ error: "Truck ID already exists in your fleet." });
    }

    const newTruck = {
      truckId,
      driverName: driverName || "",
      status: status || "Available",
      location: {},
      assignedLoadId: null
    };

    user.fleet.push(newTruck);
    await user.save();

    res.status(201).json({ message: "Truck added", fleet: user.fleet });
  } catch (err) {
    console.error("Error adding truck:", err);
    res.status(500).json({ error: "Failed to add truck" });
  }
});


//Update a Truck (by truckId) — owner/dispatcher only
router.put('/fleet/:truckId', auth, managerOnly, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can update trucks" });
    }
    const { truckId } = req.params;
    const { driverName, status, location, currentLoadId } = req.body;

    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user) return res.status(404).json({ error: "Carrier not found" });

    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found" });

    if (driverName !== undefined) truck.driverName = driverName;
    if (status !== undefined) truck.status = status;
    if (location !== undefined) truck.location = location;
    if (currentLoadId !== undefined) truck.currentLoadId = currentLoadId;

    await user.save();

    res.json({ message: "Truck updated", fleet: user.fleet });
  } catch (err) {
    res.status(500).json({ error: "Failed to update truck" });
  }
});

//Remove a Truck from Fleet — owner/dispatcher only
router.delete('/fleet/:truckId', auth, managerOnly, async (req, res) => {
  try {
    if (req.user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can remove trucks" });
    }
    const { truckId } = req.params;
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user) return res.status(404).json({ error: "Carrier not found" });

    user.fleet = user.fleet.filter(t => t.truckId !== truckId);
    await user.save();

    res.json({ message: "Truck removed", fleet: user.fleet });
  } catch (err) {
    res.status(500).json({ error: "Failed to remove truck" });
  }
});


// PUT /api/users/fleet/:truckId/assign-load
router.put('/fleet/:truckId/assign-load', auth, async (req, res) => {
  try {
    const { truckId } = req.params;
    const { loadId } = req.body;
    if (!loadId) return res.status(400).json({ error: "Missing loadId." });

    // 1. Validate carrier — the fleet + verification live on the company owner, so a
    //    dispatcher assigns from the company fleet and books as the company (user._id
    //    below is the owner, which flows into the gate and acceptedBy attribution).
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can assign loads to trucks." });
    }

    // 2. Find the truck
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found in your fleet." });

    // 3. Check if already assigned
    if (truck.assignedLoadId && truck.assignedLoadId !== loadId) {
      return res.status(409).json({ error: "Truck already has an assigned load. Unassign first." });
    }

    // 4. Validate Load
    const Load = require("../models/Load");
    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: "Load not found." });
    if (load.status !== "open") {
      return res.status(400).json({ error: "Load is not open for assignment." });
    }

    // 4b. Booking gate — assign-load BOOKS the load, so it must pass the same
    // eligibility + anti-fraud enforcement as every other booking path.
    const { evaluateBookingGate, atomicBookLoad } = require("../services/bookingGuard");
    const gate = await evaluateBookingGate({ load, carrierId: user._id, req, carrier: user });
    if (!gate.allowed) {
      return res.status(403).json({
        error: "Cannot book this load: " + gate.reasons.join("; "),
        reasons: gate.reasons,
        verificationStatus: gate.verificationStatus,
      });
    }

    // 5. Book atomically (prevents double-booking), then assign the truck.
    const booked = await atomicBookLoad({
      loadId,
      carrierId: user._id,
      gate,
      extra: { assignedTruckId: truckId },
    });
    if (!booked) {
      return res.status(409).json({ error: "Load is no longer available for booking." });
    }

    truck.assignedLoadId = loadId;
    truck.status = "In Transit";               // Automated status (could be "Assigned" if you prefer)
    truck.available = false;                   // Truck is now busy!
    truck.lastStatusUpdate = new Date();       // Track when the status changed

    await user.save();
    load.status = booked.status;
    load.acceptedBy = booked.acceptedBy;
    load.assignedTruckId = booked.assignedTruckId;

    // Notify shipper that carrier is in transit
    notifyUserSafe(load.postedBy?.toString(), {
      type: 'load:status',
      title: 'Carrier is on the way!',
      body: `"${load.title}" — ${load.origin} → ${load.destination}`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId: load._id, status: 'in-transit' },
    });

    // Post system message to load thread on dispatch
    try {
      const Channel = require("../models/Channel");
      const Message = require("../models/Message");
      const channelId = `load_${load._id}`;
      const channel = await Channel.findOne({ channelId });
      if (channel) {
        const driverInfo = truck.driverName ? ` Driver: ${truck.driverName}.` : "";
        await Message.create({
          channelType: "load_thread",
          channelId,
          sender: null,
          content: `🚚 Carrier dispatched.${driverInfo} Truck ID: ${truck.truckId}.`,
          messageType: "system",
          readBy: [],
        });
        const io = getIO();
        if (io) io.to(channelId).emit("newMessage", {
          channelId,
          content: `🚚 Carrier dispatched.${driverInfo}`,
          messageType: "system",
          createdAt: new Date(),
        });
      }
    } catch (chatErr) {
      console.error("Failed to post dispatch system message (non-fatal):", chatErr);
    }

    // 6. Enrich fleet with assigned load details for frontend
    const updatedUser = await User.findById(req.user.companyOwnerId || req.user.userId);
    const LoadModel = require("../models/Load");
    const fleetWithAssignedLoads = await Promise.all(
      updatedUser.fleet.map(async (t) => {
        let assignedLoad = null;
        if (t.assignedLoadId) {
          assignedLoad = await LoadModel.findById(t.assignedLoadId)
            .select('title origin destination status equipmentType rate');
        }
        return {
          ...t.toObject(),
          assignedLoad,
        };
      })
    );

    // 7. Emit live update (for all connected clients, you can limit to user if needed)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    // 8. Respond
    res.json({
      message: "Load assigned to truck.",
      fleet: fleetWithAssignedLoads,
      truck: {
        truckId: truck.truckId,
        driverName: truck.driverName,
        assignedLoadId: truck.assignedLoadId,
        assignedLoad: fleetWithAssignedLoads.find(f => f.truckId === truck.truckId)?.assignedLoad || null,
        status: truck.status,
        available: truck.available,
        lastStatusUpdate: truck.lastStatusUpdate,
      },
      load: {
        _id: load._id,
        title: load.title,
        status: load.status,
        acceptedBy: load.acceptedBy,
        assignedTruckId: load.assignedTruckId
      }
    });

  } catch (err) {
    console.error("Error assigning load:", err);
    res.status(500).json({ error: "Server error assigning load." });
  }
});



// PUT /api/users/fleet/:truckId/unassign-load
router.put('/fleet/:truckId/unassign-load', auth, async (req, res) => {
  try {
    const { truckId } = req.params;

    // 1. Validate carrier (company fleet lives on the owner)
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can unassign loads from trucks." });
    }

    // 2. Find the truck
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found in your fleet." });

    if (!truck.assignedLoadId) return res.status(400).json({ error: "No load assigned to this truck." });

    // 3. Unassign the load
    const Load = require("../models/Load");
    const load = await Load.findById(truck.assignedLoadId);

    if (!load) return res.status(404).json({ error: "Assigned load not found." });

    // Defensive: If equipmentType is missing, patch for validation (if needed)
    if (!load.equipmentType) {
      console.warn("Load missing equipmentType. Setting default for recovery.", load);
      load.equipmentType = "Unknown"; // or another sensible default
    }

    // -- AUTOMATED LOGIC ADDED HERE --
    // Unassign from truck and update status/availability/lastStatusUpdate
    truck.assignedLoadId = null;
    truck.status = "Available";           // System auto-sets status
    truck.available = true;               // Allow manual toggle again
    truck.lastStatusUpdate = new Date();  // Track when this changed

    load.status = "open";
    load.acceptedBy = null;
    load.assignedTruckId = null;

    await user.save();
    await load.save();

    // 4. Enrich the updated fleet with assigned load details
    const updatedUser = await User.findById(req.user.companyOwnerId || req.user.userId);
    const LoadModel = require("../models/Load");
    const fleetWithAssignedLoads = await Promise.all(
      updatedUser.fleet.map(async (t) => {
        let assignedLoad = null;
        if (t.assignedLoadId) {
          assignedLoad = await LoadModel.findById(t.assignedLoadId)
            .select('title origin destination status equipmentType rate');
        }
        return {
          ...t.toObject(),
          assignedLoad,
        };
      })
    );

    // 5. Emit live update (socket.io)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    // 6. Respond with the enriched data
    res.json({
      message: "Load unassigned from truck.",
      fleet: fleetWithAssignedLoads,
      truck: {
        truckId: truck.truckId,
        driverName: truck.driverName,
        assignedLoadId: truck.assignedLoadId,
        assignedLoad: null,
        status: truck.status,
        available: truck.available,
        lastStatusUpdate: truck.lastStatusUpdate,
      },
      load: {
        _id: load._id,
        title: load.title,
        status: load.status,
        acceptedBy: load.acceptedBy,
        assignedTruckId: load.assignedTruckId,
      }
    });
  } catch (err) {
    console.error("Error unassigning load:", err);
    res.status(500).json({ error: "Server error unassigning load." });
  }
});


// PUT /api/users/fleet/:truckId/deliver
router.put('/fleet/:truckId/deliver', auth, async (req, res) => {
  try {
    const { truckId } = req.params;

    // 1. Validate carrier (company fleet lives on the owner)
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can mark loads as delivered." });
    }

    // 2. Find the truck
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found in your fleet." });
    if (!truck.assignedLoadId) return res.status(400).json({ error: "No load assigned to this truck." });

    // 3. Find the load
    const Load = require("../models/Load");
    const load = await Load.findById(truck.assignedLoadId);
    if (!load) return res.status(404).json({ error: "Assigned load not found." });

    // 4. Mark as delivered and free up truck
    truck.status = "Available";           // Truck is free again
    truck.available = true;
    truck.lastStatusUpdate = new Date();
    truck.assignedLoadId = null;

    load.status = "delivered";
    load.deliveredAt = new Date();
    load.completedBy = user._id;
    load.assignedTruckId = null;

    await user.save();
    await load.save();

    // 5. Auto-generate BOL (non-blocking)
    try {
      const shipper = await User.findById(load.postedBy).select('name email companyName');
      const bolPath = await generateBOL(load, user, shipper);
      await Load.findByIdAndUpdate(load._id, { 'documents.bol': bolPath });
      const io = getIO();
      if (io) {
        io.to(`user_${load.acceptedBy}`).emit('doc:generated', { loadId: load._id, type: 'bol', path: bolPath });
        io.to(`user_${load.postedBy}`).emit('doc:generated', { loadId: load._id, type: 'bol', path: bolPath });
      }
    } catch (bolErr) {
      console.error('BOL auto-generate failed (non-fatal):', bolErr.message);
    }

    // 6. Notify shipper of delivery
    notifyUserSafe(load.postedBy?.toString(), {
      type: 'load:status',
      title: 'Your load has been delivered!',
      body: `"${load.title}" — ${load.origin} → ${load.destination}`,
      link: '/dashboard/shipper/loads',
      metadata: { loadId: load._id, status: 'delivered' },
    });

    // 7. Post system message to load thread and lock it after 7 days
    try {
      const Channel = require("../models/Channel");
      const Message = require("../models/Message");
      const channelId = `load_${load._id}`;
      const channel = await Channel.findOne({ channelId });
      if (channel) {
        const archiveAfter = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await Channel.findOneAndUpdate(
          { channelId },
          { archiveAfter, lastMessageAt: new Date(), lastMessagePreview: "Load delivered" }
        );
        await Message.create({
          channelType: "load_thread",
          channelId,
          sender: null,
          content: `✓ Load delivered at ${new Date().toLocaleString()}. This chat will lock in 7 days.`,
          messageType: "system",
          readBy: [],
        });
        const io = getIO();
        if (io) io.to(channelId).emit("newMessage", {
          channelId,
          content: `✓ Load delivered at ${new Date().toLocaleString()}.`,
          messageType: "system",
          createdAt: new Date(),
        });
      }
    } catch (chatErr) {
      console.error("Failed to post delivery system message (non-fatal):", chatErr);
    }

    // 8. Enrich the updated fleet with assigned load details
    const updatedUser = await User.findById(req.user.companyOwnerId || req.user.userId);
    const LoadModel = require("../models/Load");
    const fleetWithAssignedLoads = await Promise.all(
      updatedUser.fleet.map(async (t) => {
        let assignedLoad = null;
        if (t.assignedLoadId) {
          assignedLoad = await LoadModel.findById(t.assignedLoadId)
            .select('title origin destination status equipmentType rate');
        }
        return {
          ...t.toObject(),
          assignedLoad,
        };
      })
    );

    // 7. Auto-release escrow payment on delivery (non-blocking).
    try {
      const Payment = require('../models/Payment');
      const Invoice = require('../models/Invoice');
      const payment = await Payment.findOne({ loadId: load._id, status: 'in_escrow' });
      if (payment) {
        const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
        let moneyMoved = false;

        if (stripeConfigured && payment.stripePaymentIntentId) {
          // Real money path: capture the held funds and pay the carrier (NOA-aware).
          // Only advance Payment state to reflect what actually happened in Stripe —
          // never fabricate a "paid" invoice for money that didn't move.
          const escrowService = require('../services/escrowService');
          const carrierUser = await User.findById(payment.carrierId).select('stripe');
          const connectId = carrierUser?.stripe?.connectAccountId;
          if (!connectId) {
            console.warn(`[deliver] Load ${load._id}: escrow funded but carrier has no Connect account — payout deferred, leaving in_escrow.`);
          } else {
            try {
              const result = await escrowService.captureEscrow(
                payment.stripePaymentIntentId, String(load._id), connectId
              );
              if (result.chargeId) payment.stripeChargeId = result.chargeId;
              if (result.transferId) {
                // Paid straight to the carrier.
                payment.status = 'released';
                payment.stripeTransferId = result.transferId;
                payment.releasedAt = new Date();
              } else {
                // Captured, but the carrier payout was redirected to a factor or held
                // (UCC §9-406). The shipper WAS charged, so the invoice is legitimate.
                payment.status = 'captured';
              }
              await payment.save();
              moneyMoved = true;
            } catch (capErr) {
              console.error(`[deliver] Load ${load._id}: escrow capture failed — leaving in_escrow for retry:`, capErr.message);
            }
          }
        } else if (!stripeConfigured) {
          // No-money pilot / tests: no real Stripe. Preserve prior behavior so the
          // operational flow (invoice + notifications) still works end-to-end.
          payment.status = 'released';
          payment.releasedAt = new Date();
          await payment.save();
          moneyMoved = true;
        }

        if (moneyMoved) {
          const existing = await Invoice.findOne({ loadId: load._id });
          if (!existing) {
            await Invoice.create({
              loadId: load._id,
              shipperId: payment.shipperId,
              carrierId: payment.carrierId,
              // Canonical cents from the payment; dollar fields kept for backward-compat.
              subtotalCents: payment.amountCents,
              platformFeeCents: payment.platformFeeCents,
              totalCents: payment.amountCents,
              subtotal: payment.amount,
              platformFee: payment.platformFee,
              total: payment.amount,
              status: 'paid',
              paidAt: new Date(),
              issuedAt: new Date(),
              stripePaymentIntentId: payment.stripePaymentIntentId,
              lineItems: [{
                description: `Freight: ${load.title} (${load.origin} → ${load.destination})`,
                quantity: 1,
                unitAmount: payment.amount,
                total: payment.amount,
              }],
            });
          }
          const io = getIO();
          if (io) {
            // Only tell the carrier they were paid if funds actually transferred to them.
            if (payment.status === 'released') {
              io.to(`user_${payment.carrierId}`).emit('payment:released', { loadId: load._id, amount: payment.carrierPayout });
            }
            io.to(`user_${payment.shipperId}`).emit('payment:released', { loadId: load._id, amount: payment.amount });
          }
        }
      }
    } catch (payErr) {
      console.error('Auto-release payment error (non-fatal):', payErr.message);
    }

    // 8. Emit live update (socket.io)
    const io = getIO();
    if (io) io.emit("fleetUpdated", { userId: user._id });

    res.json({
      message: "Load marked as delivered.",
      fleet: fleetWithAssignedLoads,
      truck: {
        truckId: truck.truckId,
        driverName: truck.driverName,
        status: truck.status,
        available: truck.available,
        lastStatusUpdate: truck.lastStatusUpdate,
        assignedLoadId: truck.assignedLoadId,
        assignedLoad: null,
      },
      load: {
        _id: load._id,
        title: load.title,
        status: load.status,
        deliveredAt: load.deliveredAt,
        completedBy: load.completedBy,
      }
    });
  } catch (err) {
    console.error("Error marking load as delivered:", err);
    res.status(500).json({ error: "Server error delivering load." });
  }
});




// PUT /api/users/fleet/:truckId/location
router.put('/fleet/:truckId/location', auth, async (req, res) => {
  try {
    const { truckId } = req.params;
    const { latitude, longitude } = req.body;
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user || user.role !== "carrier") return res.status(403).json({ error: "Only carriers can update location." });
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found." });
    truck.location = { latitude, longitude, updatedAt: new Date() };
    await user.save();
    res.json({ message: "Location updated", truck });
  } catch (err) {
    res.status(500).json({ error: "Error updating location." });
  }
});

//Update Truck Location (for real-time tracking)
router.put('/update-location', auth, async (req, res) => {
  try {
    const { truckId, latitude, longitude } = req.body;
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can update location." });
    }
    const truck = user.fleet.find(t => t.truckId === truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found." });

    truck.location = { latitude, longitude };
    await user.save();

    // Socket update (if using req.io, or global io)
    const io = getIO(); // Always get io
    if (io) io.emit("fleetUpdated", { userId: user._id });

    res.json({ message: "Location updated", truck });
  } catch (err) {
    console.error("Error updating truck location:", err);
    res.status(500).json({ error: "Server error updating location." });
  }
});

// PUT /api/users/fleet/:truckId/availability
router.put("/fleet/:truckId/availability", auth, async (req, res) => {
  try {
    const { available } = req.body;
    // Trucks are embedded in the company owner's User.fleet[] (no Truck collection).
    const user = await User.findById(req.user.companyOwnerId || req.user.userId);
    if (!user || user.role !== "carrier") {
      return res.status(403).json({ error: "Only carriers can update truck availability" });
    }
    const truck = user.fleet.find(t => t.truckId === req.params.truckId);
    if (!truck) return res.status(404).json({ error: "Truck not found" });

    truck.available = !!available;
    truck.status = available ? "Available" : "Unavailable";
    truck.lastStatusUpdate = new Date();
    await user.save();
    res.json(truck);
  } catch (err) {
    console.error("Fleet availability error:", err.message);
    res.status(500).json({ error: "Failed to update truck availability" });
  }
});







// ----------------------------------------
// PUT /api/users/me/preferences — save carrier matching preferences
// ----------------------------------------
router.put('/me/preferences', auth, async (req, res) => {
  try {
    if (req.user.role !== 'carrier') {
      return res.status(403).json({ error: 'Only carriers can set matching preferences' });
    }
    const { equipmentTypes, preferredLanes, preferredRegions, minRate, maxMileage, homeBase } = req.body;
    const update = {};
    if (equipmentTypes !== undefined) update['preferences.equipmentTypes'] = equipmentTypes;
    if (preferredLanes !== undefined) update['preferences.preferredLanes'] = preferredLanes;
    if (preferredRegions !== undefined) update['preferences.preferredRegions'] = preferredRegions;
    if (minRate !== undefined) update['preferences.minRate'] = Number(minRate);
    if (maxMileage !== undefined) update['preferences.maxMileage'] = maxMileage ? Number(maxMileage) : null;
    if (homeBase !== undefined) update['preferences.homeBase'] = homeBase;

    const user = await User.findByIdAndUpdate(req.user.userId, { $set: update }, { new: true });
    res.json({ preferences: user.preferences });
  } catch (err) {
    console.error('Error saving preferences:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// ----------------------------------------
// PUT /api/users/me/onboarding — wizard per-step save + completion
// Body (per-step): { step, role, data: { companyInfo, equipmentTypes, preferredLanes, fleet, shipmentTypes, primaryLanes, ... } }
// Body (complete):  { complete: true, role }
// Maps wizard fields onto whitelisted safe profile fields.
// ----------------------------------------
router.put('/me/onboarding', auth, async (req, res) => {
  try {
    const { data, complete } = req.body || {};
    const update = {};

    // Final completion signal from the wizard
    if (complete === true) {
      update.onboardingComplete = true;
    }

    // Per-step data — whitelist safe profile fields only
    if (data && typeof data === 'object') {
      const info = data.companyInfo;
      if (info && typeof info === 'object') {
        if (typeof info.name === 'string' && info.name.trim()) update.companyName = info.name.trim();
        if (typeof info.dotNumber === 'string') update.dotNumber = info.dotNumber;
        if (typeof info.mcNumber === 'string') update.mcNumber = info.mcNumber;
      }
      if (Array.isArray(data.equipmentTypes)) {
        update['preferences.equipmentTypes'] = data.equipmentTypes;
      }
      // Carrier preferred lanes OR shipper primary lanes → preferences.preferredLanes
      const lanes = Array.isArray(data.preferredLanes)
        ? data.preferredLanes
        : (Array.isArray(data.primaryLanes) ? data.primaryLanes : null);
      if (lanes) {
        update['preferences.preferredLanes'] = lanes
          .filter(l => l && l.origin && l.destination)
          .map(l => ({ origin: String(l.origin), destination: String(l.destination) }));
      }
      // Shipper shipment equipment preferences
      if (data.shipmentTypes && Array.isArray(data.shipmentTypes.equipment)) {
        update['preferences.equipmentTypes'] = data.shipmentTypes.equipment;
      }
    }

    if (Object.keys(update).length === 0) {
      // Nothing to persist (e.g. document-only step) — still a success
      return res.json({ success: true });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { $set: update },
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ success: true, user });
  } catch (err) {
    console.error('PUT /me/onboarding error:', err.message);
    res.status(500).json({ error: 'Failed to save onboarding progress' });
  }
});

// ----------------------------------------
// PUT /api/users/me/onboarding-complete — durably mark onboarding done (also used for "Skip")
// ----------------------------------------
router.put('/me/onboarding-complete', auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.userId, { $set: { onboardingComplete: true } });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /me/onboarding-complete error:', err.message);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

// Export the router
module.exports = router;
