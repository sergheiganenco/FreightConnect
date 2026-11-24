/**
 * Integration: money records never say something that did not happen.
 * - an accessorial transfer never marks the freight payment released; refunded/disputed payments are never overwritten
 * - a leftover hold from an earlier booking is cancelled, not reused for a different carrier or amount
 * - a captured payment whose payout has not gone out appears on the operations desk
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const mockStripe = {
  customers: { create: jest.fn(async () => ({ id: 'cus_1' })) },
  paymentIntents: {
    create: jest.fn(async (args, opts) => ({ id: `pi_${mockStripe.paymentIntents.create.mock.calls.length}`, client_secret: 'secret', args, opts })),
    cancel: jest.fn(async () => ({ status: 'canceled' })),
    capture: jest.fn(async (id) => ({ id, amount: 100000, latest_charge: 'ch_1', metadata: {} })),
  },
  refunds: { create: jest.fn(async (p) => ({ id: 're_1', amount: p.amount })) },
  transfers: { create: jest.fn(async () => ({ id: 'tr_tonu' })) },
};
jest.mock('stripe', () => () => mockStripe);

require('../setup');
const Payment = require('../../models/Payment');
const Load = require('../../models/Load');
const { createTestUser, createTestLoad } = require('../helpers');
const { handleWebhookEvent } = require('../../services/webhookHandler');
const { createEscrowHoldForLoad } = require('../../routes/paymentRoutes');
const desk = require('../../services/opsDesk');

let n = 0;
const transferEvent = (metadata) => ({ id: `evt_${Date.now()}_${n += 1}`, type: 'transfer.created', data: { object: { id: `tr_${n}`, amount: 5000, metadata } } });

async function scene(status, extra = {}) {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: carrier._id, rate: 1000 });
  const payment = await Payment.create({
    loadId: load._id, shipperId: shipper._id, carrierId: carrier._id, amountCents: 100000, platformFeeCents: 2000, carrierPayoutCents: 98000,
    amount: 1000, platformFee: 20, carrierPayout: 980, status, stripePaymentIntentId: `pi_old_${Date.now()}_${n += 1}`, ...extra,
  });
  return { shipper, carrier, load, payment };
}
const statusOf = async (p) => (await Payment.findById(p._id)).status;

test('an accessorial transfer never releases the freight payment; refunded and disputed payments stay as they are', async () => {
  const held = await scene('in_escrow');
  await handleWebhookEvent(transferEvent({ loadId: String(held.load._id), accessorialType: 'detention' }));
  expect(await statusOf(held.payment)).toBe('in_escrow');

  for (const s of ['refunded', 'disputed', 'cancelled']) {
    const x = await scene(s);
    await handleWebhookEvent(transferEvent({ loadId: String(x.load._id), paymentIntentId: x.payment.stripePaymentIntentId }));
    expect(await statusOf(x.payment)).toBe(s);
  }

  // the real freight payout still does
  const cap = await scene('captured');
  await handleWebhookEvent(transferEvent({ loadId: String(cap.load._id), paymentIntentId: cap.payment.stripePaymentIntentId, type: 'carrier_payout' }));
  expect(await statusOf(cap.payment)).toBe('released');
});

test('a leftover hold from an earlier booking is cancelled and replaced; a hold for this booking is reused', async () => {
  const { load, payment, shipper } = await scene('pending');
  // same carrier, same amount: reuse, and the load points at it again
  const same = await createEscrowHoldForLoad(load._id);
  expect(same.paymentIntentId).toBe(payment.stripePaymentIntentId);
  expect((await Load.findById(load._id)).escrowPaymentIntentId).toBe(payment.stripePaymentIntentId);
  expect(mockStripe.paymentIntents.create).not.toHaveBeenCalled();

  // rebooked to another carrier at another rate
  const other = await createTestUser({ role: 'carrier' });
  await Load.updateOne({ _id: load._id }, { $set: { acceptedBy: other._id, rate: 1200, rateCents: 120000 } });
  const fresh = await createEscrowHoldForLoad(load._id);
  expect(mockStripe.paymentIntents.cancel).toHaveBeenCalledWith(payment.stripePaymentIntentId, expect.anything());
  expect(await statusOf(payment)).toBe('cancelled');
  expect(fresh.paymentIntentId).not.toBe(payment.stripePaymentIntentId);
  const created = await Payment.findOne({ stripePaymentIntentId: fresh.paymentIntentId });
  expect(created.amountCents).toBe(120000);
  expect(String(created.carrierId)).toBe(String(other._id));
  expect(String(created.shipperId)).toBe(String(shipper._id));
  const [args, opts] = mockStripe.paymentIntents.create.mock.calls[0];
  expect(args.amount).toBe(120000);
  expect(args.capture_method).toBe('manual');
  expect(opts.idempotencyKey).toMatch(/_120000_1$/); // amount + number of earlier payments

  // if the old hold cannot be cancelled, nothing new is created and the old record is left alone
  const stuck = await scene('pending');
  await Load.updateOne({ _id: stuck.load._id }, { $set: { rate: 500, rateCents: 50000 } });
  mockStripe.paymentIntents.cancel.mockRejectedValueOnce(new Error('stripe down'));
  const before = mockStripe.paymentIntents.create.mock.calls.length;
  const r = await createEscrowHoldForLoad(stuck.load._id);
  expect(r.funded).toBe(false);
  expect(r.error).toMatch(/could not be cancelled/);
  expect(await statusOf(stuck.payment)).toBe('pending');
  expect(mockStripe.paymentIntents.create.mock.calls.length).toBe(before);
});

test('a captured payment whose payout has not gone out is the most urgent case on the desk', async () => {
  const { payment } = await scene('captured');
  expect((await desk.collectCases({})).find((c) => c.kind === 'payout')).toBeUndefined(); // under an hour: normal
  await Payment.collection.updateOne({ _id: payment._id }, { $set: { updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });
  const [first] = await desk.collectCases({});
  expect(first.kind).toBe('payout');
  expect(first.severity).toBe('critical');
  expect(first.title).toMatch(/\$980\.00/);
});

describe('cancelled-truck fee', () => {
  const express = require('express');
  const request = require('supertest');
  const User = require('../../models/User');
  const { generateToken } = require('../helpers');
  const app = express();
  app.use(express.json());
  app.use('/api/loads', require('../../routes/loadRoutes')({ to: () => ({ emit: () => {} }), emit: () => {} }));
  const cancel = (load, user) => request(app).put(`/api/loads/${load._id}/cancel`).set('Authorization', `Bearer ${generateToken(user)}`).send({ reason: 'plans changed' });
  const tonuOf = async (load) => (await Load.findById(load._id)).accessorialCharges.find((c) => c.type === 'tonu');
  const withCard = (shipper) => User.updateOne({ _id: shipper._id }, { $set: { stripe: { customerId: 'cus_1', defaultPaymentMethodId: 'pm_1', accessorialMandate: { acceptedAt: new Date() } } } });
  afterEach(() => { delete process.env.ENABLE_TONU_COLLECTION; });

  test('always recorded on the load; with the switch off nothing is charged or paid', async () => {
    const { shipper, load } = await scene('cancelled');
    await withCard(shipper);
    const before = mockStripe.paymentIntents.create.mock.calls.length;
    const r = await cancel(load, shipper);
    expect(r.status).toBe(200);
    expect(r.body.tonuFeeCents).toBe(25000);
    const c = await tonuOf(load);
    expect(c).toMatchObject({ amountCents: 25000, status: 'pending', source: 'system_tonu' });
    expect(mockStripe.paymentIntents.create.mock.calls.length).toBe(before);
    expect(mockStripe.transfers.create).not.toHaveBeenCalled();
  });

  test('switch on: collected from the shipper, then paid to the carrier; never paid when the card fails or there is no payout account', async () => {
    process.env.ENABLE_TONU_COLLECTION = 'true';
    // card declined: stays pending, carrier not paid
    const declined = await scene('cancelled');
    await withCard(declined.shipper);
    mockStripe.paymentIntents.create.mockRejectedValueOnce(Object.assign(new Error('Your card was declined.'), { code: 'card_declined' }));
    await cancel(declined.load, declined.shipper);
    expect((await tonuOf(declined.load)).status).toBe('pending');
    expect(mockStripe.transfers.create).not.toHaveBeenCalled();

    // collected, but the carrier has no payout account: approved, NOT paid
    const noAccount = await scene('cancelled');
    await withCard(noAccount.shipper);
    mockStripe.paymentIntents.create.mockResolvedValueOnce({ id: 'pi_tonu_1', status: 'succeeded' });
    await cancel(noAccount.load, noAccount.shipper);
    expect(await tonuOf(noAccount.load)).toMatchObject({ status: 'approved', shipperPaymentStatus: 'collected' });
    expect(mockStripe.transfers.create).not.toHaveBeenCalled();
    expect((await desk.collectCases({})).some((c) => c.kind === 'payout' && /Collected fee not paid/.test(c.title))).toBe(true); // visible, not silent

    // collected and paid
    const ok = await scene('cancelled');
    await withCard(ok.shipper);
    await User.updateOne({ _id: ok.carrier._id }, { $set: { 'stripe.connectAccountId': 'acct_1' } });
    mockStripe.paymentIntents.create.mockResolvedValueOnce({ id: 'pi_tonu_2', status: 'succeeded' });
    await cancel(ok.load, ok.shipper);
    expect(await tonuOf(ok.load)).toMatchObject({ status: 'paid', shipperPaymentStatus: 'collected' });
    expect(mockStripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(mockStripe.transfers.create.mock.calls[0][0]).toMatchObject({ amount: 25000, destination: 'acct_1' });
    const [args] = mockStripe.paymentIntents.create.mock.calls.at(-1);
    expect(args).toMatchObject({ amount: 25000, off_session: true, customer: 'cus_1' });
  });

  test('no fee when the carrier cancels, or when the load was never booked', async () => {
    const a = await scene('cancelled');
    await cancel(a.load, a.carrier);
    expect(await tonuOf(a.load)).toBeUndefined();
    const b = await scene('cancelled');
    await Load.updateOne({ _id: b.load._id }, { $set: { status: 'open', acceptedBy: null } });
    await cancel(b.load, b.shipper);
    expect(await tonuOf(b.load)).toBeUndefined();
  });
});

test('price breakdown: the same whole-cent numbers for both sides, and they always add up', async () => {
  const express = require('express');
  const request = require('supertest');
  const { generateToken } = require('../helpers');
  const app = express();
  app.use('/api/payments', require('../../routes/paymentRoutes'));
  const user = await createTestUser({ role: 'carrier' });
  const get = (q, u = user) => request(app).get(`/api/payments/price-breakdown${q}`).set('Authorization', `Bearer ${generateToken(u)}`);
  expect((await request(app).get('/api/payments/price-breakdown?amountCents=1000')).status).toBe(401);
  for (const bad of ['', '?amountCents=abc', '?amountCents=10.5', '?amountCents=0', '?amountCents=-5']) expect((await get(bad)).status).toBe(400);
  for (const cents of [240000, 3333, 101, 1]) {
    const { body } = await get(`?amountCents=${cents}`);
    expect(body.shipperPaysCents).toBe(cents);
    expect(Number.isInteger(body.platformFeeCents)).toBe(true);
    expect(body.platformFeeCents + body.carrierReceivesCents).toBe(cents);
  }
  expect((await get('?amountCents=240000')).body).toMatchObject({ platformFeeCents: 4800, carrierReceivesCents: 235200, feePercent: 2 });
});

describe('carrier payout that did not go out, and dispute splits', () => {
  const express = require('express');
  const request = require('supertest');
  const User = require('../../models/User');
  const escrowService = require('../../services/escrowService');
  const { generateToken } = require('../helpers');
  const withAccount = (carrier) => User.updateOne({ _id: carrier._id }, { $set: { 'stripe.connectAccountId': 'acct_9' } });
  const fresh = (p) => Payment.findById(p._id);
  beforeEach(() => { mockStripe.transfers.create.mockClear(); mockStripe.refunds.create.mockClear(); });

  test('a transfer that fails after the charge is reported as captured, then retried once and only once', async () => {
    const { carrier, load, payment } = await scene('in_escrow');
    mockStripe.transfers.create.mockRejectedValueOnce(new Error('insufficient funds'));
    const r = await escrowService.captureEscrow(payment.stripePaymentIntentId, String(load._id), 'acct_9');
    expect(r).toMatchObject({ success: true, chargeId: 'ch_1', transferId: null, payoutError: 'insufficient funds' });

    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'captured', stripeChargeId: 'ch_1' } });
    expect((await escrowService.payoutCaptured(payment._id)).code).toBe('no_payout_account'); // carrier not set up: nothing sent
    expect(mockStripe.transfers.create).toHaveBeenCalledTimes(1);

    await withAccount(carrier);
    const paid = await escrowService.payoutCaptured(payment._id);
    expect(paid).toMatchObject({ ok: true, payoutCents: 98000 });
    const [args, opts] = mockStripe.transfers.create.mock.calls.at(-1);
    expect(args).toMatchObject({ amount: 98000, destination: 'acct_9', source_transaction: 'ch_1' });
    expect(opts.idempotencyKey).toBe(`payout_${payment._id}`);
    expect((await fresh(payment)).status).toBe('released');
    expect((await escrowService.payoutCaptured(payment._id)).code).toBe('not_payable'); // never twice
    expect(mockStripe.transfers.create).toHaveBeenCalledTimes(2);
  });

  test('only an admin can send a stuck payout', async () => {
    const app = express();
    app.use('/api/payments', require('../../routes/paymentRoutes'));
    const { carrier, payment } = await scene('captured', { stripeChargeId: 'ch_1' });
    await withAccount(carrier);
    const post = (u, id = payment._id) => request(app).post(`/api/payments/${id}/retry-payout`).set('Authorization', `Bearer ${generateToken(u)}`);
    expect((await post(carrier)).status).toBe(403);
    const admin = await createTestUser({ role: 'admin' });
    expect((await post(admin, 'nope')).status).toBe(400);
    expect((await post(admin)).status).toBe(200);
    expect((await fresh(payment)).status).toBe('released');
    expect((await post(admin)).status).toBe(409);
  });

  test('dispute split: shipper refunded their part, carrier paid their part less the fee, record says so', async () => {
    const { carrier, load, payment } = await scene('in_escrow');
    await Load.updateOne({ _id: load._id }, { $set: { escrowPaymentIntentId: payment.stripePaymentIntentId } });
    await withAccount(carrier);
    const r = await escrowService.settleDisputeResolution(load._id, 60);
    expect(r).toMatchObject({ ok: true, carrierShareCents: 60000, refundCents: 40000 });
    expect(mockStripe.refunds.create.mock.calls[0][0].amount).toBe(40000);
    expect(mockStripe.transfers.create.mock.calls[0][0]).toMatchObject({ amount: 58800, destination: 'acct_9' });
    expect(await fresh(payment)).toMatchObject({ status: 'released', amountCents: 60000, platformFeeCents: 1200, carrierPayoutCents: 58800 });

    // carrier at fault: everything back to the shipper, nothing sent to the carrier
    const zero = await scene('in_escrow');
    await Load.updateOne({ _id: zero.load._id }, { $set: { escrowPaymentIntentId: zero.payment.stripePaymentIntentId } });
    await withAccount(zero.carrier);
    mockStripe.transfers.create.mockClear();
    await escrowService.settleDisputeResolution(zero.load._id, 0);
    expect((await fresh(zero.payment)).status).toBe('refunded');
    expect(mockStripe.transfers.create).not.toHaveBeenCalled();

    // money already paid out: nothing is changed automatically
    const done = await scene('released');
    await Load.updateOne({ _id: done.load._id }, { $set: { escrowPaymentIntentId: done.payment.stripePaymentIntentId } });
    expect((await escrowService.settleDisputeResolution(done.load._id, 50)).code).toBe('not_in_escrow');
    expect((await fresh(done.payment)).status).toBe('released');
  });
});
