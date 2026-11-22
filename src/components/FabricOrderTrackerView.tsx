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

interface FabricOrderTrackerViewProps {
  records: EvaluatedPlanningRecord[];
  onUpdateRecord: (
    id: string,
    patch: Partial<{
      plannedQty: number | null;
      foIssueQty: number | null;
      dailyTargetQty: number | null;
      endDateIso: string | null;
      orderStatus: OrderStatus;
      foNumber: string;
      foDate: string;
      foStatus: FoStatus;
      fabricNote: string;
    }>
  ) => void;
  onSetRunningStyle: (recordId: string) => void;
}

export function FabricOrderTrackerView({
  records,
  onUpdateRecord,
  onSetRunningStyle,
}: FabricOrderTrackerViewProps) {
  const foNeededCount = records.filter((r) => r.foRequired).length;
  const pendingQtyCount = records.filter(
    (r) => r.plannedQty === null && r.orderStatus !== 'Order Closed'
  ).length;
  const cuttingAlertCount = records.filter(
    (r) => r.isCuttingWithin10Days && r.orderStatus !== 'Order Closed'
  ).length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Fabric Order Tracker ({records.length} Line-Wise Allocations)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cutting Finished Qty auto-syncs from Daily Cutting Entry ·{' '}
            <span className="font-mono font-semibold text-amber-700">{pendingQtyCount}</span>{' '}
            Order Qty Pending ·{' '}
            <span className="font-mono font-semibold text-red-700">{cuttingAlertCount}</span>{' '}
            Cutting &le; 10D ·{' '}
            <span className="font-mono font-semibold text-slate-900">{foNeededCount}</span> FO
            Required
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <th className="py-2.5 px-3 whitespace-nowrap">Factory · Line</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Stage · PG #</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Style</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Order Status</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">Order Qty</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">FO Issue Qty</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">Cutting Finished</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">Daily Target</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">Cut Left</th>
              <th className="py-2.5 px-3 whitespace-nowrap">End Date (Edit)</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Trigger (End-10D)</th>
              <th className="py-2.5 px-3 whitespace-nowrap">FO Number</th>
              <th className="py-2.5 px-3 whitespace-nowrap">FO Status</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Action Required</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Risk Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {records.length === 0 ? (
              <tr>
                <td colSpan={15} className="py-10 text-center text-sm text-slate-500">
                  No Fabric Order Tracker records match the active filter.
                </td>
              </tr>
            ) : (
              records.map((rec) => {
                const isClosed = rec.orderStatus === 'Order Closed';
                return (
                  <tr
                    key={rec.id}
                    className={`transition-colors ${
                      isClosed ? 'bg-slate-50/80 opacity-75' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">
                        {rec.factory} · {rec.line}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {rec.capacityMc} Mc
                      </div>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[11px] font-semibold ${
                            rec.lifecycleStage === 'Running'
                              ? 'text-blue-700'
                              : rec.lifecycleStage === 'Upcoming (Next)'
                                ? 'text-teal-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {rec.lifecycleStage}
                        </span>
                        {rec.lifecycleStage !== 'Running' && !isClosed && (
                          <button
                            type="button"
                            onClick={() => onSetRunningStyle(rec.id)}
                            className="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 text-[10px] font-semibold cursor-pointer"
                          >
                            Set Run
                          </button>
                        )}
                      </div>
                      <div className="font-mono font-semibold text-slate-900">
                        {rec.pgNumber}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 min-w-[190px] max-w-[240px]">
                      <div className="font-medium text-slate-900 leading-snug truncate" title={rec.style}>
                        {rec.style}
                      </div>
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
                        className={`h-8 px-2 text-xs font-medium rounded border focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${
                          isClosed
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
                          rec.plannedQty === null && !isClosed
                            ? 'bg-amber-50/70 border-amber-300 placeholder:text-amber-700/70'
                            : 'bg-white border-slate-300 text-slate-900'
                        }`}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={rec.foIssueQty === null ? '' : rec.foIssueQty}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onUpdateRecord(rec.id, {
                            foIssueQty: raw === '' ? null : Number(raw),
                          });
                        }}
                        aria-label={`FO issue qty for ${rec.line} ${rec.style}`}
                        className="w-22 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-teal-700 whitespace-nowrap">
                      {rec.cuttingFinishedQty.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <input
                        type="number"
                        min={0}
                        placeholder="Target/d"
                        value={rec.dailyTargetQty === null ? '' : rec.dailyTargetQty}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          onUpdateRecord(rec.id, {
                            dailyTargetQty: raw === '' ? null : Number(raw),
                          });
                        }}
                        aria-label={`Daily target qty for ${rec.line} ${rec.style}`}
                        className="w-20 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        rec.isCuttingWithin10Days
                          ? 'text-red-700 font-bold'
                          : 'text-slate-600'
                      }`}
                    >
                      {rec.cuttingDaysRemaining !== null
                        ? `${rec.cuttingDaysRemaining}d`
                        : '—'}
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
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <input
                        type="text"
                        placeholder="FO-XXXX"
                        value={rec.foNumber}
                        onChange={(e) =>
                          onUpdateRecord(rec.id, { foNumber: e.target.value })
                        }
                        aria-label={`FO number for ${rec.line} ${rec.style}`}
                        className="w-22 h-8 px-2 font-mono text-xs rounded border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
