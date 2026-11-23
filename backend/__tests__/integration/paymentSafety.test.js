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
  },
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
