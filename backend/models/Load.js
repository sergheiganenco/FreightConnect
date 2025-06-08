const mongoose = require('mongoose');

const LoadSchema = new mongoose.Schema({
  title: { type: String, required: true },
  origin: { type: String, required: true },
  originLat: Number,
  originLng: Number,
  destination: { type: String, required: true },
  destinationLat: Number,
  destinationLng: Number,
  rate: { type: Number, required: true },
  equipmentType: { type: String, required: true },
  pickupTimeWindow: {
    start: Date,
    end: Date,
  },
  deliveryTimeWindow: {
    start: Date,
    end: Date,
  },
  loadWeight: Number,
  loadDimensions: {
    length: Number,
    width: Number,
    height: Number,
  },
  commodityType: String,
  specialInstructions: String,
  hazardousMaterial: Boolean,
  status: { type: String, default: 'open' },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  assignedTruckId: { type: String, default: null },
  deliveredAt: { type: Date, default: null },             // <-- NEW
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, // <-- NEW
}, { timestamps: true });


module.exports = mongoose.model('Load', LoadSchema);

