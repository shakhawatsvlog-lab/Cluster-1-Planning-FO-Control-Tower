import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  FactoryName,
  MasterPlanMeta,
  PlanningRecord,
} from '../shared/plannerTypes.ts';
import { buildShortcutEmailDigest } from '../shared/reminderDigest.ts';
import {
  EMAIL_REGEX,
  TIMEZONE_OPTIONS,
} from '../shared/reminderTypes.ts';
import type {
  ReminderAlertScope,
  ReminderRecipient,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpProviderPreset,
  SmtpSettingsPublic,
} from '../shared/reminderTypes.ts';

interface EmailRemindersViewProps {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  reminders: ReminderWorkspaceState;
  smtpStatus: SmtpSettingsPublic;
  appUrl: string;
  onUpdateSchedule: (patch: Partial<ReminderScheduleConfig>) => Promise<void>;
  onSaveSmtp: (payload: {
    providerPreset: SmtpProviderPreset;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromName: string;
    fromEmail: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onVerifySmtp: () => Promise<{ ok: boolean; message: string }>;
  onResetSmtp: () => Promise<void>;
  onAddRecipient: (payload: {
    name: string;
    email: string;
    role: string;
    factories: FactoryName[];
  }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateRecipient: (
    id: string,
    patch: Partial<{
      name: string;
      email: string;
      role: string;
      factories: FactoryName[];
      active: boolean;
    }>
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteRecipient: (id: string) => Promise<void>;
  onSendNow: (recipientId?: string) => Promise<{ ok: boolean; message: string }>;
}

export function EmailRemindersView({
  meta,
  records,
  cuttingEntries,
  referenceDateIso,
  reminders,
  smtpStatus,
  appUrl,
  onUpdateSchedule,
  onSaveSmtp,
  onVerifySmtp,
  onResetSmtp,
  onAddRecipient,
  onUpdateRecipient,
  onDeleteRecipient,
  onSendNow,
}: EmailRemindersViewProps) {
  // Add Recipient Form State
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [roleInput, setRoleInput] = useState('Merchandising & Planning');
  const [selectedFactories, setSelectedFactories] = useState<FactoryName[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Edit Existing Recipient Inline State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editFactories, setEditFactories] = useState<FactoryName[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Hosting / Sender SMTP Form State
  const [smtpOpen, setSmtpOpen] = useState(!smtpStatus.configured);
  const [providerPreset, setProviderPreset] = useState<SmtpProviderPreset>(
    smtpStatus.providerPreset || 'custom'
  );
  const [smtpHost, setSmtpHost] = useState(smtpStatus.host || '');
  const [smtpPort, setSmtpPort] = useState(String(smtpStatus.port || 465));
  const [smtpSecure, setSmtpSecure] = useState(smtpStatus.secure ?? true);
  const [smtpUser, setSmtpUser] = useState(smtpStatus.user || '');
  const [smtpPass, setSmtpPass] = useState('');
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [smtpFromName, setSmtpFromName] = useState(
    smtpStatus.fromName || 'Alex Apparels Planning'
  );
  const [smtpFromEmail, setSmtpFromEmail] = useState(smtpStatus.fromEmail || '');
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpFeedback, setSmtpFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Sync SMTP form defaults when server smtpStatus updates
  useEffect(() => {
    setProviderPreset(smtpStatus.providerPreset || 'custom');
    setSmtpHost(smtpStatus.host || '');
    setSmtpPort(String(smtpStatus.port || 465));
    setSmtpSecure(smtpStatus.secure ?? true);
    setSmtpUser(smtpStatus.user || '');
    setSmtpFromName(smtpStatus.fromName || 'Alex Apparels Planning');
    setSmtpFromEmail(smtpStatus.fromEmail || '');
  }, [smtpStatus]);

  // Send & Copy States
  const [sendingNow, setSendingNow] = useState(false);
  const [sendingTargetId, setSendingTargetId] = useState<string | null>(null);
  const [sendFeedback, setSendFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [copiedDigest, setCopiedDigest] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { schedule, recipients, logs } = reminders;
  const activeRecipients = recipients.filter((r) => r.active);

  const liveDigest = useMemo(
    () =>
      buildShortcutEmailDigest({
        meta,
        records,
        cuttingEntries,
        referenceDateIso,
        alertScope: schedule.alertScope,
        appUrl: appUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
      }),
    [meta, records, cuttingEntries, referenceDateIso, schedule.alertScope, appUrl]
  );

  const handlePresetChange = (preset: SmtpProviderPreset) => {
    setProviderPreset(preset);
    if (preset === 'gmail') {
      setSmtpHost('smtp.gmail.com');
      setSmtpPort('465');
      setSmtpSecure(true);
    } else if (preset === 'outlook') {
      setSmtpHost('smtp.office365.com');
      setSmtpPort('587');
      setSmtpSecure(false);
    } else if (smtpHost === 'smtp.gmail.com' || smtpHost === 'smtp.office365.com') {
      setSmtpHost('');
      setSmtpPort('465');
      setSmtpSecure(true);
    }
  };

  const handleSaveSmtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpFeedback(null);
    setSavingSmtp(true);
    try {
      const res = await onSaveSmtp({
        providerPreset,
        host: smtpHost.trim(),
        port: Number(smtpPort) || 465,
        secure: smtpSecure,
        user: smtpUser.trim(),
        pass: smtpPass,
        fromName: smtpFromName.trim(),
        fromEmail: (smtpFromEmail || smtpUser).trim(),
      });
      if (!res.ok) {
        setSmtpFeedback({
          ok: false,
          text: res.error || 'Could not save hosting email configuration.',
        });
        return;
      }
      setSmtpPass('');
      setSmtpFeedback({
        ok: true,
        text: 'Hosting sender email & credentials saved. Click "Test Connection" to verify delivery.',
      });
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    setSmtpFeedback(null);
    setTestingSmtp(true);
    try {
      const res = await onVerifySmtp();
      setSmtpFeedback({ ok: res.ok, text: res.message });
    } finally {
      setTestingSmtp(false);
    }
  };

  const toggleFactoryChoice = (factory: FactoryName) => {
    setSelectedFactories((prev) =>
      prev.includes(factory) ? prev.filter((f) => f !== factory) : [...prev, factory]
    );
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedEmail = emailInput.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setFormError('Please enter a valid email address (e.g. planner@alexapparels.com).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await onAddRecipient({
        name: nameInput.trim(),
        email: trimmedEmail,
        role: roleInput.trim() || 'Merchandising & Planning',
        factories: selectedFactories,
      });
      if (!res.ok) {
        setFormError(res.error || 'Could not add email recipient.');
        return;
      }
      setNameInput('');
      setEmailInput('');
      setSelectedFactories([]);
    } finally {
      setSubmitting(false);
    }
  };

  const startEditRecipient = (recip: ReminderRecipient) => {
    setEditingId(recip.id);
    setEditName(recip.name);
    setEditEmail(recip.email);
    setEditRole(recip.role);
    setEditFactories(recip.factories);
    setEditError(null);
  };

  const toggleEditFactory = (factory: FactoryName) => {
    setEditFactories((prev) =>
      prev.includes(factory) ? prev.filter((f) => f !== factory) : [...prev, factory]
    );
  };

  const saveEditRecipient = async () => {
    if (!editingId) return;
    setEditError(null);
    const cleanEmail = editEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setEditError('Invalid email format.');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await onUpdateRecipient(editingId, {
        name: editName.trim() || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: editRole.trim() || 'Merchandising / Planning',
        factories: editFactories,
      });
      if (!res.ok) {
        setEditError(res.error || 'Failed to update recipient.');
        return;
      }
      setEditingId(null);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTriggerSend = async (recipientId?: string) => {
    setSendFeedback(null);
    setSendingNow(true);
    setSendingTargetId(recipientId ?? null);
    try {
      const result = await onSendNow(recipientId);
      setSendFeedback({ ok: result.ok, text: result.message });
    } finally {
      setSendingNow(false);
      setSendingTargetId(null);
    }
  };

  const handleCopyDigest = async () => {
    try {
      await navigator.clipboard.writeText(`${liveDigest.subject}\n\n${liveDigest.text}`);
      setCopiedDigest(true);
      setTimeout(() => setCopiedDigest(false), 2500);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleCopyWebsiteUrl = async () => {
    const urlToCopy =
      appUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!urlToCopy) return;
    try {
      await navigator.clipboard.writeText(urlToCopy);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // Ignore clipboard errors
    }
  };

  const mailtoHref = useMemo(() => {
    const toList = activeRecipients.map((r) => r.email).join(',');
    const subject = encodeURIComponent(liveDigest.subject);
    const body = encodeURIComponent(liveDigest.text.slice(0, 1800));
    return `mailto:${toList}?subject=${subject}&body=${body}`;
  }, [activeRecipients, liveDigest]);

  return (
    <div className="space-y-6">
      {/* Top Row: Automatic Daily Schedule & Website Publishing */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Daily Automatic Shortcut Summary Reminder
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically emails the daily Factory &amp; Line Fabric Order Shortcut Summary so you know which PG &amp; style needs fabric ordering.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onUpdateSchedule({ enabled: !schedule.enabled })}
              className={`h-9 px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                schedule.enabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                  : 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {schedule.enabled ? 'Auto Daily Send: ON' : 'Auto Daily Send: PAUSED'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="daily-send-time" className="text-xs font-medium text-slate-500">
                Daily Send Time
              </label>
              <input
                id="daily-send-time"
                type="time"
                value={schedule.dailySendTime}
                onChange={(e) => {
                  if (e.target.value) {
                    onUpdateSchedule({ dailySendTime: e.target.value });
                  }
                }}
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="reminder-timezone" className="text-xs font-medium text-slate-500">
                Schedule Timezone
              </label>
              <select
                id="reminder-timezone"
                value={schedule.timezone}
                onChange={(e) => onUpdateSchedule({ timezone: e.target.value })}
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="reminder-scope" className="text-xs font-medium text-slate-500">
                Reminder Digest Scope
              </label>
              <select
                id="reminder-scope"
                value={schedule.alertScope}
                onChange={(e) =>
                  onUpdateSchedule({ alertScope: e.target.value as ReminderAlertScope })
                }
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="urgent_and_due_soon">FO Needed &amp; Due Soon</option>
                <option value="urgent_only">Urgent FO Only (Now / Cut &le;10D)</option>
                <option value="all_lines">All Active Lines</option>
              </select>
            </div>
          </div>

          {/* Hosting Email Sender Bar */}
          <div
            className={`rounded-lg border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3 ${
              smtpStatus.configured
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                : 'bg-amber-50/80 border-amber-200 text-amber-900'
            }`}
          >
            <div>
              {smtpStatus.configured ? (
                <span>
                  Sending from <span className="font-mono font-semibold">{smtpStatus.senderEmail}</span>{' '}
                  via <span className="font-mono">{smtpStatus.host}:{smtpStatus.port}</span>. Daily emails run automatically at{' '}
                  <span className="font-mono font-semibold">{schedule.dailySendTime}</span> ({schedule.timezone}).
                </span>
              ) : (
                <span>
                  Hosting / Sender Email is not configured yet. Set your hosting email, password, and SMTP host below to enable automatic daily sending.
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSmtpOpen((prev) => !prev)}
              className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              {smtpOpen ? 'Hide Hosting Email Box' : 'Change Hosting Email / Password'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={sendingNow || activeRecipients.length === 0}
              onClick={() => handleTriggerSend()}
              className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4 shrink-0" />
              <span>
                {sendingNow && !sendingTargetId
                  ? 'Sending Digest...'
                  : `Send Reminder Now (${activeRecipients.length})`}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCopyDigest}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedDigest ? (
                <>
                  <Check className="w-4 h-4 text-emerald-600" />
                  <span>Summary Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-500" />
                  <span>Copy Summary</span>
                </>
              )}
            </button>

            <a
              href={mailtoHref}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-4 h-4 text-slate-500" />
              <span>Open in Mail App</span>
            </a>

            {schedule.lastSentDateLocal && (
              <span className="text-xs text-slate-500 ml-auto font-mono">
                Last auto run: {schedule.lastSentDateLocal}
              </span>
            )}
          </div>

          {sendFeedback && (
            <div
              className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                sendFeedback.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              {sendFeedback.text}
            </div>
          )}
        </section>

        {/* Publish & Share Website Card */}
        <section className="xl:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Website Publishing &amp; Live Sync
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              All master plan updates, <span className="font-semibold">Order Closed</span> changes, daily cutting entries, hosting email settings, and reminder recipients sync directly to the server.
            </p>
            <div className="pt-2 space-y-1.5 text-xs text-slate-600">
              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span>Active Lines Tracked</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {meta.totalLines} ({meta.totalCapacityMc.toLocaleString()} Mc)
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span>Active Email Recipients</span>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  {activeRecipients.length} / {recipients.length}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>Lines in Next Digest</span>
                <span className="font-mono font-semibold text-blue-700 tabular-nums">
                  {liveDigest.includedRows.length} lines
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyWebsiteUrl}
            className="w-full h-10 px-3.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-900 text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {copiedUrl ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span>Website Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-500" />
                <span>Copy Website Link</span>
              </>
            )}
          </button>
        </section>
      </div>

      {/* Hosting / Sender Email Settings Box */}
      {smtpOpen && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Server className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Hosting / Sender Email Configuration (SMTP)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Change your hosting email, password/app password, SMTP server, port, or sender display name anytime without redeploying.
                </p>
              </div>
            </div>

            {smtpStatus.source === 'workspace' && (
              <button
                type="button"
                onClick={async () => {
                  await onResetSmtp();
                  setSmtpPass('');
                  setSmtpFeedback({
                    ok: true,
                    text: 'Custom hosting email settings cleared.',
                  });
                }}
                className="h-8 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear Saved Hosting Email</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSaveSmtpSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="smtp-preset" className="text-xs font-medium text-slate-600">
                  Mail Provider Preset
                </label>
                <select
                  id="smtp-preset"
                  value={providerPreset}
                  onChange={(e) => handlePresetChange(e.target.value as SmtpProviderPreset)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="custom">Custom Hosting / cPanel / Webmail</option>
                  <option value="gmail">Gmail (Google App Password)</option>
                  <option value="outlook">Outlook / Microsoft 365</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="smtp-user" className="text-xs font-medium text-slate-600">
                  Hosting Email / SMTP Username *
                </label>
                <input
                  id="smtp-user"
                  type="text"
                  required
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="e.g. planning@yourcompany.com"
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="smtp-pass" className="text-xs font-medium text-slate-600">
                  Hosting Password / App Password {smtpStatus.hasPassword ? '(saved)' : '*'}
                </label>
                <div className="relative">
                  <input
                    id="smtp-pass"
                    type={showSmtpPass ? 'text' : 'password'}
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                    placeholder={
                      smtpStatus.hasPassword
                        ? 'Leave blank to keep current password'
                        : 'Enter hosting email password'
                    }
                    className="w-full h-10 pl-3 pr-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPass((v) => !v)}
                    aria-label={showSmtpPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="smtp-host" className="text-xs font-medium text-slate-600">
                  SMTP Host Server *
                </label>
                <input
                  id="smtp-host"
                  type="text"
                  required
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="e.g. mail.yourdomain.com or smtp.gmail.com"
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="smtp-port" className="text-xs font-medium text-slate-600">
                    SMTP Port
                  </label>
                  <input
                    id="smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={smtpPort}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSmtpPort(val);
                      if (val === '465') setSmtpSecure(true);
                      if (val === '587') setSmtpSecure(false);
                    }}
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="smtp-secure" className="text-xs font-medium text-slate-600">
                    Encryption
                  </label>
                  <select
                    id="smtp-secure"
                    value={smtpSecure ? 'ssl' : 'starttls'}
                    onChange={(e) => setSmtpSecure(e.target.value === 'ssl')}
                    className="h-10 px-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="ssl">SSL/TLS (465)</option>
                    <option value="starttls">STARTTLS (587)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="smtp-from-name" className="text-xs font-medium text-slate-600">
                    Sender Name
                  </label>
                  <input
                    id="smtp-from-name"
                    type="text"
                    value={smtpFromName}
                    onChange={(e) => setSmtpFromName(e.target.value)}
                    placeholder="Alex Apparels Planning"
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="smtp-from-email" className="text-xs font-medium text-slate-600">
                    Sender Email (From)
                  </label>
                  <input
                    id="smtp-from-email"
                    type="email"
                    value={smtpFromEmail}
                    onChange={(e) => setSmtpFromEmail(e.target.value)}
                    placeholder="Same as Hosting Email"
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            </div>

            {smtpFeedback && (
              <div
                className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                  smtpFeedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {smtpFeedback.text}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="submit"
                disabled={savingSmtp}
                className="h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingSmtp ? 'Saving Hosting Email...' : 'Save Hosting Email Settings'}</span>
              </button>

              <button
                type="button"
                disabled={testingSmtp || !smtpStatus.configured}
                onClick={handleTestSmtp}
                className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs sm:text-sm font-medium transition-colors cursor-pointer"
              >
                {testingSmtp ? 'Testing Connection...' : 'Test Connection'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Add Email Recipient Form + Editable Recipient Directory */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Add Reminder Email Address
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Add merchandising, fabric procurement, or planning team emails to receive daily FO reminders.
            </p>
          </div>

          <form onSubmit={handleAddSubmit} className="space-y-3.5">
            <div className="flex flex-col gap-1">
              <label htmlFor="recip-email" className="text-xs font-medium text-slate-600">
                Email Address *
              </label>
              <input
                id="recip-email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="e.g. fabric.planning@alexapparels.com"
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="recip-name" className="text-xs font-medium text-slate-600">
                  Contact Name
                </label>
                <input
                  id="recip-name"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. Shakhawat"
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="recip-role" className="text-xs font-medium text-slate-600">
                  Department / Role
                </label>
                <input
                  id="recip-role"
                  type="text"
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  placeholder="e.g. Fabric Team"
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-600 block">
                Factory Filter (leave all unchecked for All 4 Factories)
              </span>
              <div className="flex flex-wrap gap-2">
                {ALLOWED_FACTORIES.map((factory) => {
                  const checked = selectedFactories.includes(factory);
                  return (
                    <button
                      key={factory}
                      type="button"
                      onClick={() => toggleFactoryChoice(factory)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        checked
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {factory}
                    </button>
                  );
                })}
              </div>
            </div>

            {formError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? 'Adding Email...' : 'Add Email to Daily Reminder List'}</span>
            </button>
          </form>
        </section>

        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Reminder Recipient List ({recipients.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Click the edit icon on any row to change a recipient email address or factory filter.
              </p>
            </div>
          </div>

          {editError && (
            <div className="mx-4 mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {editError}
            </div>
          )}

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-3.5">Recipient</th>
                  <th className="py-2.5 px-3.5">Role</th>
                  <th className="py-2.5 px-3.5">Factories</th>
                  <th className="py-2.5 px-3.5">Status</th>
                  <th className="py-2.5 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {recipients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                      <Mail className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                      No email addresses added yet. Use the form on the left to add recipients for daily FO reminders.
                    </td>
                  </tr>
                ) : (
                  recipients.map((recip) => {
                    const isEditing = editingId === recip.id;
                    if (isEditing) {
                      return (
                        <tr key={recip.id} className="bg-blue-50/40">
                          <td className="py-2.5 px-3.5 space-y-1.5">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Name"
                              className="w-full h-8 px-2 rounded border border-slate-300 bg-white text-xs text-slate-900"
                            />
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="Email address"
                              className="w-full h-8 px-2 rounded border border-slate-300 bg-white font-mono text-xs text-slate-900"
                            />
                          </td>
                          <td className="py-2.5 px-3.5 align-top">
                            <input
                              type="text"
                              value={editRole}
                              onChange={(e) => setEditRole(e.target.value)}
                              placeholder="Role"
                              className="w-full h-8 px-2 rounded border border-slate-300 bg-white text-xs text-slate-900"
                            />
                          </td>
                          <td className="py-2.5 px-3.5 align-top">
                            <div className="flex flex-wrap gap-1">
                              {ALLOWED_FACTORIES.map((f) => {
                                const active = editFactories.includes(f);
                                return (
                                  <button
                                    key={f}
                                    type="button"
                                    onClick={() => toggleEditFactory(f)}
                                    className={`px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer ${
                                      active
                                        ? 'bg-slate-900 border-slate-900 text-white'
                                        : 'bg-white border-slate-300 text-slate-700'
                                    }`}
                                  >
                                    {f}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 align-top text-slate-500">Editing</td>
                          <td className="py-2.5 px-3.5 align-top text-right whitespace-nowrap space-x-1.5">
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={saveEditRecipient}
                              className="px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 text-white text-[11px] font-medium cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(null);
                                setEditError(null);
                              }}
                              aria-label="Cancel edit"
                              className="p-1 rounded border border-slate-300 bg-white text-slate-600 hover:text-slate-900 align-middle cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={recip.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3.5">
                          <div className="font-semibold text-slate-900">{recip.name}</div>
                          <div className="font-mono text-[11px] text-slate-600">{recip.email}</div>
                        </td>
                        <td className="py-2.5 px-3.5 text-slate-600">{recip.role}</td>
                        <td className="py-2.5 px-3.5 text-slate-700 font-mono text-[11px]">
                          {recip.factories.length === 0
                            ? 'All (ALEX 1,3,5,12)'
                            : recip.factories.join(', ')}
                        </td>
                        <td className="py-2.5 px-3.5">
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateRecipient(recip.id, { active: !recip.active })
                            }
                            className={`px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                              recip.active
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : 'bg-slate-100 border-slate-300 text-slate-600'
                            }`}
                          >
                            {recip.active ? 'Active' : 'Paused'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            disabled={sendingNow}
                            onClick={() => handleTriggerSend(recip.id)}
                            className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                          >
                            {sendingNow && sendingTargetId === recip.id ? 'Sending...' : 'Send Now'}
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditRecipient(recip)}
                            aria-label={`Edit ${recip.email}`}
                            className="p-1.5 rounded border border-slate-200 text-slate-500 hover:text-blue-700 hover:border-blue-200 hover:bg-blue-50 align-middle cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRecipient(recip.id)}
                            aria-label={`Remove ${recip.email}`}
                            className="p-1.5 rounded border border-slate-200 text-slate-500 hover:text-red-700 hover:border-red-200 hover:bg-red-50 align-middle cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Live Daily Email Digest Preview */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Daily Email Digest Preview
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 font-mono truncate">
              Subject: {liveDigest.subject}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
            <span className="text-red-700 font-semibold">
              {liveDigest.urgentLineCount} FO Now
            </span>
            <span className="text-amber-700 font-semibold">
              {liveDigest.dueSoonLineCount} Due Soon
            </span>
            <span className="text-slate-700">
              {liveDigest.cutting10dCount} Cutting &le; 10D
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {liveDigest.factoryDigest.map((f) => (
              <div
                key={f.factory}
                className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 text-xs space-y-1"
              >
                <div className="flex items-center justify-between font-bold text-slate-900">
                  <span>{f.factory}</span>
                  <span className="font-mono font-normal text-slate-500">{f.totalLines} lines</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-mono text-lg font-bold tabular-nums ${
                      f.foNowCount > 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {f.foNowCount}
                  </span>
                  <span className="text-slate-600">FO now · {f.dueSoonCount} due soon</span>
                </div>
                <div className="text-[11px] text-slate-600 font-mono">
                  Earliest: {f.earliestNextPg} (FO {f.earliestFoTriggerDisplay})
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2 px-3">Factory · Line</th>
                  <th className="py-2 px-3">Running PG &amp; Style</th>
                  <th className="py-2 px-3">Next PG &amp; Upcoming Style</th>
                  <th className="py-2 px-3">Input Start</th>
                  <th className="py-2 px-3">FO Trigger (In-20D)</th>
                  <th className="py-2 px-3">Alert / Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {liveDigest.includedRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No lines match the selected digest filter right now. Switch Digest Scope to &ldquo;All Active Lines&rdquo; to include every line in the daily email.
                    </td>
                  </tr>
                ) : (
                  liveDigest.includedRows.slice(0, 20).map((s) => (
                    <tr key={`${s.factory}-${s.line}`}>
                      <td className="py-2 px-3 whitespace-nowrap font-semibold text-slate-900">
                        {s.factory} · {s.line}
                      </td>
                      <td className="py-2 px-3 max-w-[220px]">
                        <div className="font-mono font-semibold text-slate-900">
                          {s.runningRecord?.pgNumber ?? '—'}
                        </div>
                        <div className="text-slate-600 truncate">
                          {s.runningRecord?.style ?? '—'}
                        </div>
                      </td>
                      <td className="py-2 px-3 max-w-[220px]">
                        <div className="font-mono font-semibold text-blue-700">
                          {s.upcomingRecord?.pgNumber ?? '—'}
                        </div>
                        <div className="text-slate-700 truncate">
                          {s.upcomingRecord?.style ?? 'No upcoming style'}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap text-slate-700">
                        {formatDisplayDate(s.newStyleInputStartIso)}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap font-semibold text-slate-900">
                        {formatDisplayDate(s.upcomingFoTriggerIso)}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`font-semibold ${
                            s.summarySeverity === 'critical'
                              ? 'text-red-700'
                              : s.summarySeverity === 'warning'
                                ? 'text-amber-700'
                                : 'text-blue-700'
                          }`}
                        >
                          {s.summaryStatus}
                        </span>
                        <div className="text-[11px] text-slate-500">{s.foNeedReason}</div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {liveDigest.includedRows.length > 20 && (
            <div className="text-xs text-slate-500">
              Showing first 20 of {liveDigest.includedRows.length} lines in preview; the full email includes all {liveDigest.includedRows.length} lines.
            </div>
          )}
        </div>
      </section>

      {/* Reminder Delivery History */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Reminder Delivery Log ({logs.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3.5">Date &amp; Time</th>
                <th className="py-2.5 px-3.5">Trigger</th>
                <th className="py-2.5 px-3.5">Recipients</th>
                <th className="py-2.5 px-3.5">Alert Snapshot</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No reminder emails dispatched yet.
                  </td>
                </tr>
              ) : (
                logs.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap text-slate-700">
                      {entry.sentAtIso.slice(0, 16).replace('T', ' ')} UTC
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-800 font-medium">
                      {entry.triggerType}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono text-[11px] text-slate-600">
                      {entry.recipients.length > 0 ? entry.recipients.join(', ') : '—'}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap text-slate-700">
                      {entry.urgentLineCount} Urgent · {entry.dueSoonLineCount} Due Soon
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                          entry.status === 'Sent'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : entry.status === 'SMTP Not Configured'
                              ? 'bg-amber-50 border-amber-200 text-amber-800'
                              : 'bg-red-50 border-red-200 text-red-800'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-600">{entry.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
