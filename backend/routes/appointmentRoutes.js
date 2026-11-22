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

// Companies, not people: dispatchers/drivers act for their carrier company (owner account id).
const companyOf = (req) => String(req.user.companyOwnerId || req.user.userId);
const FROZEN_LEG = ['cancelled', 'missed']; // history: a new appointment request is the way forward

// Authorise a MUTATION against the load's CURRENT booking, not just the appointment's stored parties:
// the acting company must be the load's booked carrier (acceptedBy) or its shipper (postedBy), the load must be
// accepted/in-transit, the appointment must belong to this booking, and a cancelled/missed leg is frozen.
// `allow` lists the sides ('carrier'|'shipper') that may do this. Sends the error and returns null, or returns the side.
async function authoriseMutation(req, res, appt, allow, apptType) {
  const deny = (code, error) => { res.status(code).json({ error }); return null; };
  const admin = req.user.role === 'admin';
  const load = await Load.findById(appt.load).select('postedBy acceptedBy status');
  if (!load) return deny(404, 'Load not found');
  const me = companyOf(req);
  const side = admin ? 'admin' : me === String(load.acceptedBy) ? 'carrier' : me === String(load.postedBy) ? 'shipper' : null;
  if (!side || (!admin && !allow.includes(side))) return deny(403, 'Forbidden');
  if (!admin) {
    if (!['accepted', 'in-transit'].includes(load.status)) return deny(409, 'This load is not currently booked');
    if (String(appt.carrier) !== String(load.acceptedBy) || String(appt.shipper) !== String(load.postedBy)) {
      return deny(409, 'This appointment belongs to a previous booking of the load');
    }
  }
  if (apptType && FROZEN_LEG.includes(appt[apptType]?.status)) return deny(409, `The ${apptType} appointment is ${appt[apptType].status} and cannot be changed; request a new appointment`);
  return side;
}

// A carrier that no longer holds the load keeps its own (cancelled/missed) record but sees only the load's
// identity, never the current booking's status or rate.
function redactForFormerCarrier(appt, req) {
  const o = appt.toObject ? appt.toObject() : appt;
  if (!o.load) return o;
  if (req.user.role === 'carrier' && String(o.load.acceptedBy || '') !== companyOf(req)) {
    o.load = { _id: o.load._id, title: o.load.title, origin: o.load.origin, destination: o.load.destination };
  } else delete o.load.acceptedBy;
  return o;
}

// ── POST / — create appointment record for an accepted load ──────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { loadId, pickup = {}, delivery = {} } = req.body;
    if (!loadId) return res.status(400).json({ error: 'loadId is required' });

    const load = await Load.findById(loadId);
    if (!load) return res.status(404).json({ error: 'Load not found' });

    // Only the load's CURRENT booked carrier company (or its shipper company) can create the appointment
    const me = companyOf(req);
    if (req.user.role === 'carrier' ? load.acceptedBy?.toString() !== me
      : req.user.role === 'shipper' ? load.postedBy?.toString() !== me
      : req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the assigned carrier can create an appointment' });
    }
    if (!['accepted', 'in-transit'].includes(load.status)) {
      return res.status(409).json({ error: 'Appointments can only be created for accepted or in-transit loads' });
    }

    // Prevent duplicate
    // A record with no live leg left (load cancelled / re-listed) must not block the next carrier's booking.
    const live = { $in: ['pending', 'confirmed', 'rescheduled'] };
    const existing = await Appointment.findOne({ load: loadId, carrier: load.acceptedBy, $or: [{ 'pickup.status': live }, { 'delivery.status': live }] });
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
    const role   = req.user.role;
    const { status, from, to, type } = req.query;

    let filter = {};
    if (role === 'shipper') {
      filter.shipper = companyOf(req);
    } else if (role === 'carrier') {
      filter.carrier = companyOf(req);
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
      .populate('load',    'title origin destination status rate acceptedBy')
      .populate('shipper', 'name companyName email')
      .populate('carrier', 'name companyName email')
      .sort({ 'pickup.scheduledAt': 1 });

    res.json(appointments.map((a) => redactForFormerCarrier(a, req)));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// ── GET /:id — detail ─────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id)
      .populate('load',    'title origin destination status rate pickupTimeWindow deliveryTimeWindow acceptedBy')
      .populate('shipper', 'name companyName email phone')
      .populate('carrier', 'name companyName email phone');
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    const uid = companyOf(req);
    if (
      req.user.role !== 'admin' &&
      appt.shipper._id.toString() !== uid &&
      appt.carrier._id.toString() !== uid
    ) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(redactForFormerCarrier(appt, req));
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

    // Only the load's current booked carrier can request
    if (!await authoriseMutation(req, res, appt, ['carrier'], apptType)) return;

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

    if (!await authoriseMutation(req, res, appt, ['shipper'], apptType)) return;
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

    const uid = req.user.userId; // the person, for the audit trail
    const side = await authoriseMutation(req, res, appt, ['carrier', 'shipper'], apptType);
    if (!side) return;

    appt[apptType].scheduledAt = new Date(scheduledAt);
    appt[apptType].status      = 'rescheduled';
    appt[apptType].confirmedAt = null;
    appt.history.push({ action: 'rescheduled', type: apptType, performedBy: uid, notes });
    await appt.save();

    // Notify the other party
    const isShipper = side === 'shipper';
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

    const uid = req.user.userId; // the person, for the audit trail
    const side = await authoriseMutation(req, res, appt, ['carrier', 'shipper'], apptType);
    if (!side) return;

    appt[apptType].status = 'missed';
    appt.history.push({ action: 'missed', type: apptType, performedBy: uid, notes });
    await appt.save();

    const isShipper = side === 'shipper';
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

    const uid = req.user.userId; // the person, for the audit trail
    const side = await authoriseMutation(req, res, appt, ['carrier', 'shipper']);
    if (!side) return;
    // Only live legs are cancelled: a missed/cancelled leg is history and stays as it is.
    const liveLegs = ['pickup', 'delivery'].filter((l) => !FROZEN_LEG.includes(appt[l]?.status));
    if (!liveLegs.length) return res.status(409).json({ error: 'Both legs are already cancelled or missed' });
    liveLegs.forEach((l) => { appt[l].status = 'cancelled'; });
    appt.history.push({ action: 'cancelled', type: 'general', performedBy: uid });
    await appt.save();

    const isShipper = side === 'shipper';
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
