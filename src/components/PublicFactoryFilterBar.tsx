import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarRange,
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type { FactoryName } from '../shared/plannerTypes.ts';
import {
  DATE_RANGE_FIELD_OPTIONS,
  type DateRangeField,
  type DateRangeFilterValue,
} from './FilterToolbar.tsx';

export type PublicProductionStatusFilter =
  | 'ALL'
  | 'Running'
  | 'Upcoming (Next)'
  | 'Queued'
  | 'OPEN_ONLY'
  | 'Order Closed';

export const PRODUCTION_STATUS_OPTIONS: Array<{
  value: PublicProductionStatusFilter;
  label: string;
}> = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'Running', label: 'Running' },
  { value: 'Upcoming (Next)', label: 'Upcoming (Next Up)' },
  { value: 'Queued', label: 'Queued' },
  { value: 'OPEN_ONLY', label: 'Open Orders Only' },
  { value: 'Order Closed', label: 'Order Closed' },
];

interface PublicFactoryFilterBarProps {
  selectedFactory: FactoryName;
  selectedLine: string;
  onLineChange: (line: string) => void;
  availableLines: string[];
  statusFilter: PublicProductionStatusFilter;
  onStatusFilterChange: (status: PublicProductionStatusFilter) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  dateRangeFilter: DateRangeFilterValue;
  onApplyDateRange: (next: DateRangeFilterValue) => void;
  onClearDateRange: () => void;
  onResetAllFilters: () => void;
  matchedCount: number;
  totalFactoryCount: number;
}

export function PublicFactoryFilterBar({
  selectedFactory,
  selectedLine,
  onLineChange,
  availableLines,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  dateRangeFilter,
  onApplyDateRange,
  onClearDateRange,
  onResetAllFilters,
  matchedCount,
  totalFactoryCount,
}: PublicFactoryFilterBarProps) {
  const [isDateFilterExpanded, setIsDateFilterExpanded] = useState(false);
  const [draftField, setDraftField] = useState<DateRangeField>(dateRangeFilter.field);
  const [draftFromIso, setDraftFromIso] = useState<string>(dateRangeFilter.fromIso);
  const [draftToIso, setDraftToIso] = useState<string>(dateRangeFilter.toIso);
  const [dateValidationError, setDateValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraftField(dateRangeFilter.field);
    setDraftFromIso(dateRangeFilter.fromIso);
    setDraftToIso(dateRangeFilter.toIso);
  }, [dateRangeFilter.field, dateRangeFilter.fromIso, dateRangeFilter.toIso]);

  const dateRangeActive = Boolean(dateRangeFilter.fromIso || dateRangeFilter.toIso);
  const hasAnyFilter =
    selectedLine !== 'ALL' ||
    statusFilter !== 'ALL' ||
    searchQuery.trim().length > 0 ||
    dateRangeActive;

  const activeFieldLabel =
    DATE_RANGE_FIELD_OPTIONS.find((opt) => opt.value === dateRangeFilter.field)?.label ??
    'Order End Date';

  const activeRangeText = dateRangeActive
    ? `${dateRangeFilter.fromIso ? formatDisplayDate(dateRangeFilter.fromIso) : 'Any'} – ${
        dateRangeFilter.toIso ? formatDisplayDate(dateRangeFilter.toIso) : 'Any'
      }`
    : null;

  const handleApplyDateFilter = () => {
    setDateValidationError(null);
    if (!draftFromIso && !draftToIso) {
      if (dateRangeActive) {
        onClearDateRange();
        return;
      }
      setDateValidationError('Select a From Date or To Date before applying.');
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

  return (
    <section
      aria-label={`${selectedFactory} Filters and Search`}
      className="ct-surface rounded-2xl overflow-hidden"
    >
      {/* Top Bar Header */}
      <div className="px-4 sm:px-5 py-3 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 min-w-0">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
            <span>{selectedFactory} Filter & Search</span>
          </span>
          <span className="text-slate-300" aria-hidden="true">
            ·
          </span>
          <span className="font-mono tabular-nums text-slate-600">
            Showing {matchedCount} of {totalFactoryCount} slots
          </span>
          {dateRangeActive && activeRangeText && (
            <>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="text-teal-800 font-medium">
                {activeFieldLabel}: {activeRangeText}
              </span>
            </>
          )}
        </div>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={() => {
              setDateValidationError(null);
              onResetAllFilters();
            }}
            className="h-8 px-3 rounded-lg border border-slate-300 bg-white hover:border-cyan-500/60 hover:text-slate-950 text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset All Filters</span>
          </button>
        )}
      </div>

      {/* Filter Controls Body */}
      <div className="p-4 sm:p-5 space-y-3.5 bg-white/75">
        {/* Row 1: Search, Line, Production Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
          {/* Search Input */}
          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-5">
            <label htmlFor="mp-search" className="text-xs font-medium text-slate-600">
              Search PG #, Style, or Line
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="mp-search"
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={`Search ${selectedFactory} PG#, style, category, or line...`}
                className="w-full h-10 pl-9 pr-9 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="Clear search query"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Production Line Dropdown */}
          <div className="flex flex-col gap-1 lg:col-span-3">
            <label htmlFor="mp-line-filter" className="text-xs font-medium text-slate-600">
              Production Line
            </label>
            <select
              id="mp-line-filter"
              value={selectedLine}
              onChange={(e) => onLineChange(e.target.value)}
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600 cursor-pointer"
            >
              <option value="ALL">All Lines ({availableLines.length})</option>
              {availableLines.map((line) => (
                <option key={line} value={line}>
                  {line}
                </option>
              ))}
            </select>
          </div>

          {/* Production Status Dropdown */}
          <div className="flex flex-col gap-1 lg:col-span-4">
            <label htmlFor="mp-status-filter" className="text-xs font-medium text-slate-600">
              Production Status
            </label>
            <select
              id="mp-status-filter"
              value={statusFilter}
              onChange={(e) =>
                onStatusFilterChange(e.target.value as PublicProductionStatusFilter)
              }
              className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600 cursor-pointer"
            >
              {PRODUCTION_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Collapsible Inclusive Date Range Filter (collapsed by default) */}
        <div className="pt-3 border-t border-slate-200/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsDateFilterExpanded((prev) => !prev)}
              aria-expanded={isDateFilterExpanded}
              aria-controls="mp-date-filter-body"
              title={isDateFilterExpanded ? 'Collapse Date Filter' : 'Expand Date Filter'}
              className="group inline-flex items-center gap-2 py-1 px-2 -ml-2 rounded-lg text-xs font-semibold text-slate-800 hover:text-slate-950 hover:bg-slate-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 transition-colors cursor-pointer"
            >
              <CalendarRange className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
              <span>Date Filter</span>
              <ChevronDown
                className={`w-4 h-4 text-cyan-700 transition-transform duration-300 ease-in-out ${
                  isDateFilterExpanded ? 'rotate-180' : 'rotate-0'
                }`}
                aria-hidden="true"
              />
            </button>

            {!isDateFilterExpanded && dateRangeActive && activeRangeText && (
              <span className="text-[11px] font-medium text-teal-800 bg-teal-50/90 border border-teal-200/80 px-2 py-0.5 rounded-md">
                {activeFieldLabel}: {activeRangeText}
              </span>
            )}
          </div>

          <div
            className={`grid transition-[grid-template-rows,opacity,visibility] duration-300 ease-in-out ${
              isDateFilterExpanded
                ? 'grid-rows-[1fr] opacity-100 visible'
                : 'grid-rows-[0fr] opacity-0 invisible pointer-events-none'
            }`}
          >
            <div
              id="mp-date-filter-body"
              aria-hidden={!isDateFilterExpanded}
              className="overflow-hidden"
            >
              <div className="pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 lg:items-end gap-3">
                  <div className="flex flex-col gap-1 lg:col-span-3">
                    <label
                      htmlFor="mp-date-field"
                      className="text-xs font-medium text-slate-600 inline-flex items-center gap-1"
                    >
                      <CalendarRange className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                      <span>Date Field</span>
                    </label>
                    <select
                      id="mp-date-field"
                      value={draftField}
                      onChange={(e) => {
                        setDraftField(e.target.value as DateRangeField);
                        setDateValidationError(null);
                      }}
                      className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600 cursor-pointer"
                    >
                      {DATE_RANGE_FIELD_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1 lg:col-span-3">
                    <label htmlFor="mp-date-from" className="text-xs font-medium text-slate-600">
                      From Date
                    </label>
                    <input
                      id="mp-date-from"
                      type="date"
                      value={draftFromIso}
                      onChange={(e) => {
                        setDraftFromIso(e.target.value);
                        setDateValidationError(null);
                      }}
                      className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                    />
                  </div>

                  <div className="flex flex-col gap-1 lg:col-span-3">
                    <label htmlFor="mp-date-to" className="text-xs font-medium text-slate-600">
                      To Date
                    </label>
                    <input
                      id="mp-date-to"
                      type="date"
                      value={draftToIso}
                      onChange={(e) => {
                        setDraftToIso(e.target.value);
                        setDateValidationError(null);
                      }}
                      className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
                    <button
                      type="button"
                      onClick={handleApplyDateFilter}
                      className="h-10 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] via-cyan-800 to-teal-700 hover:from-[#0f224d] hover:to-teal-600 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer flex-1 sm:flex-initial"
                    >
                      <CalendarRange className="w-3.5 h-3.5" />
                      <span>Apply Filter</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearDateFilter}
                      disabled={!draftFromIso && !draftToIso && !dateRangeActive}
                      className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed text-slate-700 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear Dates</span>
                    </button>
                  </div>
                </div>

                {dateValidationError && (
                  <p
                    role="alert"
                    className="mt-2.5 text-xs font-medium text-red-700 flex items-center gap-1.5"
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
    </section>
  );
}
