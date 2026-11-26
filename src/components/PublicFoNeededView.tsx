import { useMemo, useState } from 'react';
import { FileSpreadsheet, RefreshCw } from 'lucide-react';
import { formatDisplayDate } from '../shared/plannerTypes.ts';
import type { FactoryName, PublicFoNeededResponse } from '../shared/plannerTypes.ts';
import { apiUrl } from '../lib/apiBase.ts';

interface PublicFoNeededViewProps {
  data: PublicFoNeededResponse | null;
  loading: boolean;
  error: string | null;
  selectedFactory: FactoryName | null;
  onRetry: () => void;
}

function getFoStatusBadgeClass(status: 'Pending' | 'Under Process' | 'Completed'): string {
  if (status === 'Completed') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  }
  if (status === 'Under Process') {
    return 'bg-amber-50 text-amber-800 border-amber-200';
  }
  return 'bg-red-50 text-red-700 border-red-200';
}

export function PublicFoNeededView({
  data,
  loading,
  error,
  selectedFactory,
  onRetry,
}: PublicFoNeededViewProps) {
  const [scopeMode, setScopeMode] = useState<'ALL' | 'SELECTED_FACTORY'>('ALL');
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const visibleRows = useMemo(() => {
    const allRows = data?.rows ?? [];
    if (scopeMode === 'SELECTED_FACTORY' && selectedFactory) {
      return allRows.filter((row) => row.factory === selectedFactory);
    }
    return allRows;
  }, [data?.rows, scopeMode, selectedFactory]);

  const totals = useMemo(() => {
    let totalIssueQty = 0;
    const pgIssueMap = new Map<string, number>();

    for (const row of visibleRows) {
      if (row.issueQty !== null && Number.isFinite(row.issueQty)) {
        totalIssueQty += row.issueQty;
      }
      const pgKey = `${row.factory}::${
        row.pgNumber && row.pgNumber !== '—' ? row.pgNumber.toUpperCase() : row.recordId
      }`;
      const effQty = row.issueQty ?? 0;
      pgIssueMap.set(pgKey, Math.max(pgIssueMap.get(pgKey) ?? 0, effQty));
    }

    let uniquePgIssueQty = 0;
    for (const val of pgIssueMap.values()) {
      uniquePgIssueQty += val;
    }

    return {
      totalIssueQty,
      uniquePgIssueQty,
    };
  }, [visibleRows]);

  const handleDownloadExcel = async () => {
    setDownloadingXlsx(true);
    setDownloadError(null);
    try {
      const query =
        scopeMode === 'SELECTED_FACTORY' && selectedFactory
          ? `?factory=${encodeURIComponent(selectedFactory)}`
          : '';
      const response = await fetch(apiUrl(`/api/public/export-selected-fo-xlsx${query}`), {
        cache: 'no-store',
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Unable to export Excel (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const filenameMatch = /filename="?([^";\n]+)"?/i.exec(disposition);
      const filename =
        filenameMatch?.[1] ||
        `Alpine-Selected-FO-Needed-${data?.referenceDateIso || new Date().toISOString().slice(0, 10)}.xlsx`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Unable to download Excel report.'
      );
    } finally {
      setDownloadingXlsx(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="ct-surface rounded-2xl overflow-hidden animate-pulse">
        <div className="h-20 bg-slate-900/90" />
        <div className="p-6 space-y-3 bg-white">
          <div className="h-10 bg-slate-100 rounded-lg" />
          <div className="h-10 bg-slate-100 rounded-lg" />
          <div className="h-10 bg-slate-100 rounded-lg" />
          <div className="h-10 bg-slate-100 rounded-lg" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ct-surface border-red-200 rounded-2xl p-6 space-y-3">
        <div className="text-sm font-semibold text-red-800">
          Unable to load FO Needed Checklist
        </div>
        <p className="text-xs text-slate-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-gradient-to-r from-[#0a1633] to-teal-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  return (
    <section
      id="panel-fo-needed"
      role="tabpanel"
      aria-labelledby="tab-fo-needed"
      aria-label="Selected FO Needed Summary Checklist (Read-Only)"
      className="space-y-4"
    >
      {/* Optional Read-Only Scope Switcher preserving selectedFactory in parent state */}
      <div className="ct-surface rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-slate-600">
          Read-only view synchronized live with Control Tower&apos;s{' '}
          <span className="font-semibold text-slate-900">Selected FO Needed Checklist</span>.
        </div>

        {selectedFactory && (
          <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 border border-slate-200">
            <button
              type="button"
              onClick={() => setScopeMode('ALL')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                scopeMode === 'ALL'
                  ? 'bg-[#0a1633] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Factories ({data?.rows.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setScopeMode('SELECTED_FACTORY')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                scopeMode === 'SELECTED_FACTORY'
                  ? 'bg-[#0a1633] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {selectedFactory} Only
            </button>
          </div>
        )}
      </div>

      {/* Mirror of Control Tower #selected-fo-summary-box (Read-Only) */}
      <div
        id="public-selected-fo-summary-box"
        className="ct-surface !border-slate-300 rounded-2xl overflow-hidden shadow-md"
      >
        {/* Clean Executive Summary Box Header */}
        <div className="px-4 sm:px-6 py-3.5 bg-[#0F172A] text-white border-b border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <h2 className="font-display text-sm sm:text-base font-bold tracking-wide uppercase text-white">
              ALEX APPARELS — SELECTED FO NEEDED CHECKLIST (RUNNING + UPCOMING)
            </h2>

            <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Master Plan As Of:</span>
                  <span className="font-mono font-semibold text-white">
                    {data?.meta?.asOfDateRaw ||
                      (data?.meta?.asOfDateIso
                        ? formatDisplayDate(data.meta.asOfDateIso)
                        : '—')}
                  </span>
                </div>
                <span className="hidden sm:inline text-slate-600">|</span>
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Ref Date:</span>
                  <span className="font-mono font-semibold text-white">
                    {formatDisplayDate(data?.referenceDateIso ?? null)}
                  </span>
                </div>
                <span className="hidden sm:inline text-slate-600">|</span>
                <div className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded">
                  <span className="text-slate-300 font-medium">Selected Items Count:</span>
                  <span className="font-mono font-bold text-emerald-300 tabular-nums">
                    {visibleRows.length}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleDownloadExcel()}
                disabled={downloadingXlsx}
                title="Download Selected FO Needed Checklist as Excel (.xlsx)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-sm border border-emerald-500/80 transition-colors cursor-pointer shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>{downloadingXlsx ? 'Preparing Excel...' : 'Download Excel'}</span>
              </button>
            </div>
          </div>

          {downloadError && (
            <p className="mt-2 text-xs text-red-300 font-medium">{downloadError}</p>
          )}
        </div>

        {/* Compact Excel-Style Responsive Summary Table */}
        <div className="overflow-x-auto bg-white">
          <table className="w-full min-w-[780px] text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white border-b border-slate-700 text-[11px] uppercase tracking-wider">
                <th className="py-2.5 px-2.5 text-center font-semibold border-r border-slate-700/80 w-12">
                  SL
                </th>
                <th className="py-2.5 px-3 text-left font-semibold border-r border-slate-700/80 whitespace-nowrap">
                  Factory
                </th>
                <th className="py-2.5 px-3 text-left font-semibold border-r border-slate-700/80 whitespace-nowrap">
                  PG # (FO Needed)
                </th>
                <th className="py-2.5 px-3 text-left font-semibold border-r border-slate-700/80">
                  Style / Description
                </th>
                <th className="py-2.5 px-3 text-right font-semibold border-r border-slate-700/80 whitespace-nowrap">
                  Issue Qty (=Order Qty)
                </th>
                <th className="py-2.5 px-3 text-center font-semibold border-r border-slate-700/80 whitespace-nowrap">
                  Status (Running / Upcoming)
                </th>
                <th className="py-2.5 px-3 text-center font-semibold border-r border-slate-700/80 whitespace-nowrap">
                  FO Date Needed
                </th>
                <th className="py-2.5 px-3 text-center font-semibold whitespace-nowrap">
                  FO Status (Pending / Under Process / Completed)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {visibleRows.length === 0 ? (
                <tr className="bg-white">
                  <td
                    colSpan={8}
                    className="py-8 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                  >
                    {scopeMode === 'SELECTED_FACTORY' && selectedFactory && (data?.rows.length ?? 0) > 0
                      ? `No selected FO items for ${selectedFactory}. Switch to All Factories to view all selected items.`
                      : 'No FO items are currently selected in Control Tower.'}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row, idx) => {
                  const stageIsRunning = row.status === 'Running';
                  return (
                    <tr
                      key={`public-fo-row-${row.recordId}`}
                      className="bg-white hover:bg-slate-50/90 transition-colors"
                    >
                      <td className="py-2 px-2.5 text-center font-mono tabular-nums text-slate-600 border-r border-slate-200">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        <div>{row.factory}</div>
                        <div className="text-[10px] font-normal text-slate-500">{row.line}</div>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        {row.pgNumber}
                      </td>
                      <td
                        className="py-2 px-3 text-slate-800 border-r border-slate-200 max-w-[260px] truncate"
                        title={row.style}
                      >
                        {row.style}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        {row.issueQty !== null ? (
                          row.issueQty.toLocaleString()
                        ) : (
                          <span className="text-amber-700 font-normal">Pending</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-center border-r border-slate-200 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${
                            stageIsRunning
                              ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                              : 'bg-sky-50 text-sky-800 border-sky-200'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center font-mono tabular-nums text-slate-800 border-r border-slate-200 whitespace-nowrap">
                        {formatDisplayDate(row.foDateNeededIso)}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span
                          title={
                            row.isFullQtyReleased
                              ? 'Full Qty Released'
                              : `Current Status: ${row.rawFoStatus}`
                          }
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${getFoStatusBadgeClass(
                            row.foStatus
                          )}`}
                        >
                          {row.foStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2 border-slate-300 text-slate-900 font-bold">
                <td
                  colSpan={2}
                  className="py-2.5 px-3 text-left text-[11px] uppercase tracking-wider border-r border-slate-200"
                >
                  TOTAL
                </td>
                <td
                  colSpan={2}
                  className="py-2.5 px-3 text-left text-xs border-r border-slate-200 whitespace-nowrap"
                >
                  Total Items:{' '}
                  <span className="font-mono text-slate-900 tabular-nums">
                    {visibleRows.length}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 border-r border-slate-200 whitespace-nowrap">
                  <div>{totals.totalIssueQty.toLocaleString()} Pcs</div>
                  {totals.uniquePgIssueQty !== totals.totalIssueQty && (
                    <div className="text-[10px] font-normal text-slate-500">
                      PG Unique: {totals.uniquePgIssueQty.toLocaleString()} Pcs
                    </div>
                  )}
                </td>
                <td
                  colSpan={3}
                  className="py-2.5 px-3 text-right text-[11px] font-medium text-slate-600"
                >
                  Total Issue Qty:{' '}
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {totals.totalIssueQty.toLocaleString()} Pcs
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}
