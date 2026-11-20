import 'dotenv/config';
import crypto from 'crypto';
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
  ReminderAlertScope,
  ReminderRecipient,
  ReminderScheduleConfig,
  SmtpProviderPreset,
} from './src/shared/reminderTypes.ts';
import type { WebsiteControlConfig } from './src/shared/controlPanelTypes.ts';
import { buildPlanningWorkbookBuffer } from './src/server/xlsxBuilder.ts';
import {
  addReminderRecipient,
  deleteReminderRecipient,
  getPublicWorkspaceState,
  getSiteConfig,
  getStoredSmtpConfig,
  getWorkspaceState,
  resetPlanningWorkspace,
  saveStoredSmtpConfig,
  updateAdminPassword,
  updatePlanningWorkspace,
  updateReminderRecipient,
  updateReminderSchedule,
  updateSiteConfig,
  verifyAdminPassword,
} from './src/server/workspaceStore.ts';
import {
  getSmtpStatus,
  sendAdminVerificationCodeEmail,
  sendPasswordChangedNoticeEmail,
  sendShortcutReminderEmails,
  verifySmtpConnection,
} from './src/server/emailService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

interface PendingPasswordOtp {
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  targetEmail: string;
}

const adminSessions = new Map<string, number>();
let pendingOtp: PendingPasswordOtp | null = null;

function isAdminTokenValid(token: string | undefined | null): boolean {
  if (!token) return false;
  const expiry = adminSessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

function getAdminTokenFromReq(req: express.Request): string | undefined {
  const header = req.headers['x-admin-token'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return undefined;
}

function isAdminAuthorized(req: express.Request): boolean {
  return isAdminTokenValid(getAdminTokenFromReq(req));
}

function hashOtp(code: string, salt: string): string {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

function getZonedDateTime(timeZone: string): { dateLocal: string; timeLocal: string } {
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
    const hour = get('hour') === '24' ? '00' : get('hour');
    return {
      dateLocal: `${get('year')}-${get('month')}-${get('day')}`,
      timeLocal: `${hour}:${get('minute')}`,
    };
  } catch {
    const iso = new Date().toISOString();
    return {
      dateLocal: iso.slice(0, 10),
      timeLocal: iso.slice(11, 16),
    };
  }
}

function getAppPublicUrl(req?: express.Request): string {
  const envUrl = (process.env.APP_URL || '').trim();
  if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
    return envUrl;
  }
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) {
      return `${proto}://${host}`;
    }
  }
  return '';
}

function ensureEditableOrAdmin(req: express.Request, res: express.Response): boolean {
  const siteConfig = getSiteConfig();
  if (siteConfig.readOnlyPublicMode && !isAdminAuthorized(req)) {
    res.status(403).json({
      error: 'Website is in Admin Read-Only mode. Unlock the Control Panel to make changes.',
    });
    return false;
  }
  return true;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  getWorkspaceState();

  app.get('/api/health', (_req, res) => {
    const state = getWorkspaceState();
    res.json({
      ok: true,
      totalLines: state.meta.totalLines,
      totalRecords: state.records.length,
      smtpConfigured: getSmtpStatus().configured,
    });
  });

  app.get('/api/master-plan', (_req, res) => {
    try {
      const state = getWorkspaceState();
      res.json({ meta: state.meta, records: state.records });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load master plan';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/workspace', (req, res) => {
    try {
      const pub = getPublicWorkspaceState();
      res.json({
        ...pub,
        smtpStatus: getSmtpStatus(),
        appUrl: getAppPublicUrl(req),
        adminUnlocked: isAdminAuthorized(req),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load workspace';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
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
      const message = error instanceof Error ? error.message : 'Failed to save workspace';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/workspace/reset', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
    try {
      resetPlanningWorkspace();
      const pub = getPublicWorkspaceState();
      res.json({
        ...pub,
        smtpStatus: getSmtpStatus(),
        adminUnlocked: isAdminAuthorized(req),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset workspace';
      res.status(500).json({ error: message });
    }
  });

  // =========================================================================
  // CONTROL PANEL AUTH & WEBSITE ADMINISTRATION ENDPOINTS
  // =========================================================================
  app.get('/api/admin/status', (req, res) => {
    const siteConfig = getSiteConfig();
    res.json({
      unlocked: isAdminAuthorized(req),
      recoveryEmail: siteConfig.recoveryEmail,
      siteConfig,
    });
  });

  app.post('/api/admin/unlock', (req, res) => {
    const body = (req.body || {}) as { password?: string };
    const password = typeof body.password === 'string' ? body.password : '';
    if (!verifyAdminPassword(password)) {
      res.status(401).json({ ok: false, error: 'Incorrect Control Panel password.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
    const siteConfig = getSiteConfig();
    res.json({
      ok: true,
      token,
      siteConfig,
      recoveryEmail: siteConfig.recoveryEmail,
    });
  });

  app.post('/api/admin/lock', (req, res) => {
    const token = getAdminTokenFromReq(req);
    if (token) {
      adminSessions.delete(token);
    }
    res.json({ ok: true });
  });

  app.put('/api/admin/site-config', (req, res) => {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: 'Control Panel authentication required.' });
      return;
    }

    const body = req.body as Partial<WebsiteControlConfig>;
    const patch: Partial<WebsiteControlConfig> = {};

    if (typeof body.companyName === 'string' && body.companyName.trim()) {
      patch.companyName = body.companyName.trim();
    }
    if (typeof body.portalTitle === 'string' && body.portalTitle.trim()) {
      patch.portalTitle = body.portalTitle.trim();
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

  app.post('/api/admin/password/request-code', async (req, res) => {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'Control Panel authentication required.' });
      return;
    }

    const siteConfig = getSiteConfig();
    const targetEmail = (siteConfig.recoveryEmail || 'shakhawat.global@gmail.com').trim();
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

  app.post('/api/admin/password/change', async (req, res) => {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'Control Panel authentication required.' });
      return;
    }

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

    if (newPassword.length < 6) {
      res.status(400).json({
        ok: false,
        error: 'New password must be at least 6 characters long.',
      });
      return;
    }

    const notifyEmail = pendingOtp.targetEmail;
    pendingOtp = null;
    updateAdminPassword(newPassword);
    await sendPasswordChangedNoticeEmail(notifyEmail);

    res.json({
      ok: true,
      message: `Control Panel password updated successfully. Confirmation sent to ${notifyEmail}.`,
    });
  });

  app.get('/api/admin/backup', (req, res) => {
    if (!isAdminAuthorized(req)) {
      res.status(401).json({ error: 'Control Panel authentication required.' });
      return;
    }
    const pub = getPublicWorkspaceState();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Alex_Apparels_Control_Tower_Backup_${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(JSON.stringify(pub, null, 2));
  });

  // =========================================================================
  // EMAIL REMINDERS & HOSTING SMTP ENDPOINTS
  // =========================================================================
  app.get('/api/reminders', (req, res) => {
    const state = getWorkspaceState();
    res.json({
      reminders: state.reminders,
      smtpStatus: getSmtpStatus(),
      appUrl: getAppPublicUrl(req),
    });
  });

  app.put('/api/reminders/smtp', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
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
      const message = error instanceof Error ? error.message : 'Failed to save hosting email settings';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/reminders/smtp/verify', async (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
    const result = await verifySmtpConnection();
    res.json({
      ...result,
      smtpStatus: getSmtpStatus(),
    });
  });

  app.delete('/api/reminders/smtp', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
    saveStoredSmtpConfig(null);
    res.json({
      ok: true,
      smtpStatus: getSmtpStatus(),
    });
  });

  app.put('/api/reminders/schedule', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
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

    const reminders = updateReminderSchedule(patch);
    res.json({ reminders, smtpStatus: getSmtpStatus() });
  });

  app.post('/api/reminders/recipients', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
    const body = req.body as {
      name?: string;
      email?: string;
      role?: string;
      factories?: FactoryName[];
    };

    const email = (body?.email || '').trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }

    const existing = getWorkspaceState().reminders.recipients;
    if (existing.some((r) => r.email.toLowerCase() === email)) {
      res.status(409).json({ error: 'This email address is already in the reminder list.' });
      return;
    }

    const validFactories = Array.isArray(body.factories)
      ? body.factories.filter((f) => ALLOWED_FACTORIES.includes(f))
      : [];

    const recipient: ReminderRecipient = {
      id: `RECIP-${Date.now().toString(36).toUpperCase()}`,
      name: (body.name || '').trim() || email.split('@')[0],
      email,
      role: (body.role || '').trim() || 'Merchandising / Planning',
      factories: validFactories,
      active: true,
      addedAtIso: new Date().toISOString(),
    };

    const reminders = addReminderRecipient(recipient);
    res.status(201).json({ recipient, reminders });
  });

  app.patch('/api/reminders/recipients/:id', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
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

    const reminders = updateReminderRecipient(id, patch);
    res.json({ reminders });
  });

  app.delete('/api/reminders/recipients/:id', (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
    const { id } = req.params;
    const reminders = deleteReminderRecipient(id);
    res.json({ reminders });
  });

  app.post('/api/reminders/send-now', async (req, res) => {
    if (!ensureEditableOrAdmin(req, res)) return;
    try {
      const body = (req.body || {}) as {
        recipientId?: string;
        alertScope?: ReminderAlertScope;
        referenceDateIso?: string;
      };

      const state = getWorkspaceState();
      const targetRecipients = body.recipientId
        ? state.reminders.recipients.filter((r) => r.id === body.recipientId)
        : state.reminders.recipients.filter((r) => r.active);

      const alertScope = body.alertScope || state.reminders.schedule.alertScope;
      const referenceDateIso =
        body.referenceDateIso || state.referenceDateIso || new Date().toISOString().slice(0, 10);

      const result = await sendShortcutReminderEmails({
        recipients: targetRecipients.map((r) => ({ ...r, active: true })),
        meta: state.meta,
        records: state.records,
        cuttingEntries: state.cuttingEntries,
        referenceDateIso,
        alertScope,
        triggerType: 'Manual Send',
        appUrl: getAppPublicUrl(req),
      });

      const updatedState = getWorkspaceState();
      res.json({
        ok: result.ok,
        log: result.log,
        reminders: updatedState.reminders,
        smtpStatus: getSmtpStatus(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send reminder email';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/export-xlsx', async (_req, res) => {
    try {
      const state = getWorkspaceState();
      const buffer = await buildPlanningWorkbookBuffer(
        state.meta,
        state.records,
        state.referenceDateIso || new Date().toISOString().slice(0, 10),
        state.cuttingEntries
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
      const message = error instanceof Error ? error.message : 'Failed to build Excel workbook';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/export-xlsx', async (req, res) => {
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
        cuttingEntries
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
      const message = error instanceof Error ? error.message : 'Failed to export Excel workbook';
      res.status(500).json({ error: message });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  let schedulerRunning = false;
  const runDailyReminderCheck = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const state = getWorkspaceState();
      const { schedule, recipients } = state.reminders;
      if (!schedule.enabled) return;

      const activeRecipients = recipients.filter((r) => r.active);
      if (activeRecipients.length === 0) return;

      const { dateLocal, timeLocal } = getZonedDateTime(schedule.timezone);
      if (schedule.lastSentDateLocal === dateLocal) return;
      if (timeLocal < schedule.dailySendTime) return;

      updateReminderSchedule({
        lastSentDateLocal: dateLocal,
        lastAttemptIso: new Date().toISOString(),
      });

      await sendShortcutReminderEmails({
        recipients: activeRecipients,
        meta: state.meta,
        records: state.records,
        cuttingEntries: state.cuttingEntries,
        referenceDateIso: dateLocal,
        alertScope: schedule.alertScope,
        triggerType: 'Automatic Daily',
        appUrl: getAppPublicUrl(),
      });
    } catch (err) {
      console.error('Daily reminder scheduler error:', err);
    } finally {
      schedulerRunning = false;
    }
  };

  setInterval(runDailyReminderCheck, 30_000);

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Planning Control Tower server listening on port ${port}`);
  });
}

startServer();
