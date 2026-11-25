import { useMemo, useState } from 'react';
import {
  CalendarCheck2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Pencil,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import {
  FO_STATUS_OPTIONS,
  diffDaysIso,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type {
  EvaluatedPlanningRecord,
  FoStatus,
  LineShortcutSummary,
} from '../shared/plannerTypes.ts';

type ChecklistWindowMode = 'this_week' | 'next_14d' | 'all_open';

interface RowDraft {
  issueQty: string;
  issueDate: string;
  foNumber: string;
  fabricNote: string;
  error?: string;
}

interface FoChecklistViewProps {
  filteredRecords: EvaluatedPlanningRecord[];
  shortcutSummaries: LineShortcutSummary[];
  referenceDateIso: string;
  inputStartOffsetDays?: number;
  upcomingFoOffsetDays?: number;
  cuttingAlertDays?: number;
  onUpdateRecord: (
    id: string,
    patch: Partial<{
      foIssueQty: number | null;
      foDate: string;
      foNumber: string;
      foStatus: FoStatus;
      fabricNote: string;
      foChecklistConfirmed: boolean;
      foChecklistConfirmedAtIso: string | null;
    }>
  ) => void;
}

interface ChecklistCandidate {
  record: EvaluatedPlanningRecord;
  effectiveTriggerIso: string | null;
  daysLeft: number | null;
  triggerSourceLabel: string;
  runningRefLabel: string | null;
  isUrgent: boolean;
}

export function FoChecklistView({
  filteredRecords,
  shortcutSummaries,
  referenceDateIso,
  inputStartOffsetDays = 10,
  upcomingFoOffsetDays = 15,
  cuttingAlertDays = 10,
  onUpdateRecord,
}: FoChecklistViewProps) {
  const [windowMode, setWindowMode] = useState<ChecklistWindowMode>('this_week');
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [editingSavedId, setEditingSavedId] = useState<string | null>(null);
  const [savedEditQty, setSavedEditQty] = useState('');
  const [savedEditDate, setSavedEditDate] = useState('');
  const [savedEditFoNo, setSavedEditFoNo] = useState('');
  const [savedEditStatus, setSavedEditStatus] = useState<FoStatus>('FO Raised');
  const [savedEditNote, setSavedEditNote] = useState('');
  const [savedEditError, setSavedEditError] = useState<string | null>(null);

  const shortcutByUpcomingId = useMemo(() => {
    const map = new Map<string, LineShortcutSummary>();
    for (const s of shortcutSummaries) {
      if (s.upcomingRecord) {
        map.set(s.upcomingRecord.id, s);
      }
    }
    return map;
  }, [shortcutSummaries]);

  const { pendingItems, confirmedItems } = useMemo(() => {
    const pending: ChecklistCandidate[] = [];
    const confirmed: EvaluatedPlanningRecord[] = [];

    for (const rec of filteredRecords) {
      if (rec.orderStatus === 'Order Closed') continue;

      if (rec.foChecklistConfirmed) {
        confirmed.push(rec);
        continue;
      }

      if (rec.styleClassification === 'Open Capacity') continue;

      const upcomingShortcut = shortcutByUpcomingId.get(rec.id);
      const effectiveTriggerIso =
        upcomingShortcut?.upcomingFoTriggerIso ?? rec.triggerDateIso;
      const daysLeft = effectiveTriggerIso
        ? diffDaysIso(effectiveTriggerIso, referenceDateIso)
        : null;

      const isStepActive =
        rec.lifecycleStage === 'Running' || rec.lifecycleStage === 'Upcoming (Next)';

      const isUrgent =
        rec.isCuttingWithin10Days ||
        (daysLeft !== null && daysLeft <= 0) ||
        (isStepActive && rec.foRequired);

      let includeInWindow = false;
      if (windowMode === 'this_week') {
        includeInWindow =
          rec.isCuttingWithin10Days ||
          (isStepActive && daysLeft !== null && daysLeft <= 7);
      } else if (windowMode === 'next_14d') {
        includeInWindow =
          rec.isCuttingWithin10Days ||
          (isStepActive && daysLeft !== null && daysLeft <= 14);
      } else {
        includeInWindow = true;
      }

      if (!includeInWindow) continue;

      const triggerSourceLabel = rec.isCuttingWithin10Days
        ? `Cutting <= ${cuttingAlertDays}D (${rec.cuttingDaysRemaining ?? '?'}D left)`
        : upcomingShortcut
          ? `Upcoming Next Style (In-${upcomingFoOffsetDays}D)`
          : `Planned End - ${inputStartOffsetDays}D`;

      const runningRefLabel = upcomingShortcut?.runningRecord
        ? `After ${upcomingShortcut.runningRecord.pgNumber} (End ${formatDisplayDate(
            upcomingShortcut.runningRecord.endDateIso
          )})`
        : null;

      pending.push({
        record: rec,
        effectiveTriggerIso,
        daysLeft,
        triggerSourceLabel,
        runningRefLabel,
        isUrgent,
      });
    }

    pending.sort((a, b) => {
      const aUrg = a.isUrgent ? 0 : 1;
      const bUrg = b.isUrgent ? 0 : 1;
      if (aUrg !== bUrg) return aUrg - bUrg;
      return (a.effectiveTriggerIso || '9999-12-31').localeCompare(
        b.effectiveTriggerIso || '9999-12-31'
      );
    });

    confirmed.sort((a, b) => {
      const dateA = a.foDate || a.foChecklistConfirmedAtIso || '';
      const dateB = b.foDate || b.foChecklistConfirmedAtIso || '';
      return dateB.localeCompare(dateA);
    });

    return { pendingItems: pending, confirmedItems: confirmed };
  }, [
    filteredRecords,
    shortcutByUpcomingId,
    referenceDateIso,
    windowMode,
    inputStartOffsetDays,
    upcomingFoOffsetDays,
    cuttingAlertDays,
  ]);

  const totalConfirmedQty = useMemo(
    () =>
      confirmedItems.reduce((sum, r) => sum + (r.foIssueQty !== null ? r.foIssueQty : 0), 0),
    [confirmedItems]
  );

  const getDraft = (rec: EvaluatedPlanningRecord): RowDraft => {
    const existing = drafts[rec.id];
    if (existing) return existing;
    return {
      issueQty:
        rec.foIssueQty !== null
          ? String(rec.foIssueQty)
          : rec.plannedQty !== null
            ? String(rec.plannedQty)
            : '',
      issueDate: rec.foDate && /^\d{4}-\d{2}-\d{2}$/.test(rec.foDate) ? rec.foDate : referenceDateIso,
      foNumber: rec.foNumber || '',
      fabricNote: rec.fabricNote || '',
    };
  };

  const updateDraft = (rec: EvaluatedPlanningRecord, patch: Partial<RowDraft>) => {
    setDrafts((prev) => {
      const base = prev[rec.id] ?? getDraft(rec);
      return {
        ...prev,
        [rec.id]: {
          ...base,
          ...patch,
          error: patch.error !== undefined ? patch.error : undefined,
        },
      };
    });
  };

  const handleConfirmOk = (rec: EvaluatedPlanningRecord) => {
    const draft = getDraft(rec);
    const trimmedQty = draft.issueQty.trim();
    if (!trimmedQty) {
      updateDraft(rec, { error: 'Enter Issued Qty before clicking OK.' });
      return;
    }
    const numericQty = Number(trimmedQty);
    if (!Number.isFinite(numericQty) || numericQty < 0) {
      updateDraft(rec, { error: 'Issued Qty must be 0 or greater.' });
      return;
    }
    if (!draft.issueDate) {
      updateDraft(rec, { error: 'Select Issue Date.' });
      return;
    }

    onUpdateRecord(rec.id, {
      foIssueQty: Math.round(numericQty),
      foDate: draft.issueDate,
      foNumber: draft.foNumber.trim(),
      fabricNote: draft.fabricNote.trim(),
      foStatus: 'FO Raised',
      foChecklistConfirmed: true,
      foChecklistConfirmedAtIso: new Date().toISOString(),
    });

    setDrafts((prev) => {
      const next = { ...prev };
      delete next[rec.id];
      return next;
    });
  };

  const startEditSaved = (rec: EvaluatedPlanningRecord) => {
    setEditingSavedId(rec.id);
    setSavedEditQty(rec.foIssueQty !== null ? String(rec.foIssueQty) : '');
    setSavedEditDate(rec.foDate || referenceDateIso);
    setSavedEditFoNo(rec.foNumber || '');
    setSavedEditStatus(rec.foStatus || 'FO Raised');
    setSavedEditNote(rec.fabricNote || '');
    setSavedEditError(null);
  };

  const handleSaveEditedRecord = (recId: string) => {
    const trimmedQty = savedEditQty.trim();
    const numericQty = Number(trimmedQty);
    if (!trimmedQty || !Number.isFinite(numericQty) || numericQty < 0) {
      setSavedEditError('Please enter a valid Issued Qty.');
      return;
    }
    if (!savedEditDate) {
      setSavedEditError('Please select an Issue Date.');
      return;
    }
    onUpdateRecord(recId, {
      foIssueQty: Math.round(numericQty),
      foDate: savedEditDate,
      foNumber: savedEditFoNo.trim(),
      foStatus: savedEditStatus,
      fabricNote: savedEditNote.trim(),
      foChecklistConfirmed: true,
    });
    setEditingSavedId(null);
    setSavedEditError(null);
  };

  const handleUndoToChecklist = (recId: string) => {
    onUpdateRecord(recId, {
      foChecklistConfirmed: false,
      foChecklistConfirmedAtIso: null,
      foStatus: 'Pending',
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="ct-surface rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Pending FO Checklist</span>
            <span className="w-2 h-2 rounded-full bg-amber-500" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {pendingItems.length}
          </div>
          <div className="text-[11px] text-amber-800 mt-1">
            {windowMode === 'this_week'
              ? 'Due within 7 days & urgent'
              : windowMode === 'next_14d'
                ? 'Due within 14 days & urgent'
                : 'All open styles waiting check'}
          </div>
        </div>

        <div className="ct-surface rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Issued &amp; Checked (OK Saved)</span>
            <span className="w-2 h-2 rounded-full bg-teal-600" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-teal-700 tabular-nums">
            {confirmedItems.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Saved in Verified Box below
          </div>
        </div>

        <div className="ct-surface rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Total FO Qty Issued (Saved)</span>
            <span className="w-2 h-2 rounded-full bg-cyan-600" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-bold text-cyan-800 tabular-nums">
            {totalConfirmedQty.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Synced automatically to FO Tracker &amp; Excel
          </div>
        </div>

        <div className="ct-exec-banner rounded-2xl p-4 text-white">
          <div className="text-xs font-medium text-cyan-200">Checklist Reference Date</div>
          <div className="mt-1.5 font-mono text-xl font-bold text-white tabular-nums">
            {formatDisplayDate(referenceDateIso)}
          </div>
          <div className="text-[11px] text-slate-300 mt-1">
            Enter Issued Qty + Date &amp; click OK to confirm
          </div>
        </div>
      </div>

      {/* Box 1: Weekly Pending Fabric Order Checklist */}
      <section className="ct-surface rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 bg-slate-50/75">
          <div className="flex items-start gap-2.5">
            <ClipboardCheck className="w-5 h-5 text-cyan-700 mt-0.5 shrink-0" />
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
                Weekly Fabric Order Checklist ({pendingItems.length} Pending Check)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Verify this week&rsquo;s Fabric Orders. Enter how much Qty was issued, select Issue Date, and click <span className="font-semibold text-teal-700">OK</span> to move it into the Saved Box below.
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 gap-1">
            <button
              type="button"
              onClick={() => setWindowMode('this_week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                windowMode === 'this_week'
                  ? 'bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              This Week (&le; 7D)
            </button>
            <button
              type="button"
              onClick={() => setWindowMode('next_14d')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                windowMode === 'next_14d'
                  ? 'bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Next 14 Days
            </button>
            <button
              type="button"
              onClick={() => setWindowMode('all_open')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                windowMode === 'all_open'
                  ? 'bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              All Open Styles
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3.5">Factory · Line</th>
                <th className="py-2.5 px-3.5">PG # &amp; Style</th>
                <th className="py-2.5 px-3.5">FO Trigger &amp; Urgency</th>
                <th className="py-2.5 px-3.5 text-right">Order Qty</th>
                <th className="py-2.5 px-3.5">Issued Qty *</th>
                <th className="py-2.5 px-3.5">Issue Date *</th>
                <th className="py-2.5 px-3.5">FO # / Remarks</th>
                <th className="py-2.5 px-3.5 text-right">Confirm</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {pendingItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 px-4 text-center text-slate-500">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                    <div className="text-sm font-semibold text-slate-800">
                      All matching Fabric Orders for this window are checked off!
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Switch to &ldquo;Next 14 Days&rdquo; or &ldquo;All Open Styles&rdquo; above if you want to check upcoming orders early, or view confirmed items in the Saved Box below.
                    </p>
                  </td>
                </tr>
              ) : (
                pendingItems.map((item) => {
                  const { record: rec, effectiveTriggerIso, daysLeft, triggerSourceLabel, runningRefLabel } = item;
                  const draft = getDraft(rec);

                  const dayBadge =
                    daysLeft === null
                      ? 'Pending Date'
                      : daysLeft < 0
                        ? `Overdue ${Math.abs(daysLeft)}D`
                        : daysLeft === 0
                          ? 'Due Today'
                          : `In ${daysLeft}D`;

                  const badgeCls =
                    rec.isCuttingWithin10Days || (daysLeft !== null && daysLeft <= 0)
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : daysLeft !== null && daysLeft <= 7
                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-blue-50 border-blue-200 text-blue-800';

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/70 align-top">
                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {rec.factory} · {rec.line}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Slot {rec.slot} · {rec.lifecycleStage}
                        </div>
                      </td>

                      <td className="py-3 px-3.5 max-w-[260px]">
                        <div className="font-mono font-bold text-blue-700">{rec.pgNumber}</div>
                        <div className="text-slate-800 font-medium leading-snug break-words">
                          {rec.style}
                        </div>
                        {runningRefLabel && (
                          <div className="text-[11px] text-slate-500 mt-0.5">{runningRefLabel}</div>
                        )}
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${badgeCls}`}
                        >
                          {dayBadge}
                        </span>
                        <div className="font-mono text-[11px] text-slate-700 mt-1">
                          FO: {formatDisplayDate(effectiveTriggerIso)}
                        </div>
                        <div className="text-[10px] text-slate-400">{triggerSourceLabel}</div>
                      </td>

                      <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {rec.plannedQty !== null ? (
                          <span className="font-semibold text-slate-900">
                            {rec.plannedQty.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-amber-700">Pending</span>
                        )}
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <input
                          type="number"
                          min={0}
                          value={draft.issueQty}
                          onChange={(e) => updateDraft(rec, { issueQty: e.target.value })}
                          placeholder="Qty issued"
                          aria-label={`Issued Qty for ${rec.pgNumber}`}
                          className="w-28 h-9 px-2.5 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        />
                        {draft.error && (
                          <div className="text-[11px] text-red-700 mt-1 max-w-[140px] whitespace-normal">
                            {draft.error}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap">
                        <input
                          type="date"
                          value={draft.issueDate}
                          onChange={(e) => updateDraft(rec, { issueDate: e.target.value })}
                          aria-label={`Issue Date for ${rec.pgNumber}`}
                          className="h-9 px-2 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        />
                      </td>

                      <td className="py-3 px-3.5">
                        <div className="space-y-1.5 min-w-[155px]">
                          <input
                            type="text"
                            value={draft.foNumber}
                            onChange={(e) => updateDraft(rec, { foNumber: e.target.value })}
                            placeholder="FO # (optional)"
                            className="w-full h-8 px-2 rounded border border-slate-300 bg-white font-mono text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          />
                          <input
                            type="text"
                            value={draft.fabricNote}
                            onChange={(e) => updateDraft(rec, { fabricNote: e.target.value })}
                            placeholder="Remarks / Yarn note"
                            className="w-full h-8 px-2 rounded border border-slate-300 bg-white text-[11px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          />
                        </div>
                      </td>

                      <td className="py-3 px-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleConfirmOk(rec)}
                          className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>OK</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Box 2: Separate Saved OK Box (Confirmed FO Issued History) */}
      <section className="ct-surface rounded-2xl overflow-hidden !border-teal-300/80">
        <div className="px-4 sm:px-5 py-4 border-b border-teal-200/80 bg-teal-50/55 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CalendarCheck2 className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-display text-sm sm:text-base font-bold text-emerald-950">
                FO Issued &amp; Verified — Saved Box ({confirmedItems.length})
              </h3>
              <p className="text-xs text-emerald-800 mt-0.5">
                Confirmed Fabric Orders checked with <span className="font-semibold">OK</span>, including exact Issued Qty and Issue Date.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="px-3 py-1.5 rounded-lg bg-white border border-emerald-200 text-emerald-900 font-semibold tabular-nums">
              Total Issued Qty: {totalConfirmedQty.toLocaleString()}
            </span>
          </div>
        </div>

        {savedEditError && (
          <div className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {savedEditError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 px-3.5">Factory · Line</th>
                <th className="py-2.5 px-3.5">PG # &amp; Style</th>
                <th className="py-2.5 px-3.5 text-right">Order Qty</th>
                <th className="py-2.5 px-3.5 text-right">Issued Qty</th>
                <th className="py-2.5 px-3.5">Issue Date</th>
                <th className="py-2.5 px-3.5">FO # &amp; Status</th>
                <th className="py-2.5 px-3.5">Remarks</th>
                <th className="py-2.5 px-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {confirmedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 px-4 text-center text-slate-500">
                    No checked-off FO issuances saved yet. Enter Issued Qty and Issue Date in the Checklist above and click <span className="font-semibold text-emerald-700">OK</span>.
                  </td>
                </tr>
              ) : (
                confirmedItems.map((rec) => {
                  const isEditing = editingSavedId === rec.id;
                  if (isEditing) {
                    return (
                      <tr key={rec.id} className="bg-emerald-50/40">
                        <td className="py-2.5 px-3.5 whitespace-nowrap font-semibold text-slate-900">
                          {rec.factory} · {rec.line}
                        </td>
                        <td className="py-2.5 px-3.5 max-w-[230px]">
                          <div className="font-mono font-bold text-slate-900">{rec.pgNumber}</div>
                          <div className="text-slate-600 truncate">{rec.style}</div>
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono text-slate-600">
                          {rec.plannedQty !== null ? rec.plannedQty.toLocaleString() : '—'}
                        </td>
                        <td className="py-2.5 px-3.5 text-right">
                          <input
                            type="number"
                            min={0}
                            value={savedEditQty}
                            onChange={(e) => setSavedEditQty(e.target.value)}
                            className="w-24 h-8 px-2 rounded border border-slate-300 bg-white font-mono text-xs text-right"
                          />
                        </td>
                        <td className="py-2.5 px-3.5">
                          <input
                            type="date"
                            value={savedEditDate}
                            onChange={(e) => setSavedEditDate(e.target.value)}
                            className="h-8 px-2 rounded border border-slate-300 bg-white font-mono text-xs"
                          />
                        </td>
                        <td className="py-2.5 px-3.5 space-y-1">
                          <input
                            type="text"
                            value={savedEditFoNo}
                            onChange={(e) => setSavedEditFoNo(e.target.value)}
                            placeholder="FO #"
                            className="w-28 h-8 px-2 rounded border border-slate-300 bg-white font-mono text-xs"
                          />
                          <select
                            value={savedEditStatus}
                            onChange={(e) => setSavedEditStatus(e.target.value as FoStatus)}
                            className="w-28 h-8 px-2 rounded border border-slate-300 bg-white text-xs"
                          >
                            {FO_STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-3.5">
                          <input
                            type="text"
                            value={savedEditNote}
                            onChange={(e) => setSavedEditNote(e.target.value)}
                            placeholder="Remarks"
                            className="w-full min-w-[140px] h-8 px-2 rounded border border-slate-300 bg-white text-xs"
                          />
                        </td>
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => handleSaveEditedRecord(rec.id)}
                            className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Save className="w-3 h-3" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSavedId(null);
                              setSavedEditError(null);
                            }}
                            aria-label="Cancel edit"
                            className="p-1 rounded border border-slate-300 bg-white text-slate-600 hover:text-slate-900 align-middle cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={rec.id} className="hover:bg-emerald-50/20">
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="font-semibold text-slate-900">
                          {rec.factory} · {rec.line}
                        </div>
                        <div className="text-[11px] text-slate-400">Slot {rec.slot}</div>
                      </td>
                      <td className="py-2.5 px-3.5 max-w-[240px]">
                        <div className="font-mono font-semibold text-slate-900">{rec.pgNumber}</div>
                        <div className="text-slate-600 truncate" title={rec.style}>
                          {rec.style}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-600">
                        {rec.plannedQty !== null ? rec.plannedQty.toLocaleString() : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 font-mono font-bold text-emerald-800 tabular-nums">
                          {rec.foIssueQty !== null ? rec.foIssueQty.toLocaleString() : '0'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums whitespace-nowrap font-semibold text-slate-800">
                        {rec.foDate ? formatDisplayDate(rec.foDate) : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <div className="font-mono text-slate-900 font-semibold">
                          {rec.foNumber || 'OK Verified'}
                        </div>
                        <div className="text-[11px] text-emerald-700 font-medium">
                          {rec.foStatus}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-600 max-w-[200px] truncate" title={rec.fabricNote}>
                        {rec.fabricNote || '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => startEditSaved(rec)}
                          aria-label={`Edit issued qty for ${rec.pgNumber}`}
                          className="p-1.5 rounded border border-slate-200 text-slate-500 hover:text-blue-700 hover:border-blue-200 hover:bg-blue-50 align-middle cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUndoToChecklist(rec.id)}
                          title="Move back to Weekly Checklist"
                          className="px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-medium inline-flex items-center gap-1 align-middle cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Undo</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
