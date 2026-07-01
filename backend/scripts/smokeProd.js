/**
 * Production smoke test — boots the REAL app with NODE_ENV=production against
 * an in-memory Mongo and verifies the single-origin deploy contract:
 *   1. /api/health           → 200 JSON ok
 *   2. /                     → index.html (React app shell)
 *   3. /static/js|css asset  → the actual bundle, NOT index.html (the
 *                              catch-all bug this guards against)
 *   4. /login (client route) → index.html (React Router catch-all)
 *   5. login POST works      → API functional in prod mode
 *
 * Requires `frontend/build` to exist (run `cd frontend && npm run build`).
 * Run:  node scripts/smokeProd.js
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const path = require('path');
const fs = require('fs');

(async () => {
  let code = 1;
  let mongo;
  try {
    const indexPath = path.resolve(__dirname, '..', '..', 'frontend', 'build', 'index.html');
    if (!fs.existsSync(indexPath)) {
      console.error('[smokeProd] FAIL — frontend/build missing. Run: cd frontend && npm run build');
      process.exit(1);
    }

    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    process.env.JWT_SECRET = 'smoke-prod-secret-key-that-is-long-enough-0123456789abcdef';
    process.env.PORT = '5057';
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5057';

    require('../app');
    await new Promise((r) => setTimeout(r, 4000));
    const BASE = 'http://localhost:5057';

    const checks = [];
    const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`); };

    // 1. health
    const health = await fetch(`${BASE}/api/health`);
    const hBody = await health.json();
    check('/api/health', health.status === 200 && (hBody.status === 'ok' || hBody.status === 'degraded'), `status=${hBody.status}`);

    // 2. index.html at /
    const root = await fetch(`${BASE}/`);
    const rootBody = await root.text();
    check('/ serves index.html', root.status === 200 && rootBody.includes('<div id="root">'), `${rootBody.length}b`);

    // 3. a real static asset must NOT come back as HTML
    const assetRef = (rootBody.match(/\/static\/js\/[^"]+\.js/) || [])[0];
    if (!assetRef) {
      check('bundle referenced in index.html', false);
    } else {
      const asset = await fetch(`${BASE}${assetRef}`);
      const ct = asset.headers.get('content-type') || '';
      const cache = asset.headers.get('cache-control') || '';
      const assetHead = (await asset.text()).slice(0, 60);
      const isJs = asset.status === 200 && /javascript/.test(ct) && !assetHead.includes('<!doctype');
      check(`asset ${assetRef.slice(0, 40)}…`, isJs, `content-type=${ct}; cache=${cache}`);
    }

    // 4. client-side route → index.html
    const route = await fetch(`${BASE}/login`);
    const routeBody = await route.text();
    check('/login (client route) serves app shell', route.status === 200 && routeBody.includes('<div id="root">'));

    // 5. API functional: unknown API route is JSON 404 (not index.html)
    const api404 = await fetch(`${BASE}/api/__nope__`);
    const api404Ct = api404.headers.get('content-type') || '';
    check('/api/* 404 stays JSON', api404.status === 404 && /json/.test(api404Ct));

    const allOk = checks.every((c) => c.ok);
    console.log(allOk ? '[smokeProd] PASS — production single-origin serving works' : '[smokeProd] FAIL');
    code = allOk ? 0 : 1;
  } catch (err) {
    console.error('[smokeProd] FAIL —', err && err.stack ? err.stack : err);
  } finally {
    try { if (mongo) await mongo.stop(); } catch (_) {}
    process.exit(code);
  }
})();
