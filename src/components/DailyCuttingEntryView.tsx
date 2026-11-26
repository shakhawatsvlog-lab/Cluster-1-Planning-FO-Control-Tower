import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  ORDER_STATUS_OPTIONS,
  computePackingSummary,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  EvaluatedPlanningRecord,
  FactoryName,
  OrderStatus,
} from '../shared/plannerTypes.ts';
import { CUTTING_SYNC_INTERVAL_OPTIONS } from '../shared/cuttingSheetTypes.ts';
import type {
  CuttingSheetSyncConfig,
  CuttingSheetSyncMode,
  FactorySheetUrlMap,
} from '../shared/cuttingSheetTypes.ts';

interface DailyCuttingEntryViewProps {
  allRecords: EvaluatedPlanningRecord[];
  filteredRecords: EvaluatedPlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  cuttingSheetSync: CuttingSheetSyncConfig;
  onSaveCuttingSheetConfig: (
    patch: Partial<
      Pick<
        CuttingSheetSyncConfig,
        'enabled' | 'sheetUrl' | 'factoryUrls' | 'syncMode' | 'intervalMinutes'
      >
    >
  ) => Promise<{ ok: boolean; error?: string }>;
  onSyncCuttingSheetNow: () => Promise<{ ok: boolean; message: string }>;
  onUploadCuttingFile: (
    file: File,
    factoryOverride?: FactoryName
  ) => Promise<{ ok: boolean; message: string }>;
  onAddCuttingEntry: (entry: Omit<DailyCuttingEntry, 'id'>) => void;
  onDeleteCuttingEntry: (entryId: string) => void;
  onUpdateRecord: (
    id: string,
    patch: Partial<{
      plannedQty: number | null;
      foIssueQty: number | null;
      dailyTargetQty: number | null;
      packingQty: number | null;
      packingUpdatedAtIso: string | null;
      endDateIso: string | null;
      orderStatus: OrderStatus;
    }>
  ) => void;
  onUpdatePackingQty?: (recordIds: string[], packingQty: number | null) => Promise<void> | void;
  onSetRunningStyle: (recordId: string) => void;
}

export function DailyCuttingEntryView({
  allRecords,
  filteredRecords,
  cuttingEntries,
  referenceDateIso,
  cuttingSheetSync,
  onSaveCuttingSheetConfig,
  onSyncCuttingSheetNow,
  onUploadCuttingFile,
  onAddCuttingEntry,
  onDeleteCuttingEntry,
  onUpdateRecord,
  onUpdatePackingQty,
  onSetRunningStyle,
}: DailyCuttingEntryViewProps) {
  // Online Cutting Sheet Sync draft state
  const [sheetEnabled, setSheetEnabled] = useState(cuttingSheetSync.enabled);
  const [sheetUrlInput, setSheetUrlInput] = useState(cuttingSheetSync.sheetUrl);
  const [factoryUrlsInput, setFactoryUrlsInput] = useState<FactorySheetUrlMap>(
    cuttingSheetSync.factoryUrls || {}
  );
  const [syncModeInput, setSyncModeInput] = useState<CuttingSheetSyncMode>(
    cuttingSheetSync.syncMode
  );
  const [intervalInput, setIntervalInput] = useState<number>(
    cuttingSheetSync.intervalMinutes || 60
  );
  const [showMainUrl, setShowMainUrl] = useState<boolean>(() =>
    Boolean(cuttingSheetSync.sheetUrl.trim())
  );
  const [showSyncLogs, setShowSyncLogs] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadFactoryOverride, setUploadFactoryOverride] = useState<FactoryName | 'AUTO'>('AUTO');
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const cuttingFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSheetEnabled(cuttingSheetSync.enabled);
    setSheetUrlInput(cuttingSheetSync.sheetUrl);
    setFactoryUrlsInput(cuttingSheetSync.factoryUrls || {});
    setSyncModeInput(cuttingSheetSync.syncMode);
    setIntervalInput(cuttingSheetSync.intervalMinutes || 60);
    if (cuttingSheetSync.sheetUrl.trim()) {
      setShowMainUrl(true);
    }
  }, [
    cuttingSheetSync.enabled,
    cuttingSheetSync.sheetUrl,
    cuttingSheetSync.factoryUrls,
    cuttingSheetSync.syncMode,
    cuttingSheetSync.intervalMinutes,
  ]);
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

  const hasAnyDraftUrl = useMemo(
    () =>
      Boolean(sheetUrlInput.trim()) ||
      ALLOWED_FACTORIES.some((fac) => Boolean((factoryUrlsInput[fac] || '').trim())),
    [sheetUrlInput, factoryUrlsInput]
  );

  const handleSaveSheetSetup = async (overrideEnabled?: boolean) => {
    setSavingConfig(true);
    setSyncNotice(null);
    const nextEnabled =
      overrideEnabled !== undefined
        ? overrideEnabled
        : hasAnyDraftUrl
          ? true
          : sheetEnabled;

    const res = await onSaveCuttingSheetConfig({
      enabled: nextEnabled,
      sheetUrl: sheetUrlInput.trim(),
      factoryUrls: factoryUrlsInput,
      syncMode: syncModeInput,
      intervalMinutes: intervalInput,
    });
    setSavingConfig(false);
    if (res.ok) {
      setSheetEnabled(nextEnabled);
      setSyncNotice({
        ok: true,
        text: nextEnabled
          ? 'All factory sheet links saved & daily/periodic Auto-Sync enabled.'
          : 'Online cutting sheet settings saved (Auto-Sync paused).',
      });
    } else {
      setSyncNotice({
        ok: false,
        text: res.error || 'Could not save online cutting sheet settings.',
      });
    }
    return res.ok;
  };

  const handleTriggerSyncNow = async () => {
    setSyncingNow(true);
    setSyncNotice(null);
    const desiredEnabled = hasAnyDraftUrl ? true : sheetEnabled;
    const hasDraftChanges =
      sheetUrlInput.trim() !== cuttingSheetSync.sheetUrl.trim() ||
      desiredEnabled !== cuttingSheetSync.enabled ||
      syncModeInput !== cuttingSheetSync.syncMode ||
      intervalInput !== cuttingSheetSync.intervalMinutes ||
      JSON.stringify(factoryUrlsInput) !== JSON.stringify(cuttingSheetSync.factoryUrls || {});

    if (hasDraftChanges) {
      const saved = await onSaveCuttingSheetConfig({
        enabled: desiredEnabled,
        sheetUrl: sheetUrlInput.trim(),
        factoryUrls: factoryUrlsInput,
        syncMode: syncModeInput,
        intervalMinutes: intervalInput,
      });
      if (!saved.ok) {
        setSyncingNow(false);
        setSyncNotice({
          ok: false,
          text: saved.error || 'Please save valid sheet settings first.',
        });
        return;
      }
      setSheetEnabled(desiredEnabled);
    }

    const res = await onSyncCuttingSheetNow();
    setSyncingNow(false);
    setSyncNotice({ ok: res.ok, text: res.message });
  };

  const handleDownloadSampleTemplate = () => {
    const sampleRows = ALLOWED_FACTORIES.map((fac, idx) => {
      const rec =
        allRecords.find(
          (r) =>
            r.factory === fac &&
            r.lifecycleStage === 'Running' &&
            r.pgNumber &&
            r.pgNumber !== '—'
        ) ||
        allRecords.find((r) => r.factory === fac && r.pgNumber && r.pgNumber !== '—');
      const pg = rec?.pgNumber || (idx === 2 ? 'PG-36280' : `PG-36${100 + idx}`);
      const line = rec?.line || `Line ${idx + 1}`;
      const style = (rec?.style || 'Sample Style').replace(/"/g, '""');
      const orderQty = rec?.plannedQty || 45000;
      const cutQty = rec?.cuttingFinishedQty || 12500;
      const targetQty = rec?.dailyTargetQty || 1500;
      return `${referenceDateIso},${fac},${line},${pg},"${style}",${orderQty},${cutQty},${targetQty},Latest Daily Update`;
    });
    const csvContent = [
      'Date,Factory,Line,PG#,Style,Order Qty,Total Cutting Qty,Daily Target,Remarks',
      ...sampleRows,
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Online_Cutting_Sheet_Template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleCuttingFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingFile(true);
    setSyncNotice(null);
    const res = await onUploadCuttingFile(
      file,
      uploadFactoryOverride === 'AUTO' ? undefined : uploadFactoryOverride
    );
    setUploadingFile(false);
    setSyncNotice({ ok: res.ok, text: res.message });
  };

  const sheetSyncedCount = useMemo(
    () => cuttingEntries.filter((e) => e.source === 'sheet').length,
    [cuttingEntries]
  );

  const perFactorySyncedStats = useMemo(() => {
    const map: Record<FactoryName, { count: number; qty: number }> = {
      'ALEX 1': { count: 0, qty: 0 },
      'ALEX 3': { count: 0, qty: 0 },
      'ALEX 5': { count: 0, qty: 0 },
      'ALEX 12': { count: 0, qty: 0 },
    };
    for (const entry of cuttingEntries) {
      if (entry.source !== 'sheet') continue;
      if (map[entry.factory]) {
        map[entry.factory].count += 1;
        map[entry.factory].qty += entry.cuttingQty;
      }
    }
    return map;
  }, [cuttingEntries]);

  const [pgScopeFilter, setPgScopeFilter] = useState<'synced_or_filled' | 'all'>('synced_or_filled');

  const pgSummaryRows = useMemo(() => {
    const entryMetaByPg = new Map<
      string,
      {
        latestDateIso: string;
        sheetQty: number;
        manualQty: number;
        hasSheet: boolean;
      }
    >();
    for (const e of cuttingEntries) {
      const pg = (e.pgNumber || '').trim().toUpperCase();
      if (!pg || pg === '—') continue;
      const key = `${e.factory}::${pg}`;
      const prev = entryMetaByPg.get(key) ?? {
        latestDateIso: '',
        sheetQty: 0,
        manualQty: 0,
        hasSheet: false,
      };
      if (!prev.latestDateIso || e.dateIso > prev.latestDateIso) {
        prev.latestDateIso = e.dateIso;
      }
      if (e.source === 'sheet') {
        prev.sheetQty = Math.max(prev.sheetQty, e.cuttingQty || 0);
        prev.hasSheet = true;
      } else {
        prev.manualQty += e.cuttingQty || 0;
      }
      entryMetaByPg.set(key, prev);
    }

    const pgMap = new Map<
      string,
      {
        key: string;
        factory: FactoryName;
        pgNumber: string;
        style: string;
        lines: string[];
        recordIds: string[];
        primaryRecordId: string;
        orderQty: number | null;
        dailyTargetQty: number | null;
        cuttingInputQty: number | null;
        cuttingFinishedQty: number;
        packingQty: number | null;
        latestDateIso: string;
        hasSheet: boolean;
        hasRunning: boolean;
        allClosed: boolean;
      }
    >();

    for (const rec of filteredRecords) {
      const pg = (rec.pgNumber || '').trim();
      if (!pg || pg === '—') continue;
      const key = `${rec.factory}::${pg.toUpperCase()}`;
      const entryMeta = entryMetaByPg.get(key);
      const existing = pgMap.get(key);
      if (!existing) {
        const sheetPlusManual = entryMeta
          ? entryMeta.sheetQty + entryMeta.manualQty
          : rec.cuttingFinishedQty;
        pgMap.set(key, {
          key,
          factory: rec.factory,
          pgNumber: pg,
          style: rec.style,
          lines: [rec.line],
          recordIds: [rec.id],
          primaryRecordId: rec.id,
          orderQty: rec.plannedQty,
          dailyTargetQty: rec.dailyTargetQty,
          cuttingInputQty: rec.cuttingInputQty,
          cuttingFinishedQty: Math.max(sheetPlusManual, rec.cuttingFinishedQty),
          packingQty: rec.packingQty,
          latestDateIso: entryMeta?.latestDateIso || '',
          hasSheet: Boolean(entryMeta?.hasSheet),
          hasRunning: rec.lifecycleStage === 'Running',
          allClosed: rec.orderStatus === 'Order Closed',
        });
      } else {
        if (!existing.lines.includes(rec.line)) existing.lines.push(rec.line);
        existing.recordIds.push(rec.id);
        if (rec.lifecycleStage === 'Running' && !existing.hasRunning) {
          existing.primaryRecordId = rec.id;
        }
        if (existing.orderQty === null && rec.plannedQty !== null) {
          existing.orderQty = rec.plannedQty;
        }
        if (existing.dailyTargetQty === null && rec.dailyTargetQty !== null) {
          existing.dailyTargetQty = rec.dailyTargetQty;
        }
        if (existing.cuttingInputQty === null && rec.cuttingInputQty !== null) {
          existing.cuttingInputQty = rec.cuttingInputQty;
        }
        if (rec.packingQty !== null) {
          existing.packingQty = (existing.packingQty ?? 0) + rec.packingQty;
        }
        if (rec.lifecycleStage === 'Running') existing.hasRunning = true;
        if (rec.orderStatus !== 'Order Closed') existing.allClosed = false;
      }
    }

    const rows = Array.from(pgMap.values());
    const filtered =
      pgScopeFilter === 'synced_or_filled'
        ? rows.filter(
            (r) =>
              r.hasSheet ||
              r.cuttingFinishedQty > 0 ||
              r.packingQty !== null ||
              r.orderQty !== null ||
              r.dailyTargetQty !== null
          )
        : rows;

    const listToSort = filtered.length > 0 ? filtered : rows;
    return listToSort.sort((a, b) => {
      if (a.latestDateIso !== b.latestDateIso) {
        return (b.latestDateIso || '').localeCompare(a.latestDateIso || '');
      }
      if (a.cuttingFinishedQty !== b.cuttingFinishedQty) {
        return b.cuttingFinishedQty - a.cuttingFinishedQty;
      }
      return a.pgNumber.localeCompare(b.pgNumber);
    });
  }, [filteredRecords, cuttingEntries, pgScopeFilter]);

  const pgTotalsSummary = useMemo(() => {
    let totalOrderQty = 0;
    let totalCutQty = 0;
    let totalPackQty = 0;
    let totalDailyTarget = 0;
    for (const r of pgSummaryRows) {
      totalOrderQty += r.orderQty ?? 0;
      totalCutQty += r.cuttingFinishedQty;
      totalPackQty += r.packingQty ?? 0;
      totalDailyTarget += r.dailyTargetQty ?? 0;
    }
    return {
      pgCount: pgSummaryRows.length,
      totalOrderQty,
      totalCutQty,
      totalPackQty,
      totalDailyTarget,
    };
  }, [pgSummaryRows]);

  const handlePackingChange = (targetIds: string[], rawValue: string) => {
    const trimmed = rawValue.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    const nextVal = parsed === null ? null : Math.round(parsed);
    if (onUpdatePackingQty) {
      void onUpdatePackingQty(targetIds, nextVal);
    } else {
      const nowIso = nextVal !== null ? new Date().toISOString() : null;
      for (const rid of targetIds) {
        onUpdateRecord(rid, { packingQty: nextVal, packingUpdatedAtIso: nowIso });
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Online Cutting Sheet Auto-Sync & Excel Upload Card */}
      <div className="ct-exec-banner text-white rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-400/35 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5 text-cyan-300" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-bold text-white">
                  Online Sheet Auto-Sync &amp; .xlsx File Upload (Zero Manual Entry)
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                    cuttingSheetSync.enabled
                      ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                      : 'bg-slate-700/60 border-slate-600 text-slate-300'
                  }`}
                >
                  {cuttingSheetSync.enabled ? 'Auto-Sync Active' : 'Auto-Sync Paused'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 max-w-3xl">
                Supports <strong className="text-white">SharePoint / OneDrive Excel links</strong>, <strong className="text-white">Google Sheets links</strong>, or direct <strong className="text-white">.xlsx / .csv file upload</strong>. Automatically reads PG# follow-up tabs (<code className="text-blue-200">Daily Cutting</code>) as well as standard summary tables across ALEX 1, 3, 5, and 12.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadSampleTemplate}
              className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Sample Template (.csv)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const nextVal = !sheetEnabled;
                setSheetEnabled(nextVal);
                void handleSaveSheetSetup(nextVal);
              }}
              className={`h-9 px-3.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                sheetEnabled
                  ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
              }`}
            >
              {sheetEnabled ? 'Auto-Sync: ON' : 'Auto-Sync: OFF'}
            </button>
          </div>
        </div>

        {/* 4-Factory Auto-Sync Links + Schedule Controls */}
        <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3.5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-blue-300" />
              <span>4 Factory Online Sheet Links (Save Once — Auto-Checked on Schedule)</span>
            </div>
            <span className="text-[11px] text-slate-400">
              Each factory syncs independently so other factories&apos; data is always preserved
            </span>
          </div>

          {/* 4 Separate Factory Link Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ALLOWED_FACTORIES.map((fac) => {
              const liveStats = perFactorySyncedStats[fac];
              const facStatus = cuttingSheetSync.factoryStatuses?.[fac];
              const hasSavedLink = Boolean(
                (factoryUrlsInput[fac] || '').trim() ||
                  (cuttingSheetSync.factoryUrls?.[fac] || '').trim()
              );
              return (
                <div
                  key={fac}
                  className="bg-slate-900/75 border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor={`fac-url-${fac}`}
                      className="text-xs font-semibold text-white flex items-center gap-1.5"
                    >
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-400/30 text-blue-200 font-mono text-[11px]">
                        {fac}
                      </span>
                      <span className="text-slate-300 font-normal">Online Sheet Link</span>
                    </label>
                    {facStatus?.status === 'Error' ? (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-900/60 border border-red-700/60 text-red-200">
                        Link Error
                      </span>
                    ) : liveStats.count > 0 ? (
                      <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-900/60 border border-emerald-700/60 text-emerald-200">
                        {liveStats.count} entries · {liveStats.qty.toLocaleString()} pcs
                      </span>
                    ) : hasSavedLink ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                        Linked · Pending Sync
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Not linked</span>
                    )}
                  </div>
                  <input
                    id={`fac-url-${fac}`}
                    type="url"
                    value={factoryUrlsInput[fac] || ''}
                    onChange={(e) =>
                      setFactoryUrlsInput((prev) => ({
                        ...prev,
                        [fac]: e.target.value,
                      }))
                    }
                    placeholder={`Paste ${fac} SharePoint / OneDrive / Google Sheet URL`}
                    className="h-9 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {facStatus?.message && (
                    <div
                      className={`text-[11px] truncate ${
                        facStatus.status === 'Error' ? 'text-red-300' : 'text-slate-400'
                      }`}
                      title={facStatus.message}
                    >
                      {facStatus.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Schedule + Format + Save/Sync Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1 items-end">
            <div className="lg:col-span-3 flex flex-col gap-1">
              <label htmlFor="sheet-sync-interval" className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                Auto-Check Schedule
              </label>
              <select
                id="sheet-sync-interval"
                value={intervalInput}
                onChange={(e) => setIntervalInput(Number(e.target.value))}
                className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                {CUTTING_SYNC_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-1">
              <label htmlFor="sheet-sync-mode" className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                Sheet Data Format
              </label>
              <select
                id="sheet-sync-mode"
                value={syncModeInput}
                onChange={(e) => setSyncModeInput(e.target.value as CuttingSheetSyncMode)}
                className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="auto">Auto-Detect (PG# Tabs, Daily Rows, or Date Columns)</option>
                <option value="daily_rows">Daily Rows (Date + PG# + Cutting Qty)</option>
                <option value="cumulative_pg">PG# Summary Total (Cumulative Qty)</option>
              </select>
            </div>

            <div className="lg:col-span-5 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleSaveSheetSetup()}
                disabled={savingConfig || syncingNow}
                className="h-9 px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingConfig ? 'Saving...' : 'Save Links'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleTriggerSyncNow()}
                disabled={syncingNow || savingConfig}
                className="h-9 px-4 rounded-lg bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
                <span>{syncingNow ? 'Syncing All Links...' : 'Save Links & Sync Now'}</span>
              </button>
            </div>
          </div>

          {/* Optional Single Combined Sheet Link */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <button
              type="button"
              onClick={() => setShowMainUrl((v) => !v)}
              className="text-xs font-medium text-blue-300 hover:text-blue-200 inline-flex items-center gap-1 cursor-pointer"
            >
              {showMainUrl ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>Combined Master Cutting Sheet Link (Optional — if 1 file covers all 4 factories)</span>
            </button>

            {showMainUrl && (
              <div className="flex flex-col gap-1">
                <label htmlFor="online-sheet-url" className="text-[11px] font-medium text-slate-300">
                  Single Combined Online Excel / Google Sheet URL
                </label>
                <input
                  id="online-sheet-url"
                  type="url"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://...-my.sharepoint.com/:x:/... or https://docs.google.com/spreadsheets/d/..."
                  className="h-9 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Direct .xlsx / .csv Cutting File Upload Bar */}
        <div className="bg-slate-950/55 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-white flex items-center gap-2">
                <Upload className="w-3.5 h-3.5 text-emerald-300" />
                <span>Direct .xlsx / .csv Cutting Sheet Upload (Per-Factory Merge)</span>
              </div>
              <p className="text-[11px] text-slate-300">
                Uploading a factory workbook (e.g. <code className="text-blue-200">Alex-3 Followup updated sheet.xlsx</code>) updates <strong className="text-white">only that factory</strong> — all other factories&apos; data stays preserved.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Factory scope for uploaded file"
                value={uploadFactoryOverride}
                onChange={(e) => setUploadFactoryOverride(e.target.value as FactoryName | 'AUTO')}
                className="h-9 px-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="AUTO">Factory: Auto-Detect</option>
                {ALLOWED_FACTORIES.map((f) => (
                  <option key={f} value={f}>
                    Factory: {f}
                  </option>
                ))}
              </select>

              <input
                ref={cuttingFileInputRef}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={handleCuttingFileInputChange}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => cuttingFileInputRef.current?.click()}
                disabled={uploadingFile || syncingNow}
                className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
              >
                <Upload className={`w-3.5 h-3.5 ${uploadingFile ? 'animate-bounce' : ''}`} />
                <span>{uploadingFile ? 'Importing .xlsx...' : 'Upload .xlsx / .csv File'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/70 text-[11px]">
            <span className="text-slate-400">Saved by Factory:</span>
            {ALLOWED_FACTORIES.map((fac) => {
              const st = perFactorySyncedStats[fac];
              return (
                <span
                  key={fac}
                  className={`px-2 py-0.5 rounded border font-mono ${
                    st.count > 0
                      ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-200'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400'
                  }`}
                >
                  {fac}: {st.qty.toLocaleString()} pcs ({st.count})
                </span>
              );
            })}
          </div>
        </div>

        {/* Sharing Guide & Live Sync Status Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-950/40 border border-slate-800/80 rounded-xl px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5">
              {cuttingSheetSync.lastStatus === 'Error' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
              <span className="text-slate-300">Status:</span>
              <span className="font-semibold text-white">{cuttingSheetSync.lastStatus}</span>
            </span>
            <span className="text-slate-300">
              Synced Entries:{' '}
              <strong className="font-mono text-white">
                {sheetSyncedCount.toLocaleString()}
              </strong>
            </span>
            <span className="text-slate-300">
              Synced Qty:{' '}
              <strong className="font-mono text-emerald-300">
                {cuttingSheetSync.lastTotalQty.toLocaleString()} pcs
              </strong>
            </span>
            {cuttingSheetSync.lastCheckedAtIso && (
              <span className="text-slate-400">
                Last Checked:{' '}
                <span className="font-mono text-slate-200">
                  {new Date(cuttingSheetSync.lastCheckedAtIso).toLocaleString()}
                </span>
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowSyncLogs((v) => !v)}
            className="text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
          >
            {showSyncLogs ? 'Hide Sync Logs' : `View Sync Logs (${cuttingSheetSync.logs.length})`}
          </button>
        </div>

        <div className="text-[11px] text-slate-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Online Link Tip: Works with <strong className="text-white">SharePoint / OneDrive Excel</strong> (<code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-200">Anyone with the link</code>) and <strong className="text-white">Google Sheets</strong>. Automatically fills <strong className="text-white">PG# Order Qty</strong>, pulls the <strong className="text-white">Latest Updated Total Cutting Qty</strong> per PG#, and updates <strong className="text-white">Daily Target</strong> by latest date.
          </span>
        </div>

        {(syncNotice || cuttingSheetSync.lastMessage) && (
          <div
            className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              syncNotice
                ? syncNotice.ok
                  ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-200'
                  : 'bg-red-950/60 border-red-700/70 text-red-200'
                : cuttingSheetSync.lastStatus === 'Error'
                  ? 'bg-amber-950/50 border-amber-700/60 text-amber-200'
                  : 'bg-slate-900/70 border-slate-700 text-slate-200'
            }`}
          >
            <span>{syncNotice ? syncNotice.text : cuttingSheetSync.lastMessage}</span>
            {syncNotice && (
              <button
                type="button"
                onClick={() => setSyncNotice(null)}
                className="text-slate-300 hover:text-white text-[11px] font-semibold shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {showSyncLogs && (
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2 max-h-64 overflow-y-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Recent Sheet Sync History
            </div>
            {cuttingSheetSync.logs.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No sync runs logged yet.</div>
            ) : (
              cuttingSheetSync.logs.map((log) => (
                <div
                  key={log.id}
                  className="text-xs border-b border-slate-800/80 last:border-b-0 pb-2 last:pb-0 flex flex-col gap-1"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          log.status === 'Error'
                            ? 'bg-red-900/70 text-red-200'
                            : log.status === 'Updated'
                              ? 'bg-emerald-900/70 text-emerald-200'
                              : 'bg-blue-900/70 text-blue-200'
                        }`}
                      >
                        {log.trigger} · {log.status}
                      </span>
                      <span className="text-slate-200">{log.message}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(log.syncedAtIso).toLocaleString()}
                    </span>
                  </div>
                  {log.sampleUnmatched && log.sampleUnmatched.length > 0 && (
                    <div className="text-[11px] text-amber-300">
                      Unmatched PG# samples: {log.sampleUnmatched.join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* PG-Wise Latest Cutting, Packing & Daily Target Summary */}
      <div className="ct-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              PG-Wise Latest Cutting, Packing &amp; Daily Target ({pgTotalsSummary.pgCount} PG#)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Order Qty:{' '}
              <span className="font-mono font-semibold text-slate-900">
                {pgTotalsSummary.totalOrderQty.toLocaleString()}
              </span>{' '}
              pcs · Cutting Output:{' '}
              <span className="font-mono font-semibold text-teal-700">
                {pgTotalsSummary.totalCutQty.toLocaleString()}
              </span>{' '}
              pcs · Packed:{' '}
              <span className="font-mono font-semibold text-cyan-800">
                {pgTotalsSummary.totalPackQty.toLocaleString()}
              </span>{' '}
              pcs · Daily Target Sum:{' '}
              <span className="font-mono font-semibold text-blue-700">
                {pgTotalsSummary.totalDailyTarget.toLocaleString()}
              </span>{' '}
              /day
            </p>
            <p className="text-[11px] text-amber-800 mt-1">
              Note: Online Cutting sheet does not provide a separate Packing Qty column — enter Packing Qty below (Admin-only) to update Balance to Pack and Packing Status on the public Master Plan.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setPgScopeFilter('synced_or_filled')}
              className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                pgScopeFilter === 'synced_or_filled'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Synced / Active PGs
            </button>
            <button
              type="button"
              onClick={() => setPgScopeFilter('all')}
              className={`px-2.5 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                pgScopeFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Plan PGs
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3.5 whitespace-nowrap">Factory</th>
                <th className="py-2.5 px-3.5 whitespace-nowrap">PG #</th>
                <th className="py-2.5 px-3.5 whitespace-nowrap">Style · Lines</th>
                <th className="py-2.5 px-3.5 whitespace-nowrap">Latest Update Date</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Order Qty (PG)</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Cutting Output</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Packing Qty (Admin)</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Balance to Pack</th>
                <th className="py-2.5 px-3.5 whitespace-nowrap">Packing Status</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Balance to Cut</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Daily Target</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Days Left</th>
                <th className="py-2.5 px-3.5 whitespace-nowrap">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {pgSummaryRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-8 text-center text-slate-500">
                    No PG-wise cutting or order qty synced yet for this filter. Upload an .xlsx / .csv file or sync an online link above.
                  </td>
                </tr>
              ) : (
                pgSummaryRows.map((row) => {
                  const balance =
                    row.orderQty !== null
                      ? Math.max(0, row.orderQty - row.cuttingFinishedQty)
                      : null;
                  const daysLeft =
                    balance !== null && row.dailyTargetQty !== null && row.dailyTargetQty > 0
                      ? Math.ceil(balance / row.dailyTargetQty)
                      : balance === 0
                        ? 0
                        : null;
                  const alert10d = daysLeft !== null && daysLeft <= 10 && !row.allClosed;
                  const packSummary = computePackingSummary(row.cuttingFinishedQty, row.packingQty);
                  const packBadgeClass =
                    packSummary.packingStatus === 'Over Packed'
                      ? 'bg-red-50 border-red-300 text-red-800'
                      : packSummary.packingStatus === 'Completed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : packSummary.packingStatus === 'In Progress'
                          ? 'bg-cyan-50 border-cyan-200 text-cyan-800'
                          : 'bg-slate-100 border-slate-200 text-slate-600';
                  return (
                    <tr key={row.key} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-semibold text-slate-900">
                        {row.factory}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono font-bold text-blue-700">
                        {row.pgNumber}
                      </td>
                      <td className="py-2.5 px-3.5 min-w-[200px] max-w-[280px]">
                        <div className="font-medium text-slate-900 truncate" title={row.style}>
                          {row.style}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {row.lines.join(', ')}
                          {row.hasRunning ? ' · Running' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap text-slate-700">
                        {row.latestDateIso ? formatDisplayDate(row.latestDateIso) : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          placeholder="Pending"
                          value={row.orderQty === null ? '' : row.orderQty}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const nextVal = raw === '' ? null : Number(raw);
                            for (const rid of row.recordIds) {
                              onUpdateRecord(rid, { plannedQty: nextVal });
                            }
                          }}
                          aria-label={`PG Order Qty for ${row.pgNumber}`}
                          className={`w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                            row.orderQty === null
                              ? 'bg-amber-50/70 border-amber-300 placeholder:text-amber-700/70'
                              : 'bg-white border-slate-300 font-semibold text-slate-900'
                          }`}
                        />
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-bold text-teal-700 whitespace-nowrap">
                        {row.cuttingFinishedQty.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          placeholder="Not set"
                          value={row.packingQty === null ? '' : row.packingQty}
                          onChange={(e) => handlePackingChange([row.primaryRecordId], e.target.value)}
                          aria-label={`Packing Qty for ${row.factory} ${row.pgNumber}`}
                          className="w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-cyan-300 bg-white font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-600"
                        />
                      </td>
                      <td
                        className={`py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap font-semibold ${
                          packSummary.packingStatus === 'Over Packed'
                            ? 'text-red-700'
                            : 'text-slate-800'
                        }`}
                      >
                        {packSummary.balanceToPack !== null
                          ? packSummary.balanceToPack.toLocaleString()
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${packBadgeClass}`}
                        >
                          {packSummary.packingStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {balance !== null ? balance.toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          placeholder="Target/d"
                          value={row.dailyTargetQty === null ? '' : row.dailyTargetQty}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const nextVal = raw === '' ? null : Number(raw);
                            for (const rid of row.recordIds) {
                              onUpdateRecord(rid, { dailyTargetQty: nextVal });
                            }
                          }}
                          aria-label={`PG Daily Target for ${row.pgNumber}`}
                          className="w-20 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </td>
                      <td
                        className={`py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap ${
                          alert10d ? 'text-red-700 font-bold' : 'text-slate-700'
                        }`}
                      >
                        {daysLeft !== null ? `${daysLeft}d` : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        {row.hasSheet ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-800 text-[11px] font-semibold">
                            Sheet Latest
                          </span>
                        ) : row.cuttingFinishedQty > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                            Manual
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-medium">
                            Order Filled
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Form: Manual Cutting Entry (Optional Adjustment) */}
      <div className="ct-surface rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              {cuttingSheetSync.enabled
                ? 'Manual Cutting Entry (Optional Adjustment — Auto-Sync Active Above)'
                : 'Daily-Wise Cutting Qty Data Entry'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Entries recorded here auto-sum into Cutting Finished Qty in Fabric Order Tracker. Set Order Status to &ldquo;Order Closed&rdquo; when a PG completes.
            </p>
          </div>
          {targetRecord && (
            <div className="flex flex-wrap items-center gap-2">
              {targetRecord.lifecycleStage !== 'Running' &&
                targetRecord.orderStatus !== 'Order Closed' && (
                  <button
                    type="button"
                    onClick={() => onSetRunningStyle(targetRecord.id)}
                    className="h-9 px-3 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-semibold cursor-pointer"
                  >
                    Set as Running Style
                  </button>
                )}
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
              className="w-full h-10 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-700 hover:brightness-110 disabled:opacity-50 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer"
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
      <div className="ct-surface rounded-2xl overflow-hidden">
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
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Packing Qty (Admin)</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Days Left</th>
                <th className="py-2.5 px-3 whitespace-nowrap">End Date (Edit)</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Add Cutting ({entryDateIso.slice(5)})</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Order Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {runningLinesInScope.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500">
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
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          placeholder="Not set"
                          value={rec.packingQty === null || rec.packingQty === undefined ? '' : rec.packingQty}
                          onChange={(e) => handlePackingChange([rec.id], e.target.value)}
                          aria-label={`Packing Qty for ${rec.factory} ${rec.line} ${rec.pgNumber}`}
                          className="w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-cyan-300 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-600"
                        />
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
      <div className="ct-surface rounded-2xl overflow-hidden">
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
                <th className="py-2.5 px-3.5">Source</th>
                <th className="py-2.5 px-3.5">Remarks</th>
                <th className="py-2.5 px-3.5 text-center">Remove</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {cuttingEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No daily cutting entries logged yet. Link an Online Sheet above for automatic updates, or use the manual form.
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
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {entry.source === 'sheet' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-800 text-[11px] font-semibold">
                          Sheet Auto-Sync
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium">
                          Manual
                        </span>
                      )}
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
