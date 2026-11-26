import 'dotenv/config';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  DailyCuttingEntry,
  FactoryName,
  MasterPlanMeta,
  PlanningRecord,
} from './src/shared/plannerTypes.ts';
import { ALLOWED_FACTORIES } from './src/shared/plannerTypes.ts';
import { EMAIL_REGEX } from './src/shared/reminderTypes.ts';
import type {
  RecipientFrequency,
  ReminderAlertScope,
  ReminderRecipient,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpProviderPreset,
} from './src/shared/reminderTypes.ts';
import type { WebsiteControlConfig } from './src/shared/controlPanelTypes.ts';
import type {
  CuttingSheetSyncConfig,
  CuttingSheetSyncMode,
  FactorySheetUrlMap,
} from './src/shared/cuttingSheetTypes.ts';
import {
  buildPlanningWorkbookBuffer,
  buildSelectedFoSummaryBoxWorkbookBuffer,
  buildSelectedUpcomingFoWorkbookBuffer,
  type SelectedFoSummaryBoxRow,
} from './src/server/xlsxBuilder.ts';
import {
  addReminderRecipient,
  bootstrapInitialAdminPassword,
  deleteReminderRecipient,
  getAdminAuthUpdatedAtIso,
  getPublicFoNeededState,
  getPublicMasterPlanState,
  getPublicWorkspaceState,
  getSiteConfig,
  getStoredSmtpConfig,
  getSyncVersionSnapshot,
  getWorkspaceState,
  isAdminPasswordConfigured,
  resetPlanningWorkspace,
  restoreWorkspaceSnapshot,
  saveStoredSmtpConfig,
  updateAdminPassword,
  updateCuttingSheetSyncConfig,
  updatePlanningWorkspace,
  updateRecordsPackingQty,
  updateReminderRecipient,
  updateReminderSchedule,
  updateSiteConfig,
  verifyAdminPassword,
} from './src/server/workspaceStore.ts';
import {
  convertMasterPlanXlsxToCsv,
  detectFactoryHintFromText,
  importCuttingFileBuffer,
  runCuttingSheetSync,
} from './src/server/cuttingSheetSync.ts';
import {
  getSmtpStatus,
  sendAdminVerificationCodeEmail,
  sendPasswordChangedNoticeEmail,
  sendSavedUpcomingFoEmail,
  sendShortcutReminderEmails,
  sendTestEmail,
  verifySmtpConnection,
} from './src/server/emailService.ts';
import {
  askShehreenAssistant,
  type ShehreenHistoryTurn,
} from './src/server/shehreenAssistant.ts';
import {
  MAX_UPLOAD_BYTES,
  assertSafeExternalUrl,
  checkLoginLockout,
  clearAdminSessionCookie,
  clearLoginFailures,
  corsMiddleware,
  createRateLimiter,
  createSignedAdminSessionToken,
  extractAdminTokenFromRequest,
  getClientIp,
  recordLoginFailure,
  revokeAdminSessionToken,
  securityHeadersMiddleware,
  setAdminSessionCookie,
  toSafeClientError,
  validateBase64Upload,
  verifySignedAdminSessionToken,
} from './src/server/security.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OTP_TTL_MS = 10 * 60 * 1000;

interface PendingPasswordOtp {
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  targetEmail: string;
}

let pendingOtp: PendingPasswordOtp | null = null;

function isAdminAuthorized(req: express.Request): boolean {
  const token = extractAdminTokenFromRequest(req);
  return verifySignedAdminSessionToken(token, getAdminAuthUpdatedAtIso());
}

function hashOtp(code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function getZonedDateTime(timeZone: string): {
  dateLocal: string;
  timeLocal: string;
  dayOfWeek: number;
  dayOfMonth: number;
  daysInMonth: number;
} {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    const year = Number(get('year'));
    const month = Number(get('month'));
    const day = Number(get('day'));
    const hour = get('hour') === '24' ? '00' : get('hour');
    const localAsUtc = new Date(Date.UTC(year, month - 1, day));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      dateLocal: `${get('year')}-${get('month')}-${get('day')}`,
      timeLocal: `${hour}:${get('minute')}`,
      dayOfWeek: localAsUtc.getUTCDay(),
      dayOfMonth: day,
      daysInMonth,
    };
  } catch {
    const now = new Date();
    const iso = now.toISOString();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
    ).getUTCDate();
    return {
      dateLocal: iso.slice(0, 10),
      timeLocal: iso.slice(11, 16),
      dayOfWeek: now.getUTCDay(),
      dayOfMonth: now.getUTCDate(),
      daysInMonth,
    };
  }
}

const DEFAULT_PUBLIC_BACKEND_URL =
  'https://cluster-1-planning-fo-control-tower-9b844.containers.snapdeploy.app';

function getAppPublicUrl(req?: express.Request): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
    return envUrl;
  }
  if (req) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
      .split(',')[0]
      .trim();
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
      .split(',')[0]
      .trim();
    if (host) {
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  }
  return DEFAULT_PUBLIC_BACKEND_URL;
}

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({
      ok: false,
      error: 'Admin sign-in required. Please sign in to modify workspace data or settings.',
    });
    return false;
  }
  return true;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeadersMiddleware());
  app.use(corsMiddleware());
  app.use(express.json({ limit: '25mb' }));

  const generalApiLimiter = createRateLimiter({
    name: 'api-general',
    windowMs: 60_000,
    maxRequests: 300,
    message: 'Too many API requests. Please wait a moment and try again.',
  });
  const authLimiter = createRateLimiter({
    name: 'api-auth',
    windowMs: 15 * 60_000,
    maxRequests: 30,
    message: 'Too many authentication attempts. Please try again later.',
  });
  const uploadSyncLimiter = createRateLimiter({
    name: 'api-upload-sync',
    windowMs: 5 * 60_000,
    maxRequests: 25,
    message: 'Too many file uploads or sync requests. Please wait a few minutes.',
  });
  const emailLimiter = createRateLimiter({
    name: 'api-email',
    windowMs: 5 * 60_000,
    maxRequests: 20,
    message: 'Too many email requests. Please wait a few minutes.',
  });
  const assistantLimiter = createRateLimiter({
    name: 'api-assistant',
    windowMs: 60_000,
    maxRequests: 25,
    message: 'Too many AI assistant messages. Please wait a minute and try again.',
  });

  app.use('/api', generalApiLimiter);

  getWorkspaceState();

  app.get(
    ['/master-plan.webmanifest', '/Cluster-1-Planning-FO-Control-Tower/master-plan.webmanifest'],
    (req, res) => {
      const useBase = req.path.startsWith('/Cluster-1-Planning-FO-Control-Tower/');
      const startUrl = useBase
        ? '/Cluster-1-Planning-FO-Control-Tower/master-plan'
        : '/master-plan';
      const iconBase = '/Cluster-1-Planning-FO-Control-Tower/';
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.json({
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
          {
            src: `${iconBase}master-plan-192x192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${iconBase}master-plan-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${iconBase}master-plan-maskable-512x512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      });
    }
  );

  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const state = getWorkspaceState();
    res.json({
      ok: true,
      totalLines: state.meta.totalLines,
      totalRecords: state.records.length,
    });
  });

  // Lightweight read-only version probe for 15s public background sync
  app.get('/api/public/sync-version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const snap = getSyncVersionSnapshot();
    res.json({
      ok: true,
      version: snap.version,
      referenceDateIso: snap.referenceDateIso,
      cuttingUpdatedAtIso: snap.cuttingUpdatedAtIso,
    });
  });

  // Strict read-only public endpoint for external factory users (/master-plan)
  app.get('/api/public/master-plan', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const state = getWorkspaceState();
      const factories =
        Array.isArray(state.meta.factoriesIncluded) && state.meta.factoriesIncluded.length > 0
          ? state.meta.factoriesIncluded
          : ALLOWED_FACTORIES;

      const rawFactory = typeof req.query.factory === 'string' ? req.query.factory.trim() : '';
      const resolveDefault =
        req.query.resolveDefault === '1' || req.query.resolveDefault === 'true';

      if (rawFactory) {
        const normalized = rawFactory.replace(/\s+/g, ' ').toUpperCase();
        const matched = factories.find((f) => f.toUpperCase() === normalized);
        if (!matched) {
          res.status(400).json({ error: 'Invalid factory filter.' });
          return;
        }
        res.json(getPublicMasterPlanState(matched));
        return;
      }

      if (resolveDefault && factories.length > 0) {
        res.json(getPublicMasterPlanState(factories[0]));
        return;
      }

      res.json(getPublicMasterPlanState());
    } catch (error) {
      console.error('GET /api/public/master-plan error:', error);
      res.status(500).json({ error: 'Failed to load public master plan.' });
    }
  });

  // Strict read-only public endpoint for Master Plan FO NEEDED tab
  app.get('/api/public/fo-needed', (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const state = getWorkspaceState();
      const factories =
        Array.isArray(state.meta.factoriesIncluded) && state.meta.factoriesIncluded.length > 0
          ? state.meta.factoriesIncluded
          : ALLOWED_FACTORIES;

      const rawFactory = typeof req.query.factory === 'string' ? req.query.factory.trim() : '';
      if (rawFactory && rawFactory.toUpperCase() !== 'ALL') {
        const normalized = rawFactory.replace(/\s+/g, ' ').toUpperCase();
        const matched = factories.find((f) => f.toUpperCase() === normalized);
        if (!matched) {
          res.status(400).json({ error: 'Invalid factory filter.' });
          return;
        }
        res.json(getPublicFoNeededState(matched));
        return;
      }

      res.json(getPublicFoNeededState(null));
    } catch (error) {
      console.error('GET /api/public/fo-needed error:', error);
      res.status(500).json({ error: 'Failed to load public FO Needed checklist.' });
    }
  });

  // Read-only Excel export matching Control Tower's Selected FO Needed Checklist
  app.get('/api/public/export-selected-fo-xlsx', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const state = getWorkspaceState();
      const factories =
        Array.isArray(state.meta.factoriesIncluded) && state.meta.factoriesIncluded.length > 0
          ? state.meta.factoriesIncluded
          : ALLOWED_FACTORIES;

      const rawFactory = typeof req.query.factory === 'string' ? req.query.factory.trim() : '';
      let factoryFilter: FactoryName | null = null;
      if (rawFactory && rawFactory.toUpperCase() !== 'ALL') {
        const normalized = rawFactory.replace(/\s+/g, ' ').toUpperCase();
        const matched = factories.find((f) => f.toUpperCase() === normalized);
        if (!matched) {
          res.status(400).json({ error: 'Invalid factory filter.' });
          return;
        }
        factoryFilter = matched;
      }

      const foData = getPublicFoNeededState(factoryFilter);
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

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="ALEX_FO_Needed_Checklist_${foData.referenceDateIso}.xlsx"`
      );
      res.send(buffer);
    } catch (error) {
      console.error('GET /api/public/export-selected-fo-xlsx error:', error);
      res.status(500).json({ error: 'Failed to export FO Needed Excel file.' });
    }
  });

  app.get('/api/master-plan', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const state = getWorkspaceState();
      res.json({ meta: state.meta, records: state.records });
    } catch (error) {
      console.error('GET /api/master-plan error:', error);
      res.status(500).json({ error: 'Failed to load master plan.' });
    }
  });

  app.post('/api/master-plan/parse-xlsx', uploadSyncLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as { base64?: string; fileName?: string };
      if (!body.base64 || typeof body.base64 !== 'string') {
        res.status(400).json({ error: 'Valid base64 .xlsx payload is required.' });
        return;
      }
      const validated = validateBase64Upload({
        base64: body.base64,
        fileName: body.fileName || 'master-plan.xlsx',
        allowedExtensions: ['xlsx', 'xlsm'],
        maxBytes: MAX_UPLOAD_BYTES,
      });
      const csvText = await convertMasterPlanXlsxToCsv(validated.buffer);
      res.json({ ok: true, csvText });
    } catch (error) {
      console.error('POST /api/master-plan/parse-xlsx error:', error);
      res.status(400).json({
        error: toSafeClientError(error, 'Failed to read .xlsx Master Plan file.'),
      });
    }
  });

  app.get('/api/workspace/sync-version', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const snap = getSyncVersionSnapshot();
    res.json({
      ok: true,
      ...snap,
    });
  });

  app.get('/api/workspace', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      res.setHeader('Cache-Control', 'no-store');
      const pub = getPublicWorkspaceState(true);
      res.json({
        ...pub,
        smtpStatus: getSmtpStatus(),
        appUrl: getAppPublicUrl(req),
        adminUnlocked: true,
      });
    } catch (error) {
      console.error('GET /api/workspace error:', error);
      res.status(500).json({ error: 'Failed to load workspace.' });
    }
  });

  app.put('/api/workspace', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
        hasCustomEdits?: boolean;
      };

      if (!body?.meta || !Array.isArray(body?.records) || body.records.length === 0) {
        res.status(400).json({ error: 'Valid meta and records array are required.' });
        return;
      }

      const saved = updatePlanningWorkspace({
        meta: body.meta,
        records: body.records,
        cuttingEntries: Array.isArray(body.cuttingEntries) ? body.cuttingEntries : [],
        referenceDateIso: body.referenceDateIso || new Date().toISOString().slice(0, 10),
        hasCustomEdits: body.hasCustomEdits ?? true,
      });

      res.json({
        ok: true,
        updatedAtIso: saved.updatedAtIso,
      });
    } catch (error) {
      console.error('PUT /api/workspace error:', error);
      res.status(500).json({ error: toSafeClientError(error, 'Failed to save workspace.') });
    }
  });

  app.post('/api/workspace/reset', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      resetPlanningWorkspace();
      const pub = getPublicWorkspaceState(true);
      res.json({
        ...pub,
        smtpStatus: getSmtpStatus(),
        adminUnlocked: true,
      });
    } catch (error) {
      console.error('POST /api/workspace/reset error:', error);
      res.status(500).json({ error: toSafeClientError(error, 'Failed to reset workspace.') });
    }
  });

  // Admin-only Packing Qty update endpoints (never writable by public visitors)
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

  app.patch('/api/records/:id/packing', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { id } = req.params;
      if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'Valid record id is required.' });
        return;
      }
      const parsed = parsePackingQtyInput((req.body as { packingQty?: unknown })?.packingQty);
      if (!parsed.valid) {
        res.status(400).json({
          error: 'Packing Qty must be blank or a non-negative integer up to 10,000,000.',
        });
        return;
      }
      const result = updateRecordsPackingQty([id], parsed.value);
      if (result.updatedCount === 0) {
        res.status(404).json({ error: 'Planning record not found.' });
        return;
      }
      res.json({
        ok: true,
        updatedCount: result.updatedCount,
        updatedAtIso: result.updatedAtIso,
        packingQty: parsed.value,
      });
    } catch (error) {
      console.error('PATCH /api/records/:id/packing error:', error);
      res.status(500).json({ error: toSafeClientError(error, 'Failed to save Packing Qty.') });
    }
  });

  app.patch('/api/packing', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as { recordIds?: unknown; packingQty?: unknown };
      const recordIds = Array.isArray(body.recordIds)
        ? body.recordIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 100)
        : [];
      if (recordIds.length === 0) {
        res.status(400).json({ error: 'Provide at least one planning record ID.' });
        return;
      }
      const parsed = parsePackingQtyInput(body.packingQty);
      if (!parsed.valid) {
        res.status(400).json({
          error: 'Packing Qty must be blank or a non-negative integer up to 10,000,000.',
        });
        return;
      }
      const result = updateRecordsPackingQty(recordIds, parsed.value);
      if (result.updatedCount === 0) {
        res.status(404).json({ error: 'Matching planning records not found.' });
        return;
      }
      res.json({
        ok: true,
        updatedCount: result.updatedCount,
        updatedAtIso: result.updatedAtIso,
        packingQty: parsed.value,
      });
    } catch (error) {
      console.error('PATCH /api/packing error:', error);
      res.status(500).json({ error: toSafeClientError(error, 'Failed to update Packing Qty.') });
    }
  });

  // =========================================================================
  // CONTROL PANEL AUTH & WEBSITE ADMINISTRATION ENDPOINTS
  // =========================================================================
  app.get('/api/admin/status', (req, res) => {
    const isAdmin = isAdminAuthorized(req);
    const siteConfig = getSiteConfig();
    res.json({
      unlocked: isAdmin,
      needsInitialSetup: !isAdminPasswordConfigured(),
      companyName: siteConfig.companyName,
      portalTitle: siteConfig.portalTitle,
      ...(isAdmin
        ? {
            recoveryEmail: siteConfig.recoveryEmail,
            siteConfig,
          }
        : {}),
    });
  });

  app.post('/api/admin/bootstrap', authLimiter, (req, res) => {
    if (isAdminPasswordConfigured()) {
      res.status(403).json({
        ok: false,
        error: 'Admin password is already configured. Please sign in normally.',
      });
      return;
    }

    const body = (req.body || {}) as { password?: string; recoveryEmail?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    const recoveryEmail = typeof body.recoveryEmail === 'string' ? body.recoveryEmail.trim() : '';

    if (password.length < 8) {
      res.status(400).json({
        ok: false,
        error: 'Admin password must be at least 8 characters long.',
      });
      return;
    }
    if (recoveryEmail && !EMAIL_REGEX.test(recoveryEmail)) {
      res.status(400).json({
        ok: false,
        error: 'Please enter a valid recovery email address.',
      });
      return;
    }

    try {
      bootstrapInitialAdminPassword(password, recoveryEmail || undefined);
      const updatedAtIso = getAdminAuthUpdatedAtIso();
      if (!updatedAtIso) {
        res.status(500).json({ ok: false, error: 'Failed to initialize admin session.' });
        return;
      }
      const token = createSignedAdminSessionToken(updatedAtIso);
      setAdminSessionCookie(req, res, token);
      const pub = getPublicWorkspaceState(true);
      res.json({
        ok: true,
        ...pub,
        smtpStatus: getSmtpStatus(),
        adminUnlocked: true,
        adminToken: token,
        recoveryEmail: pub.siteConfig.recoveryEmail,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: toSafeClientError(error, 'Failed to set initial admin password.'),
      });
    }
  });

  const handleAdminUnlock: express.RequestHandler = (req, res) => {
    if (!isAdminPasswordConfigured()) {
      res.status(400).json({
        ok: false,
        needsInitialSetup: true,
        error: 'No Admin password is configured yet. Create the initial Admin password first.',
      });
      return;
    }

    const clientIp = getClientIp(req);
    const lockout = checkLoginLockout(clientIp);
    if (lockout.locked) {
      res.setHeader('Retry-After', String(lockout.retryAfterSec));
      res.status(429).json({
        ok: false,
        error: `Too many failed login attempts. Try again in ${Math.ceil(lockout.retryAfterSec / 60)} minute(s).`,
      });
      return;
    }

    const body = (req.body || {}) as { password?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    if (!verifyAdminPassword(password)) {
      const failure = recordLoginFailure(clientIp);
      if (failure.locked) {
        res.setHeader('Retry-After', String(failure.retryAfterSec));
        res.status(429).json({
          ok: false,
          error: 'Too many failed attempts. Login temporarily locked for 15 minutes.',
        });
        return;
      }
      res.status(401).json({
        ok: false,
        error: `Incorrect Admin password. ${failure.attemptsRemaining} attempt(s) remaining before temporary lockout.`,
      });
      return;
    }

    clearLoginFailures(clientIp);
    const authUpdatedAt = getAdminAuthUpdatedAtIso();
    if (!authUpdatedAt) {
      res.status(500).json({ ok: false, error: 'Admin credential state unavailable.' });
      return;
    }
    const token = createSignedAdminSessionToken(authUpdatedAt);
    setAdminSessionCookie(req, res, token);

    const pub = getPublicWorkspaceState(true);
    res.json({
      ok: true,
      ...pub,
      smtpStatus: getSmtpStatus(),
      adminUnlocked: true,
      adminToken: token,
      recoveryEmail: pub.siteConfig.recoveryEmail,
    });
  };

  app.post('/api/admin/unlock', authLimiter, handleAdminUnlock);
  app.post('/api/admin/login', authLimiter, handleAdminUnlock);

  const handleAdminLock: express.RequestHandler = (req, res) => {
    const token = extractAdminTokenFromRequest(req);
    if (token) {
      revokeAdminSessionToken(token);
    }
    clearAdminSessionCookie(req, res);
    res.json({
      ok: true,
      adminUnlocked: false,
    });
  };

  app.post('/api/admin/lock', handleAdminLock);
  app.post('/api/admin/logout', handleAdminLock);

  app.put('/api/admin/site-config', (req, res) => {
    if (!requireAdmin(req, res)) return;

    const body = req.body as Partial<WebsiteControlConfig>;
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
    if (typeof body.inputStartOffsetDays === 'number' && body.inputStartOffsetDays >= 1 && body.inputStartOffsetDays <= 60) {
      patch.inputStartOffsetDays = Math.round(body.inputStartOffsetDays);
    }
    if (typeof body.upcomingFoOffsetDays === 'number' && body.upcomingFoOffsetDays >= 1 && body.upcomingFoOffsetDays <= 90) {
      patch.upcomingFoOffsetDays = Math.round(body.upcomingFoOffsetDays);
    }
    if (typeof body.cuttingAlertDays === 'number' && body.cuttingAlertDays >= 1 && body.cuttingAlertDays <= 45) {
      patch.cuttingAlertDays = Math.round(body.cuttingAlertDays);
    }
    if (typeof body.recoveryEmail === 'string' && body.recoveryEmail.trim()) {
      const clean = body.recoveryEmail.trim().toLowerCase();
      if (!EMAIL_REGEX.test(clean)) {
        res.status(400).json({ error: 'Invalid verification/recovery email address.' });
        return;
      }
      patch.recoveryEmail = clean;
    }

    const siteConfig = updateSiteConfig(patch);
    res.json({ ok: true, siteConfig });
  });

  app.put('/api/planning-rules', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = (req.body || {}) as Partial<WebsiteControlConfig>;
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
      res.status(400).json({ error: 'Provide at least one valid planning rule offset (days).' });
      return;
    }

    const siteConfig = updateSiteConfig(patch);
    res.json({ ok: true, siteConfig });
  });

  app.post('/api/admin/password/request-code', authLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const siteConfig = getSiteConfig();
    const targetEmail = (
      siteConfig.recoveryEmail ||
      process.env.ADMIN_RECOVERY_EMAIL ||
      ''
    )
      .trim()
      .toLowerCase();
    if (!EMAIL_REGEX.test(targetEmail)) {
      res.status(400).json({
        ok: false,
        message: 'Set a valid Recovery Email in Website Settings before requesting a password reset code.',
      });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString('hex');

    const emailRes = await sendAdminVerificationCodeEmail({
      toEmail: targetEmail,
      code,
      expiresMinutes: 10,
    });

    if (!emailRes.ok) {
      res.status(emailRes.smtpMissing ? 400 : 500).json({
        ok: false,
        smtpMissing: Boolean(emailRes.smtpMissing),
        message: emailRes.message,
      });
      return;
    }

    pendingOtp = {
      codeHash: hashOtp(code, salt),
      salt,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      targetEmail,
    };

    res.json({
      ok: true,
      targetEmail,
      message: emailRes.message,
    });
  });

  app.post('/api/admin/password/change', authLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const body = (req.body || {}) as { code?: string; newPassword?: string };
    const code = (body.code || '').trim();
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!pendingOtp) {
      res.status(400).json({
        ok: false,
        error: 'Please request a verification code to your email first.',
      });
      return;
    }

    if (Date.now() > pendingOtp.expiresAt) {
      pendingOtp = null;
      res.status(400).json({
        ok: false,
        error: 'Verification code expired. Please send a new code.',
      });
      return;
    }

    if (pendingOtp.attempts >= 5) {
      pendingOtp = null;
      res.status(429).json({
        ok: false,
        error: 'Too many invalid code attempts. Please request a fresh verification code.',
      });
      return;
    }

    const computed = hashOtp(code, pendingOtp.salt);
    const matches = crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(pendingOtp.codeHash, 'hex')
    );

    if (!matches) {
      pendingOtp.attempts += 1;
      res.status(400).json({
        ok: false,
        error: 'Invalid 6-digit verification code. Please check your email and try again.',
      });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        error: 'New password must be at least 8 characters long.',
      });
      return;
    }

    const notifyEmail = pendingOtp.targetEmail;
    pendingOtp = null;
    updateAdminPassword(newPassword);

    // Issue fresh signed session cookie matching updated password version
    const updatedAt = getAdminAuthUpdatedAtIso();
    let freshToken: string | undefined;
    if (updatedAt) {
      freshToken = createSignedAdminSessionToken(updatedAt);
      setAdminSessionCookie(req, res, freshToken);
    }

    await sendPasswordChangedNoticeEmail(notifyEmail);

    res.json({
      ok: true,
      adminToken: freshToken,
      message: `Control Panel password updated successfully. Confirmation sent to ${notifyEmail}.`,
    });
  });

  app.get('/api/admin/backup', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const pub = getPublicWorkspaceState(true);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Alex_Apparels_Control_Tower_Backup_${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(pub, null, 2));
  });

  app.post('/api/admin/restore', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
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
        res.status(400).json({ error: 'Invalid backup snapshot: missing or oversized records.' });
        return;
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
        res.status(400).json({ error: 'Invalid backup snapshot: malformed planning record structure.' });
        return;
      }

      restoreWorkspaceSnapshot({
        meta: body.meta,
        records: body.records,
        cuttingEntries: body.cuttingEntries,
        referenceDateIso: body.referenceDateIso,
        reminders: body.reminders as Partial<ReminderWorkspaceState>,
        siteConfig: body.siteConfig,
        cuttingSheetSync: body.cuttingSheetSync,
      });
      const pub = getPublicWorkspaceState(true);
      res.json({
        ok: true,
        ...pub,
        smtpStatus: getSmtpStatus(),
        adminUnlocked: true,
      });
    } catch (error) {
      console.error('POST /api/admin/restore error:', error);
      res.status(500).json({
        error: toSafeClientError(error, 'Failed to restore backup snapshot.'),
      });
    }
  });

  // =========================================================================
  // EMAIL REMINDERS & HOSTING SMTP ENDPOINTS
  // =========================================================================
  app.get('/api/reminders', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const pub = getPublicWorkspaceState(true);
    res.json({
      reminders: pub.reminders,
      smtpStatus: getSmtpStatus(),
      appUrl: getAppPublicUrl(req),
    });
  });

  app.put('/api/reminders/smtp', (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
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
        res.status(400).json({ error: 'Hosting email / SMTP username is required.' });
        return;
      }

      let host = (body.host || '').trim();
      if (!host) {
        if (providerPreset === 'gmail' || user.toLowerCase().endsWith('@gmail.com')) {
          host = 'smtp.gmail.com';
        } else if (providerPreset === 'outlook') {
          host = 'smtp.office365.com';
        } else {
          res.status(400).json({ error: 'SMTP host server is required (e.g. mail.yourdomain.com).' });
          return;
        }
      }

      const port = Number(body.port) || (host === 'smtp.gmail.com' ? 465 : 587);
      const secure = typeof body.secure === 'boolean' ? body.secure : port === 465;

      const existingStored = getStoredSmtpConfig();
      const incomingPass = typeof body.pass === 'string' ? body.pass : '';
      const resolvedPass = incomingPass.trim()
        ? incomingPass
        : existingStored?.pass || '';

      if (!resolvedPass) {
        res.status(400).json({
          error: 'Hosting email password or App Password is required.',
        });
        return;
      }

      const fromEmail = (body.fromEmail || user).trim();
      if (fromEmail && !EMAIL_REGEX.test(fromEmail)) {
        res.status(400).json({ error: 'Please enter a valid Sender / From email address.' });
        return;
      }

      const fromName = (body.fromName || 'Alex Apparels Planning').trim();

      saveStoredSmtpConfig({
        providerPreset,
        host,
        port,
        secure,
        user,
        pass: resolvedPass,
        fromName,
        fromEmail,
      });

      res.json({
        ok: true,
        smtpStatus: getSmtpStatus(),
      });
    } catch (error) {
      console.error('PUT /api/reminders/smtp error:', error);
      res.status(500).json({
        error: toSafeClientError(error, 'Failed to save hosting email settings.'),
      });
    }
  });

  app.post('/api/reminders/smtp/verify', emailLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = await verifySmtpConnection();
    res.json({
      ...result,
      smtpStatus: getSmtpStatus(),
    });
  });

  app.post('/api/reminders/smtp/test-email', emailLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = (req.body || {}) as { toEmail?: string };
    const status = getSmtpStatus();
    const siteConfig = getSiteConfig();
    const targetEmail = (body.toEmail || status.user || siteConfig.recoveryEmail || '').trim();
    if (!EMAIL_REGEX.test(targetEmail)) {
      res.status(400).json({
        ok: false,
        message: 'Please provide a valid email address for the test email.',
      });
      return;
    }
    const result = await sendTestEmail(targetEmail);
    res.json({
      ...result,
      smtpStatus: getSmtpStatus(),
    });
  });

  app.delete('/api/reminders/smtp', (req, res) => {
    if (!requireAdmin(req, res)) return;
    saveStoredSmtpConfig(null);
    res.json({
      ok: true,
      smtpStatus: getSmtpStatus(),
    });
  });

  app.put('/api/reminders/schedule', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body as Partial<ReminderScheduleConfig>;
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

    const reminders = updateReminderSchedule(patch);
    res.json({ reminders, smtpStatus: getSmtpStatus() });
  });

  app.post('/api/reminders/recipients', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = req.body as {
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
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }

    const state = getWorkspaceState();
    const existing = state.reminders.recipients;
    if (existing.some((r) => r.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'This email address is already in the reminder list.' });
      return;
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

    const reminders = addReminderRecipient(recipient);
    res.status(201).json({ recipient, reminders });
  });

  app.patch('/api/reminders/recipients/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const body = req.body as Partial<ReminderRecipient>;
    const patch: Partial<ReminderRecipient> = {};

    if (typeof body.email === 'string') {
      const cleanEmail = body.email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        res.status(400).json({ error: 'Please provide a valid email address.' });
        return;
      }
      const duplicate = getWorkspaceState().reminders.recipients.some(
        (r) => r.id !== id && r.email.toLowerCase() === cleanEmail
      );
      if (duplicate) {
        res.status(409).json({ error: 'Another recipient already uses this email address.' });
        return;
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

    const reminders = updateReminderRecipient(id, patch);
    res.json({ reminders });
  });

  app.delete('/api/reminders/recipients/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const reminders = deleteReminderRecipient(id);
    res.json({ reminders });
  });

  app.post('/api/reminders/send-now', emailLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as {
        recipientId?: string;
        alertScope?: ReminderAlertScope;
        referenceDateIso?: string;
        customMessage?: string;
      };

      const state = getWorkspaceState();
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

      const result = await sendShortcutReminderEmails({
        recipients: targetRecipients.map((r) => ({ ...r, active: true })),
        meta: state.meta,
        records: state.records,
        cuttingEntries: state.cuttingEntries,
        referenceDateIso,
        alertScope,
        customMessage,
        triggerType: 'Manual Send',
        appUrl: getAppPublicUrl(req),
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });

      const updatedState = getWorkspaceState();
      res.json({
        ok: result.ok,
        log: result.log,
        reminders: updatedState.reminders,
        smtpStatus: getSmtpStatus(),
      });
    } catch (error) {
      console.error('POST /api/reminders/send-now error:', error);
      res.status(500).json({
        error: toSafeClientError(error, 'Failed to send reminder email.'),
      });
    }
  });

  app.post('/api/saved-fo/send-email', emailLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as {
        toEmails?: string[] | string;
        subject?: string;
        bodyText?: string;
        selectedRecordIds?: string[];
        attachXlsx?: boolean;
        referenceDateIso?: string;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
      };

      const state = getWorkspaceState();
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

      const result = await sendSavedUpcomingFoEmail({
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
        appUrl: getAppPublicUrl(req),
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });

      const updatedState = getWorkspaceState();
      res.status(result.ok ? 200 : 400).json({
        ok: result.ok,
        message: result.message,
        log: result.log,
        reminders: updatedState.reminders,
      });
    } catch (error) {
      console.error('POST /api/saved-fo/send-email error:', error);
      const safe = toSafeClientError(error, 'Failed to send Saved Upcoming FO email.');
      res.status(500).json({ ok: false, message: safe, error: safe });
    }
  });

  // =========================================================================
  // ONLINE CUTTING SHEET AUTO-SYNC ENDPOINTS
  // =========================================================================
  app.get('/api/cutting-sheet', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const pub = getPublicWorkspaceState(true);
    res.json({
      cuttingSheetSync: pub.cuttingSheetSync,
    });
  });

  app.put('/api/cutting-sheet/config', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as Partial<{
        enabled: boolean;
        sheetUrl: string;
        factoryUrls: FactorySheetUrlMap;
        syncMode: CuttingSheetSyncMode;
        intervalMinutes: number;
      }>;

      const patch: Partial<
        Pick<
          CuttingSheetSyncConfig,
          'enabled' | 'sheetUrl' | 'factoryUrls' | 'syncMode' | 'intervalMinutes' | 'lastContentHash'
        >
      > = {};

      const currentCfg = getWorkspaceState().cuttingSheetSync;

      if (typeof body.enabled === 'boolean') {
        patch.enabled = body.enabled;
      }
      if (typeof body.sheetUrl === 'string') {
        const cleanUrl = body.sheetUrl.trim();
        if (cleanUrl) {
          await assertSafeExternalUrl(cleanUrl);
        }
        patch.sheetUrl = cleanUrl;
        if (cleanUrl !== (currentCfg.sheetUrl || '').trim()) {
          patch.lastContentHash = '';
        }
      }
      if (body.factoryUrls && typeof body.factoryUrls === 'object') {
        const cleanFactoryUrls: FactorySheetUrlMap = {};
        let urlsChanged = false;
        for (const fac of ALLOWED_FACTORIES) {
          const val = body.factoryUrls[fac];
          const clean = typeof val === 'string' ? val.trim() : '';
          if (clean) {
            await assertSafeExternalUrl(clean);
            cleanFactoryUrls[fac] = clean;
          }
          if (clean !== ((currentCfg.factoryUrls || {})[fac] || '').trim()) {
            urlsChanged = true;
          }
        }
        patch.factoryUrls = cleanFactoryUrls;
        if (urlsChanged) {
          patch.lastContentHash = '';
        }
      }
      if (
        body.syncMode === 'auto' ||
        body.syncMode === 'daily_rows' ||
        body.syncMode === 'cumulative_pg'
      ) {
        patch.syncMode = body.syncMode;
        if (body.syncMode !== currentCfg.syncMode) {
          patch.lastContentHash = '';
        }
      }
      if (typeof body.intervalMinutes === 'number' && Number.isFinite(body.intervalMinutes)) {
        patch.intervalMinutes = Math.min(1440, Math.max(1, Math.round(body.intervalMinutes)));
      }

      const cuttingSheetSync = updateCuttingSheetSyncConfig(patch);
      res.json({ ok: true, cuttingSheetSync });
    } catch (error) {
      console.error('PUT /api/cutting-sheet/config error:', error);
      res.status(400).json({
        error: toSafeClientError(error, 'Failed to save cutting sheet configuration.'),
      });
    }
  });

  app.post('/api/cutting-sheet/sync', uploadSyncLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await runCuttingSheetSync({ trigger: 'Manual', force: true });
      res.json({
        ok: result.ok,
        updated: result.updated,
        message: result.message,
        records: result.records,
        cuttingEntries: result.cuttingEntries,
        cuttingSheetSync: result.cuttingSheetSync,
      });
    } catch (error) {
      console.error('POST /api/cutting-sheet/sync error:', error);
      const safe = toSafeClientError(error, 'Failed to sync online cutting sheet.');
      res.status(500).json({ ok: false, message: safe, error: safe });
    }
  });

  app.post('/api/cutting-sheet/upload', uploadSyncLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as {
        fileName?: string;
        base64?: string;
        csvText?: string;
        factory?: FactoryName;
      };
      const fileName = (body.fileName || 'cutting-sheet.xlsx').trim();
      const hasBase64 = typeof body.base64 === 'string' && body.base64.length > 0;
      const hasCsv = typeof body.csvText === 'string' && body.csvText.length > 0;
      if (!hasBase64 && !hasCsv) {
        res.status(400).json({ ok: false, error: 'Please select an .xlsx or .csv file to upload.' });
        return;
      }

      let buffer: Buffer | undefined;
      if (hasBase64) {
        const validated = validateBase64Upload({
          base64: body.base64!,
          fileName,
          allowedExtensions: ['xlsx', 'xlsm', 'csv'],
          maxBytes: MAX_UPLOAD_BYTES,
        });
        buffer = validated.buffer;
      } else if (hasCsv) {
        if (!fileName.toLowerCase().endsWith('.csv')) {
          res.status(400).json({ ok: false, error: 'Unsupported CSV upload filename.' });
          return;
        }
        if (Buffer.byteLength(body.csvText!, 'utf8') > MAX_UPLOAD_BYTES) {
          res.status(400).json({ ok: false, error: 'Uploaded CSV exceeds the 15 MB size limit.' });
          return;
        }
      }

      const defaultFactory =
        body.factory && ALLOWED_FACTORIES.includes(body.factory)
          ? body.factory
          : detectFactoryHintFromText(fileName);

      const result = await importCuttingFileBuffer({
        fileName,
        buffer,
        csvText: body.csvText,
        defaultFactory,
      });

      res.json({
        ok: result.ok,
        message: result.message,
        records: result.records,
        cuttingEntries: result.cuttingEntries,
        cuttingSheetSync: result.cuttingSheetSync,
      });
    } catch (error) {
      console.error('POST /api/cutting-sheet/upload error:', error);
      const safe = toSafeClientError(error, 'Failed to import uploaded cutting file.');
      res.status(400).json({ ok: false, message: safe, error: safe });
    }
  });

  app.get('/api/export-xlsx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const state = getWorkspaceState();
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
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="Alex_Apparels_Cluster1_Planning_Dashboard.xlsx"'
      );
      res.send(buffer);
    } catch (error) {
      console.error('Export workbook GET failed:', error);
      res.status(500).json({ error: toSafeClientError(error, 'Failed to build Excel workbook.') });
    }
  });

  app.post('/api/export-xlsx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
      };

      const state = getWorkspaceState();
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
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="Alex_Apparels_Cluster1_Planning_Dashboard.xlsx"'
      );
      res.send(buffer);
    } catch (error) {
      console.error('Export workbook POST failed:', error);
      res.status(500).json({ error: toSafeClientError(error, 'Failed to export Excel workbook.') });
    }
  });

  app.get('/api/export-selected-fo-xlsx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const state = getWorkspaceState();
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
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Selected_Upcoming_FO_List_${referenceDateIso}.xlsx"`
      );
      res.send(buffer);
    } catch (error) {
      console.error('Export selected FO workbook GET failed:', error);
      res
        .status(500)
        .json({ error: toSafeClientError(error, 'Failed to build selected FO Excel file.') });
    }
  });

  app.post('/api/export-selected-fo-xlsx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
        meta?: MasterPlanMeta;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        referenceDateIso?: string;
        selectedRecordIds?: string[];
      };

      const state = getWorkspaceState();
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
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="Selected_Upcoming_FO_List_${referenceDateIso}.xlsx"`
      );
      res.send(buffer);
    } catch (error) {
      console.error('Export selected FO workbook POST failed:', error);
      res
        .status(500)
        .json({ error: toSafeClientError(error, 'Failed to build selected FO Excel file.') });
    }
  });

  app.post('/api/export-selected-fo-summary-xlsx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
        masterPlanAsOf?: unknown;
        referenceDateIso?: unknown;
        rows?: unknown;
      };

      const state = getWorkspaceState();
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

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="ALEX_FO_Needed_Checklist_${rawRef}.xlsx"`
      );
      res.send(buffer);
    } catch (error) {
      console.error('Export selected FO summary box POST failed:', error);
      res
        .status(500)
        .json({ error: toSafeClientError(error, 'Failed to export summary Excel file.') });
    }
  });

  app.post('/api/assistant/chat', assistantLimiter, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const body = req.body as {
        message?: string;
        history?: ShehreenHistoryTurn[];
        currentTab?: string;
        selectedFactory?: string;
        selectedLine?: string;
      };

      const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';
      if (!rawMessage) {
        res.status(400).json({ ok: false, error: 'Please type a question for Shehreen.' });
        return;
      }
      const message = rawMessage.slice(0, 4000);

      const result = await askShehreenAssistant({
        message,
        history: Array.isArray(body?.history) ? body.history.slice(-12) : [],
        currentTab: typeof body?.currentTab === 'string' ? body.currentTab : undefined,
        selectedFactory:
          typeof body?.selectedFactory === 'string' ? body.selectedFactory : undefined,
        selectedLine: typeof body?.selectedLine === 'string' ? body.selectedLine : undefined,
      });

      res.json({ ok: true, ...result });
    } catch (error) {
      console.error('POST /api/assistant/chat error:', error);
      const rawMsg =
        error instanceof Error ? error.message : 'Shehreen AI request failed.';
      const msgLower = rawMsg.toLowerCase();
      const friendlyError =
        msgLower.includes('api_key') ||
        msgLower.includes('permission_denied') ||
        msgLower.includes('api key') ||
        msgLower.includes('gemini_api_key')
          ? 'AI service configuration issue. Please verify GEMINI_API_KEY on the server.'
          : msgLower.includes('resource_exhausted') || msgLower.includes('429')
            ? 'AI request quota reached. Please try again shortly.'
            : toSafeClientError(error, 'Shehreen AI request failed. Please try again.');
      res.status(500).json({ ok: false, error: friendlyError });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      plugins: hmrDisabled
        ? [
            {
              name: 'disable-hmr-client-ws',
              enforce: 'post',
              transform(code, id) {
                if (
                  id.includes('/vite/dist/client/client.mjs') ||
                  code.includes('transport.connect(createHMRHandler(handleMessage))')
                ) {
                  return code.replace(
                    'transport.connect(createHMRHandler(handleMessage));',
                    '/* HMR WebSocket disabled via DISABLE_HMR=true */'
                  );
                }
                return null;
              },
            },
          ]
        : [],
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use('/Cluster-1-Planning-FO-Control-Tower', express.static(distPath));
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  let schedulerRunning = false;
  const runScheduledReminderCheck = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const state = getWorkspaceState();
      const { schedule, recipients } = state.reminders;
      if (!schedule.enabled) return;

      const activeRecipients = recipients.filter((r) => r.active);
      if (activeRecipients.length === 0) return;

      const { dateLocal, timeLocal, dayOfWeek, dayOfMonth, daysInMonth } =
        getZonedDateTime(schedule.timezone);

      const dueRecipients = activeRecipients.filter((r) => {
        if (r.lastSentDateLocal === dateLocal) return false;
        const targetTime =
          typeof r.sendTime === 'string' && /^\d{2}:\d{2}$/.test(r.sendTime)
            ? r.sendTime
            : schedule.dailySendTime;
        if (timeLocal < targetTime) return false;

        if (r.frequency === 'weekly') {
          return dayOfWeek === (r.dayOfWeek ?? 1);
        }
        if (r.frequency === 'monthly') {
          const targetDay = Math.min(Math.max(1, r.dayOfMonth ?? 1), daysInMonth);
          return dayOfMonth === targetDay;
        }
        return true; // daily
      });

      if (dueRecipients.length === 0) return;

      // Mark attempt timestamp and dispatch person-to-person
      updateReminderSchedule({
        lastAttemptIso: new Date().toISOString(),
      });

      const result = await sendShortcutReminderEmails({
        recipients: dueRecipients,
        meta: state.meta,
        records: state.records,
        cuttingEntries: state.cuttingEntries,
        referenceDateIso: dateLocal,
        alertScope: schedule.alertScope,
        customMessage: schedule.customMessage,
        triggerType: 'Automatic Scheduled',
        appUrl: getAppPublicUrl(),
        ruleOptions: {
          inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
          upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
          cuttingAlertDays: state.siteConfig.cuttingAlertDays,
        },
      });

      for (const rid of result.succeededRecipientIds) {
        updateReminderRecipient(rid, { lastSentDateLocal: dateLocal });
      }
      if (result.succeededRecipientIds.length > 0) {
        updateReminderSchedule({ lastSentDateLocal: dateLocal });
      }
    } catch (err) {
      console.error('Scheduled reminder check error:', err);
    } finally {
      schedulerRunning = false;
    }
  };

  setInterval(runScheduledReminderCheck, 30_000);

  let cuttingSyncRunning = false;
  const runScheduledCuttingSheetCheck = async () => {
    if (cuttingSyncRunning) return;
    cuttingSyncRunning = true;
    try {
      const cfg = getWorkspaceState().cuttingSheetSync;
      if (!cfg.enabled) return;
      const hasUrl =
        Boolean(cfg.sheetUrl.trim()) ||
        Object.values(cfg.factoryUrls || {}).some((v) => typeof v === 'string' && Boolean(v.trim()));
      if (!hasUrl) return;

      const intervalMs = Math.max(1, cfg.intervalMinutes || 5) * 60_000;
      const elapsedMs = cfg.lastCheckedAtIso
        ? Date.now() - Date.parse(cfg.lastCheckedAtIso)
        : Infinity;
      if (Number.isFinite(elapsedMs) && elapsedMs < intervalMs) return;

      await runCuttingSheetSync({ trigger: 'Auto', force: false });
    } catch (err) {
      console.error('Scheduled cutting sheet auto-sync error:', err);
    } finally {
      cuttingSyncRunning = false;
    }
  };

  setInterval(runScheduledCuttingSheetCheck, 30_000);

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Planning Control Tower server listening on port ${port}`);
  });
}

startServer();
