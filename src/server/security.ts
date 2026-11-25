import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import type express from 'express';
import type { SmtpSettingsPublic } from '../shared/reminderTypes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const SESSION_SECRET_PATH = path.resolve(DATA_DIR, '.session-secret');

export const ADMIN_COOKIE_NAME = 'ap_admin_session';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

const revokedSessionIds = new Map<string, number>();
let cachedSessionSecret: string | null = null;

function getSessionSecret(): string {
  const envSecret = (process.env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return envSecret;
  }
  if (cachedSessionSecret) {
    return cachedSessionSecret;
  }
  try {
    if (fs.existsSync(SESSION_SECRET_PATH)) {
      const existing = fs.readFileSync(SESSION_SECRET_PATH, 'utf8').trim();
      if (existing.length >= 32) {
        cachedSessionSecret = existing;
        return existing;
      }
    }
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SESSION_SECRET_PATH, generated, { encoding: 'utf8', mode: 0o600 });
    cachedSessionSecret = generated;
    return generated;
  } catch {
    cachedSessionSecret = crypto.randomBytes(48).toString('hex');
    return cachedSessionSecret;
  }
}

function authVersionDigest(authUpdatedAtIso: string): string {
  return crypto.createHash('sha256').update(authUpdatedAtIso).digest('hex').slice(0, 16);
}

function signSessionPayload(payload: string): string {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');
}

function purgeExpiredRevocations(now: number): void {
  for (const [sid, exp] of revokedSessionIds.entries()) {
    if (exp <= now) {
      revokedSessionIds.delete(sid);
    }
  }
}

export function createSignedAdminSessionToken(authUpdatedAtIso: string): string {
  const sid = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + ADMIN_SESSION_TTL_MS;
  const ver = authVersionDigest(authUpdatedAtIso);
  const payload = `${sid}.${exp}.${ver}`;
  const sig = signSessionPayload(payload);
  return `${payload}.${sig}`;
}

export function verifySignedAdminSessionToken(
  token: string | undefined | null,
  currentAuthUpdatedAtIso: string | null
): boolean {
  if (!token || !currentAuthUpdatedAtIso) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 4) return false;

  const [sid, expStr, ver, sig] = parts;
  if (!sid || !expStr || !ver || !sig) return false;

  const exp = Number(expStr);
  const now = Date.now();
  if (!Number.isFinite(exp) || exp <= now) return false;

  if (revokedSessionIds.size > 100) {
    purgeExpiredRevocations(now);
  }
  if (revokedSessionIds.has(sid)) return false;

  const expectedVer = authVersionDigest(currentAuthUpdatedAtIso);
  if (ver !== expectedVer) return false;

  const payload = `${sid}.${expStr}.${ver}`;
  const expectedSig = signSessionPayload(payload);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function revokeAdminSessionToken(token: string | undefined | null): void {
  if (!token) return;
  const parts = token.trim().split('.');
  if (parts.length !== 4) return;
  const [sid, expStr] = parts;
  const exp = Number(expStr);
  if (sid && Number.isFinite(exp) && exp > Date.now()) {
    revokedSessionIds.set(sid, exp);
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function extractAdminTokenFromRequest(req: express.Request): string | undefined {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[ADMIN_COOKIE_NAME];
  if (cookieToken && cookieToken.trim()) {
    return cookieToken.trim();
  }
  const header = req.headers['x-admin-token'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return undefined;
}

function isRequestHttps(req: express.Request): boolean {
  if (req.secure) return true;
  const xfProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (xfProto.split(',').some((p) => p.trim() === 'https')) return true;
  const xfScheme = String(req.headers['x-forwarded-scheme'] || '').toLowerCase();
  if (xfScheme === 'https') return true;
  const origin = String(req.headers.origin || '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  const referer = String(req.headers.referer || '').toLowerCase();
  if (referer.startsWith('https://')) return true;
  return false;
}

export function setAdminSessionCookie(
  req: express.Request,
  res: express.Response,
  token: string
): void {
  const maxAgeSec = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const https = isRequestHttps(req);
  const attrs = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
    https ? 'SameSite=None' : 'SameSite=Lax',
    ...(https ? ['Secure', 'Partitioned'] : []),
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function clearAdminSessionCookie(req: express.Request, res: express.Response): void {
  const https = isRequestHttps(req);
  const attrs = [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    https ? 'SameSite=None' : 'SameSite=Lax',
    ...(https ? ['Secure', 'Partitioned'] : []),
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}

export function getClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// =========================================================================
// PROGRESSIVE BRUTE-FORCE LOCKOUT TRACKER
// =========================================================================
interface LoginAttemptState {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginAttemptsByIp = new Map<string, LoginAttemptState>();

export function checkLoginLockout(ip: string): { locked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = loginAttemptsByIp.get(ip);
  if (!entry) return { locked: false, retryAfterSec: 0 };

  if (entry.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
    };
  }
  if (now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttemptsByIp.delete(ip);
  }
  return { locked: false, retryAfterSec: 0 };
}

export function recordLoginFailure(ip: string): {
  locked: boolean;
  attemptsRemaining: number;
  retryAfterSec: number;
} {
  const now = Date.now();
  let entry = loginAttemptsByIp.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    entry = { failures: 0, windowStart: now, lockedUntil: 0 };
  }
  entry.failures += 1;
  if (entry.failures >= MAX_LOGIN_FAILURES) {
    entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    loginAttemptsByIp.set(ip, entry);
    return {
      locked: true,
      attemptsRemaining: 0,
      retryAfterSec: Math.ceil(LOGIN_LOCKOUT_MS / 1000),
    };
  }
  loginAttemptsByIp.set(ip, entry);
  return {
    locked: false,
    attemptsRemaining: Math.max(0, MAX_LOGIN_FAILURES - entry.failures),
    retryAfterSec: 0,
  };
}

export function clearLoginFailures(ip: string): void {
  loginAttemptsByIp.delete(ip);
}

// =========================================================================
// SLIDING-WINDOW RATE LIMITER MIDDLEWARE
// =========================================================================
interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  name: string;
  windowMs: number;
  maxRequests: number;
  message?: string;
}): express.RequestHandler {
  const buckets = new Map<string, RateBucket>();
  let lastCleanup = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > options.windowMs) {
      for (const [key, b] of buckets.entries()) {
        if (b.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const key = `${options.name}:${getClientIp(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        ok: false,
        error:
          options.message ||
          `Too many requests. Please wait ${retryAfterSec} seconds and try again.`,
      });
      return;
    }

    next();
  };
}

// =========================================================================
// SECURITY HEADERS & CORS MIDDLEWARE
// =========================================================================
export function securityHeadersMiddleware(): express.RequestHandler {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://accounts.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com",
    "connect-src 'self' https://cluster-1-planning-fo-control-tower-9b844.containers.snapdeploy.app https://shakhawatsvlog-lab.github.io https://*.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://*.firebaseapp.com wss: ws:",
    "frame-src 'self' https://accounts.google.com https://content.googleapis.com https://*.firebaseapp.com",
    "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', cspDirectives);

    if (process.env.NODE_ENV === 'production' && isRequestHttps(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  };
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://shakhawatsvlog-lab.github.io',
  'https://cluster-1-planning-fo-control-tower-9b844.containers.snapdeploy.app',
];

function getAllowedCorsOrigins(req: express.Request): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const appUrl = (process.env.APP_URL || '').trim();
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // ignore invalid APP_URL
    }
  }
  const extra = (process.env.ALLOWED_ORIGINS || '').trim();
  if (extra) {
    for (const part of extra.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        allowed.add(new URL(trimmed).origin);
      } catch {
        // ignore invalid origin
      }
    }
  }
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (host) {
    const cleanHost = String(host).split(',')[0].trim();
    const proto = isRequestHttps(req) ? 'https' : req.protocol || 'http';
    allowed.add(`${proto}://${cleanHost}`);
  }
  return allowed;
}

export function corsMiddleware(): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = getAllowedCorsOrigins(req);
      if (allowed.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
      } else if (req.method === 'OPTIONS') {
        res.status(403).end();
        return;
      }
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

// =========================================================================
// SSRF PROTECTION FOR ONLINE SHEET URLS
// =========================================================================
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // Link-local & cloud metadata 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18.0.0/15
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isPrivateOrReservedIp(rawIp: string): boolean {
  const clean = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = net.isIP(clean);
  if (version === 4) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (version === 6) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('::ffff:')) {
      return isPrivateOrReservedIpv4(clean.slice('::ffff:'.length));
    }
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(clean)) return true; // link-local fe80::/10
    if (clean.startsWith('ff')) return true; // multicast
    return false;
  }
  return true;
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid external sheet URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTPS or HTTP sheet URLs are permitted.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded URL credentials are not allowed.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Local or internal hostnames are blocked for security.');
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('Private or loopback IP addresses are blocked for security.');
    }
    return parsed;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve remote host "${hostname}".`);
  }

  if (!resolved || resolved.length === 0) {
    throw new Error(`Could not resolve remote host "${hostname}".`);
  }
  for (const addr of resolved) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new Error('Resolved IP address belongs to a restricted private network.');
    }
  }

  return parsed;
}

// =========================================================================
// UPLOAD VALIDATION & REDACTION HELPERS
// =========================================================================
export function validateBase64Upload(params: {
  base64: string;
  fileName: string;
  allowedExtensions: Array<'xlsx' | 'xlsm' | 'csv'>;
  maxBytes?: number;
}): { buffer: Buffer; ext: 'xlsx' | 'xlsm' | 'csv' } {
  const max = params.maxBytes ?? MAX_UPLOAD_BYTES;
  const cleanName = params.fileName.trim().toLowerCase();
  const extMatch = cleanName.match(/\.([a-z0-9]+)$/);
  const ext = (extMatch?.[1] || '') as 'xlsx' | 'xlsm' | 'csv';
  if (!params.allowedExtensions.includes(ext)) {
    throw new Error(
      `Unsupported file format. Allowed formats: ${params.allowedExtensions
        .map((e) => `.${e}`)
        .join(', ')}.`
    );
  }

  // Strip optional data URI prefix safely
  const rawBase64 = params.base64.includes(',')
    ? params.base64.slice(params.base64.indexOf(',') + 1)
    : params.base64;

  const estimatedBytes = Math.ceil((rawBase64.length * 3) / 4);
  if (estimatedBytes > max) {
    throw new Error(
      `Uploaded file exceeds the ${Math.round(max / (1024 * 1024))} MB size limit.`
    );
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }
  if (buffer.length > max) {
    throw new Error(
      `Uploaded file exceeds the ${Math.round(max / (1024 * 1024))} MB size limit.`
    );
  }

  if (ext === 'xlsx' || ext === 'xlsm') {
    const isZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
    if (!isZip) {
      throw new Error('Invalid Excel (.xlsx) file signature.');
    }
  } else if (ext === 'csv') {
    if (buffer.includes(0)) {
      throw new Error('Invalid CSV file: binary content detected.');
    }
  }

  return { buffer, ext };
}

export function redactSmtpStatusForPublic(status: SmtpSettingsPublic): SmtpSettingsPublic {
  return {
    configured: status.configured,
    source: status.configured ? status.source : 'none',
    providerPreset: status.providerPreset,
    host: '',
    port: status.port,
    secure: status.secure,
    user: '',
    fromName: status.fromName,
    fromEmail: '',
    hasPassword: status.hasPassword,
    senderEmail: null,
  };
}

export function toSafeClientError(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) return fallbackMessage;
  const msg = error.message || '';
  // Reject errors leaking internal stack/paths or API keys
  if (
    msg.includes('/app/') ||
    msg.includes(':\\') ||
    msg.includes('ENOENT') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('GEMINI_API_KEY')
  ) {
    return fallbackMessage;
  }
  return msg.slice(0, 300) || fallbackMessage;
}
