// backend/models/AdminActivity.js
const mongoose = require('mongoose');
const AdminActivitySchema = new mongoose.Schema({
  type: String,
  date: Date,
  user: Object,
  description: String,
  loadId: String,
  link: String,
});
module.exports = mongoose.model('AdminActivity', AdminActivitySchema);
