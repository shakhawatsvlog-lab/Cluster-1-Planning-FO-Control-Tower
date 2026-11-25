import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarRange,
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { ALLOWED_FACTORIES, formatDisplayDate } from '../shared/plannerTypes.ts';
import type { FactoryName } from '../shared/plannerTypes.ts';

export type StageFilter = 'ALL' | 'CURRENT_ONLY' | 'QUEUED_ONLY';

export type DateRangeField =
  | 'endDateIso'
  | 'triggerDateIso'
  | 'newStyleOutputStartIso'
  | 'estimatedCuttingFinishIso';

export interface DateRangeFilterValue {
  field: DateRangeField;
  fromIso: string;
  toIso: string;
}

export interface DateFilterableRecord {
  endDateIso: string | null;
  triggerDateIso: string | null;
  newStyleOutputStartIso: string | null;
  estimatedCuttingFinishIso: string | null;
}

export const DATE_RANGE_FIELD_OPTIONS: Array<{
  value: DateRangeField;
  label: string;
}> = [
  { value: 'endDateIso', label: 'Order End Date' },
  { value: 'triggerDateIso', label: 'Input Start / Trigger Date' },
  { value: 'newStyleOutputStartIso', label: 'Output Start Date (End + 1D)' },
  { value: 'estimatedCuttingFinishIso', label: 'Est. Cutting Finish Date' },
];

export function getRecordDateForRangeFilter(
  rec: DateFilterableRecord,
  field: DateRangeField
): string | null {
  switch (field) {
    case 'triggerDateIso':
      return rec.triggerDateIso;
    case 'newStyleOutputStartIso':
      return rec.newStyleOutputStartIso;
    case 'estimatedCuttingFinishIso':
      return rec.estimatedCuttingFinishIso;
    case 'endDateIso':
    default:
      return rec.endDateIso;
  }
}

export function isRecordInDateRange(
  rec: DateFilterableRecord,
  dateRange: DateRangeFilterValue
): boolean {
  const { field, fromIso, toIso } = dateRange;
  if (!fromIso && !toIso) return true;
  const targetIso = getRecordDateForRangeFilter(rec, field);
  if (!targetIso) return false;
  if (fromIso && targetIso < fromIso) return false;
  if (toIso && targetIso > toIso) return false;
  return true;
}

interface FilterToolbarProps {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  selectedFactory: FactoryName | 'ALL';
  onFactoryChange: (factory: FactoryName | 'ALL') => void;
  selectedLine: string;
  onLineChange: (line: string) => void;
  availableLines: string[];
  stageFilter: StageFilter;
  onStageFilterChange: (stage: StageFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  referenceDateIso: string;
  onReferenceDateChange?: (iso: string) => void;
  dateRangeFilter: DateRangeFilterValue;
  onApplyDateRange: (next: DateRangeFilterValue) => void;
  onClearDateRange: () => void;
  matchedRecordCount: number;
  totalRecordCount: number;
  onUploadPlanFile?: (file: File) => void;
  hasCustomEdits?: boolean;
  onResetEdits?: () => void;
  readOnlyPublic?: boolean;
}

export function FilterToolbar({
  isExpanded,
  onToggleExpanded,
  selectedFactory,
  onFactoryChange,
  selectedLine,
  onLineChange,
  availableLines,
  stageFilter,
  onStageFilterChange,
  searchQuery,
  onSearchChange,
  referenceDateIso,
  onReferenceDateChange,
  dateRangeFilter,
  onApplyDateRange,
  onClearDateRange,
  matchedRecordCount,
  totalRecordCount,
  onUploadPlanFile,
  hasCustomEdits = false,
  onResetEdits,
  readOnlyPublic = false,
}: FilterToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [draftField, setDraftField] = useState<DateRangeField>(dateRangeFilter.field);
  const [draftFromIso, setDraftFromIso] = useState<string>(dateRangeFilter.fromIso);
  const [draftToIso, setDraftToIso] = useState<string>(dateRangeFilter.toIso);
  const [dateValidationError, setDateValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraftField(dateRangeFilter.field);
    setDraftFromIso(dateRangeFilter.fromIso);
    setDraftToIso(dateRangeFilter.toIso);
  }, [dateRangeFilter.field, dateRangeFilter.fromIso, dateRangeFilter.toIso]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadPlanFile) return;
    onUploadPlanFile(file);
    e.target.value = '';
  };

  const handleApplyDateFilter = () => {
    setDateValidationError(null);
    if (!draftFromIso && !draftToIso) {
      if (dateRangeFilter.fromIso || dateRangeFilter.toIso) {
        onClearDateRange();
        return;
      }
      setDateValidationError('Please select a From Date or To Date before applying.');
      return;
    }
    if (draftFromIso && draftToIso && draftFromIso > draftToIso) {
      setDateValidationError('From Date cannot be later than To Date.');
      return;
    }
    onApplyDateRange({
      field: draftField,
      fromIso: draftFromIso,
      toIso: draftToIso,
    });
  };

  const handleClearDateFilter = () => {
    setDateValidationError(null);
    setDraftFromIso('');
    setDraftToIso('');
    onClearDateRange();
  };

  const dateRangeActive = Boolean(dateRangeFilter.fromIso || dateRangeFilter.toIso);
  const activeFieldLabel =
    DATE_RANGE_FIELD_OPTIONS.find((opt) => opt.value === dateRangeFilter.field)?.label ??
    'Order End Date';
  const activeRangeText = dateRangeActive
    ? `${dateRangeFilter.fromIso ? formatDisplayDate(dateRangeFilter.fromIso) : 'Any'} → ${
        dateRangeFilter.toIso ? formatDisplayDate(dateRangeFilter.toIso) : 'Any'
      }`
    : null;

  return (
    <div className="ct-surface rounded-2xl overflow-hidden">
      {/* Compact Collapsible Filter Header */}
      <div className="px-3.5 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/75">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
            <span>Planning Filters</span>
          </span>

          <span className="hidden sm:inline text-slate-300" aria-hidden="true">
            |
          </span>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
            <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-medium text-slate-700">
              {selectedFactory === 'ALL' ? 'All Factories (4)' : selectedFactory}
            </span>
            <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-medium text-slate-700">
              {selectedLine === 'ALL' ? `All Lines (${availableLines.length})` : selectedLine}
            </span>
            {stageFilter !== 'ALL' && (
              <span className="px-2 py-0.5 rounded bg-cyan-50 border border-cyan-200 font-medium text-cyan-900">
                {stageFilter === 'CURRENT_ONLY' ? 'Current Style (Slot 1)' : 'Queued Only'}
              </span>
            )}
            <span className="hidden md:inline-flex px-2 py-0.5 rounded bg-white border border-slate-200 font-mono text-slate-700">
              Ref: {formatDisplayDate(referenceDateIso)}
            </span>
            {dateRangeActive && activeRangeText && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 border border-teal-200 font-medium text-teal-900">
                <CalendarRange className="w-3 h-3 shrink-0" />
                <span>
                  {activeFieldLabel}: {activeRangeText}
                </span>
              </span>
            )}
            {searchQuery.trim() && (
              <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 font-medium text-amber-800 truncate max-w-[160px]">
                Search: &ldquo;{searchQuery.trim()}&rdquo;
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          aria-controls="planning-filter-panel-body"
          title={isExpanded ? 'Collapse filter options' : 'Expand filter options'}
          className="h-8 px-2.5 rounded-lg border border-slate-300 bg-white hover:border-cyan-500/50 hover:bg-cyan-50/40 text-slate-700 hover:text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
        >
          <span>{isExpanded ? 'Hide Filters' : 'Filters'}</span>
          <ChevronDown
            className={`w-4 h-4 text-cyan-700 transition-transform duration-300 ${
              isExpanded ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </button>
      </div>

      {/* Date Range Empty / Active Summary Feedback (visible even if collapsed) */}
      {dateRangeActive && (
        <div
          className={`px-3.5 sm:px-4 py-2 border-t text-xs flex flex-wrap items-center justify-between gap-2 ${
            matchedRecordCount === 0
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-cyan-50/70 border-cyan-100 text-cyan-950'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {matchedRecordCount === 0 ? (
              <>
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>No records found for selected date range</span>
                <span className="text-[11px] font-normal text-amber-800">
                  ({activeFieldLabel}: {activeRangeText})
                </span>
              </>
            ) : (
              <>
                <CalendarRange className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                <span>
                  Showing <span className="font-mono font-bold">{matchedRecordCount}</span> of{' '}
                  <span className="font-mono">{totalRecordCount}</span> planning slots matching{' '}
                  <strong>{activeFieldLabel}</strong> ({activeRangeText})
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={handleClearDateFilter}
            className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>Clear Date Filter</span>
          </button>
        </div>
      )}

      {/* Smooth Expand / Collapse Body */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div id="planning-filter-panel-body" aria-hidden={!isExpanded} className="overflow-hidden">
          <div className="p-4 border-t border-slate-200 space-y-3.5 bg-white">
            {/* Existing Planning Filters (100% Preserved) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end gap-3">
              {/* Factory Dropdown */}
              <div className="flex flex-col gap-1 lg:min-w-[150px]">
                <label
                  htmlFor="factory-filter"
                  className="text-xs font-medium text-slate-600"
                >
                  Factory
                </label>
                <select
                  id="factory-filter"
                  value={selectedFactory}
                  onChange={(e) => onFactoryChange(e.target.value as FactoryName | 'ALL')}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                >
                  <option value="ALL">All Factories (4)</option>
                  {ALLOWED_FACTORIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              {/* Cascaded Line Dropdown */}
              <div className="flex flex-col gap-1 lg:min-w-[160px]">
                <label htmlFor="line-filter" className="text-xs font-medium text-slate-600">
                  Production Line
                </label>
                <select
                  id="line-filter"
                  value={selectedLine}
                  onChange={(e) => onLineChange(e.target.value)}
                  className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                >
                  <option value="ALL">All Lines ({availableLines.length})</option>
                  {availableLines.map((line) => (
                    <option key={line} value={line}>
                      {line}
                    </option>
                  ))}
                </select>
              </div>

              {/* Plan Stage Segmented Filter */}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Plan Scope</span>
                <div className="flex items-center p-1 bg-slate-100 rounded-lg h-10 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => onStageFilterChange('ALL')}
                    className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      stageFilter === 'ALL'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All Planned Slots
                  </button>
                  <button
                    type="button"
                    onClick={() => onStageFilterChange('CURRENT_ONLY')}
                    className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      stageFilter === 'CURRENT_ONLY'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Current Style (Slot 1)
                  </button>
                </div>
              </div>

              {/* Reference Date (Admin Control Tower only) */}
              {!readOnlyPublic && onReferenceDateChange && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="ref-date" className="text-xs font-medium text-slate-600">
                    Trigger Ref Date
                  </label>
                  <input
                    id="ref-date"
                    type="date"
                    value={referenceDateIso}
                    onChange={(e) => {
                      if (e.target.value) onReferenceDateChange(e.target.value);
                    }}
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  />
                </div>
              )}

              {/* Search Input */}
              <div className="flex flex-col gap-1 sm:col-span-2 lg:flex-1 lg:min-w-[200px]">
                <label htmlFor="plan-search" className="text-xs font-medium text-slate-600">
                  {readOnlyPublic ? 'Search Style / PG#' : 'Search Style / PG# / FO'}
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="plan-search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={
                      readOnlyPublic
                        ? 'Filter PG#, style, or line...'
                        : 'Filter PG#, style, line, or FO#...'
                    }
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  />
                </div>
              </div>

              {/* Upload CSV / XLSX & Reset (Admin Control Tower only) */}
              {!readOnlyPublic && onUploadPlanFile && (
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Plan (.csv/.xlsx)</span>
                  </button>
                  {hasCustomEdits && onResetEdits && (
                    <button
                      type="button"
                      onClick={onResetEdits}
                      className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Plan</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* New Date Range Filter Section */}
            <div className="pt-3 border-t border-slate-200/80">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end gap-3">
                {/* Date Field Selector */}
                <div className="flex flex-col gap-1 lg:min-w-[210px]">
                  <label
                    htmlFor="date-range-field"
                    className="text-xs font-medium text-slate-600 inline-flex items-center gap-1"
                  >
                    <CalendarRange className="w-3.5 h-3.5 text-slate-500" />
                    <span>Date Field</span>
                  </label>
                  <select
                    id="date-range-field"
                    value={draftField}
                    onChange={(e) => {
                      setDraftField(e.target.value as DateRangeField);
                      setDateValidationError(null);
                    }}
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  >
                    {DATE_RANGE_FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* From Date */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="date-range-from" className="text-xs font-medium text-slate-600">
                    From Date
                  </label>
                  <input
                    id="date-range-from"
                    type="date"
                    value={draftFromIso}
                    onChange={(e) => {
                      setDraftFromIso(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  />
                </div>

                {/* To Date */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="date-range-to" className="text-xs font-medium text-slate-600">
                    To Date
                  </label>
                  <input
                    id="date-range-to"
                    type="date"
                    value={draftToIso}
                    onChange={(e) => {
                      setDraftToIso(e.target.value);
                      setDateValidationError(null);
                    }}
                    className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
                  <button
                    type="button"
                    onClick={handleApplyDateFilter}
                    className="h-10 px-4 rounded-lg bg-gradient-to-r from-cyan-700 to-teal-700 hover:from-cyan-800 hover:to-teal-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <CalendarRange className="w-3.5 h-3.5" />
                    <span>Apply Filter</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearDateFilter}
                    disabled={!draftFromIso && !draftToIso && !dateRangeActive}
                    className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Date Filter</span>
                  </button>
                </div>
              </div>

              {dateValidationError && (
                <p
                  role="alert"
                  className="mt-2 text-xs font-medium text-red-700 flex items-center gap-1.5"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{dateValidationError}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
