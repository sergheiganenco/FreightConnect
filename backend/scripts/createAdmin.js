/**
 * createAdmin.js — seed the first admin account on a REAL database (Atlas/prod).
 * After this, create pilot shipper/carrier accounts through the admin UI
 * (Dashboard → Users → Create User), which exercises the real flow.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://…" node scripts/createAdmin.js admin@yourco.com "StrongPass123!" "Your Name"
 *   (or put MONGO_URI in backend/.env and omit the env prefix)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

(async () => {
  const [email, password, name = 'Admin'] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: node scripts/createAdmin.js <email> <password> [name]');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set (env or backend/.env).');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Use a password of at least 10 characters for an admin account.');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require('../models/User');

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.error(`A user with ${email} already exists (role: ${existing.role}). Nothing done.`);
      process.exit(1);
    }

    await User.create({
      name,
      email: email.toLowerCase(),
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      emailVerified: true,
      onboardingComplete: true,
      mfa: { enabled: false },
      tosAccepted: true,
      tosAcceptedAt: new Date(),
      tosVersion: '1.0',
    });
    console.log(`✓ Admin created: ${email}`);
    console.log('  Log in and create pilot shipper/carrier accounts via Dashboard → Users.');
    process.exit(0);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
})();
