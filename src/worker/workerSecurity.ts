import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import type { WorkerEnv } from './cfTypes.ts';
import { ensureD1Schema } from './d1Store.ts';

export const ADMIN_COOKIE_NAME = 'ap_admin_session';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

const MAX_LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

let localDevEphemeralSecret: string | null = null;

function isLocalDevRequest(request?: Request): boolean {
  if (!request) return false;
  try {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function getWorkerSessionSecret(env: WorkerEnv, request?: Request): string {
  const envSecret = (env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return envSecret;
  }
  if (env.NODE_ENV !== 'production' || isLocalDevRequest(request)) {
    if (!localDevEphemeralSecret) {
      localDevEphemeralSecret = crypto.randomBytes(48).toString('hex');
    }
    return localDevEphemeralSecret;
  }
  throw new Error(
    'SESSION_SECRET is not configured on the Worker. Set it with `wrangler secret put SESSION_SECRET`.'
  );
}

function authVersionDigest(authUpdatedAtIso: string): string {
  return crypto.createHash('sha256').update(authUpdatedAtIso).digest('hex').slice(0, 16);
}

function signSessionPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSignedAdminSessionTokenWorker(
  env: WorkerEnv,
  authUpdatedAtIso: string,
  request?: Request
): string {
  const secret = getWorkerSessionSecret(env, request);
  const sid = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + ADMIN_SESSION_TTL_MS;
  const ver = authVersionDigest(authUpdatedAtIso);
  const payload = `${sid}.${exp}.${ver}`;
  const sig = signSessionPayload(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySignedAdminSessionTokenWorker(
  env: WorkerEnv,
  token: string | undefined | null,
  currentAuthUpdatedAtIso: string | null,
  request?: Request
): Promise<boolean> {
  if (!token || !currentAuthUpdatedAtIso) return false;
  let secret: string;
  try {
    secret = getWorkerSessionSecret(env, request);
  } catch {
    return false;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 4) return false;

  const [sid, expStr, ver, sig] = parts;
  if (!sid || !expStr || !ver || !sig) return false;

  const exp = Number(expStr);
  const now = Date.now();
  if (!Number.isFinite(exp) || exp <= now) return false;

  const expectedVer = authVersionDigest(currentAuthUpdatedAtIso);
  if (ver !== expectedVer) return false;

  const payload = `${sid}.${expStr}.${ver}`;
  const expectedSig = signSessionPayload(payload, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  await ensureD1Schema(env.DB);
  const revoked = await env.DB.prepare(
    `SELECT sid, expires_at FROM revoked_sessions WHERE sid = ?`
  )
    .bind(sid)
    .first<{ sid: string; expires_at: number }>();

  if (revoked && Number(revoked.expires_at) > now) {
    return false;
  }

  return true;
}

export async function revokeAdminSessionTokenWorker(
  env: WorkerEnv,
  token: string | undefined | null
): Promise<void> {
  if (!token) return;
  const parts = token.trim().split('.');
  if (parts.length !== 4) return;
  const [sid, expStr] = parts;
  const exp = Number(expStr);
  const now = Date.now();
  if (!sid || !Number.isFinite(exp) || exp <= now) return;

  await ensureD1Schema(env.DB);
  await env.DB.prepare(
    `INSERT INTO revoked_sessions (sid, expires_at)
     VALUES (?, ?)
     ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at`
  )
    .bind(sid, exp)
    .run();
  await env.DB.prepare(`DELETE FROM revoked_sessions WHERE expires_at <= ?`).bind(now).run();
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
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

export function extractAdminTokenFromRequestWorker(request: Request): {
  token?: string;
  viaCookie: boolean;
  viaHeader: boolean;
} {
  const cookies = parseCookies(request.headers.get('cookie'));
  const cookieToken = cookies[ADMIN_COOKIE_NAME];
  const headerToken = request.headers.get('x-admin-token');

  if (cookieToken && cookieToken.trim()) {
    return {
      token: cookieToken.trim(),
      viaCookie: true,
      viaHeader: Boolean(headerToken && headerToken.trim()),
    };
  }
  if (headerToken && headerToken.trim()) {
    return {
      token: headerToken.trim(),
      viaCookie: false,
      viaHeader: true,
    };
  }
  return { viaCookie: false, viaHeader: false };
}

export function isRequestHttpsWorker(request: Request): boolean {
  try {
    const u = new URL(request.url);
    if (u.protocol === 'https:') return true;
  } catch {
    // ignore
  }
  const xfProto = (request.headers.get('x-forwarded-proto') || '').toLowerCase();
  if (xfProto.split(',').some((p) => p.trim() === 'https')) return true;
  const origin = (request.headers.get('origin') || '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  const referer = (request.headers.get('referer') || '').toLowerCase();
  if (referer.startsWith('https://')) return true;
  return false;
}

export function buildAdminSessionSetCookieHeader(request: Request, token: string): string {
  const maxAgeSec = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const https = isRequestHttpsWorker(request);
  const attrs = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
    https ? 'SameSite=None' : 'SameSite=Lax',
    ...(https ? ['Secure', 'Partitioned'] : []),
  ];
  return attrs.join('; ');
}

export function buildAdminSessionClearCookieHeader(request: Request): string {
  const https = isRequestHttpsWorker(request);
  const attrs = [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    https ? 'SameSite=None' : 'SameSite=Lax',
    ...(https ? ['Secure', 'Partitioned'] : []),
  ];
  return attrs.join('; ');
}

export function getClientIpWorker(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.trim()) return xff.split(',')[0].trim();
  return 'unknown';
}

// =========================================================================
// D1-BACKED PROGRESSIVE BRUTE-FORCE LOCKOUT TRACKER
// =========================================================================
export async function checkLoginLockoutWorker(
  env: WorkerEnv,
  ip: string
): Promise<{ locked: boolean; retryAfterSec: number }> {
  await ensureD1Schema(env.DB);
  const now = Date.now();
  const entry = await env.DB.prepare(
    `SELECT failures, window_start, locked_until FROM login_attempts WHERE ip = ?`
  )
    .bind(ip)
    .first<{ failures: number; window_start: number; locked_until: number }>();

  if (!entry) return { locked: false, retryAfterSec: 0 };

  if (Number(entry.locked_until) > now) {
    return {
      locked: true,
      retryAfterSec: Math.max(1, Math.ceil((Number(entry.locked_until) - now) / 1000)),
    };
  }
  if (now - Number(entry.window_start) > LOGIN_WINDOW_MS) {
    await env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
  }
  return { locked: false, retryAfterSec: 0 };
}

export async function recordLoginFailureWorker(
  env: WorkerEnv,
  ip: string
): Promise<{ locked: boolean; attemptsRemaining: number; retryAfterSec: number }> {
  await ensureD1Schema(env.DB);
  const now = Date.now();
  const existing = await env.DB.prepare(
    `SELECT failures, window_start, locked_until FROM login_attempts WHERE ip = ?`
  )
    .bind(ip)
    .first<{ failures: number; window_start: number; locked_until: number }>();

  let failures = 0;
  let windowStart = now;
  if (existing && now - Number(existing.window_start) <= LOGIN_WINDOW_MS) {
    failures = Number(existing.failures);
    windowStart = Number(existing.window_start);
  }
  failures += 1;
  const lockedUntil = failures >= MAX_LOGIN_FAILURES ? now + LOGIN_LOCKOUT_MS : 0;

  await env.DB.prepare(
    `INSERT INTO login_attempts (ip, failures, window_start, locked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       failures = excluded.failures,
       window_start = excluded.window_start,
       locked_until = excluded.locked_until`
  )
    .bind(ip, failures, windowStart, lockedUntil)
    .run();

  if (lockedUntil > 0) {
    return {
      locked: true,
      attemptsRemaining: 0,
      retryAfterSec: Math.ceil(LOGIN_LOCKOUT_MS / 1000),
    };
  }

  return {
    locked: false,
    attemptsRemaining: Math.max(0, MAX_LOGIN_FAILURES - failures),
    retryAfterSec: 0,
  };
}

export async function clearLoginFailuresWorker(env: WorkerEnv, ip: string): Promise<void> {
  await ensureD1Schema(env.DB);
  await env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
}

// =========================================================================
// D1-BACKED SLIDING-WINDOW RATE LIMITER
// =========================================================================
export async function checkRateLimitWorker(
  env: WorkerEnv,
  request: Request,
  options: { name: string; windowMs: number; maxRequests: number; message?: string }
): Promise<{ allowed: boolean; retryAfterSec?: number; message?: string }> {
  await ensureD1Schema(env.DB);
  const now = Date.now();
  const key = `${options.name}:${getClientIpWorker(request)}`;

  const existing = await env.DB.prepare(
    `SELECT count, reset_at FROM rate_limits WHERE bucket_key = ?`
  )
    .bind(key)
    .first<{ count: number; reset_at: number }>();

  let count = 1;
  let resetAt = now + options.windowMs;
  if (existing && Number(existing.reset_at) > now) {
    count = Number(existing.count) + 1;
    resetAt = Number(existing.reset_at);
  }

  await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, count, reset_at)
     VALUES (?, ?, ?)
     ON CONFLICT(bucket_key) DO UPDATE SET
       count = excluded.count,
       reset_at = excluded.reset_at`
  )
    .bind(key, count, resetAt)
    .run();

  if (count > options.maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000));
    return {
      allowed: false,
      retryAfterSec,
      message:
        options.message ||
        `Too many requests. Please wait ${retryAfterSec} seconds and try again.`,
    };
  }

  return { allowed: true };
}

// =========================================================================
// CORS ALLOWLIST & SECURITY HEADERS
// =========================================================================
const DEFAULT_ALLOWED_ORIGINS = [
  'https://shakhawatsvlog-lab.github.io',
  'https://cluster-1-planning-fo-control-tower-9b844.containers.snapdeploy.app',
];

export function getAllowedCorsOriginsWorker(request: Request, env: WorkerEnv): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  const appUrl = (env.APP_URL || '').trim();
  if (appUrl && !appUrl.includes('MY_APP_URL')) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // ignore invalid APP_URL
    }
  }
  const extra = (env.ALLOWED_ORIGINS || '').trim();
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
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // ignore
  }
  const xfHost = request.headers.get('x-forwarded-host');
  if (xfHost) {
    const cleanHost = xfHost.split(',')[0].trim();
    const proto = isRequestHttpsWorker(request) ? 'https' : 'http';
    allowed.add(`${proto}://${cleanHost}`);
  }
  return allowed;
}

export function isRequestOriginTrustedForCookieWrite(
  request: Request,
  env: WorkerEnv
): boolean {
  const origin = request.headers.get('origin');
  const allowed = getAllowedCorsOriginsWorker(request, env);
  if (origin) {
    return allowed.has(origin);
  }
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  return false;
}

export function applyCorsAndSecurityHeaders(
  headers: Headers,
  request: Request,
  env: WorkerEnv
): { corsAllowed: boolean } {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (env.NODE_ENV === 'production' && isRequestHttpsWorker(request)) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return { corsAllowed: true };
  }
  const allowed = getAllowedCorsOriginsWorker(request, env);
  if (allowed.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
    return { corsAllowed: true };
  }
  return { corsAllowed: false };
}

// =========================================================================
// SSRF PROTECTION FOR ONLINE SHEET URLS (IP LITERALS + CLOUDFLARE DoH)
// =========================================================================
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isIpv4Literal(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return host.split('.').every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isIpv6Literal(host: string): boolean {
  return host.includes(':') && /^[0-9a-f:.[\]]+$/i.test(host);
}

function isPrivateOrReservedIpWorker(rawIp: string): boolean {
  const clean = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isIpv4Literal(clean)) {
    return isPrivateOrReservedIpv4(clean);
  }
  if (isIpv6Literal(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('::ffff:')) {
      return isPrivateOrReservedIpv4(clean.slice('::ffff:'.length));
    }
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(clean)) return true;
    if (clean.startsWith('ff')) return true;
    return false;
  }
  return true;
}

interface DohAnswer {
  type?: number;
  data?: string;
}

async function resolveHostnameViaDoh(hostname: string): Promise<string[]> {
  const ips: string[] = [];
  for (const recordType of ['A', 'AAAA'] as const) {
    try {
      const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${recordType}`;
      const resp = await fetch(url, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as { Status?: number; Answer?: DohAnswer[] };
      if (Array.isArray(json.Answer)) {
        for (const ans of json.Answer) {
          if ((ans.type === 1 || ans.type === 28) && typeof ans.data === 'string') {
            ips.push(ans.data.trim());
          }
        }
      }
    } catch {
      // ignore single type lookup failures
    }
  }
  return ips;
}

export async function assertSafeExternalUrlWorker(rawUrl: string): Promise<URL> {
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

  const unbracketed = hostname.replace(/^\[|\]$/g, '');
  if (isIpv4Literal(unbracketed) || isIpv6Literal(hostname)) {
    if (isPrivateOrReservedIpWorker(hostname)) {
      throw new Error('Private or loopback IP addresses are blocked for security.');
    }
    return parsed;
  }

  const resolvedIps = await resolveHostnameViaDoh(hostname);
  for (const addr of resolvedIps) {
    if (isPrivateOrReservedIpWorker(addr)) {
      throw new Error('Resolved IP address belongs to a restricted private network.');
    }
  }

  return parsed;
}

// =========================================================================
// UPLOAD VALIDATION & CLIENT ERROR SANITIZATION
// =========================================================================
export function validateBase64UploadWorker(params: {
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

export function toSafeClientErrorWorker(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) return fallbackMessage;
  const msg = error.message || '';
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
