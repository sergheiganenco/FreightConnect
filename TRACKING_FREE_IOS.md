# Free Live Tracking on iPhone (no app build, no $99, screen off)

This lets an **iPhone** carrier stream **background GPS** (screen off, all day) into your FreightConnect dashboard at **zero cost** — by using a free, App-Store-approved tracker app (OwnTracks or Traccar Client) that publishes location to your server. You (the shipper) watch it move on the web dashboard on any device, including Android.

> Why this works: building your *own* iOS app with background GPS requires Apple's $99/yr account. These free apps already did that and let you point them at your own server — so you skip the wall entirely for the pilot.

---

## How it works
```
 iPhone (friend)                         Your backend                 You (Android/web)
 ┌───────────────┐   background GPS      ┌──────────────────────┐     ┌────────────────┐
 │ OwnTracks /   │ ───── HTTP ────────▶ │ /api/tracking/ingest │ ──▶ │ Load Details   │
 │ Traccar (free)│  (screen off, all-day)│  → carrierLocation   │ ws  │ map (live)     │
 └───────────────┘                       └──────────────────────┘     └────────────────┘
```
The friend uses the free tracker for *location only*. They still **accept the load in the web app**. This validates your tracking pipeline + dashboard — exactly the pilot goal.

---

## Step 1 — Get the tracking link (you)
After the carrier has **accepted** the load, fetch its tracker config:

```
GET /api/tracking/ingest/link/:loadId
Authorization: Bearer <your shipper or carrier token>
```
Returns:
```json
{
  "loadId": "…",
  "token": "…",
  "owntracksUrl": "https://<your-host>/api/tracking/ingest/owntracks?loadId=…&token=…",
  "traccarUrl":   "https://<your-host>/api/tracking/ingest/osmand?loadId=…&token=…",
  "instructions": { "owntracks": [ … ], "traccar": [ … ] }
}
```
Send the appropriate URL to your friend. The token is per-load and unguessable; a wrong token returns 401.

> **Important:** the URL must be your **public** address (the cloudflared tunnel from `PILOT_HOSTING.md`, or your deployed host) — not `localhost`. Set `PUBLIC_BASE_URL` in `backend/.env` to that public URL so the link is generated correctly, e.g. `PUBLIC_BASE_URL=https://abcd.trycloudflare.com`.

---

## Step 2 — Friend sets up the free app (one-time, ~2 min)

### Option A — OwnTracks (recommended; most frequent updates)
1. Install **OwnTracks** (free, App Store).
2. Open it → tap **(i)** → **Settings**.
3. **Mode: HTTP**.
4. Paste the **owntracksUrl** into the URL field.
5. Set reporting **Mode: "Move"** (live updates) — or **"Significant"** to save battery.
6. Allow Location: **Always**.

### Option B — Traccar Client (simplest; battery-friendly)
1. Install **Traccar Client** (free, App Store).
2. **Server URL** = paste the **traccarUrl**.
3. **Device identifier**: any value.
4. **Frequency**: 30 seconds.
5. Allow Location: **Always**, then toggle the service **ON**.

---

## Step 3 — Drive + watch
- Friend drops the phone in their pocket / on the dash, **screen off**.
- You open the load's **Details** on your dashboard → the truck marker moves live.

---

## Notes & limits
- **Battery:** "Move"/30s is frequent; "Significant changes" is lighter but updates less often. Tell your friend to plug in for long hauls.
- **Privacy:** the tracker reports location only while your friend has the app's service ON. They turn it off when the load's done.
- **Security:** each link is scoped to one load via an unguessable token; it only lets the holder post location for *that* load.
- **Units:** OwnTracks reports km/h; Traccar speed is converted from knots automatically.
- **This is for the pilot.** For your *own branded app* doing background GPS on iPhones in production, that's the EAS + TestFlight + $99 path (`MOBILE_BUILD.md`, when you're ready).

---

## Quick test (prove it works before involving a friend)
With the backend running and a known load token:
```bash
# OwnTracks-style ping
curl -X POST "https://<host>/api/tracking/ingest/owntracks?loadId=<id>&token=<token>" \
  -H "Content-Type: application/json" \
  -d '{"_type":"location","lat":35.5,"lon":-89.1,"vel":65,"cog":90}'

# Traccar-style ping
curl "https://<host>/api/tracking/ingest/osmand?loadId=<id>&token=<token>&lat=35.9&lon=-87.9&speed=35&bearing=85"
```
Then open the load on your dashboard — the marker should be at those coordinates.
