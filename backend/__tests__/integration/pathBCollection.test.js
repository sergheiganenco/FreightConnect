/**
 * Path B — real off-session shipper collection for approved accessorials.
 *
 * collectAccessorialFromShipper() charges the shipper's saved card off-session
 * (a Merchant-Initiated Transaction) for an approved detention/accessorial.
 * Stripe is dependency-injected so the orchestration is unit-tested without a
 * live Stripe key: success, SCA-required (both shapes), decline, and the
 * preconditions (saved card + accepted mandate).
 */

require('../setup');
const mongoose = require('mongoose');
const { createTestUser, createTestLoad } = require('../helpers');
const Load = require('../../models/Load');
const escrowService = require('../../services/escrowService');

function fakeStripe(behavior) {
  const calls = [];
  return {
    calls,
    paymentIntents: {
      create: async (params, opts) => {
        calls.push({ params, opts });
        return behavior(params, opts); // may return a PI or throw
      },
    },
  };
}

async function shipperWithCard(overrides = {}) {
  return createTestUser({
    role: 'shipper',
    stripe: {
      customerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
      accessorialMandate: { acceptedAt: new Date('2026-01-01T00:00:00Z'), version: 'v1', ip: '1.2.3.4' },
      ...(overrides.stripe || {}),
    },
  });
}

async function loadWithDetention(shipper, carrier, amountCents = 15000) {
  const load = await createTestLoad(shipper._id, { status: 'delivered', acceptedBy: carrier._id });
  load.accessorialCharges.push({
    type: 'detention', source: 'system_detention', amountCents, status: 'pending',
    dwellEventId: new mongoose.Types.ObjectId(), evidence: {}, evidenceHash: 'h1',
  });
  await load.save();
  return { load, chargeId: load.accessorialCharges[0]._id };
}

describe('escrowService.collectAccessorialFromShipper', () => {
  test('successful off-session charge → ok, with correct Stripe params + idempotency key', async () => {
    const shipper = await shipperWithCard();
    const carrier = await createTestUser({ role: 'carrier' });
    const { load, chargeId } = await loadWithDetention(shipper, carrier, 15000);
    const stripe = fakeStripe(() => ({ id: 'pi_1', status: 'succeeded' }));

    const r = await escrowService.collectAccessorialFromShipper(load._id, chargeId, stripe);

    expect(r.ok).toBe(true);
    expect(r.paymentIntentId).toBe('pi_1');
    const { params, opts } = stripe.calls[0];
    expect(params.amount).toBe(15000);
    expect(params.customer).toBe('cus_test');
    expect(params.payment_method).toBe('pm_test');
    expect(params.off_session).toBe(true);
    expect(params.confirm).toBe(true);
    expect(params.metadata.type).toBe('accessorial_collect');
    expect(params.metadata.chargeId).toBe(String(chargeId));
    expect(opts.idempotencyKey).toBe(`accessorial_collect_${chargeId}`);
  });

  test('SCA via returned requires_action status → requiresAction + clientSecret', async () => {
    const shipper = await shipperWithCard();
    const carrier = await createTestUser({ role: 'carrier' });
    const { load, chargeId } = await loadWithDetention(shipper, carrier);
    const stripe = fakeStripe(() => ({ id: 'pi_2', status: 'requires_action', client_secret: 'cs_2' }));

    const r = await escrowService.collectAccessorialFromShipper(load._id, chargeId, stripe);

    expect(r.ok).toBe(false);
    expect(r.requiresAction).toBe(true);
    expect(r.clientSecret).toBe('cs_2');
    expect(r.paymentIntentId).toBe('pi_2');
  });

  test('SCA via thrown authentication_required error → requiresAction + clientSecret', async () => {
    const shipper = await shipperWithCard();
    const carrier = await createTestUser({ role: 'carrier' });
    const { load, chargeId } = await loadWithDetention(shipper, carrier);
    const stripe = fakeStripe(() => {
      const err = new Error('authentication required');
      err.code = 'authentication_required';
      err.raw = { payment_intent: { id: 'pi_3', client_secret: 'cs_3' } };
      throw err;
    });

    const r = await escrowService.collectAccessorialFromShipper(load._id, chargeId, stripe);

    expect(r.requiresAction).toBe(true);
    expect(r.clientSecret).toBe('cs_3');
    expect(r.paymentIntentId).toBe('pi_3');
  });

  test('card declined → ok:false with card_error', async () => {
    const shipper = await shipperWithCard();
    const carrier = await createTestUser({ role: 'carrier' });
    const { load, chargeId } = await loadWithDetention(shipper, carrier);
    const stripe = fakeStripe(() => {
      const err = new Error('Your card was declined');
      err.code = 'card_declined';
      err.decline_code = 'insufficient_funds';
      throw err;
    });

    const r = await escrowService.collectAccessorialFromShipper(load._id, chargeId, stripe);

    expect(r.ok).toBe(false);
    expect(r.code).toBe('card_error');
    expect(r.declineCode).toBe('insufficient_funds');
  });

  test('no saved payment method → no_payment_method (route falls back to accrual)', async () => {
    const shipper = await createTestUser({ role: 'shipper', stripe: { customerId: 'cus_only' } });
    const carrier = await createTestUser({ role: 'carrier' });
    const { load, chargeId } = await loadWithDetention(shipper, carrier);
    const stripe = fakeStripe(() => ({ id: 'pi_x', status: 'succeeded' }));

    const r = await escrowService.collectAccessorialFromShipper(load._id, chargeId, stripe);

    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_payment_method');
    expect(stripe.calls).toHaveLength(0); // never reached Stripe
  });

  test('no accepted mandate → no_mandate (cannot MIT-charge without authorization)', async () => {
    const shipper = await createTestUser({
      role: 'shipper',
      stripe: { customerId: 'cus_1', defaultPaymentMethodId: 'pm_1' }, // no accessorialMandate
    });
    const carrier = await createTestUser({ role: 'carrier' });
    const { load, chargeId } = await loadWithDetention(shipper, carrier);
    const stripe = fakeStripe(() => ({ id: 'pi_x', status: 'succeeded' }));

    const r = await escrowService.collectAccessorialFromShipper(load._id, chargeId, stripe);

    expect(r.ok).toBe(false);
    expect(r.code).toBe('no_mandate');
    expect(stripe.calls).toHaveLength(0);
  });
});
