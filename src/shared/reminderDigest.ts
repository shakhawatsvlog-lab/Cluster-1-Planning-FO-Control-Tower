import {
  ALLOWED_FACTORIES,
  buildLineShortcutSummaries,
  buildPgFoChecklistItems,
  computePgWiseQtySummary,
  evaluatePlanningRecords,
  formatDisplayDate,
  getEffectiveIssueQty,
} from './plannerTypes.ts';
import type {
  DailyCuttingEntry,
  FactoryName,
  LineShortcutSummary,
  MasterPlanMeta,
  PlanningRecord,
  PlanningRuleOptions,
} from './plannerTypes.ts';
import type { ReminderAlertScope } from './reminderTypes.ts';

export interface ShortcutEmailDigest {
  subject: string;
  html: string;
  text: string;
  urgentLineCount: number;
  dueSoonLineCount: number;
  cutting10dCount: number;
  includedRows: LineShortcutSummary[];
  factoryDigest: Array<{
    factory: FactoryName;
    totalLines: number;
    foNowCount: number;
    dueSoonCount: number;
    cutting10dCount: number;
    earliestNextPg: string;
    earliestFoTriggerDisplay: string;
    pgIssueQty: number;
    releasedPgCount: number;
  }>;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function filterShortcutsForScope(
  shortcuts: LineShortcutSummary[],
  alertScope: ReminderAlertScope,
  factoryFilter?: FactoryName[]
): LineShortcutSummary[] {
  const scopedByFactory =
    factoryFilter && factoryFilter.length > 0
      ? shortcuts.filter((s) => factoryFilter.includes(s.factory))
      : shortcuts;

  const filtered = scopedByFactory.filter((s) => {
    if (alertScope === 'urgent_only') {
      return s.hasManualRunning && (s.summarySeverity === 'critical' || s.cuttingAlertActive);
    }
    if (alertScope === 'urgent_and_due_soon') {
      return s.hasActionableUpcomingFo;
    }
    return s.hasManualRunning;
  });

  const sevOrder = { critical: 0, warning: 1, upcoming: 2, normal: 3 };
  return [...filtered].sort((a, b) => {
    if (sevOrder[a.summarySeverity] !== sevOrder[b.summarySeverity]) {
      return sevOrder[a.summarySeverity] - sevOrder[b.summarySeverity];
    }
    return (a.upcomingFoTriggerIso || '9999-12-31').localeCompare(
      b.upcomingFoTriggerIso || '9999-12-31'
    );
  });
}

export function buildShortcutEmailDigest(params: {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  alertScope: ReminderAlertScope;
  factoryFilter?: FactoryName[];
  customMessage?: string;
  recipientNote?: string;
  frequencyLabel?: string;
  appUrl?: string;
  ruleOptions?: PlanningRuleOptions;
}): ShortcutEmailDigest {
  const {
    meta,
    records,
    cuttingEntries,
    referenceDateIso,
    alertScope,
    factoryFilter,
    customMessage,
    recipientNote,
    frequencyLabel,
    appUrl,
    ruleOptions = {},
  } = params;

  const inputOffset = Math.max(1, ruleOptions.inputStartOffsetDays ?? 10);
  const foOffset = Math.max(1, ruleOptions.upcomingFoOffsetDays ?? 15);
  const cuttingAlert = Math.max(1, ruleOptions.cuttingAlertDays ?? 10);

  const evaluated = evaluatePlanningRecords(records, cuttingEntries, referenceDateIso, ruleOptions);
  const allShortcuts = buildLineShortcutSummaries(evaluated, referenceDateIso, ruleOptions);
  const pgChecklist = buildPgFoChecklistItems(evaluated, allShortcuts, referenceDateIso, ruleOptions);
  const pgQtySummary = computePgWiseQtySummary(pgChecklist);

  const activeFactories =
    factoryFilter && factoryFilter.length > 0 ? factoryFilter : ALLOWED_FACTORIES;

  const scopedShortcuts = allShortcuts.filter((s) => activeFactories.includes(s.factory));
  const includedRows = filterShortcutsForScope(allShortcuts, alertScope, factoryFilter);

  const urgentLineCount = scopedShortcuts.filter(
    (s) => s.summarySeverity === 'critical' || s.cuttingAlertActive
  ).length;
  const dueSoonLineCount = scopedShortcuts.filter(
    (s) => s.summarySeverity === 'warning'
  ).length;
  const cutting10dCount = scopedShortcuts.filter((s) => s.cuttingAlertActive).length;

  const scopedTotalIssueQty = activeFactories.reduce(
    (sum, fac) => sum + pgQtySummary.byFactory[fac].issueQty,
    0
  );
  const scopedReleasedPgCount = activeFactories.reduce(
    (sum, fac) => sum + pgQtySummary.byFactory[fac].releasedPgCount,
    0
  );

  const factoryDigest = activeFactories.map((factory) => {
    const lines = scopedShortcuts.filter((s) => s.factory === factory);
    const earliest = [...lines]
      .filter((s) => s.upcomingRecord !== null)
      .sort((a, b) =>
        (a.upcomingFoTriggerIso || '9999-12-31').localeCompare(
          b.upcomingFoTriggerIso || '9999-12-31'
        )
      )[0];

    return {
      factory,
      totalLines: lines.length,
      foNowCount: lines.filter((s) => s.summarySeverity === 'critical' || s.cuttingAlertActive)
        .length,
      dueSoonCount: lines.filter((s) => s.summarySeverity === 'warning').length,
      cutting10dCount: lines.filter((s) => s.cuttingAlertActive).length,
      earliestNextPg: earliest?.upcomingRecord?.pgNumber || '—',
      earliestFoTriggerDisplay: formatDisplayDate(earliest?.upcomingFoTriggerIso ?? null),
      pgIssueQty: pgQtySummary.byFactory[factory].issueQty,
      releasedPgCount: pgQtySummary.byFactory[factory].releasedPgCount,
    };
  });

  const dateDisplay = formatDisplayDate(referenceDateIso);
  const scopeLabel =
    factoryFilter && factoryFilter.length > 0 && factoryFilter.length < ALLOWED_FACTORIES.length
      ? factoryFilter.join(', ')
      : 'Cluster 1 (ALEX 1, 3, 5, 12)';
  const freqTitle = frequencyLabel ? `${frequencyLabel} ` : '';

  const subject = `[Alex Apparels] ${freqTitle}FO Reminder (${dateDisplay}) — ${urgentLineCount} Urgent, ${dueSoonLineCount} Due Soon | ${scopeLabel}`;

  const combinedNotes = [customMessage?.trim(), recipientNote?.trim()].filter(Boolean) as string[];
  const customNoteHtml =
    combinedNotes.length > 0
      ? `<div style="margin-bottom:16px;padding:12px 14px;background:#eff6ff;border-left:4px solid #1d4ed8;border-radius:6px;color:#0f172a;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#1e40af;margin-bottom:4px;">Manual Note / Instruction</div>
          <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(
            combinedNotes.join('\n\n')
          )}</div>
        </div>`
      : '';

  const tableRowsHtml =
    includedRows.length === 0
      ? `<tr><td colspan="8" style="padding:18px;text-align:center;color:#475569;font-size:13px;">No urgent or due-soon fabric orders for ${escapeHtml(dateDisplay)}. All active lines are currently on schedule.</td></tr>`
      : includedRows
          .map((s) => {
            const run = s.runningRecord;
            const up = s.upcomingRecord;
            const isReleased = Boolean(up?.isFullQtyReleased);
            const badgeBg = isReleased
              ? '#dcfce7'
              : s.summarySeverity === 'critical'
                ? '#fee2e2'
                : s.summarySeverity === 'warning'
                  ? '#fef3c7'
                  : s.summarySeverity === 'upcoming'
                    ? '#dbeafe'
                    : '#dcfce7';
            const badgeColor = isReleased
              ? '#166534'
              : s.summarySeverity === 'critical'
                ? '#991b1b'
                : s.summarySeverity === 'warning'
                  ? '#92400e'
                  : s.summarySeverity === 'upcoming'
                    ? '#1e40af'
                    : '#166534';

            const targetQty = up ? getEffectiveIssueQty(up) : run ? getEffectiveIssueQty(run) : null;
            const cutInfo = run
              ? run.plannedQty !== null && run.dailyTargetQty !== null && run.dailyTargetQty > 0
                ? `${run.cuttingFinishedQty.toLocaleString()} / ${run.plannedQty.toLocaleString()} (${run.cuttingDaysRemaining}D left)`
                : run.plannedQty !== null
                  ? `Order: ${run.plannedQty.toLocaleString()}`
                  : 'Order Qty Pending'
              : '—';

            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:10px 12px;font-size:12px;color:#0f172a;white-space:nowrap;">
                  <strong>${escapeHtml(s.factory)} · ${escapeHtml(s.line)}</strong><br/>
                  <span style="color:#64748b;font-size:11px;">${s.capacityMc} Mc</span>
                </td>
                <td style="padding:10px 12px;font-size:12px;color:#0f172a;">
                  ${
                    run
                      ? `<span style="display:inline-block;padding:1px 6px;background:#dbeafe;color:#1e40af;border-radius:3px;font-size:10px;font-weight:700;">RUNNING</span> <strong>${escapeHtml(run.pgNumber)}</strong> · End ${escapeHtml(
                          formatDisplayDate(run.endDateIso)
                        )}<br/><span style="color:#475569;">${escapeHtml(run.style)}</span>`
                      : '<span style="color:#94a3b8;">No active style</span>'
                  }
                </td>
                <td style="padding:10px 12px;font-size:12px;color:${
                  s.cuttingAlertActive ? '#991b1b' : '#334155'
                };white-space:nowrap;">
                  ${escapeHtml(cutInfo)}
                </td>
                <td style="padding:10px 12px;font-size:12px;color:#0f172a;">
                  ${
                    up
                      ? `<span style="display:inline-block;padding:1px 6px;background:#fef3c7;color:#92400e;border-radius:3px;font-size:10px;font-weight:700;">UPCOMING</span> <strong style="color:#1d4ed8;">${escapeHtml(up.pgNumber)}</strong><br/><span style="color:#334155;">${escapeHtml(up.style)}</span>${
                          targetQty !== null
                            ? `<br/><span style="color:#065f46;font-size:11px;font-weight:600;">Order / Issue: ${targetQty.toLocaleString()} pcs</span>`
                            : ''
                        }`
                      : '<span style="color:#94a3b8;">No upcoming style</span>'
                  }
                </td>
                <td style="padding:10px 12px;font-size:12px;color:#0f172a;white-space:nowrap;">
                  <strong>${escapeHtml(formatDisplayDate(s.newStyleOutputStartIso))}</strong>${
                    s.daysToNewStyleOutputStart !== null
                      ? `<br/><span style="font-size:11px;color:#047857;font-weight:600;">${
                          s.daysToNewStyleOutputStart === 0
                            ? 'Output TODAY'
                            : s.daysToNewStyleOutputStart < 0
                              ? `${Math.abs(s.daysToNewStyleOutputStart)}D passed`
                              : `${s.daysToNewStyleOutputStart}D to output`
                        }</span>`
                      : ''
                  }
                </td>
                <td style="padding:10px 12px;font-size:12px;color:#334155;white-space:nowrap;">
                  ${escapeHtml(formatDisplayDate(s.newStyleInputStartIso))}${
                    s.daysToNewStyleInputStart !== null
                      ? `<br/><span style="font-size:11px;color:${
                          s.daysToNewStyleInputStart <= 0
                            ? '#991b1b'
                            : s.daysToNewStyleInputStart <= 15
                              ? '#92400e'
                              : '#1e40af'
                        };font-weight:600;">${
                          s.daysToNewStyleInputStart === 0
                            ? 'Starts TODAY'
                            : s.daysToNewStyleInputStart < 0
                              ? `${Math.abs(s.daysToNewStyleInputStart)}D overdue`
                              : `${s.daysToNewStyleInputStart}D to input`
                        }</span>`
                      : ''
                  }
                </td>
                <td style="padding:10px 12px;font-size:12px;color:#0f172a;white-space:nowrap;">
                  <strong>${escapeHtml(formatDisplayDate(s.upcomingFoTriggerIso))}</strong>
                </td>
                <td style="padding:10px 12px;font-size:12px;">
                  <span style="display:inline-block;padding:3px 8px;border-radius:4px;background:${badgeBg};color:${badgeColor};font-weight:700;font-size:11px;">
                    ${escapeHtml(isReleased ? 'FULL QTY RELEASED' : s.summaryStatus)}
                  </span>
                  <div style="color:#475569;font-size:11px;margin-top:4px;">${escapeHtml(
                    s.foNeedReason
                  )}</div>
                </td>
              </tr>
            `;
          })
          .join('');

  const factoryCardsHtml = factoryDigest
    .map(
      (f) => `
      <td style="width:25%;padding:6px;vertical-align:top;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;">
          <div style="font-size:12px;font-weight:700;color:#0f172a;">${escapeHtml(f.factory)} (${
        f.totalLines
      }L)</div>
          <div style="margin-top:6px;font-size:18px;font-weight:700;color:${
            f.foNowCount > 0 ? '#b91c1c' : '#15803d'
          };">${f.foNowCount} <span style="font-size:11px;font-weight:500;color:#475569;">FO Now</span></div>
          <div style="margin-top:4px;font-size:11px;color:#475569;">Issue Qty: <strong>${f.pgIssueQty.toLocaleString()}</strong> · Rel: ${f.releasedPgCount}</div>
          <div style="margin-top:4px;font-size:11px;color:#475569;">Due Soon: ${
            f.dueSoonCount
          } · Cut &le;10D: ${f.cutting10dCount}</div>
          <div style="margin-top:4px;font-size:11px;color:#0f172a;">Earliest: <strong>${escapeHtml(
            f.earliestNextPg
          )}</strong> (${escapeHtml(f.earliestFoTriggerDisplay)})</div>
        </div>
      </td>
    `
    )
    .join('');

  const cleanAppUrl = appUrl && /^https?:\/\//i.test(appUrl) ? appUrl : '';

  const html = `
  <!doctype html>
  <html>
    <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:1040px;margin:20px auto;background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
        <div style="background:#0f172a;color:#ffffff;padding:20px 24px;">
          <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Alex Apparels · Cluster 1 Planning Control Tower</div>
          <h1 style="margin:6px 0 4px 0;font-size:19px;font-weight:700;color:#ffffff;">${escapeHtml(
    freqTitle
  )}Fabric Order Shortcut Summary</h1>
          <div style="font-size:12px;color:#cbd5e1;">
            Reminder Date: <strong>${escapeHtml(dateDisplay)}</strong> &nbsp;|&nbsp; Master Plan As Of: ${escapeHtml(
    meta.asOfDateRaw
  )} &nbsp;|&nbsp; Scope: ${escapeHtml(scopeLabel)} &nbsp;|&nbsp; PG Issue Qty (=Order): <strong>${scopedTotalIssueQty.toLocaleString()} pcs</strong> &nbsp;|&nbsp; Full Qty Released: <strong>${scopedReleasedPgCount}</strong>
          </div>
        </div>

        <div style="padding:18px 24px;">
          ${customNoteHtml}
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <tr>${factoryCardsHtml}</tr>
          </table>

          <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">
            Line-Wise Immediate Fabric Order Schedule (${includedRows.length} Lines)
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:12px;">
            Rule: New Style Output Starts Running End + 1D &nbsp;|&nbsp; Input Starts ${inputOffset} Days before Running End Date &nbsp;|&nbsp; Upcoming FO Trigger is ${foOffset} Days before Input Start &nbsp;|&nbsp; Cutting Alert triggers when &le; ${cuttingAlert} Days remaining.
          </div>

          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:2px solid #cbd5e1;">
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Factory · Line</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Running PG &amp; Style</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Cutting Progress</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Next PG &amp; Order/Issue Qty</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Output Start (End+1D)</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Input Start</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">FO Trigger</th>
                <th style="padding:9px 12px;text-align:left;font-size:11px;color:#475569;">Alert &amp; Remark</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>

          <div style="margin-top:16px;padding:10px 14px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;font-size:12px;color:#065f46;">
            <strong>Attached Excel Data File:</strong> Alex_Apparels_Cluster1_Planning_${escapeHtml(
              referenceDateIso
            )}.xlsx (download directly from this email for full PG-Wise Checklist, Line-Wise Plan, Daily Cutting &amp; FO Tracker sheets).
          </div>

          ${
            cleanAppUrl
              ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569;">
                  Open Live Planning Control Tower: <a href="${escapeHtml(
                    cleanAppUrl
                  )}" style="color:#1d4ed8;font-weight:600;">${escapeHtml(cleanAppUrl)}</a>
                </div>`
              : ''
          }
        </div>
      </div>
    </body>
  </html>`;

  const textLines: string[] = [
    `ALEX APPARELS — ${freqTitle.toUpperCase()}FABRIC ORDER SHORTCUT SUMMARY (${dateDisplay})`,
    `Scope: ${scopeLabel} | Master Plan As Of: ${meta.asOfDateRaw}`,
    `PG Total Issue Qty (=Order): ${scopedTotalIssueQty.toLocaleString()} pcs | Full Qty Released PGs: ${scopedReleasedPgCount}`,
    `Urgent FO Lines: ${urgentLineCount} | Due Soon: ${dueSoonLineCount} | Cutting <= 10D: ${cutting10dCount}`,
    `Attached Excel Data File: Alex_Apparels_Cluster1_Planning_${referenceDateIso}.xlsx`,
    ...(combinedNotes.length > 0
      ? ['', '--- MANUAL NOTE / INSTRUCTION ---', ...combinedNotes]
      : []),
    '',
    '--- FACTORY DIGEST ---',
    ...factoryDigest.map(
      (f) =>
        `${f.factory} (${f.totalLines}L): Issue Qty ${f.pgIssueQty.toLocaleString()} pcs, ${f.releasedPgCount} Released, ${f.foNowCount} FO Now, ${f.dueSoonCount} Due Soon | Earliest Next: ${f.earliestNextPg} (FO ${f.earliestFoTriggerDisplay})`
    ),
    '',
    `--- LINE-WISE IMMEDIATE FO SCHEDULE (${includedRows.length}) ---`,
    ...includedRows.map((s) => {
      const runPg = s.runningRecord?.pgNumber ?? '—';
      const runStyle = s.runningRecord?.style ?? 'No Running Style';
      const upPg = s.upcomingRecord?.pgNumber ?? '—';
      const upStyle = s.upcomingRecord?.style ?? 'No Upcoming Style';
      return `[${s.upcomingRecord?.isFullQtyReleased ? 'FULL QTY RELEASED' : s.summaryStatus}] ${s.factory} ${s.line} | Running: ${runPg} (${runStyle}) | Next: ${upPg} (${upStyle}) | Output Start: ${formatDisplayDate(
        s.newStyleOutputStartIso
      )} | Input Start: ${formatDisplayDate(
        s.newStyleInputStartIso
      )} | FO Trigger: ${formatDisplayDate(s.upcomingFoTriggerIso)} | ${s.foNeedReason}`;
    }),
  ];

  if (cleanAppUrl) {
    textLines.push('', `Dashboard URL: ${cleanAppUrl}`);
  }

  return {
    subject,
    html,
    text: textLines.join('\n'),
    urgentLineCount,
    dueSoonLineCount,
    cutting10dCount,
    includedRows,
    factoryDigest,
  };
}

