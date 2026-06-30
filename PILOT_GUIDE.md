# FreightConnect — No-Money Golden-Path Pilot Guide

Goal: have a **real driver** run a load end-to-end so you can see the whole flow and **watch live tracking** — with **zero money involved**. You mimic the driver's current real load in the database, the driver accepts it and drives, and you watch it move.

Payments are **off** automatically when `STRIPE_SECRET_KEY` is unset. Ignore any `Stripe not configured` logs — they don't affect tracking or any golden-path step.

---

## 0. One-time setup (you, ~10 min)

### Backend `.env` (the only settings that matter for this pilot)
```
MONGO_URI=<your MongoDB connection string>
JWT_SECRET=<any 64-char random string>
NODE_ENV=development
PORT=5000
ALLOWED_ORIGINS=http://localhost:3000
ESCROW_FUND_DEADLINE_HOURS=999     # so the accepted load isn't auto-reopened mid-test
# Leave STRIPE_SECRET_KEY unset → payments off
# ORS_API_KEY optional (route line on the map); tracking works without it
```

### Start the services
```bash
# Terminal 1 — backend
cd backend && npm run dev        # http://localhost:5000

# Terminal 2 — frontend
cd frontend && npm start         # http://localhost:3000
```

### (Optional) Mobile app for real in-truck GPS
```bash
cd mobile && npm install
# Point the app at your machine's LAN IP (so the driver's phone can reach it):
#   set EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5000/api
#   set EXPO_PUBLIC_SOCKET_URL=http://<your-LAN-IP>:5000
npx expo start                   # driver scans the QR with Expo Go
```
> No mobile yet? You can still test tracking from a **web browser** — see Step 4, Option B.

---

## 1. Seed the load (you)

1. Open `backend/scripts/seedPilotLoad.js` and edit the **CONFIG** block at the top with the driver's real current load (origin, destination, equipment, weight) and a login for the driver. Leave the coordinates `null` to auto-geocode from the city names.
2. Run it:
   ```bash
   cd backend && node scripts/seedPilotLoad.js
   ```
3. It prints the **driver login**, **your shipper login**, and the **load id**. Keep these handy.

What it created (all real, all no-money):
- A **shipper** account (you) and the **open load**.
- A **carrier** account (the driver) — pre-verified, with a truck, ToS accepted — so the driver can accept loads immediately with no onboarding friction.

Re-running the script is safe (idempotent) — it refreshes the pilot load.

---

## 2. See the posted load (you — shipper, web)

1. Go to `http://localhost:3000` → **Login** with the **shipper** credentials.
2. Dashboard → **Loads** (or **Post Load** history). You should see `[PILOT] <origin> → <destination>` with status **open**.
3. Click it to open the **Load Details** — note the map showing the pickup → delivery route. This is the screen you'll watch the truck move on.

---

## 3. Accept the load (driver)

The driver logs in with the **driver** credentials — on the **mobile app** (preferred, real GPS) or the **web** (`http://localhost:3000`).

- **Mobile:** Load Board → tap the `[PILOT]` load → **Accept**.
- **Web:** Dashboard → **Loads** → open the load → **Accept**.

The load flips to **accepted** and is now assigned to the driver. (You, as shipper, will see the status change in real time.)

---

## 4. Drive + watch live tracking (the main event)

First, the driver sets the load **In-Transit** (mobile: the load detail action; web: status control on the load). Tracking authorizes once the load is **accepted by this driver**.

### Option A — Mobile app (real GPS in the truck) ✅ recommended
- On the load screen the driver taps **Start Tracking** (the app requests background-location permission — allow "Always").
- The phone sends GPS every ~15 sec / 50 m to `POST /api/tracking/location` (source `mobile_app`), even with the screen off.
- **You (shipper)** keep the **Load Details** modal open → the truck marker moves on the map live (`carrierLocationUpdate` events). ETA/route update as it goes.

### Option B — Web browser (no truck phone needed)
- The driver opens **Carrier dashboard → Live Map** in a browser on a phone or laptop and allows location access. The browser sends location over the socket (`updateCarrierLocation`, source `browser`).
- Same result: **you** watch it move on the shipper's Load Details map.

**Where to watch (you):** the **Load Details** map for that load updates live. The driver can also see themselves on **Carrier → Live Map**.

> If the marker doesn't move: confirm (1) the load is **in-transit**, (2) the driver is the one who **accepted** it, (3) location permission was granted, and (4) both browsers/app are logged in (the socket needs the JWT).

---

## 5. Deliver + POD (driver)

1. At the destination, the driver marks the load **Delivered**.
   - Mobile: **Mark Delivered** on the load.
   - Web: status control → **delivered**.
2. Driver uploads **Proof of Delivery**:
   - Mobile: **POD Upload** screen → take a photo + capture the consignee **signature**.
   - Web: **Documents** → upload POD for the load.

On delivery the system auto-generates the **BOL** and stops tracking.

---

## 6. Review (you — shipper)

- Load now shows **delivered** with `deliveredAt`.
- **Documents** for the load: **Rate Confirmation** (auto on accept), **BOL** (auto on delivery), and the **POD** the driver uploaded.
- The map shows the last known truck position; the load timeline reflects open → accepted → in-transit → delivered.

That's the full golden path — matching, acceptance, real-time tracking, document automation, and delivery — with no money touched.

---

## What to capture for your evaluation
- Time from "posted" to "accepted."
- Tracking smoothness (update frequency, accuracy, behavior on weak signal).
- How the live map looks to the shipper (is the truck position believable / timely?).
- POD quality (photo + signature) and that BOL/Rate-Con generated correctly.
- Any friction the driver hit (anything confusing on the mobile app).

---

## Troubleshooting
| Symptom | Fix |
|---|---|
| `403 Terms of Service acceptance required` | Re-run the seed — it sets `tosAccepted`/`tosVersion='1.0'`. (Manually-created users must accept ToS first.) |
| Driver can't accept ("verification required") | Use the **seeded** driver account — it's pre-verified with a truck. A self-signed-up carrier would need verification + a truck first. |
| Accepted load disappeared after a day | Set `ESCROW_FUND_DEADLINE_HOURS=999` in `.env` and restart the backend (the no-money load looks "unfunded" to the 24h auto-reopen job). |
| Truck marker not moving | Load must be **in-transit**, driver must be the **acceptor**, location permission granted, and both sides logged in (socket needs the token). |
| `Stripe not configured` in logs | Expected — payments are off for this pilot. Ignore. |
| Mobile app can't reach backend | Use your machine's **LAN IP** (not `localhost`) in `EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_SOCKET_URL`, and ensure the phone is on the same network. |

---

## Important boundary
This validates the **operational** product (matching, tracking, docs, delivery). It does **not** exercise real payments/escrow — that stays off until your counsel clears the money-custody question and you run the Stripe **test-mode** sequence in `PRODUCTION_RUNBOOK.md §4`. Keep the pilot to **no-money** until then.
