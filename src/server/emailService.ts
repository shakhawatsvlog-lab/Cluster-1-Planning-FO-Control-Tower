import nodemailer from 'nodemailer';
import { ALLOWED_FACTORIES } from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  FactoryName,
  MasterPlanMeta,
  PlanningRecord,
} from '../shared/plannerTypes.ts';
import { buildShortcutEmailDigest } from '../shared/reminderDigest.ts';
import type {
  ReminderAlertScope,
  ReminderDeliveryLog,
  ReminderRecipient,
  SmtpProviderPreset,
  SmtpSettingsPublic,
} from '../shared/reminderTypes.ts';
import { appendReminderDeliveryLog, getStoredSmtpConfig } from './workspaceStore.ts';

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
}

function inferPresetFromHost(host: string, user: string): SmtpProviderPreset {
  const h = host.toLowerCase();
  const u = user.toLowerCase();
  if (h.includes('gmail') || u.endsWith('@gmail.com')) return 'gmail';
  if (h.includes('outlook') || h.includes('office365')) return 'outlook';
  return 'custom';
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

  const rawFrom = (process.env.SMTP_FROM || '').trim();
  const fromName = 'Alex Apparels Planning';
  const fromEmail = user;
  const fromHeader = rawFrom || `"${fromName}" <${fromEmail}>`;

  return {
    source: 'env',
    providerPreset: inferPresetFromHost(host, user),
    host,
    port,
    secure,
    user,
    pass,
    fromName,
    fromEmail,
    fromHeader,
  };
}

function resolveSmtpConfig(): ResolvedSmtpConfig | null {
  const stored = getStoredSmtpConfig();
  if (stored && stored.host.trim() && stored.user.trim() && stored.pass.trim()) {
    const fromEmail = (stored.fromEmail || stored.user).trim();
    const fromName = (stored.fromName || 'Alex Apparels Planning').trim();
    const fromHeader = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
    return {
      source: 'workspace',
      providerPreset: stored.providerPreset || inferPresetFromHost(stored.host, stored.user),
      host: stored.host.trim(),
      port: Number(stored.port) || 465,
      secure: Boolean(stored.secure),
      user: stored.user.trim(),
      pass: stored.pass,
      fromName,
      fromEmail,
      fromHeader,
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
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });
    await transporter.verify();
    return {
      ok: true,
      message: `Connected successfully to ${smtp.host}:${smtp.port} as ${smtp.user}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMTP connection failed';
    return {
      ok: false,
      message: msg,
    };
  }
}

function getFactoryScopeKey(factories: FactoryName[]): string {
  if (!factories || factories.length === 0 || factories.length >= ALLOWED_FACTORIES.length) {
    return 'ALL';
  }
  return [...factories].sort().join(',');
}

export async function sendShortcutReminderEmails(params: {
  recipients: ReminderRecipient[];
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  alertScope: ReminderAlertScope;
  triggerType: 'Automatic Daily' | 'Manual Send';
  appUrl?: string;
}): Promise<{
  ok: boolean;
  log: ReminderDeliveryLog;
}> {
  const {
    recipients,
    meta,
    records,
    cuttingEntries,
    referenceDateIso,
    alertScope,
    triggerType,
    appUrl,
  } = params;

  const activeRecipients = recipients.filter((r) => r.active);
  const recipientEmails = activeRecipients.map((r) => r.email);

  const summaryDigest = buildShortcutEmailDigest({
    meta,
    records,
    cuttingEntries,
    referenceDateIso,
    alertScope,
    appUrl,
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
    return { ok: false, log };
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
        'Configure your Hosting Sender Email & Password in the Hosting Email Settings box above.',
    };
    appendReminderDeliveryLog(log);
    return { ok: false, log };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    const groups = new Map<string, ReminderRecipient[]>();
    for (const r of activeRecipients) {
      const key = getFactoryScopeKey(r.factories);
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    for (const [key, groupRecipients] of groups.entries()) {
      const factoryFilter =
        key === 'ALL' ? undefined : (key.split(',') as FactoryName[]);
      const digest = buildShortcutEmailDigest({
        meta,
        records,
        cuttingEntries,
        referenceDateIso,
        alertScope,
        factoryFilter,
        appUrl,
      });

      await transporter.sendMail({
        from: smtp.fromHeader,
        to: groupRecipients.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)).join(', '),
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      });
    }

    const log: ReminderDeliveryLog = {
      id: `REM-${Date.now().toString(36).toUpperCase()}`,
      sentAtIso: new Date().toISOString(),
      triggerType,
      recipientCount: activeRecipients.length,
      recipients: recipientEmails,
      urgentLineCount: summaryDigest.urgentLineCount,
      dueSoonLineCount: summaryDigest.dueSoonLineCount,
      cutting10dCount: summaryDigest.cutting10dCount,
      status: 'Sent',
      message: `Delivered from ${smtp.fromEmail} to ${activeRecipients.length} recipient(s) via ${smtp.host}.`,
    };
    appendReminderDeliveryLog(log);
    return { ok: true, log };
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
    return { ok: false, log };
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
        'Hosting / Sender Email (SMTP) is not configured yet. Configure your Hosting Email & Password below in Control Panel → Hosting Email Settings first so the 6-digit verification code can be sent to ' +
        params.toEmail +
        '.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });

    await transporter.sendMail({
      from: smtp.fromHeader,
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

    return {
      ok: true,
      message: `6-digit verification code sent to ${params.toEmail}. Please check your inbox (and spam folder).`,
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
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });
    await transporter.sendMail({
      from: smtp.fromHeader,
      to: toEmail,
      subject: '[Alex Apparels Control Panel] Admin Password Updated',
      text: `Your Alex Apparels Control Panel password was updated on ${new Date().toISOString()}.`,
    });
  } catch {
    // Best-effort notification
  }
}
