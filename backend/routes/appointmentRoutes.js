/**
 * Appointment Routes — Pickup & Delivery Scheduling
 *
 * POST   /api/appointments                     — Create appointment record for a load (carrier)
 * GET    /api/appointments                     — List user's appointments (filtered by role + status + date)
 * GET    /api/appointments/:id                 — Detail
 * PATCH  /api/appointments/:id/request         — Carrier requests / updates a slot
 * PATCH  /api/appointments/:id/confirm         — Shipper confirms a slot
 * PATCH  /api/appointments/:id/reschedule      — Either party reschedules
 * PATCH  /api/appointments/:id/missed          — Mark a slot as missed
 * DELETE /api/appointments/:id                 — Cancel
 */

const express     = require('express');
const router      = express.Router();
const auth        = require('../middlewares/authMiddleware');
const Appointment = require('../models/Appointment');
const Load        = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

// ── POST / — create appointment record for an accepted load ──────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { loadId, pickup = {}, delivery = {} } = req.body;
    if (!loadId) return res.status(400).json({ error: 'loadId is required' });

    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only the carrier assigned to the load can create the appointment
    if (req.user.role === 'carrier' && load.acceptedBy?.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Only the assigned carrier can create an appointment' });
    }
    if (!['accepted', 'in-transit'].includes(load.status)) {
      return res.status(409).json({ error: 'Appointments can only be created for accepted or in-transit loads' });
    }

    // Prevent duplicate
    const existing = await Appointment.findOne({ load: loadId });
    if (existing) return res.status(409).json({ error: 'Appointment already exists for this load', appointmentId: existing._id });

    const now = new Date();
    const appt = await Appointment.create({
      load:     loadId,
      shipper:  load.postedBy,
      carrier:  load.acceptedBy,
      pickup: {
        ...pickup,
        requestedAt: pickup.scheduledAt ? now : undefined,
        status: pickup.scheduledAt ? 'pending' : undefined,
      },
      delivery: {
        ...delivery,
        requestedAt: delivery.scheduledAt ? now : undefined,
        status: delivery.scheduledAt ? 'pending' : undefined,
      },
      history: [{
        action: 'created',
        type: 'general',
        performedBy: req.user.userId,
        notes: 'Appointment record created',
      }],
    });

    // Notify shipper
    notifyUserSafe(load.postedBy.toString(), {
      type:  'load:status',
      title: 'Appointment requested',
      body:  `Carrier has submitted appointment details for load: ${load.title}`,
      link:  '/dashboard/shipper/appointments',
      metadata: { appointmentId: appt._id, loadId },
    });

    const populated = await Appointment.findById(appt._id)
      .populate('load',    'title origin destination')
      .populate('shipper', 'name companyName')
      .populate('carrier', 'name companyName');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Appointment create error:', err);
    res.status(500).json({ error: 'Failed to create appointment' });
  }
});

// ── GET / — list appointments ─────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const uid    = req.user.userId;
    const role   = req.user.role;
    const { status, from, to, type } = req.query;

    let filter = {};
    if (role === 'shipper') {
      filter.shipper = uid;
    } else if (role === 'carrier') {
      filter.carrier = uid;
    } else if (role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Date range filter
    if (from || to) {
      const dateFilter = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to)   dateFilter.$lte = new Date(to);
      if (!type || type === 'pickup') filter['pickup.scheduledAt']   = dateFilter;
      if (!type || type === 'delivery') filter['delivery.scheduledAt'] = dateFilter;
    }

    // Status filter on pickup or delivery
    if (status) {
      filter.$or = [
        { 'pickup.status': status },
        { 'delivery.status': status },
      ];
    }

    const appointments = await Appointment.find(filter)
      .populate('load',    'title origin destination status rate')
      .populate('shipper', 'name companyName email')
      .populate('carrier', 'name companyName email')
      .sort({ 'pickup.scheduledAt': 1 });

    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// ── GET /:id — detail ─────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id)
      .populate('load',    'title origin destination status rate pickupTimeWindow deliveryTimeWindow')
      .populate('shipper', 'name companyName email phone')
      .populate('carrier', 'name companyName email phone');
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      appt.shipper._id.toString() !== uid &&
      appt.carrier._id.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointment' });
  }
});

// ── PATCH /:id/request — carrier updates a pickup or delivery slot ────────────
router.patch('/:id/request', auth, async (req, res) => {
  try {
    const { apptType, scheduledAt, facilityName, contactName, contactPhone, notes } = req.body;
    if (!apptType || !['pickup', 'delivery'].includes(apptType)) {
      return res.status(400).json({ error: 'apptType must be "pickup" or "delivery"' });
    }
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt is required' });

    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    // Only carrier can request
    if (appt.carrier.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the carrier can request appointment slots' });
    }

    appt[apptType] = {
      ...appt[apptType].toObject(),
      scheduledAt:  new Date(scheduledAt),
      requestedAt:  new Date(),
      facilityName: facilityName || appt[apptType].facilityName,
      contactName:  contactName  || appt[apptType].contactName,
      contactPhone: contactPhone || appt[apptType].contactPhone,
      notes:        notes        || appt[apptType].notes,
      status:       'pending',
      confirmedAt:  null,
    };
    appt.history.push({ action: 'requested', type: apptType, performedBy: req.user.userId, notes });
    await appt.save();

    notifyUserSafe(appt.shipper.toString(), {
      type:  'load:status',
      title: `Appointment ${apptType} requested`,
      body:  `Carrier has requested a ${apptType} slot: ${new Date(scheduledAt).toLocaleString()}`,
      link:  '/dashboard/shipper/appointments',
      metadata: { appointmentId: appt._id },
    });

    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update appointment request' });
  }
});

// ── PATCH /:id/confirm — shipper confirms a pickup or delivery slot ───────────
router.patch('/:id/confirm', auth, async (req, res) => {
  try {
    const { apptType, notes } = req.body;
    if (!apptType || !['pickup', 'delivery'].includes(apptType)) {
      return res.status(400).json({ error: 'apptType must be "pickup" or "delivery"' });
    }

    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    if (appt.shipper.toString() !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the shipper can confirm appointments' });
    }
    if (appt[apptType].status !== 'pending') {
      return res.status(409).json({ error: `${apptType} appointment is not pending` });
    }

    appt[apptType].status      = 'confirmed';
    appt[apptType].confirmedAt = new Date();
    appt.history.push({ action: 'confirmed', type: apptType, performedBy: req.user.userId, notes });
    await appt.save();

    notifyUserSafe(appt.carrier.toString(), {
      type:  'bid:accepted',
      title: `${apptType.charAt(0).toUpperCase() + apptType.slice(1)} appointment confirmed`,
      body:  `Your ${apptType} appointment at ${appt[apptType].scheduledAt?.toLocaleString()} has been confirmed`,
      link:  '/dashboard/carrier/appointments',
      metadata: { appointmentId: appt._id },
    });

    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm appointment' });
  }
});

// ── PATCH /:id/reschedule — either party proposes a new time ─────────────────
router.patch('/:id/reschedule', auth, async (req, res) => {
  try {
    const { apptType, scheduledAt, notes } = req.body;
    if (!apptType || !['pickup', 'delivery'].includes(apptType)) {
      return res.status(400).json({ error: 'apptType must be "pickup" or "delivery"' });
    }
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt is required' });

    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      appt.shipper.toString() !== uid &&
      appt.carrier.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    appt[apptType].scheduledAt = new Date(scheduledAt);
    appt[apptType].status      = 'rescheduled';
    appt[apptType].confirmedAt = null;
    appt.history.push({ action: 'rescheduled', type: apptType, performedBy: uid, notes });
    await appt.save();

    // Notify the other party
    const isShipper = appt.shipper.toString() === uid;
    const notifyId  = isShipper ? appt.carrier.toString() : appt.shipper.toString();
    notifyUserSafe(notifyId, {
      type:  'exception:new',
      title: `Appointment ${apptType} rescheduled`,
      body:  `${apptType} appointment has been rescheduled to ${new Date(scheduledAt).toLocaleString()}`,
      link:  isShipper ? '/dashboard/carrier/appointments' : '/dashboard/shipper/appointments',
      metadata: { appointmentId: appt._id },
    });

    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to reschedule appointment' });
  }
});

// ── PATCH /:id/missed — mark a slot as missed ─────────────────────────────────
router.patch('/:id/missed', auth, async (req, res) => {
  try {
    const { apptType, notes } = req.body;
    if (!apptType || !['pickup', 'delivery'].includes(apptType)) {
      return res.status(400).json({ error: 'apptType must be "pickup" or "delivery"' });
    }

    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      appt.shipper.toString() !== uid &&
      appt.carrier.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    appt[apptType].status = 'missed';
    appt.history.push({ action: 'missed', type: apptType, performedBy: uid, notes });
    await appt.save();

    const isShipper = appt.shipper.toString() === uid;
    const notifyId  = isShipper ? appt.carrier.toString() : appt.shipper.toString();
    notifyUserSafe(notifyId, {
      type:  'exception:new',
      title: `Missed ${apptType} appointment`,
      body:  `The ${apptType} appointment was marked as missed`,
      link:  isShipper ? '/dashboard/carrier/appointments' : '/dashboard/shipper/appointments',
      metadata: { appointmentId: appt._id },
    });

    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark appointment as missed' });
  }
});

// ── DELETE /:id — cancel appointment ─────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const uid = req.user.userId;
    if (
      req.user.role !== 'admin' &&
      appt.shipper.toString() !== uid &&
      appt.carrier.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    appt.pickup.status   = 'cancelled';
    appt.delivery.status = 'cancelled';
    appt.history.push({ action: 'cancelled', type: 'general', performedBy: uid });
    await appt.save();

    const isShipper = appt.shipper.toString() === uid;
    const notifyId  = isShipper ? appt.carrier.toString() : appt.shipper.toString();
    notifyUserSafe(notifyId, {
      type:  'exception:new',
      title: 'Appointment cancelled',
      body:  'The appointment has been cancelled',
      link:  isShipper ? '/dashboard/carrier/appointments' : '/dashboard/shipper/appointments',
      metadata: { appointmentId: appt._id },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
});

module.exports = router;
