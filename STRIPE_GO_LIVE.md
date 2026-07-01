# Stripe Go-Live Runbook

Payments are **built and dormant**. Nothing charges a real card until you set
keys and (for detention collection) flip a flag. This document is the checklist
to enable Stripe safely for field testing — **in stages**, not all at once.

## What Stripe controls — two independent things

| Capability | Status | Turned on by |
|---|---|---|
| **Escrow** (hold shipper funds → release to carrier on delivery — Phase 5) | built, unit-tested | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| **Path B: off-session detention collection** (charge shipper's saved card for approved detention) | built, unit-tested, **flag-gated** | the above **AND** `ENABLE_ACCESSORIAL_COLLECTION=true` |

**Key safety property:** setting the Stripe keys enables **escrow only**. The
newer off-session collection stays OFF until you explicitly set
`ENABLE_ACCESSORIAL_COLLECTION=true`. With the flag off, approved detention
settles via **Path A (accrual)** exactly as it does today. This lets you
field-test escrow first and collection later.

## Stage 0 — Prerequisites (Stripe test mode)

1. Create a Stripe account; stay in **Test mode**.
2. Enable **Stripe Connect** (Express accounts) for carrier payouts.
3. Get your keys: `sk_test_…`, `pk_test_…`.

## Stage 1 — Enable escrow (test mode)

Set on the **backend**:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...        # from the webhook you create below
STRIPE_PUBLISHABLE_KEY=pk_test_...
# ENABLE_ACCESSORIAL_COLLECTION stays false / unset for now
```
Set on the **frontend**:
```
REACT_APP_STRIPE_PUBLIC_KEY=pk_test_...
```

**Webhook** — create an endpoint pointing at `POST /api/payments/webhook`
(use a Stripe CLI tunnel or a public URL) and subscribe to:
- `payment_intent.amount_capturable_updated`  (escrow hold confirmed)
- `payment_intent.succeeded`                  (capture / off-session collection)
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `transfer.created`                          (carrier payout)
- `charge.dispute.created`
- `charge.refunded`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

**Field test — escrow happy path:**
1. Carrier completes Stripe Connect onboarding (`/connect/onboard`).
2. Shipper funds escrow on an accepted load (test card `4242 4242 4242 4242`).
3. Confirm the hold: webhook flips the load to `escrowFunded` / payment `in_escrow`.
4. Deliver → release → confirm capture + transfer to the carrier's Connect account.
5. Reconcile the ledger (`/api/ledger` / admin Ledger page).

## Stage 2 — Enable off-session detention collection (Path B)

Only after Stage 1 is solid on the field. This is a **Merchant-Initiated
Transaction** — do the compliance items first.

**Before flipping the flag:**
- [ ] Card is saved at escrow funding (`setup_future_usage: 'off_session'`) and
      `User.stripe.defaultPaymentMethodId` is populated (via webhook).
- [ ] The **mandate** disclosure is shown and accepted at funding (the
      FundEscrowDialog checkbox records `User.stripe.accessorialMandate`). Have
      counsel confirm the wording.
- [ ] Wire the **SCA / 3-D Secure completion** on the frontend: when approval
      returns `{ requiresAction, clientSecret }`, call `stripe.confirmCardPayment(clientSecret)`
      to let the shipper authenticate. (Backend already returns the clientSecret;
      the UI currently just shows a "verify with your bank" message.)

**Turn it on:**
```
ENABLE_ACCESSORIAL_COLLECTION=true
```

**Field test — collection happy path + edge cases** (Stripe test cards):
- Success: `4242 4242 4242 4242` → approve detention → charge succeeds → carrier settled.
- **SCA required:** `4000 0025 0000 3155` → approve → `requiresAction` → complete 3DS → webhook settles.
- Decline: `4000 0000 0000 9995` → approve → `402` returned, charge stays pending, carrier not paid.
- No saved card / no mandate → falls back to Path A accrual (no charge attempt).

## Rollback / kill switch

- **Disable collection instantly:** set `ENABLE_ACCESSORIAL_COLLECTION=false`
  and restart. Detention reverts to Path A accrual; nothing else changes.
- **Disable all Stripe:** unset `STRIPE_SECRET_KEY`. Escrow + collection both
  degrade gracefully (no crashes; the app runs exactly as in the no-Stripe demo).

## Compliance items (not code — confirm with counsel before real money)

- FMCSA broker authority / BMC-84 bond status (platform handles funds + fee).
- Money-transmitter / escrow-agent licensing per operating state.
- The accessorial mandate wording (off-session MIT authorization).

## Go-live (live mode)

Repeat Stages 1–2 with **live** keys (`sk_live_…`, `pk_live_…`), a live webhook
endpoint, real Connect onboarding, and real bank details. Keep
`ENABLE_ACCESSORIAL_COLLECTION=false` until escrow is proven in production, then
enable collection.
