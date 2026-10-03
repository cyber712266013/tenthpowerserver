/**
 * src/marketplace/jwt.mjs
 * وظائف التشفير وإدارة الـ JWT والتحقق من المستخدمين
 */
import { createHmac } from 'node:crypto';

export function b64url(str) {
  return Buffer.from(str).toString('base64url');
}

export function signJwt(payload, secret, expiresInDays = 30) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInDays * 86400,
  }));
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = createHmac('sha256', secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function extractAuthUser(req, jwtSecret) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return verifyJwt(token, jwtSecret);
}
