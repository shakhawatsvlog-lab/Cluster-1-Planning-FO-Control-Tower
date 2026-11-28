import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Eye,
  EyeOff,
  Link2,
  Lock,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  buildLineShortcutSummaries,
  diffDaysIso,
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
  RecipientFrequency,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpProviderPreset,
  SmtpSettingsPublic,
} from './shared/reminderTypes.ts';
import { DEFAULT_WEBSITE_CONTROL_CONFIG } from './shared/controlPanelTypes.ts';
import type { WebsiteControlConfig } from './shared/controlPanelTypes.ts';
import { DEFAULT_CUTTING_SHEET_CONFIG } from './shared/cuttingSheetTypes.ts';
import type {
  CuttingSheetLinkRole,
  CuttingSheetLinkScope,
  CuttingSheetSyncConfig,
} from './shared/cuttingSheetTypes.ts';
import { Sidebar } from './components/Sidebar.tsx';
import type { NavTab } from './components/Sidebar.tsx';
import { FilterToolbar, isRecordInDateRange } from './components/FilterToolbar.tsx';
import type { DateRangeFilterValue, StageFilter } from './components/FilterToolbar.tsx';
import { KpiDashboardView } from './components/KpiDashboardView.tsx';
import { DailyCuttingEntryView } from './components/DailyCuttingEntryView.tsx';
import { PlanningDatabaseView } from './components/PlanningDatabaseView.tsx';
import { FabricOrderTrackerView } from './components/FabricOrderTrackerView.tsx';
import { ActionListsView } from './components/ActionListsView.tsx';
import { EmailRemindersView } from './components/EmailRemindersView.tsx';
import { ControlPanelView } from './components/ControlPanelView.tsx';
import { FoChecklistView } from './components/FoChecklistView.tsx';
import {
  ShehreenAssistant,
  type ShehreenAction,
} from './components/ShehreenAssistant.tsx';
import {
  AppLinkModal,
  copyTextWithFallback,
  resolveBaseAppLinks,
} from './components/AppLinkModal.tsx';
import { OfflineIndicator } from './components/PWAInstallButton.tsx';
import { SystemUpdatePopup } from './components/SystemUpdatePopup.tsx';
import {
  ConnectionStatusBadge,
  type SyncConnectionState,
} from './components/ConnectionStatusBadge.tsx';
import { apiUrl } from './lib/apiBase.ts';
import {
  readStoredAdminToken,
  writeStoredAdminToken,
} from './lib/adminSession.ts';
import {
  BACKGROUND_SYNC_INTERVAL_MS,
  HttpStatusError,
  SYNC_FOCUS_COOLDOWN_MS,
  SYNC_REQUEST_TIMEOUT_MS,
  formatCurrentTimeLabel,
  getProgressiveBackoffDelayMs,
  isBrowserOffline,
  isColdStartOrNetworkFailure,
  probeServerHealth,
} from './lib/syncClient.ts';
import {
  getAppRoute,
  navigateToRoute,
  restoreGitHubPagesSpaRedirect,
} from './lib/routes.ts';
import type { AppPortalRoute } from './lib/routes.ts';
import { EntryPortalPage } from './components/EntryPortalPage.tsx';
import { ControlTowerLoginPage } from './components/ControlTowerLoginPage.tsx';
import { PublicMasterPlanPage } from './components/PublicMasterPlanPage.tsx';
import { PoMatcherView } from './components/poMatcher/PoMatcherView.tsx';
import { SiteFooter } from './components/SiteFooter.tsx';

const STORAGE_KEY = 'alex_apparels_cluster1_plan_v2';
const FILTER_PANEL_STORAGE_KEY = 'alex_apparels_filter_panel_open_v1';

function readStoredFilterExpanded(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(FILTER_PANEL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredFilterExpanded(expanded: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(FILTER_PANEL_STORAGE_KEY, expanded ? 'true' : 'false');
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

const TAB_TITLES: Record<NavTab, string> = {
  dashboard: 'KPI Dashboard & Shortcut Summary',
  cutting_entry: 'Daily Cutting Entry',
  fo_checklist: 'Weekly Fabric Order Checklist',
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
  updatedAtIso?: string;
  reminders: ReminderWorkspaceState;
  smtpStatus: SmtpSettingsPublic;
  siteConfig?: WebsiteControlConfig;
  cuttingSheetSync?: CuttingSheetSyncConfig;
  adminUnlocked?: boolean;
  adminToken?: string;
  needsInitialSetup?: boolean;
  appUrl?: string;
}

export default function App() {
  const [portalRoute, setPortalRoute] = useState<AppPortalRoute>(() =>
    restoreGitHubPagesSpaRedirect()
  );
  const [checkingControlTowerAuth, setCheckingControlTowerAuth] = useState<boolean>(
    () => getAppRoute() === 'control_tower'
  );

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
  const [cuttingSheetSync, setCuttingSheetSync] = useState<CuttingSheetSyncConfig>(
    DEFAULT_CUTTING_SHEET_CONFIG
  );
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [needsInitialSetup, setNeedsInitialSetup] = useState(false);
  const [adminLoginModalOpen, setAdminLoginModalOpen] = useState(false);
  const [modalPassword, setModalPassword] = useState('');
  const [modalRecoveryEmail, setModalRecoveryEmail] = useState('');
  const [modalShowPassword, setModalShowPassword] = useState(false);
  const [modalAuthError, setModalAuthError] = useState<string | null>(null);
  const [modalAuthBusy, setModalAuthBusy] = useState(false);
  const [appUrl, setAppUrl] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [hasCustomEdits, setHasCustomEdits] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<SyncConnectionState>(() =>
    isBrowserOffline() ? 'offline' : 'connected'
  );
  const [lastAdminSyncedAt, setLastAdminSyncedAt] = useState<string | null>(null);
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);

  const handleNavigatePortal = useCallback((nextRoute: AppPortalRoute) => {
    navigateToRoute(nextRoute);
    setPortalRoute(nextRoute);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPortalRoute(getAppRoute());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const raw = new URLSearchParams(window.location.search).get('tab') as NavTab | null;
    return raw && raw in TAB_TITLES ? raw : 'dashboard';
  });
  const [selectedFactory, setSelectedFactory] = useState<FactoryName | 'ALL'>(() => {
    if (typeof window === 'undefined') return 'ALL';
    const raw = new URLSearchParams(window.location.search).get('factory')?.toUpperCase();
    return raw && ALLOWED_FACTORIES.includes(raw as FactoryName)
      ? (raw as FactoryName)
      : 'ALL';
  });
  const [selectedLine, setSelectedLine] = useState<string>('ALL');
  const [stageFilter, setStageFilter] = useState<StageFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [referenceDateIso, setReferenceDateIso] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [filterPanelExpanded, setFilterPanelExpanded] = useState<boolean>(() =>
    readStoredFilterExpanded()
  );
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilterValue>({
    field: 'endDateIso',
    fromIso: '',
    toIso: '',
  });
  const dateRangeActive = Boolean(dateRangeFilter.fromIso || dateRangeFilter.toIso);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shehreenOpen, setShehreenOpen] = useState(false);
  const [appLinkModalOpen, setAppLinkModalOpen] = useState(false);
  const [headerLinkCopied, setHeaderLinkCopied] = useState(false);

  const headerUploadRef = useRef<HTMLInputElement | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const adminTokenRef = useRef<string | null>(readStoredAdminToken());
  const referenceDateIsoRef = useRef<string>(referenceDateIso);
  referenceDateIsoRef.current = referenceDateIso;
  const lastServerVersionRef = useRef<string | null>(null);
  const pendingLocalChangesRef = useRef(false);
  const bgSyncInFlightRef = useRef(false);
  const lastBgSyncMsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectInFlightRef = useRef(false);

  const setSessionToken = useCallback((token: string | null) => {
    const clean = token && token.trim() ? token.trim() : null;
    adminTokenRef.current = clean;
    writeStoredAdminToken(clean);
  }, []);

  const buildHeaders = useCallback((includeJson = true): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    if (adminTokenRef.current) {
      headers['X-Admin-Token'] = adminTokenRef.current;
    }
    return headers;
  }, []);

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
      pendingLocalChangesRef.current = true;
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
      }
      syncTimerRef.current = window.setTimeout(async () => {
        syncTimerRef.current = null;
        if (isBrowserOffline()) {
          setConnectionStatus('offline');
          return;
        }
        try {
          const res = await fetch(apiUrl('/api/workspace'), {
            method: 'PUT',
            credentials: 'include',
            headers: buildHeaders(true),
            body: JSON.stringify({
              meta: nextMeta,
              records: nextRecords,
              cuttingEntries: nextCutting,
              referenceDateIso: nextRefDateIso,
              hasCustomEdits: customEditsFlag,
            }),
          });
          if (res.status === 401 || res.status === 403) {
            pendingLocalChangesRef.current = false;
            setSessionToken(null);
            setAdminUnlocked(false);
            setBannerMessage(
              'Admin session expired or missing. Please sign in to save changes to the Control Tower.'
            );
            return;
          }
          if (res.ok) {
            const payload = (await res.json().catch(() => null)) as {
              updatedAtIso?: string;
            } | null;
            if (payload?.updatedAtIso) {
              lastServerVersionRef.current = payload.updatedAtIso;
            }
            pendingLocalChangesRef.current = false;
            lastBgSyncMsRef.current = Date.now();
            setLastAdminSyncedAt(formatCurrentTimeLabel());
            setConnectionStatus('connected');
          }
        } catch (err) {
          if (isColdStartOrNetworkFailure(err)) {
            setConnectionStatus(isBrowserOffline() ? 'offline' : 'reconnecting');
          }
          // Local backup remains intact if offline or reconnecting
        }
      }, 250);
    },
    [buildHeaders, setSessionToken]
  );

  const loadWorkspaceFromServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/workspace'), {
        credentials: 'include',
        headers: buildHeaders(false),
      });
      if (res.status === 401 || res.status === 403) {
        setSessionToken(null);
        setAdminUnlocked(false);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }
      const data = (await res.json()) as WorkspaceApiResponse;

      const unlocked = Boolean(data.adminUnlocked);
      if (!unlocked) {
        setSessionToken(null);
      }
      setAdminUnlocked(unlocked);
      setNeedsInitialSetup(Boolean(data.needsInitialSetup));
      if (data.siteConfig) setSiteConfig(data.siteConfig);
      if (data.cuttingSheetSync) setCuttingSheetSync(data.cuttingSheetSync);

      if (!data.hasCustomEdits && data.adminUnlocked) {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as {
              meta: MasterPlanMeta;
              records: PlanningRecord[];
              cuttingEntries: DailyCuttingEntry[];
            };
            if (parsed?.meta && Array.isArray(parsed?.records) && parsed.records.length > 0) {
              const normalized = parsed.records.map((r) => {
                const status = (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus;
                const closed = status === 'Order Closed' || Boolean(r.isFinished);
                return {
                  ...r,
                  orderStatus: status,
                  isFinished: closed,
                  isManualRunning: closed ? false : Boolean(r.isManualRunning),
                };
              });
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
                referenceDateIsoRef.current,
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

      const normalizedRecords = data.records.map((r) => {
        const status = (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus;
        const closed = status === 'Order Closed' || Boolean(r.isFinished);
        return {
          ...r,
          orderStatus: status,
          isFinished: closed,
          isManualRunning: closed ? false : Boolean(r.isManualRunning),
        };
      });

      setMeta(data.meta);
      setRecords(normalizedRecords);
      setCuttingEntries(Array.isArray(data.cuttingEntries) ? data.cuttingEntries : []);
      if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
      setHasCustomEdits(Boolean(data.hasCustomEdits));
      setReminders(data.reminders);
      setSmtpStatus(data.smtpStatus || INITIAL_SMTP_STATUS);
      setAppUrl(data.appUrl || '');
      lastServerVersionRef.current = data.updatedAtIso ?? null;
      lastBgSyncMsRef.current = Date.now();
      setLastAdminSyncedAt(formatCurrentTimeLabel());
      setConnectionStatus('connected');
    } catch (err) {
      if (isColdStartOrNetworkFailure(err)) {
        setConnectionStatus(isBrowserOffline() ? 'offline' : 'reconnecting');
      }
      setError(err instanceof Error ? err.message : 'Unable to load master planning data.');
    } finally {
      setLoading(false);
    }
  }, [buildHeaders, setSessionToken, syncWorkspaceToServer]);

  useEffect(() => {
    if (portalRoute !== 'control_tower') {
      setCheckingControlTowerAuth(false);
      return;
    }

    let cancelled = false;
    const verifyControlTowerAccess = async () => {
      setCheckingControlTowerAuth(true);
      try {
        const res = await fetch(apiUrl('/api/admin/status'), {
          credentials: 'include',
          headers: buildHeaders(false),
        });
        if (!res.ok) {
          throw new Error('Failed to check admin status');
        }
        const status = (await res.json()) as {
          unlocked?: boolean;
          needsInitialSetup?: boolean;
          companyName?: string;
          portalTitle?: string;
          siteConfig?: WebsiteControlConfig;
        };
        if (cancelled) return;

        setNeedsInitialSetup(Boolean(status.needsInitialSetup));
        if (status.siteConfig) {
          setSiteConfig(status.siteConfig);
        } else if (status.companyName || status.portalTitle) {
          setSiteConfig((prev) => ({
            ...prev,
            ...(status.companyName ? { companyName: status.companyName } : {}),
            ...(status.portalTitle ? { portalTitle: status.portalTitle } : {}),
          }));
        }

        if (status.unlocked) {
          setAdminUnlocked(true);
          setCheckingControlTowerAuth(false);
          await loadWorkspaceFromServer();
        } else {
          setSessionToken(null);
          setAdminUnlocked(false);
          setCheckingControlTowerAuth(false);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSessionToken(null);
          setAdminUnlocked(false);
          setCheckingControlTowerAuth(false);
          setLoading(false);
        }
      }
    };

    void verifyControlTowerAccess();
    return () => {
      cancelled = true;
    };
  }, [portalRoute, buildHeaders, loadWorkspaceFromServer, setSessionToken]);

  // Stabilize background sync refs so 15s background polling interval stays stable without recreating
  const cuttingSyncRefs = useRef({
    lastUpdatedAtIso: cuttingSheetSync.lastUpdatedAtIso,
    lastCheckedAtIso: cuttingSheetSync.lastCheckedAtIso,
    meta,
    records,
  });
  cuttingSyncRefs.current = {
    lastUpdatedAtIso: cuttingSheetSync.lastUpdatedAtIso,
    lastCheckedAtIso: cuttingSheetSync.lastCheckedAtIso,
    meta,
    records,
  };

  // Smart 15-second background workspace synchronization + progressive-backoff reconnection (Zero full-page reloads)
  useEffect(() => {
    if (portalRoute !== 'control_tower' || !adminUnlocked) return;
    let active = true;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      setRetryInSeconds(null);
    };

    const hasActiveUnsavedWork = (): boolean => {
      if (pendingLocalChangesRef.current || syncTimerRef.current !== null) {
        return true;
      }
      if (typeof document !== 'undefined') {
        const el = document.activeElement;
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) {
          // Do not overwrite fields while Admin is actively typing/editing inside the workspace
          return Boolean(el.closest('main'));
        }
      }
      return false;
    };

    const scheduleReconnectBackoff = () => {
      if (!active || reconnectTimerRef.current !== null || reconnectInFlightRef.current) return;
      if (isBrowserOffline()) {
        setConnectionStatus('offline');
        setRetryInSeconds(null);
        return;
      }

      const delayMs = getProgressiveBackoffDelayMs(reconnectAttemptRef.current);
      setConnectionStatus('reconnecting');
      setRetryInSeconds(Math.max(1, Math.ceil(delayMs / 1000)));

      reconnectTimerRef.current = window.setTimeout(async () => {
        reconnectTimerRef.current = null;
        if (!active) return;
        if (isBrowserOffline()) {
          setConnectionStatus('offline');
          setRetryInSeconds(null);
          return;
        }
        if (reconnectInFlightRef.current) return;

        reconnectInFlightRef.current = true;
        setRetryInSeconds(null);
        let healthy = false;
        try {
          healthy = await probeServerHealth();
        } finally {
          reconnectInFlightRef.current = false;
        }
        if (!active) return;

        if (healthy) {
          clearReconnectTimer();
          void runAdminBackgroundSync(true);
        } else {
          reconnectAttemptRef.current += 1;
          scheduleReconnectBackoff();
        }
      }, delayMs);
    };

    const runAdminBackgroundSync = async (forceCheck = false) => {
      if (!active || bgSyncInFlightRef.current) return;
      if (isBrowserOffline()) {
        setConnectionStatus('offline');
        return;
      }
      if (
        !forceCheck &&
        Date.now() - lastBgSyncMsRef.current < SYNC_FOCUS_COOLDOWN_MS
      ) {
        return;
      }

      // Preserve unsaved Admin inputs / debounced saves without cancelling background health
      if (hasActiveUnsavedWork()) {
        return;
      }

      bgSyncInFlightRef.current = true;
      setConnectionStatus('syncing');

      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SYNC_REQUEST_TIMEOUT_MS);

      try {
        // Step 1: Ultra-lightweight Admin version check first (avoids heavy payload downloads when unchanged)
        const verRes = await fetch(apiUrl('/api/workspace/sync-version'), {
          credentials: 'include',
          cache: 'no-store',
          headers: buildHeaders(false),
          signal: controller.signal,
        });

        if (verRes.status === 401 || verRes.status === 403) {
          setSessionToken(null);
          setAdminUnlocked(false);
          clearReconnectTimer();
          return;
        }
        if (!verRes.ok) {
          throw new HttpStatusError(
            verRes.status,
            `Failed workspace sync version check (${verRes.status})`
          );
        }

        const verData = (await verRes.json()) as {
          ok?: boolean;
          version?: string;
        };
        const serverVersion = verData?.version || null;

        if (
          !forceCheck &&
          serverVersion &&
          lastServerVersionRef.current &&
          serverVersion === lastServerVersionRef.current
        ) {
          lastBgSyncMsRef.current = Date.now();
          setLastAdminSyncedAt(formatCurrentTimeLabel());
          setConnectionStatus('connected');
          clearReconnectTimer();
          return;
        }

        // Step 2: Re-check unsaved work before fetching & applying updated workspace snapshot
        if (hasActiveUnsavedWork()) {
          setConnectionStatus('connected');
          return;
        }

        const res = await fetch(apiUrl('/api/workspace'), {
          credentials: 'include',
          cache: 'no-store',
          headers: buildHeaders(false),
          signal: controller.signal,
        });

        if (res.status === 401 || res.status === 403) {
          setSessionToken(null);
          setAdminUnlocked(false);
          clearReconnectTimer();
          return;
        }
        if (!res.ok) {
          throw new HttpStatusError(res.status, `Failed workspace sync (${res.status})`);
        }

        const data = (await res.json()) as WorkspaceApiResponse;
        if (!active || hasActiveUnsavedWork()) {
          return;
        }

        const normalizedRecords = Array.isArray(data.records)
          ? data.records.map((r) => {
              const status = (r.orderStatus ??
                (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus;
              const closed = status === 'Order Closed' || Boolean(r.isFinished);
              return {
                ...r,
                orderStatus: status,
                isFinished: closed,
                isManualRunning: closed ? false : Boolean(r.isManualRunning),
              };
            })
          : cuttingSyncRefs.current.records;

        if (data.meta) setMeta(data.meta);
        if (normalizedRecords.length > 0) setRecords(normalizedRecords);
        if (Array.isArray(data.cuttingEntries)) setCuttingEntries(data.cuttingEntries);
        if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
        if (data.siteConfig) setSiteConfig(data.siteConfig);
        if (data.cuttingSheetSync) setCuttingSheetSync(data.cuttingSheetSync);
        if (data.reminders) setReminders(data.reminders);
        if (data.smtpStatus) setSmtpStatus(data.smtpStatus);
        setHasCustomEdits(Boolean(data.hasCustomEdits));

        const activeMeta = data.meta || cuttingSyncRefs.current.meta;
        if (activeMeta && normalizedRecords.length > 0) {
          saveLocalBackup(
            activeMeta,
            normalizedRecords,
            Array.isArray(data.cuttingEntries) ? data.cuttingEntries : []
          );
        }

        lastServerVersionRef.current = data.updatedAtIso ?? serverVersion;
        lastBgSyncMsRef.current = Date.now();
        setLastAdminSyncedAt(formatCurrentTimeLabel());
        setConnectionStatus('connected');
        clearReconnectTimer();
      } catch (err) {
        if (controller.signal.aborted && !timedOut) return;
        if (!active) return;
        if (isColdStartOrNetworkFailure(err)) {
          if (isBrowserOffline()) {
            setConnectionStatus('offline');
          } else {
            scheduleReconnectBackoff();
          }
        }
      } finally {
        window.clearTimeout(timeoutId);
        bgSyncInFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void runAdminBackgroundSync(false);
      }
    }, BACKGROUND_SYNC_INTERVAL_MS);

    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible') {
        void runAdminBackgroundSync(false);
      }
    };

    const handleOnline = () => {
      clearReconnectTimer();
      void runAdminBackgroundSync(true);
    };

    const handleOffline = () => {
      clearReconnectTimer();
      setConnectionStatus('offline');
    };

    window.addEventListener('focus', handleFocusOrVisibility);
    document.addEventListener('visibilitychange', handleFocusOrVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocusOrVisibility);
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearReconnectTimer();
    };
  }, [portalRoute, adminUnlocked, buildHeaders, saveLocalBackup, setSessionToken]);

  // Automatic change-detection loop for saved online sheet links while Control Tower is open
  const autoSheetCheckInFlightRef = useRef(false);
  const lastAutoSheetAttemptMsRef = useRef(0);
  const cuttingSheetSyncMetaRef = useRef(cuttingSheetSync);
  cuttingSheetSyncMetaRef.current = cuttingSheetSync;

  useEffect(() => {
    if (portalRoute !== 'control_tower' || !adminUnlocked) return;
    let active = true;

    const hasAnySavedUrl = (cfg: CuttingSheetSyncConfig): boolean =>
      Boolean((cfg.sheetUrl || '').trim()) ||
      Boolean((cfg.outputSheetUrl || '').trim()) ||
      Boolean((cfg.packingSheetUrl || '').trim()) ||
      Object.values(cfg.factoryUrls || {}).some((v) => typeof v === 'string' && Boolean(v.trim())) ||
      Object.values(cfg.outputFactoryUrls || {}).some(
        (v) => typeof v === 'string' && Boolean(v.trim())
      ) ||
      Object.values(cfg.packingFactoryUrls || {}).some(
        (v) => typeof v === 'string' && Boolean(v.trim())
      );

    const checkSavedLinksForChanges = async () => {
      if (!active || autoSheetCheckInFlightRef.current || isBrowserOffline()) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (pendingLocalChangesRef.current || syncTimerRef.current !== null) return;

      const cfg = cuttingSheetSyncMetaRef.current;
      if (!cfg.enabled || !hasAnySavedUrl(cfg)) return;

      const intervalMs = Math.max(1, cfg.intervalMinutes || 5) * 60_000;
      const lastCheckedMs = cfg.lastCheckedAtIso ? Date.parse(cfg.lastCheckedAtIso) : 0;
      const elapsedSinceServerCheck =
        Number.isFinite(lastCheckedMs) && lastCheckedMs > 0
          ? Date.now() - lastCheckedMs
          : Infinity;
      const elapsedSinceClientAttempt = Date.now() - lastAutoSheetAttemptMsRef.current;

      if (elapsedSinceServerCheck < intervalMs || elapsedSinceClientAttempt < 45_000) {
        return;
      }

      autoSheetCheckInFlightRef.current = true;
      lastAutoSheetAttemptMsRef.current = Date.now();
      try {
        const res = await fetch(apiUrl('/api/cutting-sheet/sync'), {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders(true),
          body: JSON.stringify({ trigger: 'Auto', force: false }),
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          ok?: boolean;
          updated?: boolean;
          records?: PlanningRecord[];
          cuttingEntries?: DailyCuttingEntry[];
          cuttingSheetSync?: CuttingSheetSyncConfig;
        };
        if (data.cuttingSheetSync) {
          setCuttingSheetSync(data.cuttingSheetSync);
        }
        if (data.updated) {
          const nextRecords =
            Array.isArray(data.records) && data.records.length > 0
              ? data.records
              : cuttingSyncRefs.current.records;
          if (Array.isArray(data.records) && data.records.length > 0) {
            setRecords(data.records);
            setHasCustomEdits(true);
          }
          const nextCutting = Array.isArray(data.cuttingEntries)
            ? data.cuttingEntries
            : undefined;
          if (nextCutting) {
            setCuttingEntries(nextCutting);
            setHasCustomEdits(true);
          }
          if (cuttingSyncRefs.current.meta && nextCutting) {
            saveLocalBackup(cuttingSyncRefs.current.meta, nextRecords, nextCutting);
          }
          setLastAdminSyncedAt(formatCurrentTimeLabel());
        }
      } catch {
        // Silent background check; next interval or server cron will retry automatically
      } finally {
        autoSheetCheckInFlightRef.current = false;
      }
    };

    const initialTimer = window.setTimeout(() => {
      void checkSavedLinksForChanges();
    }, 6_000);

    const intervalTimer = window.setInterval(() => {
      void checkSavedLinksForChanges();
    }, 30_000);

    return () => {
      active = false;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalTimer);
    };
  }, [portalRoute, adminUnlocked, buildHeaders, saveLocalBackup]);

  const isEditingLocked = !adminUnlocked;

  const promptAdminSignIn = useCallback((notice?: string) => {
    setBannerMessage(
      notice || 'Admin sign-in is required to modify planning records, uploads, or settings.'
    );
    setModalAuthError(null);
    setAdminLoginModalOpen(true);
  }, []);

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
        outputQty: number | null;
        outputUpdatedAtIso: string | null;
        packingQty: number | null;
        packingUpdatedAtIso: string | null;
        endDateIso: string | null;
        isFinished: boolean;
        orderStatus: OrderStatus;
        foNumber: string;
        foDate: string;
        foStatus: FoStatus;
        fabricNote: string;
        foChecklistConfirmed: boolean;
        foChecklistConfirmedAtIso: string | null;
        upcomingFoSelected: boolean;
        upcomingFoSelectedAtIso: string | null;
      }>
    ) => {
      if (isEditingLocked) {
        promptAdminSignIn();
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
          if (merged.orderStatus === 'Order Closed' || merged.isFinished) {
            merged.isManualRunning = false;
          }
          return merged;
        });
        if (meta) persistState(meta, next, cuttingEntries);
        return next;
      });
    },
    [isEditingLocked, meta, cuttingEntries, persistState, promptAdminSignIn]
  );

  const handleUpdatePackingQty = useCallback(
    async (recordIds: string[], packingQty: number | null) => {
      if (isEditingLocked) {
        promptAdminSignIn('Admin sign-in is required to update Packing Qty.');
        return;
      }
      const cleanIds = recordIds.filter(Boolean);
      if (cleanIds.length === 0) return;
      const sanitized =
        packingQty !== null && Number.isFinite(packingQty) && packingQty >= 0
          ? Math.round(packingQty)
          : null;
      const nowIso = sanitized !== null ? new Date().toISOString() : null;

      setRecords((prev) => {
        const idSet = new Set(cleanIds);
        const next = prev.map((r) =>
          idSet.has(r.id)
            ? { ...r, packingQty: sanitized, packingUpdatedAtIso: nowIso }
            : r
        );
        if (meta) saveLocalBackup(meta, next, cuttingEntries);
        return next;
      });
      setHasCustomEdits(true);

      try {
        pendingLocalChangesRef.current = true;
        const res = await fetch(apiUrl('/api/packing'), {
          method: 'PATCH',
          credentials: 'include',
          headers: buildHeaders(true),
          body: JSON.stringify({ recordIds: cleanIds, packingQty: sanitized }),
        });
        if (res.status === 401 || res.status === 403) {
          pendingLocalChangesRef.current = false;
          setAdminUnlocked(false);
          setSessionToken(null);
          promptAdminSignIn('Admin session expired. Sign in again to save Packing Qty.');
          return;
        }
        if (!res.ok) {
          pendingLocalChangesRef.current = false;
          const errPayload = (await res.json().catch(() => null)) as { error?: string } | null;
          setBannerMessage(errPayload?.error || 'Unable to save Packing Qty to server.');
          return;
        }
        const okPayload = (await res.json().catch(() => null)) as {
          updatedAtIso?: string;
        } | null;
        if (okPayload?.updatedAtIso) {
          lastServerVersionRef.current = okPayload.updatedAtIso;
        }
        pendingLocalChangesRef.current = false;
        lastBgSyncMsRef.current = Date.now();
        setLastAdminSyncedAt(formatCurrentTimeLabel());
        setConnectionStatus('connected');
      } catch (err) {
        pendingLocalChangesRef.current = false;
        console.error('Failed to persist Admin packing qty:', err);
      }
    },
    [isEditingLocked, promptAdminSignIn, buildHeaders, setSessionToken, meta, cuttingEntries, saveLocalBackup]
  );

  const handleUpdateOutputQty = useCallback(
    async (recordIds: string[], outputQty: number | null) => {
      if (isEditingLocked) {
        promptAdminSignIn('Admin sign-in is required to update Output Qty.');
        return;
      }
      const cleanIds = recordIds.filter(Boolean);
      if (cleanIds.length === 0) return;
      const sanitized =
        outputQty !== null && Number.isFinite(outputQty) && outputQty >= 0
          ? Math.round(outputQty)
          : null;
      const nowIso = sanitized !== null ? new Date().toISOString() : null;

      setRecords((prev) => {
        const idSet = new Set(cleanIds);
        const next = prev.map((r) =>
          idSet.has(r.id)
            ? { ...r, outputQty: sanitized, outputUpdatedAtIso: nowIso }
            : r
        );
        if (meta) saveLocalBackup(meta, next, cuttingEntries);
        return next;
      });
      setHasCustomEdits(true);

      try {
        pendingLocalChangesRef.current = true;
        const res = await fetch(apiUrl('/api/output'), {
          method: 'PATCH',
          credentials: 'include',
          headers: buildHeaders(true),
          body: JSON.stringify({ recordIds: cleanIds, outputQty: sanitized }),
        });
        if (res.status === 401 || res.status === 403) {
          pendingLocalChangesRef.current = false;
          setAdminUnlocked(false);
          setSessionToken(null);
          promptAdminSignIn('Admin session expired. Sign in again to save Output Qty.');
          return;
        }
        if (!res.ok) {
          pendingLocalChangesRef.current = false;
          const errPayload = (await res.json().catch(() => null)) as { error?: string } | null;
          setBannerMessage(errPayload?.error || 'Unable to save Output Qty to server.');
          return;
        }
        const okPayload = (await res.json().catch(() => null)) as {
          updatedAtIso?: string;
        } | null;
        if (okPayload?.updatedAtIso) {
          lastServerVersionRef.current = okPayload.updatedAtIso;
        }
        pendingLocalChangesRef.current = false;
        lastBgSyncMsRef.current = Date.now();
        setLastAdminSyncedAt(formatCurrentTimeLabel());
        setConnectionStatus('connected');
      } catch (err) {
        pendingLocalChangesRef.current = false;
        console.error('Failed to persist Admin output qty:', err);
      }
    },
    [isEditingLocked, promptAdminSignIn, buildHeaders, setSessionToken, meta, cuttingEntries, saveLocalBackup]
  );

  const handleBulkUpdateRecords = useCallback(
    (
      ids: string[],
      patch: Partial<{
        upcomingFoSelected: boolean;
        upcomingFoSelectedAtIso: string | null;
      }>
    ) => {
      if (isEditingLocked) {
        promptAdminSignIn();
        return;
      }
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setRecords((prev) => {
        const next = prev.map((r) => (idSet.has(r.id) ? { ...r, ...patch } : r));
        if (meta) persistState(meta, next, cuttingEntries);
        return next;
      });
    },
    [isEditingLocked, meta, cuttingEntries, persistState, promptAdminSignIn]
  );

  const handleSetRunningStyle = useCallback(
    (recordId: string) => {
      if (isEditingLocked) {
        promptAdminSignIn('Admin sign-in is required to update running styles.');
        return;
      }
      setRecords((prev) => {
        const target = prev.find((r) => r.id === recordId);
        if (!target) return prev;
        const next = prev.map((r) => {
          if (r.factory !== target.factory || r.line !== target.line) return r;
          if (r.id === recordId) {
            return {
              ...r,
              isManualRunning: true,
              orderStatus: 'Open' as OrderStatus,
              isFinished: false,
            };
          }
          return { ...r, isManualRunning: false };
        });
        if (meta) persistState(meta, next, cuttingEntries);
        return next;
      });
    },
    [isEditingLocked, meta, cuttingEntries, persistState, promptAdminSignIn]
  );

  const handleClearLineRunning = useCallback(
    (factory: FactoryName, line: string) => {
      if (isEditingLocked) {
        promptAdminSignIn('Admin sign-in is required to update running styles.');
        return;
      }
      setRecords((prev) => {
        const next = prev.map((r) =>
          r.factory === factory && r.line === line
            ? { ...r, isManualRunning: false }
            : r
        );
        if (meta) persistState(meta, next, cuttingEntries);
        return next;
      });
    },
    [isEditingLocked, meta, cuttingEntries, persistState, promptAdminSignIn]
  );

  const handleAdvanceRunningOrder = useCallback(
    (finishedRecordId: string) => {
      if (isEditingLocked) {
        promptAdminSignIn('Admin sign-in is required to advance running orders.');
        return;
      }
      setRecords((prev) => {
        const finished = prev.find((r) => r.id === finishedRecordId);
        if (!finished) return prev;
        const nextOpen = [...prev]
          .filter(
            (r) =>
              r.factory === finished.factory &&
              r.line === finished.line &&
              r.id !== finished.id &&
              r.slot > finished.slot &&
              r.orderStatus !== 'Order Closed' &&
              !r.isFinished
          )
          .sort((a, b) => a.slot - b.slot)[0];

        const next = prev.map((r) => {
          if (r.factory !== finished.factory || r.line !== finished.line) return r;
          if (r.id === finished.id) {
            return {
              ...r,
              orderStatus: 'Order Closed' as OrderStatus,
              isFinished: true,
              isManualRunning: false,
            };
          }
          if (nextOpen && r.id === nextOpen.id) {
            return {
              ...r,
              isManualRunning: true,
              orderStatus: 'Open' as OrderStatus,
              isFinished: false,
            };
          }
          return { ...r, isManualRunning: false };
        });

        if (meta) persistState(meta, next, cuttingEntries);
        setBannerMessage(
          nextOpen
            ? `${finished.factory} ${finished.line}: Marked ${finished.pgNumber !== '—' ? finished.pgNumber : finished.style} finished & started ${nextOpen.pgNumber !== '—' ? nextOpen.pgNumber : nextOpen.style} — next queued style stepped up!`
            : `${finished.factory} ${finished.line}: Marked ${finished.pgNumber !== '—' ? finished.pgNumber : finished.style} Order Closed.`
        );
        return next;
      });
    },
    [isEditingLocked, meta, cuttingEntries, persistState, promptAdminSignIn]
  );

  const handleAddCuttingEntry = useCallback(
    (entryData: Omit<DailyCuttingEntry, 'id'>) => {
      if (isEditingLocked) {
        promptAdminSignIn('Admin sign-in is required to log daily cutting.');
        return;
      }
      const newEntry: DailyCuttingEntry = {
        ...entryData,
        source: entryData.source ?? 'manual',
        id: `CUT-${Date.now().toString(36).toUpperCase()}`,
      };
      setCuttingEntries((prev) => {
        const next = [newEntry, ...prev];
        if (meta) persistState(meta, records, next);
        return next;
      });
    },
    [isEditingLocked, meta, records, persistState, promptAdminSignIn]
  );

  const handleDeleteCuttingEntry = useCallback(
    (entryId: string) => {
      if (isEditingLocked) {
        promptAdminSignIn();
        return;
      }
      setCuttingEntries((prev) => {
        const next = prev.filter((e) => e.id !== entryId);
        if (meta) persistState(meta, records, next);
        return next;
      });
    },
    [isEditingLocked, meta, records, persistState, promptAdminSignIn]
  );

  const handleUploadCsv = (csvText: string, fileName: string) => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to upload Master Plans.');
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
          cuttingInputQty: match.cuttingInputQty ?? null,
          outputQty: match.outputQty ?? null,
          outputUpdatedAtIso: match.outputUpdatedAtIso ?? null,
          packingQty: match.packingQty ?? null,
          packingUpdatedAtIso: match.packingUpdatedAtIso ?? null,
          dailyTargetQty: match.dailyTargetQty,
          isFinished: match.isFinished,
          orderStatus: match.orderStatus,
          isManualRunning:
            match.orderStatus === 'Order Closed' || match.isFinished
              ? false
              : Boolean(match.isManualRunning),
          foNumber: match.foNumber,
          foDate: match.foDate,
          foStatus: match.foStatus,
          fabricNote: match.fabricNote,
          sheetRemark: match.sheetRemark,
          foFullQtyReleased: Boolean(match.foFullQtyReleased),
          foChecklistConfirmed: Boolean(match.foChecklistConfirmed),
          foChecklistConfirmedAtIso: match.foChecklistConfirmedAtIso ?? null,
          upcomingFoSelected: Boolean(match.upcomingFoSelected),
          upcomingFoSelectedAtIso: match.upcomingFoSelectedAtIso ?? null,
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

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Failed to read file.'));
          return;
        }
        const commaIdx = reader.result.indexOf(',');
        resolve(commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result);
      };
      reader.onerror = () => reject(new Error('Could not read selected file.'));
      reader.readAsDataURL(file);
    });

  const handleUploadPlanFile = async (file: File) => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to upload Master Plans.');
      return;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xlsx')) {
      try {
        setBannerMessage(`Reading Excel workbook "${file.name}"...`);
        const base64 = await readFileAsBase64(file);
        const res = await fetch(apiUrl('/api/master-plan/parse-xlsx'), {
          method: 'POST',
          credentials: 'include',
          headers: buildHeaders(true),
          body: JSON.stringify({ base64, fileName: file.name }),
        });
        const data = (await res.json()) as { ok?: boolean; csvText?: string; error?: string };
        if (!res.ok || !data.csvText) {
          setBannerMessage(data.error || `Failed to parse Excel plan "${file.name}".`);
          return;
        }
        handleUploadCsv(data.csvText, file.name);
      } catch (err) {
        setBannerMessage(
          err instanceof Error ? err.message : `Failed to upload "${file.name}".`
        );
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        handleUploadCsv(reader.result, file.name);
      }
    };
    reader.readAsText(file);
  };

  const handleHeaderCsvInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void handleUploadPlanFile(file);
    e.target.value = '';
  };

  const handleResetEdits = async () => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to reset the Master Plan.');
      return;
    }
    localStorage.removeItem(STORAGE_KEY);
    setBannerMessage(null);
    try {
      const res = await fetch(apiUrl('/api/workspace/reset'), {
        method: 'POST',
        credentials: 'include',
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
        if (data.cuttingSheetSync) setCuttingSheetSync(data.cuttingSheetSync);
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
      const response = await fetch(apiUrl('/api/export-xlsx'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
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

  const handleDownloadSelectedFoXlsx = async (selectedIds?: string[]): Promise<boolean> => {
    if (!meta || records.length === 0) return false;
    try {
      const response = await fetch(apiUrl('/api/export-selected-fo-xlsx'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify({
          meta,
          records,
          cuttingEntries,
          referenceDateIso,
          selectedRecordIds: selectedIds,
        }),
      });
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Selected_Upcoming_FO_List_${referenceDateIso}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      setBannerMessage('Selected Upcoming FO Excel download failed. Please try again.');
      return false;
    }
  };

  const handleSendSavedFoEmail = async (payload: {
    toEmails: string;
    subject: string;
    bodyText: string;
    selectedRecordIds: string[];
    attachXlsx: boolean;
  }): Promise<{ ok: boolean; message: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to send emails.');
      return { ok: false, message: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/saved-fo/send-email'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify({
          toEmails: payload.toEmails,
          subject: payload.subject,
          bodyText: payload.bodyText,
          selectedRecordIds: payload.selectedRecordIds,
          attachXlsx: payload.attachXlsx,
          referenceDateIso,
          records,
          cuttingEntries,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        reminders?: ReminderWorkspaceState;
      };
      if (data.reminders) {
        setReminders(data.reminders);
      }
      return {
        ok: Boolean(res.ok && data.ok),
        message: data.message || data.error || 'Could not send email.',
      };
    } catch {
      return {
        ok: false,
        message: 'Network error while sending Saved Upcoming FO email.',
      };
    }
  };

  // Control Panel Auth & Admin Handlers
  const applyAuthSuccessState = (data: Partial<WorkspaceApiResponse>) => {
    if (typeof data.adminToken === 'string' && data.adminToken.trim()) {
      setSessionToken(data.adminToken);
    }
    setAdminUnlocked(true);
    setNeedsInitialSetup(false);
    if (data.meta) setMeta(data.meta);
    if (Array.isArray(data.records)) {
      const normalizedRecords = data.records.map((r) => {
        const status = (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus;
        const closed = status === 'Order Closed' || Boolean(r.isFinished);
        return {
          ...r,
          orderStatus: status,
          isFinished: closed,
          isManualRunning: closed ? false : Boolean(r.isManualRunning),
        };
      });
      setRecords(normalizedRecords);
    }
    if (Array.isArray(data.cuttingEntries)) setCuttingEntries(data.cuttingEntries);
    if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
    if (data.hasCustomEdits !== undefined) setHasCustomEdits(Boolean(data.hasCustomEdits));
    if (data.siteConfig) setSiteConfig(data.siteConfig);
    if (data.reminders) setReminders(data.reminders);
    if (data.smtpStatus) setSmtpStatus(data.smtpStatus);
    if (data.cuttingSheetSync) setCuttingSheetSync(data.cuttingSheetSync);
    setLoading(false);
    setBannerMessage(null);
    void loadWorkspaceFromServer();
  };

  const handleUnlockControlPanel = async (
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/admin/unlock'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as Partial<WorkspaceApiResponse> & {
        ok?: boolean;
        error?: string;
        needsInitialSetup?: boolean;
      };
      if (data.needsInitialSetup) {
        setNeedsInitialSetup(true);
      }
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || 'Incorrect Admin password.' };
      }
      applyAuthSuccessState(data);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while verifying Admin password.' };
    }
  };

  const handleBootstrapAdmin = async (payload: {
    password: string;
    recoveryEmail?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/admin/bootstrap'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Partial<WorkspaceApiResponse> & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || 'Failed to configure initial Admin password.' };
      }
      applyAuthSuccessState(data);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while initializing Admin password.' };
    }
  };

  const handleLockControlPanel = async () => {
    try {
      await fetch(apiUrl('/api/admin/lock'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(false),
      });
    } catch {
      // Ignore network errors on sign out
    }
    setSessionToken(null);
    setAdminUnlocked(false);
    setMeta(null);
    setRecords([]);
    setCuttingEntries([]);
  };

  const handleUpdateSiteConfig = async (
    patch: Partial<WebsiteControlConfig>
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/admin/site-config'), {
        method: 'PUT',
        credentials: 'include',
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

  const handleUpdatePlanningRules = async (
    patch: Partial<
      Pick<
        WebsiteControlConfig,
        'inputStartOffsetDays' | 'upcomingFoOffsetDays' | 'cuttingAlertDays'
      >
    >
  ): Promise<{ ok: boolean; error?: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to update planning trigger offsets.');
      return { ok: false, error: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/planning-rules'), {
        method: 'PUT',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        siteConfig?: WebsiteControlConfig;
        error?: string;
      };
      if (!res.ok || !data.siteConfig) {
        return { ok: false, error: data.error || 'Failed to update planning rules.' };
      }
      setSiteConfig(data.siteConfig);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while saving planning rules.' };
    }
  };

  const handleRequestPasswordCode = async (): Promise<{
    ok: boolean;
    smtpMissing?: boolean;
    message: string;
  }> => {
    try {
      const res = await fetch(apiUrl('/api/admin/password/request-code'), {
        method: 'POST',
        credentials: 'include',
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
      const res = await fetch(apiUrl('/api/admin/password/change'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        adminToken?: string;
        message?: string;
        error?: string;
      };
      if (data.ok && typeof data.adminToken === 'string' && data.adminToken.trim()) {
        setSessionToken(data.adminToken);
      }
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
      const res = await fetch(apiUrl('/api/admin/backup'), {
        credentials: 'include',
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

  const handleGetBackupJson = async (): Promise<string | null> => {
    try {
      const res = await fetch(apiUrl('/api/admin/backup'), {
        credentials: 'include',
        headers: buildHeaders(false),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  };

  const handleGetXlsxBlob = async (): Promise<Blob | null> => {
    if (!meta || records.length === 0) return null;
    try {
      const response = await fetch(apiUrl('/api/export-xlsx'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify({ meta, records, cuttingEntries, referenceDateIso }),
      });
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  };

  const handleRestoreSnapshot = async (
    snapshot: unknown
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/admin/restore'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify(snapshot),
      });
      const data = (await res.json()) as WorkspaceApiResponse & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error || 'Failed to restore workspace snapshot.' };
      }
      const normalized = data.records.map((r) => {
        const status = (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus;
        const closed = status === 'Order Closed' || Boolean(r.isFinished);
        return {
          ...r,
          orderStatus: status,
          isFinished: closed,
          isManualRunning: closed ? false : Boolean(r.isManualRunning),
        };
      });
      setMeta(data.meta);
      setRecords(normalized);
      setCuttingEntries(Array.isArray(data.cuttingEntries) ? data.cuttingEntries : []);
      if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
      setHasCustomEdits(Boolean(data.hasCustomEdits));
      setReminders(data.reminders);
      if (data.siteConfig) setSiteConfig(data.siteConfig);
      if (data.cuttingSheetSync) setCuttingSheetSync(data.cuttingSheetSync);
      if (data.smtpStatus) setSmtpStatus(data.smtpStatus);
      saveLocalBackup(
        data.meta,
        normalized,
        Array.isArray(data.cuttingEntries) ? data.cuttingEntries : []
      );
      setBannerMessage('Workspace successfully restored from backup snapshot.');
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error while restoring backup snapshot.' };
    }
  };

  // Online Cutting Sheet Sync Handlers
  const handleSaveCuttingSheetConfig = async (
    patch: Partial<
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
      >
    >
  ): Promise<{ ok: boolean; error?: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to configure online cutting sheet URLs.');
      return { ok: false, error: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/cutting-sheet/config'), {
        method: 'PUT',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        cuttingSheetSync?: CuttingSheetSyncConfig;
        error?: string;
      };
      if (!res.ok || !data.cuttingSheetSync) {
        return {
          ok: false,
          error: data.error || 'Failed to save online cutting sheet configuration.',
        };
      }
      setCuttingSheetSync(data.cuttingSheetSync);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: 'Network error while saving online cutting sheet settings.',
      };
    }
  };

  const handleRemoveCuttingSheetLink = async (
    role: CuttingSheetLinkRole,
    scope: CuttingSheetLinkScope
  ): Promise<{ ok: boolean; error?: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to remove saved online sheet links.');
      return { ok: false, error: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/cutting-sheet/links/remove'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify({ role, scope }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        cuttingSheetSync?: CuttingSheetSyncConfig;
        error?: string;
      };
      if (!res.ok || !data.cuttingSheetSync) {
        return {
          ok: false,
          error: data.error || 'Failed to remove saved sheet link.',
        };
      }
      setCuttingSheetSync(data.cuttingSheetSync);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: 'Network error while removing saved sheet link.',
      };
    }
  };

  const handleTriggerCuttingSheetSync = async (options?: {
    trigger?: 'Auto' | 'Manual';
    force?: boolean;
  }): Promise<{
    ok: boolean;
    message: string;
    updated?: boolean;
  }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to run an online sheet sync.');
      return { ok: false, message: 'Admin sign-in required.' };
    }
    const trigger = options?.trigger ?? 'Manual';
    const force = options?.force ?? trigger === 'Manual';
    try {
      const res = await fetch(apiUrl('/api/cutting-sheet/sync'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify({ trigger, force }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        updated?: boolean;
        message?: string;
        error?: string;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        cuttingSheetSync?: CuttingSheetSyncConfig;
      };
      if (data.cuttingSheetSync) {
        setCuttingSheetSync(data.cuttingSheetSync);
      }
      if (data.updated || trigger === 'Manual') {
        const nextRecords =
          Array.isArray(data.records) && data.records.length > 0 ? data.records : records;
        if (Array.isArray(data.records) && data.records.length > 0) {
          setRecords(data.records);
          setHasCustomEdits(true);
        }
        const nextCutting = Array.isArray(data.cuttingEntries)
          ? data.cuttingEntries
          : cuttingEntries;
        if (Array.isArray(data.cuttingEntries)) {
          setCuttingEntries(data.cuttingEntries);
          setHasCustomEdits(true);
        }
        if (meta && (Array.isArray(data.records) || Array.isArray(data.cuttingEntries))) {
          saveLocalBackup(meta, nextRecords, nextCutting);
        }
      }
      return {
        ok: Boolean(data.ok),
        updated: Boolean(data.updated),
        message: data.message || data.error || 'Sheet sync finished.',
      };
    } catch {
      return {
        ok: false,
        message: 'Could not reach server to sync online cutting sheet.',
      };
    }
  };

  const handleUploadCuttingFile = async (
    file: File,
    factoryOverride?: FactoryName
  ): Promise<{ ok: boolean; message: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to upload cutting sheets.');
      return {
        ok: false,
        message: 'Admin sign-in required to upload cutting sheets.',
      };
    }
    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const payload: {
        fileName: string;
        base64?: string;
        csvText?: string;
        factory?: FactoryName;
      } = {
        fileName: file.name,
      };
      if (factoryOverride) payload.factory = factoryOverride;

      if (isCsv) {
        payload.csvText = await file.text();
      } else {
        payload.base64 = await readFileAsBase64(file);
      }

      const res = await fetch(apiUrl('/api/cutting-sheet/upload'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        records?: PlanningRecord[];
        cuttingEntries?: DailyCuttingEntry[];
        cuttingSheetSync?: CuttingSheetSyncConfig;
      };
      if (data.cuttingSheetSync) {
        setCuttingSheetSync(data.cuttingSheetSync);
      }
      const nextRecords =
        Array.isArray(data.records) && data.records.length > 0 ? data.records : records;
      if (Array.isArray(data.records) && data.records.length > 0) {
        setRecords(data.records);
        setHasCustomEdits(true);
      }
      const nextCutting = Array.isArray(data.cuttingEntries)
        ? data.cuttingEntries
        : cuttingEntries;
      if (Array.isArray(data.cuttingEntries)) {
        setCuttingEntries(data.cuttingEntries);
        setHasCustomEdits(true);
      }
      if (meta && (Array.isArray(data.records) || Array.isArray(data.cuttingEntries))) {
        saveLocalBackup(meta, nextRecords, nextCutting);
      }
      return {
        ok: Boolean(data.ok),
        message: data.message || data.error || 'Cutting file upload finished.',
      };
    } catch {
      return {
        ok: false,
        message: 'Network error while uploading cutting file.',
      };
    }
  };

  // Reminder & Hosting SMTP API handlers
  const handleUpdateSchedule = async (patch: Partial<ReminderScheduleConfig>) => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to modify reminder schedules.');
      return;
    }
    setReminders((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, ...patch },
    }));
    try {
      const res = await fetch(apiUrl('/api/reminders/schedule'), {
        method: 'PUT',
        credentials: 'include',
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
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to configure SMTP.');
      return { ok: false, error: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/reminders/smtp'), {
        method: 'PUT',
        credentials: 'include',
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
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to verify SMTP.');
      return { ok: false, message: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/reminders/smtp/verify'), {
        method: 'POST',
        credentials: 'include',
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

  const handleSendTestEmail = async (
    toEmail: string
  ): Promise<{ ok: boolean; message: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to send test emails.');
      return { ok: false, message: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/reminders/smtp/test-email'), {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(true),
        body: JSON.stringify({ toEmail }),
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
        message: data.message || data.error || 'Test email request finished.',
      };
    } catch {
      return { ok: false, message: 'Could not reach server to dispatch test email.' };
    }
  };

  const handleResetSmtp = async () => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required.');
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/reminders/smtp'), {
        method: 'DELETE',
        credentials: 'include',
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
    frequency: RecipientFrequency;
    sendTime: string;
    dayOfWeek: number;
    dayOfMonth: number;
    customNote: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to add email recipients.');
      return { ok: false, error: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl('/api/reminders/recipients'), {
        method: 'POST',
        credentials: 'include',
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
      frequency: RecipientFrequency;
      sendTime: string;
      dayOfWeek: number;
      dayOfMonth: number;
      customNote: string;
    }>
  ): Promise<{ ok: boolean; error?: string }> => {
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required.');
      return { ok: false, error: 'Admin sign-in required.' };
    }
    try {
      const res = await fetch(apiUrl(`/api/reminders/recipients/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        credentials: 'include',
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
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required.');
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/reminders/recipients/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        credentials: 'include',
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
    if (isEditingLocked) {
      promptAdminSignIn('Admin sign-in is required to dispatch reminder emails.');
      return { ok: false, message: 'Admin sign-in required.' };
    }
    try {
      if (meta && records.length > 0 && !isEditingLocked) {
        await fetch(apiUrl('/api/workspace'), {
          method: 'PUT',
          credentials: 'include',
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

      const res = await fetch(apiUrl('/api/reminders/send-now'), {
        method: 'POST',
        credentials: 'include',
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
      if (!isRecordInDateRange(r, dateRangeFilter)) return false;
      if (q) {
        const hay =
          `${r.factory} ${r.line} ${r.pgNumber} ${r.style} ${r.nextStyle} ${r.productCategory} ${r.foNumber}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [evaluatedAll, selectedFactory, selectedLine, stageFilter, searchQuery, dateRangeFilter]);

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

  const counts = useMemo(() => {
    const shortcutUpcomingMap = new Map<string, number | null>();
    for (const s of shortcutSummaries) {
      if (s.upcomingRecord) {
        shortcutUpcomingMap.set(s.upcomingRecord.id, s.daysToUpcomingFoTrigger);
      }
    }
    const foChecklistPending = evaluatedAll.filter((r) => {
      if (r.orderStatus === 'Order Closed' || r.foChecklistConfirmed) return false;
      if (r.styleClassification === 'Open Capacity') return false;
      const isStepActive =
        r.lifecycleStage === 'Running' || r.lifecycleStage === 'Upcoming (Next)';
      const upDays = shortcutUpcomingMap.get(r.id);
      const daysLeft = upDays !== undefined ? upDays : r.daysToTrigger;
      const triggerDays =
        r.triggerDateIso !== null ? diffDaysIso(r.triggerDateIso, referenceDateIso) : null;
      return (
        r.isCuttingWithin10Days ||
        (isStepActive &&
          ((daysLeft !== null && daysLeft <= 7) ||
            (triggerDays !== null && triggerDays <= 7)))
      );
    }).length;

    return {
      database: evaluatedAll.length,
      cuttingEntries: cuttingEntries.length,
      foChecklistPending,
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
    };
  }, [evaluatedAll, shortcutSummaries, referenceDateIso, cuttingEntries.length, reminders.recipients]);

  const handleApplyShehreenAction = useCallback((action: ShehreenAction) => {
    if (
      action.navigateTab &&
      action.navigateTab !== 'master_plan' &&
      action.navigateTab !== 'fo_needed'
    ) {
      setActiveTab(action.navigateTab);
    }
    if (action.filterFactory) {
      setSelectedFactory(action.filterFactory);
      if (!action.filterLine) {
        setSelectedLine('ALL');
      }
    }
    if (action.filterLine) {
      setSelectedLine(action.filterLine);
    }
    if (typeof action.searchQuery === 'string' && action.searchQuery.trim()) {
      setSearchQuery(action.searchQuery.trim());
    }
  }, []);

  if (portalRoute === 'landing') {
    return (
      <>
        <EntryPortalPage
          companyName={siteConfig.companyName}
          onNavigate={handleNavigatePortal}
        />
        <OfflineIndicator />
        <SystemUpdatePopup />
      </>
    );
  }

  if (portalRoute === 'master_plan') {
    return (
      <>
        <PublicMasterPlanPage
          onBackToPortal={() => handleNavigatePortal('landing')}
        />
        <OfflineIndicator />
        <SystemUpdatePopup />
      </>
    );
  }

  if (portalRoute === 'po_matcher') {
    return (
      <>
        <PoMatcherView
          companyName={siteConfig.companyName}
          onBackToPortal={() => handleNavigatePortal('landing')}
        />
        <OfflineIndicator />
        <SystemUpdatePopup />
      </>
    );
  }

  if (!adminUnlocked) {
    return (
      <>
        <ControlTowerLoginPage
          companyName={siteConfig.companyName}
          portalTitle={siteConfig.portalTitle}
          checkingSession={checkingControlTowerAuth}
          needsInitialSetup={needsInitialSetup}
          initialNotice={bannerMessage}
          onUnlock={handleUnlockControlPanel}
          onBootstrapAdmin={handleBootstrapAdmin}
          onBackToPortal={() => {
            setBannerMessage(null);
            handleNavigatePortal('landing');
          }}
        />
        <OfflineIndicator />
        <SystemUpdatePopup />
      </>
    );
  }

  return (
    <div className="app-shell-height flex robotics-workspace-bg text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        selectedFactory={selectedFactory}
        onSelectFactory={handleFactoryChange}
        factorySummaries={factorySummaries}
        counts={counts}
        adminUnlocked={adminUnlocked}
        asOfDateRaw={meta?.asOfDateRaw || '18-Nov-26'}
        inputStartOffsetDays={siteConfig.inputStartOffsetDays}
        upcomingFoOffsetDays={siteConfig.upcomingFoOffsetDays}
        cuttingAlertDays={siteConfig.cuttingAlertDays}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onOpenShehreen={() => setShehreenOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar with Company Logo on Left & Admin Session / App Link / AI / Upload / Download CTAs on Right */}
        <header className="sticky top-0 z-40 ct-header-glass ct-safe-header">
          <div className="h-16 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation-drawer"
              className="lg:hidden relative z-10 h-11 w-11 -ml-1 inline-flex items-center justify-center rounded-lg border border-slate-200/90 bg-white/90 text-slate-700 hover:bg-slate-50 active:bg-slate-100 shrink-0 cursor-pointer touch-manipulation"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {!logoError ? (
                <img
                  src={`${import.meta.env.BASE_URL}assets/aistudio/OIP__1__63903905.webp`}
                  alt={siteConfig.companyName}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-6 sm:h-8 max-w-[78px] sm:max-w-none w-auto object-contain shrink-0"
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
              <h1 className="hidden md:block font-display font-semibold text-sm sm:text-base text-slate-900 truncate">
                {activeTab === 'dashboard' ? siteConfig.portalTitle : TAB_TITLES[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <ConnectionStatusBadge
              status={connectionStatus}
              lastSyncedAt={lastAdminSyncedAt}
              retryInSeconds={retryInSeconds}
            />

            <button
              type="button"
              onClick={() => {
                if (adminUnlocked) {
                  void handleLockControlPanel();
                } else {
                  promptAdminSignIn();
                }
              }}
              title={
                adminUnlocked
                  ? 'Admin session active — click to sign out'
                  : 'Sign in as Admin to edit workspace data & settings'
              }
              className={`h-9 sm:h-10 px-2.5 sm:px-3 rounded-lg border text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                adminUnlocked
                  ? 'border-teal-300/80 bg-teal-50/90 text-teal-900 hover:bg-teal-100/80 shadow-[0_2px_10px_-4px_rgba(13,148,136,0.35)]'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {adminUnlocked ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
                  <span className="hidden xl:inline">Admin Active</span>
                  <LogOut className="w-3.5 h-3.5 text-teal-700 hidden sm:inline shrink-0" />
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="hidden sm:inline">Admin Sign In</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={async () => {
                const { currentOrigin, sharedTeamOrigin } = resolveBaseAppLinks(appUrl);
                const primaryUrl = sharedTeamOrigin || currentOrigin;
                if (primaryUrl) {
                  const normalizedUrl = `${primaryUrl.replace(/\/+$/, '')}/`;
                  const ok = await copyTextWithFallback(normalizedUrl);
                  if (ok) {
                    setHeaderLinkCopied(true);
                    window.setTimeout(() => setHeaderLinkCopied(false), 2500);
                  }
                }
                setAppLinkModalOpen(true);
              }}
              title="Copy universal App Link & QR code for Android, iOS, and Desktop"
              className={`h-9 sm:h-10 px-2.5 sm:px-3 rounded-lg border text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                headerLinkCopied
                  ? 'border-teal-300 bg-teal-50 text-teal-800'
                  : 'border-cyan-200/80 bg-white/90 hover:border-cyan-400 hover:bg-cyan-50/60 text-slate-800'
              }`}
            >
              {headerLinkCopied ? (
                <Check className="w-4 h-4 text-teal-600 shrink-0" />
              ) : (
                <Link2 className="w-4 h-4 text-cyan-700 shrink-0" />
              )}
              <span className="hidden md:inline">
                {headerLinkCopied ? 'Copied' : 'App Link'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShehreenOpen((prev) => !prev)}
              className="h-9 sm:h-10 px-2.5 sm:px-3.5 rounded-lg bg-gradient-to-r from-[#0a1633] via-[#102652] to-[#0891b2] hover:brightness-110 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-cyan-200 shrink-0" />
              <span className="hidden sm:inline">Ask Shehreen</span>
              <span className="sm:hidden">AI</span>
            </button>

            <input
              ref={headerUploadRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleHeaderCsvInput}
              className="hidden"
            />
            {adminUnlocked && (
              <button
                type="button"
                onClick={() => headerUploadRef.current?.click()}
                className="h-9 sm:h-10 px-2.5 sm:px-3 rounded-lg border border-cyan-200/80 bg-white/90 hover:border-cyan-400 hover:bg-cyan-50/60 text-slate-800 text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Upload className="w-4 h-4 text-cyan-700 shrink-0" />
                <span className="hidden xl:inline">Upload Plan</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadXlsx}
              disabled={loading || exporting || records.length === 0}
              className="h-9 sm:h-10 px-2.5 sm:px-4 rounded-lg bg-gradient-to-r from-cyan-700 to-teal-700 hover:from-cyan-800 hover:to-teal-600 disabled:opacity-50 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span className="hidden sm:inline">
                {exporting ? 'Generating...' : 'Download .xlsx'}
              </span>
              <span className="sm:hidden">{exporting ? '...' : '.xlsx'}</span>
            </button>
          </div>
          </div>
        </header>

        <main className="flex-1 ct-safe-x py-5 sm:py-6 space-y-5 max-w-[1600px] w-full mx-auto">
          {isEditingLocked && activeTab !== 'control_panel' && (
            <div className="ct-surface rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-700">
              <span className="inline-flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  Public View-Only session · Sign in as Admin to edit records, upload sheets, or manage email reminders.
                </span>
              </span>
              <button
                type="button"
                onClick={() => promptAdminSignIn()}
                className="font-semibold text-cyan-700 hover:text-cyan-800 hover:underline whitespace-nowrap cursor-pointer"
              >
                Admin Sign In &rarr;
              </button>
            </div>
          )}

          {bannerMessage && (
            <div className="ct-surface rounded-2xl px-4 py-3 flex items-center justify-between gap-4 text-xs text-slate-800">
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
            <div className="ct-surface border-red-200 rounded-2xl p-6 space-y-3">
              <div className="text-sm font-semibold text-red-800">
                Unable to load master planning workbook
              </div>
              <p className="text-xs text-slate-600">{error}</p>
              <button
                type="button"
                onClick={loadWorkspaceFromServer}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-800 text-white text-xs font-medium hover:brightness-110 transition-all cursor-pointer"
              >
                Retry Loading Plan
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-4">
              <div className="h-24 ct-surface rounded-2xl animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-28 ct-surface rounded-2xl animate-pulse"
                  />
                ))}
              </div>
              <div className="h-80 ct-surface rounded-2xl animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab !== 'reminders' && activeTab !== 'control_panel' && (
                <FilterToolbar
                  isExpanded={filterPanelExpanded}
                  onToggleExpanded={() =>
                    setFilterPanelExpanded((prev) => {
                      const next = !prev;
                      writeStoredFilterExpanded(next);
                      return next;
                    })
                  }
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
                  dateRangeFilter={dateRangeFilter}
                  onApplyDateRange={setDateRangeFilter}
                  onClearDateRange={() =>
                    setDateRangeFilter((prev) => ({ ...prev, fromIso: '', toIso: '' }))
                  }
                  matchedRecordCount={filteredRecords.length}
                  totalRecordCount={evaluatedAll.length}
                  onUploadPlanFile={handleUploadPlanFile}
                  hasCustomEdits={hasCustomEdits}
                  onResetEdits={handleResetEdits}
                />
              )}

              {activeTab === 'dashboard' && (
                <KpiDashboardView
                  meta={meta}
                  allRecords={evaluatedAll}
                  shortcutSummaries={shortcutSummaries}
                  referenceDateIso={referenceDateIso}
                  dateRangeFilter={dateRangeFilter}
                  inputStartOffsetDays={siteConfig.inputStartOffsetDays}
                  upcomingFoOffsetDays={siteConfig.upcomingFoOffsetDays}
                  cuttingAlertDays={siteConfig.cuttingAlertDays}
                  isEditingLocked={isEditingLocked}
                  onUpdatePlanningRules={handleUpdatePlanningRules}
                  selectedFactory={selectedFactory}
                  selectedLine={selectedLine}
                  onSelectFactory={handleFactoryChange}
                  onSelectLine={setSelectedLine}
                  onSetRunningStyle={handleSetRunningStyle}
                  onClearLineRunning={handleClearLineRunning}
                  onAdvanceRunningOrder={handleAdvanceRunningOrder}
                  onToggleUpcomingFoSelection={(recordId, selected) =>
                    handleUpdateRecord(recordId, {
                      upcomingFoSelected: selected,
                      upcomingFoSelectedAtIso: selected ? new Date().toISOString() : null,
                    })
                  }
                  onBulkToggleUpcomingFoSelection={(recordIds, selected) =>
                    handleBulkUpdateRecords(recordIds, {
                      upcomingFoSelected: selected,
                      upcomingFoSelectedAtIso: selected ? new Date().toISOString() : null,
                    })
                  }
                  onDownloadSelectedFoXlsx={handleDownloadSelectedFoXlsx}
                  reminderRecipients={reminders.recipients}
                  smtpConfigured={smtpStatus.configured}
                  smtpSenderEmail={smtpStatus.senderEmail}
                  onSendSavedFoEmail={handleSendSavedFoEmail}
                  onNavigateTab={setActiveTab}
                />
              )}

              {activeTab === 'cutting_entry' && (
                <DailyCuttingEntryView
                  allRecords={evaluatedAll}
                  filteredRecords={filteredRecords}
                  cuttingEntries={cuttingEntries}
                  referenceDateIso={referenceDateIso}
                  cuttingSheetSync={cuttingSheetSync}
                  onSaveCuttingSheetConfig={handleSaveCuttingSheetConfig}
                  onRemoveCuttingSheetLink={handleRemoveCuttingSheetLink}
                  onSyncCuttingSheetNow={handleTriggerCuttingSheetSync}
                  onUploadCuttingFile={handleUploadCuttingFile}
                  onAddCuttingEntry={handleAddCuttingEntry}
                  onDeleteCuttingEntry={handleDeleteCuttingEntry}
                  onUpdateRecord={handleUpdateRecord}
                  onUpdateOutputQty={handleUpdateOutputQty}
                  onUpdatePackingQty={handleUpdatePackingQty}
                  onSetRunningStyle={handleSetRunningStyle}
                />
              )}

              {activeTab === 'fo_checklist' && (
                <FoChecklistView
                  filteredRecords={filteredRecords}
                  shortcutSummaries={shortcutSummaries}
                  referenceDateIso={referenceDateIso}
                  inputStartOffsetDays={siteConfig.inputStartOffsetDays}
                  upcomingFoOffsetDays={siteConfig.upcomingFoOffsetDays}
                  cuttingAlertDays={siteConfig.cuttingAlertDays}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'database' && (
                <PlanningDatabaseView
                  records={filteredRecords}
                  dateRangeActive={dateRangeActive}
                  onUpdateRecord={handleUpdateRecord}
                  onSetRunningStyle={handleSetRunningStyle}
                />
              )}

              {activeTab === 'tracker' && (
                <FabricOrderTrackerView
                  records={filteredRecords}
                  dateRangeActive={dateRangeActive}
                  onUpdateRecord={handleUpdateRecord}
                  onSetRunningStyle={handleSetRunningStyle}
                />
              )}

              {activeTab === 'fo_required' && (
                <ActionListsView
                  mode="fo"
                  records={filteredRecords}
                  dateRangeActive={dateRangeActive}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'action_required' && (
                <ActionListsView
                  mode="action"
                  records={filteredRecords}
                  dateRangeActive={dateRangeActive}
                  onUpdateRecord={handleUpdateRecord}
                />
              )}

              {activeTab === 'reminders' && meta && (
                <EmailRemindersView
                  meta={meta}
                  records={records}
                  cuttingEntries={cuttingEntries}
                  referenceDateIso={referenceDateIso}
                  ruleOptions={ruleOptions}
                  reminders={reminders}
                  smtpStatus={smtpStatus}
                  appUrl={appUrl}
                  onUpdateSchedule={handleUpdateSchedule}
                  onSaveSmtp={handleSaveSmtp}
                  onVerifySmtp={handleVerifySmtp}
                  onSendTestEmail={handleSendTestEmail}
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
                  needsInitialSetup={needsInitialSetup}
                  siteConfig={siteConfig}
                  meta={meta}
                  records={records}
                  cuttingEntries={cuttingEntries}
                  reminders={reminders}
                  smtpStatus={smtpStatus}
                  onUnlock={handleUnlockControlPanel}
                  onBootstrapAdmin={handleBootstrapAdmin}
                  onLock={handleLockControlPanel}
                  onUpdateSiteConfig={handleUpdateSiteConfig}
                  onRequestPasswordCode={handleRequestPasswordCode}
                  onChangePassword={handleChangePassword}
                  onUploadPlanFile={handleUploadPlanFile}
                  onResetPlan={handleResetEdits}
                  onDownloadXlsx={handleDownloadXlsx}
                  onDownloadBackup={handleDownloadBackup}
                  onGetBackupJson={handleGetBackupJson}
                  onGetXlsxBlob={handleGetXlsxBlob}
                  onRestoreSnapshot={handleRestoreSnapshot}
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

        <SiteFooter
          leftContent={
            <span>
              {siteConfig.companyName} — {siteConfig.portalTitle} ·{' '}
              <span className="font-mono">ALEX 1 · ALEX 3 · ALEX 5 · ALEX 12</span>
            </span>
          }
        />
      </div>

      <ShehreenAssistant
        open={shehreenOpen}
        onToggleOpen={setShehreenOpen}
        mode="control_tower"
        currentTab={activeTab}
        selectedFactory={selectedFactory}
        selectedLine={selectedLine}
        onApplyAction={handleApplyShehreenAction}
      />

      <AppLinkModal
        open={appLinkModalOpen}
        onClose={() => setAppLinkModalOpen(false)}
        appUrl={appUrl}
        activeTab={activeTab}
        selectedFactory={selectedFactory}
        portalTitle={siteConfig.portalTitle}
      />

      {adminLoginModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md ct-surface rounded-2xl p-6 space-y-5 shadow-2xl relative overflow-hidden">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-teal-500"
              aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0a1633] to-cyan-700 text-white flex items-center justify-center shrink-0 shadow-sm">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {needsInitialSetup ? 'Set Initial Admin Password' : 'Admin Sign In'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {needsInitialSetup
                      ? 'Create the first Control Tower administrator password.'
                      : `Authenticate to modify ${siteConfig.companyName} planning data.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAdminLoginModalOpen(false);
                  setModalAuthError(null);
                  setModalPassword('');
                }}
                aria-label="Close sign-in dialog"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setModalAuthError(null);
                setModalAuthBusy(true);
                try {
                  const res = needsInitialSetup
                    ? await handleBootstrapAdmin({
                        password: modalPassword,
                        recoveryEmail: modalRecoveryEmail.trim() || undefined,
                      })
                    : await handleUnlockControlPanel(modalPassword);
                  if (!res.ok) {
                    setModalAuthError(res.error || 'Authentication failed.');
                    return;
                  }
                  setModalPassword('');
                  setModalRecoveryEmail('');
                  setAdminLoginModalOpen(false);
                } finally {
                  setModalAuthBusy(false);
                }
              }}
              className="space-y-4"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="modal-admin-pass" className="text-xs font-medium text-slate-700">
                  {needsInitialSetup ? 'New Admin Password (min 8 chars)' : 'Admin Password'}
                </label>
                <div className="relative">
                  <input
                    id="modal-admin-pass"
                    type={modalShowPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    minLength={needsInitialSetup ? 8 : 1}
                    value={modalPassword}
                    onChange={(e) => setModalPassword(e.target.value)}
                    placeholder={
                      needsInitialSetup ? 'Create strong password' : 'Enter admin password'
                    }
                    className="w-full h-11 pl-3.5 pr-10 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  />
                  <button
                    type="button"
                    onClick={() => setModalShowPassword((v) => !v)}
                    aria-label={modalShowPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {modalShowPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {needsInitialSetup && (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="modal-admin-recovery"
                    className="text-xs font-medium text-slate-700"
                  >
                    Recovery Email (Optional)
                  </label>
                  <input
                    id="modal-admin-recovery"
                    type="email"
                    value={modalRecoveryEmail}
                    onChange={(e) => setModalRecoveryEmail(e.target.value)}
                    placeholder="planner@company.com"
                    className="w-full h-11 px-3.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  />
                </div>
              )}

              {modalAuthError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {modalAuthError}
                </div>
              )}

              <button
                type="submit"
                disabled={modalAuthBusy || !modalPassword}
                className="w-full h-11 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] via-[#122b5c] to-[#0891b2] hover:brightness-110 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <Unlock className="w-4 h-4" />
                <span>
                  {modalAuthBusy
                    ? 'Verifying...'
                    : needsInitialSetup
                      ? 'Save Password & Sign In'
                      : 'Sign In as Admin'}
                </span>
              </button>
            </form>
          </div>
        </div>
      )}

      <OfflineIndicator />
      <SystemUpdatePopup />
    </div>
  );
}
