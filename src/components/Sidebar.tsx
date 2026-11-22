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

  const sidebarBody = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100 border-r border-slate-800">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div>
          <div className="font-display text-sm font-bold tracking-tight text-white">
            Cluster 1 Planning
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            Master Plan · {asOfDateRaw}
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-2 rounded-md text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Workspace sections">
        <div className="px-2.5 pb-1.5 text-xs font-medium text-slate-400">
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
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-white' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badgeCount !== undefined && (
                <span
                  className={`font-mono text-xs tabular-nums ml-2 shrink-0 ${
                    isActive
                      ? 'text-blue-100 font-semibold'
                      : item.badgeTone === 'red'
                        ? 'text-red-400 font-semibold'
                        : item.badgeTone === 'amber'
                          ? 'text-amber-400 font-semibold'
                          : item.badgeTone === 'teal'
                            ? 'text-emerald-400 font-semibold'
                            : item.badgeTone === 'blue'
                              ? 'text-blue-400 font-semibold'
                              : 'text-slate-400'
                  }`}
                >
                  {item.badgeCount}
                </span>
              )}
            </button>
          );
        })}

        <div className="pt-6 px-2.5 pb-1.5 text-xs font-medium text-slate-400">
          Factory Scope
        </div>
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => {
              onSelectFactory('ALL');
              onCloseMobile();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
              selectedFactory === 'ALL'
                ? 'bg-slate-800 text-white font-semibold ring-1 ring-slate-700'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
            }`}
          >
            <span>All 4 Factories</span>
            <span className="font-mono tabular-nums text-slate-300">
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
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800 text-white font-semibold ring-1 ring-slate-700'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                <span>{item.factory}</span>
                <span className="font-mono tabular-nums text-slate-300">
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
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-100 shrink-0" />
                <span>Ask SHEHREEN AI</span>
              </span>
              <span className="text-[11px] font-mono text-blue-100">Help</span>
            </button>
          </div>
        )}
      </nav>

      <div className="px-4 py-3.5 border-t border-slate-800 bg-slate-950/50 text-xs text-slate-300 space-y-1.5">
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
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">
        {sidebarBody}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative w-64 max-w-[80vw] h-full z-10">{sidebarBody}</div>
        </div>
      )}
    </>
  );
}
