# FreightConnect — Testing Checklist

## Prerequisites
```bash
# 1. Set up MongoDB Atlas (free tier)
# 2. Create .env in backend/ (see .env.example)
# 3. Install dependencies
cd backend && npm install
cd ../frontend && npm install

# 4. Seed test data
cd backend && node scripts/seedTestData.js

# 5. Start servers
cd backend && npm run dev    # Port 5000
cd frontend && npm start     # Port 3000
```

**Test accounts (password: `Test1234!`):**
- Carrier: `carrier@test.com`
- Shipper: `shipper@test.com`  
- Admin: `admin@test.com`

---

## Test 1: Carrier Journey (Happy Path)

### 1.1 Login as Carrier
- [ ] Login with `carrier@test.com` / `Test1234!`
- [ ] Dashboard loads, SideNav visible
- [ ] No verification banner (already verified)

### 1.2 Browse Load Board
- [ ] Loads page shows 5 open loads + 1 accepted
- [ ] Can filter by equipment type
- [ ] Click a load → LoadDetailsModal opens
- [ ] Modal shows shipper reputation badges at top
- [ ] Schedule conflict check shows (green = no conflicts)

### 1.3 Accept a Load
- [ ] Click an open load → Accept
- [ ] Backend returns success (no schedule conflicts)
- [ ] Load status changes to "accepted"
- [ ] Chat thread auto-created
- [ ] Rate Confirmation PDF auto-generated

### 1.4 My Loads
- [ ] Navigate to My Loads → shows accepted loads
- [ ] Can see load details

### 1.5 Expenses
- [ ] Navigate to Expenses
- [ ] Click "Log Expense" → fill form (fuel, $85.00, Shell)
- [ ] Expense appears in table
- [ ] Upload a receipt (photo/PDF)
- [ ] Receipt icon turns green

### 1.6 Tax & Compliance
- [ ] Navigate to Tax & 1099
- [ ] Select current year → summary shows
- [ ] Download CSV → file includes income + expenses sections

---

## Test 2: Shipper Journey (Happy Path)

### 2.1 Login as Shipper
- [ ] Login with `shipper@test.com` / `Test1234!`
- [ ] Dashboard loads
- [ ] No verification banner (already verified)

### 2.2 Post a Load
- [ ] Navigate to Post Load
- [ ] Fill: title, origin (Houston TX), destination (Chicago IL), rate ($2500), equipment (Dry Van)
- [ ] Set pickup/delivery time windows
- [ ] Submit → load created successfully
- [ ] Load appears in Loads list as "open"

### 2.3 View Load Details
- [ ] Click the posted load
- [ ] LoadDetailsModal shows carrier reputation badges (if accepted)
- [ ] Can see bid form area

### 2.4 Verification Page
- [ ] Navigate to Verification
- [ ] All 5 steps show as completed (test account is pre-verified)
- [ ] Permissions show: can post loads ✓, can use contracts ✓

### 2.5 Track Accepted Load
- [ ] Click the accepted load (Miami → Nashville)
- [ ] Can see carrier location (if tracking active)

---

## Test 3: Unverified User Flows

### 3.1 New Carrier (Unverified)
- [ ] Sign up as new carrier (use new email)
- [ ] Login → Dashboard shows verification banner with progress bar
- [ ] Try to accept a load → get 403 error ("Complete carrier verification")
- [ ] Go to Verification page → submit MC/DOT number
- [ ] Upload COI document
- [ ] Upload W-9

### 3.2 New Shipper (Unverified)
- [ ] Sign up as new shipper (use new email)
- [ ] Login → Dashboard shows "Cannot Post Loads Yet" banner
- [ ] Try to post a load → get 403 error ("Add a payment method")
- [ ] Go to Verification page → see 5-step stepper
- [ ] Step 1: Click "Check My Email" → shows domain result
- [ ] Step 3: Enter EIN (12-3456789) → validates and stores masked

---

## Test 4: Load Cancellation

### 4.1 Shipper Cancels Open Load
- [ ] As shipper, post a load
- [ ] Cancel it → success, no fees
- [ ] Load status = cancelled

### 4.2 Shipper Cancels Accepted Load (TONU)
- [ ] As shipper, cancel the accepted Miami→Nashville load
- [ ] Response shows TONU fee ($250)
- [ ] Carrier gets notification about cancellation + TONU

### 4.3 Carrier Cancels Accepted Load
- [ ] As carrier, accept a load then cancel it
- [ ] Response shows trust score penalty (-5)
- [ ] Load re-opens as "open" for shipper
- [ ] Shipper gets notification

---

## Test 5: Dispute Flow

### 5.1 File Dispute
- [ ] As carrier, accept and "deliver" a load (via fleet assign + deliver)
- [ ] File dispute: PUT /api/loads/:id/dispute with reason
- [ ] Load status = "disputed"
- [ ] Other party gets notification

### 5.2 Admin Resolves
- [ ] Login as admin
- [ ] PUT /api/loads/:id/resolve with resolution: "shipper_fault"
- [ ] Load status = "resolved"
- [ ] Both parties get notification

---

## Test 6: Admin Dashboard

### 6.1 Admin Overview
- [ ] Login as `admin@test.com`
- [ ] Overview page shows stats
- [ ] Can see users, loads, exceptions

### 6.2 Pending Verifications
- [ ] GET /api/verification/admin/pending → list of pending users
- [ ] Can approve/reject carrier documents
- [ ] Can verify/reject shipper accounts

### 6.3 Fraud Alerts
- [ ] GET /api/fraud/alerts → list (may be empty with test data)

---

## Test 7: API Smoke Tests (curl)

```bash
BASE=http://localhost:5000/api

# Health check
curl $BASE/health

# Login as carrier
TOKEN=$(curl -s -X POST $BASE/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carrier@test.com","password":"Test1234!"}' | jq -r '.token')

# Browse loads
curl -H "Authorization: Bearer $TOKEN" $BASE/loads

# Check schedule conflicts for a load
LOAD_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $BASE/loads | jq -r '.[0]._id')
curl -H "Authorization: Bearer $TOKEN" $BASE/loads/$LOAD_ID/schedule-check

# Get reputation
curl -H "Authorization: Bearer $TOKEN" $BASE/reputation/$(curl -s -H "Authorization: Bearer $TOKEN" $BASE/loads | jq -r '.[0].postedBy')

# Log an expense
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  $BASE/expenses \
  -d '{"category":"fuel","amountCents":8500,"vendor":"Pilot","date":"2026-04-18","description":"Fuel stop I-35"}'

# Get expense summary
curl -H "Authorization: Bearer $TOKEN" "$BASE/expenses/summary/yearly?year=2026"

# Login as shipper
STOKEN=$(curl -s -X POST $BASE/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"shipper@test.com","password":"Test1234!"}' | jq -r '.token')

# Shipper verification status
curl -H "Authorization: Bearer $STOKEN" $BASE/verification/shipper/status

# Public tracking (if a tracking link exists)
# curl $BASE/tracking-portal/TOKEN_HERE
```

---

## Known Limitations (Not Bugs)

1. **Stripe payments**: Require real Stripe test keys to test escrow flow
2. **Email notifications**: Require EMAIL_USER/PASS to actually send
3. **FMCSA verification**: Requires FMCSA_API_KEY for real MC/DOT lookup
4. **Route visualization**: Requires ORS_API_KEY for map routes
5. **Geofence check-in**: Only triggers when carrier sends GPS via socket (mobile app or browser tracking)
6. **Fraud detection**: Runs every 6 hours via cron — won't show results immediately with test data
