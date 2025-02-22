// models/User.js
const mongoose = require("mongoose");
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: { type: String, enum: ["shipper", "carrier", "admin"] },
  location: {
    latitude: Number,
    longitude: Number,
  },
  // or currentLocation: { lat: Number, lng: Number },
});

module.exports = mongoose.model("User", userSchema);
