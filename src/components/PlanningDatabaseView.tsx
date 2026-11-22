import { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ORDER_STATUS_OPTIONS, formatDisplayDate } from '../shared/plannerTypes.ts';
import type { EvaluatedPlanningRecord, OrderStatus } from '../shared/plannerTypes.ts';
import { ActionMessageDisplay, RiskStatusDisplay } from './StatusCell.tsx';

type SortKey = 'default' | 'endDate' | 'triggerDate' | 'capacity';
type ViewMode = 'line_grouped' | 'flat_table';

interface PlanningDatabaseViewProps {
  records: EvaluatedPlanningRecord[];
  onUpdateRecord: (
    id: string,
    patch: Partial<{
      plannedQty: number | null;
      endDateIso: string | null;
      orderStatus: OrderStatus;
    }>
  ) => void;
  onSetRunningStyle: (recordId: string) => void;
}

export function PlanningDatabaseView({
  records,
  onUpdateRecord,
  onSetRunningStyle,
}: PlanningDatabaseViewProps) {
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
    const map = new Map<string, EvaluatedPlanningRecord[]>();
    for (const rec of records) {
      const key = `${rec.factory}::${rec.line}`;
      if (!map.has(key)) {
        order.push(key);
        map.set(key, []);
      }
      map.get(key)!.push(rec);
    }
    return order.map((k) => {
      const list = [...map.get(k)!].sort((a, b) => a.slot - b.slot);
      return {
        key: k,
        factory: list[0].factory,
        zone: list[0].zone,
        line: list[0].line,
        capacityMc: list[0].capacityMc,
        productCategory: list[0].productCategory,
        items: list,
      };
    });
  }, [records]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'capacity' ? 'desc' : 'asc');
    }
  };

  const renderLifecycleLabel = (rec: EvaluatedPlanningRecord) => {
    if (rec.lifecycleStage === 'Running') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-600 text-white font-mono text-[11px] font-semibold whitespace-nowrap">
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
      <div className="flex items-center gap-2 whitespace-nowrap">
        <span
          className={`font-mono text-xs whitespace-nowrap ${
            rec.lifecycleStage === 'Upcoming (Next)'
              ? 'font-semibold text-teal-700'
              : 'text-slate-500'
          }`}
        >
          S{rec.slot} · {rec.lifecycleStage === 'Upcoming (Next)' ? 'Next Up' : 'Queued'}
        </span>
        <button
          type="button"
          onClick={() => onSetRunningStyle(rec.id)}
          className="px-2 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 text-[11px] font-semibold cursor-pointer"
        >
          Set Running
        </button>
      </div>
    );
  };

  const renderOrderStatusSelect = (rec: EvaluatedPlanningRecord) => (
    <select
      value={rec.orderStatus}
      onChange={(e) =>
        onUpdateRecord(rec.id, { orderStatus: e.target.value as OrderStatus })
      }
      aria-label={`Order status for ${rec.factory} ${rec.line} ${rec.style}`}
      className={`h-8 px-2 text-xs font-medium rounded border focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${
        rec.orderStatus === 'Order Closed'
          ? 'bg-slate-100 border-slate-300 text-slate-700'
          : 'bg-white border-slate-300 text-slate-900'
      }`}
    >
      {ORDER_STATUS_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Master Planning Database — Line-Wise ({lineGroups.length} Lines · {records.length} Allocations)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Set Order Status to &ldquo;Order Closed&rdquo; when a PG finishes to automatically close it everywhere and promote the next style as Running.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('line_grouped')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'line_grouped'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Line-Wise Grouped
            </button>
            <button
              type="button"
              onClick={() => setViewMode('flat_table')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                viewMode === 'flat_table'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Flat Table
            </button>
          </div>

          {viewMode === 'flat_table' && (
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setSortKey('default')}
                className={`px-2.5 py-1.5 rounded-md border text-xs font-medium cursor-pointer ${
                  sortKey === 'default'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Line Sequence
              </button>
              <button
                type="button"
                onClick={() => toggleSort('triggerDate')}
                className={`px-2.5 py-1.5 rounded-md border text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                  sortKey === 'triggerDate'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span>Trigger</span>
                <ArrowUpDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort('endDate')}
                className={`px-2.5 py-1.5 rounded-md border text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                  sortKey === 'endDate'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span>End Date</span>
                <ArrowUpDown className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {records.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-12 text-center text-sm text-slate-500">
          No records match the current Factory, Line, or Search filters.
        </div>
      ) : viewMode === 'line_grouped' ? (
        <div className="space-y-4">
          {lineGroups.map((group) => (
            <div
              key={group.key}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <span>{group.factory}</span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span>{group.line}</span>
                  <span className="text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-slate-700">
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
                  {group.items.length} planned slots
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-medium text-slate-500">
                      <th className="py-2 px-3.5 whitespace-nowrap">Lifecycle</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">PG #</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">Style</th>
                      <th className="py-2 px-3.5 text-right whitespace-nowrap">Order / Planned Qty</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">End Date (Editable)</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">Trigger (End-10D)</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">Order Status</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">Action Required</th>
                      <th className="py-2 px-3.5 whitespace-nowrap">Risk Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {group.items.map((rec) => (
                      <tr
                        key={rec.id}
                        className={`transition-colors ${
                          rec.orderStatus === 'Order Closed'
                            ? 'bg-slate-50/80 opacity-75'
                            : rec.lifecycleStage === 'Running'
                              ? 'bg-blue-50/25 hover:bg-blue-50/40'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderLifecycleLabel(rec)}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {rec.pgNumber}
                        </td>
                        <td className="py-2.5 px-3.5 min-w-[220px] max-w-[300px]">
                          <div className="font-medium text-slate-900 leading-snug">
                            {rec.style}
                          </div>
                          {rec.styleQtyHint !== null && (
                            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                              <span className="font-mono tabular-nums">
                                Ref: {rec.styleQtyHint.toLocaleString()} pcs
                              </span>
                              {rec.plannedQty === null && rec.orderStatus !== 'Order Closed' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onUpdateRecord(rec.id, { plannedQty: rec.styleQtyHint })
                                  }
                                  className="text-blue-700 hover:underline font-medium cursor-pointer"
                                >
                                  Apply
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                          <input
                            type="number"
                            min={0}
                            placeholder="Blank"
                            value={rec.plannedQty === null ? '' : rec.plannedQty}
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              onUpdateRecord(rec.id, {
                                plannedQty: raw === '' ? null : Number(raw),
                              });
                            }}
                            className={`w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                              rec.plannedQty === null && rec.orderStatus !== 'Order Closed'
                                ? 'bg-amber-50/70 border-amber-300 placeholder:text-amber-700/70'
                                : 'bg-white border-slate-300 text-slate-900'
                            }`}
                          />
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <input
                            type="date"
                            value={rec.endDateIso ?? ''}
                            onChange={(e) =>
                              onUpdateRecord(rec.id, {
                                endDateIso: e.target.value || null,
                              })
                            }
                            className="h-8 px-2 font-mono text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </td>
                        <td className="py-2.5 px-3.5 font-mono tabular-nums font-medium whitespace-nowrap text-slate-900">
                          {formatDisplayDate(rec.triggerDateIso)}
                        </td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          {renderOrderStatusSelect(rec)}
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-3 whitespace-nowrap">Factory · Line</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Mc</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Lifecycle</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">PG #</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Style</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Order Qty</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">End Date</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Trigger Date</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Order Status</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Action Required</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Risk Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {sortedRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap font-semibold text-slate-900">
                      {rec.factory} · {rec.line}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {rec.capacityMc}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{renderLifecycleLabel(rec)}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {rec.pgNumber}
                    </td>
                    <td className="py-2.5 px-3 min-w-[200px] max-w-[260px]">
                      <div className="font-medium text-slate-900 truncate" title={rec.style}>
                        {rec.style}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        placeholder="Blank"
                        value={rec.plannedQty === null ? '' : rec.plannedQty}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onUpdateRecord(rec.id, {
                            plannedQty: raw === '' ? null : Number(raw),
                          });
                        }}
                        className="w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <input
                        type="date"
                        value={rec.endDateIso ?? ''}
                        onChange={(e) =>
                          onUpdateRecord(rec.id, {
                            endDateIso: e.target.value || null,
                          })
                        }
                        className="h-8 px-2 font-mono text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums font-medium whitespace-nowrap text-slate-900">
                      {formatDisplayDate(rec.triggerDateIso)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {renderOrderStatusSelect(rec)}
                    </td>
                    <td className="py-2.5 px-3 min-w-[200px]">
                      <ActionMessageDisplay
                        actionMessage={rec.actionMessage}
                        riskTier={rec.riskTier}
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
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
      )}
    </div>
  );
}
