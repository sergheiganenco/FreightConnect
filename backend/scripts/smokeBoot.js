/**
 * Smoke boot test — starts the real app against an in-memory Mongo and hits
 * /api/health to confirm the whole server actually boots (every route, model,
 * service, agent, and job wired). Catches runtime errors that `node --check`
 * (syntax only) and isolated jest handlers cannot.
 *
 * Run:  node scripts/smokeBoot.js
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

(async () => {
  let code = 1;
  let mongo;
  try {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    process.env.JWT_SECRET = 'smoke-test-secret-key-that-is-definitely-long-enough-0123456789';
    process.env.PORT = '5055';
    process.env.NODE_ENV = 'development'; // load agents + jobs to catch their require/init errors

    // Boot the real server (this calls server.listen and initializes agents/jobs)
    require('../app');

    // Give Mongo connect + route mount a moment
    await new Promise((r) => setTimeout(r, 3500));

    const res = await fetch('http://localhost:5055/api/health');
    const body = await res.json();
    console.log('[smoke] /api/health →', res.status, JSON.stringify(body));

    // Also confirm a 404 handler responds (route layer is active)
    const nf = await fetch('http://localhost:5055/api/__does_not_exist__');
    console.log('[smoke] unknown route →', nf.status, '(expected 404)');

    if (res.status === 200 && body && (body.status === 'ok' || body.status === 'degraded')) {
      console.log('[smoke] PASS — server booted and is serving requests');
      code = 0;
    } else {
      console.error('[smoke] FAIL — unexpected health response');
    }
  } catch (err) {
    console.error('[smoke] FAIL — boot error:', err && err.stack ? err.stack : err);
  } finally {
    try { if (mongo) await mongo.stop(); } catch (_) {}
    process.exit(code);
  }
})();
