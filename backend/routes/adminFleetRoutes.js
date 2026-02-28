const express = require('express');
const router = express.Router();
const auth = require('../middlewares/authMiddleware');
const Company = require('../models/Company');
const Truck = require('../models/Truck');
const User = require('../models/User');

// List companies with search/filter/pagination
router.get('/companies', auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { page = 1, limit = 10, search = "", status } = req.query;
  const query = {};
  if (status) query.status = status;
  if (search) query.name = { $regex: search, $options: "i" };
  const total = await Company.countDocuments(query);
  const companies = await Company.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));
  res.json({ companies, total, page: Number(page), totalPages: Math.ceil(total / limit) });
});

// Get full details for a company (trucks + drivers)
router.get('/companies/:id', auth, async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ error: "Not found" });
  const trucks = await Truck.find({ companyId: company._id });
  const drivers = await User.find({ companyId: company._id });
  res.json({ company, trucks, drivers });
});

// (Optionally: POST for new company, PUT for edit, PATCH for suspend/reactivate)
module.exports = router;
