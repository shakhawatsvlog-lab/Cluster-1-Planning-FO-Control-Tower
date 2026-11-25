import { CheckCircle2, Factory } from 'lucide-react';
import type { FactoryName } from '../shared/plannerTypes.ts';

interface PublicFactorySelectorBarProps {
  factories: FactoryName[];
  selectedFactory: FactoryName | null;
  isSwitching: boolean;
  onSelectFactory: (factory: FactoryName) => void;
}

export function PublicFactorySelectorBar({
  factories,
  selectedFactory,
  isSwitching,
  onSelectFactory,
}: PublicFactorySelectorBarProps) {
  return (
    <section aria-label="Select Factory Master Plan" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-sm sm:text-base font-semibold text-slate-900">
            Select Factory Unit
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Choose a facility below to inspect its dedicated live production schedule.
          </p>
        </div>
        {selectedFactory && (
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {isSwitching ? `Loading ${selectedFactory}...` : `Showing ${selectedFactory}`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {factories.map((factory, idx) => {
          const isSelected = selectedFactory === factory;
          const unitIndex = String(idx + 1).padStart(2, '0');

          return (
            <button
              key={factory}
              type="button"
              onClick={() => onSelectFactory(factory)}
              aria-pressed={isSelected}
              className={`group text-left rounded-2xl p-4 sm:p-5 min-h-[104px] flex flex-col justify-between gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 ${
                isSelected ? 'mp-factory-card-active text-white' : 'mp-factory-card text-slate-900'
              }`}
            >
              {/* Animated top active indicator bar */}
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-[3px] transition-opacity duration-200 ${
                  isSelected
                    ? 'bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-400 opacity-100 robotics-border-pulse'
                    : 'bg-gradient-to-r from-cyan-500/0 via-cyan-500/65 to-teal-500/0 opacity-0 group-hover:opacity-100'
                }`}
              />

              {/* Diagonal hover light sweep */}
              <span className="mp-factory-sweep" aria-hidden="true" />

              {/* Subtle radial glow accent on active/hover */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -right-8 -bottom-8 w-28 h-28 rounded-full blur-2xl transition-opacity duration-300 ${
                  isSelected
                    ? 'bg-cyan-400/25 opacity-100'
                    : 'bg-cyan-400/20 opacity-0 group-hover:opacity-80'
                }`}
              />

              <div className="relative z-10 flex items-start justify-between gap-2">
                <div
                  className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center border transition-all duration-200 shrink-0 ${
                    isSelected
                      ? 'bg-cyan-400/15 border-cyan-300/40 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.22)]'
                      : 'bg-slate-100/90 border-slate-200/90 text-slate-700 group-hover:bg-cyan-50 group-hover:border-cyan-300/70 group-hover:text-cyan-800'
                  }`}
                >
                  <Factory className="w-5 h-5" />
                </div>

                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                    isSelected ? 'text-cyan-200' : 'text-slate-400 group-hover:text-cyan-700'
                  }`}
                >
                  {isSelected ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
                      <span>Selected</span>
                    </>
                  ) : (
                    <span className="font-mono tabular-nums">Unit {unitIndex}</span>
                  )}
                </span>
              </div>

              <div className="relative z-10 min-w-0">
                <div
                  className={`font-display text-base sm:text-lg font-bold tracking-tight truncate ${
                    isSelected ? 'text-white' : 'text-slate-950'
                  }`}
                >
                  {factory}
                </div>
                <div
                  className={`text-xs mt-0.5 flex items-center gap-1.5 truncate ${
                    isSelected ? 'text-cyan-100/80' : 'text-slate-500'
                  }`}
                >
                  <span>{isSelected ? 'Active Master Plan' : 'View Factory Plan'}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
