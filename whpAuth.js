// whp-auth client for a Node/Express tool.
//
// The tool never handles passwords: the browser posts credentials to whp-auth, gets a token,
// and sends it here as `Authorization: Bearer`. This verifies the token LOCALLY against
// whp-auth's public keys (fetched from its JWKS and cached), so there is no per-request network
// call and this tool cannot mint tokens.
//
// Env:
//   WHP_AUTH_JWKS_URL  e.g. https://whp-auth-production.up.railway.app/.well-known/jwks.json
//   WHP_AUTH_APP       this tool's slug, e.g. "tru-dropship" (must match the token audience)
//
// Requires: npm i jsonwebtoken jwks-rsa
//
// Usage:
//   const { requireUser, requireRole } = require('./whpAuth');
//   app.get('/api/items', requireUser, (req, res) => { /* req.user.email, req.user.role */ });
//   app.post('/api/items/reject', requireRole('admin'), (req, res) => { ... });

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const APP = (process.env.WHP_AUTH_APP || '').trim();
const JWKS_URL = (process.env.WHP_AUTH_JWKS_URL || '').trim();
const AUTH_URL = (process.env.WHP_AUTH_URL || '').trim().replace(/\/$/, '');
const ISSUER = 'whp-auth';

// Verifying locally means a token stays valid until it expires, even after someone's access has
// been taken away. Setting WHP_AUTH_URL closes that gap: the session is re-checked with whp-auth
// at most once a minute per token, so "sign out everywhere", a revoked grant, a lockout or a
// deactivated account take effect within a minute instead of within a working day.
const SESSION_RECHECK_MS = 60000;
const SESSION_TIMEOUT_MS = 5000;
const sessionCache = new Map();

async function sessionStillValid(token) {
  // Fails OPEN on purpose: whp-auth being unreachable must not lock every tool out at once.
  if (!AUTH_URL) return true;
  const hit = sessionCache.get(token);
  if (hit && Date.now() - hit.at < SESSION_RECHECK_MS) return hit.valid;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SESSION_TIMEOUT_MS);
    const r = await fetch(`${AUTH_URL}/api/session`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, app: APP }),
    });
    clearTimeout(timer);
    const valid = !!(await r.json()).valid;
    if (sessionCache.size > 2000) sessionCache.clear();
    sessionCache.set(token, { at: Date.now(), valid });
    return valid;
  } catch (e) {
    console.warn('[whp-auth] session check unavailable, allowing:', e.message);
    return true;
  }
}

const client = JWKS_URL
  ? jwksClient({ jwksUri: JWKS_URL, cache: true, cacheMaxAge: 600000, rateLimit: true })
  : null;

function getKey(header, cb) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return cb(err);
    cb(null, key.getPublicKey());
  });
}

function verify(token) {
  return new Promise((resolve, reject) => {
    if (!client || !APP) {
      return reject(new Error('whp-auth client not configured (WHP_AUTH_JWKS_URL, WHP_AUTH_APP)'));
    }
    jwt.verify(token, getKey, { algorithms: ['RS256'], audience: APP, issuer: ISSUER },
      (err, claims) => (err ? reject(err) : resolve(claims)));
  });
}

async function requireUser(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const token = hdr.slice(7).trim();
    const c = await verify(token);
    if (!(await sessionStillValid(token))) {
      return res.status(401).json({ error: 'This session has ended. Please sign in again.' });
    }
    req.user = {
      id: c.sub, email: c.email, role: c.role,
      permissions: c.perms || {}, isSuperadmin: !!c.sa, claims: c,
    };
    next();
  } catch (e) {
    if (String(e.message).includes('not configured')) {
      return res.status(500).json({ error: e.message });
    }
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRole(...roles) {
  const allowed = new Set(roles);
  return (req, res, next) => requireUser(req, res, () => {
    if (req.user.isSuperadmin || allowed.has(req.user.role)) return next();
    res.status(403).json({ error: "You don't have permission for this action" });
  });
}

module.exports = { requireUser, requireRole, verify };
