const mongoose = require('mongoose');

const TruckSchema = new mongoose.Schema({
  name: { type: String, required: true },
  company: { type: String }, // company name or company ID if you want to link
  driver: { type: String },
  utilization: { type: Number, default: 0 },
  miles: { type: Number, default: 0 },
  deadhead: { type: Number, default: 0 },
  profit: { type: Number, default: 0 },
  lastMaint: { type: Date },
  issues: { type: Number, default: 0 },
  // Add other truck-specific fields as needed
}, { timestamps: true });

module.exports = mongoose.model('Truck', TruckSchema);
