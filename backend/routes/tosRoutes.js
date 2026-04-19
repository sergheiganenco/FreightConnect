const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const User = require('../models/User');
const { CURRENT_TOS_VERSION } = require('../middlewares/tosGuard');

// GET /api/tos/current — public, returns current ToS version and text
router.get('/current', (req, res) => {
  res.json({
    version: CURRENT_TOS_VERSION,
    effectiveDate: '2026-04-18',
    title: 'FreightConnect Terms of Service',
    text: `FREIGHTCONNECT TERMS OF SERVICE

Version ${CURRENT_TOS_VERSION} — Effective April 18, 2026

1. ACCEPTANCE OF TERMS
By accessing or using the FreightConnect platform ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, you may not use the Service.

2. DESCRIPTION OF SERVICE
FreightConnect is a freight marketplace platform that connects shippers and carriers directly. The Service includes load posting, matching, bidding, payments, document management, and communication tools.

3. USER ACCOUNTS
You must register for an account to use the Service. You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account. You agree to provide accurate, current, and complete information.

4. CARRIER OBLIGATIONS
Carriers must maintain valid FMCSA operating authority, adequate insurance coverage, and comply with all applicable DOT and FMCSA regulations including Hours of Service rules. Carriers are responsible for the safe transportation of all freight.

5. SHIPPER OBLIGATIONS
Shippers must provide accurate load information including weight, dimensions, commodity type, and hazmat status. Shippers are responsible for timely payment per agreed terms.

6. PAYMENTS AND FEES
All financial transactions are processed through our secure payment system. FreightConnect may charge service fees as disclosed during transactions. All amounts are in US dollars. Payment terms are net 30 unless otherwise agreed.

7. LIMITATION OF LIABILITY
FreightConnect acts as a marketplace platform and is not a broker, carrier, or shipper. FreightConnect is not liable for cargo damage, delays, or disputes between users. Maximum liability is limited to fees paid in the prior 12 months.

8. PRIVACY POLICY
Your use of the Service is also governed by our Privacy Policy. We collect and process personal data including location data, business information, and transaction records as described therein.

9. INDEMNIFICATION
You agree to indemnify and hold harmless FreightConnect from any claims, losses, or damages arising from your use of the Service or violation of these Terms.

10. DISPUTE RESOLUTION
Any disputes shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. Class action waivers apply.

11. MODIFICATIONS
FreightConnect reserves the right to modify these Terms at any time. Continued use after changes constitutes acceptance. Material changes will require re-acceptance.

12. TERMINATION
Either party may terminate the account at any time. FreightConnect may suspend or terminate accounts for violations of these Terms.

13. GOVERNING LAW
These Terms are governed by the laws of the State of Delaware, without regard to conflict of laws principles.

14. CONTACT
Questions about these Terms should be directed to legal@freightconnect.com.`,
  });
});

// POST /api/tos/accept — authenticated user accepts current ToS
router.post('/accept', auth, async (req, res) => {
  try {
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      {
        tosAccepted: true,
        tosAcceptedAt: new Date(),
        tosVersion: CURRENT_TOS_VERSION,
        tosIpAddress: ipAddress,
      },
      { new: true }
    ).select('tosAccepted tosAcceptedAt tosVersion');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      tosAccepted: user.tosAccepted,
      tosAcceptedAt: user.tosAcceptedAt,
      tosVersion: user.tosVersion,
    });
  } catch (err) {
    console.error('[tosRoutes] Accept failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tos/status — returns user's acceptance status
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('tosAccepted tosAcceptedAt tosVersion')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      tosAccepted: user.tosAccepted || false,
      tosAcceptedAt: user.tosAcceptedAt || null,
      tosVersion: user.tosVersion || null,
      currentVersion: CURRENT_TOS_VERSION,
      needsAcceptance: !user.tosAccepted || user.tosVersion !== CURRENT_TOS_VERSION,
    });
  } catch (err) {
    console.error('[tosRoutes] Status check failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
