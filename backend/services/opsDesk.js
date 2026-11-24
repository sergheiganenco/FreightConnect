/**
 * opsDesk.js — one queue of everything that needs a person, each case with a rule-based recommendation.
 *
 * The method (strict, in this order):
 *  1. A fixed rule that can settle a case does so in code (autoResolve) and leaves a note saying which rule.
 *  2. Every other case is listed with a proposal: an action, the rule that produced it, and the evidence it used.
 *     "review" means the rules have no opinion and a person must decide.
 *  3. Proposals never act. They are recorded (OpsProposal) and compared with what the person then decided, so each
 *     rule has a measured accuracy before anything is made automatic.
 *  4. Money above CLAIM_REVIEW_LIMIT_CENTS, and anything that blocks an account, always needs a person.
 * Text written by users (descriptions, notes) is shown as evidence and never interpreted as an instruction.
 */
const Claim = require('../models/Claim');
const Exception = require('../models/Exception');
const ReviewQueue = require('../models/ReviewQueue');
const FraudAlert = require('../models/FraudAlert');
const Notification = require('../models/Notification');
const User = require('../models/User');
const Load = require('../models/Load');
const OpsProposal = require('../models/OpsProposal');
const Payment = require('../models/Payment');

const CLAIM_REVIEW_LIMIT_CENTS = Number(process.env.OPS_CLAIM_REVIEW_LIMIT_CENTS) || 50000; // $500
const HOUR = 60 * 60 * 1000;
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const propose = (action, rule, reason) => ({ action, rule, reason });
const review = (reason) => ({ action: 'review', rule: null, reason });

const RULE_LABELS = {
  'claim.receiver_noted_problem': 'Claim: approve when the receiver recorded the problem at delivery',
  'claim.clean_receipt_no_evidence': 'Claim: deny when the receiver signed clean and no evidence is attached',
  'exception.load_gone': 'Issue: dismiss when the load no longer exists',
  'exception.load_cancelled': 'Issue: dismiss when the load was cancelled',
  'exception.delay_delivered': 'Late load: resolve once delivered',
  'exception.pickup_happened': 'Missed pickup: resolve once picked up',
  'verification.authority_not_active': 'Carrier: reject when federal authority is not active',
  'verification.insurance_below_minimum': 'Carrier: reject when insurance is below the federal minimum',
  'verification.authority_and_insurance_ok': 'Carrier: approve when authority is active and insurance meets the minimum',
};

// ── Rules (pure: record in, proposal out) ────────────────────────────────────
function claimProposal(claim, load) {
  const sig = load?.deliverySignature || {};
  const receiverSigned = sig.signedByRole === 'receiver' && sig.signedAt;
  const facts = [];
  if (!load) return review('The load for this claim no longer exists.');
  if (load.status !== 'delivered') return review(`The load has not been delivered yet (status: ${load.status}), so there is no delivery record to judge the claim against.`);
  if (receiverSigned) facts.push(sig.note ? `The receiver signed and recorded: "${String(sig.note).slice(0, 200)}"` : 'The receiver signed for the delivery and recorded no shortage or damage');
  else facts.push('There is no receiver signature on record for this delivery');
  if (claim.evidenceUrls?.length) facts.push(`${claim.evidenceUrls.length} file(s) attached by the claimant`);
  const summary = facts.join('. ') + '.';
  if (claim.amountCents > CLAIM_REVIEW_LIMIT_CENTS) return review(`${summary} The claim (${money(claim.amountCents)}) is above the ${money(CLAIM_REVIEW_LIMIT_CENTS)} limit, so a person decides.`);
  if (['damage', 'shortage', 'loss'].includes(claim.type) && claim.claimantRole === 'shipper') {
    if (receiverSigned && sig.note) return propose('approve', 'claim.receiver_noted_problem', `${summary} The receiver's own record supports the claim.`);
    if (receiverSigned && !sig.note && !claim.evidenceUrls?.length) return propose('deny', 'claim.clean_receipt_no_evidence', `${summary} Nothing on record supports the claim.`);
  }
  return review(summary);
}

function exceptionProposal(ex, load) {
  if (!load) return propose('dismiss', 'exception.load_gone', 'The load no longer exists.');
  if (load.status === 'cancelled') return propose('dismiss', 'exception.load_cancelled', 'The load was cancelled.');
  if (ex.type === 'delay' && load.status === 'delivered') return propose('resolve', 'exception.delay_delivered', 'The load has since been delivered.');
  if (ex.type === 'missed_pickup' && ['in-transit', 'delivered'].includes(load.status)) return propose('resolve', 'exception.pickup_happened', 'The load has since been picked up.');
  return review(ex.claimAmount ? `Money is in dispute (${money(Math.round(ex.claimAmount * 100))}).` : 'No rule covers this one.');
}

function carrierVerificationProposal(user, { lookupOn }) {
  const v = user.verification || {};
  if (!lookupOn) return review('The federal carrier lookup is switched off, so authority and insurance cannot be checked automatically.');
  const f = v.fmcsaData || {};
  if (!f.legalName) return review('The federal record has not been found for the number this carrier entered.');
  const active = require('./fmcsaService').verifyAuthority(f); // the same judgement the verification flow uses
  if (!active) return propose('deny', 'verification.authority_not_active', `Federal record: ${f.legalName}, operating status "${f.operatingStatus || 'unknown'}".`);
  if (v.insurance?.meetsFederalMinimum === false) return propose('deny', 'verification.insurance_below_minimum', `Federal record: ${f.legalName}. Insurance on file is below the federal minimum.`);
  if (v.insurance?.meetsFederalMinimum === true) return propose('approve', 'verification.authority_and_insurance_ok', `Federal record: ${f.legalName}, authority active, insurance meets the federal minimum.`);
  return review(`Federal record: ${f.legalName}, authority active. Insurance could not be confirmed.`);
}

// ── Step 1: what a rule can settle outright ──────────────────────────────────
/** A late-load warning the system raised itself is closed once that load is delivered. Nothing a person filed is touched. */
async function autoResolve() {
  const stale = await Exception.find({ status: { $in: ['open', 'investigating'] }, autoFlagged: true, filedByRole: 'system', type: 'delay' }).select('loadId').lean();
  if (!stale.length) return 0;
  const delivered = await Load.find({ _id: { $in: stale.map((e) => e.loadId) }, status: 'delivered' }).select('_id').lean();
  if (!delivered.length) return 0;
  const r = await Exception.updateMany(
    { _id: { $in: stale.filter((e) => delivered.some((l) => String(l._id) === String(e.loadId))).map((e) => e._id) }, status: { $in: ['open', 'investigating'] } },
    { $set: { status: 'resolved', resolvedAt: new Date(), resolution: 'Closed automatically: the load was delivered (rule exception.system_delay_delivered).' } }
  );
  return r.modifiedCount || 0;
}

// ── Step 2: the queue ────────────────────────────────────────────────────────
async function collectCases({ adminId, env = process.env } = {}) {
  const open = { $in: ['open', 'investigating'] };
  const [claims, exceptions, reviews, frauds, carriers, shippers, contacts, stuckPayouts, unpaidFees] = await Promise.all([
    Claim.find({ status: open }).sort({ createdAt: 1 }).limit(200).lean(),
    Exception.find({ status: open }).sort({ createdAt: 1 }).limit(200).lean(),
    ReviewQueue.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(200).populate('subjectUser', 'companyName name').lean(),
    FraudAlert.find({ status: open }).sort({ createdAt: 1 }).limit(200).populate('user', 'companyName name').lean(),
    User.find({ role: 'carrier', 'verification.status': 'pending' }).select('companyName name verification createdAt updatedAt').limit(200).lean(),
    User.find({ role: 'shipper', 'shipperVerification.status': 'pending' }).select('companyName name createdAt updatedAt').limit(200).lean(),
    adminId ? Notification.find({ userId: adminId, type: 'contact:message', read: false }).sort({ createdAt: 1 }).limit(100).lean() : [],
    // Money taken from the shipper but not yet sent on: every hour it sits is a carrier waiting to be paid.
    Payment.find({ status: 'captured', updatedAt: { $lt: new Date(Date.now() - HOUR) } }).sort({ updatedAt: 1 }).limit(100).lean(),
    // A fee (detention, cancelled truck) already collected from the shipper but not yet passed on to the carrier.
    Load.find({ accessorialCharges: { $elemMatch: { status: 'approved', shipperPaymentStatus: 'collected' } } }).select('title accessorialCharges').limit(100).lean(),
  ]);
  const loadIds = [...claims, ...exceptions].map((c) => c.loadId);
  const loads = loadIds.length
    ? await Load.find({ _id: { $in: loadIds } }).select('title status deliverySignature.signedAt deliverySignature.signedByRole deliverySignature.note').lean()
    : [];
  const loadOf = (id) => loads.find((l) => String(l._id) === String(id));
  const name = (u) => (u && (u.companyName || u.name)) || 'Unknown company';
  const now = Date.now();
  const age = (d) => Math.max(0, Math.round((now - new Date(d || now).getTime()) / HOUR));

  const cases = [
    ...unpaidFees.flatMap((l) => l.accessorialCharges.filter((c) => c.status === 'approved' && c.shipperPaymentStatus === 'collected').map((c) => ({
      kind: 'payout', id: c._id, title: `Collected fee not paid to the carrier: ${c.type}, ${money(c.amountCents)}`, detail: l.title,
      severity: 'critical', ageHours: age(c.approvedAt), link: '/dashboard/admin/ledger',
      proposal: review('The shipper has paid this fee, but it has not been sent to the carrier (often because the carrier has not finished payout setup, or a factoring notice is on file).'),
    }))),
    ...stuckPayouts.map((p) => ({
      kind: 'payout', id: p._id, title: `Carrier payout not sent: ${money(p.carrierPayoutCents ?? p.amountCents)}`, detail: `Load ${p.loadId}`,
      severity: 'critical', ageHours: age(p.updatedAt), link: '/dashboard/admin/ledger', retryPayoutId: p._id,
      proposal: review('The shipper has been charged, but the payout to the carrier (or its factoring company) has not gone out. "Send payout" tries again; it refuses if a factoring notice is on file or the carrier has no payout account.'),
    })),
    ...claims.map((c) => ({
      kind: 'claim', id: c._id, title: `Cargo claim: ${c.type}, ${money(c.amountCents)}`, detail: loadOf(c.loadId)?.title || null,
      severity: c.amountCents > CLAIM_REVIEW_LIMIT_CENTS ? 'high' : 'medium', ageHours: age(c.createdAt), link: '/dashboard/admin/claims', proposal: claimProposal(c, loadOf(c.loadId)),
    })),
    ...exceptions.map((e) => ({
      kind: 'exception', id: e._id, title: e.title, detail: loadOf(e.loadId)?.title || null,
      severity: e.severity || 'medium', ageHours: age(e.createdAt), link: '/dashboard/admin/exceptions', proposal: exceptionProposal(e, loadOf(e.loadId)),
    })),
    ...frauds.map((f) => ({
      kind: 'fraud', id: f._id, title: `Fraud alert: ${String(f.type).replace(/_/g, ' ')}`, detail: name(f.user),
      severity: f.severity, ageHours: age(f.createdAt), link: '/dashboard/admin/review-queue', proposal: review('Blocking an account always needs a person.'),
    })),
    ...reviews.map((r) => ({
      kind: 'review', id: r._id, title: `Account review: ${String(r.type).replace(/_/g, ' ')}`, detail: name(r.subjectUser),
      severity: r.severity || 'high', ageHours: age(r.createdAt), link: '/dashboard/admin/review-queue', proposal: review(r.reason ? `Flagged because: ${String(r.reason).slice(0, 200)}` : 'Blocking an account always needs a person.'),
    })),
    ...carriers.map((u) => ({
      kind: 'carrier_verification', id: u._id, title: 'Carrier waiting for verification', detail: name(u),
      severity: age(u.updatedAt) > 24 ? 'high' : 'medium', ageHours: age(u.updatedAt), link: '/dashboard/admin/verifications', proposal: carrierVerificationProposal(u, { lookupOn: !!env.FMCSA_API_KEY }),
    })),
    ...shippers.map((u) => ({
      kind: 'shipper_verification', id: u._id, title: 'Shipper waiting for verification', detail: name(u),
      severity: 'medium', ageHours: age(u.updatedAt), link: '/dashboard/admin/verifications', proposal: review('Shipper documents are checked by a person.'),
    })),
    ...contacts.map((n) => ({
      kind: 'contact', id: n._id, title: n.title, detail: String(n.body || '').slice(0, 300),
      severity: 'low', ageHours: age(n.createdAt), link: null, proposal: review('A reply is needed. Replies are sent by a person.'),
    })),
  ];
  cases.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2) || b.ageHours - a.ageHours);
  return cases;
}

// ── Step 3: shadow mode ──────────────────────────────────────────────────────
/** Remember each proposal the first time it is made (later changes in the evidence do not rewrite history). */
async function recordProposals(cases) {
  const ops = cases.filter((c) => c.proposal.action !== 'review').map((c) => ({
    updateOne: {
      filter: { kind: c.kind, caseId: c.id },
      update: { $setOnInsert: { kind: c.kind, caseId: c.id, action: c.proposal.action, rule: c.proposal.rule, reason: c.proposal.reason, source: 'rules' } },
      upsert: true,
    },
  }));
  if (ops.length) await OpsProposal.bulkWrite(ops, { ordered: false });
}

const FINAL = {
  claim: { model: Claim, path: 'status', map: { resolved: 'approve', denied: 'deny' } },
  exception: { model: Exception, path: 'status', map: { resolved: 'resolve', dismissed: 'dismiss' } },
  carrier_verification: { model: User, path: 'verification.status', map: { verified: 'approve', rejected: 'deny' } },
};

/** For proposals whose case a person has since closed: record the decision and whether the rule matched it. */
async function settleProposals() {
  const pending = await OpsProposal.find({ outcome: null }).limit(500).lean();
  for (const kind of Object.keys(FINAL)) {
    const mine = pending.filter((p) => p.kind === kind);
    if (!mine.length) continue;
    const { model, path, map } = FINAL[kind];
    const docs = await model.find({ _id: { $in: mine.map((p) => p.caseId) } }).select(path).lean();
    for (const p of mine) {
      const doc = docs.find((d) => String(d._id) === String(p.caseId));
      const status = doc && path.split('.').reduce((o, k) => (o ? o[k] : undefined), doc);
      const outcome = map[status];
      if (outcome) await OpsProposal.updateOne({ _id: p._id, outcome: null }, { $set: { outcome, agreed: outcome === p.action, decidedAt: new Date() } });
    }
  }
}

/** Per rule: how often a person decided the same way. */
async function accuracy() {
  const rows = await OpsProposal.aggregate([
    { $match: { outcome: { $ne: null } } },
    { $group: { _id: '$rule', decided: { $sum: 1 }, agreed: { $sum: { $cond: ['$agreed', 1, 0] } } } },
    { $sort: { decided: -1 } },
  ]);
  return rows.map((r) => ({ rule: r._id, label: RULE_LABELS[r._id] || r._id, decided: r.decided, agreed: r.agreed }));
}

async function getDesk({ adminId } = {}) {
  const autoResolved = await autoResolve();
  const cases = await collectCases({ adminId });
  await recordProposals(cases);
  await settleProposals();
  return { cases, autoResolved, accuracy: await accuracy(), claimReviewLimitCents: CLAIM_REVIEW_LIMIT_CENTS };
}

module.exports = { getDesk, collectCases, autoResolve, recordProposals, settleProposals, accuracy, claimProposal, exceptionProposal, carrierVerificationProposal, CLAIM_REVIEW_LIMIT_CENTS };
