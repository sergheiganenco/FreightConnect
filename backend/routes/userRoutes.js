const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middlewares/authMiddleware'); // Updated import

const router = express.Router();

// Signup Route
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
    });

    await newUser.save();

    return res.status(201).json({
      message: 'User created successfully',
      user: { _id: newUser._id, name: newUser.name, email: newUser.email, role: newUser.role },
    });
  } catch (err) {
    console.error('Error in /signup:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Login Route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Server error' });
  }
});



// WhoAmI Route
router.get('/whoami', auth, (req, res) => {
  res.json({ user: req.user });
});

// Get User Profile
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password'); // Exclude password
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user); // Return user details
  } catch (err) {
    console.error('Error in GET /profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update User Profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.name = name || user.name;
    user.email = email || user.email;

    const updatedUser = await user.save();
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Error in /profile PUT:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Update Carrier Location
router.put('/update-location', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.role !== 'carrier') {
      return res.status(403).json({ error: 'Access denied' });
    }

    user.location = req.body.location;
    await user.save();

    res.json({ message: 'Location updated', location: user.location });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update Carrier Location
router.put('/update-location', auth, async (req, res) => {
  try {
      if (req.user.role !== 'carrier') {
          return res.status(403).json({ error: 'Access denied: Only carriers can update location' });
      }

      const { latitude, longitude } = req.body;
      if (!latitude || !longitude) {
          return res.status(400).json({ error: 'Latitude and longitude are required' });
      }

      const user = await User.findById(req.user.userId);
      if (!user) {
          return res.status(404).json({ error: 'User not found' });
      }

      // Save new location in the database
      user.location = { latitude, longitude };
      await user.save();

      res.json({ message: 'Location updated successfully', location: user.location });
  } catch (err) {
      console.error('Error updating location:', err);
      res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
