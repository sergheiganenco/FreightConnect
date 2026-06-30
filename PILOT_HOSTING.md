# Pilot Hosting — Option B (Tunnel, no deploy)

Goal: let a **real driver out on the road (cellular)** reach your **locally-running backend** so you can run the no-money golden-path pilot ([PILOT_GUIDE.md](PILOT_GUIDE.md)) — without deploying anything.

You run two tunnels:
1. **Backend tunnel** → exposes your local API + Socket.IO at a public `https://` URL the driver's phone hits.
2. **Expo tunnel** → lets the driver load the mobile app over the internet via Expo Go.

Everything else (the shipper web app, MongoDB) stays on your machine.

```
  Driver's phone (cellular)                      Your laptop
  ┌─────────────────┐                      ┌──────────────────────────┐
  │  Expo Go app    │── loads JS bundle ──▶│  npx expo start --tunnel │
  │  (FreightConn.) │                      ├──────────────────────────┤
  │                 │── API + GPS + socket▶│  cloudflared/ngrok ──▶ :5000 backend │
  └─────────────────┘   (https tunnel)     │  localhost:3000 frontend (you)       │
                                           │  MongoDB (local or Atlas)            │
                                           └──────────────────────────┘
```

Why a tunnel and not just your LAN IP: a driver on cellular isn't on your WiFi, and **iOS blocks plain-HTTP** — the tunnel gives a public **HTTPS** URL that works from anywhere.

---

## Prerequisites (one-time, ~5 min)

Install a tunnel tool. **cloudflared is recommended** (no interstitial page, free, no account needed for quick tunnels):

```powershell
# cloudflared (recommended)
winget install --id Cloudflare.cloudflared

# OR ngrok (works too; free tier shows a one-time warning page — see note at bottom)
winget install ngrok
```

You'll also need: Node/npm (already have it), the backend + frontend deps installed, and `cd mobile && npm install` done once.

---

## Step 1 — Start the backend (you)

`backend/.env` must include (the pilot-relevant lines):
```
MONGO_URI=<your MongoDB connection string>
JWT_SECRET=<any 64-char random string>
NODE_ENV=development
PORT=5000
ALLOWED_ORIGINS=http://localhost:3000
ESCROW_FUND_DEADLINE_HOURS=999
# leave STRIPE_SECRET_KEY unset → payments off
```

Start it:
```powershell
cd backend; npm run dev
```
Confirm it's up: open `http://localhost:5000/api/health` → should return `{"status":"ok",...}`.

---

## Step 2 — Open the backend tunnel (you)

```powershell
# cloudflared (recommended)
cloudflared tunnel --url http://localhost:5000
```
It prints a public URL like:
```
https://random-words-here.trycloudflare.com
```

```powershell
# OR ngrok
ngrok http 5000
# use the https URL it shows, e.g. https://abcd-1234.ngrok-free.app
```

**Copy that `https://…` URL — this is your `<TUNNEL>`.** Keep this terminal open (closing it kills the tunnel).

Sanity check from any device (or your phone's browser):
```
https://<TUNNEL>/api/health   →   {"status":"ok", ...}
```

> The URL changes every time you restart the tunnel (free tier). When it changes, update Step 3 and add it to `ALLOWED_ORIGINS`.

---

## Step 3 — Point the mobile app at the tunnel (you)

Create **`mobile/.env`** (Expo auto-loads `EXPO_PUBLIC_*` vars):
```
EXPO_PUBLIC_API_URL=https://<TUNNEL>/api
EXPO_PUBLIC_SOCKET_URL=https://<TUNNEL>
```
Replace `<TUNNEL>` with the URL from Step 2 (note the **`/api`** suffix on the first one, and **no** suffix on the second).

Also add the tunnel origin to the backend so sockets are never blocked — edit `backend/.env`:
```
ALLOWED_ORIGINS=http://localhost:3000,https://<TUNNEL>
```
Then **restart the backend** (Step 1) so it picks up the new origin.

---

## Step 4 — Start the app over a tunnel for the driver (you)

```powershell
cd mobile; npx expo start --tunnel
```
This serves the app bundle over the internet (separate Expo tunnel) and shows a **QR code**.

The driver:
1. Installs **Expo Go** (App Store / Play Store).
2. Scans the QR (iOS: Camera app → opens in Expo Go; Android: scan inside Expo Go).
3. The app loads and points at your backend tunnel automatically (from `mobile/.env`).

> If you change `mobile/.env`, stop and re-run `npx expo start --tunnel` so the new values bundle in.

---

## Step 5 — Start the shipper web view (you, local)

```powershell
cd frontend; npm start        # http://localhost:3000 — your shipper dashboard
```
This stays local and talks to your local backend at `localhost:5000` directly — it does **not** go through the tunnel.

---

## Step 6 — Seed the load + run the pilot

```powershell
cd backend; node scripts/seedPilotLoad.js
```
(Edit the `CONFIG` block first with the driver's real load.) Then follow **[PILOT_GUIDE.md](PILOT_GUIDE.md)** from Step 2 onward — driver accepts on the phone, you watch the truck move on the shipper Load Details map.

---

## Daily checklist (every time you run a session)

1. ☐ `cd backend; npm run dev`
2. ☐ `cloudflared tunnel --url http://localhost:5000` → copy `<TUNNEL>`
3. ☐ Update `mobile/.env` with `<TUNNEL>` and `ALLOWED_ORIGINS` in `backend/.env`; restart backend if the URL changed
4. ☐ `cd mobile; npx expo start --tunnel` → driver scans QR
5. ☐ `cd frontend; npm start` (your shipper view)
6. ☐ Verify `https://<TUNNEL>/api/health` returns ok
7. ☐ Run the pilot

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `https://<TUNNEL>/api/health` doesn't load | Backend not running, or tunnel terminal closed. Restart both. |
| Driver's app: "Network error" / can't log in | `EXPO_PUBLIC_API_URL` wrong (missing `/api`, or stale tunnel URL). Fix `mobile/.env`, restart `expo start --tunnel`. |
| Live tracking marker never moves | Load must be **in-transit**, the driver must be the one who **accepted** it, location permission granted ("Always"), and the socket connected (`EXPO_PUBLIC_SOCKET_URL` correct, tunnel origin in `ALLOWED_ORIGINS`). |
| iOS won't connect to backend | Must be **https** — use the tunnel URL, not a raw `http://LAN-IP`. |
| ngrok shows a warning page instead of JSON | Free ngrok adds an interstitial for browser GETs. The native app is usually unaffected; if it bites, prefer **cloudflared** (no interstitial). |
| Background GPS stops when screen is off | Expo Go limits background location. For reliable in-truck background tracking, do an **EAS dev build** (ask and I'll add the config) — for a first look, keep the app foregrounded. |
| Tunnel URL changed after restart | Update `mobile/.env` + `ALLOWED_ORIGINS`, restart backend + `expo start --tunnel`. (A reserved cloudflared/ngrok domain avoids this — optional.) |

---

## Notes & boundaries
- **MongoDB** stays local for this pilot (backend is local). If you later host the backend (Option C), switch to **MongoDB Atlas** and follow `PRODUCTION_RUNBOOK.md`.
- **Payments stay off** (no Stripe keys). This is an operational/tracking pilot only — no real money, per the runbook boundary.
- Tunnels are for **testing**, not production. When the pilot proves out, graduate to a real host (Render/Railway/Fly + Atlas) using the runbook.
- Want reliable background GPS or a no-Expo-Go install for the driver? Ask for the **EAS build** setup and I'll add `eas.json` + the build/submit steps.
