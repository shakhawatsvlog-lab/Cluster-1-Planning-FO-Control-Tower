import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  Database,
  LayoutDashboard,
  Lock,
  Mail,
  PackageOpen,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { FactoryName } from '../shared/plannerTypes.ts';

export type NavTab =
  | 'dashboard'
  | 'cutting_entry'
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
    foRequired: number;
    actionRequired: number;
    planQtyPending: number;
    cuttingAlert10d: number;
    activeRecipients: number;
  };
  adminUnlocked?: boolean;
  asOfDateRaw: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
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
  mobileOpen,
  onCloseMobile,
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
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <div>
          <div className="font-display text-sm font-bold tracking-tight text-slate-900">
            Cluster 1 Planning
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Master Plan · {asOfDateRaw}
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-blue-600' : 'text-slate-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badgeCount !== undefined && (
                <span
                  className={`font-mono text-xs tabular-nums ml-2 shrink-0 ${
                    item.badgeTone === 'red'
                      ? 'text-red-700 font-semibold'
                      : item.badgeTone === 'amber'
                        ? 'text-amber-700 font-semibold'
                        : item.badgeTone === 'teal'
                          ? 'text-teal-700 font-semibold'
                          : item.badgeTone === 'blue'
                            ? 'text-blue-700 font-semibold'
                            : 'text-slate-500'
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
                ? 'bg-slate-900 text-white font-medium'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span>All 4 Factories</span>
            <span className="font-mono tabular-nums">
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
                    ? 'bg-slate-900 text-white font-medium'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span>{item.factory}</span>
                <span className="font-mono tabular-nums">
                  {item.lines}L · {item.capacityMc.toLocaleString()} Mc
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="px-4 py-3.5 border-t border-slate-200 bg-slate-50/70 text-xs text-slate-600 space-y-1.5">
        <div className="flex items-center justify-between">
          <span>Input Start Rule</span>
          <span className="font-mono text-slate-900">End - 10D</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Upcoming FO Rule</span>
          <span className="font-mono text-slate-900">Input - 20D</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Cutting FO Alert</span>
          <span className="font-mono font-semibold text-red-700 tabular-nums">
            {counts.cuttingAlert10d} (&le; 10D)
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Plan Qty Pending</span>
          <span className="font-mono font-semibold text-amber-700 tabular-nums">
            {counts.planQtyPending}
          </span>
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
