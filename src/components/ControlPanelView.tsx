import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  Cloud,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
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
import {
  deleteDriveFile,
  downloadDriveJsonFile,
  hasInMemoryDriveToken,
  listDriveBackups,
  saveBackupBundleToDrive,
  signInWithGoogleDrive,
  signOutGoogleDrive,
  subscribeGoogleAuth,
} from '../lib/googleDrive.ts';
import type { DriveFileItem } from '../lib/googleDrive.ts';
import { GoogleSignInButton } from './GoogleSignInButton.tsx';
import type { NavTab } from './Sidebar.tsx';

interface ControlPanelViewProps {
  adminUnlocked: boolean;
  needsInitialSetup?: boolean;
  siteConfig: WebsiteControlConfig;
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  reminders: ReminderWorkspaceState;
  smtpStatus: SmtpSettingsPublic;
  onUnlock: (password: string) => Promise<{ ok: boolean; error?: string }>;
  onBootstrapAdmin?: (payload: {
    password: string;
    recoveryEmail?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
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
  onUploadPlanFile: (file: File) => void;
  onResetPlan: () => Promise<void>;
  onDownloadXlsx: () => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  onGetBackupJson: () => Promise<string | null>;
  onGetXlsxBlob: () => Promise<Blob | null>;
  onRestoreSnapshot: (snapshot: unknown) => Promise<{ ok: boolean; error?: string }>;
  onReopenOrder: (id: string, status: OrderStatus) => void;
  onUpdateSchedule: (patch: Partial<ReminderScheduleConfig>) => Promise<void>;
  onSendReminderNow: () => Promise<{ ok: boolean; message: string }>;
  onNavigateTab: (tab: NavTab) => void;
}

export function ControlPanelView({
  adminUnlocked,
  needsInitialSetup = false,
  siteConfig,
  meta,
  records,
  cuttingEntries,
  reminders,
  smtpStatus,
  onUnlock,
  onBootstrapAdmin,
  onLock,
  onUpdateSiteConfig,
  onRequestPasswordCode,
  onChangePassword,
  onUploadPlanFile,
  onResetPlan,
  onDownloadXlsx,
  onDownloadBackup,
  onGetBackupJson,
  onGetXlsxBlob,
  onRestoreSnapshot,
  onReopenOrder,
  onUpdateSchedule,
  onSendReminderNow,
  onNavigateTab,
}: ControlPanelViewProps) {
  // Unlock / Initial Bootstrap Gate State
  const [passwordInput, setPasswordInput] = useState('');
  const [bootstrapRecoveryEmail, setBootstrapRecoveryEmail] = useState('');
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
  const localJsonInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderFeedback, setReminderFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Google Drive Cloud Backup & Restore State
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [hasDriveToken, setHasDriveToken] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>([]);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveFeedback, setDriveFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [pendingDriveAction, setPendingDriveAction] = useState<
    | { type: 'restore'; file: DriveFileItem }
    | { type: 'delete'; file: DriveFileItem }
    | { type: 'restore_local'; fileName: string; parsedJson: unknown }
    | null
  >(null);

  useEffect(() => {
    const unsub = subscribeGoogleAuth((user) => {
      setGoogleUser(user);
      setHasDriveToken(Boolean(user && hasInMemoryDriveToken()));
      if (!user) {
        setDriveFiles([]);
      }
    });
    return unsub;
  }, []);

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
    if (needsInitialSetup && passwordInput.length < 8) {
      setUnlockError('Initial admin password must be at least 8 characters long.');
      return;
    }
    setUnlocking(true);
    try {
      const res =
        needsInitialSetup && onBootstrapAdmin
          ? await onBootstrapAdmin({
              password: passwordInput,
              recoveryEmail: bootstrapRecoveryEmail.trim() || undefined,
            })
          : await onUnlock(passwordInput);
      if (!res.ok) {
        setUnlockError(res.error || 'Authentication failed.');
        return;
      }
      setPasswordInput('');
      setBootstrapRecoveryEmail('');
    } finally {
      setUnlocking(false);
    }
  };

  if (!adminUnlocked) {
    return (
      <div className="min-h-[65vh] flex items-center justify-center px-3 sm:px-4">
        <div className="w-full max-w-md ct-surface rounded-2xl p-6 sm:p-8 space-y-5 shadow-xl relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-teal-500"
            aria-hidden="true"
          />
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0a1633] to-cyan-700 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                {needsInitialSetup ? 'Set Initial Admin Password' : 'Website Control Panel'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {needsInitialSetup
                  ? 'Create the first administrator password to secure editing, imports, and backups.'
                  : 'Admin authentication required to manage website settings, data writes, and security.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleUnlockSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cp-password" className="text-xs font-semibold text-slate-700">
                {needsInitialSetup ? 'New Admin Password (min 8 characters)' : 'Admin Password'}
              </label>
              <div className="relative">
                <input
                  id="cp-password"
                  type={showUnlockPass ? 'text' : 'password'}
                  required
                  minLength={needsInitialSetup ? 8 : undefined}
                  autoFocus
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder={
                    needsInitialSetup ? 'Create a strong password (min 8 chars)' : 'Enter admin password'
                  }
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

            {needsInitialSetup && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cp-bootstrap-email" className="text-xs font-semibold text-slate-700">
                  Admin Recovery Email (Optional)
                </label>
                <input
                  id="cp-bootstrap-email"
                  type="email"
                  value={bootstrapRecoveryEmail}
                  onChange={(e) => setBootstrapRecoveryEmail(e.target.value)}
                  placeholder="admin@company.com"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {unlockError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {unlockError}
              </div>
            )}

            <button
              type="submit"
              disabled={unlocking || !passwordInput}
              className="w-full h-11 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] via-[#122b5c] to-[#0891b2] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              <span>
                {unlocking
                  ? 'Verifying...'
                  : needsInitialSetup
                    ? 'Save Password & Unlock'
                    : 'Sign In to Control Panel'}
              </span>
            </button>
          </form>

          <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Protected administration for {siteConfig.companyName} · Signed HttpOnly session with brute-force lockout protection.
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
        upcomingFoOffsetDays: Number(upcomingFoOffset) || 15,
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
    if (newPassword.length < 8) {
      setPassChangeFeedback({
        ok: false,
        text: 'New password must be at least 8 characters long.',
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
    onUploadPlanFile(file);
    e.target.value = '';
  };

  const handleLocalJsonSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      try {
        const parsed = JSON.parse(reader.result);
        setPendingDriveAction({
          type: 'restore_local',
          fileName: file.name,
          parsedJson: parsed,
        });
      } catch {
        setDriveFeedback({
          ok: false,
          text: `Invalid JSON backup file "${file.name}".`,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const refreshDriveFiles = async () => {
    setDriveBusy(true);
    try {
      const files = await listDriveBackups();
      setDriveFiles(files);
      setHasDriveToken(hasInMemoryDriveToken());
    } catch (err) {
      setHasDriveToken(hasInMemoryDriveToken());
      setDriveFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Unable to list Google Drive backups.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleGoogleDriveSignIn = async () => {
    setDriveFeedback(null);
    setDriveBusy(true);
    try {
      const { user } = await signInWithGoogleDrive();
      setGoogleUser(user);
      setHasDriveToken(true);
      const files = await listDriveBackups();
      setDriveFiles(files);
      setDriveFeedback({
        ok: true,
        text: `Connected Google Drive as ${user.email || user.displayName || 'Google User'}.`,
      });
    } catch (err) {
      setDriveFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Google Sign-In failed.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleGoogleDriveSignOut = async () => {
    setDriveFeedback(null);
    await signOutGoogleDrive();
    setGoogleUser(null);
    setHasDriveToken(false);
    setDriveFiles([]);
  };

  const handleSaveBundleToDrive = async () => {
    setDriveFeedback(null);
    setDriveBusy(true);
    try {
      const [snapshotJson, xlsxBlob] = await Promise.all([
        onGetBackupJson(),
        onGetXlsxBlob(),
      ]);
      if (!snapshotJson) {
        throw new Error('Failed to generate current workspace JSON snapshot.');
      }
      const result = await saveBackupBundleToDrive({
        snapshotJson,
        xlsxBlob,
      });
      setHasDriveToken(true);
      const files = await listDriveBackups();
      setDriveFiles(files);
      setDriveFeedback({
        ok: true,
        text: `Saved "${result.jsonFile.name}"${result.xlsxFile ? ` + "${result.xlsxFile.name}"` : ''} to Google Drive folder "Alex Apparels Planning Backups".`,
      });
    } catch (err) {
      setHasDriveToken(hasInMemoryDriveToken());
      setDriveFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to save backup to Google Drive.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  const handleConfirmPendingAction = async () => {
    if (!pendingDriveAction) return;
    const action = pendingDriveAction;
    setPendingDriveAction(null);
    setDriveBusy(true);
    setDriveFeedback(null);
    try {
      if (action.type === 'restore') {
        const snapshot = await downloadDriveJsonFile(action.file.id);
        const res = await onRestoreSnapshot(snapshot);
        setDriveFeedback({
          ok: res.ok,
          text: res.ok
            ? `Restored workspace from Google Drive backup "${action.file.name}".`
            : res.error || 'Failed to restore backup snapshot.',
        });
      } else if (action.type === 'delete') {
        await deleteDriveFile(action.file.id);
        const files = await listDriveBackups();
        setDriveFiles(files);
        setDriveFeedback({
          ok: true,
          text: `Deleted "${action.file.name}" from Google Drive.`,
        });
      } else if (action.type === 'restore_local') {
        const res = await onRestoreSnapshot(action.parsedJson);
        setDriveFeedback({
          ok: res.ok,
          text: res.ok
            ? `Restored workspace from local JSON "${action.fileName}".`
            : res.error || 'Failed to restore local backup snapshot.',
        });
      }
    } catch (err) {
      setHasDriveToken(hasInMemoryDriveToken());
      setDriveFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Operation failed.',
      });
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin Session Banner */}
      <div className="ct-exec-banner text-white rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-cyan-300 shrink-0" />
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
          className="h-9 px-3.5 rounded-lg bg-white/10 hover:bg-white/15 border border-cyan-400/30 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5 text-cyan-300" />
          <span>Lock Control Panel</span>
        </button>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="ct-surface rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Cluster Capacity</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {meta.totalLines} Lines · {meta.totalCapacityMc.toLocaleString()} Mc
          </div>
          <div className="text-xs text-slate-500 mt-1">{records.length} planned slots</div>
        </div>
        <div className="ct-surface rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Closed Orders</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {closedRecords.length}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {cuttingEntries.length} cutting log entries
          </div>
        </div>
        <div className="ct-surface rounded-2xl p-4">
          <div className="text-xs font-medium text-slate-500">Public Edit Access</div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">
            {siteConfig.readOnlyPublicMode ? 'Locked (Admin Only)' : 'Team Collaborative'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Changeable below anytime
          </div>
        </div>
        <div className="ct-surface rounded-2xl p-4">
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
        <section className="xl:col-span-7 ct-surface rounded-2xl p-5 space-y-4">
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
        <section className="xl:col-span-5 ct-surface rounded-2xl p-5 space-y-4">
          <div className="flex items-start gap-2.5">
            <KeyRound className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Change Control Panel Password
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {siteConfig.recoveryEmail ? (
                  <>
                    Requires a 6-digit verification code emailed to{' '}
                    <span className="font-mono font-semibold text-slate-700">
                      {siteConfig.recoveryEmail}
                    </span>
                    .
                  </>
                ) : (
                  'Set an Admin Verification Email on the left before changing the admin password.'
                )}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2.5">
            <div className="text-xs font-medium text-slate-700">
              Step 1: Send Verification Code to Email
            </div>
            <button
              type="button"
              disabled={otpSending || !siteConfig.recoveryEmail}
              onClick={handleRequestOtp}
              className="w-full h-10 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-700 hover:brightness-110 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Mail className="w-4 h-4" />
              <span>
                {otpSending
                  ? 'Sending Code...'
                  : !siteConfig.recoveryEmail
                    ? 'Configure Verification Email First'
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
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
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
        <section className="xl:col-span-7 ct-surface rounded-2xl p-5 space-y-4">
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
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleCsvSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Upload Revised Plan (.csv / .xlsx)</span>
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

            <input
              ref={localJsonInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleLocalJsonSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => localJsonInputRef.current?.click()}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-2 cursor-pointer"
            >
              <HardDrive className="w-4 h-4 text-slate-500" />
              <span>Restore Local JSON</span>
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
        <section className="xl:col-span-5 ct-surface rounded-2xl p-5 space-y-4 flex flex-col justify-between">
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

      {/* Row 3: Google Drive Cloud Backup & Restore */}
      <section className="card-3d ct-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <Cloud className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900">
                Google Drive Cloud Backup &amp; Restore
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Save your full website state (.json) and formatted Excel (.xlsx) directly to your Google Drive folder{' '}
                <span className="font-mono font-semibold text-slate-700">Alex Apparels Planning Backups</span> so you can restore anytime.
              </p>
            </div>
          </div>

          {!googleUser || !hasDriveToken ? (
            <GoogleSignInButton
              onClick={handleGoogleDriveSignIn}
              disabled={driveBusy}
              label={googleUser ? 'Reconnect Google Drive' : 'Sign in with Google'}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                Connected:{' '}
                <span className="font-mono font-semibold">
                  {googleUser.email || googleUser.displayName}
                </span>
              </div>
              <button
                type="button"
                disabled={driveBusy}
                onClick={handleSaveBundleToDrive}
                className="h-10 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-700 hover:brightness-110 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-xs cursor-pointer transition-all"
              >
                <Cloud className="w-4 h-4" />
                <span>{driveBusy ? 'Saving to Drive...' : 'Save App & Excel to Google Drive'}</span>
              </button>
              <button
                type="button"
                disabled={driveBusy}
                onClick={refreshDriveFiles}
                className="h-10 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${driveBusy ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={handleGoogleDriveSignOut}
                className="h-10 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          )}
        </div>

        {driveFeedback && (
          <div
            className={`rounded-xl border px-3.5 py-2.5 text-xs ${
              driveFeedback.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {driveFeedback.text}
          </div>
        )}

        {googleUser && hasDriveToken && (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Saved Google Drive Files ({driveFiles.length})</span>
              <span className="font-mono text-[11px] font-normal text-slate-500">
                Folder: Alex Apparels Planning Backups
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-white">
                    <th className="py-2 px-3.5">Backup File Name</th>
                    <th className="py-2 px-3.5">Type</th>
                    <th className="py-2 px-3.5">Last Modified</th>
                    <th className="py-2 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {driveFiles.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-slate-500">
                        No backups in Google Drive yet. Click &ldquo;Save App &amp; Excel to Google Drive&rdquo; above to create your first cloud snapshot.
                      </td>
                    </tr>
                  ) : (
                    driveFiles.map((file) => {
                      const isJson =
                        file.mimeType === 'application/json' || file.name.endsWith('.json');
                      return (
                        <tr key={file.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3.5 font-mono text-slate-900 font-medium">
                            {file.name}
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                                isJson
                                  ? 'bg-blue-50 border-blue-200 text-blue-800'
                                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              }`}
                            >
                              {isJson ? 'App State (.json)' : 'Excel (.xlsx)'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 font-mono text-slate-600 whitespace-nowrap">
                            {file.modifiedTime
                              ? file.modifiedTime.slice(0, 16).replace('T', ' ') + ' UTC'
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-1.5">
                            {file.webViewLink && (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Open</span>
                              </a>
                            )}
                            {isJson && (
                              <button
                                type="button"
                                disabled={driveBusy}
                                onClick={() =>
                                  setPendingDriveAction({ type: 'restore', file })
                                }
                                className="px-2.5 py-1 rounded bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                Restore
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={driveBusy}
                              onClick={() =>
                                setPendingDriveAction({ type: 'delete', file })
                              }
                              aria-label={`Delete ${file.name}`}
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
          </div>
        )}
      </section>

      {/* Explicit React Confirmation Modal for Drive Restore / Delete / Local Restore */}
      {pendingDriveAction && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drive-confirm-title"
        >
          <div className="card-3d bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  pendingDriveAction.type === 'delete'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4
                  id="drive-confirm-title"
                  className="font-display text-base font-bold text-slate-900"
                >
                  {pendingDriveAction.type === 'delete'
                    ? 'Delete Backup from Google Drive?'
                    : pendingDriveAction.type === 'restore'
                      ? 'Restore App State from Google Drive?'
                      : 'Restore App State from Local JSON?'}
                </h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {pendingDriveAction.type === 'delete' ? (
                    <>
                      This will permanently delete{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {pendingDriveAction.file.name}
                      </span>{' '}
                      from your Google Drive. This cannot be undone.
                    </>
                  ) : (
                    <>
                      Restoring{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {pendingDriveAction.type === 'restore'
                          ? pendingDriveAction.file.name
                          : pendingDriveAction.fileName}
                      </span>{' '}
                      will overwrite the current Master Plan, manual Running styles, daily cutting logs, email recipient schedules, and Control Panel rules.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPendingDriveAction(null)}
                className="h-9 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPendingAction}
                className={`h-9 px-4 rounded-xl text-xs font-semibold text-white cursor-pointer ${
                  pendingDriveAction.type === 'delete'
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                {pendingDriveAction.type === 'delete'
                  ? 'Confirm Delete'
                  : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
