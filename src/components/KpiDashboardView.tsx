import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  BookmarkCheck,
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Factory,
  FileSpreadsheet,
  Mail,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import {
  ALLOWED_FACTORIES,
  addDaysIso,
  buildPgFoChecklistItems,
  computePgWiseQtySummary,
  diffDaysIso,
  formatDisplayDate,
  getEffectiveIssueQty,
} from '../shared/plannerTypes.ts';
import type {
  EvaluatedPlanningRecord,
  FactoryName,
  LineShortcutSummary,
  MasterPlanMeta,
  PgFoChecklistItem,
} from '../shared/plannerTypes.ts';
import {
  DEFAULT_SAVED_FO_EMAIL_BODY,
  buildDefaultSavedFoEmailSubject,
} from '../shared/reminderTypes.ts';
import type { ReminderRecipient } from '../shared/reminderTypes.ts';
import type { NavTab } from './Sidebar.tsx';
import { isRecordInDateRange } from './FilterToolbar.tsx';
import type { DateRangeFilterValue } from './FilterToolbar.tsx';
import { apiUrl } from '../lib/apiBase.ts';

type DashboardTabMode = 'recent_fo' | 'set_running' | 'all_running';
type PgFoFilterMode = 'recent' | 'all' | 'released';

interface KpiDashboardViewProps {
  meta?: MasterPlanMeta | null;
  allRecords: EvaluatedPlanningRecord[];
  shortcutSummaries: LineShortcutSummary[];
  referenceDateIso: string;
  dateRangeFilter?: DateRangeFilterValue | null;
  inputStartOffsetDays?: number;
  upcomingFoOffsetDays?: number;
  cuttingAlertDays?: number;
  isEditingLocked?: boolean;
  onUpdatePlanningRules?: (
    patch: Partial<{
      inputStartOffsetDays: number;
      upcomingFoOffsetDays: number;
      cuttingAlertDays: number;
    }>
  ) => Promise<{ ok: boolean; error?: string }>;
  selectedFactory: FactoryName | 'ALL';
  selectedLine: string;
  onSelectFactory: (f: FactoryName | 'ALL') => void;
  onSelectLine: (line: string) => void;
  onSetRunningStyle: (recordId: string) => void;
  onClearLineRunning: (factory: FactoryName, line: string) => void;
  onAdvanceRunningOrder?: (finishedRecordId: string) => void;
  onToggleUpcomingFoSelection: (recordId: string, selected: boolean) => void;
  onBulkToggleUpcomingFoSelection: (recordIds: string[], selected: boolean) => void;
  onDownloadSelectedFoXlsx: (selectedIds?: string[]) => Promise<boolean>;
  reminderRecipients: ReminderRecipient[];
  smtpConfigured: boolean;
  smtpSenderEmail: string | null;
  onSendSavedFoEmail: (payload: {
    toEmails: string;
    subject: string;
    bodyText: string;
    selectedRecordIds: string[];
    attachXlsx: boolean;
  }) => Promise<{ ok: boolean; message: string }>;
  onNavigateTab: (tab: NavTab) => void;
}

function getNewStyleStartCountdown(days: number | null): {
  label: string;
  className: string;
} | null {
  if (days === null) return null;
  if (days === 0) {
    return { label: 'Starts TODAY', className: 'text-red-700 font-bold' };
  }
  if (days < 0) {
    return {
      label: `${Math.abs(days)}d past start`,
      className: 'text-red-700 font-bold',
    };
  }
  if (days <= 15) {
    return {
      label: `${days}d left to start`,
      className: 'text-amber-700 font-semibold',
    };
  }
  return {
    label: `${days}d left to start`,
    className: 'text-blue-700 font-medium',
  };
}

function getOutputStartCountdown(days: number | null): {
  label: string;
  className: string;
} | null {
  if (days === null) return null;
  if (days === 0) {
    return { label: 'Output TODAY', className: 'text-emerald-700 font-bold' };
  }
  if (days < 0) {
    return {
      label: `${Math.abs(days)}d in output`,
      className: 'text-emerald-700 font-semibold',
    };
  }
  if (days <= 15) {
    return {
      label: `${days}d to output`,
      className: 'text-indigo-700 font-semibold',
    };
  }
  return {
    label: `${days}d to output`,
    className: 'text-slate-600 font-medium',
  };
}

function getCompactSummaryFoStatus(rec: EvaluatedPlanningRecord): {
  label: 'Pending' | 'Under Process' | 'Completed';
  badgeClass: string;
} {
  if (rec.isFullQtyReleased || rec.foStatus === 'In-House') {
    return {
      label: 'Completed',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    };
  }
  if (rec.foStatus === 'FO Raised') {
    return {
      label: 'Under Process',
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  return {
    label: 'Pending',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  };
}

export function KpiDashboardView({
  meta = null,
  allRecords,
  shortcutSummaries,
  referenceDateIso,
  dateRangeFilter = null,
  inputStartOffsetDays = 10,
  upcomingFoOffsetDays = 15,
  cuttingAlertDays = 10,
  isEditingLocked = false,
  onUpdatePlanningRules,
  selectedFactory,
  selectedLine,
  onSelectFactory,
  onSelectLine,
  onSetRunningStyle,
  onClearLineRunning,
  onAdvanceRunningOrder,
  onToggleUpcomingFoSelection,
  onBulkToggleUpcomingFoSelection,
  onDownloadSelectedFoXlsx,
  reminderRecipients,
  smtpConfigured,
  smtpSenderEmail,
  onSendSavedFoEmail,
  onNavigateTab,
}: KpiDashboardViewProps) {
  const [tabMode, setTabMode] = useState<DashboardTabMode>('recent_fo');
  const [pgFilterMode, setPgFilterMode] = useState<PgFoFilterMode>('recent');
  const [foOffsetDraft, setFoOffsetDraft] = useState<string>(String(upcomingFoOffsetDays));
  const [inputOffsetDraft, setInputOffsetDraft] = useState<string>(String(inputStartOffsetDays));
  const [savingRules, setSavingRules] = useState(false);
  const [ruleStatusMsg, setRuleStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hideSavedInTopTable, setHideSavedInTopTable] = useState(true);
  const [exportingSelected, setExportingSelected] = useState(false);
  const [topCheckNotice, setTopCheckNotice] = useState<string | null>(null);
  const [boxNotice, setBoxNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showEmailComposer, setShowEmailComposer] = useState(false);
  const [emailToInput, setEmailToInput] = useState<string>(() =>
    reminderRecipients
      .filter((r) => r.active && r.email)
      .map((r) => r.email)
      .join(', ')
  );
  const [emailSubjectEdited, setEmailSubjectEdited] = useState(false);
  const [emailSubjectInput, setEmailSubjectInput] = useState('');
  const [emailBodyInput, setEmailBodyInput] = useState<string>(DEFAULT_SAVED_FO_EMAIL_BODY);
  const [attachXlsxInput, setAttachXlsxInput] = useState(true);
  const [sendingSavedEmail, setSendingSavedEmail] = useState(false);
  const [downloadingSummaryBoxXlsx, setDownloadingSummaryBoxXlsx] = useState(false);
  const [summaryBoxDownloadError, setSummaryBoxDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setFoOffsetDraft(String(upcomingFoOffsetDays));
    setInputOffsetDraft(String(inputStartOffsetDays));
  }, [upcomingFoOffsetDays, inputStartOffsetDays]);

  const ruleOpts = useMemo(
    () => ({
      inputStartOffsetDays,
      upcomingFoOffsetDays,
      cuttingAlertDays,
    }),
    [inputStartOffsetDays, upcomingFoOffsetDays, cuttingAlertDays]
  );

  const dateRangeActive = Boolean(
    dateRangeFilter && (dateRangeFilter.fromIso || dateRangeFilter.toIso)
  );

  const dateMatchedIdSet = useMemo(() => {
    if (!dateRangeActive || !dateRangeFilter) return null;
    const ids = new Set<string>();
    for (const r of allRecords) {
      if (isRecordInDateRange(r, dateRangeFilter)) {
        ids.add(r.id);
      }
    }
    return ids;
  }, [allRecords, dateRangeActive, dateRangeFilter]);

  // Full PG-wise checklist across all 4 factories (Running + Upcoming + Released remarks)
  const allPgChecklistItems = useMemo(
    () => buildPgFoChecklistItems(allRecords, shortcutSummaries, referenceDateIso, ruleOpts),
    [allRecords, shortcutSummaries, referenceDateIso, ruleOpts]
  );

  const scopedPgItems = useMemo(() => {
    return allPgChecklistItems.filter((item) => {
      if (selectedFactory !== 'ALL' && item.factory !== selectedFactory) return false;
      if (selectedLine !== 'ALL' && !item.lines.includes(selectedLine)) return false;
      if (dateMatchedIdSet && !item.recordIds.some((id) => dateMatchedIdSet.has(id))) {
        return false;
      }
      return true;
    });
  }, [allPgChecklistItems, selectedFactory, selectedLine, dateMatchedIdSet]);

  // PG-Wise Total Order Qty & Issue Qty (deduplicated across lines sharing a PG)
  const globalPgSummary = useMemo(
    () => computePgWiseQtySummary(allPgChecklistItems),
    [allPgChecklistItems]
  );
  const scopedPgSummary = useMemo(
    () => computePgWiseQtySummary(scopedPgItems),
    [scopedPgItems]
  );

  const scopedShortcuts = useMemo(() => {
    return shortcutSummaries.filter((s) => {
      if (selectedFactory !== 'ALL' && s.factory !== selectedFactory) return false;
      if (selectedLine !== 'ALL' && s.line !== selectedLine) return false;
      if (dateMatchedIdSet) {
        const hasMatch =
          (s.runningRecord && dateMatchedIdSet.has(s.runningRecord.id)) ||
          (s.upcomingRecord && dateMatchedIdSet.has(s.upcomingRecord.id));
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [shortcutSummaries, selectedFactory, selectedLine, dateMatchedIdSet]);

  const pgRecentNeededCount = useMemo(
    () =>
      scopedPgItems.filter(
        (item) => !item.isFullQtyReleased && item.isActionableWindow && item.needsFo
      ).length,
    [scopedPgItems]
  );
  const pgLaterCount = useMemo(
    () =>
      scopedPgItems.filter(
        (item) => !item.isFullQtyReleased && !item.isActionableWindow
      ).length,
    [scopedPgItems]
  );
  const pgReleasedCount = useMemo(
    () => scopedPgItems.filter((item) => item.isFullQtyReleased).length,
    [scopedPgItems]
  );

  const displayedPgRows = useMemo(() => {
    const byStatus = scopedPgItems.filter((item) => {
      if (pgFilterMode === 'recent') {
        return !item.isFullQtyReleased && item.isActionableWindow && item.needsFo;
      }
      if (pgFilterMode === 'released') return item.isFullQtyReleased;
      return true;
    });
    if (!hideSavedInTopTable) return byStatus;
    return byStatus.filter((item) => !item.allSelected);
  }, [scopedPgItems, pgFilterMode, hideSavedInTopTable]);

  const allRunningRows = useMemo(() => {
    const base = scopedShortcuts
      .filter((s) => s.hasManualRunning)
      .sort((a, b) =>
        (a.upcomingFoTriggerIso || '9999-12-31').localeCompare(
          b.upcomingFoTriggerIso || '9999-12-31'
        )
      );
    if (!hideSavedInTopTable) return base;
    return base.filter((s) => {
      const targetRec = s.upcomingRecord ?? s.runningRecord;
      return !targetRec?.upcomingFoSelected;
    });
  }, [scopedShortcuts, hideSavedInTopTable]);

  // Group open slots by factory::line for the fast "Set Running Styles" tab
  const lineSlotOptionsMap = useMemo(() => {
    const map = new Map<string, EvaluatedPlanningRecord[]>();
    for (const rec of allRecords) {
      if (rec.orderStatus === 'Order Closed' || rec.isFinished) continue;
      const key = `${rec.factory}::${rec.line}`;
      const list = map.get(key) ?? [];
      list.push(rec);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.slot - b.slot);
    }
    return map;
  }, [allRecords]);

  // 4-Factory 3D Summary Cards
  const factoryCards = useMemo(() => {
    return ALLOWED_FACTORIES.map((factory) => {
      const lines = shortcutSummaries.filter((s) => s.factory === factory);
      const runningSetCount = lines.filter((s) => s.hasManualRunning).length;
      const facPgItems = allPgChecklistItems.filter((p) => p.factory === factory);
      const pgRecentNeeded = facPgItems.filter(
        (p) => !p.isFullQtyReleased && p.isActionableWindow && p.needsFo
      );
      const urgentCount = pgRecentNeeded.filter((p) => p.severity === 'critical').length;
      const dueSoonCount = pgRecentNeeded.filter((p) => p.severity === 'warning').length;
      const releasedCount = facPgItems.filter((p) => p.isFullQtyReleased).length;
      const facQty = globalPgSummary.byFactory[factory];

      const earliestPg = [...pgRecentNeeded].sort((a, b) =>
        (a.foTriggerIso || '9999-12-31').localeCompare(b.foTriggerIso || '9999-12-31')
      )[0];

      return {
        factory,
        totalLines: lines.length,
        runningSetCount,
        actionableCount: pgRecentNeeded.length,
        urgentCount,
        dueSoonCount,
        releasedCount,
        issueQty: facQty.issueQty,
        orderQty: facQty.orderQty,
        earliestPg,
      };
    });
  }, [shortcutSummaries, allPgChecklistItems, globalPgSummary]);

  const totalLinesCount = shortcutSummaries.length;
  const totalRunningSet = shortcutSummaries.filter((s) => s.hasManualRunning).length;
  const totalRecentFoPgCount = allPgChecklistItems.filter(
    (p) => !p.isFullQtyReleased && p.isActionableWindow && p.needsFo
  ).length;
  const totalUrgentPgCount = allPgChecklistItems.filter(
    (p) => !p.isFullQtyReleased && p.severity === 'critical'
  ).length;

  const shortcutByLineKey = useMemo(() => {
    const map = new Map<string, LineShortcutSummary>();
    for (const s of shortcutSummaries) {
      map.set(`${s.factory}::${s.line}`, s);
    }
    return map;
  }, [shortcutSummaries]);

  const allSavedRecords = useMemo(() => {
    return allRecords.filter((r) => Boolean(r.upcomingFoSelected));
  }, [allRecords]);

  const savedBoxRows = useMemo(() => {
    const scoped = allSavedRecords.filter((rec) => {
      if (selectedFactory !== 'ALL' && rec.factory !== selectedFactory) return false;
      if (selectedLine !== 'ALL' && rec.line !== selectedLine) return false;
      if (dateMatchedIdSet && !dateMatchedIdSet.has(rec.id)) return false;
      return true;
    });

    return scoped
      .map((rec) => {
        const sc = shortcutByLineKey.get(`${rec.factory}::${rec.line}`) ?? null;
        const isLineUpcoming = sc?.upcomingRecord?.id === rec.id;
        const runningRec = sc?.runningRecord ?? null;
        const runningEndIso = runningRec?.endDateIso ?? rec.endDateIso;
        const outputStartIso = runningEndIso ? addDaysIso(runningEndIso, 1) : null;
        const daysToOutputStart = diffDaysIso(outputStartIso, referenceDateIso);
        const inputStartIso = isLineUpcoming
          ? sc?.newStyleInputStartIso ?? null
          : rec.endDateIso
            ? addDaysIso(rec.endDateIso, -inputStartOffsetDays)
            : null;
        const daysToStartNewStyle = isLineUpcoming
          ? sc?.daysToNewStyleInputStart ?? null
          : diffDaysIso(inputStartIso, referenceDateIso);
        const foDateNeededIso = isLineUpcoming
          ? sc?.upcomingFoTriggerIso ?? null
          : inputStartIso
            ? addDaysIso(inputStartIso, -upcomingFoOffsetDays)
            : rec.triggerDateIso;
        const daysToFo = isLineUpcoming
          ? sc?.daysToUpcomingFoTrigger ?? null
          : diffDaysIso(foDateNeededIso, referenceDateIso);
        const issueQty = getEffectiveIssueQty(rec);
        const statusLabel = rec.isFullQtyReleased
          ? 'FULL QTY RELEASED'
          : isLineUpcoming
            ? sc?.summaryStatus ?? rec.riskStatus
            : rec.riskStatus;
        const severity = rec.isFullQtyReleased
          ? 'normal'
          : isLineUpcoming
            ? sc?.summarySeverity ?? 'upcoming'
            : rec.riskTier === 'critical'
              ? 'critical'
              : rec.riskTier === 'high' || rec.riskTier === 'plan_qty_pending'
                ? 'warning'
                : rec.riskTier === 'monitoring'
                  ? 'upcoming'
                  : 'normal';

        return {
          rec,
          runningRec,
          outputStartIso,
          daysToOutputStart,
          inputStartIso,
          daysToStartNewStyle,
          foDateNeededIso,
          daysToFo,
          issueQty,
          statusLabel,
          severity,
        };
      })
      .sort((a, b) => {
        const sevOrder = { critical: 0, warning: 1, upcoming: 2, normal: 3 };
        if (sevOrder[a.severity] !== sevOrder[b.severity]) {
          return sevOrder[a.severity] - sevOrder[b.severity];
        }
        return (a.foDateNeededIso || '9999-12-31').localeCompare(
          b.foDateNeededIso || '9999-12-31'
        );
      });
  }, [
    allSavedRecords,
    selectedFactory,
    selectedLine,
    dateMatchedIdSet,
    shortcutByLineKey,
    referenceDateIso,
    inputStartOffsetDays,
    upcomingFoOffsetDays,
  ]);

  // Deduplicate PG-wise Order/Issue qty in Saved Box too
  const { savedTotalOrderQty, savedTotalIssueQty } = useMemo(() => {
    const pgOrderMap = new Map<string, { order: number; issue: number }>();
    for (const item of savedBoxRows) {
      const pgKey = `${item.rec.factory}::${
        item.rec.pgNumber && item.rec.pgNumber !== '—'
          ? item.rec.pgNumber.toUpperCase()
          : item.rec.id
      }`;
      const ord = item.rec.plannedQty ?? 0;
      const iss = item.issueQty ?? ord;
      const prev = pgOrderMap.get(pgKey);
      if (!prev) {
        pgOrderMap.set(pgKey, { order: ord, issue: iss });
      } else {
        prev.order = Math.max(prev.order, ord);
        prev.issue = Math.max(prev.issue, iss);
      }
    }
    let orderSum = 0;
    let issueSum = 0;
    for (const v of pgOrderMap.values()) {
      orderSum += v.order;
      issueSum += v.issue;
    }
    return { savedTotalOrderQty: orderSum, savedTotalIssueQty: issueSum };
  }, [savedBoxRows]);

  const selectedSummaryTotalIssueQty = useMemo(
    () => savedBoxRows.reduce((sum, item) => sum + (item.issueQty ?? 0), 0),
    [savedBoxRows]
  );

  const handleDownloadSummaryBoxXlsx = async () => {
    if (downloadingSummaryBoxXlsx) return;
    setSummaryBoxDownloadError(null);
    setDownloadingSummaryBoxXlsx(true);
    try {
      const masterPlanAsOf =
        meta?.asOfDateRaw || (meta?.asOfDateIso ? formatDisplayDate(meta.asOfDateIso) : '—');
      const exportRows = savedBoxRows.map((item, idx) => {
        const rec = item.rec;
        return {
          sl: idx + 1,
          factory: rec.factory,
          line: rec.line,
          pgNumber: rec.pgNumber,
          style: rec.style,
          issueQty: item.issueQty,
          status: rec.lifecycleStage === 'Running' ? ('Running' as const) : ('Upcoming' as const),
          foDateNeededIso: item.foDateNeededIso,
          foStatus: getCompactSummaryFoStatus(rec).label,
        };
      });

      const response = await fetch(apiUrl('/api/export-selected-fo-summary-xlsx'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterPlanAsOf,
          referenceDateIso,
          rows: exportRows,
        }),
      });
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ALEX_FO_Needed_Checklist_${referenceDateIso}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setSummaryBoxDownloadError('Failed to download Summary Box Excel file. Please try again.');
    } finally {
      setDownloadingSummaryBoxXlsx(false);
    }
  };

  const visibleTargetIds = useMemo(() => {
    const ids = new Set<string>();
    if (tabMode === 'recent_fo') {
      for (const item of displayedPgRows) {
        for (const id of item.recordIds) ids.add(id);
      }
    } else if (tabMode === 'all_running') {
      for (const s of allRunningRows) {
        const targetId = s.upcomingRecord?.id ?? s.runningRecord?.id ?? null;
        if (targetId) ids.add(targetId);
      }
    }
    return Array.from(ids);
  }, [tabMode, displayedPgRows, allRunningRows]);

  const allVisibleTicked =
    visibleTargetIds.length > 0 &&
    (tabMode === 'recent_fo'
      ? displayedPgRows.every((item) => item.allSelected)
      : allRunningRows.every((s) => {
          const target = s.upcomingRecord ?? s.runningRecord;
          return target ? Boolean(target.upcomingFoSelected) : true;
        }));

  const scrollToSavedBox = () => {
    document
      .getElementById('saved-upcoming-fo-box')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleTogglePgChecklist = (item: PgFoChecklistItem, selected: boolean) => {
    if (item.recordIds.length === 1) {
      onToggleUpcomingFoSelection(item.recordIds[0], selected);
    } else {
      onBulkToggleUpcomingFoSelection(item.recordIds, selected);
    }
    if (selected) {
      setTopCheckNotice(
        `Ticked ${item.factory} · ${item.pgNumber} (${item.stageTag}) — collected in Saved Box below.`
      );
    } else {
      setTopCheckNotice(null);
    }
  };

  const handleToggleLineChecklist = (
    s: LineShortcutSummary,
    targetRecord: EvaluatedPlanningRecord,
    selected: boolean
  ) => {
    onToggleUpcomingFoSelection(targetRecord.id, selected);
    if (selected) {
      setTopCheckNotice(
        `Ticked ${s.factory} · ${s.line} (${targetRecord.pgNumber}) — collected in Saved Box below.`
      );
    } else {
      setTopCheckNotice(null);
    }
  };

  const handleExportSavedExcel = async () => {
    if (savedBoxRows.length === 0 || exportingSelected) return;
    setExportingSelected(true);
    setBoxNotice(null);
    const idsToExport = savedBoxRows.map((item) => item.rec.id);
    const ok = await onDownloadSelectedFoXlsx(idsToExport);
    setExportingSelected(false);
    if (ok) {
      setBoxNotice({
        ok: true,
        text: `Downloaded .xlsx with ${idsToExport.length} saved FO checklist item(s).`,
      });
    }
  };

  useEffect(() => {
    if (!emailSubjectEdited) {
      setEmailSubjectInput(
        buildDefaultSavedFoEmailSubject(savedBoxRows.length, referenceDateIso)
      );
    }
  }, [savedBoxRows.length, referenceDateIso, emailSubjectEdited]);

  const handleToggleRecipientChip = (email: string) => {
    const existing = emailToInput
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const existsLower = existing.some((s) => s.toLowerCase() === email.toLowerCase());
    const next = existsLower
      ? existing.filter((s) => s.toLowerCase() !== email.toLowerCase())
      : [...existing, email];
    setEmailToInput(next.join(', '));
  };

  const handleSendSavedBoxEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savedBoxRows.length === 0 || sendingSavedEmail) return;
    if (!emailToInput.trim()) {
      setBoxNotice({
        ok: false,
        text: 'Enter at least one recipient email address in the "To" field.',
      });
      return;
    }
    setSendingSavedEmail(true);
    setBoxNotice(null);
    const res = await onSendSavedFoEmail({
      toEmails: emailToInput.trim(),
      subject:
        emailSubjectInput.trim() ||
        buildDefaultSavedFoEmailSubject(savedBoxRows.length, referenceDateIso),
      bodyText: emailBodyInput,
      selectedRecordIds: savedBoxRows.map((item) => item.rec.id),
      attachXlsx: attachXlsxInput,
    });
    setSendingSavedEmail(false);
    setBoxNotice({ ok: res.ok, text: res.message });
    if (res.ok) {
      setShowEmailComposer(false);
    }
  };

  const parsedFoDraft = Number(foOffsetDraft);
  const parsedInputDraft = Number(inputOffsetDraft);
  const rulesDirty =
    Number.isFinite(parsedFoDraft) &&
    Number.isFinite(parsedInputDraft) &&
    (Math.round(parsedFoDraft) !== upcomingFoOffsetDays ||
      Math.round(parsedInputDraft) !== inputStartOffsetDays);

  const handleApplyRuleOffsets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdatePlanningRules || isEditingLocked || savingRules) return;
    const nextFo = Math.round(Number(foOffsetDraft));
    const nextInput = Math.round(Number(inputOffsetDraft));
    if (!Number.isFinite(nextFo) || nextFo < 1 || nextFo > 90) {
      setRuleStatusMsg({
        ok: false,
        text: 'FO Needed lead days must be between 1 and 90.',
      });
      return;
    }
    if (!Number.isFinite(nextInput) || nextInput < 1 || nextInput > 60) {
      setRuleStatusMsg({
        ok: false,
        text: 'Input Start offset days must be between 1 and 60.',
      });
      return;
    }
    setSavingRules(true);
    setRuleStatusMsg(null);
    const res = await onUpdatePlanningRules({
      upcomingFoOffsetDays: nextFo,
      inputStartOffsetDays: nextInput,
    });
    setSavingRules(false);
    if (res.ok) {
      setRuleStatusMsg({
        ok: true,
        text: `Updated rule: Input Start = End − ${nextInput}D · FO Needed = Input Start − ${nextFo}D`,
      });
    } else {
      setRuleStatusMsg({
        ok: false,
        text: res.error || 'Could not update planning rule.',
      });
    }
  };

  const pendingTopCount =
    tabMode === 'recent_fo'
      ? scopedPgItems.filter((p) => !p.allSelected).length
      : allRunningRows.length;

  return (
    <div className="space-y-6">
      {/* Control Tower Executive Summary Banner */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 text-white space-y-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
              <CalendarClock className="w-3.5 h-3.5 shrink-0" />
              <span>Daily PG-Wise FO &amp; Output Start Summary · {formatDisplayDate(referenceDateIso)}</span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-white">
              PG-Wise Fabric Order Summary (Running &amp; Upcoming Orders)
            </h2>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Tracks PG-wise Order/Issue Qty, Running Finish &amp; New Style Output Start (End + 1D), Input Start (End &minus; {inputStartOffsetDays}D), FO Date Needed (Input Start &minus; {upcomingFoOffsetDays}D), and marks completed PGs as FULL QTY RELEASED from sheet remarks.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-stretch gap-2.5 sm:gap-3 shrink-0">
            <div className="rounded-xl bg-slate-800/80 border border-slate-700 px-3.5 py-2.5 text-center sm:min-w-[140px]">
              <div className="text-[11px] text-slate-300">PG Issue Qty (= Order)</div>
              <div className="font-mono text-lg sm:text-xl font-bold text-blue-300 tabular-nums">
                {scopedPgSummary.totalPgIssueQty.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-300 font-mono">
                {scopedPgSummary.uniquePgCount} PGs · {scopedPgSummary.releasedPgCount} Released
              </div>
            </div>

            <div className="rounded-xl bg-slate-800/80 border border-slate-700 px-3.5 py-2.5 text-center sm:min-w-[120px]">
              <div className="text-[11px] text-slate-300">Recent FO Needed</div>
              <div className="font-mono text-lg sm:text-xl font-bold text-amber-300 tabular-nums">
                {totalRecentFoPgCount}
                <span className="text-xs font-normal text-slate-300 ml-1">
                  ({totalUrgentPgCount} now)
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-800/80 border border-slate-700 px-3.5 py-2.5 text-center sm:min-w-[105px]">
              <div className="text-[11px] text-slate-300">Running Set</div>
              <div className="font-mono text-lg sm:text-xl font-bold text-emerald-300 tabular-nums">
                {totalRunningSet}
                <span className="text-xs font-normal text-slate-300">/{totalLinesCount}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={scrollToSavedBox}
              className="rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 px-3.5 py-2.5 text-center sm:min-w-[105px] transition-colors cursor-pointer"
              title="Jump to Saved Upcoming FO Checklist Box below"
            >
              <div className="text-[11px] text-emerald-200 inline-flex items-center justify-center gap-1">
                <span>Saved Box</span>
                <ArrowDown className="w-3 h-3" />
              </div>
              <div className="font-mono text-lg sm:text-xl font-bold text-emerald-300 tabular-nums">
                {allSavedRecords.length}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTabMode(tabMode === 'set_running' ? 'recent_fo' : 'set_running')}
              className="col-span-2 sm:col-span-1 h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>
                {tabMode === 'set_running'
                  ? 'Back to PG FO Checklist'
                  : 'Set Running Styles'}
              </span>
            </button>
          </div>
        </div>

        {/* Inline Editable FO Lead Days & Input Start Rule Controls */}
        {onUpdatePlanningRules && (
          <form
            onSubmit={handleApplyRuleOffsets}
            className="pt-3 border-t border-white/15 flex flex-wrap items-center justify-between gap-3 text-xs"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-200">
                Editable FO Rule:
              </span>

              <label className="inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1">
                <span className="text-slate-200">FO Needed Before Input Start:</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={foOffsetDraft}
                  onChange={(e) => {
                    setFoOffsetDraft(e.target.value);
                    setRuleStatusMsg(null);
                  }}
                  disabled={isEditingLocked || savingRules}
                  aria-label="FO Needed Before Input Start Days"
                  className="w-14 h-7 px-1.5 rounded bg-slate-950/70 border border-white/25 text-white font-mono text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                />
                <span className="text-slate-300 font-mono">days</span>
              </label>

              <label className="inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1">
                <span className="text-slate-200">New Style Input Before End:</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={inputOffsetDraft}
                  onChange={(e) => {
                    setInputOffsetDraft(e.target.value);
                    setRuleStatusMsg(null);
                  }}
                  disabled={isEditingLocked || savingRules}
                  aria-label="New Style Input Before Running End Days"
                  className="w-14 h-7 px-1.5 rounded bg-slate-950/70 border border-white/25 text-white font-mono text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                />
                <span className="text-slate-300 font-mono">days</span>
              </label>

              <button
                type="submit"
                disabled={isEditingLocked || savingRules || !rulesDirty}
                className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {savingRules ? 'Saving...' : 'Apply Rule'}
              </button>
            </div>

            {ruleStatusMsg ? (
              <span
                className={`text-[11px] font-medium ${
                  ruleStatusMsg.ok ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {ruleStatusMsg.text}
              </span>
            ) : (
              <span className="text-[11px] text-slate-300 font-mono">
                Output Start = End + 1D · Input Start = End − {inputStartOffsetDays}D · FO = Input − {upcomingFoOffsetDays}D
              </span>
            )}
          </form>
        )}
      </section>

      {/* 4-Factory Summary Cards */}
      <section aria-label="Factory Upcoming FO Summary">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {factoryCards.map((card) => {
            const isSelected = selectedFactory === card.factory;
            const ear = card.earliestPg;

            return (
              <button
                key={card.factory}
                type="button"
                onClick={() => onSelectFactory(isSelected ? 'ALL' : card.factory)}
                className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-blue-600 ring-2 ring-blue-600/20 bg-blue-50/25'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                      <Factory className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="font-display text-sm font-bold text-slate-900">
                        {card.factory}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                        {card.runningSetCount}/{card.totalLines} running set
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="text-[11px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-md">
                      Active
                    </span>
                  )}
                </div>

                <div className="mt-3.5 flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-mono text-2xl font-bold tabular-nums ${
                        card.urgentCount > 0
                          ? 'text-red-700'
                          : card.dueSoonCount > 0
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                      }`}
                    >
                      {card.actionableCount}
                    </span>
                    <span className="text-xs text-slate-600 font-medium">
                      PG FO needed
                    </span>
                  </div>
                  {card.releasedCount > 0 && (
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded">
                      {card.releasedCount} Released
                    </span>
                  )}
                </div>

                <div className="mt-1.5 text-[11px] font-mono text-slate-600 tabular-nums">
                  PG Issue Qty: <span className="font-bold text-slate-900">{card.issueQty.toLocaleString()}</span> pcs
                </div>

                <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 text-xs space-y-1">
                  {ear ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">
                          {ear.pgNumber} · {ear.stageTag === 'RUNNING ORDER' ? 'RUN' : 'UP'}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-red-700 tabular-nums shrink-0">
                          FO: {formatDisplayDate(ear.foTriggerIso)}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate" title={ear.style}>
                        {ear.lines.join(', ')} · {ear.style}
                      </div>
                      {ear.newStyleOutputStartIso && (
                        <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
                          <span className="font-mono text-slate-700 tabular-nums">
                            Output: {formatDisplayDate(ear.newStyleOutputStartIso)}
                          </span>
                          {(() => {
                            const ocd = getOutputStartCountdown(ear.daysToNewStyleOutputStart);
                            return ocd ? (
                              <span className={`font-mono tabular-nums ${ocd.className}`}>
                                {ocd.label}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      )}
                      {ear.inputStartIso && (
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="font-mono text-slate-500 tabular-nums">
                            Input: {formatDisplayDate(ear.inputStartIso)}
                          </span>
                          {(() => {
                            const scd = getNewStyleStartCountdown(ear.daysToInputStart);
                            return scd ? (
                              <span className={`font-mono tabular-nums ${scd.className}`}>
                                {scd.label}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      )}
                    </>
                  ) : card.runningSetCount === 0 ? (
                    <div className="text-[11px] text-amber-700 font-medium">
                      Click &ldquo;Set Running Styles&rdquo; to assign active orders
                    </div>
                  ) : (
                    <div className="text-[11px] text-emerald-700 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>All active PGs Full Qty Released</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Focused Table Card */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm sm:text-base font-bold text-slate-900">
              {tabMode === 'recent_fo' &&
                `Recent PG-Wise FO Checklist (${pgRecentNeededCount} Recent Need · ${pgLaterCount} Later Step-by-Step · ${pgReleasedCount} Released)`}
              {tabMode === 'set_running' &&
                `Manual Running Style Selector (${scopedShortcuts.length} Lines)`}
              {tabMode === 'all_running' &&
                `All Active Running Lines (${allRunningRows.length} Lines)`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {tabMode === 'recent_fo' &&
                'Shows ONLY the immediate Running & Next Upcoming styles needing FO right now / within 15D (step by step — remaining queued styles appear automatically after Running finishes).'}
              {tabMode === 'set_running' &&
                'Choose the active Running Style for each line manually — the system automatically picks the immediate next style and calculates Output & FO dates.'}
              {tabMode === 'all_running' &&
                'Line-by-line overview of manually selected Running Styles, Output Start (End+1D), and immediate next styles.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tabMode === 'recent_fo' && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
                {[
                  { id: 'recent' as const, label: `Recent FO Needed (${pgRecentNeededCount})` },
                  { id: 'all' as const, label: `All Immediate (${scopedPgItems.length})` },
                  { id: 'released' as const, label: `Released (${pgReleasedCount})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setPgFilterMode(f.id)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      pgFilterMode === f.id
                        ? f.id === 'released'
                          ? 'bg-emerald-700 text-white'
                          : 'bg-blue-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {tabMode !== 'set_running' && allSavedRecords.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setHideSavedInTopTable((prev) => !prev)}
                  className={`h-8 px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                    !hideSavedInTopTable
                      ? 'bg-blue-50 border-blue-300 text-blue-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title="Toggle showing items already ticked & moved to the bottom box"
                >
                  {hideSavedInTopTable ? (
                    <Eye className="w-3.5 h-3.5" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {hideSavedInTopTable
                      ? `Show Saved (${allSavedRecords.length})`
                      : 'Move Saved Below'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={scrollToSavedBox}
                  className="h-8 px-3 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <BookmarkCheck className="w-3.5 h-3.5" />
                  <span>Saved Box ({savedBoxRows.length})</span>
                  <ArrowDown className="w-3 h-3" />
                </button>
              </>
            )}

            {savedBoxRows.length > 0 && (
              <button
                type="button"
                onClick={handleExportSavedExcel}
                disabled={exportingSelected}
                className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {exportingSelected
                    ? 'Exporting...'
                    : `Download Saved .xlsx (${savedBoxRows.length})`}
                </span>
              </button>
            )}

            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
              {[
                {
                  id: 'recent_fo' as const,
                  label: `PG FO Checklist (${scopedPgItems.length})`,
                },
                {
                  id: 'set_running' as const,
                  label: `Set Running (${totalRunningSet}/${totalLinesCount})`,
                },
                { id: 'all_running' as const, label: `All Running (${allRunningRows.length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTabMode(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                    tabMode === tab.id
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {topCheckNotice && tabMode !== 'set_running' && (
          <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{topCheckNotice}</span>
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={scrollToSavedBox}
                className="font-bold text-emerald-800 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Go to Saved Box</span>
                <ArrowDown className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => setTopCheckNotice(null)}
                className="text-emerald-700 hover:text-emerald-950 font-medium cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {tabMode === 'set_running' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 whitespace-nowrap">Factory · Line</th>
                  <th className="py-3 px-4 whitespace-nowrap">Select Manual Running Style</th>
                  <th className="py-3 px-4 whitespace-nowrap">Auto-Picked Next Style</th>
                  <th className="py-3 px-4 whitespace-nowrap">Running End / Output Start (+1D)</th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    New Style Input (End-{inputStartOffsetDays}D)
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    FO Date Needed (In-{upcomingFoOffsetDays}D)
                  </th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Reset</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs bg-white">
                {scopedShortcuts.map((s) => {
                  const key = `${s.factory}::${s.line}`;
                  const openOptions = lineSlotOptionsMap.get(key) ?? [];
                  const currentRunId = s.runningRecord?.id ?? '';

                  return (
                    <tr key={key} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {s.factory} · {s.line}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {s.capacityMc} Mc · {openOptions.length} open
                        </div>
                      </td>

                      <td className="py-3 px-4 min-w-[290px]">
                        <select
                          value={currentRunId}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) {
                              onClearLineRunning(s.factory, s.line);
                            } else {
                              onSetRunningStyle(val);
                            }
                          }}
                          aria-label={`Select running style for ${s.factory} ${s.line}`}
                          className={`w-full max-w-md h-9 px-2.5 rounded-lg border text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer ${
                            currentRunId
                              ? 'bg-blue-50/50 border-blue-300 text-slate-900'
                              : 'bg-amber-50/40 border-amber-300 text-slate-700'
                          }`}
                        >
                          <option value="">-- Select Active Running Style --</option>
                          {openOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              S{opt.slot} · {opt.pgNumber !== '—' ? `${opt.pgNumber} · ` : ''}
                              {opt.style} (End: {formatDisplayDate(opt.endDateIso)})
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="py-3 px-4 max-w-[240px]">
                        {s.upcomingRecord ? (
                          <div>
                            <div className="font-mono font-semibold text-teal-700">
                              {s.upcomingRecord.pgNumber} · Slot {s.upcomingRecord.slot}
                            </div>
                            <div className="text-slate-700 truncate" title={s.upcomingRecord.style}>
                              {s.upcomingRecord.style}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">
                            {currentRunId ? 'No open style after Running' : '—'}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-700">
                          End: {formatDisplayDate(s.runningRecord?.endDateIso ?? null)}
                        </div>
                        {s.newStyleOutputStartIso && (
                          <div className="text-[11px] text-indigo-700 font-semibold">
                            Out: {formatDisplayDate(s.newStyleOutputStartIso)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                        <div className="text-slate-800 font-medium">
                          {formatDisplayDate(s.newStyleInputStartIso)}
                        </div>
                        {(() => {
                          const scd = getNewStyleStartCountdown(s.daysToNewStyleInputStart);
                          return scd ? (
                            <div className={`text-[11px] ${scd.className}`}>{scd.label}</div>
                          ) : null;
                        })()}
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap font-semibold text-slate-900">
                        {formatDisplayDate(s.upcomingFoTriggerIso)}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {currentRunId ? (
                          <button
                            type="button"
                            onClick={() => onClearLineRunning(s.factory, s.line)}
                            className="px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 cursor-pointer"
                          >
                            Clear
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">Not set</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : tabMode === 'recent_fo' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-3 text-center whitespace-nowrap w-24">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allVisibleTicked}
                        disabled={visibleTargetIds.length === 0}
                        onChange={(e) => {
                          onBulkToggleUpcomingFoSelection(visibleTargetIds, e.target.checked);
                          if (e.target.checked && visibleTargetIds.length > 0) {
                            setTopCheckNotice(
                              `Ticked ${displayedPgRows.length} PG item(s) — collected in Saved Box below.`
                            );
                          }
                        }}
                        aria-label="Tick all visible PG FO rows to save in bottom box"
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer accent-emerald-600"
                      />
                      <span>Checklist</span>
                    </label>
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">Factory · Lines</th>
                  <th className="py-3 px-4 whitespace-nowrap">PG # · Stage (Running / Upcoming)</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Order &amp; Issue Qty (PG)</th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    Output Start (End+1D)
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    Input Start (End-{inputStartOffsetDays}D)
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    FO Date Needed (In-{upcomingFoOffsetDays}D)
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">FO Status &amp; Summary Remark</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs bg-white">
                {displayedPgRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 px-4 text-center space-y-3">
                      <div className="text-sm font-semibold text-slate-800">
                        {dateRangeActive
                          ? 'No records found for selected date range'
                          : totalRunningSet === 0 && scopedPgItems.length === 0
                            ? 'No Running Styles have been set manually yet.'
                            : hideSavedInTopTable && scopedPgItems.length > 0 && pendingTopCount === 0
                              ? `All ${scopedPgItems.length} PG items are ticked & saved in the bottom box.`
                              : 'No PG FO items match this filter right now.'}
                      </div>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        {dateRangeActive
                          ? 'Adjust the From/To Date or Date Field in Planning Filters above, or click Clear Date Filter.'
                          : totalRunningSet === 0 && scopedPgItems.length === 0
                            ? 'Click "Set Running Styles" above to pick active styles, or upload your factory Excel/CSV sheet to import PG Qty, Cutting & Summary Remarks.'
                            : 'Switch filter tabs or check your Saved Box below.'}
                      </p>
                      {totalRunningSet === 0 && (
                        <button
                          type="button"
                          onClick={() => setTabMode('set_running')}
                          className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          <span>Set Running Styles Now</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  displayedPgRows.map((item) => {
                    const ocd = getOutputStartCountdown(item.daysToNewStyleOutputStart);
                    const scd = getNewStyleStartCountdown(item.daysToInputStart);
                    const isRunningTag = item.stageTag === 'RUNNING ORDER';

                    const statusBadge = item.isFullQtyReleased
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : item.severity === 'critical'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : item.severity === 'warning'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : item.severity === 'upcoming'
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200';

                    return (
                      <tr
                        key={item.key}
                        className={`transition-colors ${
                          item.isFullQtyReleased
                            ? 'bg-emerald-50/35 hover:bg-emerald-50/65'
                            : item.allSelected
                              ? 'bg-emerald-50/45 hover:bg-emerald-50/75'
                              : 'hover:bg-blue-50/30'
                        }`}
                      >
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <label className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 cursor-pointer transition-colors select-none">
                            <input
                              type="checkbox"
                              checked={item.allSelected}
                              onChange={(e) => handleTogglePgChecklist(item, e.target.checked)}
                              aria-label={`Tick ${item.factory} ${item.pgNumber} (${item.stageTag}) to save in bottom box`}
                              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer accent-emerald-600"
                            />
                            <span className="text-[11px] font-semibold text-slate-700">
                              {item.allSelected ? 'Saved' : 'Save'}
                            </span>
                          </label>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-bold text-slate-900">{item.factory}</div>
                          <div className="text-[11px] text-slate-600 font-medium">
                            {item.lines.join(', ')}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                            {item.totalCapacityMc} Mc
                          </div>
                        </td>

                        <td className="py-3 px-4 max-w-[270px]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900 text-xs">
                              {item.pgNumber}
                            </span>
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border ${
                                isRunningTag
                                  ? 'bg-indigo-100 text-indigo-900 border-indigo-200'
                                  : 'bg-teal-100 text-teal-900 border-teal-200'
                              }`}
                            >
                              {item.stageTag}
                            </span>
                          </div>
                          <div className="text-slate-700 truncate mt-0.5" title={item.style}>
                            {item.style}
                          </div>
                          {item.cuttingAlertActive && !item.isFullQtyReleased && (
                            <div className="text-[11px] font-semibold text-red-700 mt-0.5">
                              Cutting {item.cuttingDaysRemaining ?? 0}D left
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            {item.orderQty !== null ? (
                              `Ord: ${item.orderQty.toLocaleString()}`
                            ) : (
                              <span className="text-amber-700 font-normal">Ord Pending</span>
                            )}
                          </div>
                          <div className="text-[11px] font-semibold text-indigo-700">
                            {item.issueQty !== null ? `Iss: ${item.issueQty.toLocaleString()}` : '—'}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          {item.runningEndIso && (
                            <div className="text-[10px] text-slate-500">
                              Run End: {formatDisplayDate(item.runningEndIso)}
                            </div>
                          )}
                          <div className="font-bold text-slate-900">
                            {formatDisplayDate(item.newStyleOutputStartIso)}
                          </div>
                          {ocd && <div className={`text-[11px] ${ocd.className}`}>{ocd.label}</div>}
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-800">
                            {formatDisplayDate(item.inputStartIso)}
                          </div>
                          {scd && <div className={`text-[11px] ${scd.className}`}>{scd.label}</div>}
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          {item.isFullQtyReleased ? (
                            <span className="text-emerald-700 font-semibold text-[11px]">
                              Completed
                            </span>
                          ) : (
                            <>
                              <div className="font-bold text-slate-900">
                                {formatDisplayDate(item.foTriggerIso)}
                              </div>
                              {item.daysToFoTrigger !== null && (
                                <div
                                  className={`text-[11px] ${
                                    item.daysToFoTrigger <= 0
                                      ? 'text-red-700 font-semibold'
                                      : item.daysToFoTrigger <= 15
                                        ? 'text-amber-700 font-medium'
                                        : 'text-slate-500'
                                  }`}
                                >
                                  {item.daysToFoTrigger === 0
                                    ? 'TODAY'
                                    : item.daysToFoTrigger < 0
                                      ? `${Math.abs(item.daysToFoTrigger)}d overdue`
                                      : `in ${item.daysToFoTrigger}d`}
                                </div>
                              )}
                            </>
                          )}
                        </td>

                        <td className="py-3 px-4 min-w-[230px]">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-bold whitespace-nowrap ${statusBadge}`}
                          >
                            {item.isFullQtyReleased && <CheckCircle2 className="w-3 h-3" />}
                            <span>{item.statusLabel}</span>
                          </span>
                          <div className="text-[11px] text-slate-600 mt-1">
                            {item.sheetRemark ? (
                              <span className="font-medium text-slate-800">
                                Remark: {item.sheetRemark}
                              </span>
                            ) : (
                              item.reasonLabel
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          {isRunningTag && item.recordIds.length === 1 && onAdvanceRunningOrder && (
                            <button
                              type="button"
                              disabled={isEditingLocked}
                              onClick={() => onAdvanceRunningOrder(item.recordIds[0])}
                              title="Close finished Running order & step up next queued style"
                              className="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-45 text-emerald-900 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Done &rarr; Next</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onSelectFactory(item.factory);
                              onSelectLine(item.lines[0] || 'ALL');
                              onNavigateTab('tracker');
                            }}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>FO Tracker</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-3 text-center whitespace-nowrap w-24">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allVisibleTicked}
                        disabled={visibleTargetIds.length === 0}
                        onChange={(e) => {
                          onBulkToggleUpcomingFoSelection(visibleTargetIds, e.target.checked);
                          if (e.target.checked && visibleTargetIds.length > 0) {
                            setTopCheckNotice(
                              `Ticked ${visibleTargetIds.length} item(s) — collected in Saved Box below.`
                            );
                          }
                        }}
                        aria-label="Tick all visible Running lines to save in bottom box"
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer accent-emerald-600"
                      />
                      <span>Checklist</span>
                    </label>
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">Factory · Line</th>
                  <th className="py-3 px-4 whitespace-nowrap">Running PG &amp; Style</th>
                  <th className="py-3 px-4 whitespace-nowrap">Next PG (FO Needed For)</th>
                  <th className="py-3 px-4 whitespace-nowrap">Output Start (End+1D)</th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    Input Start (End-{inputStartOffsetDays}D)
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">
                    FO Date Needed (In-{upcomingFoOffsetDays}D)
                  </th>
                  <th className="py-3 px-4 whitespace-nowrap">Status &amp; Reason</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs bg-white">
                {allRunningRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 px-4 text-center space-y-3">
                      <div className="text-sm font-semibold text-slate-800">
                        No active Running lines visible under current filter.
                      </div>
                    </td>
                  </tr>
                ) : (
                  allRunningRows.map((s) => {
                    const run = s.runningRecord;
                    const up = s.upcomingRecord;
                    const targetRecord = up ?? run ?? null;
                    const isTickedSaved = Boolean(targetRecord?.upcomingFoSelected);
                    const isReleased = Boolean(up?.isFullQtyReleased ?? run?.isFullQtyReleased);
                    const statusBadge = isReleased
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : s.summarySeverity === 'critical'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : s.summarySeverity === 'warning'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : s.summarySeverity === 'upcoming'
                            ? 'bg-blue-50 text-blue-800 border-blue-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200';
                    const ocd = getOutputStartCountdown(s.daysToNewStyleOutputStart);

                    return (
                      <tr
                        key={`${s.factory}-${s.line}`}
                        className={`transition-colors ${
                          isTickedSaved
                            ? 'bg-emerald-50/45 hover:bg-emerald-50/75'
                            : 'hover:bg-blue-50/30'
                        }`}
                      >
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {targetRecord ? (
                            <label className="inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 cursor-pointer transition-colors select-none">
                              <input
                                type="checkbox"
                                checked={isTickedSaved}
                                onChange={(e) =>
                                  handleToggleLineChecklist(s, targetRecord, e.target.checked)
                                }
                                aria-label={`Tick ${s.factory} ${s.line} ${targetRecord.pgNumber} to save in bottom box`}
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 cursor-pointer accent-emerald-600"
                              />
                              <span className="text-[11px] font-semibold text-slate-700">
                                {isTickedSaved ? 'Saved' : 'Save'}
                              </span>
                            </label>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            {s.factory} · {s.line}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {s.capacityMc} Mc
                          </div>
                        </td>

                        <td className="py-3 px-4 max-w-[230px]">
                          {run ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-slate-900">
                                  {run.pgNumber}
                                </span>
                                <span className="text-slate-300">·</span>
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  End {formatDisplayDate(run.endDateIso)}
                                </span>
                              </div>
                              <div className="text-slate-600 truncate" title={run.style}>
                                {run.style}
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-[240px]">
                          {up ? (
                            <>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-blue-700">
                                  {up.pgNumber}
                                </span>
                                <span className="text-slate-300">·</span>
                                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                                  Slot {up.slot} · {up.isFullQtyReleased ? 'FULL QTY RELEASED' : up.foStatus}
                                </span>
                              </div>
                              <div className="text-slate-800 font-medium truncate" title={up.style}>
                                {up.style}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400">No queued style after Running</span>
                          )}
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            {formatDisplayDate(s.newStyleOutputStartIso)}
                          </div>
                          {ocd && <div className={`text-[11px] ${ocd.className}`}>{ocd.label}</div>}
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-800">
                            {formatDisplayDate(s.newStyleInputStartIso)}
                          </div>
                          {(() => {
                            const scd = getNewStyleStartCountdown(s.daysToNewStyleInputStart);
                            return scd ? (
                              <div className={`text-[11px] ${scd.className}`}>{scd.label}</div>
                            ) : null;
                          })()}
                        </td>

                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            {formatDisplayDate(s.upcomingFoTriggerIso)}
                          </div>
                          {s.daysToUpcomingFoTrigger !== null && (
                            <div
                              className={`text-[11px] ${
                                s.daysToUpcomingFoTrigger <= 0
                                  ? 'text-red-700 font-semibold'
                                  : s.daysToUpcomingFoTrigger <= 15
                                    ? 'text-amber-700 font-medium'
                                    : 'text-slate-500'
                              }`}
                            >
                              {s.daysToUpcomingFoTrigger === 0
                                ? 'TODAY'
                                : s.daysToUpcomingFoTrigger < 0
                                  ? `${Math.abs(s.daysToUpcomingFoTrigger)}d overdue`
                                  : `in ${s.daysToUpcomingFoTrigger}d`}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 min-w-[210px]">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-bold whitespace-nowrap ${statusBadge}`}
                          >
                            {isReleased ? 'FULL QTY RELEASED' : s.summaryStatus}
                          </span>
                          <div className="text-[11px] text-slate-600 mt-1">{s.foNeedReason}</div>
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                          {run && onAdvanceRunningOrder && (
                            <button
                              type="button"
                              disabled={isEditingLocked}
                              onClick={() => onAdvanceRunningOrder(run.id)}
                              title="Close finished Running order & start Next style"
                              className="px-2.5 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-45 text-emerald-900 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Done &rarr; Next</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              onSelectFactory(s.factory);
                              onSelectLine(s.line);
                              onNavigateTab('tracker');
                            }}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>FO Tracker</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Separate Saved Upcoming FO Needed Shortlist Box */}
      <section
        id="saved-upcoming-fo-box"
        aria-label="Saved Upcoming FO Shortlist Box"
        className="bg-white border border-emerald-300 rounded-xl overflow-hidden shadow-xs"
      >
        <div className="px-4 sm:px-5 py-4 border-b border-emerald-200 bg-emerald-50/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0 mt-0.5">
              <BookmarkCheck className="w-4 h-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-sm sm:text-base font-bold text-slate-900">
                  Saved Upcoming FO Needed Box ({savedBoxRows.length}{' '}
                  {savedBoxRows.length === 1 ? 'Item' : 'Items'})
                </h3>
                {allSavedRecords.length !== savedBoxRows.length && (
                  <span className="text-[11px] font-medium text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                    {allSavedRecords.length} total across all factories
                  </span>
                )}
                {savedBoxRows.length > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-slate-700 bg-white border border-emerald-200 px-2.5 py-0.5 rounded-md tabular-nums">
                    Order: {savedTotalOrderQty.toLocaleString()} · Issue: {savedTotalIssueQty.toLocaleString()} pcs
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Tick any PG/row in the Checklist above to save it separately here. Download Excel (.xlsx) or send directly by email anytime.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {savedBoxRows.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const ids = savedBoxRows.map((i) => i.rec.id);
                  onBulkToggleUpcomingFoSelection(ids, false);
                  setBoxNotice(null);
                  setShowEmailComposer(false);
                }}
                className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Saved</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowEmailComposer((prev) => !prev)}
              disabled={savedBoxRows.length === 0}
              className={`h-9 px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 ${
                showEmailComposer
                  ? 'bg-slate-900 hover:bg-slate-800 text-white'
                  : 'bg-blue-700 hover:bg-blue-800 text-white'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>{showEmailComposer ? 'Close Email Box' : 'Send Email'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportSavedExcel}
              disabled={savedBoxRows.length === 0 || exportingSelected}
              className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>
                {exportingSelected
                  ? 'Building .xlsx...'
                  : `Download Saved .xlsx (${savedBoxRows.length})`}
              </span>
            </button>
          </div>
        </div>

        {boxNotice && (
          <div
            className={`px-5 py-2.5 border-b text-xs font-medium flex items-center justify-between gap-3 ${
              boxNotice.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <span>{boxNotice.text}</span>
            <button
              type="button"
              onClick={() => setBoxNotice(null)}
              className="font-semibold hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {showEmailComposer && savedBoxRows.length > 0 && (
          <form
            onSubmit={handleSendSavedBoxEmail}
            className="px-5 py-4 bg-slate-50/90 border-b border-emerald-200 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-xs sm:text-sm font-bold text-slate-900">
                  Email Saved Upcoming FO Shortlist ({savedBoxRows.length} Items)
                </h4>
                <p className="text-[11px] text-slate-500">
                  {smtpConfigured
                    ? `Sending via configured SMTP (${smtpSenderEmail || 'Active'}). Your editable body text appears above the formatted Saved FO table.`
                    : 'SMTP sender email is not configured yet — set it up in Email Reminders → Hosting Email Settings to deliver emails.'}
                </p>
              </div>
              {!smtpConfigured && (
                <button
                  type="button"
                  onClick={() => onNavigateTab('reminders')}
                  className="px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 text-[11px] font-semibold cursor-pointer"
                >
                  Open Email Settings &rarr;
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="saved-fo-email-to"
                  className="block text-[11px] font-semibold text-slate-700"
                >
                  To (Recipient Email Addresses, comma-separated) *
                </label>
                <input
                  id="saved-fo-email-to"
                  type="text"
                  value={emailToInput}
                  onChange={(e) => setEmailToInput(e.target.value)}
                  placeholder="fabric@alexapparels.com, merch@alexapparels.com"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {reminderRecipients.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-medium text-slate-500">Quick add:</span>
                    {reminderRecipients.map((r) => {
                      const active = emailToInput
                        .toLowerCase()
                        .includes(r.email.toLowerCase());
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => handleToggleRecipientChip(r.email)}
                          className={`px-2 py-0.5 rounded border text-[10px] font-medium cursor-pointer transition-colors ${
                            active
                              ? 'bg-blue-700 text-white border-blue-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {r.name ? `${r.name} (${r.email})` : r.email}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="saved-fo-email-subject"
                    className="block text-[11px] font-semibold text-slate-700"
                  >
                    Email Subject *
                  </label>
                  {emailSubjectEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setEmailSubjectEdited(false);
                        setEmailSubjectInput(
                          buildDefaultSavedFoEmailSubject(savedBoxRows.length, referenceDateIso)
                        );
                      }}
                      className="text-[10px] font-semibold text-blue-700 hover:underline cursor-pointer"
                    >
                      Reset Default Subject
                    </button>
                  )}
                </div>
                <input
                  id="saved-fo-email-subject"
                  type="text"
                  value={emailSubjectInput}
                  onChange={(e) => {
                    setEmailSubjectEdited(true);
                    setEmailSubjectInput(e.target.value);
                  }}
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="saved-fo-email-body"
                  className="block text-[11px] font-semibold text-slate-700"
                >
                  Standard Email Body Text (Editable — Saved Upcoming FO Table &amp; Summary Follow Below)
                </label>
                <button
                  type="button"
                  onClick={() => setEmailBodyInput(DEFAULT_SAVED_FO_EMAIL_BODY)}
                  className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                >
                  Reset Standard Text
                </button>
              </div>
              <textarea
                id="saved-fo-email-body"
                rows={7}
                value={emailBodyInput}
                onChange={(e) => setEmailBodyInput(e.target.value)}
                className="w-full p-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={attachXlsxInput}
                  onChange={(e) => setAttachXlsxInput(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600 accent-emerald-600 cursor-pointer"
                />
                <span>
                  Attach Excel file (
                  <span className="font-mono text-[11px]">
                    Selected_Upcoming_FO_List_{referenceDateIso}.xlsx
                  </span>
                  )
                </span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmailComposer(false)}
                  className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingSavedEmail || !emailToInput.trim()}
                  className="h-9 px-4 rounded-lg bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {sendingSavedEmail
                      ? 'Sending Email...'
                      : `Send Email (${savedBoxRows.length} Items)`}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}

        {savedBoxRows.length === 0 ? (
          <div className="py-8 px-5 text-center bg-white text-xs text-slate-500">
            No items saved here yet. Tick the checkbox next to any PG in{' '}
            <span className="font-semibold text-slate-800">PG-Wise FO Need Checklist</span> above to separate and save it here.
          </div>
        ) : (
          <div className="overflow-x-auto bg-white">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3 text-center whitespace-nowrap">#</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Factory · Line</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">PG # · Stage</th>
                  <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Order / Issue Qty</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Output Start (End+1D)</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">
                    Input Start (End-{inputStartOffsetDays}D)
                  </th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">
                    FO Date Needed (In-{upcomingFoOffsetDays}D)
                  </th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Status &amp; Remarks</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Saved On</th>
                  <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {savedBoxRows.map((item, idx) => {
                  const rec = item.rec;
                  const sevClass = rec.isFullQtyReleased
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    : item.severity === 'critical'
                      ? 'bg-red-50 text-red-800 border-red-200'
                      : item.severity === 'warning'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : item.severity === 'upcoming'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : 'bg-emerald-50 text-emerald-800 border-emerald-200';
                  const ocd = getOutputStartCountdown(item.daysToOutputStart);

                  return (
                    <tr key={rec.id} className="hover:bg-emerald-50/30 transition-colors">
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-400">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="font-bold text-slate-900">
                          {rec.factory} · {rec.line}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {rec.capacityMc} Mc
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 max-w-[230px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-emerald-800">
                            {rec.pgNumber}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                              rec.lifecycleStage === 'Running'
                                ? 'bg-indigo-100 text-indigo-900 border-indigo-200'
                                : 'bg-teal-100 text-teal-900 border-teal-200'
                            }`}
                          >
                            {rec.lifecycleStage === 'Running' ? 'RUNNING ORDER' : 'UPCOMING ORDER'}
                          </span>
                        </div>
                        <div className="text-slate-900 font-medium truncate mt-0.5" title={rec.style}>
                          {rec.style}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {rec.plannedQty !== null ? (
                            `Ord: ${rec.plannedQty.toLocaleString()}`
                          ) : (
                            <span className="text-amber-700 font-normal">Pending</span>
                          )}
                        </div>
                        <div className="text-[11px] text-indigo-700 font-semibold">
                          {item.issueQty !== null ? `Iss: ${item.issueQty.toLocaleString()}` : '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-slate-900">
                          {formatDisplayDate(item.outputStartIso)}
                        </div>
                        {ocd && <div className={`text-[11px] ${ocd.className}`}>{ocd.label}</div>}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-800">
                          {formatDisplayDate(item.inputStartIso)}
                        </div>
                        {(() => {
                          const scd = getNewStyleStartCountdown(item.daysToStartNewStyle);
                          return scd ? (
                            <div className={`text-[11px] ${scd.className}`}>{scd.label}</div>
                          ) : null;
                        })()}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap">
                        <div className="font-bold text-slate-900">
                          {formatDisplayDate(item.foDateNeededIso)}
                        </div>
                        {item.daysToFo !== null && (
                          <div
                            className={`text-[11px] ${
                              item.daysToFo <= 0
                                ? 'text-red-700 font-semibold'
                                : item.daysToFo <= 15
                                  ? 'text-amber-700 font-medium'
                                  : 'text-slate-500'
                            }`}
                          >
                            {item.daysToFo === 0
                              ? 'TODAY'
                              : item.daysToFo < 0
                                ? `${Math.abs(item.daysToFo)}d overdue`
                                : `in ${item.daysToFo}d`}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3.5 min-w-[190px]">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-bold whitespace-nowrap ${sevClass}`}
                        >
                          {item.statusLabel}
                        </span>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          FO: <span className="font-medium text-slate-700">{rec.foStatus}</span>
                          {rec.foNumber ? ` · #${rec.foNumber}` : ''}
                          {rec.sheetRemark ? ` · ${rec.sheetRemark}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap text-slate-600">
                        {rec.upcomingFoSelectedAtIso
                          ? formatDisplayDate(rec.upcomingFoSelectedAtIso.slice(0, 10))
                          : formatDisplayDate(referenceDateIso)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onToggleUpcomingFoSelection(rec.id, false)}
                          title="Untick & return back to PG FO Checklist above"
                          className="px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ADDITIONAL EXCEL-STYLE SUMMARY BOX — SELECTED FO NEEDED CHECKLIST (RUNNING + UPCOMING) */}
      <section
        id="selected-fo-summary-box"
        aria-label="Alex Apparels Selected FO Needed Checklist Summary"
        className="bg-white border border-slate-300 rounded-xl shadow-sm overflow-hidden"
      >
        {/* Title & Top Summary Header */}
        <div className="bg-[#0F172A] text-white px-4 py-3 sm:px-5">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between xl:justify-start gap-2 sm:gap-4">
              <h2 className="text-xs sm:text-sm font-bold tracking-wide uppercase">
                ALEX APPARELS — SELECTED FO NEEDED CHECKLIST (RUNNING + UPCOMING)
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-between xl:justify-end gap-x-4 gap-y-2 text-[11px] sm:text-xs text-slate-200">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Master Plan As Of:</span>
                  <span className="font-mono font-semibold text-white">
                    {meta?.asOfDateRaw ||
                      (meta?.asOfDateIso ? formatDisplayDate(meta.asOfDateIso) : '—')}
                  </span>
                </div>
                <span className="hidden sm:inline text-slate-600">|</span>
                <div className="inline-flex items-center gap-1.5">
                  <span className="text-slate-400 font-medium">Ref Date:</span>
                  <span className="font-mono font-semibold text-white">
                    {formatDisplayDate(referenceDateIso)}
                  </span>
                </div>
                <span className="hidden sm:inline text-slate-600">|</span>
                <div className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded">
                  <span className="text-slate-300 font-medium">Selected Items Count:</span>
                  <span className="font-mono font-bold text-emerald-300 tabular-nums">
                    {savedBoxRows.length}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadSummaryBoxXlsx}
                disabled={downloadingSummaryBoxXlsx}
                title="Download this Summary Box as Excel (.xlsx)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-sm border border-emerald-500/80 transition-colors cursor-pointer shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>
                  {downloadingSummaryBoxXlsx ? 'Preparing Excel...' : 'Download Excel'}
                </span>
              </button>
            </div>
          </div>
          {summaryBoxDownloadError && (
            <p className="mt-2 text-xs text-red-300 font-medium">{summaryBoxDownloadError}</p>
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
              {savedBoxRows.length === 0 ? (
                <tr className="bg-white">
                  <td
                    colSpan={8}
                    className="py-6 px-4 text-center text-xs text-slate-500 border-b border-slate-200"
                  >
                    No FO items selected yet for the active filter. Tick checkboxes in the{' '}
                    <span className="font-semibold text-slate-700">
                      PG-Wise FO Needed Checklist
                    </span>{' '}
                    above to populate this summary table.
                  </td>
                </tr>
              ) : (
                savedBoxRows.map((item, idx) => {
                  const rec = item.rec;
                  const stageIsRunning = rec.lifecycleStage === 'Running';
                  const foSummaryStatus = getCompactSummaryFoStatus(rec);

                  return (
                    <tr
                      key={`summary-row-${rec.id}`}
                      className="bg-white hover:bg-slate-50/90 transition-colors"
                    >
                      <td className="py-2 px-2.5 text-center font-mono tabular-nums text-slate-600 border-r border-slate-200">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        <div>{rec.factory}</div>
                        <div className="text-[10px] font-normal text-slate-500">{rec.line}</div>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        {rec.pgNumber}
                      </td>
                      <td
                        className="py-2 px-3 text-slate-800 border-r border-slate-200 max-w-[260px] truncate"
                        title={rec.style}
                      >
                        {rec.style}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 border-r border-slate-200 whitespace-nowrap">
                        {item.issueQty !== null ? (
                          item.issueQty.toLocaleString()
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
                          {stageIsRunning ? 'Running' : 'Upcoming'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-center font-mono tabular-nums text-slate-800 border-r border-slate-200 whitespace-nowrap">
                        {formatDisplayDate(item.foDateNeededIso)}
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        <span
                          title={
                            rec.isFullQtyReleased
                              ? 'Full Qty Released'
                              : `Current Status: ${rec.foStatus}`
                          }
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${foSummaryStatus.badgeClass}`}
                        >
                          {foSummaryStatus.label}
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
                    {savedBoxRows.length}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 border-r border-slate-200 whitespace-nowrap">
                  <div>{selectedSummaryTotalIssueQty.toLocaleString()} Pcs</div>
                  {savedTotalIssueQty !== selectedSummaryTotalIssueQty && (
                    <div className="text-[10px] font-normal text-slate-500">
                      PG Unique: {savedTotalIssueQty.toLocaleString()} Pcs
                    </div>
                  )}
                </td>
                <td colSpan={3} className="py-2.5 px-3 text-right text-[11px] font-medium text-slate-600">
                  Total Issue Qty:{' '}
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {selectedSummaryTotalIssueQty.toLocaleString()} Pcs
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
