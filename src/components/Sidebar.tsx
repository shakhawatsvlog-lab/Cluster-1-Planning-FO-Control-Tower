import { useEffect } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Database,
  LayoutDashboard,
  Lock,
  Mail,
  PackageOpen,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type { FactoryName } from '../shared/plannerTypes.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

export type NavTab =
  | 'dashboard'
  | 'cutting_entry'
  | 'fo_checklist'
  | 'database'
  | 'tracker'
  | 'fo_required'
  | 'action_required'
  | 'reminders'
  | 'control_panel';

interface FactorySummaryItem {
  factory: FactoryName;
  lines: number;
  capacityMc: number;
}

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  selectedFactory: FactoryName | 'ALL';
  onSelectFactory: (factory: FactoryName | 'ALL') => void;
  factorySummaries: FactorySummaryItem[];
  counts: {
    database: number;
    cuttingEntries: number;
    foChecklistPending: number;
    foRequired: number;
    actionRequired: number;
    planQtyPending: number;
    cuttingAlert10d: number;
    activeRecipients: number;
  };
  adminUnlocked?: boolean;
  asOfDateRaw: string;
  inputStartOffsetDays?: number;
  upcomingFoOffsetDays?: number;
  cuttingAlertDays?: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenShehreen?: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  selectedFactory,
  onSelectFactory,
  factorySummaries,
  counts,
  adminUnlocked = false,
  asOfDateRaw,
  inputStartOffsetDays = 10,
  upcomingFoOffsetDays = 15,
  cuttingAlertDays = 10,
  mobileOpen,
  onCloseMobile,
  onOpenShehreen,
}: SidebarProps) {
  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof LayoutDashboard;
    badgeCount?: number;
    badgeTone?: 'neutral' | 'amber' | 'red' | 'teal' | 'blue';
  }> = [
    { id: 'dashboard', label: 'KPI Dashboard', icon: LayoutDashboard },
    {
      id: 'cutting_entry',
      label: 'Daily Cutting Entry',
      icon: ClipboardCheck,
      badgeCount: counts.cuttingEntries,
      badgeTone: 'teal',
    },
    {
      id: 'fo_checklist',
      label: 'FO Weekly Checklist',
      icon: CheckSquare,
      badgeCount: counts.foChecklistPending,
      badgeTone: 'amber',
    },
    {
      id: 'database',
      label: 'Master Plan (Line-Wise)',
      icon: Database,
      badgeCount: counts.database,
      badgeTone: 'neutral',
    },
    { id: 'tracker', label: 'Fabric Order Tracker', icon: ClipboardList },
    {
      id: 'fo_required',
      label: 'FO Required List',
      icon: PackageOpen,
      badgeCount: counts.foRequired,
      badgeTone: 'amber',
    },
    {
      id: 'action_required',
      label: 'Action Required List',
      icon: AlertTriangle,
      badgeCount: counts.actionRequired,
      badgeTone: 'red',
    },
    {
      id: 'reminders',
      label: 'Email Reminders',
      icon: Mail,
      badgeCount: counts.activeRecipients,
      badgeTone: 'blue',
    },
    {
      id: 'control_panel',
      label: 'Control Panel',
      icon: adminUnlocked ? ShieldCheck : Lock,
    },
  ];

  const totalLines = factorySummaries.reduce((sum, f) => sum + f.lines, 0);
  const totalMc = factorySummaries.reduce((sum, f) => sum + f.capacityMc, 0);

  useEffect(() => {
    if (!mobileOpen) return;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen, onCloseMobile]);

  const sidebarBody = (
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-[#071127] via-[#0b1936] to-[#08132b] text-slate-100 border-r border-cyan-500/20">
      <div className="ct-safe-sidebar-header flex items-center justify-between gap-2 border-b border-cyan-500/15 bg-slate-950/30 shrink-0">
        <div className="min-w-0">
          <div className="font-display text-sm font-bold tracking-tight text-white truncate">
            Cluster 1 Planning
          </div>
          <div className="text-xs text-cyan-200/75 mt-0.5 truncate">
            Master Plan · {asOfDateRaw}
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden h-11 w-11 -mr-1 inline-flex items-center justify-center rounded-lg text-slate-300 hover:bg-cyan-500/15 hover:text-white active:bg-cyan-500/25 cursor-pointer transition-colors touch-manipulation shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] px-3 py-4 space-y-1"
        aria-label="Workspace sections"
      >
        <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300/65">
          Planning Modules
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-[0_6px_18px_-6px_rgba(6,182,212,0.55)] ring-1 ring-cyan-300/30'
                  : 'text-slate-300 hover:bg-cyan-500/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-white' : 'text-cyan-300/70'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badgeCount !== undefined && (
                <span
                  className={`font-mono text-xs tabular-nums ml-2 shrink-0 ${
                    isActive
                      ? 'text-cyan-50 font-semibold'
                      : item.badgeTone === 'red'
                        ? 'text-red-400 font-semibold'
                        : item.badgeTone === 'amber'
                          ? 'text-amber-400 font-semibold'
                          : item.badgeTone === 'teal'
                            ? 'text-teal-300 font-semibold'
                            : item.badgeTone === 'blue'
                              ? 'text-cyan-300 font-semibold'
                              : 'text-slate-400'
                  }`}
                >
                  {item.badgeCount}
                </span>
              )}
            </button>
          );
        })}

        <div className="pt-6 px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300/65">
          Factory Scope
        </div>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              onSelectFactory('ALL');
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all duration-200 cursor-pointer ${
              selectedFactory === 'ALL'
                ? 'bg-cyan-950/75 text-white font-semibold ring-1 ring-cyan-400/35 shadow-[0_2px_10px_-4px_rgba(6,182,212,0.4)]'
                : 'text-slate-300 hover:bg-cyan-500/10 hover:text-white'
            }`}
          >
            <span>All 4 Factories</span>
            <span className="font-mono tabular-nums text-cyan-200/80">
              {totalLines}L · {totalMc.toLocaleString()} Mc
            </span>
          </button>
          {factorySummaries.map((item) => {
            const isSelected = selectedFactory === item.factory;
            return (
              <button
                key={item.factory}
                type="button"
                onClick={() => {
                  onSelectFactory(item.factory);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all duration-200 cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-950/75 text-white font-semibold ring-1 ring-cyan-400/35 shadow-[0_2px_10px_-4px_rgba(6,182,212,0.4)]'
                    : 'text-slate-300 hover:bg-cyan-500/10 hover:text-white'
                }`}
              >
                <span>{item.factory}</span>
                <span className="font-mono tabular-nums text-cyan-200/80">
                  {item.lines}L · {item.capacityMc.toLocaleString()} Mc
                </span>
              </button>
            );
          })}
        </div>
        {onOpenShehreen && (
          <div className="pt-4">
            <button
              type="button"
              onClick={() => {
                onOpenShehreen();
                onCloseMobile();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold shadow-[0_6px_18px_-6px_rgba(6,182,212,0.45)] ring-1 ring-cyan-300/30 transition-all cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-100 shrink-0" />
                <span>Ask SHEHREEN AI</span>
              </span>
              <span className="text-[11px] font-mono text-cyan-100">Help</span>
            </button>
          </div>
        )}
      </nav>

      <div className="ct-safe-sidebar-footer border-t border-cyan-500/15 bg-slate-950/60 text-xs text-slate-300 space-y-1.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Input Start Rule</span>
          <span className="font-mono text-slate-100 tabular-nums">End - {inputStartOffsetDays}D</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Upcoming FO Rule</span>
          <span className="font-mono text-slate-100 tabular-nums">Input - {upcomingFoOffsetDays}D</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Cutting FO Alert</span>
          <span className="font-mono font-semibold text-red-400 tabular-nums">
            {counts.cuttingAlert10d} (&le; {cuttingAlertDays}D)
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">Plan Qty Pending</span>
          <span className="font-mono font-semibold text-amber-400 tabular-nums">
            {counts.planQtyPending}
          </span>
        </div>
        <div className="pt-1.5">
          <PWAInstallButton />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 sidebar-shell-height sticky top-0">
        {sidebarBody}
      </aside>

      {mobileOpen && (
        <div
          id="mobile-navigation-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          className="fixed inset-0 z-[60] lg:hidden flex sidebar-shell-height overflow-hidden"
        >
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px] touch-none"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full min-h-0 z-10 shadow-2xl">
            {sidebarBody}
          </div>
        </div>
      )}
    </>
  );
}
