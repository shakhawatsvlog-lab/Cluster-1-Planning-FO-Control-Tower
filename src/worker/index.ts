import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import type {
  DailyCuttingEntry,
  FactoryName,
  MasterPlanMeta,
  PlanningRecord,
} from '../shared/plannerTypes.ts';
import { ALLOWED_FACTORIES } from '../shared/plannerTypes.ts';
import { EMAIL_REGEX } from '../shared/reminderTypes.ts';
import type {
  RecipientFrequency,
  ReminderAlertScope,
  ReminderRecipient,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpProviderPreset,
} from '../shared/reminderTypes.ts';
import type { WebsiteControlConfig } from '../shared/controlPanelTypes.ts';
import type {
  CuttingSheetLinkRole,
  CuttingSheetLinkScope,
  CuttingSheetSyncConfig,
  CuttingSheetSyncMode,
  FactorySheetUrlMap,
} from '../shared/cuttingSheetTypes.ts';
import {
  convertMasterPlanXlsxToCsv,
  detectFactoryHintFromText,
} from '../server/cuttingSheetCore.ts';
import {
  askShehreenAssistantCore,
  type ShehreenHistoryTurn,
} from '../server/shehreenCore.ts';
import {
  ExtractImageValidationError,
  extractPoRecordsFromImageCore,
} from '../server/extractImageCore.ts';
import {
  buildPlanningWorkbookBuffer,
  buildSelectedFoSummaryBoxWorkbookBuffer,
  buildSelectedUpcomingFoWorkbookBuffer,
  type SelectedFoSummaryBoxRow,
} from '../server/xlsxBuilder.ts';
import type { ExecutionContext, ScheduledController, WorkerEnv } from './cfTypes.ts';
import {
  addReminderRecipientD1,
  bootstrapInitialAdminPasswordD1,
  clearPendingOtpD1,
  deleteReminderRecipientD1,
  getAdminAuthUpdatedAtIsoD1,
  getPendingOtpD1,
  getPublicFoNeededStateD1,
  getPublicMasterPlanStateD1,
  getPublicWorkspaceStateD1,
  getSiteConfigD1,
  getStoredSmtpConfigD1,
  getSyncVersionSnapshotD1,
  getWorkspaceStateD1,
  incrementPendingOtpAttemptD1,
  isAdminPasswordConfiguredD1,
  removeCuttingSheetLinkD1,
  resetPlanningWorkspaceD1,
  restoreWorkspaceSnapshotD1,
  savePendingOtpD1,
  saveStoredSmtpConfigD1,
  updateAdminPasswordD1,
  updateCuttingSheetSyncConfigD1,
  updatePlanningWorkspaceD1,
  updateRecordsOutputQtyD1,
  updateRecordsPackingQtyD1,
  updateReminderRecipientD1,
  updateReminderScheduleD1,
  updateSiteConfigD1,
  verifyAdminPasswordD1,
} from './d1Store.ts';
import {
  importCuttingFileBufferWorker,
  runCuttingSheetSyncWorker,
  runScheduledCuttingSheetCheckWorker,
} from './workerCuttingSync.ts';
import {
  getWorkerSmtpStatus,
  runScheduledReminderCheckWorker,
  sendWorkerAdminVerificationCodeEmail,
  sendWorkerPasswordChangedNoticeEmail,
  sendWorkerSavedUpcomingFoEmail,
  sendWorkerShortcutReminderEmails,
  sendWorkerTestEmail,
  verifyWorkerEmailConnection,
} from './workerEmail.ts';
import {
  MAX_UPLOAD_BYTES,
  applyCorsAndSecurityHeaders,
  assertSafeExternalUrlWorker,
  buildAdminSessionClearCookieHeader,
  buildAdminSessionSetCookieHeader,
  checkLoginLockoutWorker,
  checkRateLimitWorker,
  clearLoginFailuresWorker,
  createSignedAdminSessionTokenWorker,
  extractAdminTokenFromRequestWorker,
  getClientIpWorker,
  isRequestOriginTrustedForCookieWrite,
  recordLoginFailureWorker,
  revokeAdminSessionTokenWorker,
  toSafeClientErrorWorker,
  validateBase64UploadWorker,
  verifySignedAdminSessionTokenWorker,
} from './workerSecurity.ts';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024; // 25 MB
const DEFAULT_PUBLIC_FRONTEND_URL =
  'https://shakhawatsvlog-lab.github.io/Cluster-1-Planning-FO-Control-Tower';

function hashOtp(code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function getAppPublicUrlWorker(request: Request, env: WorkerEnv): string {
  const envUrl = (env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
    return envUrl;
  }
  try {
    const u = new URL(request.url);
    if (u.origin) return u.origin;
  } catch {
    // ignore
  }
  return DEFAULT_PUBLIC_FRONTEND_URL;
}

function makeResponse(
  request: Request,
  env: WorkerEnv,
  body: BodyInit | null,
  init: ResponseInit = {},
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers(init.headers);
  applyCorsAndSecurityHeaders(headers, request, env);
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return new Response(body, {
    status: init.status ?? 200,
    headers,
  });
}

function jsonResponse(
  request: Request,
  env: WorkerEnv,
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }
  return makeResponse(request, env, JSON.stringify(data), { status, headers });
}

function binaryResponse(
  request: Request,
  env: WorkerEnv,
  bytes: Buffer | Uint8Array,
  contentType: string,
  contentDisposition: string
): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return makeResponse(request, env, copy, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
      'Cache-Control': 'no-store',
    },
  });
}

async function readJsonBody(
  request: Request
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const len = Number(contentLengthHeader);
    if (Number.isFinite(len) && len > MAX_JSON_BODY_BYTES) {
      return { ok: false, status: 413, error: 'Request payload exceeds 25 MB limit.' };
    }
  }

  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return { ok: false, status: 400, error: 'Failed to read request body.' };
  }

  if (Buffer.byteLength(rawText, 'utf8') > MAX_JSON_BODY_BYTES) {
    return { ok: false, status: 413, error: 'Request payload exceeds 25 MB limit.' };
  }

  if (!rawText.trim()) {
    return { ok: true, data: {} };
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, data: parsed as Record<string, unknown> };
    }
    return { ok: true, data: {} };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON request body.' };
  }
}

async function isAdminAuthorizedWorker(
  request: Request,
  env: WorkerEnv
): Promise<boolean> {
  const { token, viaCookie, viaHeader } = extractAdminTokenFromRequestWorker(request);
  if (!token) return false;

  const method = request.method.toUpperCase();
  const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  if (isMutating && viaCookie && !viaHeader && !isRequestOriginTrustedForCookieWrite(request, env)) {
    return false;
  }

  const updatedAtIso = await getAdminAuthUpdatedAtIsoD1(env);
  return verifySignedAdminSessionTokenWorker(env, token, updatedAtIso, request);
}

async function requireAdminWorker(
  request: Request,
  env: WorkerEnv
): Promise<Response | null> {
  const ok = await isAdminAuthorizedWorker(request, env);
  if (ok) return null;
  return jsonResponse(
    request,
    env,
    {
      ok: false,
      error: 'Admin sign-in required. Please sign in to modify workspace data or settings.',
    },
    401
  );
}

async function enforceRateLimit(
  request: Request,
  env: WorkerEnv,
  options: { name: string; windowMs: number; maxRequests: number; message?: string }
): Promise<Response | null> {
  const res = await checkRateLimitWorker(env, request, options);
  if (res.allowed) return null;
  return jsonResponse(
    request,
    env,
    { ok: false, error: res.message },
    429,
    res.retryAfterSec ? { 'Retry-After': String(res.retryAfterSec) } : undefined
  );
}

const parsePackingQtyInput = (raw: unknown): { valid: boolean; value: number | null } => {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: true, value: null };
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || num < 0 || num > 10_000_000) {
    return { valid: false, value: null };
  }
  return { valid: true, value: Math.round(num) };
};

export async function handleWorkerFetch(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // CORS Preflight
  if (method === 'OPTIONS') {
    const headers = new Headers();
    const { corsAllowed } = applyCorsAndSecurityHeaders(headers, request, env);
    if (!corsAllowed && request.headers.get('origin')) {
      return new Response(null, { status: 403, headers });
    }
    return new Response(null, { status: 204, headers });
  }

  // Dynamic webmanifest routes for Master Plan PWA install
  if (
    method === 'GET' &&
    (path === '/master-plan.webmanifest' ||
      path === '/Cluster-1-Planning-FO-Control-Tower/master-plan.webmanifest')
  ) {
    const useBase = path.startsWith('/Cluster-1-Planning-FO-Control-Tower/');
    const startUrl = useBase
      ? '/Cluster-1-Planning-FO-Control-Tower/master-plan'
      : '/master-plan';
    const iconBase = '/Cluster-1-Planning-FO-Control-Tower/';
    return makeResponse(
      request,
      env,
      JSON.stringify({
        id: startUrl,
        name: 'Alpine Master Plan',
        short_name: 'Master Plan',
        description:
          'Read-only Four-Factory Live Production Schedule for ALEX 1, ALEX 3, ALEX 5, and ALEX 12.',
        theme_color: '#0a1633',
        background_color: '#07132c',
        display: 'standalone',
        start_url: startUrl,
        scope: startUrl,
        icons: [
          { src: `${iconBase}master-plan-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${iconBase}master-plan-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: `${iconBase}master-plan-maskable-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/manifest+json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  if (!path.startsWith('/api')) {
    return jsonResponse(request, env, { ok: true, service: 'alex-control-tower-api' }, 200);
  }

  // General API rate limiter across all /api routes
  const generalLimited = await enforceRateLimit(request, env, {
    name: 'api-general',
    windowMs: 60_000,
    maxRequests: 300,
    message: 'Too many API requests. Please wait a moment and try again.',
  });
  if (generalLimited) return generalLimited;

  // =========================================================================
  // PUBLIC READ-ONLY & HEALTH ENDPOINTS
  // =========================================================================
  if (method === 'GET' && path === '/api/health') {
    const state = await getWorkspaceStateD1(env);
    return jsonResponse(
      request,
      env,
      {
        ok: true,
        totalLines: state.meta.totalLines,
        totalRecords: state.records.length,
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  }

  if (method === 'GET' && path === '/api/public/sync-version') {
    const snap = await getSyncVersionSnapshotD1(env);
    return jsonResponse(
      request,
      env,
      {
        ok: true,
        version: snap.version,
        referenceDateIso: snap.referenceDateIso,
        cuttingUpdatedAtIso: snap.cuttingUpdatedAtIso,
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  }

  if (method === 'GET' && path === '/api/public/master-plan') {
    try {
      const state = await getWorkspaceStateD1(env);
      const factories =
        Array.isArray(state.meta.factoriesIncluded) && state.meta.factoriesIncluded.length > 0
          ? state.meta.factoriesIncluded
          : ALLOWED_FACTORIES;

      const rawFactory = (url.searchParams.get('factory') || '').trim();
      const resolveDefault =
        url.searchParams.get('resolveDefault') === '1' ||
        url.searchParams.get('resolveDefault') === 'true';

      if (rawFactory) {
        const normalized = rawFactory.replace(/\s+/g, ' ').toUpperCase();
        const matched = factories.find((f) => f.toUpperCase() === normalized);
        if (!matched) {
          return jsonResponse(request, env, { error: 'Invalid factory filter.' }, 400);
        }
        return jsonResponse(
          request,
          env,
          await getPublicMasterPlanStateD1(env, matched),
          200,
          { 'Cache-Control': 'no-store' }
        );
      }

      if (resolveDefault && factories.length > 0) {
        return jsonResponse(
          request,
          env,
          await getPublicMasterPlanStateD1(env, factories[0]),
          200,
          { 'Cache-Control': 'no-store' }
        );
      }

      return jsonResponse(
        request,
        env,
        await getPublicMasterPlanStateD1(env),
        200,
        { 'Cache-Control': 'no-store' }
      );
    } catch (error) {
      console.error('GET /api/public/master-plan error:', error);
      return jsonResponse(request, env, { error: 'Failed to load public master plan.' }, 500);
    }
  }

  if (method === 'GET' && path === '/api/public/fo-needed') {
    try {
      const state = await getWorkspaceStateD1(env);
      const factories =
        Array.isArray(state.meta.factoriesIncluded) && state.meta.factoriesIncluded.length > 0
          ? state.meta.factoriesIncluded
          : ALLOWED_FACTORIES;

      const rawFactory = (url.searchParams.get('factory') || '').trim();
      if (rawFactory && rawFactory.toUpperCase() !== 'ALL') {
        const normalized = rawFactory.replace(/\s+/g, ' ').toUpperCase();
        const matched = factories.find((f) => f.toUpperCase() === normalized);
        if (!matched) {
          return jsonResponse(request, env, { error: 'Invalid factory filter.' }, 400);
        }
        return jsonResponse(
          request,
          env,
          await getPublicFoNeededStateD1(env, matched),
          200,
          { 'Cache-Control': 'no-store' }
        );
      }

      return jsonResponse(
        request,
        env,
        await getPublicFoNeededStateD1(env, null),
        200,
        { 'Cache-Control': 'no-store' }
      );
    } catch (error) {
      console.error('GET /api/public/fo-needed error:', error);
      return jsonResponse(
        request,
        env,
        { error: 'Failed to load public FO Needed checklist.' },
        500
      );
    }
  }

  if (method === 'GET' && path === '/api/public/export-selected-fo-xlsx') {
    try {
      const state = await getWorkspaceStateD1(env);
      const factories =
        Array.isArray(state.meta.factoriesIncluded) && state.meta.factoriesIncluded.length > 0
          ? state.meta.factoriesIncluded
          : ALLOWED_FACTORIES;

      const rawFactory = (url.searchParams.get('factory') || '').trim();
      let factoryFilter: FactoryName | null = null;
      if (rawFactory && rawFactory.toUpperCase() !== 'ALL') {
        const normalized = rawFactory.replace(/\s+/g, ' ').toUpperCase();
        const matched = factories.find((f) => f.toUpperCase() === normalized);
        if (!matched) {
          return jsonResponse(request, env, { error: 'Invalid factory filter.' }, 400);
        }
        factoryFilter = matched;
      }

      const foData = await getPublicFoNeededStateD1(env, factoryFilter);
      const summaryRows: SelectedFoSummaryBoxRow[] = foData.rows.map((r) => ({
        sl: r.sl,
        factory: r.factory,
        line: r.line,
        pgNumber: r.pgNumber,
        style: r.style,
        issueQty: r.issueQty,
        status: r.status,
        foDateNeededIso: r.foDateNeededIso,
        foStatus: r.foStatus,
      }));

      const buffer = await buildSelectedFoSummaryBoxWorkbookBuffer({
        masterPlanAsOf: foData.meta.asOfDateRaw || foData.meta.asOfDateIso || '—',
        referenceDateIso: foData.referenceDateIso,
        rows: summaryRows,
      });

      return binaryResponse(
        request,
        env,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `attachment; filename="ALEX_FO_Needed_Checklist_${foData.referenceDateIso}.xlsx"`
      );
    } catch (error) {
      console.error('GET /api/public/export-selected-fo-xlsx error:', error);
      return jsonResponse(
        request,
        env,
        { error: 'Failed to export FO Needed Excel file.' },
        500
      );
    }
  }

  // =========================================================================
  // ADMIN AUTH & STATUS ENDPOINTS
  // =========================================================================
  if (method === 'GET' && path === '/api/admin/status') {
    const isAdmin = await isAdminAuthorizedWorker(request, env);
    const siteConfig = await getSiteConfigD1(env);
    const configured = await isAdminPasswordConfiguredD1(env);
    return jsonResponse(
      request,
      env,
      {
        unlocked: isAdmin,
        needsInitialSetup: !configured,
        companyName: siteConfig.companyName,
        portalTitle: siteConfig.portalTitle,
        ...(isAdmin ? { recoveryEmail: siteConfig.recoveryEmail, siteConfig } : {}),
      },
      200,
      { 'Cache-Control': 'no-store' }
    );
  }

  if (method === 'POST' && path === '/api/admin/bootstrap') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-auth',
      windowMs: 15 * 60_000,
      maxRequests: 30,
      message: 'Too many authentication attempts. Please try again later.',
    });
    if (limited) return limited;

    if (await isAdminPasswordConfiguredD1(env)) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: 'Admin password is already configured. Please sign in normally.',
        },
        403
      );
    }

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as { password?: string; recoveryEmail?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    const recoveryEmail = typeof body.recoveryEmail === 'string' ? body.recoveryEmail.trim() : '';

    if (password.length < 8) {
      return jsonResponse(
        request,
        env,
        { ok: false, error: 'Admin password must be at least 8 characters long.' },
        400
      );
    }
    if (recoveryEmail && !EMAIL_REGEX.test(recoveryEmail)) {
      return jsonResponse(
        request,
        env,
        { ok: false, error: 'Please enter a valid recovery email address.' },
        400
      );
    }

    try {
      await bootstrapInitialAdminPasswordD1(env, password, recoveryEmail || undefined);
      const updatedAtIso = await getAdminAuthUpdatedAtIsoD1(env);
      if (!updatedAtIso) {
        return jsonResponse(
          request,
          env,
          { ok: false, error: 'Failed to initialize admin session.' },
          500
        );
      }
      const token = createSignedAdminSessionTokenWorker(env, updatedAtIso, request);
      const pub = await getPublicWorkspaceStateD1(env, true);
      return jsonResponse(
        request,
        env,
        {
          ok: true,
          ...pub,
          smtpStatus: await getWorkerSmtpStatus(env),
          adminUnlocked: true,
          adminToken: token,
          recoveryEmail: pub.siteConfig.recoveryEmail,
        },
        200,
        { 'Set-Cookie': buildAdminSessionSetCookieHeader(request, token) }
      );
    } catch (error) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: toSafeClientErrorWorker(error, 'Failed to set initial admin password.'),
        },
        400
      );
    }
  }

  if (method === 'POST' && (path === '/api/admin/unlock' || path === '/api/admin/login')) {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-auth',
      windowMs: 15 * 60_000,
      maxRequests: 30,
      message: 'Too many authentication attempts. Please try again later.',
    });
    if (limited) return limited;

    if (!(await isAdminPasswordConfiguredD1(env))) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          needsInitialSetup: true,
          error: 'No Admin password is configured yet. Create the initial Admin password first.',
        },
        400
      );
    }

    const clientIp = getClientIpWorker(request);
    const lockout = await checkLoginLockoutWorker(env, clientIp);
    if (lockout.locked) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: `Too many failed login attempts. Try again in ${Math.ceil(lockout.retryAfterSec / 60)} minute(s).`,
        },
        429,
        { 'Retry-After': String(lockout.retryAfterSec) }
      );
    }

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as { password?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await verifyAdminPasswordD1(env, password))) {
      const failure = await recordLoginFailureWorker(env, clientIp);
      if (failure.locked) {
        return jsonResponse(
          request,
          env,
          {
            ok: false,
            error: 'Too many failed attempts. Login temporarily locked for 15 minutes.',
          },
          429,
          { 'Retry-After': String(failure.retryAfterSec) }
        );
      }
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: `Incorrect Admin password. ${failure.attemptsRemaining} attempt(s) remaining before temporary lockout.`,
        },
        401
      );
    }

    await clearLoginFailuresWorker(env, clientIp);
    const authUpdatedAt = await getAdminAuthUpdatedAtIsoD1(env);
    if (!authUpdatedAt) {
      return jsonResponse(
        request,
        env,
        { ok: false, error: 'Admin credential state unavailable.' },
        500
      );
    }

    let token: string;
    try {
      token = createSignedAdminSessionTokenWorker(env, authUpdatedAt, request);
    } catch (error) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: toSafeClientErrorWorker(error, 'Server session configuration missing.'),
        },
        500
      );
    }

    const pub = await getPublicWorkspaceStateD1(env, true);
    return jsonResponse(
      request,
      env,
      {
        ok: true,
        ...pub,
        smtpStatus: await getWorkerSmtpStatus(env),
        adminUnlocked: true,
        adminToken: token,
        recoveryEmail: pub.siteConfig.recoveryEmail,
      },
      200,
      { 'Set-Cookie': buildAdminSessionSetCookieHeader(request, token) }
    );
  }

  if (method === 'POST' && (path === '/api/admin/lock' || path === '/api/admin/logout')) {
    const { token } = extractAdminTokenFromRequestWorker(request);
    if (token) {
      await revokeAdminSessionTokenWorker(env, token);
    }
    return jsonResponse(
      request,
      env,
      { ok: true, adminUnlocked: false },
      200,
      { 'Set-Cookie': buildAdminSessionClearCookieHeader(request) }
    );
  }

  // =========================================================================
  // ADMIN-ONLY WORKSPACE & MASTER PLAN MUTATIONS
  // =========================================================================
  if (method === 'GET' && path === '/api/master-plan') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const state = await getWorkspaceStateD1(env);
      return jsonResponse(request, env, { meta: state.meta, records: state.records });
    } catch (error) {
      console.error('GET /api/master-plan error:', error);
      return jsonResponse(request, env, { error: 'Failed to load master plan.' }, 500);
    }
  }

  if (method === 'POST' && path === '/api/master-plan/parse-xlsx') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-upload-sync',
      windowMs: 5 * 60_000,
      maxRequests: 25,
      message: 'Too many file uploads or sync requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as { base64?: string; fileName?: string };
      if (!body.base64 || typeof body.base64 !== 'string') {
        return jsonResponse(request, env, { error: 'Valid base64 .xlsx payload is required.' }, 400);
      }
      const validated = validateBase64UploadWorker({
        base64: body.base64,
        fileName: body.fileName || 'master-plan.xlsx',
        allowedExtensions: ['xlsx', 'xlsm'],
        maxBytes: MAX_UPLOAD_BYTES,
      });
      const csvText = await convertMasterPlanXlsxToCsv(validated.buffer);
      return jsonResponse(request, env, { ok: true, csvText });
    } catch (error) {
      console.error('POST /api/master-plan/parse-xlsx error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to read .xlsx Master Plan file.') },
        400
      );
    }
  }

  if (method === 'GET' && path === '/api/workspace/sync-version') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    const snap = await getSyncVersionSnapshotD1(env);
    return jsonResponse(
      request,
      env,
      { ok: true, ...snap },
      200,
      { 'Cache-Control': 'no-store' }
    );
  }

  if (method === 'GET' && path === '/api/workspace') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const pub = await getPublicWorkspaceStateD1(env, true);
      return jsonResponse(
        request,
        env,
        {
          ...pub,
          smtpStatus: await getWorkerSmtpStatus(env),
          appUrl: getAppPublicUrlWorker(request, env),
          adminUnlocked: true,
        },
        200,
        { 'Cache-Control': 'no-store' }
      );
    } catch (error) {
      console.error('GET /api/workspace error:', error);
      return jsonResponse(request, env, { error: 'Failed to load workspace.' }, 500);
    }
  }

  if (method === 'PUT' && path === '/api/workspace') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
        hasCustomEdits?: boolean;
      };
      if (!body?.meta || !Array.isArray(body?.records) || body.records.length === 0) {
        return jsonResponse(
          request,
          env,
          { error: 'Valid meta and records array are required.' },
          400
        );
      }
      const saved = await updatePlanningWorkspaceD1(env, {
        meta: body.meta,
        records: body.records,
        cuttingEntries: Array.isArray(body.cuttingEntries) ? body.cuttingEntries : [],
        referenceDateIso: body.referenceDateIso || new Date().toISOString().slice(0, 10),
        hasCustomEdits: body.hasCustomEdits ?? true,
      });
      return jsonResponse(request, env, { ok: true, updatedAtIso: saved.updatedAtIso });
    } catch (error) {
      console.error('PUT /api/workspace error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to save workspace.') },
        500
      );
    }
  }

  if (method === 'POST' && path === '/api/workspace/reset') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      await resetPlanningWorkspaceD1(env);
      const pub = await getPublicWorkspaceStateD1(env, true);
      return jsonResponse(request, env, {
        ...pub,
        smtpStatus: await getWorkerSmtpStatus(env),
        adminUnlocked: true,
      });
    } catch (error) {
      console.error('POST /api/workspace/reset error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to reset workspace.') },
        500
      );
    }
  }

  const packingRecordMatch = /^\/api\/records\/([^/]+)\/packing$/.exec(path);
  if (method === 'PATCH' && packingRecordMatch) {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const id = decodeURIComponent(packingRecordMatch[1] || '');
      if (!id) {
        return jsonResponse(request, env, { error: 'Valid record id is required.' }, 400);
      }
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const parsed = parsePackingQtyInput(parsedBody.data?.packingQty);
      if (!parsed.valid) {
        return jsonResponse(
          request,
          env,
          { error: 'Packing Qty must be blank or a non-negative integer up to 10,000,000.' },
          400
        );
      }
      const result = await updateRecordsPackingQtyD1(env, [id], parsed.value);
      if (result.updatedCount === 0) {
        return jsonResponse(request, env, { error: 'Planning record not found.' }, 404);
      }
      return jsonResponse(request, env, {
        ok: true,
        updatedCount: result.updatedCount,
        updatedAtIso: result.updatedAtIso,
        packingQty: parsed.value,
      });
    } catch (error) {
      console.error('PATCH /api/records/:id/packing error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to save Packing Qty.') },
        500
      );
    }
  }

  if (method === 'PATCH' && path === '/api/packing') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as { recordIds?: unknown; packingQty?: unknown };
      const recordIds = Array.isArray(body.recordIds)
        ? body.recordIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .slice(0, 100)
        : [];
      if (recordIds.length === 0) {
        return jsonResponse(
          request,
          env,
          { error: 'Provide at least one planning record ID.' },
          400
        );
      }
      const parsed = parsePackingQtyInput(body.packingQty);
      if (!parsed.valid) {
        return jsonResponse(
          request,
          env,
          { error: 'Packing Qty must be blank or a non-negative integer up to 10,000,000.' },
          400
        );
      }
      const result = await updateRecordsPackingQtyD1(env, recordIds, parsed.value);
      if (result.updatedCount === 0) {
        return jsonResponse(request, env, { error: 'Matching planning records not found.' }, 404);
      }
      return jsonResponse(request, env, {
        ok: true,
        updatedCount: result.updatedCount,
        updatedAtIso: result.updatedAtIso,
        packingQty: parsed.value,
      });
    } catch (error) {
      console.error('PATCH /api/packing error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to update Packing Qty.') },
        500
      );
    }
  }

  const outputRecordMatch = /^\/api\/records\/([^/]+)\/output$/.exec(path);
  if (method === 'PATCH' && outputRecordMatch) {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const id = decodeURIComponent(outputRecordMatch[1] || '');
      if (!id) {
        return jsonResponse(request, env, { error: 'Valid record id is required.' }, 400);
      }
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const parsed = parsePackingQtyInput(parsedBody.data?.outputQty);
      if (!parsed.valid) {
        return jsonResponse(
          request,
          env,
          { error: 'Output Qty must be blank or a non-negative integer up to 10,000,000.' },
          400
        );
      }
      const result = await updateRecordsOutputQtyD1(env, [id], parsed.value);
      if (result.updatedCount === 0) {
        return jsonResponse(request, env, { error: 'Planning record not found.' }, 404);
      }
      return jsonResponse(request, env, {
        ok: true,
        updatedCount: result.updatedCount,
        updatedAtIso: result.updatedAtIso,
        outputQty: parsed.value,
      });
    } catch (error) {
      console.error('PATCH /api/records/:id/output error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to save Output Qty.') },
        500
      );
    }
  }

  if (method === 'PATCH' && path === '/api/output') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as { recordIds?: unknown; outputQty?: unknown };
      const recordIds = Array.isArray(body.recordIds)
        ? body.recordIds
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
            .slice(0, 100)
        : [];
      if (recordIds.length === 0) {
        return jsonResponse(
          request,
          env,
          { error: 'Provide at least one planning record ID.' },
          400
        );
      }
      const parsed = parsePackingQtyInput(body.outputQty);
      if (!parsed.valid) {
        return jsonResponse(
          request,
          env,
          { error: 'Output Qty must be blank or a non-negative integer up to 10,000,000.' },
          400
        );
      }
      const result = await updateRecordsOutputQtyD1(env, recordIds, parsed.value);
      if (result.updatedCount === 0) {
        return jsonResponse(request, env, { error: 'Matching planning records not found.' }, 404);
      }
      return jsonResponse(request, env, {
        ok: true,
        updatedCount: result.updatedCount,
        updatedAtIso: result.updatedAtIso,
        outputQty: parsed.value,
      });
    } catch (error) {
      console.error('PATCH /api/output error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to update Output Qty.') },
        500
      );
    }
  }

  if (method === 'PUT' && path === '/api/admin/site-config') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as Partial<WebsiteControlConfig>;
    const patch: Partial<WebsiteControlConfig> = {};

    if (typeof body.companyName === 'string' && body.companyName.trim()) {
      patch.companyName = body.companyName.trim().slice(0, 120);
    }
    if (typeof body.portalTitle === 'string' && body.portalTitle.trim()) {
      patch.portalTitle = body.portalTitle.trim().slice(0, 160);
    }
    if (typeof body.readOnlyPublicMode === 'boolean') {
      patch.readOnlyPublicMode = body.readOnlyPublicMode;
    }
    if (
      typeof body.inputStartOffsetDays === 'number' &&
      body.inputStartOffsetDays >= 1 &&
      body.inputStartOffsetDays <= 60
    ) {
      patch.inputStartOffsetDays = Math.round(body.inputStartOffsetDays);
    }
    if (
      typeof body.upcomingFoOffsetDays === 'number' &&
      body.upcomingFoOffsetDays >= 1 &&
      body.upcomingFoOffsetDays <= 90
    ) {
      patch.upcomingFoOffsetDays = Math.round(body.upcomingFoOffsetDays);
    }
    if (
      typeof body.cuttingAlertDays === 'number' &&
      body.cuttingAlertDays >= 1 &&
      body.cuttingAlertDays <= 45
    ) {
      patch.cuttingAlertDays = Math.round(body.cuttingAlertDays);
    }
    if (typeof body.recoveryEmail === 'string' && body.recoveryEmail.trim()) {
      const clean = body.recoveryEmail.trim().toLowerCase();
      if (!EMAIL_REGEX.test(clean)) {
        return jsonResponse(
          request,
          env,
          { error: 'Invalid verification/recovery email address.' },
          400
        );
      }
      patch.recoveryEmail = clean;
    }

    const siteConfig = await updateSiteConfigD1(env, patch);
    return jsonResponse(request, env, { ok: true, siteConfig });
  }

  if (method === 'PUT' && path === '/api/planning-rules') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as Partial<WebsiteControlConfig>;
    const patch: Partial<WebsiteControlConfig> = {};

    if (
      typeof body.inputStartOffsetDays === 'number' &&
      Number.isFinite(body.inputStartOffsetDays) &&
      body.inputStartOffsetDays >= 1 &&
      body.inputStartOffsetDays <= 60
    ) {
      patch.inputStartOffsetDays = Math.round(body.inputStartOffsetDays);
    }
    if (
      typeof body.upcomingFoOffsetDays === 'number' &&
      Number.isFinite(body.upcomingFoOffsetDays) &&
      body.upcomingFoOffsetDays >= 1 &&
      body.upcomingFoOffsetDays <= 90
    ) {
      patch.upcomingFoOffsetDays = Math.round(body.upcomingFoOffsetDays);
    }
    if (
      typeof body.cuttingAlertDays === 'number' &&
      Number.isFinite(body.cuttingAlertDays) &&
      body.cuttingAlertDays >= 1 &&
      body.cuttingAlertDays <= 45
    ) {
      patch.cuttingAlertDays = Math.round(body.cuttingAlertDays);
    }

    if (Object.keys(patch).length === 0) {
      return jsonResponse(
        request,
        env,
        { error: 'Provide at least one valid planning rule offset (days).' },
        400
      );
    }

    const siteConfig = await updateSiteConfigD1(env, patch);
    return jsonResponse(request, env, { ok: true, siteConfig });
  }

  if (method === 'POST' && path === '/api/admin/password/request-code') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-auth',
      windowMs: 15 * 60_000,
      maxRequests: 30,
      message: 'Too many authentication attempts. Please try again later.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const siteConfig = await getSiteConfigD1(env);
    const targetEmail = (siteConfig.recoveryEmail || env.ADMIN_RECOVERY_EMAIL || '')
      .trim()
      .toLowerCase();
    if (!EMAIL_REGEX.test(targetEmail)) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          message:
            'Set a valid Recovery Email in Website Settings before requesting a password reset code.',
        },
        400
      );
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');

    const emailRes = await sendWorkerAdminVerificationCodeEmail(env, {
      toEmail: targetEmail,
      code,
      expiresMinutes: 10,
    });

    if (!emailRes.ok) {
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          smtpMissing: Boolean(emailRes.smtpMissing),
          message: emailRes.message,
        },
        emailRes.smtpMissing ? 400 : 500
      );
    }

    await savePendingOtpD1(env, {
      codeHash: hashOtp(code, salt),
      salt,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      targetEmail,
    });

    return jsonResponse(request, env, {
      ok: true,
      targetEmail,
      message: emailRes.message,
    });
  }

  if (method === 'POST' && path === '/api/admin/password/change') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-auth',
      windowMs: 15 * 60_000,
      maxRequests: 30,
      message: 'Too many authentication attempts. Please try again later.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as { code?: string; newPassword?: string };
    const code = (body.code || '').trim();
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    const pendingOtp = await getPendingOtpD1(env);
    if (!pendingOtp) {
      return jsonResponse(
        request,
        env,
        { ok: false, error: 'Please request a verification code to your email first.' },
        400
      );
    }

    if (Date.now() > pendingOtp.expiresAt) {
      await clearPendingOtpD1(env);
      return jsonResponse(
        request,
        env,
        { ok: false, error: 'Verification code expired. Please send a new code.' },
        400
      );
    }

    if (pendingOtp.attempts >= 5) {
      await clearPendingOtpD1(env);
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: 'Too many invalid code attempts. Please request a fresh verification code.',
        },
        429
      );
    }

    const computed = hashOtp(code, pendingOtp.salt);
    const a = Buffer.from(computed, 'hex');
    const b = Buffer.from(pendingOtp.codeHash, 'hex');
    const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!matches) {
      await incrementPendingOtpAttemptD1(env);
      return jsonResponse(
        request,
        env,
        {
          ok: false,
          error: 'Invalid 6-digit verification code. Please check your email and try again.',
        },
        400
      );
    }

    if (newPassword.length < 8) {
      return jsonResponse(
        request,
        env,
        { ok: false, error: 'New password must be at least 8 characters long.' },
        400
      );
    }

    const notifyEmail = pendingOtp.targetEmail;
    await clearPendingOtpD1(env);
    await updateAdminPasswordD1(env, newPassword);

    const updatedAt = await getAdminAuthUpdatedAtIsoD1(env);
    let freshToken: string | undefined;
    const extraHeaders: Record<string, string> = {};
    if (updatedAt) {
      freshToken = createSignedAdminSessionTokenWorker(env, updatedAt, request);
      extraHeaders['Set-Cookie'] = buildAdminSessionSetCookieHeader(request, freshToken);
    }

    await sendWorkerPasswordChangedNoticeEmail(env, notifyEmail);

    return jsonResponse(
      request,
      env,
      {
        ok: true,
        adminToken: freshToken,
        message: `Control Panel password updated successfully. Confirmation sent to ${notifyEmail}.`,
      },
      200,
      extraHeaders
    );
  }

  if (method === 'GET' && path === '/api/admin/backup') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    const pub = await getPublicWorkspaceStateD1(env, true);
    return makeResponse(
      request,
      env,
      JSON.stringify(pub, null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="Alex_Apparels_Control_Tower_Backup_${new Date().toISOString().slice(0, 10)}.json"`,
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  if (method === 'POST' && path === '/api/admin/restore') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
        reminders?: ReminderScheduleConfig & Record<string, unknown>;
        siteConfig?: Partial<WebsiteControlConfig>;
        cuttingSheetSync?: Partial<CuttingSheetSyncConfig>;
      };
      if (
        !body?.meta ||
        typeof body.meta.totalLines !== 'number' ||
        !Array.isArray(body?.records) ||
        body.records.length === 0 ||
        body.records.length > 5000
      ) {
        return jsonResponse(
          request,
          env,
          { error: 'Invalid backup snapshot: missing or oversized records.' },
          400
        );
      }
      const hasValidRecords = body.records.every(
        (r) =>
          r &&
          typeof r.id === 'string' &&
          typeof r.factory === 'string' &&
          typeof r.line === 'string' &&
          typeof r.pgNumber === 'string'
      );
      if (!hasValidRecords) {
        return jsonResponse(
          request,
          env,
          { error: 'Invalid backup snapshot: malformed planning record structure.' },
          400
        );
      }

      await restoreWorkspaceSnapshotD1(env, {
        meta: body.meta,
        records: body.records,
        cuttingEntries: body.cuttingEntries,
        referenceDateIso: body.referenceDateIso,
        reminders: body.reminders as Partial<ReminderWorkspaceState>,
        siteConfig: body.siteConfig,
        cuttingSheetSync: body.cuttingSheetSync,
      });
      const pub = await getPublicWorkspaceStateD1(env, true);
      return jsonResponse(request, env, {
        ok: true,
        ...pub,
        smtpStatus: await getWorkerSmtpStatus(env),
        adminUnlocked: true,
      });
    } catch (error) {
      console.error('POST /api/admin/restore error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to restore backup snapshot.') },
        500
      );
    }
  }

  // =========================================================================
  // EMAIL REMINDERS & TRANSPORT ENDPOINTS
  // =========================================================================
  if (method === 'GET' && path === '/api/reminders') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    const pub = await getPublicWorkspaceStateD1(env, true);
    return jsonResponse(request, env, {
      reminders: pub.reminders,
      smtpStatus: await getWorkerSmtpStatus(env),
      appUrl: getAppPublicUrlWorker(request, env),
    });
  }

  if (method === 'PUT' && path === '/api/reminders/smtp') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        providerPreset?: SmtpProviderPreset;
        host?: string;
        port?: number;
        secure?: boolean;
        user?: string;
        pass?: string;
        fromName?: string;
        fromEmail?: string;
      };

      const providerPreset: SmtpProviderPreset =
        body.providerPreset === 'gmail' ||
        body.providerPreset === 'outlook' ||
        body.providerPreset === 'custom'
          ? body.providerPreset
          : 'custom';

      const user = (body.user || '').trim();
      if (!user) {
        return jsonResponse(
          request,
          env,
          { error: 'Hosting email / SMTP username is required.' },
          400
        );
      }

      let host = (body.host || '').trim();
      if (!host) {
        if (providerPreset === 'gmail' || user.toLowerCase().endsWith('@gmail.com')) {
          host = 'smtp.gmail.com';
        } else if (providerPreset === 'outlook') {
          host = 'smtp.office365.com';
        } else {
          return jsonResponse(
            request,
            env,
            { error: 'SMTP host server is required (e.g. mail.yourdomain.com).' },
            400
          );
        }
      }

      const port = Number(body.port) || (host === 'smtp.gmail.com' ? 465 : 587);
      const secure = typeof body.secure === 'boolean' ? body.secure : port === 465;

      const existingStored = await getStoredSmtpConfigD1(env);
      const incomingPass = typeof body.pass === 'string' ? body.pass : '';
      const resolvedPass = incomingPass.trim() ? incomingPass : existingStored?.pass || '';

      if (!resolvedPass) {
        return jsonResponse(
          request,
          env,
          { error: 'Hosting email password or App Password is required.' },
          400
        );
      }

      const fromEmail = (body.fromEmail || user).trim();
      if (fromEmail && !EMAIL_REGEX.test(fromEmail)) {
        return jsonResponse(
          request,
          env,
          { error: 'Please enter a valid Sender / From email address.' },
          400
        );
      }

      const fromName = (body.fromName || 'Alex Apparels Planning').trim();

      await saveStoredSmtpConfigD1(env, {
        providerPreset,
        host,
        port,
        secure,
        user,
        pass: resolvedPass,
        fromName,
        fromEmail,
      });

      return jsonResponse(request, env, {
        ok: true,
        smtpStatus: await getWorkerSmtpStatus(env),
      });
    } catch (error) {
      console.error('PUT /api/reminders/smtp error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to save hosting email settings.') },
        500
      );
    }
  }

  if (method === 'POST' && path === '/api/reminders/smtp/verify') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-email',
      windowMs: 5 * 60_000,
      maxRequests: 20,
      message: 'Too many email requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const result = await verifyWorkerEmailConnection(env);
    return jsonResponse(request, env, {
      ...result,
      smtpStatus: await getWorkerSmtpStatus(env),
    });
  }

  if (method === 'POST' && path === '/api/reminders/smtp/test-email') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-email',
      windowMs: 5 * 60_000,
      maxRequests: 20,
      message: 'Too many email requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { ok: false, message: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as { toEmail?: string };
    const status = await getWorkerSmtpStatus(env);
    const siteConfig = await getSiteConfigD1(env);
    const targetEmail = (body.toEmail || status.user || siteConfig.recoveryEmail || '').trim();
    if (!EMAIL_REGEX.test(targetEmail)) {
      return jsonResponse(
        request,
        env,
        { ok: false, message: 'Please provide a valid email address for the test email.' },
        400
      );
    }
    const result = await sendWorkerTestEmail(env, targetEmail);
    return jsonResponse(request, env, {
      ...result,
      smtpStatus: await getWorkerSmtpStatus(env),
    });
  }

  if (method === 'DELETE' && path === '/api/reminders/smtp') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    await saveStoredSmtpConfigD1(env, null);
    return jsonResponse(request, env, {
      ok: true,
      smtpStatus: await getWorkerSmtpStatus(env),
    });
  }

  if (method === 'PUT' && path === '/api/reminders/schedule') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as Partial<ReminderScheduleConfig>;
    const patch: Partial<ReminderScheduleConfig> = {};

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.dailySendTime === 'string' && /^\d{2}:\d{2}$/.test(body.dailySendTime)) {
      patch.dailySendTime = body.dailySendTime;
    }
    if (typeof body.timezone === 'string' && body.timezone.trim()) {
      patch.timezone = body.timezone.trim();
    }
    if (
      body.alertScope === 'urgent_and_due_soon' ||
      body.alertScope === 'urgent_only' ||
      body.alertScope === 'all_lines'
    ) {
      patch.alertScope = body.alertScope;
    }
    if (typeof body.customMessage === 'string') {
      patch.customMessage = body.customMessage.slice(0, 3000);
    }

    const reminders = await updateReminderScheduleD1(env, patch);
    return jsonResponse(request, env, {
      reminders,
      smtpStatus: await getWorkerSmtpStatus(env),
    });
  }

  if (method === 'POST' && path === '/api/reminders/recipients') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as {
      name?: string;
      email?: string;
      role?: string;
      factories?: FactoryName[];
      frequency?: RecipientFrequency;
      sendTime?: string;
      dayOfWeek?: number;
      dayOfMonth?: number;
      customNote?: string;
    };

    const email = (body?.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      return jsonResponse(request, env, { error: 'Please provide a valid email address.' }, 400);
    }

    const state = await getWorkspaceStateD1(env);
    if (state.reminders.recipients.some((r) => r.email.toLowerCase() === email)) {
      return jsonResponse(
        request,
        env,
        { error: 'This email address is already in the reminder list.' },
        409
      );
    }

    const validFactories = Array.isArray(body.factories)
      ? body.factories.filter((f) => ALLOWED_FACTORIES.includes(f))
      : [];
    const frequency: RecipientFrequency =
      body.frequency === 'weekly' || body.frequency === 'monthly' || body.frequency === 'daily'
        ? body.frequency
        : 'daily';
    const sendTime =
      typeof body.sendTime === 'string' && /^\d{2}:\d{2}$/.test(body.sendTime)
        ? body.sendTime
        : state.reminders.schedule.dailySendTime;
    const dayOfWeek =
      typeof body.dayOfWeek === 'number' && body.dayOfWeek >= 0 && body.dayOfWeek <= 6
        ? Math.round(body.dayOfWeek)
        : 1;
    const dayOfMonth =
      typeof body.dayOfMonth === 'number' && body.dayOfMonth >= 1 && body.dayOfMonth <= 31
        ? Math.round(body.dayOfMonth)
        : 1;

    const recipient: ReminderRecipient = {
      id: `RECIP-${Date.now().toString(36).toUpperCase()}`,
      name: (body.name || '').trim() || email.split('@')[0],
      email,
      role: (body.role || '').trim() || 'Merchandising / Planning',
      factories: validFactories,
      active: true,
      frequency,
      sendTime,
      dayOfWeek,
      dayOfMonth,
      lastSentDateLocal: null,
      customNote: typeof body.customNote === 'string' ? body.customNote.trim().slice(0, 1000) : '',
      addedAtIso: new Date().toISOString(),
    };

    const reminders = await addReminderRecipientD1(env, recipient);
    return jsonResponse(request, env, { recipient, reminders }, 201);
  }

  const recipientMatch = /^\/api\/reminders\/recipients\/([^/]+)$/.exec(path);
  if (method === 'PATCH' && recipientMatch) {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(recipientMatch[1] || '');
    const parsedBody = await readJsonBody(request);
    if (!parsedBody.ok) {
      return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
    }
    const body = parsedBody.data as Partial<ReminderRecipient>;
    const patch: Partial<ReminderRecipient> = {};

    if (typeof body.email === 'string') {
      const cleanEmail = body.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return jsonResponse(request, env, { error: 'Please provide a valid email address.' }, 400);
      }
      const duplicate = (await getWorkspaceStateD1(env)).reminders.recipients.some(
        (r) => r.id !== id && r.email.toLowerCase() === cleanEmail
      );
      if (duplicate) {
        return jsonResponse(
          request,
          env,
          { error: 'Another recipient already uses this email address.' },
          409
        );
      }
      patch.email = cleanEmail;
    }
    if (typeof body.active === 'boolean') patch.active = body.active;
    if (typeof body.name === 'string') patch.name = body.name.trim();
    if (typeof body.role === 'string') patch.role = body.role.trim();
    if (Array.isArray(body.factories)) {
      patch.factories = body.factories.filter((f) => ALLOWED_FACTORIES.includes(f));
    }
    if (
      body.frequency === 'daily' ||
      body.frequency === 'weekly' ||
      body.frequency === 'monthly'
    ) {
      patch.frequency = body.frequency;
    }
    if (typeof body.sendTime === 'string' && /^\d{2}:\d{2}$/.test(body.sendTime)) {
      patch.sendTime = body.sendTime;
    }
    if (typeof body.dayOfWeek === 'number' && body.dayOfWeek >= 0 && body.dayOfWeek <= 6) {
      patch.dayOfWeek = Math.round(body.dayOfWeek);
    }
    if (typeof body.dayOfMonth === 'number' && body.dayOfMonth >= 1 && body.dayOfMonth <= 31) {
      patch.dayOfMonth = Math.round(body.dayOfMonth);
    }
    if (typeof body.customNote === 'string') {
      patch.customNote = body.customNote.slice(0, 1000);
    }

    const reminders = await updateReminderRecipientD1(env, id, patch);
    return jsonResponse(request, env, { reminders });
  }

  if (method === 'DELETE' && recipientMatch) {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    const id = decodeURIComponent(recipientMatch[1] || '');
    const reminders = await deleteReminderRecipientD1(env, id);
    return jsonResponse(request, env, { reminders });
  }

  if (method === 'POST' && path === '/api/reminders/send-now') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-email',
      windowMs: 5 * 60_000,
      maxRequests: 20,
      message: 'Too many email requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        recipientId?: string;
        alertScope?: ReminderAlertScope;
        referenceDateIso?: string;
        customMessage?: string;
      };

      const state = await getWorkspaceStateD1(env);
      const targetRecipients = body.recipientId
        ? state.reminders.recipients.filter((r) => r.id === body.recipientId)
        : state.reminders.recipients.filter((r) => r.active);
      const alertScope = body.alertScope || state.reminders.schedule.alertScope;
      const referenceDateIso =
        body.referenceDateIso || state.referenceDateIso || new Date().toISOString().slice(0, 10);
      const customMessage =
        typeof body.customMessage === 'string'
          ? body.customMessage.slice(0, 3000)
          : state.reminders.schedule.customMessage;

      const result = await sendWorkerShortcutReminderEmails(env, {
        recipients: targetRecipients.map((r) => ({ ...r, active: true })),
        meta: state.meta,
        records: state.records,
        cuttingEntries: state.cuttingEntries,
        referenceDateIso,
        alertScope,
        customMessage,
        triggerType: 'Manual Send',
        appUrl: getAppPublicUrlWorker(request, env),
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });

      const updatedState = await getWorkspaceStateD1(env);
      return jsonResponse(request, env, {
        ok: result.ok,
        log: result.log,
        reminders: updatedState.reminders,
        smtpStatus: await getWorkerSmtpStatus(env),
      });
    } catch (error) {
      console.error('POST /api/reminders/send-now error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to send reminder email.') },
        500
      );
    }
  }

  if (method === 'POST' && path === '/api/saved-fo/send-email') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-email',
      windowMs: 5 * 60_000,
      maxRequests: 20,
      message: 'Too many email requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        toEmails?: string[] | string;
        subject?: string;
        bodyText?: string;
        selectedRecordIds?: string[];
        attachXlsx?: boolean;
        referenceDateIso?: string;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
      };

      const state = await getWorkspaceStateD1(env);
      const rawList = Array.isArray(body.toEmails)
        ? body.toEmails
        : typeof body.toEmails === 'string'
          ? body.toEmails.split(/[,\s;]+/)
          : [];
      const toEmails = rawList.map((e) => e.trim()).filter(Boolean).slice(0, 30);
      const recordsToUse =
        Array.isArray(body.records) && body.records.length > 0 ? body.records : state.records;
      const cuttingToUse = Array.isArray(body.cuttingEntries)
        ? body.cuttingEntries
        : state.cuttingEntries;
      const referenceDateIso =
        body.referenceDateIso || state.referenceDateIso || new Date().toISOString().slice(0, 10);

      const result = await sendWorkerSavedUpcomingFoEmail(env, {
        toEmails,
        subject: typeof body.subject === 'string' ? body.subject.slice(0, 240) : undefined,
        bodyText: typeof body.bodyText === 'string' ? body.bodyText.slice(0, 5000) : undefined,
        meta: state.meta,
        records: recordsToUse,
        cuttingEntries: cuttingToUse,
        referenceDateIso,
        selectedRecordIds: Array.isArray(body.selectedRecordIds)
          ? body.selectedRecordIds
          : undefined,
        attachXlsx: body.attachXlsx !== false,
        appUrl: getAppPublicUrlWorker(request, env),
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });

      const updatedState = await getWorkspaceStateD1(env);
      return jsonResponse(
        request,
        env,
        {
          ok: result.ok,
          message: result.message,
          log: result.log,
          reminders: updatedState.reminders,
        },
        result.ok ? 200 : 400
      );
    } catch (error) {
      console.error('POST /api/saved-fo/send-email error:', error);
      const safe = toSafeClientErrorWorker(error, 'Failed to send Saved Upcoming FO email.');
      return jsonResponse(request, env, { ok: false, message: safe, error: safe }, 500);
    }
  }

  // =========================================================================
  // ONLINE CUTTING / OUTPUT / PACKING SHEET AUTO-SYNC ENDPOINTS
  // =========================================================================
  if (method === 'GET' && path === '/api/cutting-sheet') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    const pub = await getPublicWorkspaceStateD1(env, true);
    return jsonResponse(request, env, { cuttingSheetSync: pub.cuttingSheetSync });
  }

  if (method === 'PUT' && path === '/api/cutting-sheet/config') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as Partial<{
        enabled: boolean;
        sheetUrl: string;
        factoryUrls: FactorySheetUrlMap;
        outputSheetUrl: string;
        outputFactoryUrls: FactorySheetUrlMap;
        packingSheetUrl: string;
        packingFactoryUrls: FactorySheetUrlMap;
        syncMode: CuttingSheetSyncMode;
        intervalMinutes: number;
      }>;

      const patch: Partial<
        Pick<
          CuttingSheetSyncConfig,
          | 'enabled'
          | 'sheetUrl'
          | 'factoryUrls'
          | 'outputSheetUrl'
          | 'outputFactoryUrls'
          | 'packingSheetUrl'
          | 'packingFactoryUrls'
          | 'syncMode'
          | 'intervalMinutes'
          | 'lastContentHash'
        >
      > = {};

      const currentCfg = (await getWorkspaceStateD1(env)).cuttingSheetSync;

      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (typeof body.sheetUrl === 'string') {
        const cleanUrl = body.sheetUrl.trim();
        if (cleanUrl) await assertSafeExternalUrlWorker(cleanUrl);
        patch.sheetUrl = cleanUrl;
        if (cleanUrl !== (currentCfg.sheetUrl || '').trim()) patch.lastContentHash = '';
      }
      if (body.factoryUrls && typeof body.factoryUrls === 'object') {
        const cleanFactoryUrls: FactorySheetUrlMap = {};
        let urlsChanged = false;
        for (const fac of ALLOWED_FACTORIES) {
          const val = body.factoryUrls[fac];
          const clean = typeof val === 'string' ? val.trim() : '';
          if (clean) {
            await assertSafeExternalUrlWorker(clean);
            cleanFactoryUrls[fac] = clean;
          }
          if (clean !== ((currentCfg.factoryUrls || {})[fac] || '').trim()) {
            urlsChanged = true;
          }
        }
        patch.factoryUrls = cleanFactoryUrls;
        if (urlsChanged) patch.lastContentHash = '';
      }
      if (typeof body.outputSheetUrl === 'string') {
        const cleanOutUrl = body.outputSheetUrl.trim();
        if (cleanOutUrl) await assertSafeExternalUrlWorker(cleanOutUrl);
        patch.outputSheetUrl = cleanOutUrl;
        if (cleanOutUrl !== (currentCfg.outputSheetUrl || '').trim()) patch.lastContentHash = '';
      }
      if (body.outputFactoryUrls && typeof body.outputFactoryUrls === 'object') {
        const cleanOutputFactoryUrls: FactorySheetUrlMap = {};
        let outUrlsChanged = false;
        for (const fac of ALLOWED_FACTORIES) {
          const val = body.outputFactoryUrls[fac];
          const clean = typeof val === 'string' ? val.trim() : '';
          if (clean) {
            await assertSafeExternalUrlWorker(clean);
            cleanOutputFactoryUrls[fac] = clean;
          }
          if (clean !== ((currentCfg.outputFactoryUrls || {})[fac] || '').trim()) {
            outUrlsChanged = true;
          }
        }
        patch.outputFactoryUrls = cleanOutputFactoryUrls;
        if (outUrlsChanged) patch.lastContentHash = '';
      }
      if (typeof body.packingSheetUrl === 'string') {
        const cleanPackUrl = body.packingSheetUrl.trim();
        if (cleanPackUrl) await assertSafeExternalUrlWorker(cleanPackUrl);
        patch.packingSheetUrl = cleanPackUrl;
        if (cleanPackUrl !== (currentCfg.packingSheetUrl || '').trim()) patch.lastContentHash = '';
      }
      if (body.packingFactoryUrls && typeof body.packingFactoryUrls === 'object') {
        const cleanPackingFactoryUrls: FactorySheetUrlMap = {};
        let packUrlsChanged = false;
        for (const fac of ALLOWED_FACTORIES) {
          const val = body.packingFactoryUrls[fac];
          const clean = typeof val === 'string' ? val.trim() : '';
          if (clean) {
            await assertSafeExternalUrlWorker(clean);
            cleanPackingFactoryUrls[fac] = clean;
          }
          if (clean !== ((currentCfg.packingFactoryUrls || {})[fac] || '').trim()) {
            packUrlsChanged = true;
          }
        }
        patch.packingFactoryUrls = cleanPackingFactoryUrls;
        if (packUrlsChanged) patch.lastContentHash = '';
      }
      if (
        body.syncMode === 'auto' ||
        body.syncMode === 'daily_rows' ||
        body.syncMode === 'cumulative_pg'
      ) {
        patch.syncMode = body.syncMode;
        if (body.syncMode !== currentCfg.syncMode) patch.lastContentHash = '';
      }
      if (typeof body.intervalMinutes === 'number' && Number.isFinite(body.intervalMinutes)) {
        patch.intervalMinutes = Math.min(1440, Math.max(1, Math.round(body.intervalMinutes)));
      }

      const cuttingSheetSync = await updateCuttingSheetSyncConfigD1(env, patch);
      return jsonResponse(request, env, { ok: true, cuttingSheetSync });
    } catch (error) {
      console.error('PUT /api/cutting-sheet/config error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to save cutting sheet configuration.') },
        400
      );
    }
  }

  if (method === 'POST' && path === '/api/cutting-sheet/links/remove') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as { role?: string; scope?: string };
      const role = body.role;
      const scope = body.scope;
      if (role !== 'cutting' && role !== 'output' && role !== 'packing') {
        return jsonResponse(
          request,
          env,
          { error: 'Invalid link role. Expected cutting, output, or packing.' },
          400
        );
      }
      if (scope !== 'combined' && !ALLOWED_FACTORIES.includes(scope as FactoryName)) {
        return jsonResponse(request, env, { error: 'Invalid link scope.' }, 400);
      }
      const cuttingSheetSync = await removeCuttingSheetLinkD1(env, {
        role: role as CuttingSheetLinkRole,
        scope: scope as CuttingSheetLinkScope,
      });
      return jsonResponse(request, env, { ok: true, cuttingSheetSync });
    } catch (error) {
      console.error('POST /api/cutting-sheet/links/remove error:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to remove saved sheet link.') },
        400
      );
    }
  }

  if (method === 'POST' && path === '/api/cutting-sheet/sync') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-upload-sync',
      windowMs: 5 * 60_000,
      maxRequests: 25,
      message: 'Too many file uploads or sync requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    try {
      let trigger: 'Auto' | 'Manual' = 'Manual';
      let force = true;
      const contentType = (request.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const parsedBody = await readJsonBody(request);
        if (parsedBody.ok && parsedBody.data && typeof parsedBody.data === 'object') {
          const b = parsedBody.data as { trigger?: string; force?: boolean };
          if (b.trigger === 'Auto') {
            trigger = 'Auto';
            force = typeof b.force === 'boolean' ? b.force : false;
          } else if (typeof b.force === 'boolean') {
            force = b.force;
          }
        }
      }
      const result = await runCuttingSheetSyncWorker(env, { trigger, force });
      return jsonResponse(request, env, {
        ok: result.ok,
        updated: result.updated,
        message: result.message,
        records: result.records,
        cuttingEntries: result.cuttingEntries,
        cuttingSheetSync: result.cuttingSheetSync,
      });
    } catch (error) {
      console.error('POST /api/cutting-sheet/sync error:', error);
      const safe = toSafeClientErrorWorker(error, 'Failed to sync online cutting sheet.');
      return jsonResponse(request, env, { ok: false, message: safe, error: safe }, 500);
    }
  }

  if (method === 'POST' && path === '/api/cutting-sheet/upload') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-upload-sync',
      windowMs: 5 * 60_000,
      maxRequests: 25,
      message: 'Too many file uploads or sync requests. Please wait a few minutes.',
    });
    if (limited) return limited;

    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;

    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        fileName?: string;
        base64?: string;
        csvText?: string;
        factory?: FactoryName;
      };
      const fileName = (body.fileName || 'cutting-sheet.xlsx').trim();
      const hasBase64 = typeof body.base64 === 'string' && body.base64.length > 0;
      const hasCsv = typeof body.csvText === 'string' && body.csvText.length > 0;
      if (!hasBase64 && !hasCsv) {
        return jsonResponse(
          request,
          env,
          { ok: false, error: 'Please select an .xlsx or .csv file to upload.' },
          400
        );
      }

      let buffer: Buffer | undefined;
      if (hasBase64) {
        const validated = validateBase64UploadWorker({
          base64: body.base64!,
          fileName,
          allowedExtensions: ['xlsx', 'xlsm', 'csv'],
          maxBytes: MAX_UPLOAD_BYTES,
        });
        buffer = validated.buffer;
      } else if (hasCsv) {
        if (!fileName.toLowerCase().endsWith('.csv')) {
          return jsonResponse(
            request,
            env,
            { ok: false, error: 'Unsupported CSV upload filename.' },
            400
          );
        }
        if (Buffer.byteLength(body.csvText!, 'utf8') > MAX_UPLOAD_BYTES) {
          return jsonResponse(
            request,
            env,
            { ok: false, error: 'Uploaded CSV exceeds the 15 MB size limit.' },
            400
          );
        }
      }

      const defaultFactory =
        body.factory && ALLOWED_FACTORIES.includes(body.factory)
          ? body.factory
          : detectFactoryHintFromText(fileName);

      const result = await importCuttingFileBufferWorker(env, {
        fileName,
        buffer,
        csvText: body.csvText,
        defaultFactory,
      });

      return jsonResponse(request, env, {
        ok: result.ok,
        message: result.message,
        records: result.records,
        cuttingEntries: result.cuttingEntries,
        cuttingSheetSync: result.cuttingSheetSync,
      });
    } catch (error) {
      console.error('POST /api/cutting-sheet/upload error:', error);
      const safe = toSafeClientErrorWorker(error, 'Failed to import uploaded cutting file.');
      return jsonResponse(request, env, { ok: false, message: safe, error: safe }, 400);
    }
  }

  // =========================================================================
  // ADMIN-ONLY EXCEL EXPORT ENDPOINTS
  // =========================================================================
  if (method === 'GET' && path === '/api/export-xlsx') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const state = await getWorkspaceStateD1(env);
      const buffer = await buildPlanningWorkbookBuffer(
        state.meta,
        state.records,
        state.referenceDateIso || new Date().toISOString().slice(0, 10),
        state.cuttingEntries,
        {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        }
      );
      return binaryResponse(
        request,
        env,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'attachment; filename="Alex_Apparels_Cluster1_Planning_Dashboard.xlsx"'
      );
    } catch (error) {
      console.error('Export workbook GET failed:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to build Excel workbook.') },
        500
      );
    }
  }

  if (method === 'POST' && path === '/api/export-xlsx') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
      };
      const state = await getWorkspaceStateD1(env);
      const meta = body?.meta || state.meta;
      const records =
        Array.isArray(body?.records) && body.records.length > 0 ? body.records : state.records;
      const cuttingEntries = Array.isArray(body?.cuttingEntries)
        ? body.cuttingEntries
        : state.cuttingEntries;
      const referenceDateIso =
        body?.referenceDateIso || state.referenceDateIso || new Date().toISOString().slice(0, 10);

      const buffer = await buildPlanningWorkbookBuffer(
        meta,
        records,
        referenceDateIso,
        cuttingEntries,
        {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        }
      );
      return binaryResponse(
        request,
        env,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'attachment; filename="Alex_Apparels_Cluster1_Planning_Dashboard.xlsx"'
      );
    } catch (error) {
      console.error('Export workbook POST failed:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to export Excel workbook.') },
        500
      );
    }
  }

  if (method === 'GET' && path === '/api/export-selected-fo-xlsx') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const state = await getWorkspaceStateD1(env);
      const referenceDateIso = state.referenceDateIso || new Date().toISOString().slice(0, 10);
      const buffer = await buildSelectedUpcomingFoWorkbookBuffer({
        meta: state.meta,
        records: state.records,
        cuttingEntries: state.cuttingEntries,
        referenceDateIso,
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });
      return binaryResponse(
        request,
        env,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `attachment; filename="Selected_Upcoming_FO_List_${referenceDateIso}.xlsx"`
      );
    } catch (error) {
      console.error('Export selected FO workbook GET failed:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to build selected FO Excel file.') },
        500
      );
    }
  }

  if (method === 'POST' && path === '/api/export-selected-fo-xlsx') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
        selectedRecordIds?: string[];
      };

      const state = await getWorkspaceStateD1(env);
      const meta = body?.meta || state.meta;
      const records =
        Array.isArray(body?.records) && body.records.length > 0 ? body.records : state.records;
      const cuttingEntries = Array.isArray(body?.cuttingEntries)
        ? body.cuttingEntries
        : state.cuttingEntries;
      const referenceDateIso =
        body?.referenceDateIso || state.referenceDateIso || new Date().toISOString().slice(0, 10);
      const selectedRecordIds = Array.isArray(body?.selectedRecordIds)
        ? body.selectedRecordIds
        : undefined;

      const buffer = await buildSelectedUpcomingFoWorkbookBuffer({
        meta,
        records,
        cuttingEntries,
        referenceDateIso,
        selectedRecordIds,
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });
      return binaryResponse(
        request,
        env,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `attachment; filename="Selected_Upcoming_FO_List_${referenceDateIso}.xlsx"`
      );
    } catch (error) {
      console.error('Export selected FO workbook POST failed:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to build selected FO Excel file.') },
        500
      );
    }
  }

  if (method === 'POST' && path === '/api/export-selected-fo-summary-xlsx') {
    const denied = await requireAdminWorker(request, env);
    if (denied) return denied;
    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        masterPlanAsOf?: unknown;
        referenceDateIso?: unknown;
        rows?: unknown;
      };
      const state = await getWorkspaceStateD1(env);
      const rawRef =
        typeof body?.referenceDateIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.referenceDateIso)
          ? body.referenceDateIso
          : state.referenceDateIso || new Date().toISOString().slice(0, 10);
      const masterPlanAsOf =
        typeof body?.masterPlanAsOf === 'string' && body.masterPlanAsOf.trim()
          ? body.masterPlanAsOf.trim().slice(0, 60)
          : state.meta.asOfDateRaw || state.meta.asOfDateIso || '—';

      const inputRows = Array.isArray(body?.rows) ? body.rows.slice(0, 2000) : [];
      const sanitizedRows: SelectedFoSummaryBoxRow[] = inputRows.map((entry, idx) => {
        const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        const rawQty = row.issueQty;
        const issueQty =
          typeof rawQty === 'number' && Number.isFinite(rawQty) && rawQty >= 0
            ? Math.round(rawQty)
            : null;
        const foDateNeededIso =
          typeof row.foDateNeededIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.foDateNeededIso)
            ? row.foDateNeededIso
            : null;
        const status: 'Running' | 'Upcoming' = row.status === 'Running' ? 'Running' : 'Upcoming';
        const foStatus: 'Pending' | 'Under Process' | 'Completed' =
          row.foStatus === 'Completed'
            ? 'Completed'
            : row.foStatus === 'Under Process'
              ? 'Under Process'
              : 'Pending';
        return {
          sl: idx + 1,
          factory: typeof row.factory === 'string' ? row.factory.trim().slice(0, 40) : '—',
          line: typeof row.line === 'string' ? row.line.trim().slice(0, 40) : '',
          pgNumber: typeof row.pgNumber === 'string' ? row.pgNumber.trim().slice(0, 40) : '—',
          style: typeof row.style === 'string' ? row.style.trim().slice(0, 200) : '—',
          issueQty,
          status,
          foDateNeededIso,
          foStatus,
        };
      });

      const buffer = await buildSelectedFoSummaryBoxWorkbookBuffer({
        masterPlanAsOf,
        referenceDateIso: rawRef,
        rows: sanitizedRows,
      });

      return binaryResponse(
        request,
        env,
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        `attachment; filename="ALEX_FO_Needed_Checklist_${rawRef}.xlsx"`
      );
    } catch (error) {
      console.error('Export selected FO summary box POST failed:', error);
      return jsonResponse(
        request,
        env,
        { error: toSafeClientErrorWorker(error, 'Failed to export summary Excel file.') },
        500
      );
    }
  }

  // =========================================================================
  // SHEHREEN AI ASSISTANT
  // =========================================================================
  if (method === 'POST' && path === '/api/assistant/chat') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-assistant',
      windowMs: 60_000,
      maxRequests: 25,
      message: 'Too many AI assistant messages. Please wait a minute and try again.',
    });
    if (limited) return limited;

    const isAdmin = await isAdminAuthorizedWorker(request, env);

    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        message?: string;
        history?: ShehreenHistoryTurn[];
        scope?: string;
        currentTab?: string;
        selectedFactory?: string;
        selectedLine?: string;
      };
      const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!rawMessage) {
        return jsonResponse(
          request,
          env,
          { ok: false, error: 'Please type a question for Shehreen.' },
          400
        );
      }
      const effectiveScope =
        isAdmin && body?.scope === 'control_tower' ? 'control_tower' : 'master_plan';
      const state = await getWorkspaceStateD1(env);
      const smtpStatus = await getWorkerSmtpStatus(env);
      const result = await askShehreenAssistantCore(
        {
          message: rawMessage.slice(0, 4000),
          history: Array.isArray(body?.history) ? body.history.slice(-12) : [],
          scope: effectiveScope,
          currentTab: typeof body?.currentTab === 'string' ? body.currentTab : undefined,
          selectedFactory:
            typeof body?.selectedFactory === 'string' ? body.selectedFactory : undefined,
          selectedLine: typeof body?.selectedLine === 'string' ? body.selectedLine : undefined,
        },
        {
          aiEnabled: (env.AI_ENABLED || '').trim().toLowerCase() !== 'false',
          geminiApiKey: env.GEMINI_API_KEY || '',
          state,
          smtpConfigured: smtpStatus.configured,
          scope: effectiveScope,
        }
      );
      return jsonResponse(request, env, { ok: true, ...result });
    } catch (error) {
      console.error('POST /api/assistant/chat error:', error);
      const rawMsg = error instanceof Error ? error.message : 'Shehreen AI request failed.';
      const msgLower = rawMsg.toLowerCase();
      const friendlyError =
        msgLower.includes('api_key') ||
        msgLower.includes('permission_denied') ||
        msgLower.includes('api key') ||
        msgLower.includes('gemini_api_key')
          ? 'AI service configuration issue. Please verify GEMINI_API_KEY on the server.'
          : msgLower.includes('resource_exhausted') || msgLower.includes('429')
            ? 'AI request quota reached. Please try again shortly.'
            : toSafeClientErrorWorker(error, 'Shehreen AI request failed. Please try again.');
      return jsonResponse(request, env, { ok: false, error: friendlyError }, 500);
    }
  }

  // =========================================================================
  // PO & PG# MATCHER — AI VISION OCR FOR SOURCE SLIP PHOTOS
  // =========================================================================
  if (method === 'POST' && path === '/api/extract-image') {
    const limited = await enforceRateLimit(request, env, {
      name: 'api-assistant',
      windowMs: 60_000,
      maxRequests: 25,
      message: 'Too many image OCR requests. Please wait a minute and try again.',
    });
    if (limited) return limited;

    try {
      const parsedBody = await readJsonBody(request);
      if (!parsedBody.ok) {
        return jsonResponse(request, env, { ok: false, error: parsedBody.error }, parsedBody.status);
      }
      const body = parsedBody.data as {
        imageBase64?: unknown;
        mimeType?: unknown;
      };
      const result = await extractPoRecordsFromImageCore(
        {
          imageBase64: body.imageBase64,
          mimeType: body.mimeType,
        },
        {
          geminiApiKey: env.GEMINI_API_KEY || '',
        }
      );
      return jsonResponse(request, env, { ok: true, sourceRecords: result.sourceRecords });
    } catch (error) {
      if (error instanceof ExtractImageValidationError) {
        return jsonResponse(request, env, { ok: false, error: error.message }, error.status);
      }
      console.error('POST /api/extract-image error:', error);
      const rawMsg = error instanceof Error ? error.message : 'Image OCR extraction failed.';
      const msgLower = rawMsg.toLowerCase();
      const friendlyError =
        msgLower.includes('api_key') ||
        msgLower.includes('permission_denied') ||
        msgLower.includes('api key') ||
        msgLower.includes('gemini_api_key')
          ? 'AI OCR configuration issue. Please verify GEMINI_API_KEY on the server.'
          : msgLower.includes('resource_exhausted') || msgLower.includes('429')
            ? 'AI OCR request quota reached. Please try again shortly.'
            : toSafeClientErrorWorker(error, 'Failed to read PO slip photo. Please try again.');
      return jsonResponse(request, env, { ok: false, error: friendlyError }, 500);
    }
  }

  return jsonResponse(request, env, { error: 'API endpoint not found' }, 404);
}

export async function handleWorkerScheduled(
  _controller: ScheduledController,
  env: WorkerEnv,
  ctx: ExecutionContext
): Promise<void> {
  ctx.waitUntil(
    Promise.allSettled([
      runScheduledCuttingSheetCheckWorker(env),
      runScheduledReminderCheckWorker(env),
    ])
  );
}

export default {
  fetch: handleWorkerFetch,
  scheduled: handleWorkerScheduled,
};
