import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type {
  FactoryName,
  MasterPlanMeta,
  PublicFoNeededResponse,
  PublicMasterPlanRecord,
  PublicMasterPlanResponse,
} from '../shared/plannerTypes.ts';
import { BackendWakeupPanel } from './BackendWakeupPanel.tsx';
import {
  ConnectionStatusBadge,
  type SyncConnectionState,
} from './ConnectionStatusBadge.tsx';
import { isRecordInDateRange } from './FilterToolbar.tsx';
import type { DateRangeFilterValue } from './FilterToolbar.tsx';
import { MasterPlanInstallButton } from './MasterPlanInstallButton.tsx';
import { MasterPlanSplashScreen } from './MasterPlanSplashScreen.tsx';
import {
  PublicFactoryFilterBar,
  type PublicProductionStatusFilter,
} from './PublicFactoryFilterBar.tsx';
import { PublicFactoryPlanTable } from './PublicFactoryPlanTable.tsx';
import { PublicFactorySelectorBar } from './PublicFactorySelectorBar.tsx';
import { PublicFactorySummarySection } from './PublicFactorySummarySection.tsx';
import { PublicFoNeededView } from './PublicFoNeededView.tsx';
import {
  PublicMasterPlanTabs,
  type PublicMasterPlanTab,
} from './PublicMasterPlanTabs.tsx';
import { SiteFooter } from './SiteFooter.tsx';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { apiUrl } from '../lib/apiBase.ts';
import { buildRouteHref } from '../lib/routes.ts';
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
} from '../lib/syncClient.ts';

const SPLASH_MIN_REVEAL_MS = 950;
const SPLASH_REDUCED_MOTION_MS = 120;
const SPLASH_FAILSAFE_MAX_MS = 2400;
const SPLASH_FADE_MS = 320;
const APP_BASE_PREFIX = '/Cluster-1-Planning-FO-Control-Tower';

function readInitialFactoryFromUrl(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const val = new URLSearchParams(window.location.search).get('factory');
    return val ? val.trim() : null;
  } catch {
    return null;
  }
}

function syncFactoryQueryParam(factory: FactoryName): void {
  try {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('factory') !== factory) {
      url.searchParams.set('factory', factory);
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // Ignore history API issues in restricted contexts
  }
}

interface PublicMasterPlanPageProps {
  onBackToPortal: () => void;
}

export function PublicMasterPlanPage({ onBackToPortal }: PublicMasterPlanPageProps) {
  const { isInstalled } = usePWAInstall();

  const [activeTab, setActiveTab] = useState<PublicMasterPlanTab>('master_plan');

  const [meta, setMeta] = useState<MasterPlanMeta | null>(null);
  const [factories, setFactories] = useState<FactoryName[]>([]);
  const [selectedFactory, setSelectedFactory] = useState<FactoryName | null>(null);
  const [records, setRecords] = useState<PublicMasterPlanRecord[]>([]);
  const [cuttingSheetSummary, setCuttingSheetSummary] = useState<
    PublicMasterPlanResponse['cuttingSheetSummary']
  >(undefined);
  const [referenceDateIso, setReferenceDateIso] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [companyName, setCompanyName] = useState('Alex Apparels');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingFactory, setSwitchingFactory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wakeupActive, setWakeupActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<SyncConnectionState>(() =>
    isBrowserOffline() ? 'offline' : 'syncing'
  );
  const [retryInSeconds, setRetryInSeconds] = useState<number | null>(null);
  const [logoError, setLogoError] = useState(false);

  // FO Needed Tab State (Read-Only Mirror of Control Tower Selected FO Needed Summary Box)
  const [foNeededData, setFoNeededData] = useState<PublicFoNeededResponse | null>(null);
  const [foNeededLoading, setFoNeededLoading] = useState(false);
  const [foNeededError, setFoNeededError] = useState<string | null>(null);

  // Branded in-app splash screen lifecycle
  const [splashPhase, setSplashPhase] = useState<'showing' | 'fading' | 'done'>('showing');
  const [initialDataSettled, setInitialDataSettled] = useState(false);
  const [minRevealDone, setMinRevealDone] = useState(false);

  // Selected factory filters (preserved across background sync & tab switches)
  const [selectedLine, setSelectedLine] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<PublicProductionStatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilterValue>({
    field: 'endDateIso',
    fromIso: '',
    toIso: '',
  });

  const requestSeqRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const foAbortControllerRef = useRef<AbortController | null>(null);
  const selectedFactoryRef = useRef<FactoryName | null>(null);
  const wakeupActiveRef = useRef(false);
  const recordsCountRef = useRef(0);
  const lastMasterVersionRef = useRef<string | null>(null);
  const lastFoVersionRef = useRef<string | null>(null);
  const bgSyncInFlightRef = useRef(false);
  const lastSyncCompletedMsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    selectedFactoryRef.current = selectedFactory;
  }, [selectedFactory]);

  useEffect(() => {
    wakeupActiveRef.current = wakeupActive;
  }, [wakeupActive]);

  useEffect(() => {
    recordsCountRef.current = records.length;
  }, [records.length]);

  // Isolate document PWA manifest, title, and Apple touch metadata strictly to Alpine Master Plan
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const prevTitle = document.title;
    const manifestLink = document.querySelector('link[rel="manifest"]');
    const prevManifestHref = manifestLink?.getAttribute('href') || '';
    const appTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const prevAppTitle = appTitleMeta?.getAttribute('content') || '';
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') || '';
    const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const prevTouchIcon = touchIcon?.getAttribute('href') || '';
    const favIcon = document.querySelector('link[rel="icon"]');
    const prevFavIcon = favIcon?.getAttribute('href') || '';

    const hasBase =
      window.location.pathname === APP_BASE_PREFIX ||
      window.location.pathname.startsWith(`${APP_BASE_PREFIX}/`);
    const mpManifestHref = hasBase
      ? `${APP_BASE_PREFIX}/master-plan.webmanifest`
      : '/master-plan.webmanifest';

    document.title = 'Alpine Master Plan';
    if (manifestLink) manifestLink.setAttribute('href', mpManifestHref);
    if (appTitleMeta) appTitleMeta.setAttribute('content', 'Master Plan');
    if (themeMeta) themeMeta.setAttribute('content', '#0a1633');
    if (touchIcon) {
      touchIcon.setAttribute('href', `${APP_BASE_PREFIX}/master-plan-apple-touch-icon.png`);
    }
    if (favIcon) {
      favIcon.setAttribute('href', `${APP_BASE_PREFIX}/master-plan-icon.svg`);
    }

    return () => {
      document.title = prevTitle;
      if (manifestLink && prevManifestHref) manifestLink.setAttribute('href', prevManifestHref);
      if (appTitleMeta && prevAppTitle) appTitleMeta.setAttribute('content', prevAppTitle);
      if (themeMeta && prevTheme) themeMeta.setAttribute('content', prevTheme);
      if (touchIcon && prevTouchIcon) touchIcon.setAttribute('href', prevTouchIcon);
      if (favIcon && prevFavIcon) favIcon.setAttribute('href', prevFavIcon);
    };
  }, []);

  // Splash timing: minimum visual reveal + failsafe guarantee so UI is never blocked
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const minDelay = prefersReducedMotion ? SPLASH_REDUCED_MOTION_MS : SPLASH_MIN_REVEAL_MS;

    const minTimer = window.setTimeout(() => {
      setMinRevealDone(true);
    }, minDelay);

    const failsafeTimer = window.setTimeout(() => {
      setMinRevealDone(true);
      setInitialDataSettled(true);
    }, SPLASH_FAILSAFE_MAX_MS);

    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(failsafeTimer);
    };
  }, []);

  useEffect(() => {
    if (splashPhase !== 'showing') return;
    if (!initialDataSettled || !minRevealDone) return;

    setSplashPhase('fading');
    const fadeTimer = window.setTimeout(() => {
      setSplashPhase('done');
    }, SPLASH_FADE_MS);

    return () => {
      window.clearTimeout(fadeTimer);
    };
  }, [splashPhase, initialDataSettled, minRevealDone]);

  const stopReconnectBackoff = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setRetryInSeconds(null);
  }, []);

  const fetchPublicFoNeeded = useCallback(async (quiet = false): Promise<boolean> => {
    if (foAbortControllerRef.current) {
      foAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    foAbortControllerRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SYNC_REQUEST_TIMEOUT_MS);

    if (!quiet) {
      setFoNeededLoading(true);
    }

    try {
      const res = await fetch(apiUrl('/api/public/fo-needed'), {
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new HttpStatusError(res.status, `Unable to fetch FO Needed (${res.status})`);
      }

      const data = (await res.json()) as PublicFoNeededResponse;
      if (!mountedRef.current) return true;
      setFoNeededData(data);
      lastFoVersionRef.current = data.updatedAtIso || null;
      setFoNeededError(null);
      return true;
    } catch (err) {
      if (controller.signal.aborted && !timedOut) return false;
      if (isColdStartOrNetworkFailure(err)) {
        if (recordsCountRef.current === 0) {
          setWakeupActive(true);
        }
        setConnectionStatus(isBrowserOffline() ? 'offline' : 'reconnecting');
        setFoNeededError(null);
      } else {
        setFoNeededError(
          err instanceof Error ? err.message : 'Unable to load FO Needed Checklist.'
        );
      }
      return false;
    } finally {
      window.clearTimeout(timeoutId);
      if (mountedRef.current) {
        setFoNeededLoading(false);
      }
    }
  }, []);

  const fetchFactoryMasterPlan = useCallback(
    async (
      targetFactory: string | null,
      mode: 'initial' | 'switch' | 'refresh' | 'silent'
    ): Promise<boolean> => {
      const seq = ++requestSeqRef.current;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SYNC_REQUEST_TIMEOUT_MS);

      if (mode === 'initial') {
        setLoading(true);
        setConnectionStatus(isBrowserOffline() ? 'offline' : 'syncing');
      } else if (mode === 'switch') {
        setSwitchingFactory(true);
        setConnectionStatus(isBrowserOffline() ? 'offline' : 'syncing');
      } else if (mode === 'refresh') {
        setRefreshing(true);
        setConnectionStatus(isBrowserOffline() ? 'offline' : 'syncing');
      } else {
        setConnectionStatus(isBrowserOffline() ? 'offline' : 'syncing');
      }

      try {
        const query = targetFactory
          ? `?factory=${encodeURIComponent(targetFactory)}`
          : '?resolveDefault=1';

        let res = await fetch(apiUrl(`/api/public/master-plan${query}`), {
          cache: 'no-store',
          signal: controller.signal,
        });

        // Graceful fallback if URL contained an invalid ?factory=...
        if (res.status === 400 && targetFactory) {
          res = await fetch(apiUrl('/api/public/master-plan?resolveDefault=1'), {
            cache: 'no-store',
            signal: controller.signal,
          });
        }

        if (!res.ok) {
          throw new HttpStatusError(res.status, `Unable to fetch Master Plan (${res.status})`);
        }

        const data = (await res.json()) as PublicMasterPlanResponse;
        if (seq !== requestSeqRef.current || !mountedRef.current) return false;

        const includedFactories = Array.isArray(data.meta?.factoriesIncluded)
          ? data.meta.factoriesIncluded
          : [];
        const resolvedFactory =
          data.selectedFactory ??
          includedFactories[0] ??
          data.records?.[0]?.factory ??
          null;

        setMeta(data.meta);
        if (includedFactories.length > 0) {
          setFactories(includedFactories);
        }
        if (resolvedFactory) {
          setSelectedFactory(resolvedFactory);
          selectedFactoryRef.current = resolvedFactory;
          syncFactoryQueryParam(resolvedFactory);
        }
        setRecords(Array.isArray(data.records) ? data.records : []);
        setCuttingSheetSummary(data.cuttingSheetSummary);
        if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
        if (data.branding?.companyName) setCompanyName(data.branding.companyName);

        lastMasterVersionRef.current = data.updatedAtIso || null;
        lastSyncCompletedMsRef.current = Date.now();
        setLastSyncedAt(formatCurrentTimeLabel());
        setError(null);
        setWakeupActive(false);
        setConnectionStatus('connected');
        stopReconnectBackoff();
        return true;
      } catch (err) {
        if ((controller.signal.aborted && !timedOut) || seq !== requestSeqRef.current) {
          return false;
        }
        if (!mountedRef.current) return false;

        if (isColdStartOrNetworkFailure(err)) {
          // Only show full wake-up illustration if we have no loaded data yet; otherwise keep existing UI usable while reconnecting silently!
          if (recordsCountRef.current === 0) {
            setWakeupActive(true);
          }
          setError(null);
          setConnectionStatus(isBrowserOffline() ? 'offline' : 'reconnecting');
        } else {
          setWakeupActive(false);
          setError(err instanceof Error ? err.message : 'Unable to load live Master Plan.');
        }
        return false;
      } finally {
        window.clearTimeout(timeoutId);
        if (seq === requestSeqRef.current && mountedRef.current) {
          setLoading(false);
          setSwitchingFactory(false);
          setRefreshing(false);
          if (mode === 'initial') {
            setInitialDataSettled(true);
          }
        }
      }
    },
    [stopReconnectBackoff]
  );

  // Progressive-backoff health probe loop when connection drops AFTER initial data loaded
  const scheduleReconnectProbe = useCallback(() => {
    if (!mountedRef.current || wakeupActiveRef.current) return;
    if (reconnectTimerRef.current !== null || reconnectInFlightRef.current) return;

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
      if (!mountedRef.current || wakeupActiveRef.current) return;
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

      if (!mountedRef.current || wakeupActiveRef.current) return;

      if (healthy) {
        stopReconnectBackoff();
        setConnectionStatus('syncing');
        await Promise.all([
          fetchFactoryMasterPlan(selectedFactoryRef.current, 'silent'),
          fetchPublicFoNeeded(true),
        ]);
      } else {
        reconnectAttemptRef.current += 1;
        scheduleReconnectProbe();
      }
    }, delayMs);
  }, [fetchFactoryMasterPlan, fetchPublicFoNeeded, stopReconnectBackoff]);

  // Smart 15-second differential background synchronization (lightweight version probe first, fetches data silently only when changed)
  const runSmartBackgroundSync = useCallback(
    async (forceFull = false, bypassWakeupGuard = false) => {
      if (!mountedRef.current || (wakeupActiveRef.current && !bypassWakeupGuard)) return;
      if (bgSyncInFlightRef.current) return;

      if (isBrowserOffline()) {
        setConnectionStatus('offline');
        return;
      }

      if (
        !forceFull &&
        Date.now() - lastSyncCompletedMsRef.current < SYNC_FOCUS_COOLDOWN_MS
      ) {
        return;
      }

      bgSyncInFlightRef.current = true;
      if (forceFull) {
        setConnectionStatus('syncing');
      }

      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, SYNC_REQUEST_TIMEOUT_MS);

      try {
        if (!forceFull && lastMasterVersionRef.current) {
          const verRes = await fetch(apiUrl('/api/public/sync-version'), {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!verRes.ok) {
            throw new HttpStatusError(
              verRes.status,
              `Unable to check Master Plan sync version (${verRes.status})`
            );
          }
          const verJson = (await verRes.json()) as {
            ok?: boolean;
            version?: string;
          };
          const serverVersion = verJson?.version || null;
          const masterNeedsUpdate =
            !serverVersion || serverVersion !== lastMasterVersionRef.current;
          const foNeedsUpdate =
            !lastFoVersionRef.current ||
            !serverVersion ||
            serverVersion !== lastFoVersionRef.current;

          if (!masterNeedsUpdate && !foNeedsUpdate) {
            lastSyncCompletedMsRef.current = Date.now();
            setLastSyncedAt(formatCurrentTimeLabel());
            setConnectionStatus('connected');
            stopReconnectBackoff();
            return;
          }

          setConnectionStatus('syncing');
          const tasks: Promise<boolean>[] = [];
          if (masterNeedsUpdate) {
            tasks.push(fetchFactoryMasterPlan(selectedFactoryRef.current, 'silent'));
          }
          if (foNeedsUpdate) {
            tasks.push(fetchPublicFoNeeded(true));
          }
          await Promise.all(tasks);
          return;
        }

        await Promise.all([
          fetchFactoryMasterPlan(
            selectedFactoryRef.current,
            bypassWakeupGuard ? 'silent' : 'refresh'
          ),
          fetchPublicFoNeeded(true),
        ]);
      } catch (err) {
        if (controller.signal.aborted && !timedOut) return;
        if (!mountedRef.current) return;
        if (isColdStartOrNetworkFailure(err)) {
          if (recordsCountRef.current === 0) {
            setWakeupActive(true);
          } else {
            scheduleReconnectProbe();
          }
          setConnectionStatus(isBrowserOffline() ? 'offline' : 'reconnecting');
        }
      } finally {
        window.clearTimeout(timeoutId);
        bgSyncInFlightRef.current = false;
      }
    },
    [fetchFactoryMasterPlan, fetchPublicFoNeeded, scheduleReconnectProbe, stopReconnectBackoff]
  );

  // Initial load + 15s smart background sync + online/offline & visibility listeners (ZERO full-page reloads)
  useEffect(() => {
    mountedRef.current = true;
    const initialFromUrl = readInitialFactoryFromUrl();

    void (async () => {
      const ok = await fetchFactoryMasterPlan(initialFromUrl, 'initial');
      await fetchPublicFoNeeded(false);
      if (!ok && recordsCountRef.current > 0 && mountedRef.current) {
        scheduleReconnectProbe();
      }
    })();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !wakeupActiveRef.current) {
        void runSmartBackgroundSync(false);
      }
    }, BACKGROUND_SYNC_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && !wakeupActiveRef.current) {
        void runSmartBackgroundSync(false);
      }
    };

    const handleOnline = () => {
      stopReconnectBackoff();
      if (!wakeupActiveRef.current) {
        void runSmartBackgroundSync(true);
      }
    };

    const handleOffline = () => {
      stopReconnectBackoff();
      setConnectionStatus('offline');
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      stopReconnectBackoff();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (foAbortControllerRef.current) {
        foAbortControllerRef.current.abort();
      }
    };
  }, [
    fetchFactoryMasterPlan,
    fetchPublicFoNeeded,
    runSmartBackgroundSync,
    scheduleReconnectProbe,
    stopReconnectBackoff,
  ]);

  const handleSelectFactory = (factory: FactoryName) => {
    if (factory === selectedFactory && !error && !wakeupActive) return;
    setSelectedFactory(factory);
    selectedFactoryRef.current = factory;
    setSelectedLine('ALL');
    syncFactoryQueryParam(factory);
    void fetchFactoryMasterPlan(factory, 'switch');
  };

  const handleTabChange = (nextTab: PublicMasterPlanTab) => {
    setActiveTab(nextTab);
    if (nextTab === 'fo_needed' && !wakeupActive && !foNeededData) {
      void fetchPublicFoNeeded(false);
    }
  };

  const handleWakeupRecovered = useCallback(() => {
    // Keep the wake-up animation visible until live data finishes loading (setWakeupActive(false) runs on fetch success)
    setError(null);
    setFoNeededError(null);
    stopReconnectBackoff();
    void runSmartBackgroundSync(true, true);
  }, [runSmartBackgroundSync, stopReconnectBackoff]);

  // Defense-in-depth: strictly enforce single-factory record isolation in UI state
  const factoryRecords = useMemo(() => {
    if (!selectedFactory) return [];
    return records.filter((r) => r.factory === selectedFactory);
  }, [records, selectedFactory]);

  const availableLines = useMemo(() => {
    const lineSet = new Set<string>();
    for (const r of factoryRecords) {
      lineSet.add(r.line);
    }
    return Array.from(lineSet);
  }, [factoryRecords]);

  const dateRangeActive = Boolean(dateRangeFilter.fromIso || dateRangeFilter.toIso);
  const hasAnyFilter =
    selectedLine !== 'ALL' ||
    statusFilter !== 'ALL' ||
    searchQuery.trim().length > 0 ||
    dateRangeActive;

  const filteredRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return factoryRecords.filter((r) => {
      if (selectedLine !== 'ALL' && r.line !== selectedLine) return false;

      if (statusFilter === 'Running' && r.lifecycleStage !== 'Running') return false;
      if (statusFilter === 'Upcoming (Next)' && r.lifecycleStage !== 'Upcoming (Next)') {
        return false;
      }
      if (statusFilter === 'Queued' && r.lifecycleStage !== 'Queued') return false;
      if (statusFilter === 'OPEN_ONLY' && r.orderStatus === 'Order Closed') return false;
      if (statusFilter === 'Order Closed' && r.orderStatus !== 'Order Closed') return false;

      if (!isRecordInDateRange(r, dateRangeFilter)) return false;

      if (q) {
        const hay =
          `${r.line} ${r.zone} ${r.pgNumber} ${r.style} ${r.nextStyle} ${r.productCategory}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [factoryRecords, selectedLine, statusFilter, searchQuery, dateRangeFilter]);

  const handleResetAllFilters = () => {
    setSelectedLine('ALL');
    setStatusFilter('ALL');
    setSearchQuery('');
    setDateRangeFilter((prev) => ({ ...prev, fromIso: '', toIso: '' }));
  };

  return (
    <div className="app-shell-height flex flex-col robotics-workspace-bg text-slate-900">
      {splashPhase !== 'done' && (
        <MasterPlanSplashScreen fading={splashPhase === 'fading'} />
      )}

      {/* Isolated Public Master Plan Header — ZERO Control Tower menus or Admin controls */}
      <header className="sticky top-0 z-40 ct-header-glass ct-safe-header">
        <div className="h-16 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {!logoError ? (
              <img
                src={`${import.meta.env.BASE_URL}assets/aistudio/OIP__1__63903905.webp`}
                alt={companyName}
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="h-7 sm:h-8 w-auto object-contain shrink-0"
              />
            ) : (
              <span className="font-display text-sm font-bold tracking-tight text-slate-950 whitespace-nowrap shrink-0">
                {companyName.toUpperCase()}
              </span>
            )}
            <span
              className="hidden sm:inline-block h-5 w-px bg-cyan-900/15 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h1 className="font-display font-semibold text-sm sm:text-base text-slate-950 truncate">
                Alpine Master Plan
              </h1>
              <p className="hidden md:block text-[11px] text-slate-500 font-mono truncate">
                Read-Only Factory Dashboard
                {selectedFactory ? ` · ${selectedFactory}` : ''}
                {meta?.asOfDateRaw ? ` · As Of ${meta.asOfDateRaw}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <ConnectionStatusBadge
              status={connectionStatus}
              lastSyncedAt={lastSyncedAt}
              retryInSeconds={retryInSeconds}
            />

            <MasterPlanInstallButton />

            <button
              type="button"
              onClick={() => void runSmartBackgroundSync(true)}
              disabled={refreshing || switchingFactory}
              title="Sync live Master Plan data now"
              className="h-9 px-3.5 rounded-lg bg-gradient-to-r from-[#0a1633] via-cyan-800 to-teal-700 hover:from-[#0f224d] hover:to-teal-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-[0_6px_16px_-6px_rgba(13,148,136,0.45)] transition-all cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${refreshing || switchingFactory ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* When running inside installed standalone Master Plan app, keep navigation strictly isolated */}
            {!isInstalled && (
              <a
                href={buildRouteHref('landing')}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  onBackToPortal();
                }}
                className="h-9 px-3 rounded-lg border border-slate-300/85 bg-white/90 hover:bg-white hover:border-cyan-500/60 text-slate-700 hover:text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Entry Portal</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Two Clear Medium Tabs Directly Below Header: MASTER PLAN | FO NEEDED */}
      <PublicMasterPlanTabs
        activeTab={activeTab}
        onChangeTab={handleTabChange}
        foNeededCount={foNeededData?.rows.length ?? null}
      />

      {/* Main Content Area */}
      <main className="flex-1 ct-safe-x py-5 sm:py-6 space-y-6 max-w-[1600px] w-full mx-auto robotics-enter">
        {wakeupActive ? (
          <BackendWakeupPanel
            onReconnected={handleWakeupRecovered}
            onManualRetry={() => void runSmartBackgroundSync(true, true)}
            isRetrying={refreshing || loading}
          />
        ) : activeTab === 'fo_needed' ? (
          <PublicFoNeededView
            data={foNeededData}
            loading={foNeededLoading}
            error={foNeededError}
            selectedFactory={selectedFactory}
            onRetry={() => void fetchPublicFoNeeded(false)}
          />
        ) : error ? (
          <div className="ct-surface border-red-200 rounded-2xl p-6 space-y-3">
            <div className="text-sm font-semibold text-red-800">
              Unable to load live Master Plan
            </div>
            <p className="text-xs text-slate-600">{error}</p>
            <button
              type="button"
              onClick={() => void fetchFactoryMasterPlan(selectedFactory, 'initial')}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#0a1633] to-teal-700 text-white text-xs font-semibold cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="h-[108px] ct-surface rounded-2xl animate-pulse" />
              <div className="h-[108px] ct-surface rounded-2xl animate-pulse" />
              <div className="h-[108px] ct-surface rounded-2xl animate-pulse" />
              <div className="h-[108px] ct-surface rounded-2xl animate-pulse" />
            </div>
            <div className="h-20 ct-surface rounded-2xl animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="h-28 ct-surface rounded-xl animate-pulse" />
              <div className="h-28 ct-surface rounded-xl animate-pulse" />
              <div className="h-28 ct-surface rounded-xl animate-pulse" />
              <div className="h-28 ct-surface rounded-xl animate-pulse" />
            </div>
            <div className="h-96 ct-surface rounded-2xl animate-pulse" />
          </div>
        ) : (
          <div
            id="panel-master-plan"
            role="tabpanel"
            aria-labelledby="tab-master-plan"
            className="space-y-6"
          >
            {/* 1. Four Factory Interactive Selection Bar */}
            <PublicFactorySelectorBar
              factories={factories}
              selectedFactory={selectedFactory}
              isSwitching={switchingFactory}
              onSelectFactory={handleSelectFactory}
            />

            {/* 2. Selected Factory Summary + Filter Bar + Planning Details */}
            {selectedFactory && (
              <div className="space-y-6">
                <PublicFactorySummarySection
                  selectedFactory={selectedFactory}
                  meta={meta}
                  referenceDateIso={referenceDateIso}
                  factoryRecords={factoryRecords}
                  filteredRecords={filteredRecords}
                  cuttingSheetSummary={cuttingSheetSummary}
                  isFiltered={hasAnyFilter}
                  isSwitching={switchingFactory}
                />

                <PublicFactoryFilterBar
                  selectedFactory={selectedFactory}
                  selectedLine={selectedLine}
                  onLineChange={setSelectedLine}
                  availableLines={availableLines}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  dateRangeFilter={dateRangeFilter}
                  onApplyDateRange={setDateRangeFilter}
                  onClearDateRange={() =>
                    setDateRangeFilter((prev) => ({ ...prev, fromIso: '', toIso: '' }))
                  }
                  onResetAllFilters={handleResetAllFilters}
                  matchedCount={filteredRecords.length}
                  totalFactoryCount={factoryRecords.length}
                />

                <PublicFactoryPlanTable
                  selectedFactory={selectedFactory}
                  records={filteredRecords}
                  isSwitching={switchingFactory}
                  hasActiveFilters={hasAnyFilter}
                  dateRangeActive={dateRangeActive}
                  onResetFilters={handleResetAllFilters}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Global Website Footer with Exact Creator Credit */}
      <SiteFooter
        leftContent={
          <span>
            {companyName} — Master Plan Read-Only View
            {selectedFactory ? ` · ${selectedFactory}` : ''} · Ref Date:{' '}
            <span className="font-mono tabular-nums text-slate-700">
              {formatDisplayDate(referenceDateIso)}
            </span>{' '}
            · Smart Live Sync (15s)
          </span>
        }
      />
    </div>
  );
}
