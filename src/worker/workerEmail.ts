import { Buffer } from 'node:buffer';
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
  SmtpSettingsPublic,
} from '../shared/reminderTypes.ts';
import {
  buildPlanningWorkbookBuffer,
  buildSelectedUpcomingFoWorkbookBuffer,
} from '../server/xlsxBuilder.ts';
import type { WorkerEnv } from './cfTypes.ts';
import {
  appendReminderDeliveryLogD1,
  getStoredSmtpConfigD1,
  getWorkspaceStateD1,
  updateReminderRecipientD1,
  updateReminderScheduleD1,
} from './d1Store.ts';

function isEmailEnabled(env: WorkerEnv): boolean {
  return (env.EMAIL_ENABLED || '').trim().toLowerCase() !== 'false';
}

interface ResolvedEmailTransport {
  mode: 'webhook' | 'resend' | 'legacy_smtp_only' | 'none';
  fromName: string;
  fromEmail: string;
  fromHeader: string;
  replyTo?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  resendApiKey?: string;
}

function parseFromString(rawFrom: string, fallbackName: string): {
  fromName: string;
  fromEmail: string;
} {
  const trimmed = rawFrom.trim();
  const angleMatch = /^(.*)<([^>]+)>$/.exec(trimmed);
  if (angleMatch) {
    return {
      fromName: angleMatch[1].replace(/^"|"$/g, '').trim() || fallbackName,
      fromEmail: angleMatch[2].trim(),
    };
  }
  if (EMAIL_REGEX.test(trimmed)) {
    return { fromName: fallbackName, fromEmail: trimmed };
  }
  return { fromName: fallbackName, fromEmail: 'noreply@alexapparels.com' };
}

async function resolveWorkerEmailTransport(env: WorkerEnv): Promise<ResolvedEmailTransport> {
  const stored = await getStoredSmtpConfigD1(env);
  const webhookUrl = (env.EMAIL_WEBHOOK_URL || '').trim();
  const webhookSecret = (env.EMAIL_WEBHOOK_SECRET || '').trim();
  const resendApiKey = (env.RESEND_API_KEY || '').trim();

  const defaultFrom = parseFromString(
    env.EMAIL_FROM || 'Alex Apparels Planning <noreply@alexapparels.com>',
    'Alex Apparels Planning'
  );
  const fromName = (stored?.fromName || defaultFrom.fromName).replace(/"/g, '').trim();
  const fromEmail = (stored?.fromEmail || stored?.user || defaultFrom.fromEmail).trim();
  const fromHeader = `"${fromName}" <${fromEmail}>`;

  if (webhookUrl) {
    return {
      mode: 'webhook',
      fromName,
      fromEmail,
      fromHeader,
      replyTo: stored?.fromEmail && stored.fromEmail !== fromEmail ? stored.fromEmail : undefined,
      webhookUrl,
      webhookSecret: webhookSecret || undefined,
    };
  }

  if (resendApiKey) {
    const resendFrom = defaultFrom.fromEmail;
    return {
      mode: 'resend',
      fromName: defaultFrom.fromName,
      fromEmail: resendFrom,
      fromHeader: `"${defaultFrom.fromName}" <${resendFrom}>`,
      replyTo: stored?.fromEmail || stored?.user || undefined,
      resendApiKey,
    };
  }

  if (stored && stored.host.trim() && stored.user.trim() && stored.pass.trim()) {
    return {
      mode: 'legacy_smtp_only',
      fromName,
      fromEmail,
      fromHeader,
    };
  }

  return {
    mode: 'none',
    fromName,
    fromEmail,
    fromHeader,
  };
}

export async function getWorkerSmtpStatus(env: WorkerEnv): Promise<SmtpSettingsPublic> {
  const stored = await getStoredSmtpConfigD1(env);
  const transport = await resolveWorkerEmailTransport(env);

  if (transport.mode === 'webhook' || transport.mode === 'resend') {
    return {
      configured: true,
      source: transport.mode === 'resend' ? 'env' : stored ? 'workspace' : 'env',
      providerPreset: stored?.providerPreset || 'custom',
      host: transport.mode === 'resend' ? 'api.resend.com (HTTPS)' : 'Email Webhook Relay (HTTPS)',
      port: 443,
      secure: true,
      user: transport.fromEmail,
      fromName: transport.fromName,
      fromEmail: transport.fromEmail,
      hasPassword: true,
      senderEmail: transport.fromEmail,
    };
  }

  if (stored && stored.host.trim() && stored.user.trim() && stored.pass.trim()) {
    return {
      configured: true,
      source: 'workspace',
      providerPreset: stored.providerPreset || 'custom',
      host: stored.host,
      port: Number(stored.port) || 465,
      secure: Boolean(stored.secure),
      user: stored.user,
      fromName: stored.fromName || 'Alex Apparels Planning',
      fromEmail: stored.fromEmail || stored.user,
      hasPassword: true,
      senderEmail: stored.fromEmail || stored.user,
    };
  }

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

interface HttpEmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

interface HttpSendPayload {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: HttpEmailAttachment[];
}

async function dispatchHttpEmail(
  transport: ResolvedEmailTransport,
  payload: HttpSendPayload
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (transport.mode === 'webhook' && transport.webhookUrl) {
    const resp = await fetch(transport.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(transport.webhookSecret ? { Authorization: `Bearer ${transport.webhookSecret}` } : {}),
      },
      body: JSON.stringify({
        from: transport.fromHeader,
        fromEmail: transport.fromEmail,
        fromName: transport.fromName,
        replyTo: transport.replyTo,
        to: payload.to.join(', '),
        toList: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        attachments: (payload.attachments || []).map((att) => ({
          filename: att.filename,
          contentBase64: Buffer.from(att.content).toString('base64'),
          contentType: att.contentType,
        })),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return {
        ok: false,
        error: `Email webhook returned HTTP ${resp.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
      };
    }
    return { ok: true, messageId: `webhook-${Date.now().toString(36)}` };
  }

  if (transport.mode === 'resend' && transport.resendApiKey) {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${transport.resendApiKey}`,
      },
      body: JSON.stringify({
        from: transport.fromHeader,
        to: payload.to,
        ...(transport.replyTo ? { reply_to: transport.replyTo } : {}),
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
        ...(payload.attachments && payload.attachments.length > 0
          ? {
              attachments: payload.attachments.map((att) => ({
                filename: att.filename,
                content: Buffer.from(att.content).toString('base64'),
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const json = (await resp.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!resp.ok) {
      return {
        ok: false,
        error: json.message || `Resend HTTP ${resp.status}`,
      };
    }
    return { ok: true, messageId: json.id || `resend-${Date.now().toString(36)}` };
  }

  if (transport.mode === 'legacy_smtp_only') {
    return {
      ok: false,
      error:
        'Cloudflare Workers do not support raw TCP SMTP ports (465/587). Configure RESEND_API_KEY or EMAIL_WEBHOOK_URL Worker secret to send email via HTTPS.',
    };
  }

  return {
    ok: false,
    error:
      'No Worker HTTPS email provider is configured yet. Set RESEND_API_KEY or EMAIL_WEBHOOK_URL via `wrangler secret put`.',
  };
}

export async function verifyWorkerEmailConnection(
  env: WorkerEnv
): Promise<{ ok: boolean; message: string }> {
  if (!isEmailEnabled(env)) {
    return {
      ok: false,
      message:
        'Email sending & verification are temporarily disabled (EMAIL_ENABLED=false). Set EMAIL_ENABLED=true when ready.',
    };
  }

  const transport = await resolveWorkerEmailTransport(env);
  if (transport.mode === 'resend' || transport.mode === 'webhook') {
    return {
      ok: true,
      message: `Worker HTTPS email relay ready (${transport.mode === 'resend' ? 'Resend API' : 'Webhook Relay'} from ${transport.fromEmail}). Use "Send Real Test Email" to confirm inbox delivery.`,
    };
  }
  if (transport.mode === 'legacy_smtp_only') {
    return {
      ok: false,
      message:
        'Cloudflare Workers cannot open raw TCP SMTP sockets (port 465/587). Add RESEND_API_KEY or EMAIL_WEBHOOK_URL in Cloudflare Worker secrets for free HTTPS delivery.',
    };
  }
  return {
    ok: false,
    message: 'No Worker email credentials configured yet.',
  };
}

export async function sendWorkerTestEmail(
  env: WorkerEnv,
  toEmail: string
): Promise<{ ok: boolean; messageId?: string; message: string }> {
  if (!isEmailEnabled(env)) {
    return {
      ok: false,
      message:
        'Email sending is temporarily disabled (EMAIL_ENABLED=false). No test email was sent.',
    };
  }

  const transport = await resolveWorkerEmailTransport(env);
  if (transport.mode === 'none' || transport.mode === 'legacy_smtp_only') {
    const check = await verifyWorkerEmailConnection(env);
    return { ok: false, message: check.message };
  }

  const target = toEmail.trim();
  if (!target) {
    return { ok: false, message: 'Enter a recipient email address to send the test email to.' };
  }

  const result = await dispatchHttpEmail(transport, {
    to: [target],
    subject: `[Alex Apparels] Worker HTTPS Email Delivery Test (${new Date().toISOString().slice(0, 16)} UTC)`,
    text: [
      'Alex Apparels — Cluster 1 Planning Control Tower',
      '',
      'This is a live Cloudflare Worker HTTPS email delivery test.',
      `Sent from: ${transport.fromEmail}`,
      `Sent to: ${target}`,
    ].join('\n'),
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:20px auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
        <div style="background:#0f172a;color:#ffffff;padding:18px 22px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Alex Apparels · Delivery Diagnostic</div>
          <h2 style="margin:6px 0 0 0;font-size:17px;color:#ffffff;">Live Email Test Successful</h2>
        </div>
        <div style="padding:20px 22px;color:#0f172a;font-size:13px;line-height:1.55;">
          <p style="margin:0 0 12px 0;">Your Cloudflare Worker email transport delivered this test message to <strong>${target}</strong>.</p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#334155;">
            <div>Sender: ${transport.fromEmail}</div>
            <div>Transport: ${transport.mode === 'resend' ? 'Resend HTTPS API' : 'Custom HTTPS Email Webhook'}</div>
          </div>
        </div>
      </div>
    `,
  });

  if (!result.ok) {
    return { ok: false, message: result.error || 'Test email delivery failed.' };
  }
  return {
    ok: true,
    messageId: result.messageId,
    message: `Test email accepted for ${target} (ID: ${result.messageId}).`,
  };
}

function formatFreqLabel(freq: ReminderRecipient['frequency'] | undefined): string {
  if (freq === 'weekly') return 'Weekly';
  if (freq === 'monthly') return 'Monthly';
  return 'Daily';
}

export async function sendWorkerShortcutReminderEmails(
  env: WorkerEnv,
  params: {
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
  }
): Promise<{
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

  if (!isEmailEnabled(env)) {
    return {
      ok: false,
      succeededRecipientIds: [],
      log: {
        id: `REM-${Date.now().toString(36).toUpperCase()}`,
        sentAtIso: new Date().toISOString(),
        triggerType,
        recipientCount: 0,
        recipients: [],
        urgentLineCount: 0,
        dueSoonLineCount: 0,
        cutting10dCount: 0,
        status: 'Failed',
        message: 'Email reminders are temporarily disabled (EMAIL_ENABLED=false).',
      },
    };
  }

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
    await appendReminderDeliveryLogD1(env, log);
    return { ok: false, succeededRecipientIds: [], log };
  }

  const transport = await resolveWorkerEmailTransport(env);
  if (transport.mode === 'none' || transport.mode === 'legacy_smtp_only') {
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
        transport.mode === 'legacy_smtp_only'
          ? 'Configure RESEND_API_KEY or EMAIL_WEBHOOK_URL in Cloudflare Worker secrets for HTTPS email delivery.'
          : 'Configure RESEND_API_KEY or EMAIL_WEBHOOK_URL in Cloudflare Worker secrets first.',
    };
    await appendReminderDeliveryLogD1(env, log);
    return { ok: false, succeededRecipientIds: [], log };
  }

  try {
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

      const res = await dispatchHttpEmail(transport, {
        to: [recipient.email],
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

      if (res.ok) {
        succeededRecipientIds.push(recipient.id);
        acceptedEmails.push(recipient.email);
        if (res.messageId) messageIds.push(res.messageId);
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
        ? `Sent from ${transport.fromEmail} to ${acceptedEmails.join(', ')} with ${xlsxFilename} attached (ID: ${messageIds[0] || 'ok'}).`
        : `Accepted: ${acceptedEmails.join(', ') || 'none'} | Rejected: ${rejectedEmails.join(', ')}`,
    };
    await appendReminderDeliveryLogD1(env, log);
    return { ok: acceptedEmails.length > 0, succeededRecipientIds, log };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Email delivery failed';
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
    await appendReminderDeliveryLogD1(env, log);
    return { ok: false, succeededRecipientIds: [], log };
  }
}

export async function sendWorkerAdminVerificationCodeEmail(
  env: WorkerEnv,
  params: { toEmail: string; code: string; expiresMinutes: number }
): Promise<{ ok: boolean; smtpMissing?: boolean; message: string }> {
  if (!isEmailEnabled(env)) {
    return {
      ok: false,
      message:
        'Email sending is temporarily disabled (EMAIL_ENABLED=false). Enable EMAIL_ENABLED=true with RESEND_API_KEY or EMAIL_WEBHOOK_URL to send verification codes.',
    };
  }

  const transport = await resolveWorkerEmailTransport(env);
  if (transport.mode === 'none' || transport.mode === 'legacy_smtp_only') {
    return {
      ok: false,
      smtpMissing: true,
      message:
        'Cloudflare Worker HTTPS email transport is not configured yet. Set RESEND_API_KEY or EMAIL_WEBHOOK_URL in Cloudflare Worker secrets so the 6-digit verification code can be sent to ' +
        params.toEmail +
        '.',
    };
  }

  const res = await dispatchHttpEmail(transport, {
    to: [params.toEmail],
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

  if (!res.ok) {
    return { ok: false, message: res.error || 'Failed to send verification code email.' };
  }
  return {
    ok: true,
    message: `6-digit verification code sent from ${transport.fromEmail} to ${params.toEmail} (ID: ${res.messageId}). Check Inbox and Spam/Promotions.`,
  };
}

export async function sendWorkerPasswordChangedNoticeEmail(
  env: WorkerEnv,
  toEmail: string
): Promise<void> {
  if (!isEmailEnabled(env)) return;
  const transport = await resolveWorkerEmailTransport(env);
  if (transport.mode === 'none' || transport.mode === 'legacy_smtp_only') return;
  try {
    await dispatchHttpEmail(transport, {
      to: [toEmail],
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

export async function sendWorkerSavedUpcomingFoEmail(
  env: WorkerEnv,
  params: {
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
  }
): Promise<{ ok: boolean; message: string; log?: ReminderDeliveryLog }> {
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

  if (!isEmailEnabled(env)) {
    return {
      ok: false,
      message:
        'Outgoing email is temporarily disabled (EMAIL_ENABLED=false). Set EMAIL_ENABLED=true when ready to send emails.',
    };
  }

  const inputOffset = Math.max(1, ruleOptions.inputStartOffsetDays ?? 10);
  const foOffset = Math.max(1, ruleOptions.upcomingFoOffsetDays ?? 15);
  const validEmails = Array.from(
    new Set(toEmails.map((e) => e.trim()).filter((e) => EMAIL_REGEX.test(e)))
  );

  if (validEmails.length === 0) {
    return { ok: false, message: 'Please enter at least one valid recipient email address.' };
  }

  const transport = await resolveWorkerEmailTransport(env);
  if (transport.mode === 'none' || transport.mode === 'legacy_smtp_only') {
    return {
      ok: false,
      message:
        'Cloudflare Worker email provider not configured. Set RESEND_API_KEY or EMAIL_WEBHOOK_URL via `wrangler secret put`.',
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
  const finalBodyText = (bodyText || '').trim() || DEFAULT_SAVED_FO_EMAIL_BODY;

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
          <tbody>${tableRowsHtml}</tbody>
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
    const attachments: HttpEmailAttachment[] = [];
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

    const res = await dispatchHttpEmail(transport, {
      to: validEmails,
      subject: finalSubject,
      text: textLines,
      html,
      attachments,
    });

    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType: 'Manual Send',
      recipientCount: validEmails.length,
      recipients: validEmails,
      urgentLineCount: urgentCount,
      dueSoonLineCount: dueSoonCount,
      cutting10dCount: 0,
      status: res.ok ? 'Sent' : 'Failed',
      message: res.ok
        ? `Sent Saved Upcoming FO Box (${rows.length} items${attachXlsx ? `, ${xlsxFilename} attached` : ''}) to ${validEmails.join(', ')} (ID: ${res.messageId || 'ok'}).`
        : res.error || 'Failed to send Saved Upcoming FO email.',
    };
    await appendReminderDeliveryLogD1(env, log);

    return {
      ok: res.ok,
      log,
      message: res.ok
        ? `Email sent to ${validEmails.join(', ')} with ${rows.length} Saved Upcoming FO item(s)${attachXlsx ? ' and .xlsx attachment' : ''}.`
        : res.error || `Delivery failed to ${validEmails.join(', ')}.`,
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
    await appendReminderDeliveryLogD1(env, log);
    return { ok: false, log, message: errMsg };
  }
}

export function getZonedDateTime(timeZone: string): {
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

export async function runScheduledReminderCheckWorker(env: WorkerEnv): Promise<void> {
  if (!isEmailEnabled(env)) return;
  const state = await getWorkspaceStateD1(env);
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
    return true;
  });

  if (dueRecipients.length === 0) return;

  await updateReminderScheduleD1(env, { lastAttemptIso: new Date().toISOString() });

  const appUrl = (env.APP_URL || '').trim().replace(/\/+$/, '') ||
    'https://shakhawatsvlog-lab.github.io/Cluster-1-Planning-FO-Control-Tower';

  const result = await sendWorkerShortcutReminderEmails(env, {
    recipients: dueRecipients,
    meta: state.meta,
    records: state.records,
    cuttingEntries: state.cuttingEntries,
    referenceDateIso: dateLocal,
    alertScope: schedule.alertScope,
    customMessage: schedule.customMessage,
    triggerType: 'Automatic Scheduled',
    appUrl,
    ruleOptions: {
      inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
      upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
      cuttingAlertDays: state.siteConfig.cuttingAlertDays,
    },
  });

  for (const rid of result.succeededRecipientIds) {
    await updateReminderRecipientD1(env, rid, { lastSentDateLocal: dateLocal });
  }
  if (result.succeededRecipientIds.length > 0) {
    await updateReminderScheduleD1(env, { lastSentDateLocal: dateLocal });
  }
}
