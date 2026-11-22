import nodemailer from 'nodemailer';
import {
  ALLOWED_FACTORIES,
  addDaysIso,
  buildLineShortcutSummaries,
  diffDaysIso,
  evaluatePlanningRecords,
  formatDisplayDate,
  getEffectiveIssueQty,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  EvaluatedPlanningRecord,
  MasterPlanMeta,
  PlanningRecord,
  PlanningRuleOptions,
} from '../shared/plannerTypes.ts';
import { buildShortcutEmailDigest } from '../shared/reminderDigest.ts';
import {
  DEFAULT_SAVED_FO_EMAIL_BODY,
  EMAIL_REGEX,
  buildDefaultSavedFoEmailSubject,
} from '../shared/reminderTypes.ts';
import type {
  ReminderAlertScope,
  ReminderDeliveryLog,
  ReminderRecipient,
  SmtpProviderPreset,
  SmtpSettingsPublic,
} from '../shared/reminderTypes.ts';
import { appendReminderDeliveryLog, getStoredSmtpConfig } from './workspaceStore.ts';
import {
  buildPlanningWorkbookBuffer,
  buildSelectedUpcomingFoWorkbookBuffer,
} from './xlsxBuilder.ts';

interface ResolvedSmtpConfig {
  source: 'workspace' | 'env';
  providerPreset: SmtpProviderPreset;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  fromHeader: string;
  replyTo?: string;
}

function inferPresetFromHost(host: string, user: string): SmtpProviderPreset {
  const h = host.toLowerCase();
  const u = user.toLowerCase();
  if (h.includes('gmail') || u.endsWith('@gmail.com')) return 'gmail';
  if (h.includes('outlook') || h.includes('office365')) return 'outlook';
  return 'custom';
}

function normalizeSenderHeaders(params: {
  preset: SmtpProviderPreset;
  host: string;
  user: string;
  fromName: string;
  fromEmail: string;
}): { fromEmail: string; fromHeader: string; replyTo?: string } {
  const { preset, host, user, fromName, fromEmail } = params;
  const isGmail =
    preset === 'gmail' ||
    host.toLowerCase().includes('gmail') ||
    user.toLowerCase().endsWith('@gmail.com');

  // Gmail silently rejects or flags mail if From header mismatches authenticated SMTP user.
  const effectiveFromEmail = isGmail ? user : fromEmail || user;
  const cleanName = fromName.replace(/"/g, '').trim() || 'Alex Apparels Planning';
  const fromHeader = `"${cleanName}" <${effectiveFromEmail}>`;
  const replyTo =
    fromEmail && fromEmail.toLowerCase() !== effectiveFromEmail.toLowerCase()
      ? fromEmail
      : undefined;

  return { fromEmail: effectiveFromEmail, fromHeader, replyTo };
}

function buildTransporter(smtp: ResolvedSmtpConfig) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
}

function resolveEnvSmtpConfig(): ResolvedSmtpConfig | null {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  if (!user || !pass) {
    return null;
  }

  let host = (process.env.SMTP_HOST || '').trim();
  if (!host) {
    if (user.toLowerCase().endsWith('@gmail.com')) {
      host = 'smtp.gmail.com';
    } else if (
      user.toLowerCase().endsWith('@outlook.com') ||
      user.toLowerCase().endsWith('@hotmail.com')
    ) {
      host = 'smtp.office365.com';
    } else {
      return null;
    }
  }

  const port = Number(process.env.SMTP_PORT) || (host === 'smtp.gmail.com' ? 465 : 587);
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;

  const preset = inferPresetFromHost(host, user);
  const fromName = 'Alex Apparels Planning';
  const { fromEmail, fromHeader, replyTo } = normalizeSenderHeaders({
    preset,
    host,
    user,
    fromName,
    fromEmail: user,
  });

  return {
    source: 'env',
    providerPreset: preset,
    host,
    port,
    secure,
    user,
    pass,
    fromName,
    fromEmail,
    fromHeader,
    replyTo,
  };
}

function resolveSmtpConfig(): ResolvedSmtpConfig | null {
  const stored = getStoredSmtpConfig();
  if (stored && stored.host.trim() && stored.user.trim() && stored.pass.trim()) {
    const user = stored.user.trim();
    const host = stored.host.trim();
    const preset = stored.providerPreset || inferPresetFromHost(host, user);
    const fromName = (stored.fromName || 'Alex Apparels Planning').trim();
    const requestedFromEmail = (stored.fromEmail || user).trim();
    const { fromEmail, fromHeader, replyTo } = normalizeSenderHeaders({
      preset,
      host,
      user,
      fromName,
      fromEmail: requestedFromEmail,
    });

    return {
      source: 'workspace',
      providerPreset: preset,
      host,
      port: Number(stored.port) || 465,
      secure: Boolean(stored.secure),
      user,
      pass: stored.pass,
      fromName,
      fromEmail,
      fromHeader,
      replyTo,
    };
  }

  return resolveEnvSmtpConfig();
}

export function getSmtpStatus(): SmtpSettingsPublic {
  const cfg = resolveSmtpConfig();
  if (!cfg) {
    return {
      configured: false,
      source: 'none',
      providerPreset: 'custom',
      host: '',
      port: 465,
      secure: true,
      user: '',
      fromName: 'Alex Apparels Planning',
      fromEmail: '',
      hasPassword: false,
      senderEmail: null,
    };
  }
  return {
    configured: true,
    source: cfg.source,
    providerPreset: cfg.providerPreset,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    fromName: cfg.fromName,
    fromEmail: cfg.fromEmail,
    hasPassword: true,
    senderEmail: cfg.fromEmail || cfg.user,
  };
}

export async function verifySmtpConnection(): Promise<{ ok: boolean; message: string }> {
  const smtp = resolveSmtpConfig();
  if (!smtp) {
    return {
      ok: false,
      message: 'No hosting email credentials configured yet.',
    };
  }

  try {
    const transporter = buildTransporter(smtp);
    await transporter.verify();
    return {
      ok: true,
      message: `SMTP login verified (${smtp.host}:${smtp.port} as ${smtp.user}). Note: Login check only — use "Send Real Test Email" to confirm actual inbox delivery.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP connection failed';
    return {
      ok: false,
      message: msg,
    };
  }
}

export async function sendTestEmail(toEmail: string): Promise<{
  ok: boolean;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  smtpResponse?: string;
  message: string;
}> {
  const smtp = resolveSmtpConfig();
  if (!smtp) {
    return {
      ok: false,
      message: 'No hosting email credentials configured yet. Save SMTP Email & Password first.',
    };
  }

  const target = toEmail.trim();
  if (!target) {
    return { ok: false, message: 'Enter a recipient email address to send the test email to.' };
  }

  try {
    const transporter = buildTransporter(smtp);
    const info = await transporter.sendMail({
      from: smtp.fromHeader,
      replyTo: smtp.replyTo,
      to: target,
      subject: `[Alex Apparels] SMTP Delivery Test (${new Date().toISOString().slice(0, 16)} UTC)`,
      text: [
        'Alex Apparels — Cluster 1 Planning Control Tower',
        '',
        'This is a live SMTP delivery test email.',
        `Sent from: ${smtp.fromEmail} via ${smtp.host}:${smtp.port}`,
        `Sent to: ${target}`,
        '',
        'If this arrived in Spam/Promotions, mark it as "Not Spam" so future Daily/Weekly/Monthly FO reminders land in your Primary inbox.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:20px auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
          <div style="background:#0f172a;color:#ffffff;padding:18px 22px;">
            <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Alex Apparels · Delivery Diagnostic</div>
            <h2 style="margin:6px 0 0 0;font-size:17px;color:#ffffff;">Live Email Test Successful</h2>
          </div>
          <div style="padding:20px 22px;color:#0f172a;font-size:13px;line-height:1.55;">
            <p style="margin:0 0 12px 0;">Your hosting / SMTP email configuration delivered this test message to <strong>${target}</strong>.</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#334155;">
              <div>Sender: ${smtp.fromEmail}</div>
              <div>Host: ${smtp.host}:${smtp.port} (${smtp.secure ? 'SSL/TLS' : 'STARTTLS'})</div>
            </div>
            <p style="margin:12px 0 0 0;font-size:12px;color:#475569;">
              Tip: If this landed in Spam or Junk, mark it <strong>Not Spam</strong> and whitelist <strong>${smtp.fromEmail}</strong>.
            </p>
          </div>
        </div>
      `,
    });

    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];

    if (accepted.length === 0 || rejected.length > 0) {
      return {
        ok: false,
        messageId: info.messageId,
        accepted,
        rejected,
        smtpResponse: info.response,
        message: `SMTP rejected delivery to ${rejected.join(', ') || target}. Server response: ${info.response || 'No accepted recipients'}`,
      };
    }

    return {
      ok: true,
      messageId: info.messageId,
      accepted,
      rejected,
      smtpResponse: info.response,
      message: `Real test email accepted by ${smtp.host} for ${accepted.join(', ')} (Message-ID: ${info.messageId}). Check Inbox and Spam/Promotions.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Test email delivery failed';
    return {
      ok: false,
      message: `${msg}. If using Gmail, verify 2-Step Verification is ON and you used a 16-character Google App Password.`,
    };
  }
}

function formatFreqLabel(freq: ReminderRecipient['frequency'] | undefined): string {
  if (freq === 'weekly') return 'Weekly';
  if (freq === 'monthly') return 'Monthly';
  return 'Daily';
}

export async function sendShortcutReminderEmails(params: {
  recipients: ReminderRecipient[];
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  alertScope: ReminderAlertScope;
  customMessage?: string;
  triggerType: 'Automatic Daily' | 'Automatic Scheduled' | 'Manual Send';
  appUrl?: string;
  ruleOptions?: PlanningRuleOptions;
}): Promise<{
  ok: boolean;
  succeededRecipientIds: string[];
  log: ReminderDeliveryLog;
}> {
  const {
    recipients,
    meta,
    records,
    cuttingEntries,
    referenceDateIso,
    alertScope,
    customMessage,
    triggerType,
    appUrl,
    ruleOptions = {},
  } = params;

  const activeRecipients = recipients.filter((r) => r.active);
  const recipientEmails = activeRecipients.map((r) => r.email);

  const summaryDigest = buildShortcutEmailDigest({
    meta,
    records,
    cuttingEntries,
    referenceDateIso,
    alertScope,
    customMessage,
    appUrl,
    ruleOptions,
  });

  if (activeRecipients.length === 0) {
    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType,
      recipientCount: 0,
      recipients: [],
      urgentLineCount: summaryDigest.urgentLineCount,
      dueSoonLineCount: summaryDigest.dueSoonLineCount,
      cutting10dCount: summaryDigest.cutting10dCount,
      status: 'Failed',
      message: 'No active recipient email addresses configured.',
    };
    appendReminderDeliveryLog(log);
    return { ok: false, succeededRecipientIds: [], log };
  }

  const smtp = resolveSmtpConfig();
  if (!smtp) {
    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType,
      recipientCount: activeRecipients.length,
      recipients: recipientEmails,
      urgentLineCount: summaryDigest.urgentLineCount,
      dueSoonLineCount: summaryDigest.dueSoonLineCount,
      cutting10dCount: summaryDigest.cutting10dCount,
      status: 'SMTP Not Configured',
      message:
        'Configure your Hosting Sender Email & Password in Hosting Email Settings first.',
    };
    appendReminderDeliveryLog(log);
    return { ok: false, succeededRecipientIds: [], log };
  }

  try {
    const transporter = buildTransporter(smtp);
    const xlsxBuffer = await buildPlanningWorkbookBuffer(
      meta,
      records,
      referenceDateIso,
      cuttingEntries,
      ruleOptions
    );
    const xlsxFilename = `Alex_Apparels_Cluster1_Planning_${referenceDateIso}.xlsx`;

    const succeededRecipientIds: string[] = [];
    const acceptedEmails: string[] = [];
    const rejectedEmails: string[] = [];
    const messageIds: string[] = [];

    // Person-to-person dispatch so each recipient receives their factory scope, frequency title, personal note, and .xlsx attachment
    for (const recipient of activeRecipients) {
      const factoryFilter =
        recipient.factories &&
        recipient.factories.length > 0 &&
        recipient.factories.length < ALLOWED_FACTORIES.length
          ? recipient.factories
          : undefined;

      const digest = buildShortcutEmailDigest({
        meta,
        records,
        cuttingEntries,
        referenceDateIso,
        alertScope,
        factoryFilter,
        customMessage,
        recipientNote: recipient.customNote,
        frequencyLabel: formatFreqLabel(recipient.frequency),
        appUrl,
        ruleOptions,
      });

      const toHeader = recipient.name
        ? `"${recipient.name.replace(/"/g, '')}" <${recipient.email}>`
        : recipient.email;

      const info = await transporter.sendMail({
        from: smtp.fromHeader,
        replyTo: smtp.replyTo,
        to: toHeader,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
        attachments: [
          {
            filename: xlsxFilename,
            content: xlsxBuffer,
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });

      const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
      const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
      if (info.messageId) messageIds.push(info.messageId);

      if (accepted.length > 0 && rejected.length === 0) {
        succeededRecipientIds.push(recipient.id);
        acceptedEmails.push(recipient.email);
      } else {
        rejectedEmails.push(recipient.email);
      }
    }

    const allSucceeded = rejectedEmails.length === 0 && acceptedEmails.length > 0;
    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType,
      recipientCount: acceptedEmails.length,
      recipients: acceptedEmails.length > 0 ? acceptedEmails : recipientEmails,
      urgentLineCount: summaryDigest.urgentLineCount,
      dueSoonLineCount: summaryDigest.dueSoonLineCount,
      cutting10dCount: summaryDigest.cutting10dCount,
      status: allSucceeded ? 'Sent' : 'Failed',
      message: allSucceeded
        ? `Sent from ${smtp.fromEmail} to ${acceptedEmails.join(', ')} with ${xlsxFilename} attached via ${smtp.host} (ID: ${messageIds[0] || 'ok'}).`
        : `Accepted: ${acceptedEmails.join(', ') || 'none'} | Rejected: ${rejectedEmails.join(', ')}`,
    };
    appendReminderDeliveryLog(log);
    return { ok: acceptedEmails.length > 0, succeededRecipientIds, log };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'SMTP delivery failed';
    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType,
      recipientCount: activeRecipients.length,
      recipients: recipientEmails,
      urgentLineCount: summaryDigest.urgentLineCount,
      dueSoonLineCount: summaryDigest.dueSoonLineCount,
      cutting10dCount: summaryDigest.cutting10dCount,
      status: 'Failed',
      message: errMsg,
    };
    appendReminderDeliveryLog(log);
    return { ok: false, succeededRecipientIds: [], log };
  }
}

export async function sendAdminVerificationCodeEmail(params: {
  toEmail: string;
  code: string;
  expiresMinutes: number;
}): Promise<{ ok: boolean; smtpMissing?: boolean; message: string }> {
  const smtp = resolveSmtpConfig();
  if (!smtp) {
    return {
      ok: false,
      smtpMissing: true,
      message:
        'Hosting / Sender Email (SMTP) is not configured yet. Configure your Hosting Email & Password in Email Reminders → Hosting Email Settings first so the 6-digit verification code can be sent to ' +
        params.toEmail +
        '.',
    };
  }

  try {
    const transporter = buildTransporter(smtp);
    const info = await transporter.sendMail({
      from: smtp.fromHeader,
      replyTo: smtp.replyTo,
      to: params.toEmail,
      subject: `[Alex Apparels Control Panel] Password Change Verification Code: ${params.code}`,
      text: [
        'Alex Apparels — Cluster 1 Planning Control Panel',
        '',
        `Your Control Panel password change verification code is: ${params.code}`,
        '',
        `This code expires in ${params.expiresMinutes} minutes.`,
        'If you did not request a Control Panel password change, ignore this email.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:20px auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
          <div style="background:#0f172a;color:#ffffff;padding:18px 22px;">
            <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Alex Apparels · Admin Security</div>
            <h2 style="margin:6px 0 0 0;font-size:17px;color:#ffffff;">Control Panel Verification Code</h2>
          </div>
          <div style="padding:22px;color:#0f172a;font-size:14px;line-height:1.5;">
            <p style="margin:0 0 14px 0;">Use the 6-digit verification code below to change your Website Control Panel password:</p>
            <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:14px;text-align:center;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#1d4ed8;">
              ${params.code}
            </div>
            <p style="margin:14px 0 0 0;font-size:12px;color:#64748b;">
              Valid for ${params.expiresMinutes} minutes. If you did not initiate this request, you can safely ignore this message.
            </p>
          </div>
        </div>
      `,
    });

    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    if (accepted.length === 0 || rejected.length > 0) {
      return {
        ok: false,
        message: `SMTP rejected sending verification code to ${params.toEmail}. Response: ${info.response || 'Rejected'}`,
      };
    }

    return {
      ok: true,
      message: `6-digit verification code sent from ${smtp.fromEmail} to ${params.toEmail} (ID: ${info.messageId}). Check Inbox and Spam/Promotions.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Failed to send verification code email.',
    };
  }
}

export async function sendPasswordChangedNoticeEmail(toEmail: string): Promise<void> {
  const smtp = resolveSmtpConfig();
  if (!smtp) return;
  try {
    const transporter = buildTransporter(smtp);
    await transporter.sendMail({
      from: smtp.fromHeader,
      replyTo: smtp.replyTo,
      to: toEmail,
      subject: '[Alex Apparels Control Panel] Admin Password Updated',
      text: `Your Alex Apparels Control Panel password was updated on ${new Date().toISOString()}.`,
    });
  } catch {
    // Best-effort notification
  }
}

function escapeEmailHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendSavedUpcomingFoEmail(params: {
  toEmails: string[];
  subject?: string;
  bodyText?: string;
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  selectedRecordIds?: string[];
  attachXlsx?: boolean;
  appUrl?: string;
  ruleOptions?: PlanningRuleOptions;
}): Promise<{
  ok: boolean;
  message: string;
  log?: ReminderDeliveryLog;
}> {
  const {
    toEmails,
    subject,
    bodyText,
    meta,
    records,
    cuttingEntries,
    referenceDateIso,
    selectedRecordIds,
    attachXlsx = true,
    appUrl,
    ruleOptions = {},
  } = params;

  const inputOffset = Math.max(1, ruleOptions.inputStartOffsetDays ?? 10);
  const foOffset = Math.max(1, ruleOptions.upcomingFoOffsetDays ?? 15);

  const validEmails = Array.from(
    new Set(
      toEmails
        .map((e) => e.trim())
        .filter((e) => EMAIL_REGEX.test(e))
    )
  );

  if (validEmails.length === 0) {
    return {
      ok: false,
      message: 'Please enter at least one valid recipient email address.',
    };
  }

  const smtp = resolveSmtpConfig();
  if (!smtp) {
    return {
      ok: false,
      message:
        'Hosting / Sender Email (SMTP) is not configured yet. Set up your SMTP credentials in Email Reminders → Hosting Email Settings first.',
    };
  }

  const evaluated = evaluatePlanningRecords(records, cuttingEntries, referenceDateIso, ruleOptions);
  const shortcutSummaries = buildLineShortcutSummaries(evaluated, referenceDateIso, ruleOptions);
  const shortcutByLineKey = new Map<string, (typeof shortcutSummaries)[number]>();
  for (const s of shortcutSummaries) {
    shortcutByLineKey.set(`${s.factory}::${s.line}`, s);
  }

  const idSet =
    Array.isArray(selectedRecordIds) && selectedRecordIds.length > 0
      ? new Set(selectedRecordIds)
      : null;

  const selectedRecords: EvaluatedPlanningRecord[] = evaluated.filter((r) =>
    idSet ? idSet.has(r.id) : Boolean(r.upcomingFoSelected)
  );

  if (selectedRecords.length === 0) {
    return {
      ok: false,
      message:
        'No saved Upcoming FO items found to send. Tick at least one row in Upcoming FO Needed first.',
    };
  }

  const rows = selectedRecords
    .map((rec) => {
      const sc = shortcutByLineKey.get(`${rec.factory}::${rec.line}`) ?? null;
      const isLineUpcoming = sc?.upcomingRecord?.id === rec.id;
      const isLineRunning = sc?.runningRecord?.id === rec.id || rec.lifecycleStage === 'Running';
      const orderStage: 'RUNNING ORDER' | 'UPCOMING ORDER' = isLineRunning
        ? 'RUNNING ORDER'
        : 'UPCOMING ORDER';
      const runRec = isLineRunning ? rec : sc?.runningRecord ?? null;
      const runningEndIso = isLineRunning
        ? rec.endDateIso ?? null
        : runRec?.endDateIso ?? rec.endDateIso ?? null;
      const outputStartIso = addDaysIso(runningEndIso, 1);
      const daysToOutputStart = diffDaysIso(outputStartIso, referenceDateIso);
      const inputStartIso = isLineUpcoming
        ? sc?.newStyleInputStartIso ?? null
        : runningEndIso
          ? addDaysIso(runningEndIso, -inputOffset)
          : null;
      const daysToStartNewStyle = isLineUpcoming
        ? sc?.daysToNewStyleInputStart ?? null
        : diffDaysIso(inputStartIso, referenceDateIso);
      const foDateNeededIso = isLineUpcoming
        ? sc?.upcomingFoTriggerIso ?? null
        : inputStartIso
          ? addDaysIso(inputStartIso, -foOffset)
          : rec.triggerDateIso;
      const daysToFo = isLineUpcoming
        ? sc?.daysToUpcomingFoTrigger ?? null
        : diffDaysIso(foDateNeededIso, referenceDateIso);
      const statusLabel = rec.isFullQtyReleased
        ? 'FULL QTY RELEASED'
        : isLineUpcoming
          ? sc?.summaryStatus ?? rec.riskStatus
          : rec.riskStatus;
      const severity: 'critical' | 'warning' | 'upcoming' | 'normal' | 'released' =
        rec.isFullQtyReleased
          ? 'released'
          : isLineUpcoming
            ? sc?.summarySeverity ?? 'upcoming'
            : rec.riskTier === 'critical'
              ? 'critical'
              : rec.riskTier === 'high' || rec.riskTier === 'plan_qty_pending'
                ? 'warning'
                : rec.riskTier === 'monitoring'
                  ? 'upcoming'
                  : 'normal';

      return {
        rec,
        orderStage,
        runRec,
        runningEndIso,
        outputStartIso,
        daysToOutputStart,
        issueQty: getEffectiveIssueQty(rec),
        inputStartIso,
        daysToStartNewStyle,
        foDateNeededIso,
        daysToFo,
        statusLabel,
        severity,
      };
    })
    .sort((a, b) => {
      const sevOrder = { critical: 0, warning: 1, upcoming: 2, normal: 3, released: 4 };
      if (sevOrder[a.severity] !== sevOrder[b.severity]) {
        return sevOrder[a.severity] - sevOrder[b.severity];
      }
      return (a.foDateNeededIso || '9999-12-31').localeCompare(
        b.foDateNeededIso || '9999-12-31'
      );
    });

  const totalOrderQty = rows.reduce((sum, r) => sum + (r.rec.plannedQty ?? 0), 0);
  const totalIssueQty = rows.reduce((sum, r) => sum + (r.issueQty ?? 0), 0);
  const releasedCount = rows.filter((r) => r.rec.isFullQtyReleased).length;
  const urgentCount = rows.filter((r) => r.severity === 'critical').length;
  const dueSoonCount = rows.filter((r) => r.severity === 'warning').length;

  const finalSubject =
    (subject || '').trim() || buildDefaultSavedFoEmailSubject(rows.length, referenceDateIso);
  const finalBodyText =
    (bodyText || '').trim() || DEFAULT_SAVED_FO_EMAIL_BODY;

  const bodyHtmlParagraphs = finalBodyText
    .split(/\r?\n/)
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 8px 0;color:#0f172a;font-size:13px;line-height:1.55;">${escapeEmailHtml(line)}</p>`
        : '<div style="height:6px;"></div>'
    )
    .join('');

  const tableRowsHtml = rows
    .map((item, idx) => {
      const rec = item.rec;
      const bg =
        item.severity === 'released'
          ? '#f0fdf4'
          : item.severity === 'critical'
            ? '#fef2f2'
            : item.severity === 'warning'
              ? '#fffbeb'
              : '#ffffff';
      const badgeColor =
        item.severity === 'released'
          ? '#15803d'
          : item.severity === 'critical'
            ? '#991b1b'
            : item.severity === 'warning'
              ? '#92400e'
              : item.severity === 'upcoming'
                ? '#1e40af'
                : '#166534';
      const stageBadgeBg = item.orderStage === 'RUNNING ORDER' ? '#dbeafe' : '#fef3c7';
      const stageBadgeColor = item.orderStage === 'RUNNING ORDER' ? '#1e40af' : '#92400e';
      const daysLabel =
        item.daysToFo === null
          ? '—'
          : item.daysToFo === 0
            ? 'TODAY'
            : item.daysToFo < 0
              ? `${Math.abs(item.daysToFo)}d overdue`
              : `in ${item.daysToFo}d`;
      const sheetRemarkText = rec.sheetRemark || rec.fabricNote || '';

      return `
        <tr style="background:${bg};">
          <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:center;font-family:monospace;">${idx + 1}</td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;"><strong>${escapeEmailHtml(rec.factory)}</strong><br/><span style="color:#475569;">${escapeEmailHtml(rec.line)}</span></td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;">${
            item.runRec && item.runRec.id !== rec.id
              ? `<strong>${escapeEmailHtml(item.runRec.pgNumber)}</strong> (End ${escapeEmailHtml(formatDisplayDate(item.runRec.endDateIso))})<br/><span style="color:#475569;">${escapeEmailHtml(item.runRec.style)}</span>`
              : item.runningEndIso
                ? `End ${escapeEmailHtml(formatDisplayDate(item.runningEndIso))}`
                : '—'
          }</td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;">
            <span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${stageBadgeBg};color:${stageBadgeColor};font-size:10px;font-weight:700;margin-bottom:3px;">${escapeEmailHtml(item.orderStage)}</span><br/>
            <strong style="color:#065f46;">${escapeEmailHtml(rec.pgNumber)}</strong><br/>
            <span style="color:#0f172a;">${escapeEmailHtml(rec.style)}</span>
          </td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-family:monospace;">
            <div><strong>Ord:</strong> ${rec.plannedQty !== null ? rec.plannedQty.toLocaleString() : 'Pending'}</div>
            <div style="color:#065f46;font-weight:bold;"><strong>Iss:</strong> ${item.issueQty !== null ? item.issueQty.toLocaleString() : 'Pending'}</div>
          </td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:center;font-family:monospace;"><strong>${escapeEmailHtml(formatDisplayDate(item.outputStartIso))}</strong>${
            item.daysToOutputStart !== null
              ? `<br/><span style="font-size:11px;color:#047857;font-weight:bold;">${
                  item.daysToOutputStart === 0
                    ? 'Starts TODAY'
                    : item.daysToOutputStart < 0
                      ? `${Math.abs(item.daysToOutputStart)}d passed`
                      : `${item.daysToOutputStart}d to output`
                }</span>`
              : ''
          }</td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:center;font-family:monospace;">${escapeEmailHtml(formatDisplayDate(item.inputStartIso))}${
            item.daysToStartNewStyle !== null
              ? `<br/><span style="font-size:11px;color:#1e40af;font-weight:bold;">${
                  item.daysToStartNewStyle === 0
                    ? 'Starts TODAY'
                    : item.daysToStartNewStyle < 0
                      ? `${Math.abs(item.daysToStartNewStyle)}d overdue`
                      : `${item.daysToStartNewStyle}d left`
                }</span>`
              : ''
          }</td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:center;font-family:monospace;"><strong>${escapeEmailHtml(formatDisplayDate(item.foDateNeededIso))}</strong><br/><span style="color:${badgeColor};font-size:11px;">${escapeEmailHtml(daysLabel)}</span></td>
          <td style="padding:8px 10px;border:1px solid #cbd5e1;">
            <strong style="color:${badgeColor};">${escapeEmailHtml(item.statusLabel)}</strong><br/>
            <span style="color:#475569;font-size:11px;">FO: ${escapeEmailHtml(rec.isFullQtyReleased ? 'In-House' : rec.foStatus)}${rec.foNumber ? ` · #${escapeEmailHtml(rec.foNumber)}` : ''}</span>
            ${
              sheetRemarkText
                ? `<div style="margin-top:3px;font-size:11px;color:#065f46;font-weight:600;">Remark: ${escapeEmailHtml(sheetRemarkText)}</div>`
                : ''
            }
          </td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:1060px;margin:0 auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
      <div style="background:#0f172a;color:#ffffff;padding:18px 24px;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;">Alex Apparels · Cluster 1 Planning Control Tower</div>
        <h2 style="margin:6px 0 0 0;font-size:18px;color:#ffffff;">Selected Fabric Order (FO Needed) Checklist</h2>
        <div style="margin-top:6px;font-size:12px;color:#cbd5e1;">
          Reference Date: ${escapeEmailHtml(formatDisplayDate(referenceDateIso))} &nbsp;|&nbsp; Selected: <strong>${rows.length}</strong> &nbsp;|&nbsp; Order Qty: <strong>${totalOrderQty.toLocaleString()} pcs</strong> &nbsp;|&nbsp; Issue Qty (=Order): <strong>${totalIssueQty.toLocaleString()} pcs</strong> &nbsp;|&nbsp; Full Qty Released: <strong>${releasedCount}</strong>
        </div>
      </div>

      <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:#f8fafc;">
        ${bodyHtmlParagraphs}
      </div>

      <div style="padding:20px 24px;">
        <h3 style="margin:0 0 12px 0;font-size:14px;color:#0f172a;">Saved FO Needed List (${rows.length} Items)</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#1e293b;color:#ffffff;">
              <th style="padding:9px 10px;border:1px solid #334155;text-align:center;">#</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:left;">Factory · Line</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:left;">Running PG &amp; End</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:left;">PG &amp; Stage</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:right;">Order / Issue Qty</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:center;">Output Start (End+1D)</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:center;">Input Start</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:center;">FO Date Needed</th>
              <th style="padding:9px 10px;border:1px solid #334155;text-align:left;">Status &amp; Sheet Remark</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
          <tfoot>
            <tr style="background:#f1f5f9;font-weight:bold;">
              <td colspan="4" style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;">TOTAL (${rows.length} Selected Items):</td>
              <td style="padding:8px 10px;border:1px solid #cbd5e1;text-align:right;font-family:monospace;">Ord: ${totalOrderQty.toLocaleString()} / Iss: ${totalIssueQty.toLocaleString()} pcs</td>
              <td colspan="4" style="padding:8px 10px;border:1px solid #cbd5e1;color:#475569;font-weight:normal;">${releasedCount} full qty released · ${urgentCount} critical · ${dueSoonCount} due soon</td>
            </tr>
          </tfoot>
        </table>
        ${
          appUrl
            ? `<p style="margin:16px 0 0 0;font-size:12px;color:#475569;">Open Live Planning Portal: <a href="${escapeEmailHtml(appUrl)}" style="color:#1d4ed8;">${escapeEmailHtml(appUrl)}</a></p>`
            : ''
        }
      </div>
    </div>
  `;

  const textLines = [
    finalBodyText,
    '',
    `--- SAVED FO NEEDED LIST (${rows.length} Items | Ref: ${referenceDateIso}) ---`,
    ...rows.map(
      (item, idx) =>
        `${idx + 1}. [${item.orderStage}] ${item.rec.factory} ${item.rec.line} | PG: ${item.rec.pgNumber} (${item.rec.style}) | Order Qty: ${
          item.rec.plannedQty !== null ? item.rec.plannedQty.toLocaleString() : 'Pending'
        } | Issue Qty: ${
          item.issueQty !== null ? item.issueQty.toLocaleString() : 'Pending'
        } | Output Start (End+1D): ${formatDisplayDate(item.outputStartIso)} | FO Date Needed: ${formatDisplayDate(item.foDateNeededIso)} | Status: ${item.statusLabel}${
          item.rec.sheetRemark ? ` | Remark: ${item.rec.sheetRemark}` : ''
        }`
    ),
    `Total Order Qty: ${totalOrderQty.toLocaleString()} pcs | Total Issue Qty (=Order): ${totalIssueQty.toLocaleString()} pcs | Full Qty Released: ${releasedCount}`,
  ].join('\n');

  try {
    const transporter = buildTransporter(smtp);
    const attachments: Array<{
      filename: string;
      content: Buffer;
      contentType: string;
    }> = [];

    const xlsxFilename = `Selected_Upcoming_FO_List_${referenceDateIso}.xlsx`;
    if (attachXlsx) {
      const xlsxBuffer = await buildSelectedUpcomingFoWorkbookBuffer({
        meta,
        records,
        cuttingEntries,
        referenceDateIso,
        selectedRecordIds: rows.map((r) => r.rec.id),
        ruleOptions,
      });
      attachments.push({
        filename: xlsxFilename,
        content: xlsxBuffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    const info = await transporter.sendMail({
      from: smtp.fromHeader,
      replyTo: smtp.replyTo,
      to: validEmails.join(', '),
      subject: finalSubject,
      text: textLines,
      html,
      attachments,
    });

    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    const ok = accepted.length > 0 && rejected.length === 0;

    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType: 'Manual Send',
      recipientCount: validEmails.length,
      recipients: validEmails,
      urgentLineCount: urgentCount,
      dueSoonLineCount: dueSoonCount,
      cutting10dCount: 0,
      status: ok ? 'Sent' : 'Failed',
      message: ok
        ? `Sent Saved Upcoming FO Box (${rows.length} items${attachXlsx ? `, ${xlsxFilename} attached` : ''}) to ${accepted.join(', ')} (ID: ${info.messageId || 'ok'}).`
        : `Accepted: ${accepted.join(', ') || 'none'} | Rejected: ${rejected.join(', ')}`,
    };
    appendReminderDeliveryLog(log);

    return {
      ok,
      log,
      message: ok
        ? `Email sent to ${accepted.join(', ')} with ${rows.length} Saved Upcoming FO item(s)${attachXlsx ? ' and .xlsx attachment' : ''}.`
        : `SMTP rejected delivery to ${rejected.join(', ') || validEmails.join(', ')}.`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Failed to send Saved FO email.';
    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType: 'Manual Send',
      recipientCount: validEmails.length,
      recipients: validEmails,
      urgentLineCount: urgentCount,
      dueSoonLineCount: dueSoonCount,
      cutting10dCount: 0,
      status: 'Failed',
      message: errMsg,
    };
    appendReminderDeliveryLog(log);
    return {
      ok: false,
      log,
      message: errMsg,
    };
  }
}

