import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  ORDER_STATUS_OPTIONS,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  EvaluatedPlanningRecord,
  FactoryName,
  OrderStatus,
} from '../shared/plannerTypes.ts';

interface DailyCuttingEntryViewProps {
  allRecords: EvaluatedPlanningRecord[];
  filteredRecords: EvaluatedPlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  onAddCuttingEntry: (entry: Omit<DailyCuttingEntry, 'id'>) => void;
  onDeleteCuttingEntry: (entryId: string) => void;
  onUpdateRecord: (
    id: string,
    patch: Partial<{
      plannedQty: number | null;
      foIssueQty: number | null;
      dailyTargetQty: number | null;
      endDateIso: string | null;
      orderStatus: OrderStatus;
    }>
  ) => void;
}

export function DailyCuttingEntryView({
  allRecords,
  filteredRecords,
  cuttingEntries,
  referenceDateIso,
  onAddCuttingEntry,
  onDeleteCuttingEntry,
  onUpdateRecord,
}: DailyCuttingEntryViewProps) {
  const [entryDateIso, setEntryDateIso] = useState(referenceDateIso);
  const [formFactory, setFormFactory] = useState<FactoryName>('ALEX 5');
  const [formLine, setFormLine] = useState<string>('Line 51');
  const [qtyInput, setQtyInput] = useState('');
  const [remarksInput, setRemarksInput] = useState('');
  const [batchQty, setBatchQty] = useState<Record<string, string>>({});

  const factoryLines = useMemo(() => {
    const lines = new Set<string>();
    for (const r of allRecords) {
      if (r.factory === formFactory) lines.add(r.line);
    }
    return Array.from(lines);
  }, [allRecords, formFactory]);

  const effectiveLine = factoryLines.includes(formLine) ? formLine : (factoryLines[0] ?? '');

  const lineStyles = useMemo(() => {
    return allRecords
      .filter((r) => r.factory === formFactory && r.line === effectiveLine)
      .sort((a, b) => a.slot - b.slot);
  }, [allRecords, formFactory, effectiveLine]);

  const activeRunning =
    lineStyles.find((r) => r.lifecycleStage === 'Running') ?? lineStyles[0] ?? null;
  const nextStyle =
    lineStyles.find((r) => r.lifecycleStage === 'Upcoming (Next)') ?? null;

  const [selectedRecordOverride, setSelectedRecordOverride] = useState<string>('');
  const targetRecord =
    lineStyles.find((r) => r.id === selectedRecordOverride) ?? activeRunning;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRecord) return;
    const qty = Number(qtyInput);
    if (!Number.isFinite(qty) || qty <= 0) return;

    onAddCuttingEntry({
      dateIso: entryDateIso,
      recordId: targetRecord.id,
      factory: targetRecord.factory,
      line: targetRecord.line,
      pgNumber: targetRecord.pgNumber,
      style: targetRecord.style,
      cuttingQty: Math.round(qty),
      remarks: remarksInput.trim(),
    });
    setQtyInput('');
    setRemarksInput('');
  };

  const runningLinesInScope = useMemo(() => {
    return filteredRecords.filter((r) => r.lifecycleStage === 'Running');
  }, [filteredRecords]);

  return (
    <div className="space-y-6">
      {/* Top Form: Daily Cutting Entry */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Daily-Wise Cutting Qty Data Entry
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Entries recorded here auto-sum into Cutting Finished Qty in Fabric Order Tracker. Set Order Status to &ldquo;Order Closed&rdquo; when a PG completes.
            </p>
          </div>
          {targetRecord && (
            <div className="flex items-center gap-2">
              <label htmlFor="form-order-status" className="text-xs font-medium text-slate-600">
                Order Status:
              </label>
              <select
                id="form-order-status"
                value={targetRecord.orderStatus}
                onChange={(e) =>
                  onUpdateRecord(targetRecord.id, {
                    orderStatus: e.target.value as OrderStatus,
                  })
                }
                className={`h-9 px-3 rounded-lg border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${
                  targetRecord.orderStatus === 'Order Closed'
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
            </div>
          )}
        </div>

        <form onSubmit={handleFormSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="cut-date" className="text-xs font-medium text-slate-600">
              Cutting Date
            </label>
            <input
              id="cut-date"
              type="date"
              value={entryDateIso}
              onChange={(e) => setEntryDateIso(e.target.value)}
              required
              className="h-10 px-3 rounded-lg border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="cut-factory" className="text-xs font-medium text-slate-600">
              Factory
            </label>
            <select
              id="cut-factory"
              value={formFactory}
              onChange={(e) => {
                setFormFactory(e.target.value as FactoryName);
                setSelectedRecordOverride('');
              }}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {ALLOWED_FACTORIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="cut-line" className="text-xs font-medium text-slate-600">
              Line
            </label>
            <select
              id="cut-line"
              value={effectiveLine}
              onChange={(e) => {
                setFormLine(e.target.value);
                setSelectedRecordOverride('');
              }}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {factoryLines.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 lg:col-span-2">
            <label htmlFor="cut-style" className="text-xs font-medium text-slate-600">
              Style (Defaults to Active Running Style)
            </label>
            <select
              id="cut-style"
              value={targetRecord?.id ?? ''}
              onChange={(e) => setSelectedRecordOverride(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {lineStyles.map((st) => (
                <option key={st.id} value={st.id}>
                  [{st.lifecycleStage}] {st.pgNumber !== '—' ? `${st.pgNumber} · ` : ''}
                  {st.style}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="cut-qty" className="text-xs font-medium text-slate-600">
              Today&apos;s Cutting Qty
            </label>
            <input
              id="cut-qty"
              type="number"
              min={1}
              required
              placeholder="e.g. 2500"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 font-mono tabular-nums text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-5 flex flex-col gap-1">
            <label htmlFor="cut-remarks" className="text-xs font-medium text-slate-600">
              Remarks / Shift Note (Optional)
            </label>
            <input
              id="cut-remarks"
              type="text"
              placeholder="e.g. Shift A + B completed, fabric lot 42"
              value={remarksInput}
              onChange={(e) => setRemarksInput(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={!targetRecord}
              className="w-full h-10 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Save Cutting Entry</span>
            </button>
          </div>
        </form>

        {/* Live Context Bar */}
        {targetRecord && (
          <div className="pt-3 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 text-xs">
            <div>
              <div className="text-slate-500">PG # / Stage</div>
              <div className="font-mono font-semibold text-slate-900 mt-0.5">
                {targetRecord.pgNumber} · {targetRecord.lifecycleStage}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Order Qty</div>
              <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                {targetRecord.plannedQty !== null
                  ? targetRecord.plannedQty.toLocaleString()
                  : 'Pending'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Cutting Finished Total</div>
              <div className="font-mono tabular-nums font-semibold text-teal-700 mt-0.5">
                {targetRecord.cuttingFinishedQty.toLocaleString()} pcs
              </div>
            </div>
            <div>
              <div className="text-slate-500">Daily Target Qty</div>
              <div className="font-mono tabular-nums font-semibold text-slate-900 mt-0.5">
                {targetRecord.dailyTargetQty !== null
                  ? `${targetRecord.dailyTargetQty.toLocaleString()} /day`
                  : 'Not set'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Cutting Days Left</div>
              <div
                className={`font-mono tabular-nums font-semibold mt-0.5 ${
                  targetRecord.isCuttingWithin10Days ? 'text-red-700' : 'text-slate-900'
                }`}
              >
                {targetRecord.cuttingDaysRemaining !== null
                  ? `${targetRecord.cuttingDaysRemaining} days`
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Next Order on Line</div>
              <div className="font-medium text-slate-800 truncate mt-0.5" title={nextStyle?.style}>
                {nextStyle ? `${nextStyle.pgNumber} · ${nextStyle.style}` : 'End of queue'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Line-Wise Daily Cutting & Order Status Sheet */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Active Running Lines — Quick Daily Entry &amp; Order Status ({runningLinesInScope.length} Lines)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Update Order Qty, Daily Target, End Date, log daily cutting, or change Order Status to &ldquo;Order Closed&rdquo; to immediately move to the next style.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3 whitespace-nowrap">Factory · Line</th>
                <th className="py-2.5 px-3 whitespace-nowrap">PG #</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Running Style</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Order Qty</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Daily Target</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Cut Finished</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Days Left</th>
                <th className="py-2.5 px-3 whitespace-nowrap">End Date (Edit)</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Add Cutting ({entryDateIso.slice(5)})</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Order Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {runningLinesInScope.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No active running lines match the current filter.
                  </td>
                </tr>
              ) : (
                runningLinesInScope.map((rec) => {
                  const val = batchQty[rec.id] ?? '';
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 whitespace-nowrap font-semibold text-slate-900">
                        {rec.factory} · {rec.line}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono font-semibold text-blue-700">
                        {rec.pgNumber}
                      </td>
                      <td className="py-2.5 px-3 min-w-[200px] max-w-[250px] truncate font-medium text-slate-900" title={rec.style}>
                        {rec.style}
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
                          className="w-20 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-teal-700 whitespace-nowrap">
                        {rec.cuttingFinishedQty.toLocaleString()}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                          rec.isCuttingWithin10Days
                            ? 'text-red-700 font-bold'
                            : 'text-slate-700'
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
                          className="h-8 px-2 font-mono text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            placeholder="Qty"
                            value={val}
                            onChange={(e) =>
                              setBatchQty((prev) => ({ ...prev, [rec.id]: e.target.value }))
                            }
                            className="w-20 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const n = Number(val);
                              if (!Number.isFinite(n) || n <= 0) return;
                              onAddCuttingEntry({
                                dateIso: entryDateIso,
                                recordId: rec.id,
                                factory: rec.factory,
                                line: rec.line,
                                pgNumber: rec.pgNumber,
                                style: rec.style,
                                cuttingQty: Math.round(n),
                                remarks: 'Quick sheet entry',
                              });
                              setBatchQty((prev) => ({ ...prev, [rec.id]: '' }));
                            }}
                            className="h-8 px-2.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
                          >
                            + Add
                          </button>
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
                          className="h-8 px-2 text-xs font-medium rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                        >
                          {ORDER_STATUS_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cutting Log History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Daily Cutting Entry History ({cuttingEntries.length} Records)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              All logged daily cutting records feeding into Fabric Order Tracker.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3.5">Date</th>
                <th className="py-2.5 px-3.5">Factory · Line</th>
                <th className="py-2.5 px-3.5">PG #</th>
                <th className="py-2.5 px-3.5">Style</th>
                <th className="py-2.5 px-3.5 text-right">Cutting Qty</th>
                <th className="py-2.5 px-3.5">Remarks</th>
                <th className="py-2.5 px-3.5 text-center">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {cuttingEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No daily cutting entries logged yet. Use the form or quick-entry sheet above to log daily cutting qty.
                  </td>
                </tr>
              ) : (
                cuttingEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap text-slate-700">
                      {formatDisplayDate(entry.dateIso)}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap font-semibold text-slate-900">
                      {entry.factory} · {entry.line}
                    </td>
                    <td className="py-2.5 px-3.5 font-mono font-semibold text-blue-700 whitespace-nowrap">
                      {entry.pgNumber}
                    </td>
                    <td className="py-2.5 px-3.5 max-w-[260px] truncate text-slate-800">
                      {entry.style}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-semibold text-teal-700">
                      +{entry.cuttingQty.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-500">{entry.remarks || '—'}</td>
                    <td className="py-2.5 px-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => onDeleteCuttingEntry(entry.id)}
                        aria-label={`Delete cutting entry ${entry.id}`}
                        className="p-1.5 rounded text-slate-400 hover:text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
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
