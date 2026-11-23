import { useMemo, useState } from 'react';
import {
  FO_STATUS_OPTIONS,
  ORDER_STATUS_OPTIONS,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type {
  EvaluatedPlanningRecord,
  FoStatus,
  OrderStatus,
} from '../shared/plannerTypes.ts';
import { ActionMessageDisplay, RiskStatusDisplay } from './StatusCell.tsx';

type ActionSubFilter =
  | 'all'
  | 'qty_pending'
  | 'cutting_10d'
  | 'urgent_trigger'
  | 'open_capacity'
  | 'date_review';

interface ActionListsViewProps {
  mode: 'fo' | 'action';
  records: EvaluatedPlanningRecord[];
  dateRangeActive?: boolean;
  onUpdateRecord: (
    id: string,
    patch: Partial<{
      plannedQty: number | null;
      endDateIso: string | null;
      orderStatus: OrderStatus;
      foStatus: FoStatus;
    }>
  ) => void;
}

export function ActionListsView({
  mode,
  records,
  dateRangeActive = false,
  onUpdateRecord,
}: ActionListsViewProps) {
  const [subFilter, setSubFilter] = useState<ActionSubFilter>('all');

  const listRecords = useMemo(() => {
    const activeOnly = records.filter((r) => r.orderStatus !== 'Order Closed');
    const base =
      mode === 'fo'
        ? activeOnly.filter((r) => r.foRequired)
        : activeOnly.filter(
            (r) =>
              r.actionRequired ||
              r.styleClassification === 'Open Capacity' ||
              r.isAnomalousPastDate
          );

    const filtered =
      mode === 'action'
        ? base.filter((r) => {
            if (subFilter === 'qty_pending') return r.plannedQty === null;
            if (subFilter === 'cutting_10d') return r.isCuttingWithin10Days;
            if (subFilter === 'urgent_trigger')
              return r.daysToTrigger !== null && r.daysToTrigger <= 14;
            if (subFilter === 'open_capacity')
              return r.styleClassification === 'Open Capacity';
            if (subFilter === 'date_review') return r.isAnomalousPastDate;
            return true;
          })
        : base;

    return [...filtered].sort((a, b) => {
      if (a.isCurrentStyle !== b.isCurrentStyle) return a.isCurrentStyle ? -1 : 1;
      return (a.triggerDateIso || '9999-12-31').localeCompare(
        b.triggerDateIso || '9999-12-31'
      );
    });
  }, [mode, records, subFilter]);

  const affectedMc = useMemo(() => {
    const lineCaps = new Map<string, number>();
    for (const r of listRecords) {
      const k = `${r.factory}::${r.line}`;
      if (!lineCaps.has(k)) lineCaps.set(k, r.capacityMc);
    }
    return Array.from(lineCaps.values()).reduce((a, b) => a + b, 0);
  }, [listRecords]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:px-5 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            {mode === 'fo'
              ? `FO Required List (${listRecords.length} Orders)`
              : `Action Required Escalation List (${listRecords.length} Items)`}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {mode === 'fo'
              ? 'All open lines/styles requiring Fabric Order confirmation. Orders marked "Order Closed" are automatically removed.'
              : 'Escalations for blank Order Qty ("FO NEED - TAKE ACTION AS PER PLAN"), Cutting <= 10D alerts, imminent triggers, and date anomalies. Closed orders are excluded.'}
          </p>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-700">
          Impacted Capacity:{' '}
          <span className="font-semibold text-slate-900">
            {affectedMc.toLocaleString()} Mc
          </span>
        </div>
      </div>

      {mode === 'action' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all' as const, label: 'All Action Items' },
            { id: 'qty_pending' as const, label: 'Plan Qty Pending' },
            { id: 'cutting_10d' as const, label: 'Cutting <= 10D' },
            { id: 'urgent_trigger' as const, label: 'Trigger <= 14 Days' },
            { id: 'open_capacity' as const, label: 'Open Capacity Slots' },
            { id: 'date_review' as const, label: 'Past / 2026 Date Check' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                subFilter === tab.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3 text-center whitespace-nowrap">#</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Factory · Line</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Stage · PG #</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Style</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Order Status</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Order Qty</th>
                <th className="py-2.5 px-3 whitespace-nowrap">End Date (Edit)</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Trigger Date</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Days</th>
                <th className="py-2.5 px-3 whitespace-nowrap">FO Status</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Action Required</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Risk Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {listRecords.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 text-center text-sm text-slate-500">
                    {dateRangeActive
                      ? 'No records found for selected date range'
                      : `No ${mode === 'fo' ? 'FO Required' : 'Action Required'} items match the current filters.`}
                  </td>
                </tr>
              ) : (
                listRecords.map((rec, idx) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">
                        {rec.factory} · {rec.line}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {rec.capacityMc} Mc
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div
                        className={
                          rec.lifecycleStage === 'Running'
                            ? 'font-semibold text-blue-700'
                            : 'text-slate-500'
                        }
                      >
                        {rec.lifecycleStage}
                      </div>
                      <div className="font-mono font-semibold text-slate-900">
                        {rec.pgNumber}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 min-w-[200px] max-w-[260px]">
                      <div className="font-medium text-slate-900 leading-snug">{rec.style}</div>
                      {rec.styleQtyHint !== null && (
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                          Ref: {rec.styleQtyHint.toLocaleString()} pcs
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <select
                        value={rec.orderStatus}
                        onChange={(e) =>
                          onUpdateRecord(rec.id, {
                            orderStatus: e.target.value as OrderStatus,
                          })
                        }
                        aria-label={`Order status for ${rec.line} ${rec.style}`}
                        className="h-8 px-2 text-xs font-medium rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                      >
                        {ORDER_STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
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
                        aria-label={`Order qty for ${rec.line} ${rec.style}`}
                        className={`w-22 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                          rec.plannedQty === null
                            ? 'bg-amber-50/70 border-amber-300 placeholder:text-amber-700/70'
                            : 'bg-white border-slate-300 text-slate-900'
                        }`}
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
                        aria-label={`End date for ${rec.line} ${rec.style}`}
                        className="h-8 px-2 font-mono text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums font-medium whitespace-nowrap text-slate-900">
                      {formatDisplayDate(rec.triggerDateIso)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        rec.daysToTrigger !== null && rec.daysToTrigger <= 0
                          ? 'text-red-700 font-semibold'
                          : rec.daysToTrigger !== null && rec.daysToTrigger <= 14
                            ? 'text-amber-700 font-semibold'
                            : 'text-slate-600'
                      }`}
                    >
                      {rec.daysToTrigger !== null ? `${rec.daysToTrigger}d` : '—'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <select
                        value={rec.foStatus}
                        onChange={(e) =>
                          onUpdateRecord(rec.id, { foStatus: e.target.value as FoStatus })
                        }
                        aria-label={`FO status for ${rec.line} ${rec.style}`}
                        className="h-8 px-2 text-xs font-medium rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {FO_STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3 min-w-[210px]">
                      <ActionMessageDisplay
                        actionMessage={rec.actionMessage}
                        riskTier={rec.riskTier}
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <RiskStatusDisplay riskStatus={rec.riskStatus} riskTier={rec.riskTier} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
