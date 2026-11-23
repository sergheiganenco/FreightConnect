/**
 * Pickup handshake — proves at the dock that the truck being loaded belongs to
 * the carrier that booked the load (anti impersonation / double-brokering).
 *
 * The booked carrier's logged-in app shows a 6-digit code (Load.pickupVerification.code,
 * issued by the Load model hook on every booking path). The dock (no account) or the
 * shipper enters what the driver shows. Attempts are reserved ATOMICALLY before the
 * comparison so parallel guessing cannot exceed MAX_ATTEMPTS.
 */
const crypto = require('crypto');
const Load = require('../models/Load');
const User = require('../models/User');
const StatusHistory = require('../models/StatusHistory');
const { notifyUserSafe } = require('../utils/notifyUser');

const MAX_ATTEMPTS = 5;
const DOCK_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// ── Stateless dock-link token: <loadId>.<expiry>.<hmac> ──────────────────────
// Same secret rule as trackingIngestRoutes: NO hardcoded fallback, fail closed.
function getSecret() {
  const secret = process.env.TRACKING_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('TRACKING_TOKEN_SECRET or JWT_SECRET must be configured for dock tokens');
  return secret;
}
// `purpose` is part of what is signed, so a pickup (dock) link can never be used as a delivery (receive) link.
function sign(loadId, exp, purpose = 'dock') {
  return crypto.createHmac('sha256', getSecret()).update(`${purpose}:${loadId}.${exp}`).digest('hex').slice(0, 32);
}
function signDockToken(loadId, purpose = 'dock', ttlMs = DOCK_TOKEN_TTL_MS) {
  const exp = Math.floor((Date.now() + ttlMs) / 1000).toString(36);
  return { token: `${loadId}.${exp}.${sign(loadId, exp, purpose)}`, expiresAt: new Date(parseInt(exp, 36) * 1000) };
}
/** @returns {{loadId}|{error:'invalid'|'expired'}} — never throws (secret missing → invalid). */
function parseDockToken(token, purpose = 'dock') {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !/^[a-f0-9]{24}$/.test(parts[0]) || !/^[a-z0-9]{1,10}$/.test(parts[1])) return { error: 'invalid' };
  let expected;
  try { expected = sign(parts[0], parts[1], purpose); } catch (_) { return { error: 'invalid' }; }
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: 'invalid' };
  if (parseInt(parts[1], 36) * 1000 < Date.now()) return { error: 'expired' };
  return { loadId: parts[0] };
}

async function carrierIdentity(carrierId) {
  // The dock relies on this to spot an impersonator, so it never presents typed data
  // as verified. Three states:
  //  - identityVerified: FMCSA record found AND the account's control of that company
  //    was confirmed (verification.identityVerified === true).
  //  - authorityOnFile: FMCSA says this authority exists and is active, but nothing has
  //    confirmed THIS account controls it (anyone can type a real carrier's DOT number).
  //  - neither: self-reported profile values only.
  // Numbers shown for an FMCSA record are only those FMCSA returned (null = not confirmed).
  const c = await User.findById(carrierId)
    .select('companyName name mcNumber dotNumber verification.status verification.identityVerified verification.fmcsaData.legalName verification.fmcsaData.dbaName verification.fmcsaData.dotNumber verification.fmcsaData.mcNumber')
    .lean();
  if (!c) return null;
  const v = c.verification || {};
  if (v.status === 'verified' && v.fmcsaData && v.fmcsaData.legalName) {
    return {
      companyName: v.fmcsaData.legalName,
      dbaName: v.fmcsaData.dbaName || null,
      mcNumber: v.fmcsaData.mcNumber || null,
      dotNumber: v.fmcsaData.dotNumber || null,
      identityVerified: v.identityVerified === true,
      authorityOnFile: true,
    };
  }
  return { companyName: c.companyName || c.name, mcNumber: c.mcNumber || null, dotNumber: c.dotNumber || null, identityVerified: false, authorityOnFile: false };
}

function audit(loadId, from, to, userId, reason) {
  return StatusHistory.record('load', loadId, from, to, userId, reason).catch(() => {});
}

/** Public dock view: only what a dock worker needs. Never rate/finance/code. */
async function dockInfo(loadId) {
  const load = await Load.findById(loadId).select(
    'title status acceptedBy shipperReferenceNumber poNumber origin pickupFacilityName pickupAddress pickupTimeWindow assignedTruckId assignedDriverName pickupVerification.verifiedAt pickupVerification.lockedAt pickupVerification.failedAttempts'
  ).lean();
  if (!load) return null;
  const pv = load.pickupVerification || {};
  const booked = ['accepted', 'in-transit'].includes(load.status) && load.acceptedBy;
  return {
    state: !booked ? 'not_booked' : pv.verifiedAt ? 'verified' : pv.lockedAt ? 'locked' : 'pending',
    loadTitle: load.title,
    reference: load.shipperReferenceNumber || load.poNumber || null,
    origin: load.origin,
    facility: load.pickupFacilityName || null,
    address: load.pickupAddress || null,
    pickupWindow: load.pickupTimeWindow || null,
    carrier: booked ? await carrierIdentity(load.acceptedBy) : null,
    truckId: booked ? load.assignedTruckId || null : null,
    driverName: booked ? load.assignedDriverName || null : null,
    verifiedAt: pv.verifiedAt || null,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - (pv.failedAttempts || 0)),
  };
}

/**
 * Check a submitted code. Shared by the public dock endpoint and the in-app
 * shipper/admin endpoint.
 * @returns {Promise<{http:number, body:object}>}
 */
async function attemptVerify({ loadId, code, verifiedBy, actorId = null }) {
  const submitted = String(code == null ? '' : code).trim();
  if (!/^\d{6}$/.test(submitted)) return { http: 400, body: { error: 'Enter the 6-digit code shown by the driver' } };

  const settled = async () => {
    const load = await Load.findById(loadId).select('status acceptedBy pickupVerification.verifiedAt pickupVerification.lockedAt pickupVerification.failedAttempts').lean();
    if (!load) return { http: 404, body: { error: 'Load not found' } };
    const pv = load.pickupVerification || {};
    if (pv.verifiedAt) return { http: 200, body: { verified: true, alreadyVerified: true, verifiedAt: pv.verifiedAt, carrier: await carrierIdentity(load.acceptedBy) } };
    if (pv.lockedAt) return { http: 423, body: { error: 'Verification is locked after too many wrong codes. Ask the shipper to unlock it.', locked: true, attemptsRemaining: 0 } };
    return { http: 409, body: { error: 'This load is not awaiting pickup verification' } };
  };

  // Reserve an attempt atomically (only succeeds while unlocked/unverified and < MAX).
  const reserved = await Load.findOneAndUpdate(
    {
      _id: loadId,
      status: 'accepted',
      acceptedBy: { $ne: null },
      'pickupVerification.code': { $exists: true },
      'pickupVerification.verifiedAt': null,
      'pickupVerification.lockedAt': null,
      'pickupVerification.failedAttempts': { $not: { $gte: MAX_ATTEMPTS } },
    },
    { $inc: { 'pickupVerification.failedAttempts': 1 } },
    { new: true }
  ).select('+pickupVerification.code');
  if (!reserved) return settled();

  const a = Buffer.from(submitted);
  const b = Buffer.from(String(reserved.pickupVerification.code));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (match) {
    const now = new Date();
    const done = await Load.findOneAndUpdate(
      { _id: loadId, status: 'accepted', 'pickupVerification.verifiedAt': null },
      { $set: { 'pickupVerification.verifiedAt': now, 'pickupVerification.verifiedBy': verifiedBy, 'pickupVerification.failedAttempts': 0 } },
      { new: true }
    );
    if (!done) return settled();
    await audit(loadId, 'pickup_unverified', 'pickup_verified', actorId, `Pickup code verified (${verifiedBy})`);
    const carrier = await carrierIdentity(done.acceptedBy);
    const payload = {
      type: 'load:pickup_verified',
      title: 'Pickup verified',
      body: `"${done.title}" — driver verified at pickup${carrier ? ` (${carrier.companyName})` : ''}.`,
      metadata: { loadId: done._id, verifiedBy },
    };
    notifyUserSafe(done.postedBy, { ...payload, link: '/dashboard/shipper/loads' });
    notifyUserSafe(done.acceptedBy, { ...payload, link: '/dashboard/carrier/my-loads' });
    return { http: 200, body: { verified: true, verifiedAt: now, carrier } };
  }

  const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - reserved.pickupVerification.failedAttempts);
  if (attemptsRemaining === 0) {
    const locked = await Load.findOneAndUpdate(
      { _id: loadId, 'pickupVerification.lockedAt': null },
      { $set: { 'pickupVerification.lockedAt': new Date() } },
      { new: true }
    );
    if (locked) {
      await audit(loadId, 'pickup_unverified', 'pickup_locked', actorId, `Pickup verification locked after ${MAX_ATTEMPTS} wrong codes`);
      notifyUserSafe(locked.postedBy, {
        type: 'load:pickup_verification_failed',
        title: 'Pickup verification failed 5 times',
        body: `Pickup verification failed ${MAX_ATTEMPTS} times for load "${locked.title}" — possible impersonation. Do not release the freight.`,
        link: '/dashboard/shipper/loads',
        metadata: { loadId: locked._id, priority: 'high' },
      });
    }
    return { http: 423, body: { error: 'Wrong code. Verification is now locked — do not release the freight; contact the shipper.', locked: true, attemptsRemaining: 0 } };
  }
  return { http: 400, body: { error: 'Incorrect code', verified: false, attemptsRemaining } };
}

/** Shipper/admin unlock after a lockout. */
async function unlock({ loadId, actorId }) {
  const load = await Load.findOneAndUpdate(
    { _id: loadId, status: 'accepted', 'pickupVerification.lockedAt': { $ne: null } },
    { $set: { 'pickupVerification.failedAttempts': 0 }, $unset: { 'pickupVerification.lockedAt': 1 } },
    { new: true }
  );
  if (load) await audit(loadId, 'pickup_locked', 'pickup_unverified', actorId, 'Pickup verification unlocked');
  return !!load;
}

module.exports = { MAX_ATTEMPTS, signDockToken, parseDockToken, carrierIdentity, dockInfo, attemptVerify, unlock };
