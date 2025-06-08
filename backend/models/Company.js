// backend/models/Company.js

const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  address: String,
  contactEmail: String,
  phone: String,
  // Link to trucks/drivers if needed, e.g.
  // trucks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Truck' }]
}, { timestamps: true });

module.exports = mongoose.model('Company', CompanySchema);
