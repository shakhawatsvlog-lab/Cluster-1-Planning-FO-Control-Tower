import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { copyTextWithFallback } from './AppLinkModal.tsx';
import {
  ALLOWED_FACTORIES,
  ORDER_STATUS_OPTIONS,
  computeOutputSummary,
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
  CuttingSheetLinkRole,
  CuttingSheetLinkScope,
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
        | 'enabled'
        | 'sheetUrl'
        | 'factoryUrls'
        | 'outputSheetUrl'
        | 'outputFactoryUrls'
        | 'packingSheetUrl'
        | 'packingFactoryUrls'
        | 'syncMode'
        | 'intervalMinutes'
      >
    >
  ) => Promise<{ ok: boolean; error?: string }>;
  onRemoveCuttingSheetLink?: (
    role: CuttingSheetLinkRole,
    scope: CuttingSheetLinkScope
  ) => Promise<{ ok: boolean; error?: string }>;
  onSyncCuttingSheetNow: (options?: {
    trigger?: 'Auto' | 'Manual';
    force?: boolean;
  }) => Promise<{ ok: boolean; message: string; updated?: boolean }>;
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
      outputQty: number | null;
      outputUpdatedAtIso: string | null;
      packingQty: number | null;
      packingUpdatedAtIso: string | null;
      endDateIso: string | null;
      orderStatus: OrderStatus;
    }>
  ) => void;
  onUpdateOutputQty?: (recordIds: string[], outputQty: number | null) => Promise<void> | void;
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
  onRemoveCuttingSheetLink,
  onSyncCuttingSheetNow,
  onUploadCuttingFile,
  onAddCuttingEntry,
  onDeleteCuttingEntry,
  onUpdateRecord,
  onUpdateOutputQty,
  onUpdatePackingQty,
  onSetRunningStyle,
}: DailyCuttingEntryViewProps) {
  const hasSavedLinksInitial =
    Boolean((cuttingSheetSync.sheetUrl || '').trim()) ||
    Boolean((cuttingSheetSync.outputSheetUrl || '').trim()) ||
    Boolean((cuttingSheetSync.packingSheetUrl || '').trim()) ||
    ALLOWED_FACTORIES.some((fac) => Boolean((cuttingSheetSync.factoryUrls?.[fac] || '').trim())) ||
    ALLOWED_FACTORIES.some((fac) => Boolean((cuttingSheetSync.outputFactoryUrls?.[fac] || '').trim())) ||
    ALLOWED_FACTORIES.some((fac) => Boolean((cuttingSheetSync.packingFactoryUrls?.[fac] || '').trim()));

  // Online Cutting, Output & Packing Sheet Sync draft state
  const [sheetEnabled, setSheetEnabled] = useState(cuttingSheetSync.enabled);
  const [sheetUrlInput, setSheetUrlInput] = useState(cuttingSheetSync.sheetUrl);
  const [factoryUrlsInput, setFactoryUrlsInput] = useState<FactorySheetUrlMap>(
    cuttingSheetSync.factoryUrls || {}
  );
  const [outputSheetUrlInput, setOutputSheetUrlInput] = useState(
    cuttingSheetSync.outputSheetUrl || ''
  );
  const [outputFactoryUrlsInput, setOutputFactoryUrlsInput] = useState<FactorySheetUrlMap>(
    cuttingSheetSync.outputFactoryUrls || {}
  );
  const [packingSheetUrlInput, setPackingSheetUrlInput] = useState(
    cuttingSheetSync.packingSheetUrl || ''
  );
  const [packingFactoryUrlsInput, setPackingFactoryUrlsInput] = useState<FactorySheetUrlMap>(
    cuttingSheetSync.packingFactoryUrls || {}
  );
  const [syncModeInput, setSyncModeInput] = useState<CuttingSheetSyncMode>(
    cuttingSheetSync.syncMode
  );
  const [intervalInput, setIntervalInput] = useState<number>(
    !hasSavedLinksInitial &&
      cuttingSheetSync.intervalMinutes === 60 &&
      !cuttingSheetSync.lastCheckedAtIso
      ? 5
      : cuttingSheetSync.intervalMinutes || 5
  );
  const [showMainUrl, setShowMainUrl] = useState<boolean>(() =>
    Boolean(cuttingSheetSync.sheetUrl.trim())
  );
  const [showOutputUrls, setShowOutputUrls] = useState<boolean>(() =>
    Boolean(
      (cuttingSheetSync.outputSheetUrl || '').trim() ||
        ALLOWED_FACTORIES.some((fac) =>
          Boolean((cuttingSheetSync.outputFactoryUrls?.[fac] || '').trim())
        )
    )
  );
  const [showPackingUrls, setShowPackingUrls] = useState<boolean>(() =>
    Boolean(
      (cuttingSheetSync.packingSheetUrl || '').trim() ||
        ALLOWED_FACTORIES.some((fac) =>
          Boolean((cuttingSheetSync.packingFactoryUrls?.[fac] || '').trim())
        )
    )
  );
  const [showSyncLogs, setShowSyncLogs] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadFactoryOverride, setUploadFactoryOverride] = useState<FactoryName | 'AUTO'>('AUTO');
  const [syncNotice, setSyncNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deletingLinkKey, setDeletingLinkKey] = useState<string | null>(null);
  const [copiedLinkKey, setCopiedLinkKey] = useState<string | null>(null);
  const cuttingFileInputRef = useRef<HTMLInputElement | null>(null);

  // Track last-known server values so 15s background polling only updates fields whose server value changed and weren't edited locally
  const prevServerUrlsRef = useRef({
    enabled: cuttingSheetSync.enabled,
    sheetUrl: cuttingSheetSync.sheetUrl || '',
    factoryUrls: { ...(cuttingSheetSync.factoryUrls || {}) } as FactorySheetUrlMap,
    outputSheetUrl: cuttingSheetSync.outputSheetUrl || '',
    outputFactoryUrls: { ...(cuttingSheetSync.outputFactoryUrls || {}) } as FactorySheetUrlMap,
    packingSheetUrl: cuttingSheetSync.packingSheetUrl || '',
    packingFactoryUrls: { ...(cuttingSheetSync.packingFactoryUrls || {}) } as FactorySheetUrlMap,
    syncMode: cuttingSheetSync.syncMode,
    intervalMinutes: cuttingSheetSync.intervalMinutes || 5,
  });

  useEffect(() => {
    const prev = prevServerUrlsRef.current;

    if (cuttingSheetSync.enabled !== prev.enabled) {
      setSheetEnabled(cuttingSheetSync.enabled);
    }

    const nextSheetUrl = cuttingSheetSync.sheetUrl || '';
    if (nextSheetUrl !== prev.sheetUrl) {
      setSheetUrlInput((cur) => (cur === prev.sheetUrl ? nextSheetUrl : cur));
      if (nextSheetUrl.trim()) setShowMainUrl(true);
    }

    const nextFacUrls = cuttingSheetSync.factoryUrls || {};
    const facServerChanged = ALLOWED_FACTORIES.some(
      (f) => (nextFacUrls[f] || '') !== (prev.factoryUrls[f] || '')
    );
    if (facServerChanged) {
      setFactoryUrlsInput((cur) => {
        const merged: FactorySheetUrlMap = { ...cur };
        for (const f of ALLOWED_FACTORIES) {
          const prevVal = prev.factoryUrls[f] || '';
          const nextVal = nextFacUrls[f] || '';
          if (nextVal !== prevVal && (cur[f] || '') === prevVal) {
            if (nextVal) merged[f] = nextVal;
            else delete merged[f];
          }
        }
        return merged;
      });
    }

    const nextOutUrl = cuttingSheetSync.outputSheetUrl || '';
    if (nextOutUrl !== prev.outputSheetUrl) {
      setOutputSheetUrlInput((cur) => (cur === prev.outputSheetUrl ? nextOutUrl : cur));
      if (nextOutUrl.trim()) setShowOutputUrls(true);
    }

    const nextOutFacUrls = cuttingSheetSync.outputFactoryUrls || {};
    const outFacServerChanged = ALLOWED_FACTORIES.some(
      (f) => (nextOutFacUrls[f] || '') !== (prev.outputFactoryUrls[f] || '')
    );
    if (outFacServerChanged) {
      setOutputFactoryUrlsInput((cur) => {
        const merged: FactorySheetUrlMap = { ...cur };
        for (const f of ALLOWED_FACTORIES) {
          const prevVal = prev.outputFactoryUrls[f] || '';
          const nextVal = nextOutFacUrls[f] || '';
          if (nextVal !== prevVal && (cur[f] || '') === prevVal) {
            if (nextVal) merged[f] = nextVal;
            else delete merged[f];
          }
        }
        return merged;
      });
      if (ALLOWED_FACTORIES.some((f) => Boolean((nextOutFacUrls[f] || '').trim()))) {
        setShowOutputUrls(true);
      }
    }

    const nextPackUrl = cuttingSheetSync.packingSheetUrl || '';
    if (nextPackUrl !== prev.packingSheetUrl) {
      setPackingSheetUrlInput((cur) => (cur === prev.packingSheetUrl ? nextPackUrl : cur));
      if (nextPackUrl.trim()) setShowPackingUrls(true);
    }

    const nextPackFacUrls = cuttingSheetSync.packingFactoryUrls || {};
    const packFacServerChanged = ALLOWED_FACTORIES.some(
      (f) => (nextPackFacUrls[f] || '') !== (prev.packingFactoryUrls[f] || '')
    );
    if (packFacServerChanged) {
      setPackingFactoryUrlsInput((cur) => {
        const merged: FactorySheetUrlMap = { ...cur };
        for (const f of ALLOWED_FACTORIES) {
          const prevVal = prev.packingFactoryUrls[f] || '';
          const nextVal = nextPackFacUrls[f] || '';
          if (nextVal !== prevVal && (cur[f] || '') === prevVal) {
            if (nextVal) merged[f] = nextVal;
            else delete merged[f];
          }
        }
        return merged;
      });
      if (ALLOWED_FACTORIES.some((f) => Boolean((nextPackFacUrls[f] || '').trim()))) {
        setShowPackingUrls(true);
      }
    }

    if (cuttingSheetSync.syncMode !== prev.syncMode) {
      setSyncModeInput((cur) => (cur === prev.syncMode ? cuttingSheetSync.syncMode : cur));
    }
    const nextInterval = cuttingSheetSync.intervalMinutes || 5;
    if (nextInterval !== prev.intervalMinutes) {
      setIntervalInput((cur) => (cur === prev.intervalMinutes ? nextInterval : cur));
    }

    prevServerUrlsRef.current = {
      enabled: cuttingSheetSync.enabled,
      sheetUrl: nextSheetUrl,
      factoryUrls: { ...nextFacUrls },
      outputSheetUrl: nextOutUrl,
      outputFactoryUrls: { ...nextOutFacUrls },
      packingSheetUrl: nextPackUrl,
      packingFactoryUrls: { ...nextPackFacUrls },
      syncMode: cuttingSheetSync.syncMode,
      intervalMinutes: nextInterval,
    };
  }, [
    cuttingSheetSync.enabled,
    cuttingSheetSync.sheetUrl,
    cuttingSheetSync.factoryUrls,
    cuttingSheetSync.outputSheetUrl,
    cuttingSheetSync.outputFactoryUrls,
    cuttingSheetSync.packingSheetUrl,
    cuttingSheetSync.packingFactoryUrls,
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
      Boolean(outputSheetUrlInput.trim()) ||
      Boolean(packingSheetUrlInput.trim()) ||
      ALLOWED_FACTORIES.some((fac) => Boolean((factoryUrlsInput[fac] || '').trim())) ||
      ALLOWED_FACTORIES.some((fac) => Boolean((outputFactoryUrlsInput[fac] || '').trim())) ||
      ALLOWED_FACTORIES.some((fac) => Boolean((packingFactoryUrlsInput[fac] || '').trim())),
    [
      sheetUrlInput,
      factoryUrlsInput,
      outputSheetUrlInput,
      outputFactoryUrlsInput,
      packingSheetUrlInput,
      packingFactoryUrlsInput,
    ]
  );

  const savedLinksList = useMemo(() => {
    const items: Array<{
      key: string;
      role: CuttingSheetLinkRole;
      scope: CuttingSheetLinkScope;
      roleLabel: string;
      scopeLabel: string;
      url: string;
      factoryStatus?: CuttingSheetSyncConfig['factoryStatuses'][FactoryName];
    }> = [];

    for (const fac of ALLOWED_FACTORIES) {
      const url = (cuttingSheetSync.factoryUrls?.[fac] || '').trim();
      if (url) {
        items.push({
          key: `cutting::${fac}`,
          role: 'cutting',
          scope: fac,
          roleLabel: 'Cutting',
          scopeLabel: fac,
          url,
          factoryStatus: cuttingSheetSync.factoryStatuses?.[fac],
        });
      }
    }
    if ((cuttingSheetSync.sheetUrl || '').trim()) {
      items.push({
        key: 'cutting::combined',
        role: 'cutting',
        scope: 'combined',
        roleLabel: 'Cutting / Combined',
        scopeLabel: 'All Factories',
        url: cuttingSheetSync.sheetUrl.trim(),
      });
    }
    for (const fac of ALLOWED_FACTORIES) {
      const url = (cuttingSheetSync.outputFactoryUrls?.[fac] || '').trim();
      if (url) {
        items.push({
          key: `output::${fac}`,
          role: 'output',
          scope: fac,
          roleLabel: 'Output',
          scopeLabel: fac,
          url,
          factoryStatus: cuttingSheetSync.factoryStatuses?.[fac],
        });
      }
    }
    if ((cuttingSheetSync.outputSheetUrl || '').trim()) {
      items.push({
        key: 'output::combined',
        role: 'output',
        scope: 'combined',
        roleLabel: 'Output',
        scopeLabel: 'All Factories',
        url: cuttingSheetSync.outputSheetUrl.trim(),
      });
    }
    for (const fac of ALLOWED_FACTORIES) {
      const url = (cuttingSheetSync.packingFactoryUrls?.[fac] || '').trim();
      if (url) {
        items.push({
          key: `packing::${fac}`,
          role: 'packing',
          scope: fac,
          roleLabel: 'Packing',
          scopeLabel: fac,
          url,
          factoryStatus: cuttingSheetSync.factoryStatuses?.[fac],
        });
      }
    }
    if ((cuttingSheetSync.packingSheetUrl || '').trim()) {
      items.push({
        key: 'packing::combined',
        role: 'packing',
        scope: 'combined',
        roleLabel: 'Packing',
        scopeLabel: 'All Factories',
        url: cuttingSheetSync.packingSheetUrl.trim(),
      });
    }
    return items;
  }, [
    cuttingSheetSync.factoryUrls,
    cuttingSheetSync.sheetUrl,
    cuttingSheetSync.outputFactoryUrls,
    cuttingSheetSync.outputSheetUrl,
    cuttingSheetSync.packingFactoryUrls,
    cuttingSheetSync.packingSheetUrl,
    cuttingSheetSync.factoryStatuses,
  ]);

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
      outputSheetUrl: outputSheetUrlInput.trim(),
      outputFactoryUrls: outputFactoryUrlsInput,
      packingSheetUrl: packingSheetUrlInput.trim(),
      packingFactoryUrls: packingFactoryUrlsInput,
      syncMode: syncModeInput,
      intervalMinutes: intervalInput,
    });
    setSavingConfig(false);
    if (res.ok) {
      setSheetEnabled(nextEnabled);
      if (nextEnabled && hasAnyDraftUrl && overrideEnabled === undefined) {
        // Immediately collect data after saving new/updated links so user sees results right away
        setSyncingNow(true);
        const syncRes = await onSyncCuttingSheetNow({ trigger: 'Manual', force: true });
        setSyncingNow(false);
        setSyncNotice({
          ok: syncRes.ok,
          text: syncRes.ok
            ? `Links permanently saved & auto-sync active — ${syncRes.message}`
            : `Links permanently saved (auto-sync active). First sync check: ${syncRes.message}`,
        });
      } else {
        setSyncNotice({
          ok: true,
          text: nextEnabled
            ? 'All factory cutting, output & packing links saved permanently — Auto-Sync active.'
            : 'Online sheet settings saved (Auto-Sync paused).',
        });
      }
    } else {
      setSyncNotice({
        ok: false,
        text: res.error || 'Could not save online sheet settings.',
      });
    }
    return res.ok;
  };

  const handleDeleteSavedLink = async (
    key: string,
    role: CuttingSheetLinkRole,
    scope: CuttingSheetLinkScope
  ) => {
    if (!onRemoveCuttingSheetLink) return;
    setDeletingLinkKey(key);
    setSyncNotice(null);
    const res = await onRemoveCuttingSheetLink(role, scope);
    setDeletingLinkKey(null);
    setConfirmDeleteKey(null);

    if (res.ok) {
      if (role === 'cutting') {
        if (scope === 'combined') setSheetUrlInput('');
        else {
          setFactoryUrlsInput((prev) => {
            const copy = { ...prev };
            delete copy[scope];
            return copy;
          });
        }
      } else if (role === 'output') {
        if (scope === 'combined') setOutputSheetUrlInput('');
        else {
          setOutputFactoryUrlsInput((prev) => {
            const copy = { ...prev };
            delete copy[scope];
            return copy;
          });
        }
      } else if (role === 'packing') {
        if (scope === 'combined') setPackingSheetUrlInput('');
        else {
          setPackingFactoryUrlsInput((prev) => {
            const copy = { ...prev };
            delete copy[scope];
            return copy;
          });
        }
      }
      setSyncNotice({
        ok: true,
        text: `Removed ${scope === 'combined' ? 'All Factories' : scope} ${role} link permanently. Any remaining saved links stay active.`,
      });
    } else {
      setSyncNotice({
        ok: false,
        text: res.error || 'Failed to delete saved sheet link.',
      });
    }
  };

  const handleCopySavedLink = async (key: string, url: string) => {
    const copied = await copyTextWithFallback(url);
    if (copied) {
      setCopiedLinkKey(key);
      window.setTimeout(() => {
        setCopiedLinkKey((cur) => (cur === key ? null : cur));
      }, 1800);
    }
  };

  const handleTriggerSyncNow = async () => {
    setSyncingNow(true);
    setSyncNotice(null);
    const desiredEnabled = hasAnyDraftUrl ? true : sheetEnabled;
    const hasDraftChanges =
      sheetUrlInput.trim() !== cuttingSheetSync.sheetUrl.trim() ||
      outputSheetUrlInput.trim() !== (cuttingSheetSync.outputSheetUrl || '').trim() ||
      packingSheetUrlInput.trim() !== (cuttingSheetSync.packingSheetUrl || '').trim() ||
      desiredEnabled !== cuttingSheetSync.enabled ||
      syncModeInput !== cuttingSheetSync.syncMode ||
      intervalInput !== cuttingSheetSync.intervalMinutes ||
      JSON.stringify(factoryUrlsInput) !== JSON.stringify(cuttingSheetSync.factoryUrls || {}) ||
      JSON.stringify(outputFactoryUrlsInput) !==
        JSON.stringify(cuttingSheetSync.outputFactoryUrls || {}) ||
      JSON.stringify(packingFactoryUrlsInput) !==
        JSON.stringify(cuttingSheetSync.packingFactoryUrls || {});

    if (hasDraftChanges) {
      const saved = await onSaveCuttingSheetConfig({
        enabled: desiredEnabled,
        sheetUrl: sheetUrlInput.trim(),
        factoryUrls: factoryUrlsInput,
        outputSheetUrl: outputSheetUrlInput.trim(),
        outputFactoryUrls: outputFactoryUrlsInput,
        packingSheetUrl: packingSheetUrlInput.trim(),
        packingFactoryUrls: packingFactoryUrlsInput,
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

    const res = await onSyncCuttingSheetNow({ trigger: 'Manual', force: true });
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
      const cutInputQty = rec?.cuttingInputQty || 14000;
      const cutQty = rec?.cuttingFinishedQty || 12500;
      const outputQty = rec?.outputQty ?? 11800;
      const packQty = rec?.packingQty ?? 11200;
      const targetQty = rec?.dailyTargetQty || 1500;
      return `${referenceDateIso},${fac},${line},${pg},"${style}",${orderQty},${cutInputQty},${cutQty},${outputQty},${packQty},${targetQty},Latest Daily Update`;
    });
    const csvContent = [
      'Date,Factory,Line,PG#,Style,Order Qty,Cutting Input Qty,Total Cutting Qty,Output Qty,Packing Qty,Daily Target,Remarks',
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
        outputQty: number | null;
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
          outputQty: rec.outputQty ?? null,
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
        if (rec.outputQty !== null && rec.outputQty !== undefined) {
          existing.outputQty = (existing.outputQty ?? 0) + rec.outputQty;
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
              r.outputQty !== null ||
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
    let totalOutputQty = 0;
    let totalPackQty = 0;
    let totalDailyTarget = 0;
    for (const r of pgSummaryRows) {
      totalOrderQty += r.orderQty ?? 0;
      totalCutQty += r.cuttingFinishedQty;
      totalOutputQty += r.outputQty ?? 0;
      totalPackQty += r.packingQty ?? 0;
      totalDailyTarget += r.dailyTargetQty ?? 0;
    }
    return {
      pgCount: pgSummaryRows.length,
      totalOrderQty,
      totalCutQty,
      totalOutputQty,
      totalPackQty,
      totalDailyTarget,
    };
  }, [pgSummaryRows]);

  const handleOutputChange = (targetIds: string[], rawValue: string) => {
    const trimmed = rawValue.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return;
    const nextVal = parsed === null ? null : Math.round(parsed);
    if (onUpdateOutputQty) {
      void onUpdateOutputQty(targetIds, nextVal);
    } else {
      const nowIso = nextVal !== null ? new Date().toISOString() : null;
      for (const rid of targetIds) {
        onUpdateRecord(rid, { outputQty: nextVal, outputUpdatedAtIso: nowIso });
      }
    }
  };

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
                Supports <strong className="text-white">SharePoint / OneDrive Excel links</strong>, <strong className="text-white">Google Sheets links</strong>, or direct <strong className="text-white">.xlsx / .csv file upload</strong>. Automatically collects <strong className="text-white">Cutting Input, Cutting Output, Output Qty, Packing Qty, Order Qty, and Daily Target</strong> across ALEX 1, 3, 5, and 12.
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

        {/* Always-Visible Saved Permanent Links Directory */}
        <div className="bg-slate-950/65 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Link2 className="w-3.5 h-3.5 text-emerald-300" />
              <span>Saved Permanent Online Links ({savedLinksList.length})</span>
              {savedLinksList.length > 0 && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-400/35 text-emerald-200 text-[10px] font-semibold">
                  Saved Permanently Until Deleted
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-400">
              {savedLinksList.length > 0
                ? cuttingSheetSync.enabled
                  ? `Auto-checking every ${cuttingSheetSync.intervalMinutes || 5} min · Any sheet edit updates automatically`
                  : 'Auto-sync paused (links remain safely stored)'
                : 'Add your sheet links once below — never needs re-entry'}
            </span>
          </div>

          {savedLinksList.length === 0 ? (
            <div className="text-xs text-slate-400 bg-slate-900/60 border border-dashed border-slate-700/80 rounded-lg px-3 py-2.5">
              No permanent sheet links saved yet. Paste any Google Sheets or SharePoint Excel link below and click <strong className="text-slate-200">Save Links</strong> — the system will save it permanently and automatically detect &amp; collect updates whenever the sheet changes.
            </div>
          ) : (
            <div className="space-y-2">
              {savedLinksList.map((item) => {
                const isConfirming = confirmDeleteKey === item.key;
                const isDeleting = deletingLinkKey === item.key;
                const isCopied = copiedLinkKey === item.key;
                const roleBadgeClass =
                  item.role === 'output'
                    ? 'bg-teal-500/20 border-teal-400/35 text-teal-200'
                    : item.role === 'packing'
                      ? 'bg-cyan-500/20 border-cyan-400/35 text-cyan-200'
                      : 'bg-blue-500/20 border-blue-400/35 text-blue-200';
                return (
                  <div
                    key={item.key}
                    className="bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${roleBadgeClass}`}>
                          {item.roleLabel}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-200 font-mono text-[10px] font-semibold">
                          {item.scopeLabel}
                        </span>
                        {item.factoryStatus?.status === 'Error' ? (
                          <span className="text-[10px] text-amber-300 font-medium">
                            · {item.factoryStatus.message}
                          </span>
                        ) : item.factoryStatus?.lastSyncedAtIso ? (
                          <span className="text-[10px] text-emerald-300">
                            · Checked {new Date(item.factoryStatus.lastSyncedAtIso).toLocaleTimeString()}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">· Active permanent link</span>
                        )}
                      </div>
                      <div
                        className="font-mono text-[11px] text-slate-200 break-all select-all"
                        title={item.url}
                      >
                        {item.url}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleCopySavedLink(item.key, item.url)}
                        className="h-7 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
                        title="Copy saved link"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-medium inline-flex items-center gap-1 transition-colors"
                        title="Open online sheet in new tab"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open</span>
                      </a>

                      {onRemoveCuttingSheetLink && (
                        isConfirming ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => void handleDeleteSavedLink(item.key, item.role, item.scope)}
                              className="h-7 px-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer transition-colors"
                            >
                              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => setConfirmDeleteKey(null)}
                              className="h-7 px-2 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] cursor-pointer transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(item.key)}
                            className="h-7 px-2 rounded bg-red-950/60 hover:bg-red-900/70 border border-red-800/70 text-red-200 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
                            title="Manually delete this saved link"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4-Factory Auto-Sync Links + Schedule Controls */}
        <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3.5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-blue-300" />
              <span>Add / Edit Permanent Factory Sheet Links (Save Once — Auto-Detects Changes)</span>
            </div>
            <span className="text-[11px] text-slate-400">
              Links stay permanently saved until you delete them above
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

          {/* Optional Single Combined Sheet Link + Dedicated Output & Packing Online Sheet Links */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
            <div className="flex flex-wrap items-center gap-4">
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
                <span>Combined Master Cutting/Output/Packing Link (Optional — 1 file for all 4 factories)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowOutputUrls((v) => !v)}
                className="text-xs font-medium text-teal-300 hover:text-teal-200 inline-flex items-center gap-1 cursor-pointer"
              >
                {showOutputUrls ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>Separate Output Online Sheet Links (Optional — if Output is in a separate link)</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPackingUrls((v) => !v)}
                className="text-xs font-medium text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 cursor-pointer"
              >
                {showPackingUrls ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
                <span>Separate Packing Online Sheet Links (Optional — if Packing is in a separate link)</span>
              </button>
            </div>

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

            {showOutputUrls && (
              <div className="bg-slate-900/60 border border-teal-900/60 rounded-lg p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-teal-200">
                    Output Sheet Online Links (Auto-Collected into Output Qty &amp; Balance to Output)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Leave blank if Output Qty is already a column/tab inside your Cutting links above
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {ALLOWED_FACTORIES.map((fac) => (
                    <div key={`output-${fac}`} className="flex flex-col gap-1">
                      <label
                        htmlFor={`output-fac-url-${fac}`}
                        className="text-[11px] font-medium text-slate-300"
                      >
                        {fac} Output Online Sheet Link
                      </label>
                      <input
                        id={`output-fac-url-${fac}`}
                        type="url"
                        value={outputFactoryUrlsInput[fac] || ''}
                        onChange={(e) =>
                          setOutputFactoryUrlsInput((prev) => ({
                            ...prev,
                            [fac]: e.target.value,
                          }))
                        }
                        placeholder={`Paste ${fac} Output SharePoint / Google Sheet URL`}
                        className="h-8 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="online-output-sheet-url" className="text-[11px] font-medium text-slate-300">
                    Combined All-Factories Output Sheet Link (Optional)
                  </label>
                  <input
                    id="online-output-sheet-url"
                    type="url"
                    value={outputSheetUrlInput}
                    onChange={(e) => setOutputSheetUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/... or SharePoint Output Excel URL"
                    className="h-8 px-3 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            )}

            {showPackingUrls && (
              <div className="bg-slate-900/60 border border-cyan-900/60 rounded-lg p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-cyan-200">
                    Packing Sheet Online Links (Auto-Collected into Packing Qty &amp; Balance to Pack)
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Leave blank if Packing is already a column/tab inside your Cutting links above
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {ALLOWED_FACTORIES.map((fac) => (
                    <div key={`pack-${fac}`} className="flex flex-col gap-1">
                      <label
                        htmlFor={`pack-fac-url-${fac}`}
                        className="text-[11px] font-medium text-slate-300"
                      >
                        {fac} Packing Online Sheet Link
                      </label>
                      <input
                        id={`pack-fac-url-${fac}`}
                        type="url"
                        value={packingFactoryUrlsInput[fac] || ''}
                        onChange={(e) =>
                          setPackingFactoryUrlsInput((prev) => ({
                            ...prev,
                            [fac]: e.target.value,
                          }))
                        }
                        placeholder={`Paste ${fac} Packing SharePoint / Google Sheet URL`}
                        className="h-8 px-2.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="online-packing-sheet-url" className="text-[11px] font-medium text-slate-300">
                    Combined All-Factories Packing Sheet Link (Optional)
                  </label>
                  <input
                    id="online-packing-sheet-url"
                    type="url"
                    value={packingSheetUrlInput}
                    onChange={(e) => setPackingSheetUrlInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/... or SharePoint Packing Excel URL"
                    className="h-8 px-3 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                </div>
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
              Synced Cut Qty:{' '}
              <strong className="font-mono text-emerald-300">
                {cuttingSheetSync.lastTotalQty.toLocaleString()} pcs
              </strong>
            </span>
            <span className="text-slate-300">
              Synced Output:{' '}
              <strong className="font-mono text-teal-300">
                {(cuttingSheetSync.lastOutputTotalQty ?? 0).toLocaleString()} pcs (
                {cuttingSheetSync.lastOutputMatchedCount ?? 0})
              </strong>
            </span>
            <span className="text-slate-300">
              Synced Packing:{' '}
              <strong className="font-mono text-cyan-300">
                {(cuttingSheetSync.lastPackingTotalQty ?? 0).toLocaleString()} pcs (
                {cuttingSheetSync.lastPackingMatchedCount ?? 0})
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
            Online Link Tip: Works with <strong className="text-white">SharePoint / OneDrive Excel</strong> (<code className="bg-slate-800 px-1.5 py-0.5 rounded text-blue-200">Anyone with the link</code>) and <strong className="text-white">Google Sheets</strong>. Automatically collects <strong className="text-white">PG# Order Qty, Cutting Input, Cutting Output, Output Qty, Packing Qty,</strong> and <strong className="text-white">Daily Target</strong> from linked sheets.
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

      {/* PG-Wise Latest Cutting, Output, Packing & Daily Target Summary */}
      <div className="ct-surface rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/60">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              PG-Wise Latest Cutting, Output, Packing &amp; Daily Target ({pgTotalsSummary.pgCount} PG#)
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
              pcs · Output:{' '}
              <span className="font-mono font-semibold text-emerald-700">
                {pgTotalsSummary.totalOutputQty.toLocaleString()}
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
            <p className="text-[11px] text-cyan-800 mt-1">
              Output Qty &amp; Packing Qty are automatically collected from uploaded/linked online sheets (from Output/Packing columns or optional separate links above). Admin overrides can also be entered below.
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
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Output Qty (Admin)</th>
                <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Balance to Output</th>
                <th className="py-2.5 px-3.5 whitespace-nowrap">Output Status</th>
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
                  <td colSpan={16} className="py-8 text-center text-slate-500">
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
                  const outSummary = computeOutputSummary(row.cuttingFinishedQty, row.outputQty);
                  const outBadgeClass =
                    outSummary.outputStatus === 'Over Output'
                      ? 'bg-red-50 border-red-300 text-red-800'
                      : outSummary.outputStatus === 'Completed'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : outSummary.outputStatus === 'In Progress'
                          ? 'bg-teal-50 border-teal-200 text-teal-800'
                          : 'bg-slate-100 border-slate-200 text-slate-600';
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
                          value={row.outputQty === null ? '' : row.outputQty}
                          onChange={(e) => handleOutputChange([row.primaryRecordId], e.target.value)}
                          aria-label={`Output Qty for ${row.factory} ${row.pgNumber}`}
                          className="w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-teal-300 bg-white font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </td>
                      <td
                        className={`py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap font-semibold ${
                          outSummary.outputStatus === 'Over Output'
                            ? 'text-red-700'
                            : 'text-slate-800'
                        }`}
                      >
                        {outSummary.balanceToOutput !== null
                          ? outSummary.balanceToOutput.toLocaleString()
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${outBadgeClass}`}
                        >
                          {outSummary.outputStatus}
                        </span>
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
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Output Qty (Admin)</th>
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
                  <td colSpan={12} className="py-8 text-center text-slate-500">
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
                          value={rec.outputQty === null || rec.outputQty === undefined ? '' : rec.outputQty}
                          onChange={(e) => handleOutputChange([rec.id], e.target.value)}
                          aria-label={`Output Qty for ${rec.factory} ${rec.line} ${rec.pgNumber}`}
                          className="w-24 h-8 px-2 text-right font-mono tabular-nums text-xs rounded border border-teal-300 bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
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
