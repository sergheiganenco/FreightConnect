/**
 * Trip — Multi-Load Route Planning
 *
 * Represents a planned or active driving trip that groups one or more
 * loads together into an optimized route. Carriers use this to plan
 * their day/week, track mileage, and manage fuel stops.
 */

const mongoose = require('mongoose');

const WaypointSchema = new mongoose.Schema({
  type:       { type: String, enum: ['origin', 'delivery', 'fuel', 'rest', 'custom'], required: true },
  name:       String,
  address:    String,
  city:       String,
  state:      String,
  latitude:   Number,
  longitude:  Number,
  load:       { type: mongoose.Schema.Types.ObjectId, ref: 'Load', default: null },
  scheduledAt: Date,
  completedAt: Date,
  notes:      String,
  status:     { type: String, enum: ['pending', 'arrived', 'completed', 'skipped'], default: 'pending' },
}, { _id: true });

const FuelStopSchema = new mongoose.Schema({
  location:    String,
  gallons:     Number,
  pricePerGallon: Number,
  totalCost:   Number,
  recordedAt:  { type: Date, default: Date.now },
}, { _id: false });

const TripSchema = new mongoose.Schema({
  carrier:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  truck:       { type: String },           // truckId from carrier's fleet
  name:        { type: String, required: true },
  status: {
    type: String,
    enum: ['planned', 'active', 'completed', 'cancelled'],
    default: 'planned',
    index: true,
  },

  // Loads included in this trip (in order)
  loads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Load' }],

  // Detailed waypoints (auto-built from loads + manual additions)
  waypoints: [WaypointSchema],

  // Route metrics (from OpenRouteService or manual)
  route: {
    totalDistanceMiles: Number,
    estimatedDurationHours: Number,
    estimatedFuelGallons: Number,
    mpg: { type: Number, default: 6.5 }, // typical trucking MPG
  },

  // Dates
  plannedDepartureAt:  Date,
  actualDepartureAt:   Date,
  plannedArrivalAt:    Date,
  actualArrivalAt:     Date,

  // Fuel tracking
  fuelStops: [FuelStopSchema],
  totalFuelCostCents:  { type: Number, default: 0 },

  // Odometer
  startOdometer:  Number,
  endOdometer:    Number,

  notes: String,

  history: [{
    action:      String,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp:   { type: Date, default: Date.now },
    details:     String,
  }],
}, { timestamps: true });

TripSchema.index({ carrier: 1, status: 1 });
TripSchema.index({ plannedDepartureAt: 1 });

module.exports = mongoose.model('Trip', TripSchema);
