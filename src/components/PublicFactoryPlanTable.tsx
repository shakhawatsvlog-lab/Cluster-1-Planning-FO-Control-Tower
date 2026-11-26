import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, RotateCcw } from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type {
  FactoryName,
  OutputStatus,
  PackingStatus,
  PublicMasterPlanRecord,
} from '../shared/plannerTypes.ts';
import { ActionMessageDisplay, RiskStatusDisplay } from './StatusCell.tsx';

type SortKey = 'default' | 'endDate' | 'triggerDate' | 'capacity';
type ViewMode = 'line_grouped' | 'flat_table';

interface PublicFactoryPlanTableProps {
  selectedFactory: FactoryName;
  records: PublicMasterPlanRecord[];
  isSwitching: boolean;
  hasActiveFilters: boolean;
  dateRangeActive: boolean;
  onResetFilters: () => void;
}

function renderOutputStatusBadge(status: OutputStatus) {
  if (status === 'Over Output') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-300 bg-red-50 text-red-700 font-semibold text-[11px] whitespace-nowrap">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Over Output</span>
      </span>
    );
  }
  if (status === 'Completed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold text-[11px] whitespace-nowrap">
        Completed
      </span>
    );
  }
  if (status === 'In Progress') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-teal-200 bg-teal-50 text-teal-800 font-semibold text-[11px] whitespace-nowrap">
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded border border-slate-200 bg-slate-100 text-slate-600 font-medium text-[11px] whitespace-nowrap">
      Not Started
    </span>
  );
}

function renderPackingStatusBadge(status: PackingStatus) {
  if (status === 'Over Packed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-300 bg-red-50 text-red-700 font-semibold text-[11px] whitespace-nowrap">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Over Packed</span>
      </span>
    );
  }
  if (status === 'Completed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 font-semibold text-[11px] whitespace-nowrap">
        Completed
      </span>
    );
  }
  if (status === 'In Progress') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-cyan-200 bg-cyan-50 text-cyan-800 font-semibold text-[11px] whitespace-nowrap">
        In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded border border-slate-200 bg-slate-100 text-slate-600 font-medium text-[11px] whitespace-nowrap">
      Not Started
    </span>
  );
}

function renderEndDateCell(endDateIso: string | null) {
  if (!endDateIso) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div className="space-y-0.5">
      <div className="font-mono tabular-nums font-medium text-slate-900">
        {formatDisplayDate(endDateIso)}
      </div>
      <span className="inline-block px-1.5 py-px rounded bg-slate-100 border border-slate-200 text-[9px] font-semibold tracking-wide text-slate-600 uppercase">
        CONFIRMED
      </span>
    </div>
  );
}

function renderEstimatedOutputStartCell(rec: PublicMasterPlanRecord) {
  if (rec.lifecycleStage === 'Upcoming (Next)') {
    if (rec.estimatedOutputStatus === 'available' && rec.estimatedOutputStartIso) {
      return (
        <div
          className="space-y-0.5"
          title={`Estimated from Running ${rec.precedingRunningPgNumber || 'style'} End Date (${formatDisplayDate(
            rec.precedingRunningEndDateIso
          )}) + 1 Day`}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono tabular-nums font-semibold text-teal-900">
              {formatDisplayDate(rec.estimatedOutputStartIso)}
            </span>
            <span className="inline-block px-1.5 py-px rounded bg-teal-50 border border-teal-300 text-[9px] font-bold tracking-wide text-teal-800 uppercase">
              ESTIMATED
            </span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono tabular-nums">
            Run {rec.precedingRunningPgNumber || 'style'} ends{' '}
            {formatDisplayDate(rec.precedingRunningEndDateIso)} + 1D
          </div>
        </div>
      );
    }

    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[11px] font-medium whitespace-nowrap">
        Awaiting Running Style End Date
      </span>
    );
  }

  if (rec.lifecycleStage === 'Running') {
    return (
      <span className="text-[11px] font-medium text-cyan-800 whitespace-nowrap">
        In Production
      </span>
    );
  }

  if (rec.lifecycleStage === 'Order Closed') {
    return <span className="text-[11px] text-slate-400 whitespace-nowrap">Closed</span>;
  }

  if (rec.estimatedOutputStatus === 'awaiting_running_end_date') {
    return (
      <span className="text-[11px] text-amber-700/90 whitespace-nowrap">
        Awaiting Running Style End Date
      </span>
    );
  }

  return <span className="text-[11px] text-slate-400 whitespace-nowrap">Queued (Next Up pending)</span>;
}

export function PublicFactoryPlanTable({
  selectedFactory,
  records,
  isSwitching,
  hasActiveFilters,
  dateRangeActive,
  onResetFilters,
}: PublicFactoryPlanTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('line_grouped');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedRecords = useMemo(() => {
    if (sortKey === 'default') return records;
    const copy = [...records];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'endDate') {
        cmp = (a.endDateIso || '9999-12-31').localeCompare(b.endDateIso || '9999-12-31');
      } else if (sortKey === 'triggerDate') {
        cmp = (a.triggerDateIso || '9999-12-31').localeCompare(
          b.triggerDateIso || '9999-12-31'
        );
      } else if (sortKey === 'capacity') {
        cmp = a.capacityMc - b.capacityMc;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [records, sortKey, sortDir]);

  const lineGroups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, PublicMasterPlanRecord[]>();
    for (const rec of sortedRecords) {
      const key = `${rec.factory}::${rec.line}`;
      if (!map.has(key)) {
        order.push(key);
        map.set(key, []);
      }
      map.get(key)!.push(rec);
    }
    return order.map((k) => {
      const items =
        sortKey === 'default'
          ? [...map.get(k)!].sort((a, b) => a.slot - b.slot)
          : map.get(k)!;
      return {
        key: k,
        factory: items[0].factory,
        zone: items[0].zone,
        line: items[0].line,
        capacityMc: items[0].capacityMc,
        productCategory: items[0].productCategory,
        items,
      };
    });
  }, [sortedRecords, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'capacity' ? 'desc' : 'asc');
    }
  };

  const renderLifecycleLabel = (rec: PublicMasterPlanRecord) => {
    if (rec.lifecycleStage === 'Running') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white font-mono text-[11px] font-semibold whitespace-nowrap shadow-xs">
          S{rec.slot} · Running
        </span>
      );
    }
    if (rec.lifecycleStage === 'Order Closed') {
      return (
        <span className="font-mono text-xs font-medium text-slate-500 whitespace-nowrap">
          S{rec.slot} · Closed
        </span>
      );
    }
    return (
      <span
        className={`font-mono text-xs whitespace-nowrap ${
          rec.lifecycleStage === 'Upcoming (Next)'
            ? 'font-semibold text-teal-700'
            : 'text-slate-600'
        }`}
      >
        S{rec.slot} · {rec.lifecycleStage === 'Upcoming (Next)' ? 'Next Up' : 'Queued'}
      </span>
    );
  };

  return (
    <section
      aria-label={`${selectedFactory} Master Plan Table`}
      className={`space-y-4 transition-opacity duration-200 ${
        isSwitching ? 'opacity-65' : 'opacity-100'
      }`}
    >
      {/* View Mode & Sort Controls Header */}
      <div className="ct-surface rounded-2xl px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm sm:text-base font-semibold text-slate-900">
            {selectedFactory} Master Plan Schedule
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
            {lineGroups.length} {lineGroups.length === 1 ? 'Line' : 'Lines'} · {records.length}{' '}
            Planned {records.length === 1 ? 'Slot' : 'Slots'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Segmented Buttons */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('line_grouped')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'line_grouped'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Line-Wise Grouped
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat_table')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'flat_table'
                  ? 'bg-white text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Flat Table
            </button>
          </div>

          {/* Sort Controls */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setSortKey('default')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                sortKey === 'default'
                  ? 'bg-[#0a1633] text-white border-[#0a1633]'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-500/50'
              }`}
            >
              Line Sequence
            </button>
            <button
              type="button"
              onClick={() => toggleSort('endDate')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                sortKey === 'endDate'
                  ? 'bg-[#0a1633] text-white border-[#0a1633]'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-500/50'
              }`}
            >
              <span>End Date</span>
              <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort('triggerDate')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                sortKey === 'triggerDate'
                  ? 'bg-[#0a1633] text-white border-[#0a1633]'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-500/50'
              }`}
            >
              <span>Trigger</span>
              <ArrowUpDown className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => toggleSort('capacity')}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                sortKey === 'capacity'
                  ? 'bg-[#0a1633] text-white border-[#0a1633]'
                  : 'bg-white text-slate-700 border-slate-300 hover:border-cyan-500/50'
              }`}
            >
              <span>Capacity</span>
              <ArrowUpDown className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty State vs Populated Table */}
      {records.length === 0 ? (
        <div className="ct-surface rounded-2xl py-12 px-4 text-center space-y-3">
          <div className="text-sm font-semibold text-slate-800">
            {dateRangeActive
              ? `No planning slots in ${selectedFactory} match the selected date range.`
              : `No planning records found for ${selectedFactory} under current filters.`}
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>
      ) : viewMode === 'line_grouped' ? (
        <div className="space-y-4">
          {lineGroups.map((group) => (
            <div key={group.key} className="ct-surface rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                  <span>{group.line}</span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-cyan-800">
                    {group.capacityMc} Mc
                  </span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-normal text-slate-500">
                    {group.zone} · {group.productCategory}
                  </span>
                </div>
                <span className="font-mono text-slate-500 tabular-nums">
                  {group.items.length} {group.items.length === 1 ? 'slot' : 'slots'}
                </span>
              </div>

              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full min-w-[1620px] text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-900 text-white">
                    <tr className="text-[11px] font-semibold tracking-wide">
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Lifecycle</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">PG #</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Style / Description</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Planned Qty</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Cutting Input Qty</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Cutting Output Qty</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Output Qty</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Balance to Output</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Output Status</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Packing Qty</th>
                      <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Balance to Pack</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Packing Status</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">End Date</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Trigger (End-10D)</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Est. Output Start (Run+1D)</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Order Status</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Plan Readiness</th>
                      <th className="py-2.5 px-3.5 whitespace-nowrap">Risk Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs bg-white">
                    {group.items.map((rec) => (
                      <tr
                        key={rec.id}
                        className={`transition-colors ${
                          rec.orderStatus === 'Order Closed'
                            ? 'bg-slate-50/80 opacity-75'
                            : rec.lifecycleStage === 'Running'
                              ? 'bg-cyan-50/40 hover:bg-cyan-50/65'
                              : 'hover:bg-cyan-50/25'
                        }`}
                      >
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderLifecycleLabel(rec)}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {rec.pgNumber}
                        </td>
                        <td className="py-2.5 px-3.5 min-w-[210px] max-w-[300px]">
                          <div className="font-medium text-slate-900 leading-snug">
                            {rec.style}
                          </div>
                          {rec.styleQtyHint !== null && (
                            <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                              Ref: {rec.styleQtyHint.toLocaleString()} pcs
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                          <span
                            className={`font-mono tabular-nums text-xs font-medium ${
                              rec.plannedQty === null && rec.orderStatus !== 'Order Closed'
                                ? 'text-amber-700'
                                : 'text-slate-900'
                            }`}
                          >
                            {rec.plannedQty !== null ? rec.plannedQty.toLocaleString() : '—'}
                          </span>
                        </td>
                        <td
                          className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-700"
                          title={
                            rec.cuttingInputQty === null
                              ? 'Cutting Input column not available in online cutting sheet'
                              : undefined
                          }
                        >
                          {rec.cuttingInputQty !== null ? (
                            rec.cuttingInputQty.toLocaleString()
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {rec.cuttingOutputQty.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          {rec.outputQty !== null ? (
                            <span className="font-semibold text-emerald-700">
                              {rec.outputQty.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-[11px] font-sans text-slate-400">Not set</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          {rec.balanceToOutput !== null ? (
                            <span
                              className={`font-semibold ${
                                rec.balanceToOutput < 0
                                  ? 'text-red-700'
                                  : rec.balanceToOutput === 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-800'
                              }`}
                            >
                              {rec.balanceToOutput.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderOutputStatusBadge(rec.outputStatus)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          {rec.packingQty !== null ? (
                            <span className="font-semibold text-teal-800">
                              {rec.packingQty.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-[11px] font-sans text-slate-400">Not set</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          {rec.balanceToPack !== null ? (
                            <span
                              className={`font-semibold ${
                                rec.balanceToPack < 0
                                  ? 'text-red-700'
                                  : rec.balanceToPack === 0
                                    ? 'text-emerald-700'
                                    : 'text-slate-800'
                              }`}
                            >
                              {rec.balanceToPack.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderPackingStatusBadge(rec.packingStatus)}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderEndDateCell(rec.endDateIso)}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                          {formatDisplayDate(rec.triggerDateIso)}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderEstimatedOutputStartCell(rec)}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
                              rec.orderStatus === 'Order Closed'
                                ? 'bg-slate-100 border-slate-200 text-slate-600'
                                : 'bg-teal-50 border-teal-200 text-teal-800'
                            }`}
                          >
                            {rec.orderStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 min-w-[200px]">
                          <ActionMessageDisplay
                            actionMessage={rec.actionMessage}
                            riskTier={rec.riskTier}
                          />
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <RiskStatusDisplay
                            riskStatus={rec.riskStatus}
                            riskTier={rec.riskTier}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="ct-surface rounded-2xl overflow-hidden">
          <div className="overflow-x-auto max-h-[68vh] overflow-y-auto">
            <table className="w-full min-w-[1720px] text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-900 text-white">
                <tr className="text-[11px] font-semibold tracking-wide">
                  <th className="py-3 px-3.5 whitespace-nowrap">Line · Zone</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Mc</th>
                  <th className="py-3 px-3 whitespace-nowrap">Lifecycle</th>
                  <th className="py-3 px-3 whitespace-nowrap">PG #</th>
                  <th className="py-3 px-3 whitespace-nowrap">Style / Description</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Planned Qty</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Cutting Input Qty</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Cutting Output Qty</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Output Qty</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Balance to Output</th>
                  <th className="py-3 px-3 whitespace-nowrap">Output Status</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Packing Qty</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Balance to Pack</th>
                  <th className="py-3 px-3 whitespace-nowrap">Packing Status</th>
                  <th className="py-3 px-3 whitespace-nowrap">End Date</th>
                  <th className="py-3 px-3 whitespace-nowrap">Trigger Date</th>
                  <th className="py-3 px-3 whitespace-nowrap">Est. Output Start (Run+1D)</th>
                  <th className="py-3 px-3 whitespace-nowrap">Order Status</th>
                  <th className="py-3 px-3 whitespace-nowrap">Plan Readiness</th>
                  <th className="py-3 px-3 whitespace-nowrap">Risk Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs bg-white">
                {sortedRecords.map((rec) => (
                  <tr
                    key={rec.id}
                    className={`transition-colors ${
                      rec.orderStatus === 'Order Closed'
                        ? 'bg-slate-50/80 opacity-75'
                        : rec.lifecycleStage === 'Running'
                          ? 'bg-cyan-50/35 hover:bg-cyan-50/60'
                          : 'hover:bg-cyan-50/25'
                    }`}
                  >
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{rec.line}</div>
                      <div className="text-[11px] text-slate-500">
                        {rec.zone} · {rec.productCategory}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {rec.capacityMc}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{renderLifecycleLabel(rec)}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {rec.pgNumber}
                    </td>
                    <td className="py-2.5 px-3 min-w-[200px] max-w-[280px]">
                      <div className="font-medium text-slate-900 truncate" title={rec.style}>
                        {rec.style}
                      </div>
                      {rec.styleQtyHint !== null && (
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                          Ref: {rec.styleQtyHint.toLocaleString()} pcs
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span
                        className={`font-mono tabular-nums text-xs font-medium ${
                          rec.plannedQty === null && rec.orderStatus !== 'Order Closed'
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {rec.plannedQty !== null ? rec.plannedQty.toLocaleString() : '—'}
                      </span>
                    </td>
                    <td
                      className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-slate-700"
                      title={
                        rec.cuttingInputQty === null
                          ? 'Cutting Input column not available in online cutting sheet'
                          : undefined
                      }
                    >
                      {rec.cuttingInputQty !== null ? (
                        rec.cuttingInputQty.toLocaleString()
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {rec.cuttingOutputQty.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {rec.outputQty !== null ? (
                        <span className="font-semibold text-emerald-700">
                          {rec.outputQty.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[11px] font-sans text-slate-400">Not set</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {rec.balanceToOutput !== null ? (
                        <span
                          className={`font-semibold ${
                            rec.balanceToOutput < 0
                              ? 'text-red-700'
                              : rec.balanceToOutput === 0
                                ? 'text-emerald-700'
                                : 'text-slate-800'
                          }`}
                        >
                          {rec.balanceToOutput.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {renderOutputStatusBadge(rec.outputStatus)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {rec.packingQty !== null ? (
                        <span className="font-semibold text-teal-800">
                          {rec.packingQty.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[11px] font-sans text-slate-400">Not set</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {rec.balanceToPack !== null ? (
                        <span
                          className={`font-semibold ${
                            rec.balanceToPack < 0
                              ? 'text-red-700'
                              : rec.balanceToPack === 0
                                ? 'text-emerald-700'
                                : 'text-slate-800'
                          }`}
                        >
                          {rec.balanceToPack.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {renderPackingStatusBadge(rec.packingStatus)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {renderEndDateCell(rec.endDateIso)}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                      {formatDisplayDate(rec.triggerDateIso)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {renderEstimatedOutputStartCell(rec)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${
                          rec.orderStatus === 'Order Closed'
                            ? 'bg-slate-100 border-slate-200 text-slate-600'
                            : 'bg-teal-50 border-teal-200 text-teal-800'
                        }`}
                      >
                        {rec.orderStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 min-w-[200px]">
                      <ActionMessageDisplay
                        actionMessage={rec.actionMessage}
                        riskTier={rec.riskTier}
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <RiskStatusDisplay riskStatus={rec.riskStatus} riskTier={rec.riskTier} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
