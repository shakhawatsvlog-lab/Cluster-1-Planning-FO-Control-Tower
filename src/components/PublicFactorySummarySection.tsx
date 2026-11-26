import {
  AlertTriangle,
  Boxes,
  CalendarRange,
  ClipboardList,
  Layers,
  PackageCheck,
} from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type {
  FactoryName,
  MasterPlanMeta,
  PublicMasterPlanRecord,
  PublicMasterPlanResponse,
} from '../shared/plannerTypes.ts';

interface PublicFactorySummarySectionProps {
  selectedFactory: FactoryName;
  meta: MasterPlanMeta | null;
  referenceDateIso: string;
  factoryRecords: PublicMasterPlanRecord[];
  filteredRecords: PublicMasterPlanRecord[];
  cuttingSheetSummary?: PublicMasterPlanResponse['cuttingSheetSummary'];
  isFiltered: boolean;
  isSwitching: boolean;
}

export function PublicFactorySummarySection({
  selectedFactory,
  meta,
  referenceDateIso,
  factoryRecords,
  filteredRecords,
  cuttingSheetSummary,
  isFiltered,
  isSwitching,
}: PublicFactorySummarySectionProps) {
  const sourceRecords = isFiltered ? filteredRecords : factoryRecords;

  const lineCapacityMap = new Map<string, number>();
  for (const rec of sourceRecords) {
    if (!lineCapacityMap.has(rec.line)) {
      lineCapacityMap.set(rec.line, rec.capacityMc || 0);
    }
  }
  const activeLinesCount = lineCapacityMap.size;
  const totalCapacityMc = Array.from(lineCapacityMap.values()).reduce((sum, c) => sum + c, 0);

  const totalOrdersCount = sourceRecords.length;
  const openCount = sourceRecords.filter((r) => r.orderStatus !== 'Order Closed').length;
  const closedCount = sourceRecords.filter((r) => r.orderStatus === 'Order Closed').length;

  const runningCount = sourceRecords.filter((r) => r.lifecycleStage === 'Running').length;
  const nextUpCount = sourceRecords.filter((r) => r.lifecycleStage === 'Upcoming (Next)').length;
  const queuedCount = sourceRecords.filter((r) => r.lifecycleStage === 'Queued').length;

  const qtyRecords = sourceRecords.filter(
    (r) => r.plannedQty !== null && r.plannedQty !== undefined && !Number.isNaN(r.plannedQty)
  );
  const totalPlannedQty = qtyRecords.reduce((sum, r) => sum + (r.plannedQty || 0), 0);

  const endDates = sourceRecords
    .map((r) => r.endDateIso)
    .filter((d): d is string => Boolean(d))
    .sort();
  const minEndDateIso = endDates[0] ?? null;
  const maxEndDateIso = endDates.length > 0 ? endDates[endDates.length - 1] : null;

  // Scoped Cutting, Output & Packing Summary
  const cuttingInputRecords = sourceRecords.filter(
    (r) => r.cuttingInputQty !== null && r.cuttingInputQty !== undefined
  );
  const totalCuttingInputQty = cuttingInputRecords.reduce(
    (sum, r) => sum + (r.cuttingInputQty || 0),
    0
  );
  const totalCuttingOutputQty = sourceRecords.reduce(
    (sum, r) => sum + (r.cuttingOutputQty || 0),
    0
  );

  const outputEnteredRecords = sourceRecords.filter(
    (r) => r.outputQty !== null && r.outputQty !== undefined
  );
  const totalOutputQty = sourceRecords.reduce((sum, r) => sum + (r.outputQty || 0), 0);
  const hasAnyOutputBalanceScope = totalCuttingOutputQty > 0 || outputEnteredRecords.length > 0;
  const totalBalanceToOutput = totalCuttingOutputQty - totalOutputQty;
  const rawOutputPct =
    totalCuttingOutputQty > 0
      ? Math.round((totalOutputQty / totalCuttingOutputQty) * 100)
      : 0;
  const clampedOutputBarPct = Math.min(100, Math.max(0, rawOutputPct));
  const overOutputCount = sourceRecords.filter((r) => r.outputStatus === 'Over Output').length;

  const packingEnteredRecords = sourceRecords.filter(
    (r) => r.packingQty !== null && r.packingQty !== undefined
  );
  const totalPackingQty = sourceRecords.reduce((sum, r) => sum + (r.packingQty || 0), 0);
  const hasAnyBalanceScope = totalCuttingOutputQty > 0 || packingEnteredRecords.length > 0;
  const totalBalanceToPack = totalCuttingOutputQty - totalPackingQty;
  const rawPackPct =
    totalCuttingOutputQty > 0
      ? Math.round((totalPackingQty / totalCuttingOutputQty) * 100)
      : 0;
  const clampedPackBarPct = Math.min(100, Math.max(0, rawPackPct));

  const notStartedPackCount = sourceRecords.filter((r) => r.packingStatus === 'Not Started').length;
  const inProgressPackCount = sourceRecords.filter((r) => r.packingStatus === 'In Progress').length;
  const completedPackCount = sourceRecords.filter((r) => r.packingStatus === 'Completed').length;
  const overPackedCount = sourceRecords.filter((r) => r.packingStatus === 'Over Packed').length;

  return (
    <section
      aria-label={`${selectedFactory} Master Plan Summary`}
      className={`space-y-3.5 transition-opacity duration-200 ${
        isSwitching ? 'opacity-65' : 'opacity-100'
      }`}
    >
      {/* Selected Factory Identity Banner */}
      <div className="ct-exec-banner rounded-2xl px-4 sm:px-6 py-4 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-cyan-200/90">
            <span className="font-medium">Selected Factory Master Plan</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {activeLinesCount} Production {activeLinesCount === 1 ? 'Line' : 'Lines'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{totalCapacityMc.toLocaleString()} Mc</span>
          </div>
          <h3 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white mt-1 truncate">
            {selectedFactory} Production Schedule
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-cyan-100/85 shrink-0">
          {meta?.asOfDateRaw && (
            <div className="whitespace-nowrap">
              <span className="text-cyan-200/70">Plan As Of: </span>
              <span className="font-mono tabular-nums font-medium text-white">
                {meta.asOfDateRaw}
              </span>
            </div>
          )}
          <div className="whitespace-nowrap">
            <span className="text-cyan-200/70">Ref Date: </span>
            <span className="font-mono tabular-nums font-medium text-white">
              {formatDisplayDate(referenceDateIso)}
            </span>
          </div>
          {isFiltered && (
            <div className="whitespace-nowrap text-teal-200 font-medium font-mono tabular-nums">
              Filtered: {filteredRecords.length} / {factoryRecords.length}
            </div>
          )}
        </div>
      </div>

      {/* Four Real-Data Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Total Orders / Planned Slots */}
        <div className="ct-surface rounded-xl p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Total Planned Orders</span>
            <ClipboardList className="w-4 h-4 text-cyan-700 shrink-0" />
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-950">
            {totalOrdersCount.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums truncate">
            {openCount} Open · {closedCount} Closed
          </div>
        </div>

        {/* 2. Planned Quantity */}
        <div className="ct-surface rounded-xl p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Planned Quantity</span>
            <PackageCheck className="w-4 h-4 text-teal-700 shrink-0" />
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-950">
            {qtyRecords.length > 0 ? `${totalPlannedQty.toLocaleString()} pcs` : '—'}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums truncate">
            {qtyRecords.length > 0
              ? `${qtyRecords.length} of ${totalOrdersCount} slots entered`
              : `${totalOrdersCount} slots pending qty entry`}
          </div>
        </div>

        {/* 3. Production Status */}
        <div className="ct-surface rounded-xl p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Production Status</span>
            <Layers className="w-4 h-4 text-cyan-700 shrink-0" />
          </div>
          <div className="font-mono tabular-nums text-2xl font-bold text-slate-950">
            {runningCount > 0 ? `${runningCount} Running` : `${openCount} Open`}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums truncate">
            {nextUpCount} Next Up · {queuedCount} Queued · {closedCount} Closed
          </div>
        </div>

        {/* 4. Planning Date Range */}
        <div className="ct-surface rounded-xl p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Planning Date Range</span>
            <CalendarRange className="w-4 h-4 text-teal-700 shrink-0" />
          </div>
          <div className="font-mono tabular-nums text-base sm:text-lg font-bold text-slate-950 leading-tight py-1">
            {minEndDateIso && maxEndDateIso
              ? `${formatDisplayDate(minEndDateIso)} – ${formatDisplayDate(maxEndDateIso)}`
              : '—'}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums truncate">
            {endDates.length > 0
              ? `${endDates.length} dated ${endDates.length === 1 ? 'order' : 'orders'}`
              : 'No order end dates set'}
          </div>
        </div>
      </div>

      {/* Cutting, Output & Packing Progress Panel */}
      <div className="ct-surface rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#0a1633] to-cyan-700 text-white flex items-center justify-center shrink-0">
              <Boxes className="w-4 h-4" />
            </span>
            <div>
              <h4 className="font-display text-sm font-semibold text-slate-950">
                Cutting, Output &amp; Packing Progress — {selectedFactory}
              </h4>
              <p className="text-[11px] text-slate-500">
                Live Cutting, Output &amp; Packing synced from linked online sheets
                {cuttingSheetSummary && !cuttingSheetSummary.hasCuttingInputColumn
                  ? ' · Cutting Input column not present in sheet'
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono tabular-nums">
              Completed: {completedPackCount}
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-50 border border-cyan-200 text-cyan-800 font-mono tabular-nums">
              In Progress: {inProgressPackCount}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono tabular-nums">
              Not Started: {notStartedPackCount}
            </span>
            {overOutputCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 border border-red-300 text-red-700 font-mono tabular-nums">
                <AlertTriangle className="w-3 h-3" />
                Over Output: {overOutputCount}
              </span>
            )}
            {overPackedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-50 border border-red-300 text-red-700 font-mono tabular-nums">
                <AlertTriangle className="w-3 h-3" />
                Over Packed: {overPackedCount}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Cutting Input Qty</div>
            <div className="font-mono tabular-nums text-base font-bold text-slate-900 mt-0.5">
              {cuttingInputRecords.length > 0 ? `${totalCuttingInputQty.toLocaleString()} pcs` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">
              {cuttingInputRecords.length > 0
                ? `${cuttingInputRecords.length} rows synced`
                : 'Not in cutting sheet'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Cutting Output Qty</div>
            <div className="font-mono tabular-nums text-base font-bold text-slate-950 mt-0.5">
              {totalCuttingOutputQty.toLocaleString()} pcs
            </div>
            <div className="text-[10px] text-slate-400">
              {totalCuttingOutputQty > 0 ? 'Live cutting total' : 'Awaiting cutting sync'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Output Qty</div>
            <div className="font-mono tabular-nums text-base font-bold text-emerald-700 mt-0.5">
              {outputEnteredRecords.length > 0 || totalOutputQty > 0
                ? `${totalOutputQty.toLocaleString()} pcs`
                : '—'}
            </div>
            <div className="text-[10px] text-slate-400">
              {outputEnteredRecords.length > 0
                ? `${outputEnteredRecords.length} of ${totalOrdersCount} slots synced`
                : 'Awaiting output sheet sync'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Balance to Output</div>
            <div
              className={`font-mono tabular-nums text-base font-bold mt-0.5 ${
                hasAnyOutputBalanceScope && totalBalanceToOutput < 0
                  ? 'text-red-700'
                  : hasAnyOutputBalanceScope && totalBalanceToOutput === 0
                    ? 'text-emerald-700'
                    : 'text-slate-900'
              }`}
            >
              {hasAnyOutputBalanceScope ? `${totalBalanceToOutput.toLocaleString()} pcs` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">Cutting Output − Output Qty</div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Packing Qty</div>
            <div className="font-mono tabular-nums text-base font-bold text-teal-800 mt-0.5">
              {packingEnteredRecords.length > 0 || totalPackingQty > 0
                ? `${totalPackingQty.toLocaleString()} pcs`
                : '—'}
            </div>
            <div className="text-[10px] text-slate-400">
              {packingEnteredRecords.length > 0
                ? `${packingEnteredRecords.length} of ${totalOrdersCount} slots synced`
                : 'Awaiting packing sheet sync'}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Balance to Pack</div>
            <div
              className={`font-mono tabular-nums text-base font-bold mt-0.5 ${
                hasAnyBalanceScope && totalBalanceToPack < 0
                  ? 'text-red-700'
                  : hasAnyBalanceScope && totalBalanceToPack === 0
                    ? 'text-emerald-700'
                    : 'text-slate-900'
              }`}
            >
              {hasAnyBalanceScope ? `${totalBalanceToPack.toLocaleString()} pcs` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">Cutting Output − Packing</div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5 space-y-1.5 flex flex-col justify-center">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-500">Output Rate</span>
              <span
                className={`font-mono tabular-nums font-bold ${
                  rawOutputPct > 100
                    ? 'text-red-700'
                    : rawOutputPct === 100 && totalCuttingOutputQty > 0
                      ? 'text-emerald-700'
                      : 'text-teal-800'
                }`}
              >
                {totalCuttingOutputQty > 0 ? `${rawOutputPct}%` : '0%'}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  rawOutputPct > 100
                    ? 'bg-red-600'
                    : rawOutputPct === 100 && totalCuttingOutputQty > 0
                      ? 'bg-emerald-600'
                      : 'bg-gradient-to-r from-teal-600 to-emerald-500'
                }`}
                style={{ width: `${clampedOutputBarPct}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3.5 py-2.5 space-y-1.5 flex flex-col justify-center">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-medium text-slate-500">Packing Rate</span>
              <span
                className={`font-mono tabular-nums font-bold ${
                  rawPackPct > 100
                    ? 'text-red-700'
                    : rawPackPct === 100 && totalCuttingOutputQty > 0
                      ? 'text-emerald-700'
                      : 'text-cyan-800'
                }`}
              >
                {totalCuttingOutputQty > 0 ? `${rawPackPct}%` : '0%'}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  rawPackPct > 100
                    ? 'bg-red-600'
                    : rawPackPct === 100 && totalCuttingOutputQty > 0
                      ? 'bg-emerald-600'
                      : 'bg-gradient-to-r from-cyan-600 to-teal-500'
                }`}
                style={{ width: `${clampedPackBarPct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
