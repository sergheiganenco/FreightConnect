/**
 * escrowService.settleDisputeResolution — the money movement when a dispute is
 * resolved. Dormant without Stripe / without a funded escrow; injectable Stripe
 * lets us verify the capture/refund split.
 */
require('../setup');
const { createTestUser, createTestLoad } = require('../helpers');
const Payment = require('../../models/Payment');
const escrowService = require('../../services/escrowService');

function fakeStripe() {
  const calls = { captures: [], refunds: [] };
  return {
    calls,
    paymentIntents: { capture: async (id) => { calls.captures.push(id); return { id, status: 'succeeded' }; } },
    refunds: { create: async (p) => { calls.refunds.push(p); return { id: 're_1', amount: p.amount }; } },
  };
}

async function fundedLoad() {
  const shipper = await createTestUser({ role: 'shipper' });
  const carrier = await createTestUser({ role: 'carrier' });
  const load = await createTestLoad(shipper._id, { status: 'resolved', acceptedBy: carrier._id, escrowPaymentIntentId: 'pi_escrow_1' });
  await Payment.create({
    loadId: load._id, shipperId: shipper._id, carrierId: carrier._id,
    amountCents: 100000, platformFeeCents: 2000, carrierPayoutCents: 98000,
    amount: 1000, platformFee: 20, carrierPayout: 980,
    status: 'in_escrow', stripePaymentIntentId: 'pi_escrow_1',
  });
  return load;
}

describe('escrowService.settleDisputeResolution', () => {
  test('dormant without Stripe → stripe_unavailable (no-op)', async () => {
    const load = await fundedLoad();
    const r = await escrowService.settleDisputeResolution(load._id, 60); // no injected stripe, no key
    expect(r.ok).toBe(false);
    expect(r.code).toBe('stripe_unavailable');
  });

  test('no funded escrow → no_escrow', async () => {
    const shipper = await createTestUser({ role: 'shipper' });
    const load = await createTestLoad(shipper._id, { status: 'resolved' });
    const r = await escrowService.settleDisputeResolution(load._id, 60, fakeStripe());
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_escrow');
  });

  test('split 60% → captures escrow + refunds shipper 40%', async () => {
    const load = await fundedLoad();
    const stripe = fakeStripe();
    const r = await escrowService.settleDisputeResolution(load._id, 60, stripe);
    expect(r.ok).toBe(true);
    expect(r.carrierShareCents).toBe(60000);
    expect(r.refundCents).toBe(40000);
    expect(stripe.calls.captures).toContain('pi_escrow_1');
    expect(stripe.calls.refunds[0].amount).toBe(40000);
  });

  test('carrier 100% → capture, no refund', async () => {
    const load = await fundedLoad();
    const stripe = fakeStripe();
    const r = await escrowService.settleDisputeResolution(load._id, 100, stripe);
    expect(r.ok).toBe(true);
    expect(r.refundCents).toBe(0);
    expect(stripe.calls.refunds).toHaveLength(0);
  });
});
