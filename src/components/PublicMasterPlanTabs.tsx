import { ClipboardCheck, LayoutGrid } from 'lucide-react';

export type PublicMasterPlanTab = 'master_plan' | 'fo_needed';

interface PublicMasterPlanTabsProps {
  activeTab: PublicMasterPlanTab;
  onChangeTab: (tab: PublicMasterPlanTab) => void;
  foNeededCount?: number | null;
}

export function PublicMasterPlanTabs({
  activeTab,
  onChangeTab,
  foNeededCount = null,
}: PublicMasterPlanTabsProps) {
  return (
    <div className="border-b border-cyan-900/12 bg-white/80 backdrop-blur-md">
      <div className="ct-safe-x max-w-[1600px] mx-auto py-2.5">
        <div
          role="tablist"
          aria-label="Master Plan Views"
          className="grid grid-cols-2 sm:inline-flex items-center gap-2 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 shadow-inner"
        >
          <button
            type="button"
            role="tab"
            id="tab-master-plan"
            aria-selected={activeTab === 'master_plan'}
            aria-controls="panel-master-plan"
            onClick={() => onChangeTab('master_plan')}
            className={`h-10 px-4 sm:px-5 rounded-lg text-xs sm:text-sm font-display font-semibold tracking-wide inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'master_plan'
                ? 'bg-gradient-to-r from-[#0a1633] via-cyan-800 to-teal-700 text-white shadow-[0_6px_16px_-6px_rgba(8,145,178,0.55)]'
                : 'text-slate-600 hover:text-slate-950 hover:bg-white/80'
            }`}
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
            <span>MASTER PLAN</span>
          </button>

          <button
            type="button"
            role="tab"
            id="tab-fo-needed"
            aria-selected={activeTab === 'fo_needed'}
            aria-controls="panel-fo-needed"
            onClick={() => onChangeTab('fo_needed')}
            className={`h-10 px-4 sm:px-5 rounded-lg text-xs sm:text-sm font-display font-semibold tracking-wide inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'fo_needed'
                ? 'bg-gradient-to-r from-[#0a1633] via-cyan-800 to-teal-700 text-white shadow-[0_6px_16px_-6px_rgba(8,145,178,0.55)]'
                : 'text-slate-600 hover:text-slate-950 hover:bg-white/80'
            }`}
          >
            <ClipboardCheck className="w-4 h-4 shrink-0" />
            <span>FO NEEDED</span>
            {foNeededCount !== null && foNeededCount > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-bold tabular-nums leading-none ${
                  activeTab === 'fo_needed'
                    ? 'bg-white/20 text-white'
                    : 'bg-cyan-100 text-cyan-900 border border-cyan-200'
                }`}
              >
                {foNeededCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
