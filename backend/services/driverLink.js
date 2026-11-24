/**
 * The link between a driver on the company roster (User.drivers[], what a load is assigned to)
 * and that driver's login (a sub-account with companyRole 'driver').
 *
 * The roster entry stores the login's id (drivers[].loginUserId). Entries made before that field
 * existed fall back to the old rule: exactly one active driver login carries the same name.
 */
const User = require('../models/User');

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The login id for a roster driver, or null. */
async function loginForDriver(companyId, driver) {
  if (!driver) return null;
  if (driver.loginUserId) {
    const ok = await User.exists({ _id: driver.loginUserId, parentAccountId: companyId, companyRole: 'driver', active: { $ne: false } });
    return ok ? driver.loginUserId : null;
  }
  const logins = await User.find({ parentAccountId: companyId, companyRole: 'driver', active: { $ne: false } }).select('name').lean();
  const hits = logins.filter((u) => norm(u.name) === norm(driver.name));
  return hits.length === 1 ? hits[0]._id : null;
}

/** The roster entry for a driver login, or null. `owner` needs drivers loaded. */
async function rosterDriverForLogin(owner, userId) {
  const drivers = (owner && owner.drivers) || [];
  const linked = drivers.find((d) => d.loginUserId && String(d.loginUserId) === String(userId));
  if (linked) return linked;
  const me = await User.findById(userId).select('name').lean();
  if (!me) return null;
  const hits = drivers.filter((d) => !d.loginUserId && norm(d.name) === norm(me.name));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Called when the owner creates a driver login: tie it to the roster entry with the same name,
 * or add a roster entry for it, so the new driver can be assigned loads straight away.
 */
async function linkNewDriverLogin(ownerRef, member) {
  const owner = await User.findById(ownerRef._id || ownerRef).select('drivers'); // the caller's copy may not have the roster loaded
  if (!owner) return;
  const free = (owner.drivers || []).filter((d) => !d.loginUserId && norm(d.name) === norm(member.name));
  if (free.length === 1) {
    free[0].loginUserId = member._id;
  } else {
    const taken = new Set((owner.drivers || []).map((d) => d.driverId));
    let driverId;
    do { driverId = 'drv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); } while (taken.has(driverId));
    owner.drivers.push({ driverId, name: member.name, loginUserId: member._id });
  }
  await owner.save();
}

module.exports = { loginForDriver, rosterDriverForLogin, linkNewDriverLogin, norm };
