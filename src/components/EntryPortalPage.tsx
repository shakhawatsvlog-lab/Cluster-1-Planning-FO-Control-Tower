import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarRange,
  Check,
  FileSearch,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { buildRouteHref } from '../lib/routes.ts';
import type { AppPortalRoute } from '../lib/routes.ts';
import { SiteFooter } from './SiteFooter.tsx';

type PortalDoorRoute = Exclude<AppPortalRoute, 'landing'>;

interface EntryPortalPageProps {
  companyName?: string;
  onNavigate: (route: AppPortalRoute) => void;
}

interface RippleState {
  route: PortalDoorRoute;
  x: number;
  y: number;
  key: number;
}

export function EntryPortalPage({
  companyName = 'Alex Apparels',
  onNavigate,
}: EntryPortalPageProps) {
  const [logoError, setLogoError] = useState(false);
  const [activatingRoute, setActivatingRoute] = useState<PortalDoorRoute | null>(null);
  const [ripple, setRipple] = useState<RippleState | null>(null);
  const navTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navTimerRef.current !== null) {
        window.clearTimeout(navTimerRef.current);
      }
    };
  }, []);

  const triggerPortalActivation = (
    route: PortalDoorRoute,
    clientX?: number,
    clientY?: number,
    targetEl?: HTMLElement | null
  ) => {
    if (activatingRoute !== null) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setActivatingRoute(route);
      onNavigate(route);
      return;
    }

    let x = 180;
    let y = 180;
    if (targetEl && typeof clientX === 'number' && typeof clientY === 'number') {
      const rect = targetEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        x = clientX - rect.left;
        y = clientY - rect.top;
      }
    }

    setRipple({ route, x, y, key: Date.now() });
    setActivatingRoute(route);

    navTimerRef.current = window.setTimeout(() => {
      onNavigate(route);
    }, 340);
  };

  const handleEntryClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    route: PortalDoorRoute
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    e.preventDefault();
    const cardContainer = e.currentTarget.closest('section');
    triggerPortalActivation(route, e.clientX, e.clientY, cardContainer);
  };

  return (
    <div className="relative app-shell-height flex flex-col robotics-workspace-bg text-slate-900 overflow-x-clip">
      {/* Subtle Futuristic Technology Background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        {/* Fine architectural digital grid */}
        <div className="absolute inset-0 robotics-portal-grid" />

        {/* Slow-moving ambient cyan & teal gradient lighting */}
        <div
          className="robotics-orb-primary absolute -top-28 -left-24 w-[460px] h-[460px] rounded-full opacity-50 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(6, 182, 212, 0.22) 0%, rgba(14, 116, 144, 0.06) 55%, transparent 75%)',
          }}
        />
        <div
          className="robotics-orb-secondary absolute -bottom-32 -right-24 w-[500px] h-[500px] rounded-full opacity-45 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(13, 148, 136, 0.2) 0%, rgba(15, 23, 42, 0.05) 55%, transparent 75%)',
          }}
        />

        {/* Minimal connected digital nodes & subtle particles */}
        <svg
          className="absolute inset-0 w-full h-full opacity-45"
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          fill="none"
        >
          <g stroke="rgba(8, 145, 178, 0.16)" strokeWidth="1">
            <line x1="160" y1="180" x2="340" y2="250" />
            <line x1="340" y1="250" x2="290" y2="430" />
            <line x1="1120" y1="210" x2="1280" y2="330" />
            <line x1="1280" y1="330" x2="1160" y2="510" />
            <line x1="210" y1="700" x2="410" y2="760" />
            <line x1="1040" y1="740" x2="1260" y2="690" />
          </g>
          <g fill="rgba(8, 145, 178, 0.35)">
            <circle className="robotics-node-float" cx="160" cy="180" r="3" />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '1.1s' }}
              cx="340"
              cy="250"
              r="2.5"
            />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '2.2s' }}
              cx="290"
              cy="430"
              r="3"
            />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '0.7s' }}
              cx="1120"
              cy="210"
              r="3"
            />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '1.9s' }}
              cx="1280"
              cy="330"
              r="2.5"
            />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '3s' }}
              cx="1160"
              cy="510"
              r="3"
            />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '1.5s' }}
              cx="210"
              cy="700"
              r="2.5"
            />
            <circle
              className="robotics-node-float"
              style={{ animationDelay: '2.6s' }}
              cx="1260"
              cy="690"
              r="3"
            />
          </g>
        </svg>

        {/* Ultra-subtle precision horizontal scanning line */}
        <div
          className="robotics-scan-beam absolute inset-x-0 h-[1.5px]"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(6, 182, 212, 0.24) 35%, rgba(20, 184, 166, 0.3) 50%, rgba(6, 182, 212, 0.24) 65%, transparent 100%)',
          }}
        />
      </div>

      {/* Frosted Glass Corporate Header */}
      <header className="relative z-20 ct-header-glass ct-safe-header">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {!logoError ? (
              <img
                src={`${import.meta.env.BASE_URL}assets/aistudio/OIP__1__63903905.webp`}
                alt={companyName}
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="h-8 w-auto object-contain shrink-0"
              />
            ) : (
              <span className="font-display text-base font-bold tracking-tight text-slate-950 whitespace-nowrap shrink-0">
                {companyName.toUpperCase()}
              </span>
            )}
            <span
              className="hidden sm:inline-block h-5 w-px bg-cyan-900/15 shrink-0"
              aria-hidden="true"
            />
            <span className="hidden sm:inline text-xs font-medium text-slate-600 truncate">
              Alpine Egypt · Cluster 1 Operations
            </span>
          </div>

          <div className="font-mono text-[11px] font-medium text-cyan-900/80 tracking-wide whitespace-nowrap">
            ALEX 1 · ALEX 3 · ALEX 5 · ALEX 12
          </div>
        </div>
      </header>

      {/* Main Entry Canvas */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="max-w-6xl w-full mx-auto space-y-8 sm:space-y-10">
          {/* Corporate Title Block */}
          <div className="max-w-2xl space-y-3 robotics-enter">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block w-6 h-[2px] bg-gradient-to-r from-cyan-600 to-teal-500"
                aria-hidden="true"
              />
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">
                Alpine Egypt Planning Portal
              </p>
            </div>
            <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-slate-950 leading-tight [text-wrap:balance]">
              Planning &amp; FO Control Tower
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Select your workspace entry point below. Planning administrators authenticate through the Control Tower, while factory teams access the live Master Plan or SheetLens directly.
            </p>
          </div>

          {/* Three Futuristic Glassmorphic Entry Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            {/* Option 1: CONTROL TOWER */}
            <div className="robotics-enter-delay-1 flex">
              <section
                aria-labelledby="entry-control-tower-title"
                className={`group robotics-portal-card robotics-float-a w-full rounded-2xl p-6 sm:p-7 flex flex-col justify-between gap-6 ${
                  activatingRoute === 'control_tower'
                    ? 'ring-2 ring-cyan-500/70 border-cyan-500'
                    : activatingRoute !== null
                      ? 'opacity-70'
                      : ''
                }`}
              >
                {/* Animated top glowing accent hairline */}
                <div
                  className="robotics-border-pulse absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-blue-700"
                  aria-hidden="true"
                />

                {/* Hover gradient wash */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background:
                      'radial-gradient(420px circle at 10% 0%, rgba(6, 182, 212, 0.085), transparent 65%)',
                  }}
                  aria-hidden="true"
                />

                {/* Diagonal light reflection sweep */}
                <div className="robotics-light-sweep" aria-hidden="true" />

                {/* Click coordinate ripple + light activation scan */}
                {ripple && ripple.route === 'control_tower' && (
                  <>
                    <span
                      key={ripple.key}
                      className="robotics-ripple-circle bg-cyan-400/30"
                      style={{ left: ripple.x, top: ripple.y }}
                      aria-hidden="true"
                    />
                    <span
                      className="robotics-activation-scan"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.24), transparent)',
                      }}
                      aria-hidden="true"
                    />
                  </>
                )}

                <div className="relative z-10 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-[#0a1633] via-[#12295a] to-[#0891b2] text-white flex items-center justify-center shrink-0 shadow-[0_8px_20px_-6px_rgba(8,145,178,0.45)] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-2">
                      <ShieldCheck className="w-5 h-5 text-cyan-200 transition-transform duration-300 group-hover:scale-110" />
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                        <Lock className="w-3 h-3 text-cyan-700" />
                        <span>Admin Login Required</span>
                      </div>
                      <span
                        className="h-[2px] w-16 origin-right scale-x-50 bg-gradient-to-r from-transparent to-cyan-500 opacity-30 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div>
                    <h2
                      id="entry-control-tower-title"
                      className="font-display text-xl font-bold tracking-tight text-slate-950"
                    >
                      CONTROL TOWER
                    </h2>
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                      Full operational command center for planning administrators. Manage schedules, FO tracking, daily cutting logs, email alerts, and system settings.
                    </p>
                  </div>

                  <ul className="space-y-2 pt-3 border-t border-slate-200/70 text-xs text-slate-700">
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                      <span>KPI Dashboard, FO Checklist &amp; Action Lists</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                      <span>Master Plan Editing, Excel Import &amp; Export</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                      <span>Cutting Sync, Automated Reminders &amp; Controls</span>
                    </li>
                  </ul>
                </div>

                <a
                  href={buildRouteHref('control_tower')}
                  onClick={(e) => handleEntryClick(e, 'control_tower')}
                  aria-disabled={activatingRoute !== null}
                  className={`relative z-10 w-full h-11 px-4 rounded-xl bg-gradient-to-r from-[#0a1633] via-[#102652] to-[#0891b2] hover:from-[#0f214a] hover:to-[#06b6d4] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_10px_24px_-10px_rgba(8,145,178,0.55)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-600 focus:ring-offset-2 ${
                    activatingRoute !== null ? 'pointer-events-none opacity-85' : ''
                  }`}
                >
                  {activatingRoute === 'control_tower' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-200" />
                      <span>Opening Control Tower...</span>
                    </>
                  ) : (
                    <>
                      <span>Enter Control Tower</span>
                      <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </>
                  )}
                </a>
              </section>
            </div>

            {/* Option 2: MASTER PLAN */}
            <div className="robotics-enter-delay-2 flex">
              <section
                aria-labelledby="entry-master-plan-title"
                className={`group robotics-portal-card robotics-portal-card-teal robotics-float-b w-full rounded-2xl p-6 sm:p-7 flex flex-col justify-between gap-6 ${
                  activatingRoute === 'master_plan'
                    ? 'ring-2 ring-teal-500/70 border-teal-500'
                    : activatingRoute !== null
                      ? 'opacity-70'
                      : ''
                }`}
              >
                {/* Animated top glowing accent hairline */}
                <div
                  className="robotics-border-pulse absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-teal-700 via-cyan-500 to-teal-500"
                  aria-hidden="true"
                />

                {/* Hover gradient wash */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background:
                      'radial-gradient(420px circle at 90% 0%, rgba(20, 184, 166, 0.1), transparent 65%)',
                  }}
                  aria-hidden="true"
                />

                {/* Diagonal light reflection sweep */}
                <div className="robotics-light-sweep" aria-hidden="true" />

                {/* Click coordinate ripple + light activation scan */}
                {ripple && ripple.route === 'master_plan' && (
                  <>
                    <span
                      key={ripple.key}
                      className="robotics-ripple-circle bg-teal-400/30"
                      style={{ left: ripple.x, top: ripple.y }}
                      aria-hidden="true"
                    />
                    <span
                      className="robotics-activation-scan"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent, rgba(20, 184, 166, 0.24), transparent)',
                      }}
                      aria-hidden="true"
                    />
                  </>
                )}

                <div className="relative z-10 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-teal-700 via-teal-600 to-cyan-600 text-white flex items-center justify-center shrink-0 shadow-[0_8px_20px_-6px_rgba(13,148,136,0.45)] transition-transform duration-300 group-hover:scale-105 group-hover:rotate-2">
                      <CalendarRange className="w-5 h-5 text-cyan-100 transition-transform duration-300 group-hover:scale-110" />
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <div className="text-[11px] font-medium text-teal-800">
                        Direct Factory Access · Read-Only
                      </div>
                      <span
                        className="h-[2px] w-16 origin-right scale-x-50 bg-gradient-to-r from-transparent to-teal-500 opacity-30 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div>
                    <h2
                      id="entry-master-plan-title"
                      className="font-display text-xl font-bold tracking-tight text-slate-950"
                    >
                      MASTER PLAN
                    </h2>
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                      Open live line-wise production schedules directly with no password required. View running styles, queued slots, quantities, and planning dates.
                    </p>
                  </div>

                  <ul className="space-y-2 pt-3 border-t border-slate-200/70 text-xs text-slate-700">
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      <span>Live Line-Wise Grouped &amp; Flat Master Schedule</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      <span>Filter by Factory, Production Line &amp; Date Range</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      <span>Automatically Syncs Live Changes from Control Tower</span>
                    </li>
                  </ul>
                </div>

                <a
                  href={buildRouteHref('master_plan')}
                  onClick={(e) => handleEntryClick(e, 'master_plan')}
                  aria-disabled={activatingRoute !== null}
                  className={`relative z-10 w-full h-11 px-4 rounded-xl bg-gradient-to-r from-teal-700 via-teal-600 to-cyan-600 hover:from-teal-800 hover:to-cyan-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_10px_24px_-10px_rgba(13,148,136,0.55)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-700 focus:ring-offset-2 ${
                    activatingRoute !== null ? 'pointer-events-none opacity-85' : ''
                  }`}
                >
                  {activatingRoute === 'master_plan' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-teal-100" />
                      <span>Opening Master Plan...</span>
                    </>
                  ) : (
                    <>
                      <span>Open Master Plan</span>
                      <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </>
                  )}
                </a>
              </section>
            </div>

            {/* Option 3: PO & PG# MATCHER */}
            <div className="robotics-enter-delay-3 flex md:col-span-2 lg:col-span-1">
              <section
                aria-labelledby="entry-po-matcher-title"
                className={`group robotics-portal-card robotics-portal-card-emerald robotics-float-c w-full rounded-2xl p-6 sm:p-7 flex flex-col justify-between gap-6 ${
                  activatingRoute === 'po_matcher'
                    ? 'ring-2 ring-emerald-500/70 border-emerald-500'
                    : activatingRoute !== null
                      ? 'opacity-70'
                      : ''
                }`}
              >
                {/* Animated top glowing accent hairline */}
                <div
                  className="robotics-border-pulse absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-emerald-700 via-teal-500 to-emerald-500"
                  aria-hidden="true"
                />

                {/* Hover gradient wash */}
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background:
                      'radial-gradient(420px circle at 90% 0%, rgba(16, 185, 129, 0.1), transparent 65%)',
                  }}
                  aria-hidden="true"
                />

                {/* Diagonal light reflection sweep */}
                <div className="robotics-light-sweep" aria-hidden="true" />

                {/* Click coordinate ripple + light activation scan */}
                {ripple && ripple.route === 'po_matcher' && (
                  <>
                    <span
                      key={ripple.key}
                      className="robotics-ripple-circle bg-emerald-400/30"
                      style={{ left: ripple.x, top: ripple.y }}
                      aria-hidden="true"
                    />
                    <span
                      className="robotics-activation-scan"
                      style={{
                        background:
                          'linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.24), transparent)',
                      }}
                      aria-hidden="true"
                    />
                  </>
                )}

                <div className="relative z-10 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-[0_8px_20px_-6px_rgba(5,150,105,0.45)] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-2">
                      <FileSearch className="w-5 h-5 text-emerald-100 transition-transform duration-300 group-hover:scale-110" />
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <div className="text-[11px] font-medium text-emerald-800">
                        Direct Access · PG# &amp; PO Lookup
                      </div>
                      <span
                        className="h-[2px] w-16 origin-right scale-x-50 bg-gradient-to-r from-transparent to-emerald-500 opacity-30 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div>
                    <h2
                      id="entry-po-matcher-title"
                      className="font-display text-xl font-bold tracking-tight text-slate-950"
                    >
                      SheetLens
                    </h2>
                    <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                      Upload 5–15 factory Excel sheets and match against a source JPG photo or Excel list to verify which factory is running each PO, Qty, and Final insp. date.
                    </p>
                  </div>

                  <ul className="space-y-2 pt-3 border-t border-slate-200/70 text-xs text-slate-700">
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Multi-Workbook Excel Parser (PG# Tabs, PO, Color, Qty &amp; Final insp.)</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>AI Vision OCR for Source JPG Photos &amp; Source Excel Lookup</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Multi-Factory Split Detection &amp; One-Click Excel Result Export</span>
                    </li>
                  </ul>
                </div>

                <a
                  href={buildRouteHref('po_matcher')}
                  onClick={(e) => handleEntryClick(e, 'po_matcher')}
                  aria-disabled={activatingRoute !== null}
                  className={`relative z-10 w-full h-11 px-4 rounded-xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 hover:from-emerald-800 hover:to-teal-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_10px_24px_-10px_rgba(5,150,105,0.55)] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
                    activatingRoute !== null ? 'pointer-events-none opacity-85' : ''
                  }`}
                >
                  {activatingRoute === 'po_matcher' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-100" />
                      <span>Opening SheetLens...</span>
                    </>
                  ) : (
                    <>
                      <span>Open SheetLens</span>
                      <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                    </>
                  )}
                </a>
              </section>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter
        maxWidthClass="max-w-6xl"
        leftContent={
          <span>
            {companyName} — Alpine Egypt Cluster 1 Planning Portal ·{' '}
            <span className="font-mono">ALEX 1 · ALEX 3 · ALEX 5 · ALEX 12</span>
          </span>
        }
      />
    </div>
  );
}
