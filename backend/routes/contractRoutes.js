/**
 * Contract Routes — Dedicated Lanes & Recurring Freight
 *
 * POST   /api/contracts                              — Create contract (shipper)
 * GET    /api/contracts                              — List user's contracts
 * GET    /api/contracts/:id                          — Contract detail
 * PUT    /api/contracts/:id                          — Update contract (draft/active)
 * DELETE /api/contracts/:id                          — Cancel/terminate
 * POST   /api/contracts/:id/assign-carrier           — Assign a carrier
 * DELETE /api/contracts/:id/carrier/:carrierId       — Remove a carrier
 * POST   /api/contracts/:id/approve                  — Carrier accepts assignment
 * POST   /api/contracts/:id/reject                   — Carrier rejects assignment
 * POST   /api/contracts/:id/pause                    — Pause contract
 * POST   /api/contracts/:id/resume                   — Resume contract
 * GET    /api/contracts/:id/performance              — Performance metrics
 * GET    /api/contracts/:id/loads                    — Loads generated from this contract
 * POST   /api/contracts/:id/rate-review              — Initiate rate renegotiation
 */

const express = require('express');
const router  = express.Router();
const auth    = require('../middlewares/authMiddleware');
const Contract = require('../models/Contract');
const Load     = require('../models/Load');
const User     = require('../models/User');
const { generateContractNumber } = require('../utils/contractNumberGenerator');
const { notifyUserSafe }         = require('../utils/notifyUser');

const SHIPPER_ONLY = (req, res, next) => {
  if (req.user.role !== 'shipper' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Shippers only' });
  }
  next();
};

const CARRIER_ONLY = (req, res, next) => {
  if (req.user.role !== 'carrier' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Carriers only' });
  }
  next();
};

// ── POST /api/contracts — create contract ─────────────────────────────────────
router.post('/', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const contractNumber = await generateContractNumber();
    const contract = await Contract.create({
      ...req.body,
      contractNumber,
      shipper: req.user.userId,
      status: 'draft',
      'history': [{
        action: 'created',
        performedBy: req.user.userId,
        details: 'Contract created',
      }],
    });
    res.status(201).json(contract);
  } catch (err) {
    console.error('Contract create error:', err);
    res.status(500).json({ error: 'Failed to create contract' });
  }
});

// ── GET /api/contracts — list user's contracts ────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const uid    = req.user.userId;
    const role   = req.user.role;
    const status = req.query.status;

    let filter = {};
    if (role === 'shipper') {
      filter.shipper = uid;
    } else if (role === 'carrier') {
      filter['assignedCarriers.carrier'] = uid;
    } else if (role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (status && status !== 'all') filter.status = status;

    const contracts = await Contract.find(filter)
      .populate('shipper',                   'name companyName email')
      .populate('assignedCarriers.carrier',  'name companyName email trustScore')
      .sort({ updatedAt: -1 });

    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contracts' });
  }
});

// ── GET /api/contracts/:id — contract detail ──────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id)
      .populate('shipper',                   'name companyName email phone')
      .populate('assignedCarriers.carrier',  'name companyName email trustScore verification.status')
      .populate('history.performedBy',       'name role');
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    // Access check
    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      contract.shipper._id.toString() !== uid &&
      !contract.assignedCarriers.some(ac => ac.carrier._id.toString() === uid)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contract' });
  }
});

// ── PUT /api/contracts/:id — update contract ──────────────────────────────────
router.put('/:id', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!['draft', 'active', 'paused'].includes(contract.status)) {
      return res.status(409).json({ error: `Cannot edit a ${contract.status} contract` });
    }

    const allowed = [
      'title', 'lane', 'equipmentType', 'hazardousMaterial', 'temperatureControlled',
      'temperatureRange', 'specialRequirements', 'pricing', 'volume', 'autoPost', 'terms',
      'useAutoMatching',
    ];
    allowed.forEach(k => { if (req.body[k] !== undefined) contract[k] = req.body[k]; });
    contract.history.push({ action: 'updated', performedBy: req.user.userId, details: 'Contract updated' });
    await contract.save();
    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update contract' });
  }
});

// ── DELETE /api/contracts/:id — cancel/terminate ──────────────────────────────
router.delete('/:id', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const newStatus = contract.status === 'draft' ? 'cancelled' : 'terminated';
    contract.status = newStatus;
    contract.history.push({ action: newStatus, performedBy: req.user.userId });
    await contract.save();

    // Notify assigned carriers
    for (const ac of contract.assignedCarriers) {
      if (ac.status === 'active') {
        notifyUserSafe(ac.carrier.toString(), {
          type:  'load:status',
          title: 'Contract terminated',
          body:  `Contract ${contract.contractNumber} — ${contract.title} has been terminated by the shipper`,
          link:  '/dashboard/carrier/contracts',
          metadata: { contractId: contract._id },
        });
      }
    }
    res.json({ ok: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel contract' });
  }
});

// ── POST /api/contracts/:id/assign-carrier ────────────────────────────────────
router.post('/:id/assign-carrier', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const { carrierId, allocation = 100 } = req.body;
    if (!carrierId) return res.status(400).json({ error: 'carrierId is required' });

    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const carrier = await User.findById(carrierId).select('name companyName role');
    if (!carrier || carrier.role !== 'carrier') {
      return res.status(404).json({ error: 'Carrier not found' });
    }
    if (contract.assignedCarriers.some(ac => ac.carrier.toString() === carrierId && ac.status !== 'removed')) {
      return res.status(409).json({ error: 'Carrier already assigned' });
    }

    contract.assignedCarriers.push({ carrier: carrierId, allocation, assignedAt: new Date(), status: 'pending' });
    if (contract.status === 'draft') contract.status = 'pending_approval';
    contract.history.push({ action: 'carrier_assigned', performedBy: req.user.userId, details: `Assigned ${carrier.companyName || carrier.name}` });
    await contract.save();

    notifyUserSafe(carrierId, {
      type:  'bid:new',
      title: 'New contract assignment',
      body:  `You've been assigned to contract ${contract.contractNumber}: ${contract.title}. Review and accept or decline.`,
      link:  '/dashboard/carrier/contracts',
      metadata: { contractId: contract._id },
    });

    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign carrier' });
  }
});

// ── DELETE /api/contracts/:id/carrier/:carrierId — remove carrier ─────────────
router.delete('/:id/carrier/:carrierId', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const ac = contract.assignedCarriers.find(a => a.carrier.toString() === req.params.carrierId);
    if (!ac) return res.status(404).json({ error: 'Carrier not on this contract' });
    ac.status = 'removed';
    contract.history.push({ action: 'carrier_removed', performedBy: req.user.userId });
    await contract.save();

    notifyUserSafe(req.params.carrierId, {
      type:  'load:status',
      title: 'Removed from contract',
      body:  `You have been removed from contract ${contract.contractNumber}: ${contract.title}`,
      link:  '/dashboard/carrier/contracts',
      metadata: { contractId: contract._id },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove carrier' });
  }
});

// ── POST /api/contracts/:id/approve — carrier accepts ────────────────────────
router.post('/:id/approve', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const ac = contract.assignedCarriers.find(a => a.carrier.toString() === req.user.userId && a.status === 'pending');
    if (!ac) return res.status(404).json({ error: 'No pending assignment found' });

    ac.status = 'active';
    // If all assigned carriers have responded, activate contract
    const allActive = contract.assignedCarriers.every(a => a.status !== 'pending');
    if (allActive && contract.status === 'pending_approval') contract.status = 'active';

    contract.history.push({ action: 'carrier_approved', performedBy: req.user.userId });
    await contract.save();

    notifyUserSafe(contract.shipper.toString(), {
      type:  'bid:accepted',
      title: 'Carrier accepted contract',
      body:  `A carrier has accepted assignment on contract ${contract.contractNumber}`,
      link:  '/dashboard/shipper/contracts',
      metadata: { contractId: contract._id },
    });

    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve contract' });
  }
});

// ── POST /api/contracts/:id/reject — carrier declines ────────────────────────
router.post('/:id/reject', auth, CARRIER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const ac = contract.assignedCarriers.find(a => a.carrier.toString() === req.user.userId && a.status === 'pending');
    if (!ac) return res.status(404).json({ error: 'No pending assignment found' });

    ac.status = 'removed';
    contract.history.push({ action: 'carrier_rejected', performedBy: req.user.userId });
    await contract.save();

    notifyUserSafe(contract.shipper.toString(), {
      type:  'bid:rejected',
      title: 'Carrier declined contract',
      body:  `A carrier has declined the assignment on contract ${contract.contractNumber}`,
      link:  '/dashboard/shipper/contracts',
      metadata: { contractId: contract._id },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject contract' });
  }
});

// ── POST /api/contracts/:id/pause ─────────────────────────────────────────────
router.post('/:id/pause', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (contract.status !== 'active') {
      return res.status(409).json({ error: 'Only active contracts can be paused' });
    }
    contract.status = 'paused';
    contract.history.push({ action: 'paused', performedBy: req.user.userId });
    await contract.save();
    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause contract' });
  }
});

// ── POST /api/contracts/:id/resume ────────────────────────────────────────────
router.post('/:id/resume', auth, SHIPPER_ONLY, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    if (contract.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (contract.status !== 'paused') {
      return res.status(409).json({ error: 'Only paused contracts can be resumed' });
    }
    contract.status = 'active';
    contract.history.push({ action: 'resumed', performedBy: req.user.userId });
    await contract.save();
    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume contract' });
  }
});

// ── GET /api/contracts/:id/performance ───────────────────────────────────────
router.get('/:id/performance', auth, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).lean();
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      contract.shipper.toString() !== uid &&
      !contract.assignedCarriers.some(ac => ac.carrier.toString() === uid)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Real-time stats from Load model
    const loads = await Load.find({ contractId: contract._id }).lean();
    const completed = loads.filter(l => l.status === 'delivered').length;
    const inProgress = loads.filter(l => ['accepted', 'in-transit'].includes(l.status)).length;
    const totalRevenue = loads
      .filter(l => l.status === 'delivered')
      .reduce((sum, l) => sum + (l.rate || 0), 0);

    res.json({
      contractNumber:     contract.contractNumber,
      title:              contract.title,
      status:             contract.status,
      performance:        contract.performance,
      realTime: {
        totalLoads:      loads.length,
        completed,
        inProgress,
        open:            loads.filter(l => l.status === 'open').length,
        totalRevenue,
        completionRate:  loads.length ? Math.round((completed / loads.length) * 100) : 0,
      },
      volume: contract.volume,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch performance' });
  }
});

// ── GET /api/contracts/:id/loads — loads from this contract ──────────────────
router.get('/:id/loads', auth, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).lean();
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      contract.shipper.toString() !== uid &&
      !contract.assignedCarriers.some(ac => ac.carrier.toString() === uid)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const page  = parseInt(req.query.page,  10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const [loads, total] = await Promise.all([
      Load.find({ contractId: contract._id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('acceptedBy', 'name companyName'),
      Load.countDocuments({ contractId: contract._id }),
    ]);
    res.json({ loads, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contract loads' });
  }
});

// ── POST /api/contracts/:id/rate-review — initiate rate renegotiation ─────────
router.post('/:id/rate-review', auth, async (req, res) => {
  try {
    const { newRateCents, reason, effectiveFrom } = req.body;
    if (!newRateCents) return res.status(400).json({ error: 'newRateCents is required' });

    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      contract.shipper.toString() !== uid &&
      !contract.assignedCarriers.some(ac => ac.carrier.toString() === uid)
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Record old rate in history
    contract.pricing.rateHistory.push({
      rateCents:     contract.pricing.rateCents,
      effectiveFrom: contract.terms.startDate,
      effectiveTo:   effectiveFrom ? new Date(effectiveFrom) : new Date(),
      reason:        'Pre-review rate',
    });
    contract.pricing.rateCents    = newRateCents;
    contract.pricing.rateReviewDate = new Date();
    contract.history.push({ action: 'rate_review', performedBy: uid, details: reason || 'Rate updated' });
    await contract.save();

    // Notify the other party
    const notifyId = contract.shipper.toString() === uid
      ? contract.assignedCarriers.find(ac => ac.status === 'active')?.carrier?.toString()
      : contract.shipper.toString();
    if (notifyId) {
      notifyUserSafe(notifyId, {
        type:  'bid:countered',
        title: 'Contract rate updated',
        body:  `Rate on contract ${contract.contractNumber} has been updated`,
        link:  req.user.role === 'shipper'
          ? '/dashboard/shipper/contracts'
          : '/dashboard/carrier/contracts',
        metadata: { contractId: contract._id },
      });
    }

    res.json(contract);
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit rate review' });
  }
});

module.exports = router;
