const mongoose = require('mongoose');
const truckSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  plate: { type: String, required: true },
  make: String,
  model: String,
  year: Number,
  type: String,
  assignedDriver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, default: "active" },
  currentLocation: {
    lat: Number,
    lng: Number,
    city: String
  },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Truck', truckSchema);
