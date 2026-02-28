// models/Company.js
const mongoose = require('mongoose');
const companyNormalize = require('../utils/companyNormalize');

const companySchema = new mongoose.Schema({
  name: { type: String, required: true },
  // Normalized field for deduplication (lowercase, stripped of common suffixes)
  normalized: { type: String, index: true, unique: true, default: null },

  type: { type: String, enum: ['carrier', 'shipper', 'broker', 'other'], default: 'carrier' },
  dotNumber: { type: String },         // US DOT number, if any
  mcNumber: { type: String },          // MC number, if any
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  fleetSize: { type: Number, default: 0 },  // Number of trucks (optional)
  phone: { type: String },                  // Optional contact info
  address: { type: String },                // Optional address
  email: { type: String },                  // Optional company contact email

  createdAt: { type: Date, default: Date.now },
});

// Ensure normalized is always set when creating/updating
companySchema.pre('save', function (next) {
  if (this.name) {
    this.normalized = companyNormalize(this.name);
  }
  next();
});



module.exports = mongoose.model('Company', companySchema);
