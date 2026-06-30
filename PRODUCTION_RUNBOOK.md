# FreightConnect — Production Readiness Runbook

This is the single checklist for taking FreightConnect live. It covers what software handles automatically, what **you** must configure, and the **legal/insurance** items no code can solve.

---

## 0. Go / No-Go gate

Do **not** accept real money or real freight until every item in **§1 (Legal/Financial)** and **§2 (Required env + secrets)** is ✅. Everything else can follow during a controlled pilot.

---

## 1. Legal & financial (must be done by humans — blocks launch)

| # | Item | Why | Owner |
|---|------|-----|-------|
| 1 | **Money transmitter / escrow custody opinion** | Holding shippers' funds can require state MTLs unless funds stay with Stripe and never touch your balance sheet. Confirm your Stripe Connect flow keeps you out of custody. | Fintech lawyer |
| 2 | **Contingent cargo + E&O insurance** | A damaged-cargo claim needs a payer. Brokers carry this; broker-free, you must. | Insurance broker |
| 3 | **Master carrier & shipper agreements** | Binding T&Cs (broker-carrier agreement equivalent) so disputes have legal teeth. ToS-guard already blocks unsigned users — point it at the real agreement. | Legal |
| 4 | **Factoring NOA handling** | If a load is factored, payment is legally owed to the factor, not the carrier. (Engineering follow-up tracked separately.) | Legal + Eng |
| 5 | **Dispute-arbitration policy** | Decide *who* adjudicates detention/damage disputes and the SLA. The review queue + exceptions support it; the policy is yours. | Ops |
| 6 | **1099-NEC / backup withholding** | Tax filing for carrier payouts; withhold when W-9 missing. TaxRecord model exists; confirm filing process. | Finance |
| 7 | **Privacy posture (CCPA/GDPR)** | You store driver licenses, EINs, payment data. Document retention, deletion, and encryption-at-rest. | Legal + Eng |

---

## 2. Required environment variables & secrets

Set these in your host / EAS / CI secrets — **never commit them**. `.env` is gitignored.

### Backend (required — app exits if missing)
```
MONGO_URI=mongodb+srv://...            # Atlas with a REPLICA SET (needed for transactions + PITR)
JWT_SECRET=<64+ char random>           # `openssl rand -hex 64`. Startup warns <32, hard-exits in prod.
NODE_ENV=production
PORT=5000
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

### Backend (payments / external — features degrade without them; startup logs which)
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...     # returned to the shipper Fund-Escrow dialog
ORS_API_KEY=...                        # routing / ETA
FMCSA_API_KEY=...                      # carrier verification
EMAIL_USER=... / EMAIL_PASS=...        # verification + reset emails
```

### Backend (optional resilience — enable for scale)
```
REDIS_URL=redis://...                  # turns ON multi-instance Socket.IO + Redis rate limiting
SENTRY_DSN=https://...                 # turns ON error tracking
ESCROW_FUND_DEADLINE_HOURS=24          # unfunded loads auto-reopen after this (default 24)
```

### Frontend (`.env` at build time)
```
REACT_APP_API_URL=/api
REACT_APP_STRIPE_PUBLIC_KEY=pk_live_...
```

### Mobile (Expo — production)
```
EXPO_PUBLIC_API_URL=https://yourdomain.com/api
EXPO_PUBLIC_SOCKET_URL=https://yourdomain.com
# or set extra.apiUrl / extra.socketUrl in app.json / EAS env
```

---

## 3. Secret rotation (do before launch)

- [ ] Generate a fresh 64-char `JWT_SECRET` (invalidates all existing tokens — expected).
- [ ] Rotate any dev MongoDB/Atlas password and API keys that ever lived in a local `.env`.
- [ ] Configure the Stripe **webhook endpoint** → `https://yourdomain.com/api/payments/webhook` and copy its signing secret to `STRIPE_WEBHOOK_SECRET`.

---

## 4. Stripe go-live checklist

1. [ ] Connect (Express) onboarding works for a test carrier (`/api/payments/connect/onboard`).
2. [ ] Shipper funds escrow via the **Fund Escrow** dialog → PaymentIntent authorized (manual capture).
3. [ ] Webhook `payment_intent.amount_capturable_updated` flips `load.escrowFunded = true` and writes a ledger pair.
4. [ ] Delivery captures the hold and transfers payout minus the 2% platform fee.
5. [ ] Approve an accessorial → carrier receives the transfer; ledger records `accessorial_settle`.
6. [ ] Run `GET /api/ledger/reconcile` → `balanced: true`.
7. [ ] Replay a webhook (Stripe CLI `--resend`) → second call returns `{ duplicate: true }`, no double-processing.

> Run all of the above in **Stripe test mode** first. The escrow→webhook→ledger loop has unit/integration coverage but should be exercised against real Stripe test keys once.

---

## 5. Database

- [ ] **Replica set** (Atlas default) — required for multi-doc transactions and point-in-time recovery.
- [ ] **Automated backups**: schedule `backend/scripts/backup.js`.
  - Linux cron (daily 03:00): `0 3 * * * cd /app/backend && node scripts/backup.js`
  - Or use Atlas continuous backups (recommended).
- [ ] Verify a **restore** at least once — an untested backup is not a backup.
- [ ] Indexes auto-build on boot (defined in models). Confirm no slow collection scans in Atlas Performance Advisor after first load.

---

## 6. Deploy

Docker assets are ready: `backend/Dockerfile`, `frontend/Dockerfile` (+ `nginx.conf` with gzip), `docker-compose.yml`, root multi-stage `Dockerfile`, `.github/workflows/ci.yml`.

- [ ] CI green: backend tests (89), frontend build, security audit.
- [ ] Build & push images (CI does this on `main`).
- [ ] Behind a load balancer with **2+ instances**, set `REDIS_URL` (Socket.IO + rate limiting break across instances without it).
- [ ] TLS termination + HSTS (nginx security headers already set).
- [ ] Health check wired to `GET /api/health` (returns db state + uptime).
- [ ] Run `node scripts/smokeBoot.js` in staging as a final boot gate.

---

## 7. Security checklist (already in code — verify enabled)

- [x] Helmet, CORS allowlist, NoSQL-injection sanitizer, request IDs.
- [x] bcrypt (cost 10), password complexity, rate-limited auth.
- [x] JWT refresh + 401 retry; **MFA (TOTP)** available — consider enforcing for admins.
- [x] Stripe webhook signature verification; no card data logged.
- [x] Anti-fraud guard at acceptance (identity gate + double-broker lock + fingerprint).
- [ ] **Enforce MFA for all admin accounts** before go-live (`/api/users/mfa/setup`).
- [ ] Set a real Terms-of-Service version in the ToS guard.

---

## 8. Operational readiness

- [ ] **24/7 support channel** — freight runs at 2am. Decide phone/on-call coverage (this is the #1 non-software trust factor for carriers).
- [ ] **Sentry alerting** to a channel humans watch (set `SENTRY_DSN`).
- [ ] **Admin review queue** monitored — AI flags risky carriers here instead of auto-suspending; someone must work the queue (`/api/review-queue`).
- [ ] **Compliance alerts** surfaced to carriers (CDL/medical/hazmat expiry — already in the Drivers page).
- [ ] First-load **verification re-check** cadence — FMCSA authority/insurance can lapse mid-relationship.

---

## 9. Known engineering follow-ups (tracked, not blocking a pilot)

| Item | Status |
|------|--------|
| Factoring NOA payment redirect | Not yet built |
| Admin UIs for ledger / review queue / MFA setup | API done, UI pending |
| Reconsignment re-rate + HOS re-check on reroute | Address-change only today |
| Multi-doc transactions on money paths | Deferred (idempotency covers double-pay; needs replica set) |
| Driver check-in (geo+photo) at pickup vs. double-brokering | Future hardening |
| Cross-border (Canada/Mexico) customs | Out of scope (domestic FTL) |

---

## 10. Pilot scope recommendation

Launch **domestic full-truckload (FTL)** with a **small set of pre-vetted carriers and shippers**. That keeps verification, dispute volume, and support load manageable while the network and the human-dependent items in §1 mature. Expand once reconciliation, support, and the legal items are proven.

---

_Generated as part of the production-hardening work. Keep this file updated as items close._
