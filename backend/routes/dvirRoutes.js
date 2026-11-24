/**
 * /api/dvir: driver vehicle inspection reports.
 * Any carrier login (drivers included) files and reads them; only a manager certifies a repair.
 */
const express = require('express');
const { body, param, query } = require('express-validator');
const auth = require('../middlewares/authMiddleware');
const validate = require('../middlewares/validate');
const { managerOnly } = require('../middlewares/companyRoles');
const Dvir = require('../models/Dvir');
const User = require('../models/User');
const Load = require('../models/Load');
const { notifyUserSafe } = require('../utils/notifyUser');

const router = express.Router();
const { ITEMS } = Dvir;
const companyOf = (req) => String(req.user.companyOwnerId || req.user.userId);
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').trim() : v);
const carrierOnly = (req, res, next) => (req.user.role === 'carrier' ? next() : res.status(403).json({ error: 'Carriers only' }));

const view = (d) => ({
  _id: d._id, truckId: d.truckId, trailerId: d.trailerId, type: d.type, odometer: d.odometer, location: d.location,
  defects: d.defects, safeToOperate: d.safeToOperate, remarks: d.remarks, driverName: d.driverName, signedName: d.signedName,
  load: d.load, createdAt: d.createdAt, repair: d.repair && d.repair.at ? d.repair : null,
  outOfService: !d.safeToOperate && !(d.repair && d.repair.at),
});

// What the inspection and wallet forms need to offer: the checklist and the company's trucks and drivers (names only).
router.get('/checklist', auth, carrierOnly, async (req, res) => {
  try {
    const owner = await User.findById(companyOf(req)).select('fleet.truckId drivers.driverId drivers.name').lean();
    res.json({
      data: ITEMS,
      trucks: ((owner && owner.fleet) || []).map((t) => t.truckId),
      drivers: ((owner && owner.drivers) || []).map((d) => ({ driverId: d.driverId, name: d.name })),
    });
  } catch (err) {
    console.error('[dvir checklist] failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', auth, carrierOnly,
  body('truckId').customSanitizer(clean).isLength({ min: 1, max: 60 }).withMessage('truckId is required'),
  body('trailerId').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 60 }),
  body('type').isIn(['pre_trip', 'post_trip']).withMessage('type must be pre_trip or post_trip'),
  body('odometer').optional({ checkFalsy: true }).isFloat({ min: 0, max: 9999999 }).withMessage('odometer must be a number'),
  body('location').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 200 }),
  body('loadId').optional({ checkFalsy: true }).isMongoId().withMessage('Invalid loadId'),
  body('defects').optional().isArray({ max: ITEMS.length }).withMessage('defects must be a list'),
  body('defects.*.item').isIn(ITEMS).withMessage('Unknown inspection item'),
  body('defects.*.note').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 300 }),
  body('safeToOperate').isBoolean().withMessage('safeToOperate must be true or false').toBoolean(),
  body('remarks').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 1000 }),
  body('signedName').customSanitizer(clean).isLength({ min: 2, max: 120 }).withMessage('Type your name to sign the report'),
  validate,
  async (req, res) => {
    try {
      const company = companyOf(req);
      const owner = await User.findById(company).select('fleet.truckId name').lean();
      if (!owner || !(owner.fleet || []).some((t) => t.truckId === req.body.truckId)) {
        return res.status(400).json({ error: 'That truck is not in your fleet' });
      }
      const defects = (req.body.defects || []).map((d) => ({ item: d.item, note: d.note || undefined }));
      if (!req.body.safeToOperate && defects.length === 0) {
        return res.status(400).json({ error: 'List the defect that makes the truck unsafe' });
      }
      if (req.body.loadId && !(await Load.exists({ _id: req.body.loadId, acceptedBy: company }))) {
        return res.status(400).json({ error: 'That load is not booked by your company' });
      }
      const me = await User.findById(req.user.userId).select('name').lean();
      const report = await Dvir.create({
        company, driverUser: req.user.userId, driverName: (me && me.name) || req.body.signedName,
        truckId: req.body.truckId, trailerId: req.body.trailerId || undefined, load: req.body.loadId || null,
        type: req.body.type, odometer: req.body.odometer || undefined, location: req.body.location || undefined,
        defects, safeToOperate: req.body.safeToOperate, remarks: req.body.remarks || undefined, signedName: req.body.signedName,
      });

      if (defects.length) {
        // The people who can get it repaired: the owner and the dispatchers.
        const managers = await User.find({ parentAccountId: company, companyRole: 'dispatcher', active: { $ne: false } }).select('_id').lean();
        for (const id of [company, ...managers.map((m) => String(m._id))]) {
          if (id === String(req.user.userId)) continue;
          await notifyUserSafe(id, { // never throws
            type: 'dvir:defect',
            title: report.safeToOperate ? `Defect reported on truck ${report.truckId}` : `Truck ${report.truckId} is out of service`,
            body: `${report.driverName}: ${defects.map((d) => d.item).join(', ')}.${report.safeToOperate ? '' : ' It cannot start a load until the repair is certified.'}`,
            link: '/dashboard/carrier/compliance',
            metadata: { dvirId: report._id, truckId: report.truckId, priority: report.safeToOperate ? 'normal' : 'high' },
          });
        }
      }
      res.status(201).json({ success: true, data: view(report) });
    } catch (err) {
      console.error('[dvir create] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

router.get('/', auth, carrierOnly,
  query('truckId').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 60 }),
  validate,
  async (req, res) => {
    try {
      const filter = { company: companyOf(req) };
      if (req.query.truckId) filter.truckId = String(req.query.truckId);
      const reports = await Dvir.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ data: reports.map(view) });
    } catch (err) {
      console.error('[dvir list] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

// A manager certifies the repair (or that none was needed). One time; the report is then closed.
router.post('/:id/certify', auth, carrierOnly, managerOnly,
  param('id').isMongoId().withMessage('Invalid id'),
  body('repaired').isBoolean().withMessage('repaired must be true or false').toBoolean(),
  body('certifiedName').customSanitizer(clean).isLength({ min: 2, max: 120 }).withMessage('Type your name to certify'),
  body('note').optional({ checkFalsy: true }).customSanitizer(clean).isLength({ max: 1000 }),
  validate,
  async (req, res) => {
    try {
      const report = await Dvir.findOneAndUpdate(
        { _id: req.params.id, company: companyOf(req), 'defects.0': { $exists: true }, 'repair.at': null },
        { $set: { repair: { at: new Date(), by: req.user.userId, certifiedName: req.body.certifiedName, repaired: req.body.repaired, note: req.body.note || null } } },
        { new: true }
      );
      if (!report) return res.status(409).json({ error: 'Report not found, has no defects, or is already certified' });
      if (String(report.driverUser) !== String(req.user.userId)) {
        notifyUserSafe(report.driverUser, {
          type: 'dvir:certified',
          title: `Truck ${report.truckId}: repair certified`,
          body: `${req.body.certifiedName} certified that ${req.body.repaired ? 'the defects were repaired' : 'no repair was needed for safe operation'}.`,
          link: '/dashboard/carrier/compliance',
          metadata: { dvirId: report._id, truckId: report.truckId },
        });
      }
      res.json({ success: true, data: view(report) });
    } catch (err) {
      console.error('[dvir certify] failed:', err.message);
      res.status(500).json({ error: 'Server error' });
    }
  });

module.exports = router;
