import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Lock, Menu, Upload } from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  buildLineShortcutSummaries,
  evaluatePlanningRecords,
  parseMasterPlanCsv,
} from './shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  EvaluatedPlanningRecord,
  FactoryName,
  FoStatus,
  MasterPlanMeta,
  OrderStatus,
  PlanningRecord,
} from './shared/plannerTypes.ts';
import { DEFAULT_REMINDER_SCHEDULE } from './shared/reminderTypes.ts';
import type {
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpProviderPreset,
  SmtpSettingsPublic,
} from './shared/reminderTypes.ts';
import { DEFAULT_WEBSITE_CONTROL_CONFIG } from './shared/controlPanelTypes.ts';
import type { WebsiteControlConfig } from './shared/controlPanelTypes.ts';
import { Sidebar } from './components/Sidebar.tsx';
import type { NavTab } from './components/Sidebar.tsx';
import { FilterToolbar } from './components/FilterToolbar.tsx';
import type { StageFilter } from './components/FilterToolbar.tsx';
import { KpiDashboardView } from './components/KpiDashboardView.tsx';
import { DailyCuttingEntryView } from './components/DailyCuttingEntryView.tsx';
import { PlanningDatabaseView } from './components/PlanningDatabaseView.tsx';
import { FabricOrderTrackerView } from './components/FabricOrderTrackerView.tsx';
import { ActionListsView } from './components/ActionListsView.tsx';
import { EmailRemindersView } from './components/EmailRemindersView.tsx';
import { ControlPanelView } from './components/ControlPanelView.tsx';

const STORAGE_KEY = 'alex_apparels_cluster1_plan_v2';
const ADMIN_TOKEN_KEY = 'alex_apparels_admin_session_v1';

const TAB_TITLES: Record<NavTab, string> = {
  dashboard: 'KPI Dashboard & Shortcut Summary',
  cutting_entry: 'Daily Cutting Entry',
  database: 'Master Plan (Line-Wise)',
  tracker: 'Fabric Order Tracker',
  fo_required: 'FO Required List',
  action_required: 'Action Required List',
  reminders: 'Daily Email Reminders & Recipients',
  control_panel: 'Website Control Panel',
};

const INITIAL_SMTP_STATUS: SmtpSettingsPublic = {
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

interface WorkspaceApiResponse {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  hasCustomEdits: boolean;
  reminders: ReminderWorkspaceState;
  smtpStatus: SmtpSettingsPublic;
  siteConfig?: WebsiteControlConfig;
  adminUnlocked?: boolean;
  appUrl?: string;
}

export default function App() {
  const [meta, setMeta] = useState<MasterPlanMeta | null>(null);
  const [records, setRecords] = useState<PlanningRecord[]>([]);
  const [cuttingEntries, setCuttingEntries] = useState<DailyCuttingEntry[]>([]);
  const [reminders, setReminders] = useState<ReminderWorkspaceState>({
    recipients: [],
    schedule: { ...DEFAULT_REMINDER_SCHEDULE },
    logs: [],
  });
  const [smtpStatus, setSmtpStatus] = useState<SmtpSettingsPublic>(INITIAL_SMTP_STATUS);
  const [siteConfig, setSiteConfig] = useState<WebsiteControlConfig>(
    DEFAULT_WEBSITE_CONTROL_CONFIG
  );
  const [adminToken, setAdminToken] = useState<string>(() => {
    try {
      return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [appUrl, setAppUrl] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [hasCustomEdits, setHasCustomEdits] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [selectedFactory, setSelectedFactory] = useState<FactoryName | 'ALL'>('ALL');
  const [selectedLine, setSelectedLine] = useState<string>('ALL');
  const [stageFilter, setStageFilter] = useState<StageFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [referenceDateIso, setReferenceDateIso] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const headerUploadRef = useRef<HTMLInputElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);

  const buildHeaders = useCallback(
    (includeJson = true): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (includeJson) headers['Content-Type'] = 'application/json';
      if (adminToken) headers['x-admin-token'] = adminToken;
      return headers;
    },
    [adminToken]
  );

  const saveLocalBackup = useCallback(
    (
      nextMeta: MasterPlanMeta,
      nextRecords: PlanningRecord[],
      nextCutting: DailyCuttingEntry[]
    ) => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            meta: nextMeta,
            records: nextRecords,
            cuttingEntries: nextCutting,
          })
        );
      } catch {
        // Ignore storage quota errors
      }
    },
    []
  );

  const syncWorkspaceToServer = useCallback(
    (
      nextMeta: MasterPlanMeta,
      nextRecords: PlanningRecord[],
      nextCutting: DailyCuttingEntry[],
      nextRefDateIso: string,
      customEditsFlag = true
    ) => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }
      syncTimerRef.current = window.setTimeout(async () => {
        try {
          const res = await fetch('/api/workspace', {
            method: 'PUT',
            headers: buildHeaders(true),
            body: JSON.stringify({
              meta: nextMeta,
              records: nextRecords,
              cuttingEntries: nextCutting,
              referenceDateIso: nextRefDateIso,
              hasCustomEdits: customEditsFlag,
            }),
          });
          if (res.status === 403) {
            setBannerMessage(
              'Website is in Admin Read-Only mode. Unlock Control Panel to save edits.'
            );
          }
        } catch {
          // Local backup remains intact if offline
        }
      }, 250);
    },
    [buildHeaders]
  );

  const loadWorkspaceFromServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace', {
        headers: buildHeaders(false),
      });
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const data = (await res.json()) as WorkspaceApiResponse;

      setAdminUnlocked(Boolean(data.adminUnlocked));
      if (data.siteConfig) setSiteConfig(data.siteConfig);

      if (!data.hasCustomEdits) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as {
              meta: MasterPlanMeta;
              records: PlanningRecord[];
              cuttingEntries: DailyCuttingEntry[];
            };
            if (parsed?.meta && Array.isArray(parsed?.records) && parsed.records.length > 0) {
              const normalized = parsed.records.map((r) => ({
                ...r,
                orderStatus: (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus,
                isFinished: r.orderStatus === 'Order Closed' || Boolean(r.isFinished),
              }));
              setMeta(parsed.meta);
              setRecords(normalized);
              setCuttingEntries(Array.isArray(parsed.cuttingEntries) ? parsed.cuttingEntries : []);
              setHasCustomEdits(true);
              setReminders(data.reminders);
              setSmtpStatus(data.smtpStatus || INITIAL_SMTP_STATUS);
              setAppUrl(data.appUrl || '');
              syncWorkspaceToServer(
                parsed.meta,
                normalized,
                Array.isArray(parsed.cuttingEntries) ? parsed.cuttingEntries : [],
                referenceDateIso,
                true
              );
              setLoading(false);
              return;
            }
          } catch {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      }

      const normalizedRecords = data.records.map((r) => ({
        ...r,
        orderStatus: (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus,
        isFinished: r.orderStatus === 'Order Closed' || Boolean(r.isFinished),
      }));

      setMeta(data.meta);
      setRecords(normalizedRecords);
      setCuttingEntries(Array.isArray(data.cuttingEntries) ? data.cuttingEntries : []);
      if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
      setHasCustomEdits(Boolean(data.hasCustomEdits));
      setReminders(data.reminders);
      setSmtpStatus(data.smtpStatus || INITIAL_SMTP_STATUS);
      setAppUrl(data.appUrl || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load master planning data.');
    } finally {
      setLoading(false);
    }
  }, [buildHeaders, referenceDateIso, syncWorkspaceToServer]);

  useEffect(() => {
    loadWorkspaceFromServer();
  }, [loadWorkspaceFromServer]);

  const isEditingLocked = siteConfig.readOnlyPublicMode && !adminUnlocked;

  const persistState = useCallback(
    (
      nextMeta: MasterPlanMeta,
      nextRecords: PlanningRecord[],
      nextCutting: DailyCuttingEntry[],
      nextRefDateIso = referenceDateIso
    ) => {
      setHasCustomEdits(true);
      saveLocalBackup(nextMeta, nextRecords, nextCutting);
      syncWorkspaceToServer(nextMeta, nextRecords, nextCutting, nextRefDateIso, true);
    },
    [referenceDateIso, saveLocalBackup, syncWorkspaceToServer]
  );

  const handleFactoryChange = (factory: FactoryName | 'ALL') => {
    setSelectedFactory(factory);
    setSelectedLine('ALL');
  };

  const handleReferenceDateChange = (iso: string) => {
    setReferenceDateIso(iso);
    if (meta && records.length > 0 && !isEditingLocked) {
      syncWorkspaceToServer(meta, records, cuttingEntries, iso, hasCustomEdits);
    }
  };

  const handleUpdateRecord = useCallback(
    (
      id: string,
      patch: Partial<{
        plannedQty: number | null;
        foIssueQty: number | null;
        dailyTargetQty: number | null;
        endDateIso: string | null;
        isFinished: boolean;
        orderStatus: OrderStatus;
        foNumber: string;
        foDate: string;
        foStatus: FoStatus;
        fabricNote: string;
      }>
    ) => {
      if (isEditingLocked) {
        setBannerMessage('Website is in Admin Read-Only mode. Unlock Control Panel to edit.');
        return;
      }
      setRecords((prev) => {
        const next = prev.map((r) => {
          if (r.id !== id) return r;
          const merged = { ...r, ...patch };
          if (patch.orderStatus !== undefined) {
            merged.isFinished = patch.orderStatus === 'Order Closed';
          } else if (patch.isFinished !== undefined) {
            merged.orderStatus = patch.isFinished ? 'Order Closed' : 'Open';
          }
          return merged;
        });
        if (meta) persistState(meta, next, cuttingEntries);
        return next;
      });
    },
    [isEditingLocked, meta, cuttingEntries, persistState]
  );

  const handleAddCuttingEntry = useCallback(
    (entryData: Omit<DailyCuttingEntry, 'id'>) => {
      if (isEditingLocked) {
        setBannerMessage('Website is in Admin Read-Only mode. Unlock Control Panel to log cutting.');
        return;
      }
      const newEntry: DailyCuttingEntry = {
        ...entryData,
        id: `CUT-${Date.now().toString(36).toUpperCase()}`,
      };
      setCuttingEntries((prev) => {
        const next = [newEntry, ...prev];
        if (meta) persistState(meta, records, next);
        return next;
      });
    },
    [isEditingLocked, meta, records, persistState]
  );

  const handleDeleteCuttingEntry = useCallback(
    (entryId: string) => {
      if (isEditingLocked) {
        setBannerMessage('Website is in Admin Read-Only mode. Unlock Control Panel to edit.');
        return;
      }
      setCuttingEntries((prev) => {
        const next = prev.filter((e) => e.id !== entryId);
        if (meta) persistState(meta, records, next);
        return next;
      });
    },
    [isEditingLocked, meta, records, persistState]
  );

  const handleUploadCsv = (csvText: string, fileName: string) => {
    if (isEditingLocked) {
      setBannerMessage('Website is in Admin Read-Only mode. Unlock Control Panel to upload plans.');
      return;
    }
    try {
      const parsed = parseMasterPlanCsv(csvText);
      if (parsed.records.length === 0) {
        setBannerMessage(
          `No ALEX 1, ALEX 3, ALEX 5, or ALEX 12 planning rows were detected in "${fileName}".`
        );
        return;
      }

      const existingByKey = new Map<string, PlanningRecord>();
      for (const oldRec of records) {
        existingByKey.set(`${oldRec.factory}::${oldRec.line}::${oldRec.style}`, oldRec);
      }
      const oldToNewIdMap = new Map<string, string>();
      const mergedRecords = parsed.records.map((newRec) => {
        const match = existingByKey.get(`${newRec.factory}::${newRec.line}::${newRec.style}`);
        if (!match) return newRec;
        oldToNewIdMap.set(match.id, newRec.id);
        return {
          ...newRec,
          plannedQty: match.plannedQty,
          foIssueQty: match.foIssueQty,
          cuttingBaseQty: match.cuttingBaseQty,
          dailyTargetQty: match.dailyTargetQty,
          isFinished: match.isFinished,
          orderStatus: match.orderStatus,
          foNumber: match.foNumber,
          foDate: match.foDate,
          foStatus: match.foStatus,
          fabricNote: match.fabricNote,
        };
      });

      const remappedCutting = cuttingEntries
        .filter((e) => oldToNewIdMap.has(e.recordId))
        .map((e) => ({ ...e, recordId: oldToNewIdMap.get(e.recordId)! }));

      setMeta(parsed.meta);
      setRecords(mergedRecords);
      setCuttingEntries(remappedCutting);
      persistState(parsed.meta, mergedRecords, remappedCutting);
      setSelectedFactory('ALL');
      setSelectedLine('ALL');
      setBannerMessage(
        `Updated Master Plan from "${fileName}": ${parsed.meta.totalLines} lines (${parsed.meta.totalCapacityMc.toLocaleString()} Mc) across ALEX 1, 3, 5, 12.`
      );
    } catch (err) {
      setBannerMessage(
        err instanceof Error ? err.message : 'Failed to parse uploaded CSV file.'
      );
    }
  };

  const handleHeaderCsvInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleUploadCsv(reader.result, file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetEdits = async () => {
    if (isEditingLocked) {
      setBannerMessage('Website is in Admin Read-Only mode. Unlock Control Panel to reset.');
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    setBannerMessage(null);
    try {
      const res = await fetch('/api/workspace/reset', {
        method: 'POST',
        headers: buildHeaders(false),
      });
      if (res.ok) {
        const data = (await res.json()) as WorkspaceApiResponse;
        setMeta(data.meta);
        setRecords(data.records);
        setCuttingEntries([]);
        setHasCustomEdits(false);
        setReminders(data.reminders);
        setSmtpStatus(data.smtpStatus || INITIAL_SMTP_STATUS);
        if (data.siteConfig) setSiteConfig(data.siteConfig);
        return;
      }
    } catch {
      // Fallback below
    }
    loadWorkspaceFromServer();
  };

  const handleDownloadXlsx = async () => {
    if (!meta || records.length === 0 || exporting) return;
    setExporting(true);
    setBannerMessage(null);
    try {
      const response = await fetch('/api/export-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta, records, cuttingEntries, referenceDateIso }),
      });
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Alex_Apparels_Cluster1_Planning_Dashboard.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBannerMessage(
        err instanceof Error ? err.message : 'Failed to generate .xlsx workbook.'
      );
    } finally {
      setExporting(false);
    }
  };

  // Control Panel Auth & Admin Handlers
  const handleUnlockControlPanel = async (
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/admin/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        siteConfig?: WebsiteControlConfig;
        error?: string;
      };
      if (!res.ok || !data.token) {
        return { ok: false, error: data.error || 'Incorrect Control Panel password.' };
      }
      try {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      } catch {
        // Ignore storage errors
      }
      setAdminToken(data.token);
      setAdminUnlocked(true);
      if (data.siteConfig) setSiteConfig(data.siteConfig);
      setBannerMessage(null);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while verifying Control Panel password.' };
    }
  };

  const handleLockControlPanel = async () => {
    try {
      await fetch('/api/admin/lock', {
        method: 'POST',
        headers: buildHeaders(false),
      });
    } catch {
      // Ignore
    }
    try {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch {
      // Ignore
    }
    setAdminToken('');
    setAdminUnlocked(false);
  };

  const handleUpdateSiteConfig = async (
    patch: Partial<WebsiteControlConfig>
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/admin/site-config', {
        method: 'PUT',
        headers: buildHeaders(true),
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        siteConfig?: WebsiteControlConfig;
        error?: string;
      };
      if (!res.ok || !data.siteConfig) {
        return { ok: false, error: data.error || 'Failed to update website settings.' };
      }
      setSiteConfig(data.siteConfig);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while saving website settings.' };
    }
  };

  const handleRequestPasswordCode = async (): Promise<{
    ok: boolean;
    smtpMissing?: boolean;
    message: string;
  }> => {
    try {
      const res = await fetch('/api/admin/password/request-code', {
        method: 'POST',
        headers: buildHeaders(false),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        smtpMissing?: boolean;
        message?: string;
        error?: string;
      };
      return {
        ok: Boolean(data.ok),
        smtpMissing: data.smtpMissing,
        message: data.message || data.error || 'Could not send verification code.',
      };
    } catch {
      return {
        ok: false,
        message: 'Network error while requesting verification code.',
      };
    }
  };

  const handleChangePassword = async (payload: {
    code: string;
    newPassword: string;
  }): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetch('/api/admin/password/change', {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      return {
        ok: Boolean(data.ok),
        message: data.message || data.error || 'Failed to update password.',
      };
    } catch {
      return { ok: false, message: 'Network error while updating password.' };
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const res = await fetch('/api/admin/backup', {
        headers: buildHeaders(false),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Alex_Apparels_Control_Tower_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Ignore
    }
  };

  // Reminder & Hosting SMTP API handlers
  const handleUpdateSchedule = async (patch: Partial<ReminderScheduleConfig>) => {
    if (isEditingLocked) {
      setBannerMessage('Website is in Admin Read-Only mode. Unlock Control Panel to edit.');
      return;
    }
    setReminders((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, ...patch },
    }));
    try {
      const res = await fetch('/api/reminders/schedule', {
        method: 'PUT',
        headers: buildHeaders(true),
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          reminders: ReminderWorkspaceState;
          smtpStatus: SmtpSettingsPublic;
        };
        setReminders(data.reminders);
        setSmtpStatus(data.smtpStatus);
      }
    } catch {
      // Ignore network errors
    }
  };

  const handleSaveSmtp = async (payload: {
    providerPreset: SmtpProviderPreset;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    fromName: string;
    fromEmail: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/reminders/smtp', {
        method: 'PUT',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        smtpStatus?: SmtpSettingsPublic;
      };
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to save hosting email settings.' };
      }
      if (data.smtpStatus) setSmtpStatus(data.smtpStatus);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while saving hosting email settings.' };
    }
  };

  const handleVerifySmtp = async (): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetch('/api/reminders/smtp/verify', {
        method: 'POST',
        headers: buildHeaders(false),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        smtpStatus?: SmtpSettingsPublic;
      };
      if (data.smtpStatus) setSmtpStatus(data.smtpStatus);
      return {
        ok: Boolean(data.ok),
        message: data.message || data.error || 'Verification completed.',
      };
    } catch {
      return { ok: false, message: 'Could not reach server to test SMTP connection.' };
    }
  };

  const handleResetSmtp = async () => {
    try {
      const res = await fetch('/api/reminders/smtp', {
        method: 'DELETE',
        headers: buildHeaders(false),
      });
      if (res.ok) {
        const data = (await res.json()) as { smtpStatus: SmtpSettingsPublic };
        setSmtpStatus(data.smtpStatus);
      }
    } catch {
      // Ignore network errors
    }
  };

  const handleAddRecipient = async (payload: {
    name: string;
    email: string;
    role: string;
    factories: FactoryName[];
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/reminders/recipients', {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        reminders?: ReminderWorkspaceState;
      };
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to add email address.' };
      }
      if (data.reminders) {
        setReminders(data.reminders);
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while saving email recipient.' };
    }
  };

  const handleUpdateRecipient = async (
    id: string,
    patch: Partial<{
      name: string;
      email: string;
      role: string;
      factories: FactoryName[];
      active: boolean;
    }>
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/reminders/recipients/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as {
        error?: string;
        reminders?: ReminderWorkspaceState;
      };
      if (!res.ok) {
        return { ok: false, error: data.error || 'Failed to update recipient.' };
      }
      if (data.reminders) {
        setReminders(data.reminders);
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while updating recipient.' };
    }
  };

  const handleDeleteRecipient = async (id: string) => {
    try {
      const res = await fetch(`/api/reminders/recipients/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: buildHeaders(false),
      });
      if (res.ok) {
        const data = (await res.json()) as { reminders: ReminderWorkspaceState };
        setReminders(data.reminders);
      }
    } catch {
      // Ignore network error
    }
  };

  const handleSendReminderNow = async (
    recipientId?: string
  ): Promise<{ ok: boolean; message: string }> => {
    try {
      if (meta && records.length > 0 && !isEditingLocked) {
        await fetch('/api/workspace', {
          method: 'PUT',
          headers: buildHeaders(true),
          body: JSON.stringify({
            meta,
            records,
            cuttingEntries,
            referenceDateIso,
            hasCustomEdits,
          }),
        });
      }

      const res = await fetch('/api/reminders/send-now', {
        method: 'POST',
        headers: buildHeaders(true),
        body: JSON.stringify({
          recipientId,
          alertScope: reminders.schedule.alertScope,
          referenceDateIso,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        log?: { message: string };
        reminders?: ReminderWorkspaceState;
        smtpStatus?: SmtpSettingsPublic;
        error?: string;
      };
      if (data.reminders) setReminders(data.reminders);
      if (data.smtpStatus) setSmtpStatus(data.smtpStatus);
      return {
        ok: Boolean(data.ok),
        message: data.log?.message || data.error || 'Reminder request processed.',
      };
    } catch {
      return { ok: false, message: 'Failed to reach server while sending email reminder.' };
    }
  };

  const ruleOptions = useMemo(
    () => ({
      inputStartOffsetDays: siteConfig.inputStartOffsetDays,
      upcomingFoOffsetDays: siteConfig.upcomingFoOffsetDays,
      cuttingAlertDays: siteConfig.cuttingAlertDays,
    }),
    [
      siteConfig.inputStartOffsetDays,
      siteConfig.upcomingFoOffsetDays,
      siteConfig.cuttingAlertDays,
    ]
  );

  const evaluatedAll: EvaluatedPlanningRecord[] = useMemo(
    () => evaluatePlanningRecords(records, cuttingEntries, referenceDateIso, ruleOptions),
    [records, cuttingEntries, referenceDateIso, ruleOptions]
  );

  const shortcutSummaries = useMemo(
    () => buildLineShortcutSummaries(evaluatedAll, referenceDateIso, ruleOptions),
    [evaluatedAll, referenceDateIso, ruleOptions]
  );

  const availableLines = useMemo(() => {
    const lineSet = new Set<string>();
    for (const r of records) {
      if (selectedFactory === 'ALL' || r.factory === selectedFactory) {
        lineSet.add(r.line);
      }
    }
    return Array.from(lineSet);
  }, [records, selectedFactory]);

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return evaluatedAll.filter((r) => {
      if (selectedFactory !== 'ALL' && r.factory !== selectedFactory) return false;
      if (selectedLine !== 'ALL' && r.line !== selectedLine) return false;
      if (stageFilter === 'CURRENT_ONLY' && r.lifecycleStage !== 'Running') return false;
      if (stageFilter === 'QUEUED_ONLY' && r.lifecycleStage === 'Running') return false;
      if (q) {
        const hay =
          `${r.factory} ${r.line} ${r.pgNumber} ${r.style} ${r.nextStyle} ${r.productCategory} ${r.foNumber}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [evaluatedAll, selectedFactory, selectedLine, stageFilter, searchQuery]);

  const factorySummaries = useMemo(() => {
    return ALLOWED_FACTORIES.map((factory) => {
      const lineMap = new Map<string, number>();
      for (const r of records) {
        if (r.factory === factory && !lineMap.has(r.line)) {
          lineMap.set(r.line, r.capacityMc);
        }
      }
      return {
        factory,
        lines: lineMap.size,
        capacityMc: Array.from(lineMap.values()).reduce((a, b) => a + b, 0),
      };
    });
  }, [records]);

  const counts = useMemo(
    () => ({
      database: evaluatedAll.length,
      cuttingEntries: cuttingEntries.length,
      foRequired: evaluatedAll.filter((r) => r.foRequired).length,
      actionRequired: evaluatedAll.filter(
        (r) =>
          r.orderStatus !== 'Order Closed' &&
          (r.actionRequired ||
            r.styleClassification === 'Open Capacity' ||
            r.isAnomalousPastDate)
      ).length,
      planQtyPending: evaluatedAll.filter(
        (r) => r.plannedQty === null && r.orderStatus !== 'Order Closed'
      ).length,
      cuttingAlert10d: evaluatedAll.filter(
        (r) => r.isCuttingWithin10Days && r.orderStatus !== 'Order Closed'
      ).length,
      activeRecipients: reminders.recipients.filter((r) => r.active).length,
    }),
    [evaluatedAll, cuttingEntries.length, reminders.recipients]
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        selectedFactory={selectedFactory}
        onSelectFactory={handleFactoryChange}
        factorySummaries={factorySummaries}
        counts={counts}
        adminUnlocked={adminUnlocked}
        asOfDateRaw={meta?.asOfDateRaw || '18-Nov-26'}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar with Company Logo on Left & Upload / Download CTAs on Right */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 min-w-0">
              {!logoError ? (
                <img
                  src="/assets/aistudio/OIP__1__63903905.webp"
                  alt={siteConfig.companyName}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-8 w-auto object-contain shrink-0"
                />
              ) : (
                <span className="font-display text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
                  {siteConfig.companyName.toUpperCase()}
                </span>
              )}
              <span
                className="hidden sm:inline-block h-5 w-px bg-slate-200 shrink-0"
                aria-hidden="true"
              />
              <h1 className="font-display font-semibold text-sm sm:text-base text-slate-900 truncate">
                {activeTab === 'dashboard' ? siteConfig.portalTitle : TAB_TITLES[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <input
              ref={headerUploadRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleHeaderCsvInput}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => headerUploadRef.current?.click()}
              disabled={isEditingLocked}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">Upload New Plan</span>
              <span className="sm:hidden">Upload</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadXlsx}
              disabled={loading || exporting || records.length === 0}
              className="h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{exporting ? 'Generating...' : 'Download .xlsx'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-6 space-y-5 max-w-[1600px] w-full mx-auto">
          {isEditingLocked && activeTab !== 'control_panel' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900">
              <span className="inline-flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Read-Only Public Mode is enabled. Visitors can view reports and download Excel; unlock the Control Panel to make changes.
                </span>
              </span>
              <button
                type="button"
                onClick={() => setActiveTab('control_panel')}
                className="font-semibold text-blue-800 hover:underline whitespace-nowrap cursor-pointer"
              >
                Unlock Control Panel &rarr;
              </button>
            </div>
          )}

          {bannerMessage && (
            <div className="bg-white border border-slate-300 rounded-xl px-4 py-3 flex items-center justify-between gap-4 text-xs text-slate-800">
              <span>{bannerMessage}</span>
              <button
                type="button"
                onClick={() => setBannerMessage(null)}
                className="text-slate-500 hover:text-slate-900 font-medium whitespace-nowrap cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {error ? (
            <div className="bg-white border border-red-200 rounded-xl p-6 space-y-3">
              <div className="text-sm font-semibold text-red-800">
                Unable to load master planning workbook
              </div>
              <p className="text-xs text-slate-600">{error}</p>
              <button
                type="button"
                onClick={loadWorkspaceFromServer}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
              >
                Retry Loading Plan
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-4">
              <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse"
                  />
                ))}
              </div>
              <div className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab !== 'reminders' && activeTab !== 'control_panel' && (
                <FilterToolbar
                  selectedFactory={selectedFactory}
                  onFactoryChange={handleFactoryChange}
                  selectedLine={selectedLine}
                  onLineChange={setSelectedLine}
                  availableLines={availableLines}
                  stageFilter={stageFilter}
                  onStageFilterChange={setStageFilter}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  referenceDateIso={referenceDateIso}
                  onReferenceDateChange={handleReferenceDateChange}
                  onUploadCsv={handleUploadCsv}
                  hasCustomEdits={hasCustomEdits}
                  onResetEdits={handleResetEdits}
                />
              )}

              {activeTab === 'dashboard' && (
                <KpiDashboardView
                  filteredRecords={filteredRecords}
                  allRecords={evaluatedAll}
                  shortcutSummaries={shortcutSummaries}
                  selectedFactory={selectedFactory}
                  selectedLine={selectedLine}
                  onSelectFactory={handleFactoryChange}
                  onSelectLine={setSelectedLine}
                  onNavigateTab={setActiveTab}
                />
              )}

              {activeTab === 'cutting_entry' && (
                <DailyCuttingEntryView
                  allRecords={evaluatedAll}
                  filteredRecords={filteredRecords}
                  cuttingEntries={cuttingEntries}
                  referenceDateIso={referenceDateIso}
                  onAddCuttingEntry={handleAddCuttingEntry}
                  onDeleteCuttingEntry={handleDeleteCuttingEntry}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'database' && (
                <PlanningDatabaseView
                  records={filteredRecords}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'tracker' && (
                <FabricOrderTrackerView
                  records={filteredRecords}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'fo_required' && (
                <ActionListsView
                  mode="fo"
                  records={filteredRecords}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'action_required' && (
                <ActionListsView
                  mode="action"
                  records={filteredRecords}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'reminders' && meta && (
                <EmailRemindersView
                  meta={meta}
                  records={records}
                  cuttingEntries={cuttingEntries}
                  referenceDateIso={referenceDateIso}
                  reminders={reminders}
                  smtpStatus={smtpStatus}
                  appUrl={appUrl}
                  onUpdateSchedule={handleUpdateSchedule}
                  onSaveSmtp={handleSaveSmtp}
                  onVerifySmtp={handleVerifySmtp}
                  onResetSmtp={handleResetSmtp}
                  onAddRecipient={handleAddRecipient}
                  onUpdateRecipient={handleUpdateRecipient}
                  onDeleteRecipient={handleDeleteRecipient}
                  onSendNow={handleSendReminderNow}
                />
              )}

              {activeTab === 'control_panel' && meta && (
                <ControlPanelView
                  adminUnlocked={adminUnlocked}
                  siteConfig={siteConfig}
                  meta={meta}
                  records={records}
                  cuttingEntries={cuttingEntries}
                  reminders={reminders}
                  smtpStatus={smtpStatus}
                  onUnlock={handleUnlockControlPanel}
                  onLock={handleLockControlPanel}
                  onUpdateSiteConfig={handleUpdateSiteConfig}
                  onRequestPasswordCode={handleRequestPasswordCode}
                  onChangePassword={handleChangePassword}
                  onUploadCsv={handleUploadCsv}
                  onResetPlan={handleResetEdits}
                  onDownloadXlsx={handleDownloadXlsx}
                  onDownloadBackup={handleDownloadBackup}
                  onReopenOrder={(id, status) =>
                    handleUpdateRecord(id, { orderStatus: status })
                  }
                  onUpdateSchedule={handleUpdateSchedule}
                  onSendReminderNow={() => handleSendReminderNow()}
                  onNavigateTab={setActiveTab}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
