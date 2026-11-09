// Signed session tokens: base64url(JSON) + "." + HMAC-SHA256. Tampered or expired tokens are rejected.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type Session =
  | { role: 'ops'; staffId: number; username: string; name: string; exp: number }
  | { role: 'borrower'; bookId: number; bid: string; name: string; exp: number };

export const SESSION_COOKIE = 'hisaab_session';
export const SESSION_HOURS = 12;

const g = globalThis as unknown as { __hisaabSecret?: string };
/**
 * SESSION_SECRET signs sessions. Without it, development uses a fixed key so sessions survive restarts;
 * production uses a random key per server process (sessions end when it restarts) and warns once.
 */
export function sessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NODE_ENV !== 'production') return 'hisaab-dev-only-session-secret';
  if (!g.__hisaabSecret) {
    g.__hisaabSecret = randomBytes(32).toString('hex');
    console.warn('[hisaab] SESSION_SECRET is not set: using a random key, so sign-ins end when the server restarts.');
  }
  return g.__hisaabSecret;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest();

export function signSession(s: Session, secret = sessionSecret()): string {
  const body = b64(JSON.stringify(s));
  return body + '.' + b64(mac(body, secret));
}

export function verifySession(token: string | undefined | null, secret = sessionSecret(), now = Date.now()): Session | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1), 'base64url');
  const want = mac(body, secret);
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Session;
    if (!s || typeof s.exp !== 'number' || s.exp < now) return null;
    if (s.role === 'ops' && typeof s.staffId === 'number' && typeof s.name === 'string') return s;
    if (s.role === 'borrower' && typeof s.bookId === 'number' && typeof s.bid === 'string') return s;
    return null;
  } catch {
    return null;
  }
}

export const expiresIn = (hours = SESSION_HOURS, now = Date.now()) => now + hours * 3600 * 1000;
