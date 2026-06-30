/**
 * Factoring Notice of Assignment (NOA) routes.
 *
 * LEGAL ENCODING — UCC Article 9 §9-406 (see models/FactoringAssignment.js and
 * services/factoringPaymentRouter.js). This is an ENCODING of expected §9-406
 * behavior, NOT legal advice, and REQUIRES review by legal counsel. The admin
 * verify/release/dispute actions here directly control whether the platform
 * pays the carrier, the factor, or holds — handle with care.
 *
 * Carriers submit a NOA (an external factor directing where their earnings must
 * be remitted). Admins verify/release/reject/dispute it. The payee resolver
 * (factoringPaymentRouter.resolvePayee) reads the resulting status to decide
 * who gets paid on every carrier payout.
 */

const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const FactoringAssignment = require('../models/FactoringAssignment');
const { resolvePayee } = require('../services/factoringPaymentRouter');
const { notifyUserSafe } = require('../utils/notifyUser');

function carrierOnly(req, res, next) {
  if (req.user.role !== 'carrier') return res.status(403).json({ error: 'Carriers only' });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}

// ── Carrier: submit an NOA ────────────────────────────────────────────────────
// POST /  body: { factorCompanyName, factorRemitTo, factorContactEmail,
//                 factorContactPhone, noaDocumentUrl, effectiveDate }
router.post('/', auth, carrierOnly, async (req, res) => {
  try {
    const { factorCompanyName, factorRemitTo, factorContactEmail, factorContactPhone, noaDocumentUrl, effectiveDate } = req.body;
    if (!factorCompanyName || typeof factorCompanyName !== 'string') {
      return res.status(400).json({ error: 'factorCompanyName is required' });
    }

    // If the carrier already has an active NOA, we still allow the new
    // submission — an admin must release the old one and verify the new one.
    // We never auto-replace (that is a §9-406 decision for a human).
    const existingActive = await FactoringAssignment.findOne({ carrier: req.user.userId, status: 'active' });

    const assignment = await FactoringAssignment.create({
      carrier: req.user.userId,
      factorCompanyName: factorCompanyName.trim(),
      factorRemitTo: factorRemitTo || null,
      factorContactEmail: factorContactEmail || null,
      factorContactPhone: factorContactPhone || null,
      noaDocumentUrl: noaDocumentUrl || null,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      status: 'pending_verification',
      history: [{
        action: 'submitted',
        by: req.user.userId,
        note: existingActive ? 'Submitted while another active NOA exists — admin must release the prior one.' : undefined,
      }],
    });

    res.status(201).json({
      success: true,
      data: assignment,
      noteForAdmin: existingActive ? 'Carrier already has an active NOA; release it before verifying this one.' : undefined,
    });
  } catch (err) {
    console.error('[factoringAssignment:create] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Carrier: list own NOAs ────────────────────────────────────────────────────
// GET /mine
router.get('/mine', auth, carrierOnly, async (req, res) => {
  try {
    const data = await FactoringAssignment.find({ carrier: req.user.userId }).sort({ createdAt: -1 });
    res.json({ data });
  } catch (err) {
    console.error('[factoringAssignment:mine] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: list NOAs (filterable, paginated) ──────────────────────────────────
// GET /?status=&page=&limit=
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && ['pending_verification', 'active', 'released', 'rejected', 'disputed'].includes(status)) {
      filter.status = status;
    }
    const pageNum = Math.max(1, Number(page) || 1);
    const limNum = Math.min(100, Math.max(1, Number(limit) || 20));

    const [data, total] = await Promise.all([
      FactoringAssignment.find(filter)
        .populate('carrier', 'name email companyName mcNumber')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limNum)
        .limit(limNum),
      FactoringAssignment.countDocuments(filter),
    ]);

    res.json({ data, total, page: pageNum, pages: Math.ceil(total / limNum) });
  } catch (err) {
    console.error('[factoringAssignment:list] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: detail ─────────────────────────────────────────────────────────────
// GET /:id
router.get('/:id', auth, adminOnly, async (req, res) => {
  try {
    const assignment = await FactoringAssignment.findById(req.params.id)
      .populate('carrier', 'name email companyName mcNumber')
      .populate('verifiedBy', 'name email');
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    res.json({ data: assignment });
  } catch (err) {
    console.error('[factoringAssignment:detail] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: verify (mark active) ───────────────────────────────────────────────
// PUT /:id/verify
router.put('/:id/verify', auth, adminOnly, async (req, res) => {
  try {
    const assignment = await FactoringAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    if (assignment.status === 'active') return res.json({ success: true, data: assignment });
    if (assignment.status === 'released' || assignment.status === 'rejected') {
      return res.status(409).json({ error: `Cannot verify a ${assignment.status} assignment` });
    }

    // SAFE PATH (§9-406): a carrier may have only ONE active NOA at a time.
    // If another active NOA exists, refuse — the admin must release it first.
    // We never auto-decide between competing claims.
    const otherActive = await FactoringAssignment.findOne({
      carrier: assignment.carrier,
      status: 'active',
      _id: { $ne: assignment._id },
    });
    if (otherActive) {
      return res.status(409).json({
        error: 'Carrier already has an active NOA. Release it before verifying this one.',
        conflictingAssignmentId: otherActive._id,
      });
    }

    assignment.status = 'active';
    assignment.verifiedBy = req.user.userId;
    assignment.verifiedAt = new Date();
    assignment.history.push({ action: 'verified', by: req.user.userId, note: req.body?.note });
    await assignment.save();

    await notifyUserSafe(assignment.carrier.toString(), {
      type: 'factoring:noa_active',
      title: 'Factoring assignment active',
      body: `Your Notice of Assignment for "${assignment.factorCompanyName}" is verified. Future payouts will be remitted to the factor.`,
      link: '/dashboard/carrier/factoring',
      metadata: { assignmentId: assignment._id },
    });

    res.json({ success: true, data: assignment });
  } catch (err) {
    console.error('[factoringAssignment:verify] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: release ────────────────────────────────────────────────────────────
// PUT /:id/release  body: { releaseDocumentUrl, note }
router.put('/:id/release', auth, adminOnly, async (req, res) => {
  try {
    const { releaseDocumentUrl, note } = req.body || {};
    const assignment = await FactoringAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    if (assignment.status === 'released') return res.json({ success: true, data: assignment });

    assignment.status = 'released';
    assignment.releasedAt = new Date();
    if (releaseDocumentUrl) assignment.releaseDocumentUrl = releaseDocumentUrl;
    assignment.history.push({ action: 'released', by: req.user.userId, note });
    await assignment.save();

    await notifyUserSafe(assignment.carrier.toString(), {
      type: 'factoring:noa_released',
      title: 'Factoring assignment released',
      body: `The Notice of Assignment for "${assignment.factorCompanyName}" has been released. Payouts revert to your account.`,
      link: '/dashboard/carrier/factoring',
      metadata: { assignmentId: assignment._id },
    });

    res.json({ success: true, data: assignment });
  } catch (err) {
    console.error('[factoringAssignment:release] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: reject ─────────────────────────────────────────────────────────────
// PUT /:id/reject  body: { reason }
router.put('/:id/reject', auth, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const assignment = await FactoringAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: 'Not found' });
    if (assignment.status === 'active') {
      return res.status(409).json({ error: 'Cannot reject an active NOA — release it instead.' });
    }

    assignment.status = 'rejected';
    assignment.disputeReason = reason || assignment.disputeReason;
    assignment.history.push({ action: 'rejected', by: req.user.userId, note: reason });
    await assignment.save();

    await notifyUserSafe(assignment.carrier.toString(), {
      type: 'factoring:noa_rejected',
      title: 'Factoring assignment rejected',
      body: `Your Notice of Assignment for "${assignment.factorCompanyName}" was rejected.${reason ? ' Reason: ' + reason : ''}`,
      link: '/dashboard/carrier/factoring',
      metadata: { assignmentId: assignment._id },
    });

    res.json({ success: true, data: assignment });
  } catch (err) {
    console.error('[factoringAssignment:reject] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin: dispute (holds payouts) ────────────────────────────────────────────
// PUT /:id/dispute  body: { reason }
router.put('/:id/dispute', auth, adminOnly, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const assignment = await FactoringAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: 'Not found' });

    // Disputed status holds payouts (resolvePayee returns 'hold') — the safe
    // §9-406 posture while a claim is contested.
    assignment.status = 'disputed';
    assignment.disputeReason = reason || assignment.disputeReason;
    assignment.history.push({ action: 'disputed', by: req.user.userId, note: reason });
    await assignment.save();

    res.json({ success: true, data: assignment });
  } catch (err) {
    console.error('[factoringAssignment:dispute] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin utility: current payee routing for a carrier ────────────────────────
// GET /carrier/:carrierId/payee
router.get('/carrier/:carrierId/payee', auth, adminOnly, async (req, res) => {
  try {
    const payee = await resolvePayee(req.params.carrierId);
    res.json({ data: payee });
  } catch (err) {
    console.error('[factoringAssignment:payee] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
