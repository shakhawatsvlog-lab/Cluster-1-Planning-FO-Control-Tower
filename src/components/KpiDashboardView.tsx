import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type {
  EvaluatedPlanningRecord,
  FactoryName,
  LineShortcutSummary,
} from '../shared/plannerTypes.ts';
import type { NavTab } from './Sidebar.tsx';

type ShortcutFilterMode = 'urgent' | 'cutting_10d' | 'all_lines';

interface KpiDashboardViewProps {
  filteredRecords: EvaluatedPlanningRecord[];
  allRecords: EvaluatedPlanningRecord[];
  shortcutSummaries: LineShortcutSummary[];
  selectedFactory: FactoryName | 'ALL';
  selectedLine: string;
  onSelectFactory: (f: FactoryName | 'ALL') => void;
  onSelectLine: (line: string) => void;
  onNavigateTab: (tab: NavTab) => void;
}

export function KpiDashboardView({
  filteredRecords,
  allRecords,
  shortcutSummaries,
  selectedFactory,
  selectedLine,
  onSelectFactory,
  onSelectLine,
  onNavigateTab,
}: KpiDashboardViewProps) {
  const [shortcutMode, setShortcutMode] = useState<ShortcutFilterMode>('urgent');

  // Filter shortcut summaries to active Factory / Line dropdowns
  const scopedShortcuts = useMemo(() => {
    return shortcutSummaries.filter((s) => {
      if (selectedFactory !== 'ALL' && s.factory !== selectedFactory) return false;
      if (selectedLine !== 'ALL' && s.line !== selectedLine) return false;
      return true;
    });
  }, [shortcutSummaries, selectedFactory, selectedLine]);

  // Sort by urgency & earliest FO trigger date
  const visibleShortcuts = useMemo(() => {
    const filtered = scopedShortcuts.filter((s) => {
      if (shortcutMode === 'cutting_10d') return s.cuttingAlertActive;
      if (shortcutMode === 'urgent') {
        return (
          s.summarySeverity === 'critical' ||
          s.summarySeverity === 'warning' ||
          s.cuttingAlertActive
        );
      }
      return true;
    });

    const sevOrder = { critical: 0, warning: 1, upcoming: 2, normal: 3 };
    return [...filtered].sort((a, b) => {
      if (sevOrder[a.summarySeverity] !== sevOrder[b.summarySeverity]) {
        return sevOrder[a.summarySeverity] - sevOrder[b.summarySeverity];
      }
      return (a.upcomingFoTriggerIso || '9999-12-31').localeCompare(
        b.upcomingFoTriggerIso || '9999-12-31'
      );
    });
  }, [scopedShortcuts, shortcutMode]);

  // Per-factory shortcut analysis strip (always analyzes all 4 factories!)
  const factoryShortcutDigest = useMemo(() => {
    return ALLOWED_FACTORIES.map((factory) => {
      const lines = shortcutSummaries.filter((s) => s.factory === factory);
      const foNowCount = lines.filter(
        (s) => s.upcomingFoAlertActive || s.cuttingAlertActive
      ).length;
      const dueSoonCount = lines.filter((s) => s.summarySeverity === 'warning').length;
      const cutting10dCount = lines.filter((s) => s.cuttingAlertActive).length;

      const earliestNext = [...lines]
        .filter((s) => s.upcomingRecord !== null)
        .sort((a, b) =>
          (a.upcomingFoTriggerIso || '9999-12-31').localeCompare(
            b.upcomingFoTriggerIso || '9999-12-31'
          )
        )[0];

      return {
        factory,
        totalLines: lines.length,
        foNowCount,
        dueSoonCount,
        cutting10dCount,
        earliestNext,
      };
    });
  }, [shortcutSummaries]);

  // Unique lines & machine capacity in current filtered slice
  const uniqueLineMap = new Map<string, number>();
  for (const r of filteredRecords) {
    const key = `${r.factory}::${r.line}`;
    if (!uniqueLineMap.has(key)) {
      uniqueLineMap.set(key, r.capacityMc);
    }
  }
  const activeLinesCount = uniqueLineMap.size;
  const totalCapacityMc = Array.from(uniqueLineMap.values()).reduce((a, b) => a + b, 0);

  const runningCount = filteredRecords.filter((r) => r.lifecycleStage === 'Running').length;
  const planQtyPendingCount = filteredRecords.filter(
    (r) => r.plannedQty === null && !r.isFinished
  ).length;
  const foRequiredCount = filteredRecords.filter((r) => r.foRequired).length;
  const actionRequiredCount = filteredRecords.filter((r) => r.actionRequired).length;
  const cutting10dAlerts = filteredRecords.filter(
    (r) => r.isCuttingWithin10Days && !r.isFinished
  ).length;
  const urgentTriggersCount = filteredRecords.filter(
    (r) => r.daysToTrigger !== null && r.daysToTrigger <= 14 && !r.isFinished
  ).length;

  const factoryRows = ALLOWED_FACTORIES.map((factory) => {
    const facRecs = allRecords.filter((r) => r.factory === factory);
    const lineMap = new Map<string, number>();
    for (const r of facRecs) {
      if (!lineMap.has(r.line)) lineMap.set(r.line, r.capacityMc);
    }
    const capacityMc = Array.from(lineMap.values()).reduce((a, b) => a + b, 0);
    return {
      factory,
      lines: lineMap.size,
      capacityMc,
      runningStyles: facRecs.filter((r) => r.lifecycleStage === 'Running').length,
      totalSlots: facRecs.length,
      planQtyPending: facRecs.filter((r) => r.plannedQty === null && !r.isFinished).length,
      foRequired: facRecs.filter((r) => r.foRequired).length,
      urgentTriggers: facRecs.filter(
        (r) => r.daysToTrigger !== null && r.daysToTrigger <= 14 && !r.isFinished
      ).length,
    };
  });

  const clusterTotalMc = factoryRows.reduce((s, r) => s + r.capacityMc, 0);

  const buckets = [
    {
      label: 'Overdue Trigger (<= 0 Days)',
      count: filteredRecords.filter(
        (r) => !r.isFinished && r.daysToTrigger !== null && r.daysToTrigger <= 0
      ).length,
      tone: 'bg-red-600',
    },
    {
      label: 'Imminent Trigger (1–14 Days)',
      count: filteredRecords.filter(
        (r) =>
          !r.isFinished &&
          r.daysToTrigger !== null &&
          r.daysToTrigger > 0 &&
          r.daysToTrigger <= 14
      ).length,
      tone: 'bg-amber-500',
    },
    {
      label: 'Near-Term Window (15–30 Days)',
      count: filteredRecords.filter(
        (r) =>
          !r.isFinished &&
          r.daysToTrigger !== null &&
          r.daysToTrigger > 14 &&
          r.daysToTrigger <= 30
      ).length,
      tone: 'bg-blue-600',
    },
    {
      label: 'Mid-Term Horizon (31–90 Days)',
      count: filteredRecords.filter(
        (r) =>
          !r.isFinished &&
          r.daysToTrigger !== null &&
          r.daysToTrigger > 30 &&
          r.daysToTrigger <= 90
      ).length,
      tone: 'bg-slate-600',
    },
    {
      label: 'Long-Range Queue (90+ Days)',
      count: filteredRecords.filter(
        (r) => !r.isFinished && r.daysToTrigger !== null && r.daysToTrigger > 90
      ).length,
      tone: 'bg-slate-400',
    },
  ];
  const maxBucket = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="space-y-6">
      {/* SHORTCUT SUMMARY SECTION: ALL FACTORIES UPCOMING FO & CUTTING <= 10D */}
      <section aria-label="Factory FO Shortcut Summary" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Shortcut Summary — Upcoming Fabric Order &amp; Cutting Alert
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Analyzes every line&apos;s active Running Style and immediate Next Order only (Input Start = Running End &minus; 10D; Upcoming FO Trigger = Input Start &minus; 20D; Cutting Alert when &le; 10D remaining).
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => onNavigateTab('cutting_entry')}
              className="text-teal-700 hover:text-teal-900 font-medium inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <span>Log Daily Cutting</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <span className="text-slate-300" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('fo_required')}
              className="text-blue-700 hover:text-blue-900 font-medium inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <span>FO Required ({foRequiredCount})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 4-Factory Shortcut Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {factoryShortcutDigest.map((item) => {
            const isSelected = selectedFactory === item.factory;
            const nextRec = item.earliestNext?.upcomingRecord;
            return (
              <button
                key={item.factory}
                type="button"
                onClick={() =>
                  onSelectFactory(isSelected ? 'ALL' : item.factory)
                }
                className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-blue-600 ring-1 ring-blue-600'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold text-slate-900">
                    {item.factory}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {item.totalLines} lines
                  </span>
                </div>

                <div className="mt-2.5 flex items-baseline gap-3">
                  <span
                    className={`font-mono text-xl font-bold tabular-nums ${
                      item.foNowCount > 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {item.foNowCount}
                  </span>
                  <span className="text-xs text-slate-600">
                    {item.foNowCount === 1 ? 'line needs FO now' : 'lines need FO now'}
                    {item.dueSoonCount > 0 ? ` · ${item.dueSoonCount} due soon` : ''}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 text-xs space-y-1">
                  {nextRec ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-900 truncate">
                          Next: {nextRec.pgNumber !== '—' ? nextRec.pgNumber : item.earliestNext.line}
                        </span>
                        <span className="font-mono tabular-nums text-slate-600 shrink-0">
                          FO: {formatDisplayDate(item.earliestNext.upcomingFoTriggerIso)}
                        </span>
                      </div>
                      <div className="text-slate-500 truncate" title={nextRec.style}>
                        {item.earliestNext.line} · {nextRec.style}
                      </div>
                    </>
                  ) : (
                    <div className="text-slate-400">No upcoming style queued</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Immediate Upcoming Order & Cutting <= 10D Shortcut Table */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Line-Wise Immediate Fabric Order Schedule ({visibleShortcuts.length} Lines Shown)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Shows only the single immediate next order per line (e.g., running PG followed by next PG). Click any row to focus that line.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {[
                { id: 'urgent' as const, label: 'FO Needed & Due Soon' },
                { id: 'cutting_10d' as const, label: `Cutting <= 10D (${cutting10dAlerts})` },
                { id: 'all_lines' as const, label: `All Lines (${scopedShortcuts.length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setShortcutMode(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    shortcutMode === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Factory · Line</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Running PG &amp; Style</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Cutting Progress</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Next PG &amp; Immediate Style</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Input Start (End-10D)</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">FO Trigger (In-20D)</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">FO Alert / Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {visibleShortcuts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No lines match this shortcut filter. Switch to &ldquo;All Lines&rdquo; to inspect every line&apos;s upcoming schedule.
                    </td>
                  </tr>
                ) : (
                  visibleShortcuts.map((s) => {
                    const run = s.runningRecord;
                    const up = s.upcomingRecord;
                    const statusBadge =
                      s.summarySeverity === 'critical'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : s.summarySeverity === 'warning'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : s.summarySeverity === 'upcoming'
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200';

                    return (
                      <tr
                        key={`${s.factory}-${s.line}`}
                        onClick={() => {
                          onSelectFactory(s.factory);
                          onSelectLine(s.line);
                        }}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {s.factory} · {s.line}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {s.capacityMc} Mc
                          </div>
                        </td>

                        <td className="py-2.5 px-3.5 max-w-[230px]">
                          {run ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-slate-900">
                                  {run.pgNumber}
                                </span>
                                <span className="text-slate-300" aria-hidden="true">
                                  ·
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  End {formatDisplayDate(run.endDateIso)}
                                </span>
                              </div>
                              <div className="text-slate-700 truncate" title={run.style}>
                                {run.style}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">All styles finished</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {run ? (
                            run.plannedQty !== null && run.dailyTargetQty !== null && run.dailyTargetQty > 0 ? (
                              <div>
                                <div className="font-mono tabular-nums font-medium text-slate-900">
                                  {run.cuttingFinishedQty.toLocaleString()} /{' '}
                                  {run.plannedQty.toLocaleString()}
                                </div>
                                <div
                                  className={`font-mono text-[11px] tabular-nums ${
                                    run.isCuttingWithin10Days
                                      ? 'text-red-700 font-semibold'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {run.cuttingDaysRemaining}D left ({run.dailyTargetQty.toLocaleString()}/day)
                                </div>
                              </div>
                            ) : (
                              <div className="text-slate-500">
                                <span className="font-mono tabular-nums">
                                  Cut: {run.cuttingFinishedQty.toLocaleString()}
                                </span>
                                <div className="text-[11px] text-slate-400">
                                  {run.plannedQty === null
                                    ? 'Order Qty pending'
                                    : 'Set Daily Target'}
                                </div>
                              </div>
                            )
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 max-w-[240px]">
                          {up ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-blue-700">
                                  {up.pgNumber}
                                </span>
                                <span className="text-slate-300" aria-hidden="true">
                                  ·
                                </span>
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  Slot {up.slot}
                                </span>
                              </div>
                              <div className="text-slate-800 font-medium truncate" title={up.style}>
                                {up.style}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">No upcoming style</span>
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap text-slate-700">
                          {formatDisplayDate(s.newStyleInputStartIso)}
                        </td>

                        <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {formatDisplayDate(s.upcomingFoTriggerIso)}
                          </div>
                          {s.daysToUpcomingFoTrigger !== null && (
                            <div
                              className={`text-[11px] ${
                                s.daysToUpcomingFoTrigger <= 0
                                  ? 'text-red-700 font-semibold'
                                  : s.daysToUpcomingFoTrigger <= 15
                                    ? 'text-amber-700 font-medium'
                                    : 'text-slate-500'
                              }`}
                            >
                              {s.daysToUpcomingFoTrigger <= 0
                                ? `${Math.abs(s.daysToUpcomingFoTrigger)}d overdue`
                                : `in ${s.daysToUpcomingFoTrigger}d`}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 min-w-[220px]">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold whitespace-nowrap ${statusBadge}`}
                          >
                            {s.summaryStatus}
                          </span>
                          <div className="text-[11px] text-slate-600 mt-1">{s.foNeedReason}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 4-Column Cluster KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Machine Capacity &amp; Lines</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {totalCapacityMc.toLocaleString()} Mc
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {activeLinesCount} active lines
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {runningCount} running styles · {filteredRecords.length} total slots
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Plan Qty Pending</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold text-amber-700 tabular-nums">
              {planQtyPendingCount}
            </span>
            <span className="text-xs font-medium text-amber-800">⚠ PLAN QTY PENDING</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Triggers &ldquo;FO NEED - TAKE ACTION AS PER PLAN&rdquo;
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Fabric Orders Required</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {foRequiredCount}
            </span>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {cutting10dAlerts} cutting &le; 10D
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {actionRequiredCount} total items flagged Action Required
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">End-10D Triggers &le; 14D</div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-2xl font-semibold text-red-700 tabular-nums">
              {urgentTriggersCount}
            </span>
            <span className="font-mono text-xs text-red-700 tabular-nums">
              End Date &minus; 10D
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Selected scope: {selectedFactory === 'ALL' ? 'All 4 Factories' : selectedFactory}
            {selectedLine !== 'ALL' ? ` · ${selectedLine}` : ''}
          </div>
        </div>
      </div>

      {/* Factory-Wise Breakdown & Trigger Horizon Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Factory-Wise Capacity &amp; Planning Summary
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any factory row to filter the entire workspace.
              </p>
            </div>
            {selectedFactory !== 'ALL' && (
              <button
                type="button"
                onClick={() => onSelectFactory('ALL')}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 whitespace-nowrap cursor-pointer"
              >
                Show All Factories
              </button>
            )}
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-3.5">Factory</th>
                  <th className="py-2.5 px-3.5 text-right">Lines</th>
                  <th className="py-2.5 px-3.5 text-right">Capacity</th>
                  <th className="py-2.5 px-3.5 text-right">Share</th>
                  <th className="py-2.5 px-3.5 text-right">Running</th>
                  <th className="py-2.5 px-3.5 text-right">Qty Pending</th>
                  <th className="py-2.5 px-3.5 text-right">FO Req</th>
                  <th className="py-2.5 px-3.5 text-right">Due &le; 14D</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {factoryRows.map((row) => {
                  const isSelected = selectedFactory === row.factory;
                  const share = clusterTotalMc > 0 ? (row.capacityMc / clusterTotalMc) * 100 : 0;
                  return (
                    <tr
                      key={row.factory}
                      onClick={() =>
                        onSelectFactory(isSelected ? 'ALL' : row.factory)
                      }
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-3.5 font-semibold text-slate-900 whitespace-nowrap">
                        {row.factory}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-700">
                        {row.lines}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-medium text-slate-900">
                        {row.capacityMc.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-500">
                        {share.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-700">
                        {row.runningStyles}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-medium text-amber-700">
                        {row.planQtyPending}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-900">
                        {row.foRequired}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-medium text-red-700">
                        {row.urgentTriggers}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-300 bg-slate-50 font-semibold text-xs text-slate-900">
                  <td className="py-2.5 px-3.5">Cluster 1 Total</td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {factoryRows.reduce((s, r) => s + r.lines, 0)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {clusterTotalMc.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">100.0%</td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {factoryRows.reduce((s, r) => s + r.runningStyles, 0)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-amber-800">
                    {factoryRows.reduce((s, r) => s + r.planQtyPending, 0)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums">
                    {factoryRows.reduce((s, r) => s + r.foRequired, 0)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-red-800">
                    {factoryRows.reduce((s, r) => s + r.urgentTriggers, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Trigger Date Horizon (End Date &minus; 10 Days)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Distribution of active allocations by days remaining until End &minus; 10D trigger.
            </p>
            <div className="mt-5 space-y-3.5">
              {buckets.map((bucket) => {
                const widthPct = Math.round((bucket.count / maxBucket) * 100);
                return (
                  <div key={bucket.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-700 font-medium">{bucket.label}</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {bucket.count}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${bucket.tone}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Line-Wise Master Plan</span>
            <button
              type="button"
              onClick={() => onNavigateTab('database')}
              className="text-blue-700 hover:text-blue-900 font-medium cursor-pointer"
            >
              Manage Lines &amp; Dates &rarr;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
