import { useRef } from 'react';
import { RotateCcw, Search, Upload } from 'lucide-react';
import { ALLOWED_FACTORIES } from '../shared/plannerTypes.ts';
import type { FactoryName } from '../shared/plannerTypes.ts';

export type StageFilter = 'ALL' | 'CURRENT_ONLY' | 'QUEUED_ONLY';

interface FilterToolbarProps {
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
  onReferenceDateChange: (iso: string) => void;
  onUploadCsv: (csvText: string, fileName: string) => void;
  hasCustomEdits: boolean;
  onResetEdits: () => void;
}

export function FilterToolbar({
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
  onUploadCsv,
  hasCustomEdits,
  onResetEdits,
}: FilterToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUploadCsv(reader.result, file.name);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Factory Dropdown */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label
            htmlFor="factory-filter"
            className="text-xs font-medium text-slate-500"
          >
            Factory Dropdown
          </label>
          <select
            id="factory-filter"
            value={selectedFactory}
            onChange={(e) => onFactoryChange(e.target.value as FactoryName | 'ALL')}
            className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
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
        <div className="flex flex-col gap-1 min-w-[165px]">
          <label htmlFor="line-filter" className="text-xs font-medium text-slate-500">
            Line Dropdown
          </label>
          <select
            id="line-filter"
            value={selectedLine}
            onChange={(e) => onLineChange(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
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
          <span className="text-xs font-medium text-slate-500">Plan Scope</span>
          <div className="flex items-center p-1 bg-slate-100 rounded-lg h-10">
            <button
              type="button"
              onClick={() => onStageFilterChange('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                stageFilter === 'CURRENT_ONLY'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Current Style (Slot 1)
            </button>
          </div>
        </div>

        {/* Reference Date */}
        <div className="flex flex-col gap-1">
          <label htmlFor="ref-date" className="text-xs font-medium text-slate-500">
            Trigger Ref Date
          </label>
          <input
            id="ref-date"
            type="date"
            value={referenceDateIso}
            onChange={(e) => {
              if (e.target.value) onReferenceDateChange(e.target.value);
            }}
            className="h-10 px-3 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        {/* Search Input */}
        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label htmlFor="plan-search" className="text-xs font-medium text-slate-500">
            Search Style / Buyer / FO
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="plan-search"
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter style, buyer, line, or FO#..."
              className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>

        {/* Upload CSV & Reset */}
        <div className="flex items-end gap-2 self-end">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload CSV</span>
          </button>
          {hasCustomEdits && (
            <button
              type="button"
              onClick={onResetEdits}
              className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Plan</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
