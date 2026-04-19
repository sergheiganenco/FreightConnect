# CLAUDE.md — FreightConnect Development Guide

## Project Overview
FreightConnect is a freight marketplace platform that eliminates brokers by connecting shippers and carriers directly. The platform automates every function a traditional freight broker performs: trust/vetting, load matching, price negotiation, payments, documentation, exception handling, and communication.

## Tech Stack
- **Backend:** Node.js, Express, MongoDB (Mongoose), Socket.IO, JWT auth, PDFKit, Stripe (pending)
- **Frontend:** React 18, MUI 6, React Router 6, Leaflet maps, Recharts, Socket.IO client, Axios
- **Mobile:** React Native (Expo SDK 54), expo-location (background GPS), expo-camera, expo-notifications
- **Architecture:** Monorepo with `/backend`, `/frontend`, and `/mobile` directories

## Project Structure
```
FreightConnect/
├── backend/
│   ├── app.js                    # Express server, Socket.IO, route mounting
│   ├── controllers/              # documentController.js
│   ├── models/                   # Mongoose schemas: User, Load, Truck, Company, Invoice, AdminActivity
│   ├── routes/
│   │   ├── userRoutes.js         # /api/users
│   │   ├── loadRoutes.js         # /api/loads (factory fn, receives io)
│   │   ├── documentRoutes.js     # /api/documents
│   │   ├── chatbot.js            # /api/chatbot
│   │   ├── carrierAnalyticsRoutes.js  # /api/carrier/analytics
│   │   ├── shipperAnalyticsRoutes.js  # /api/shipper/analytics
│   │   ├── adminRoutes.js        # /api/admin (users, loads, overview)
│   │   └── adminFleetRoutes.js   # /api/admin (companies/fleet)
│   ├── middlewares/              # authMiddleware.js (JWT verification)
│   ├── services/                 # emailService.js (Nodemailer)
│   ├── utils/
│   │   ├── pdfGenerator.js       # BOL generation
│   │   ├── socket.js             # IO singleton (setIO/getIO)
│   │   └── companyNormalize.js   # Company name normalization helper
│   ├── templates/                # Email/document templates
│   └── public/documents/uploads/ # File storage
├── frontend/
│   ├── src/
│   │   ├── App.js               # Route definitions
│   │   ├── config/
│   │   │   └── branding.js      # App branding constants
│   │   ├── components/          # Shared components: Navbar, Footer, LogisticsAssistant,
│   │   │                        # LoadDetailsModal, MapComponent, Notifications, PrivateRoute, etc.
│   │   ├── features/
│   │   │   ├── carrierDashboard/
│   │   │   │   ├── hooks/       # useCarrierLoads.js
│   │   │   │   └── sections/    # CarrierLoadBoardSection, DocumentsSection, AssistantSection
│   │   │   │       ├── components/  # LoadCard, LoadGrid, FilterDrawer, SideNav, StatusChip, SkeletonLoadCard
│   │   │   │       └── context/     # DashboardContext.js
│   │   │   ├── shipperDashboard/
│   │   │   │   ├── hooks/       # useShipperLoads.js
│   │   │   │   └── sections/    # ShipperLoadBoardSection
│   │   │   │       └── components/  # LoadCard, LoadGrid, SideNav, StatusChip, SkeletonLoadCard
│   │   │   ├── adminDashboard/
│   │   │   │   └── section/     # OverviewSection, LoadsSection, UsersSection
│   │   │   │       └── components/  # SideNav
│   │   │   ├── analytics/       # AnalyticsSummarySection, AnalyticsChartSection
│   │   │   └── shared/          # KPICard, AnalyticsCharts, AnalyticsActivityTable,
│   │   │                        # DocumentCard, DocumentGrid, DocumentRow
│   │   ├── pages/
│   │   │   ├── carrier/         # CarrierDashboard, CarrierMyLoads, CarrierFleet,
│   │   │   │                    # CarrierLiveMap, CarrierDocuments, CarrierAnalytics, CarrierProfile
│   │   │   ├── shipper/         # ShipperDashboard, ShipperLoads, ShipperPostLoad,
│   │   │   │                    # ShipperDocuments, ShipperAnalytics, ShipperProfile
│   │   │   ├── admin/           # AdminDashboard, AdminOverview, AdminLoads,
│   │   │   │                    # AdminUsers, AdminCompanies, AdminProfile
│   │   │   └── (public)         # Home, About, Features, Contact, Login, Signup, FleetMap, ForgotPassword
│   │   ├── services/            # api.js (Axios instance), socket.js
│   │   └── styles/              # CSS files
│   └── public/                  # Static assets
├── mobile/
│   ├── App.js                   # Root: AuthProvider + NavigationContainer
│   ├── app.json                 # Expo config (permissions, plugins)
│   └── src/
│       ├── constants/config.js  # API URL, colors, tracking config
│       ├── context/AuthContext.js # JWT auth via SecureStore
│       ├── navigation/          # AppNavigator (tabs), AuthNavigator
│       ├── screens/             # Login, LoadBoard, LoadDetail, PODUpload, Chat, Profile
│       └── services/            # api.js, socket.js, tracking.js (background GPS), notifications.js
```

## Routing Structure
All dashboards use nested React Router outlets:

| Role    | Base path            | Nested routes                                               |
|---------|----------------------|-------------------------------------------------------------|
| Shipper | `/dashboard/shipper` | `loads`, `post-load`, `documents`, `analytics`, `profile`  |
| Carrier | `/dashboard/carrier` | `loads`, `documents`, `my-loads`, `fleet`, `live-map`, `fleet-map`, `analytics`, `profile` |
| Admin   | `/dashboard/admin`   | `overview`, `loads`, `users`, `companies`, `profile`       |

## Key Conventions
- All API routes are prefixed with `/api/`
- Auth uses JWT tokens stored in localStorage, attached via Axios interceptor
- User roles: `carrier`, `shipper`, `admin`
- Socket.IO is initialized in app.js, shared via `utils/socket.js` singleton (`setIO`/`getIO`)
- `loadRoutes.js` is a factory function — called with `io` in app.js: `require('./routes/loadRoutes')(io)`
- Frontend uses MUI theming with custom glassmorphism palette defined in `components/theme.js`
- Protected routes use the `PrivateRoute` component
- All dates use ISO format
- Load statuses: `open`, `accepted`, `in-transit`, `delivered`, `cancelled`, `disputed`
- Role-based pages live under `pages/carrier/`, `pages/shipper/`, `pages/admin/` (not flat `pages/`)
- Shared analytics UI primitives live in `features/shared/` and `features/analytics/`

## Environment Variables (Required)
```
# Backend (.env)
MONGO_URI=           # MongoDB Atlas connection string
PORT=5000
JWT_SECRET=          # Strong random string 64+ chars
JWT_EXPIRES_IN=1d
ORS_API_KEY=         # OpenRouteService API key
EMAIL_USER=          # Gmail or SMTP email
EMAIL_PASS=          # App password (not regular password)
STRIPE_SECRET_KEY=   # Stripe secret key
STRIPE_WEBHOOK_SECRET= # Stripe webhook signing secret
FMCSA_API_KEY=       # FMCSA SAFER Web API key

# Frontend (.env)
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_STRIPE_PUBLIC_KEY= # Stripe publishable key
REACT_APP_GOOGLE_MAPS_KEY=   # Google Maps API key (optional, using Leaflet currently)
```

## Development Commands
```bash
# Backend
cd backend && npm install && npm run dev   # Starts with nodemon on port 5000

# Frontend
cd frontend && npm install && npm start    # Starts CRA on port 3000

# Mobile (Expo)
cd mobile && npm install && npx expo start # Starts Metro bundler, scan QR with Expo Go
# For physical device: update API_URL in src/constants/config.js to your LAN IP
# For Android emulator: API_URL uses 10.0.2.2 (default)
```

## Implementation Master Plan
The full implementation guide is split into two files at the repo root:
- `IMPLEMENTATION_GUIDE.md` — Phases 0–10 (security, chat, trust, matching, pricing, payments, documents, exceptions, notifications, carrier network, analytics)
- `IMPLEMENTATION_GUIDE_PART2.md` — Phases 11–20 (contracts, appointments, trip planning, ELD, tax, reefer, factoring, EDI, multi-stop, production readiness) + Developer Onboarding Checklist

Follow phases in order. Each phase builds on the previous one. Each phase ends with a verification checklist — do not proceed until all items pass.

**For new developers:** Start with the Developer Onboarding Checklist at the bottom of IMPLEMENTATION_GUIDE_PART2.md.

**For live testing:** See `TESTING_PACKAGE.md` for deployment options, seed data script, test accounts, and structured test scenarios.

**For mobile:** See `MOBILE_STRATEGY.md` for PWA enhancement (immediate) and React Native carrier app (post-validation).

## Critical Rules for Claude Code
1. **NEVER commit .env files** — they are in .gitignore
2. **NEVER log passwords or tokens** — remove any console.log that outputs sensitive data
3. **Always add input validation** — use express-validator on all routes
4. **Always add error handling** — try/catch with meaningful error messages
5. **Create feature branches** — one branch per phase (e.g., `feature/trust-engine`, `feature/chat-system`)
6. **Write tests** — at minimum, test auth flows, payment flows, and matching logic
7. **Follow existing patterns** — match the code style, file organization, and naming conventions already in the project
8. **Use existing Socket.IO infrastructure** — don't create new socket connections, extend the existing one in app.js
9. **Use existing MUI theme** — extend `components/theme.js` rather than inline styling
10. **Backend routes follow RESTful conventions** — GET for reads, POST for creates, PUT for updates, DELETE for deletes
11. **All financial calculations use integers (cents)** — never floating point for money
12. **All new models need proper indexes** — add MongoDB indexes for fields used in queries
13. **Never import entire libraries** — use tree-shaking imports (e.g., `import { Box } from '@mui/material'` not `import * as MUI`)
14. **New pages go in the correct role subfolder** — `pages/carrier/`, `pages/shipper/`, or `pages/admin/`; never add new pages to the flat `pages/` root unless they are public/marketing pages
15. **Shared UI components used by multiple roles** belong in `features/shared/`; analytics sub-components belong in `features/analytics/`
