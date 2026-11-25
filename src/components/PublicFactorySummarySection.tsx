import { CalendarRange, ClipboardList, Layers, PackageCheck } from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type {
  FactoryName,
  MasterPlanMeta,
  PublicMasterPlanRecord,
} from '../shared/plannerTypes.ts';

interface PublicFactorySummarySectionProps {
  selectedFactory: FactoryName;
  meta: MasterPlanMeta | null;
  referenceDateIso: string;
  factoryRecords: PublicMasterPlanRecord[];
  filteredRecords: PublicMasterPlanRecord[];
  isFiltered: boolean;
  isSwitching: boolean;
}

export function PublicFactorySummarySection({
  selectedFactory,
  meta,
  referenceDateIso,
  factoryRecords,
  filteredRecords,
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
    </section>
  );
}
