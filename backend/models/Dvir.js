/**
 * Driver vehicle inspection report (49 CFR 396.11 / 396.13).
 *
 * A driver files one for a truck. When it lists a defect that makes the truck unsafe, the truck
 * stays out of service until a manager certifies the repair (or certifies that no repair was needed).
 * Reports are never edited or deleted.
 */
const mongoose = require('mongoose');
const { Schema, Types: { ObjectId } } = mongoose;

// The parts 396.11 lists, plus the trailer.
const ITEMS = [
  'Service brakes', 'Parking brake', 'Steering', 'Lights and reflectors', 'Tires', 'Horn',
  'Windshield wipers', 'Mirrors', 'Coupling devices', 'Wheels and rims', 'Emergency equipment',
  'Trailer: brakes', 'Trailer: lights', 'Trailer: tires and wheels', 'Trailer: doors and landing gear', 'Other',
];

const DvirSchema = new Schema({
  company:    { type: ObjectId, ref: 'User', required: true },   // the carrier company (owner id)
  driverUser: { type: ObjectId, ref: 'User', required: true },   // the login that filed it
  driverName: { type: String, required: true, maxlength: 120 },
  truckId:    { type: String, required: true, maxlength: 60 },   // User.fleet[].truckId
  trailerId:  { type: String, maxlength: 60 },
  load:       { type: ObjectId, ref: 'Load', default: null },
  type:       { type: String, enum: ['pre_trip', 'post_trip'], required: true },
  odometer:   { type: Number, min: 0, max: 9999999 },
  location:   { type: String, maxlength: 200 },
  defects: [{
    _id: false,
    item: { type: String, enum: ITEMS, required: true },
    note: { type: String, maxlength: 300 },
  }],
  safeToOperate: { type: Boolean, required: true },
  remarks:    { type: String, maxlength: 1000 },
  signedName: { type: String, required: true, maxlength: 120 },  // the driver's typed signature
  // Certification of repair, by a manager. `repaired: false` = "repair not needed for safe operation".
  repair: {
    at:            { type: Date, default: null },
    by:            { type: ObjectId, ref: 'User', default: null },
    certifiedName: { type: String, maxlength: 120, default: null },
    repaired:      { type: Boolean, default: null },
    note:          { type: String, maxlength: 1000, default: null },
  },
}, { timestamps: true });

DvirSchema.index({ company: 1, createdAt: -1 });
DvirSchema.index({ company: 1, truckId: 1, safeToOperate: 1, 'repair.at': 1 });

const Dvir = mongoose.model('Dvir', DvirSchema);

/** True when the truck has an unsafe report nobody has certified. */
Dvir.outOfService = (companyId, truckId) =>
  Dvir.exists({ company: companyId, truckId, safeToOperate: false, 'repair.at': null });

module.exports = Dvir;
module.exports.ITEMS = ITEMS;
