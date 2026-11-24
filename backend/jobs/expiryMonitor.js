/**
 * Daily: warn before a driver credential or a wallet document expires.
 * Until now these dates were only shown on a page somebody had to open.
 *
 * ponytail: no "already warned" state. The job runs once a day and warns on fixed days
 * (30, 14, 7, 3, 1, 0 left, then weekly while expired); a day the server is down is a warning missed.
 * Add a per-document lastWarned field if that ever matters.
 */
const cron = require('node-cron');
const User = require('../models/User');
const ComplianceDoc = require('../models/ComplianceDoc');
const { notifyUserSafe } = require('../utils/notifyUser');
const { loginForDriver } = require('../services/driverLink');

const DAY = 86400000;
const WARN_DAYS = [30, 14, 7, 3, 1, 0];
const daysLeft = (expiry, now) => Math.floor((new Date(expiry).setUTCHours(0, 0, 0, 0) - new Date(now).setUTCHours(0, 0, 0, 0)) / DAY);
const due = (n) => WARN_DAYS.includes(n) || (n < 0 && n % 7 === 0);
const when = (n) => (n > 0 ? `expires in ${n} day${n === 1 ? '' : 's'}` : n === 0 ? 'expires today' : `expired ${-n} days ago`);
const KIND_LABEL = (k) => k.replace(/_/g, ' ');

async function runExpiryCheck(now = new Date()) {
  const stats = { warned: 0, errors: 0 };
  const send = (userId, what, n) => {
    stats.warned++;
    return notifyUserSafe(userId, {
      type: 'compliance:expiring',
      title: `${what} ${when(n)}`,
      body: n < 0 ? 'It is expired. Renew it and update the record.' : 'Renew it and update the record before it lapses.',
      link: '/dashboard/carrier/compliance',
      metadata: { priority: n <= 7 ? 'high' : 'normal' },
    });
  };
  try {
    // Driver credentials on the roster
    const owners = await User.find({ role: 'carrier', 'drivers.0': { $exists: true } }).select('drivers').lean();
    for (const owner of owners) {
      for (const d of owner.drivers) {
        if (d.status === 'inactive') continue;
        for (const [field, label] of [['licenseExpiry', 'CDL'], ['medicalCardExpiry', 'medical card'], ['hazmatExpiry', 'hazmat endorsement']]) {
          if (!d[field]) continue;
          const n = daysLeft(d[field], now);
          if (!due(n)) continue;
          try {
            await send(owner._id, `${d.name}'s ${label}`, n);
            const login = await loginForDriver(owner._id, d);
            if (login) await send(login, `Your ${label}`, n);
          } catch (e) { stats.errors++; }
        }
      }
    }
    // Wallet documents
    const docs = await ComplianceDoc.find({ expiresAt: { $ne: null, $lte: new Date(now.getTime() + 31 * DAY) } }).lean();
    for (const doc of docs) {
      const n = daysLeft(doc.expiresAt, now);
      if (!due(n)) continue;
      const subject = doc.subjectType === 'company' ? 'Company' : `${doc.subjectType[0].toUpperCase()}${doc.subjectType.slice(1)} ${doc.subjectId}`;
      try { await send(doc.company, `${subject}: ${doc.label || KIND_LABEL(doc.kind)}`, n); } catch (e) { stats.errors++; }
    }
  } catch (err) {
    stats.errors++;
    console.error('[ExpiryMonitor] run failed:', err.message);
  }
  if (stats.warned || stats.errors) console.log(`[ExpiryMonitor] warned=${stats.warned} errors=${stats.errors}`);
  return stats;
}

function start() {
  cron.schedule('0 7 * * *', () => { runExpiryCheck().catch(() => {}); });
  console.log('[ExpiryMonitor] Scheduled — runs daily at 07:00');
}

module.exports = { start, runExpiryCheck, daysLeft, due };
