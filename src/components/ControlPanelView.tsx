import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Unlock,
  Upload,
} from 'lucide-react';
import type {
  DailyCuttingEntry,
  MasterPlanMeta,
  OrderStatus,
  PlanningRecord,
} from '../shared/plannerTypes.ts';
import type {
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpSettingsPublic,
} from '../shared/reminderTypes.ts';
import type { WebsiteControlConfig } from '../shared/controlPanelTypes.ts';
import type { NavTab } from './Sidebar.tsx';

interface ControlPanelViewProps {
  adminUnlocked: boolean;
  siteConfig: WebsiteControlConfig;
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  reminders: ReminderWorkspaceState;
  smtpStatus: SmtpSettingsPublic;
  onUnlock: (password: string) => Promise<{ ok: boolean; error?: string }>;
  onLock: () => Promise<void>;
  onUpdateSiteConfig: (
    patch: Partial<WebsiteControlConfig>
  ) => Promise<{ ok: boolean; error?: string }>;
  onRequestPasswordCode: () => Promise<{
    ok: boolean;
    smtpMissing?: boolean;
    message: string;
  }>;
  onChangePassword: (payload: {
    code: string;
    newPassword: string;
  }) => Promise<{ ok: boolean; message: string }>;
  onUploadCsv: (csvText: string, fileName: string) => void;
  onResetPlan: () => Promise<void>;
  onDownloadXlsx: () => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  onReopenOrder: (id: string, status: OrderStatus) => void;
  onUpdateSchedule: (patch: Partial<ReminderScheduleConfig>) => Promise<void>;
  onSendReminderNow: () => Promise<{ ok: boolean; message: string }>;
  onNavigateTab: (tab: NavTab) => void;
}

export function ControlPanelView({
  adminUnlocked,
  siteConfig,
  meta,
  records,
  cuttingEntries,
  reminders,
  smtpStatus,
  onUnlock,
  onLock,
  onUpdateSiteConfig,
  onRequestPasswordCode,
  onChangePassword,
  onUploadCsv,
  onResetPlan,
  onDownloadXlsx,
  onDownloadBackup,
  onReopenOrder,
  onUpdateSchedule,
  onSendReminderNow,
  onNavigateTab,
}: ControlPanelViewProps) {
  // Unlock Gate State
  const [passwordInput, setPasswordInput] = useState('');
  const [showUnlockPass, setShowUnlockPass] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // Site Config Form State
  const [companyName, setCompanyName] = useState(siteConfig.companyName);
  const [portalTitle, setPortalTitle] = useState(siteConfig.portalTitle);
  const [readOnlyPublicMode, setReadOnlyPublicMode] = useState(siteConfig.readOnlyPublicMode);
  const [inputStartOffset, setInputStartOffset] = useState(String(siteConfig.inputStartOffsetDays));
  const [upcomingFoOffset, setUpcomingFoOffset] = useState(String(siteConfig.upcomingFoOffsetDays));
  const [cuttingAlertDays, setCuttingAlertDays] = useState(String(siteConfig.cuttingAlertDays));
  const [recoveryEmail, setRecoveryEmail] = useState(siteConfig.recoveryEmail);
  const [savingSiteConfig, setSavingSiteConfig] = useState(false);
  const [siteConfigFeedback, setSiteConfigFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Password Change + Email OTP State
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpFeedback, setOtpFeedback] = useState<{
    ok: boolean;
    smtpMissing?: boolean;
    text: string;
  } | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [changingPass, setChangingPass] = useState(false);
  const [passChangeFeedback, setPassChangeFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Data Controls State
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderFeedback, setReminderFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    setCompanyName(siteConfig.companyName);
    setPortalTitle(siteConfig.portalTitle);
    setReadOnlyPublicMode(siteConfig.readOnlyPublicMode);
    setInputStartOffset(String(siteConfig.inputStartOffsetDays));
    setUpcomingFoOffset(String(siteConfig.upcomingFoOffsetDays));
    setCuttingAlertDays(String(siteConfig.cuttingAlertDays));
    setRecoveryEmail(siteConfig.recoveryEmail);
  }, [siteConfig]);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError(null);
    setUnlocking(true);
    try {
      const res = await onUnlock(passwordInput);
      if (!res.ok) {
        setUnlockError(res.error || 'Incorrect password.');
        return;
      }
      setPasswordInput('');
    } finally {
      setUnlocking(false);
    }
  };

  if (!adminUnlocked) {
    return (
      <div className="min-h-[65vh] flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Website Control Panel
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Admin password required to access full website controls.
              </p>
            </div>
          </div>

          <form onSubmit={handleUnlockSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cp-password" className="text-xs font-medium text-slate-600">
                Control Panel Password
              </label>
              <div className="relative">
                <input
                  id="cp-password"
                  type={showUnlockPass ? 'text' : 'password'}
                  required
                  autoFocus
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter admin password"
                  className="w-full h-11 pl-3.5 pr-10 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowUnlockPass((v) => !v)}
                  aria-label={showUnlockPass ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showUnlockPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {unlockError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {unlockError}
              </div>
            )}

            <button
              type="submit"
              disabled={unlocking || !passwordInput}
              className="w-full h-11 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>{unlocking ? 'Verifying...' : 'Unlock Control Panel'}</span>
            </button>
          </form>

          <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Protected administration for {siteConfig.companyName} · Password changes require email code verification sent to{' '}
            <span className="font-mono text-slate-700">{siteConfig.recoveryEmail}</span>.
          </div>
        </div>
      </div>
    );
  }

  const closedRecords = records.filter(
    (r) => r.orderStatus === 'Order Closed' || r.isFinished
  );
  const activeRecipients = reminders.recipients.filter((r) => r.active);

  const handleSaveSiteSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiteConfigFeedback(null);
    setSavingSiteConfig(true);
    try {
      const res = await onUpdateSiteConfig({
        companyName: companyName.trim(),
        portalTitle: portalTitle.trim(),
        readOnlyPublicMode,
        inputStartOffsetDays: Number(inputStartOffset) || 10,
        upcomingFoOffsetDays: Number(upcomingFoOffset) || 20,
        cuttingAlertDays: Number(cuttingAlertDays) || 10,
        recoveryEmail: recoveryEmail.trim(),
      });
      setSiteConfigFeedback({
        ok: res.ok,
        text: res.ok
          ? 'Website settings and planning trigger rules saved.'
          : res.error || 'Failed to save website settings.',
      });
    } finally {
      setSavingSiteConfig(false);
    }
  };

  const handleRequestOtp = async () => {
    setOtpFeedback(null);
    setPassChangeFeedback(null);
    setOtpSending(true);
    try {
      const res = await onRequestPasswordCode();
      setOtpFeedback({
        ok: res.ok,
        smtpMissing: res.smtpMissing,
        text: res.message,
      });
      if (res.ok) {
        setOtpSent(true);
      }
    } finally {
      setOtpSending(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassChangeFeedback(null);
    if (newPassword.length < 6) {
      setPassChangeFeedback({
        ok: false,
        text: 'New password must be at least 6 characters long.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassChangeFeedback({
        ok: false,
        text: 'New password and confirmation do not match.',
      });
      return;
    }
    setChangingPass(true);
    try {
      const res = await onChangePassword({
        code: otpCode.trim(),
        newPassword,
      });
      setPassChangeFeedback({ ok: res.ok, text: res.message });
      if (res.ok) {
        setOtpCode('');
        setNewPassword('');
        setConfirmPassword('');
        setOtpSent(false);
      }
    } finally {
      setChangingPass(false);
    }
  };

  const handleCsvSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUploadCsv(reader.result, file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Admin Session Banner */}
      <div className="bg-slate-900 text-white rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <h2 className="font-display text-base font-bold">
              Master Website Control Panel
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Full control over website access mode, planning rules, master plan data, email reminders, and admin security.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLock}
          className="h-9 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Lock Control Panel</span>
        </button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Cluster Capacity</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {meta.totalLines} Lines · {meta.totalCapacityMc.toLocaleString()} Mc
          </div>
          <div className="text-xs text-slate-500 mt-1">{records.length} planned slots</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Closed Orders</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {closedRecords.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {cuttingEntries.length} cutting log entries
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Public Edit Access</div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">
            {siteConfig.readOnlyPublicMode ? 'Locked (Admin Only)' : 'Team Collaborative'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Changeable below anytime
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Daily Email Dispatch</div>
          <div className="mt-1.5 font-mono text-sm font-bold text-slate-900">
            {reminders.schedule.enabled ? `ON · ${reminders.schedule.dailySendTime}` : 'PAUSED'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {activeRecipients.length} active recipients
          </div>
        </div>
      </div>

      {/* Row 1: Website Settings + Admin Password Security */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Website Access, Branding & Planning Rules */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Website Access Mode, Branding &amp; Trigger Rules
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Control whether public website visitors can edit planning data, customize titles, and adjust FO trigger lead days.
            </p>
          </div>

          <form onSubmit={handleSaveSiteSettings} className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Website Editing Lock (Read-Only for Public Visitors)
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  When ON, visitors can view all dashboards and export Excel, while edits require unlocking this Control Panel.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReadOnlyPublicMode((v) => !v)}
                className={`h-9 px-3.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  readOnlyPublicMode
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                }`}
              >
                {readOnlyPublicMode ? 'Locked: Admin Only Edit' : 'Open: Team Can Edit'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="cp-company" className="text-xs font-medium text-slate-600">
                  Company Name
                </label>
                <input
                  id="cp-company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="cp-portal-title" className="text-xs font-medium text-slate-600">
                  Website Title / Subtitle
                </label>
                <input
                  id="cp-portal-title"
                  type="text"
                  value={portalTitle}
                  onChange={(e) => setPortalTitle(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="flex flex-col gap-1">
                <label htmlFor="cp-input-offset" className="text-xs font-medium text-slate-600">
                  Input Start (End &minus; Days)
                </label>
                <input
                  id="cp-input-offset"
                  type="number"
                  min={1}
                  max={60}
                  value={inputStartOffset}
                  onChange={(e) => setInputStartOffset(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="cp-fo-offset" className="text-xs font-medium text-slate-600">
                  Upcoming FO (Input &minus; Days)
                </label>
                <input
                  id="cp-fo-offset"
                  type="number"
                  min={1}
                  max={90}
                  value={upcomingFoOffset}
                  onChange={(e) => setUpcomingFoOffset(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="cp-cut-days" className="text-xs font-medium text-slate-600">
                  Cutting Alert Threshold (Days)
                </label>
                <input
                  id="cp-cut-days"
                  type="number"
                  min={1}
                  max={45}
                  value={cuttingAlertDays}
                  onChange={(e) => setCuttingAlertDays(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="cp-recovery-email" className="text-xs font-medium text-slate-600">
                Admin Verification Email (receives password change codes)
              </label>
              <input
                id="cp-recovery-email"
                type="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {siteConfigFeedback && (
              <div
                className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                  siteConfigFeedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {siteConfigFeedback.text}
              </div>
            )}

            <button
              type="submit"
              disabled={savingSiteConfig}
              className="h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{savingSiteConfig ? 'Saving Settings...' : 'Save Website Settings'}</span>
            </button>
          </form>
        </section>

        {/* Admin Password Change with Email Verification Code */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <KeyRound className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Change Control Panel Password
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Requires a 6-digit verification code emailed to{' '}
                <span className="font-mono font-semibold text-slate-700">
                  {siteConfig.recoveryEmail}
                </span>
                .
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
            <div className="text-xs font-medium text-slate-700">
              Step 1: Send Verification Code to Email
            </div>
            <button
              type="button"
              disabled={otpSending}
              onClick={handleRequestOtp}
              className="w-full h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Mail className="w-4 h-4" />
              <span>
                {otpSending
                  ? 'Sending Code...'
                  : otpSent
                    ? `Resend Code to ${siteConfig.recoveryEmail}`
                    : `Send Verification Code to ${siteConfig.recoveryEmail}`}
              </span>
            </button>

            {otpFeedback && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 ${
                  otpFeedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div>{otpFeedback.text}</div>
                {otpFeedback.smtpMissing && (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('reminders')}
                    className="font-semibold text-blue-800 underline cursor-pointer"
                  >
                    Configure Hosting Email (SMTP) in Email Reminders &rarr;
                  </button>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleChangePasswordSubmit} className="space-y-3">
            <div className="text-xs font-medium text-slate-700">
              Step 2: Enter Email Code &amp; New Password
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="cp-otp-code" className="text-xs font-medium text-slate-600">
                6-Digit Verification Code
              </label>
              <input
                id="cp-otp-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code from email"
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-sm tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="cp-new-pass" className="text-xs font-medium text-slate-600">
                New Password
              </label>
              <div className="relative">
                <input
                  id="cp-new-pass"
                  type={showNewPass ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full h-10 pl-3 pr-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass((v) => !v)}
                  aria-label={showNewPass ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="cp-confirm-pass" className="text-xs font-medium text-slate-600">
                Confirm New Password
              </label>
              <input
                id="cp-confirm-pass"
                type={showNewPass ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {passChangeFeedback && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  passChangeFeedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {passChangeFeedback.text}
              </div>
            )}

            <button
              type="submit"
              disabled={changingPass || otpCode.length < 6}
              className="w-full h-10 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{changingPass ? 'Updating Password...' : 'Verify Code & Update Password'}</span>
            </button>
          </form>
        </section>
      </div>

      {/* Row 2: Master Plan Data Operations & Email Automation Quick Control */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <Database className="w-4 h-4 text-slate-700 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Master Plan Data, Backups &amp; Closed Orders
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload revised CSV plans, export backups, reset workspace, or reopen orders marked as Order Closed.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Upload Revised CSV Plan</span>
            </button>

            <button
              type="button"
              onClick={onDownloadXlsx}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Download .xlsx Dashboard</span>
            </button>

            <button
              type="button"
              onClick={onDownloadBackup}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Download JSON Backup</span>
            </button>

            {!confirmReset ? (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="h-10 px-3.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset to Default Plan</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 text-xs">
                <span className="text-red-800 font-medium">Clear edits &amp; cutting logs?</span>
                <button
                  type="button"
                  onClick={async () => {
                    await onResetPlan();
                    setConfirmReset(false);
                  }}
                  className="px-2.5 py-1 rounded bg-red-700 text-white font-semibold cursor-pointer"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 pt-3.5">
            <div className="text-xs font-semibold text-slate-800 mb-2">
              Closed Orders ({closedRecords.length})
            </div>
            {closedRecords.length === 0 ? (
              <div className="text-xs text-slate-500">
                No orders are currently marked Order Closed.
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="py-2 px-3">Factory · Line</th>
                      <th className="py-2 px-3">PG #</th>
                      <th className="py-2 px-3">Style</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {closedRecords.map((rec) => (
                      <tr key={rec.id}>
                        <td className="py-2 px-3 font-medium text-slate-900 whitespace-nowrap">
                          {rec.factory} · {rec.line}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-800">{rec.pgNumber}</td>
                        <td className="py-2 px-3 text-slate-600 truncate max-w-[260px]">
                          {rec.style}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onReopenOrder(rec.id, 'Open')}
                            className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-medium cursor-pointer"
                          >
                            Reopen Order
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Hosting Email & Daily Reminder Quick Controls */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Email Reminder &amp; Hosting Quick Controls
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Quick status of your hosting sender email and automated daily reminder service.
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-600">Hosting Sender Email</span>
                <span className="font-mono font-semibold text-slate-900">
                  {smtpStatus.configured ? smtpStatus.senderEmail : 'Not Configured'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-600">SMTP Server</span>
                <span className="font-mono text-slate-700">
                  {smtpStatus.configured ? `${smtpStatus.host}:${smtpStatus.port}` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-slate-600">Daily Auto Send</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSchedule({ enabled: !reminders.schedule.enabled })
                  }
                  className={`px-2.5 py-0.5 rounded border font-semibold cursor-pointer ${
                    reminders.schedule.enabled
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-slate-100 border-slate-300 text-slate-600'
                  }`}
                >
                  {reminders.schedule.enabled
                    ? `Enabled (${reminders.schedule.dailySendTime})`
                    : 'Paused'}
                </button>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-600">Active Recipient Emails</span>
                <span className="font-mono font-semibold text-slate-900">
                  {activeRecipients.length} / {reminders.recipients.length}
                </span>
              </div>
            </div>

            {reminderFeedback && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs ${
                  reminderFeedback.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {reminderFeedback.text}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2.5 pt-2">
            <button
              type="button"
              disabled={sendingReminder || activeRecipients.length === 0}
              onClick={async () => {
                setReminderFeedback(null);
                setSendingReminder(true);
                try {
                  const res = await onSendReminderNow();
                  setReminderFeedback({ ok: res.ok, text: res.message });
                } finally {
                  setSendingReminder(false);
                }
              }}
              className="flex-1 h-10 px-3.5 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{sendingReminder ? 'Sending...' : 'Send Reminder Now'}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateTab('reminders')}
              className="flex-1 h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium cursor-pointer"
            >
              Manage Hosting &amp; Emails
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
