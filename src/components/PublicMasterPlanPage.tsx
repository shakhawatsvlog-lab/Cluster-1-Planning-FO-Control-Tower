import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type {
  FactoryName,
  MasterPlanMeta,
  PublicMasterPlanRecord,
  PublicMasterPlanResponse,
} from '../shared/plannerTypes.ts';
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
import { SiteFooter } from './SiteFooter.tsx';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { apiUrl } from '../lib/apiBase.ts';
import { buildRouteHref } from '../lib/routes.ts';

const LIVE_POLL_INTERVAL_MS = 15_000;
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

  const [meta, setMeta] = useState<MasterPlanMeta | null>(null);
  const [factories, setFactories] = useState<FactoryName[]>([]);
  const [selectedFactory, setSelectedFactory] = useState<FactoryName | null>(null);
  const [records, setRecords] = useState<PublicMasterPlanRecord[]>([]);
  const [referenceDateIso, setReferenceDateIso] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [companyName, setCompanyName] = useState('Alex Apparels');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingFactory, setSwitchingFactory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  // Branded in-app splash screen lifecycle (shown once per launch / direct URL load / refresh)
  const [splashPhase, setSplashPhase] = useState<'showing' | 'fading' | 'done'>('showing');
  const [initialDataSettled, setInitialDataSettled] = useState(false);
  const [minRevealDone, setMinRevealDone] = useState(false);

  // Selected factory filters
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
  const selectedFactoryRef = useRef<FactoryName | null>(null);

  useEffect(() => {
    selectedFactoryRef.current = selectedFactory;
  }, [selectedFactory]);

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

  const fetchFactoryMasterPlan = useCallback(
    async (
      targetFactory: string | null,
      mode: 'initial' | 'switch' | 'refresh'
    ) => {
      const seq = ++requestSeqRef.current;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (mode === 'initial') {
        setLoading(true);
      } else if (mode === 'switch') {
        setSwitchingFactory(true);
      } else {
        setRefreshing(true);
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
          throw new Error(`Unable to fetch Master Plan (${res.status})`);
        }

        const data = (await res.json()) as PublicMasterPlanResponse;
        if (seq !== requestSeqRef.current) return;

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
        if (data.referenceDateIso) setReferenceDateIso(data.referenceDateIso);
        if (data.branding?.companyName) setCompanyName(data.branding.companyName);
        setLastSyncedAt(
          new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        );
        setError(null);
      } catch (err) {
        if (controller.signal.aborted || seq !== requestSeqRef.current) return;
        setError(err instanceof Error ? err.message : 'Unable to load live Master Plan.');
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
          setSwitchingFactory(false);
          setRefreshing(false);
          if (mode === 'initial') {
            setInitialDataSettled(true);
          }
        }
      }
    },
    []
  );

  // Initial load + 15s live polling scoped to currently selected factory
  useEffect(() => {
    const initialFromUrl = readInitialFactoryFromUrl();
    void fetchFactoryMasterPlan(initialFromUrl, 'initial');

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchFactoryMasterPlan(selectedFactoryRef.current, 'refresh');
      }
    }, LIVE_POLL_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void fetchFactoryMasterPlan(selectedFactoryRef.current, 'refresh');
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchFactoryMasterPlan]);

  const handleSelectFactory = (factory: FactoryName) => {
    if (factory === selectedFactory && !error) return;
    setSelectedFactory(factory);
    selectedFactoryRef.current = factory;
    setSelectedLine('ALL');
    syncFactoryQueryParam(factory);
    void fetchFactoryMasterPlan(factory, 'switch');
  };

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

        <div className="flex items-center gap-2 shrink-0">
          {lastSyncedAt && (
            <span className="hidden xl:inline text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
              Synced {lastSyncedAt}
            </span>
          )}

          <MasterPlanInstallButton />

          <button
            type="button"
            onClick={() => void fetchFactoryMasterPlan(selectedFactory, 'refresh')}
            disabled={refreshing || switchingFactory}
            title="Refresh live Master Plan data"
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

      {/* Main Four-Factory Interactive Dashboard */}
      <main className="flex-1 ct-safe-x py-5 sm:py-6 space-y-6 max-w-[1600px] w-full mx-auto robotics-enter">
        {error ? (
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
          <>
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
          </>
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
            · Live auto-refresh (15s)
          </span>
        }
      />
    </div>
  );
}
