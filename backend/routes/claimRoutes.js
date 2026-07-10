/**
 * Claim Routes — cargo claims (damage / loss / shortage / overage)
 *
 * POST   /api/claims                 — file a claim (a party on the load)
 * GET    /api/claims                 — list (admin: all + filters; party: own)
 * GET    /api/claims/load/:loadId    — all claims for a load (party or admin)
 * POST   /api/claims/:id/notes       — add a note to the claim thread
 * POST   /api/claims/:id/evidence    — attach evidence files (party or admin)
 * PUT    /api/claims/:id/withdraw    — claimant withdraws an open/investigating claim
 * PUT    /api/claims/:id/resolve     — admin resolves or denies a claim
 * GET    /api/claims/:id             — single claim (admin OR either party)
 *
 * All money is INTEGER CENTS. Party checks compare against the acting COMPANY
 * (owner) id — load.postedBy / load.acceptedBy are stored at company level.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { uploadEvidence } = require('../middlewares/evidenceUpload');
const Claim = require('../models/Claim');
const Load = require('../models/Load');
const { getIO } = require('../utils/socket');
const { notifyUserSafe, notifyAdmins } = require('../utils/notifyUser');

// Acting company id: sub-account tokens carry companyOwnerId; owners fall back to own id.
const companyOf = (req) => req.user.companyOwnerId || req.user.userId;

// Fire-and-forget socket emit to a user's personal room.
function notify(userId, event, payload) {
  try { getIO().to(`user_${userId}`).emit(event, payload); } catch (_) {}
}

// Notification deep-link chosen by the RECIPIENT's role.
function claimsLink(role) {
  if (role === 'shipper') return '/dashboard/shipper/claims';
  if (role === 'carrier') return '/dashboard/carrier/claims';
  return '/dashboard/admin/claims';
}

// postedBy is always the shipper, acceptedBy always the carrier, so a party's
// counterpart role is simply the opposite of its own.
const otherRole = (role) => (role === 'shipper' ? 'carrier' : 'shipper');

const LOADABLE_STATUSES = ['accepted', 'in-transit', 'delivered'];

// ────────────────────────────────────────────────────────────────────────────
// POST /api/claims — file a new cargo claim
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  auth,
  [
    body('loadId').isMongoId().withMessage('A valid loadId is required'),
    body('type').isIn(['damage', 'loss', 'shortage', 'overage']).withMessage('Invalid claim type'),
    body('amountCents').isInt({ min: 0 }).withMessage('amountCents must be a non-negative integer (cents)'),
    body('description').trim().notEmpty().withMessage('description is required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { loadId, type, amountCents, description } = req.body;

      const load = await Load.findById(loadId);
      if (!load) return res.status(404).json({ error: 'Load not found' });

      // The load must be booked and in a claimable lifecycle stage.
      if (!load.acceptedBy || !LOADABLE_STATUSES.includes(load.status)) {
        return res.status(400).json({
          error: 'Claims can only be filed on a booked load (accepted, in-transit, or delivered)',
        });
      }

      // The actor must be one of the two parties on the load (compared at COMPANY level).
      const companyId = companyOf(req);
      const isPoster  = String(load.postedBy)  === String(companyId);
      const isCarrier = String(load.acceptedBy) === String(companyId);
      if (!isPoster && !isCarrier) {
        return res.status(403).json({ error: 'You are not a party on this load' });
      }

      const claimantRole = req.user.role;               // 'carrier' | 'shipper'
      const respondent   = isPoster ? load.acceptedBy : load.postedBy;
      const respondentRole = otherRole(claimantRole);

      const claim = await Claim.create({
        loadId,
        claimant: companyId,
        claimantRole,
        respondent,
        type,
        amountCents,
        description,
        notes: [{
          author: req.user.userId,
          authorRole: claimantRole,
          content: description,
        }],
      });

      // Notify the respondent company + all admins.
      notify(respondent, 'claim:new', {
        claimId: claim._id, loadId, type, amountCents,
      });
      notifyUserSafe(respondent, {
        type: 'claim:new',
        title: 'A cargo claim was filed on your load',
        body: `${type} — ${(amountCents / 100).toFixed(2)} claimed`,
        link: claimsLink(respondentRole),
        metadata: { claimId: claim._id, loadId, type },
      });
      notifyAdmins({
        type: 'claim:new',
        title: 'New cargo claim filed',
        body: `${type} claim for ${(amountCents / 100).toFixed(2)}`,
        link: claimsLink('admin'),
        metadata: { claimId: claim._id, loadId, type },
      });

      res.status(201).json(claim);
    } catch (err) {
      console.error('[claims] file failed:', err.message);
      res.status(500).json({ error: 'Failed to file claim' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// GET /api/claims — list claims
// Admin: all (optional ?status &?type filters); Party: claims they're on.
// ────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const role = req.user.role;

    let filter;
    if (role === 'admin') {
      filter = {};
      if (status && status !== 'all') filter.status = status;
      if (type   && type   !== 'all') filter.type   = type;
    } else {
      const companyId = companyOf(req);
      filter = { $or: [{ claimant: companyId }, { respondent: companyId }] };
    }

    const [claims, total] = await Promise.all([
      Claim.find(filter)
        .populate('loadId', 'title origin destination status')
        .populate('claimant', 'name email companyName')
        .populate('respondent', 'name email companyName')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Claim.countDocuments(filter),
    ]);

    res.json({ claims, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[claims] list failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/claims/load/:loadId — all claims for a specific load (party or admin)
// ────────────────────────────────────────────────────────────────────────────
router.get('/load/:loadId', auth, async (req, res) => {
  try {
    const load = await Load.findById(req.params.loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    const companyId = companyOf(req);
    const isParty = String(load.postedBy) === String(companyId) ||
                    String(load.acceptedBy) === String(companyId);
    if (req.user.role !== 'admin' && !isParty) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const claims = await Claim.find({ loadId: req.params.loadId })
      .populate('claimant', 'name email companyName')
      .populate('respondent', 'name email companyName')
      .sort({ createdAt: -1 });

    res.json(claims);
  } catch (err) {
    console.error('[claims] load list failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch load claims' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/claims/:id/notes — add a note to the claim thread (party or admin)
// ────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/notes',
  auth,
  [body('content').trim().notEmpty().withMessage('Note content is required')],
  validate,
  async (req, res) => {
    try {
      const claim = await Claim.findById(req.params.id);
      if (!claim) return res.status(404).json({ error: 'Claim not found' });

      const companyId = companyOf(req);
      const isClaimant   = String(claim.claimant)   === String(companyId);
      const isRespondent = String(claim.respondent) === String(companyId);
      if (req.user.role !== 'admin' && !isClaimant && !isRespondent) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const content = req.body.content.trim();
      claim.notes.push({
        author: req.user.userId,
        authorRole: req.user.role,
        content,
      });
      await claim.save();

      // Notify the parties other than the author.
      const recipients = [
        { id: claim.claimant,   role: claim.claimantRole },
        { id: claim.respondent, role: otherRole(claim.claimantRole) },
      ].filter((r) => String(r.id) !== String(companyId));
      recipients.forEach(({ id, role }) => {
        notify(id, 'claim:note', {
          claimId: claim._id, preview: content.slice(0, 80),
        });
        notifyUserSafe(id, {
          type: 'claim:note',
          title: 'New note on a cargo claim',
          body: content.slice(0, 100),
          link: claimsLink(role),
          metadata: { claimId: claim._id },
        });
      });

      res.status(201).json(claim.notes[claim.notes.length - 1]);
    } catch (err) {
      console.error('[claims] add note failed:', err.message);
      res.status(500).json({ error: 'Failed to add note' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// POST /api/claims/:id/evidence — attach evidence files (party or admin)
// ────────────────────────────────────────────────────────────────────────────
router.post('/:id/evidence', auth, uploadEvidence, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const companyId = companyOf(req);
    const isParty = String(claim.claimant) === String(companyId) ||
                    String(claim.respondent) === String(companyId);
    if (req.user.role !== 'admin' && !isParty) {
      return res.status(403).json({ error: 'Not authorized to attach evidence to this claim' });
    }

    // Server-generated paths only — never trust body-provided URLs.
    const added = (req.files || []).map((f) => `/documents/evidence/${f.filename}`);
    claim.evidenceUrls = [...(claim.evidenceUrls || []), ...added];
    await claim.save();

    res.json({ evidenceUrls: claim.evidenceUrls, added });
  } catch (err) {
    console.error('[claims] evidence failed:', err.message);
    res.status(500).json({ error: 'Failed to attach evidence' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/claims/:id/withdraw — claimant withdraws an open/investigating claim
// ────────────────────────────────────────────────────────────────────────────
router.put('/:id/withdraw', auth, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const companyId = companyOf(req);
    if (String(claim.claimant) !== String(companyId)) {
      return res.status(403).json({ error: 'Only the claimant can withdraw this claim' });
    }
    if (!['open', 'investigating'].includes(claim.status)) {
      return res.status(400).json({ error: `Cannot withdraw a claim that is ${claim.status}` });
    }

    claim.status = 'withdrawn';
    claim.notes.push({
      author: req.user.userId,
      authorRole: req.user.role,
      content: 'Claim withdrawn by the claimant.',
    });
    await claim.save();

    const respondentRole = otherRole(claim.claimantRole);
    notify(claim.respondent, 'claim:withdrawn', { claimId: claim._id });
    notifyUserSafe(claim.respondent, {
      type: 'claim:withdrawn',
      title: 'A cargo claim was withdrawn',
      body: 'The claimant withdrew their claim.',
      link: claimsLink(respondentRole),
      metadata: { claimId: claim._id },
    });
    notifyAdmins({
      type: 'claim:withdrawn',
      title: 'Cargo claim withdrawn',
      body: 'A claimant withdrew their claim.',
      link: claimsLink('admin'),
      metadata: { claimId: claim._id },
    });

    res.json(claim);
  } catch (err) {
    console.error('[claims] withdraw failed:', err.message);
    res.status(500).json({ error: 'Failed to withdraw claim' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PUT /api/claims/:id/resolve — admin resolves or denies a claim
// ────────────────────────────────────────────────────────────────────────────
router.put(
  '/:id/resolve',
  auth,
  [
    body('status').isIn(['resolved', 'denied']).withMessage('status must be resolved or denied'),
    body('resolvedAmountCents').optional().isInt({ min: 0 })
      .withMessage('resolvedAmountCents must be a non-negative integer (cents)'),
    body('resolution').optional().isString(),
  ],
  validate,
  async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });

      const { status, resolution, resolvedAmountCents } = req.body;

      const claim = await Claim.findById(req.params.id);
      if (!claim) return res.status(404).json({ error: 'Claim not found' });

      claim.status = status;
      claim.resolution = resolution || null;
      if (resolvedAmountCents !== undefined) claim.resolvedAmountCents = resolvedAmountCents;
      claim.resolvedAt = new Date();
      claim.resolvedBy = req.user.userId;
      claim.notes.push({
        author: req.user.userId,
        authorRole: 'admin',
        content: `Claim ${status}${resolution ? ': ' + resolution : ''}.`,
      });
      await claim.save();

      // Notify both parties.
      const parties = [
        { id: claim.claimant,   role: claim.claimantRole },
        { id: claim.respondent, role: otherRole(claim.claimantRole) },
      ];
      parties.forEach(({ id, role }) => {
        notify(id, 'claim:resolved', { claimId: claim._id, status, resolvedAmountCents: claim.resolvedAmountCents });
        notifyUserSafe(id, {
          type: 'claim:resolved',
          title: `Cargo claim ${status}`,
          body: status === 'resolved' && claim.resolvedAmountCents != null
            ? `Approved for ${(claim.resolvedAmountCents / 100).toFixed(2)}`
            : `Your claim was ${status}.`,
          link: claimsLink(role),
          metadata: { claimId: claim._id, status },
        });
      });

      res.json(claim);
    } catch (err) {
      console.error('[claims] resolve failed:', err.message);
      res.status(500).json({ error: 'Failed to resolve claim' });
    }
  }
);

// ── Platform (contingent) cargo coverage — admin only ──────────────────────
// The platform's own policy that backstops a valid claim when the carrier's
// insurance can't/won't pay. NOTE: /policy and /:id/coverage are declared BEFORE
// GET /:id so they aren't swallowed by the :id param.
const PlatformInsurancePolicy = require('../models/PlatformInsurancePolicy');
const platformCoverage = require('../services/platformCoverageService');
const User = require('../models/User');
const ADMIN_ONLY = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
};

// Resolve the CARRIER party of a claim (its insurance is what the backstop covers).
async function carrierInsuranceStatusFor(claim) {
  try {
    const load = await Load.findById(claim.loadId).select('acceptedBy');
    const carrierId = load?.acceptedBy;
    if (!carrierId) return 'unknown';
    const carrier = await User.findById(carrierId).select('verification.insurance.status');
    return carrier?.verification?.insurance?.status || 'unknown';
  } catch { return 'unknown'; }
}

// GET /api/claims/policy — the active platform cargo policy (admin)
router.get('/policy', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const policy = await PlatformInsurancePolicy.getActive();
    res.json({ policy });
  } catch (err) {
    console.error('[claims] get policy failed:', err.message);
    res.status(500).json({ error: 'Failed to load platform policy' });
  }
});

// PUT /api/claims/policy — set/replace the active platform policy (admin)
router.put(
  '/policy',
  auth, ADMIN_ONLY,
  [
    body('insurer').trim().notEmpty(),
    body('policyNumber').trim().notEmpty(),
    body('perClaimLimitCents').isInt({ min: 1 }),
    body('aggregateLimitCents').isInt({ min: 1 }),
    body('deductibleCents').optional().isInt({ min: 0 }),
    body('effectiveDate').isISO8601(),
    body('expiryDate').isISO8601(),
  ],
  validate,
  async (req, res) => {
    try {
      // One active policy at a time — retire any current active ones.
      await PlatformInsurancePolicy.updateMany({ isActive: true }, { $set: { isActive: false } });
      const p = await PlatformInsurancePolicy.create({
        insurer: req.body.insurer,
        policyNumber: req.body.policyNumber,
        perClaimLimitCents: req.body.perClaimLimitCents,
        aggregateLimitCents: req.body.aggregateLimitCents,
        deductibleCents: req.body.deductibleCents || 0,
        effectiveDate: req.body.effectiveDate,
        expiryDate: req.body.expiryDate,
        isActive: true,
        createdBy: req.user.userId,
        notes: req.body.notes || null,
      });
      res.status(201).json({ policy: p });
    } catch (err) {
      console.error('[claims] set policy failed:', err.message);
      res.status(500).json({ error: 'Failed to save platform policy' });
    }
  }
);

// GET /api/claims/:id/coverage — assess platform coverage for a claim (admin)
router.get('/:id/coverage', auth, ADMIN_ONLY, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    const policy = await PlatformInsurancePolicy.getActive();
    const carrierInsuranceStatus = await carrierInsuranceStatusFor(claim);
    const assessment = platformCoverage.assess(claim, { policy, carrierInsuranceStatus });
    res.json({ assessment, platformCoverage: claim.platformCoverage });
  } catch (err) {
    console.error('[claims] coverage assess failed:', err.message);
    res.status(500).json({ error: 'Failed to assess coverage' });
  }
});

// POST /api/claims/:id/coverage — admin decision on platform coverage
// body: { action: 'approve'|'deny'|'pay', reference?, reason? }
router.post(
  '/:id/coverage',
  auth, ADMIN_ONLY,
  [body('action').isIn(['approve', 'deny', 'pay'])],
  validate,
  async (req, res) => {
    try {
      const claim = await Claim.findById(req.params.id);
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      const policy = await PlatformInsurancePolicy.getActive();
      if (!policy && req.body.action !== 'deny') {
        return res.status(409).json({ error: 'No active platform insurance policy configured' });
      }

      let coveredAmountCents = 0;
      let deductibleCents = 0;
      if (req.body.action !== 'deny') {
        const carrierInsuranceStatus = await carrierInsuranceStatusFor(claim);
        const a = platformCoverage.assess(claim, { policy, carrierInsuranceStatus });
        if (!a.eligible) {
          return res.status(409).json({ error: 'Claim is not eligible for platform coverage', assessment: a });
        }
        coveredAmountCents = a.coveredAmountCents;
        deductibleCents = a.deductibleCents;
      }

      platformCoverage.applyDecision(claim, policy, {
        action: req.body.action,
        coveredAmountCents,
        deductibleCents,
        reason: req.body.reason,
        reference: req.body.reference,
        adminId: req.user.userId,
      });

      if (policy) await policy.save();
      await claim.save();

      // Tell the claimant the platform stepped in.
      const link = claimsLink(claim.claimantRole);
      notifyUserSafe(claim.claimant.toString(), {
        type: 'claim:resolved',
        title: `Platform coverage ${claim.platformCoverage.status}`,
        body: claim.platformCoverage.status === 'denied'
          ? 'Platform cargo coverage was not approved for your claim.'
          : `Platform cargo coverage ${claim.platformCoverage.status}: $${((coveredAmountCents || 0) / 100).toLocaleString()}.`,
        link,
        metadata: { claimId: claim._id, platformCoverage: claim.platformCoverage.status },
      });

      res.json({ claim });
    } catch (err) {
      console.error('[claims] coverage decision failed:', err.message);
      res.status(500).json({ error: 'Failed to record coverage decision' });
    }
  }
);

// ────────────────────────────────────────────────────────────────────────────
// GET /api/claims/:id — single claim (admin OR either party)
// Kept LAST so segment routes above aren't swallowed by :id.
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id)
      .populate('loadId', 'title origin destination status rate postedBy acceptedBy')
      .populate('claimant', 'name email companyName')
      .populate('respondent', 'name email companyName')
      .populate('resolvedBy', 'name email')
      .populate('notes.author', 'name email role');
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const companyId = companyOf(req);
    const claimantId   = claim.claimant?._id ? claim.claimant._id : claim.claimant;
    const respondentId = claim.respondent?._id ? claim.respondent._id : claim.respondent;
    const isParty = String(claimantId) === String(companyId) ||
                    String(respondentId) === String(companyId);
    if (req.user.role !== 'admin' && !isParty) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(claim);
  } catch (err) {
    console.error('[claims] get failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch claim' });
  }
});

module.exports = router;
