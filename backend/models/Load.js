// models/Load.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const loadSchema = new Schema({
  title: { type: String, required: true },
  origin: { type: String, required: true },
  originLat: { type: Number, required: true },
  originLng: { type: Number, required: true },
  destination: { type: String, required: true },
  destinationLat: { type: Number, required: true },
  destinationLng: { type: Number, required: true },
  equipmentType: { type: String, required: true },
  rate: { type: Number, required: true },
  postedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  acceptedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  status: {
    type: String,
    enum: ["open", "accepted", "delivered"],
    default: "open",
  },
}, { timestamps: true });

module.exports = mongoose.model("Load", loadSchema);
