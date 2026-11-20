import ExcelJS from 'exceljs';
import {
  ALLOWED_FACTORIES,
  FO_STATUS_OPTIONS,
  ORDER_STATUS_OPTIONS,
  buildLineShortcutSummaries,
  evaluatePlanningRecords,
  isoToUtcDate,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  EvaluatedPlanningRecord,
  FactoryName,
  MasterPlanMeta,
  PlanningRecord,
} from '../shared/plannerTypes.ts';

const COLORS = {
  navyDark: 'FF0F172A',
  navyHeader: 'FF1E293B',
  indigoAccent: 'FF1D4ED8',
  slateLight: 'FFF1F5F9',
  slateBorder: 'FFCBD5E1',
  white: 'FFFFFFFF',
  inputFill: 'FFFFFBEB',
  amberFill: 'FFFEF3C7',
  amberText: 'FF92400E',
  redFill: 'FFFEE2E2',
  redText: 'FF991B1B',
  greenFill: 'FFDCFCE7',
  greenText: 'FF166534',
  blueFill: 'FFDBEAFE',
  blueText: 'FF1E40AF',
  textPrimary: 'FF0F172A',
  textMuted: 'FF475569',
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLORS.slateBorder } },
  left: { style: 'thin', color: { argb: COLORS.slateBorder } },
  bottom: { style: 'thin', color: { argb: COLORS.slateBorder } },
  right: { style: 'thin', color: { argb: COLORS.slateBorder } },
};

function styleHeaderRow(row: ExcelJS.Row, colCount: number, fillArgb = COLORS.navyDark) {
  row.height = 28;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  }
}

function applyRiskCellStyle(cell: ExcelJS.Cell, riskTier: EvaluatedPlanningRecord['riskTier']) {
  if (riskTier === 'closed') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.textMuted } };
  } else if (riskTier === 'plan_qty_pending') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberFill } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberText } };
  } else if (riskTier === 'critical') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.redFill } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.redText } };
  } else if (riskTier === 'high') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberFill } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberText } };
  } else if (riskTier === 'on_track') {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenFill } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.greenText } };
  } else {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blueFill } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.blueText } };
  }
}

export async function buildPlanningWorkbookBuffer(
  meta: MasterPlanMeta,
  records: PlanningRecord[],
  referenceDateIso: string,
  cuttingEntries: DailyCuttingEntry[] = []
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Alex Apparels — Cluster 1 Planning Control Tower';
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const evaluated = evaluatePlanningRecords(records, cuttingEntries, referenceDateIso);
  const shortcutSummaries = buildLineShortcutSummaries(evaluated, referenceDateIso);

  const uniqueLineMap = new Map<string, { factory: FactoryName; line: string; capacityMc: number }>();
  for (const r of records) {
    const key = `${r.factory}::${r.line}`;
    if (!uniqueLineMap.has(key)) {
      uniqueLineMap.set(key, {
        factory: r.factory,
        line: r.line,
        capacityMc: r.capacityMc,
      });
    }
  }
  const uniqueLines = Array.from(uniqueLineMap.values());
  const allUniqueLineNames = Array.from(new Set(uniqueLines.map((u) => u.line)));

  const wsDashboard = workbook.addWorksheet('KPI Dashboard', {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: COLORS.indigoAccent } },
  });
  const wsDb = workbook.addWorksheet('Planning Database', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 1 }],
    properties: { tabColor: { argb: COLORS.navyHeader } },
  });
  const wsTracker = workbook.addWorksheet('Fabric Order Tracker', {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
    properties: { tabColor: { argb: 'FF0369A1' } },
  });
  const wsCuttingLog = workbook.addWorksheet('Daily Cutting Log', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: 'FF0F766E' } },
  });
  const wsFoReq = workbook.addWorksheet('FO Required', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { tabColor: { argb: 'FFD97706' } },
  });
  const wsActionReq = workbook.addWorksheet('Action Required', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { tabColor: { argb: 'FFDC2626' } },
  });
  const wsLists = workbook.addWorksheet('Lists', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { tabColor: { argb: 'FF64748B' } },
  });

  // =========================================================================
  // 7. LISTS SHEET
  // =========================================================================
  wsLists.getRow(1).values = [
    'Factory Filter',
    'Line Filter',
    'FO Status Options',
    'Dir Factory',
    'Dir Line',
    'Dir Capacity (Mc)',
    'Order Status Options',
  ];
  styleHeaderRow(wsLists.getRow(1), 7, COLORS.navyHeader);

  const factoryList = ['All Factories', ...ALLOWED_FACTORIES];
  const lineFilterList = ['All Lines', ...allUniqueLineNames];
  const maxListRows = Math.max(
    factoryList.length,
    lineFilterList.length,
    FO_STATUS_OPTIONS.length,
    ORDER_STATUS_OPTIONS.length,
    uniqueLines.length
  );

  for (let i = 0; i < maxListRows; i++) {
    const r = wsLists.getRow(i + 2);
    r.getCell(1).value = factoryList[i] ?? null;
    r.getCell(2).value = lineFilterList[i] ?? null;
    r.getCell(3).value = FO_STATUS_OPTIONS[i] ?? null;
    if (uniqueLines[i]) {
      r.getCell(4).value = uniqueLines[i].factory;
      r.getCell(5).value = uniqueLines[i].line;
      r.getCell(6).value = uniqueLines[i].capacityMc;
      r.getCell(6).numFmt = '#,##0';
    }
    r.getCell(7).value = ORDER_STATUS_OPTIONS[i] ?? null;
    for (let c = 1; c <= 7; c++) {
      r.getCell(c).font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
      r.getCell(c).border = THIN_BORDER;
    }
  }
  wsLists.columns = [
    { width: 18 },
    { width: 20 },
    { width: 18 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 20 },
  ];

  const dirEndRow = uniqueLines.length + 1;
  const lineFilterEndRow = lineFilterList.length + 1;
  const factoryFilterEndRow = factoryList.length + 1;

  // =========================================================================
  // 4. DAILY CUTTING LOG SHEET
  // =========================================================================
  const cuttingHeaders = [
    'Entry ID',
    'Cutting Date',
    'Record ID',
    'Factory',
    'Line',
    'PG #',
    'Style',
    'Cutting Qty',
    'Remarks',
  ];
  wsCuttingLog.getRow(1).values = cuttingHeaders;
  styleHeaderRow(wsCuttingLog.getRow(1), cuttingHeaders.length, 'FF0F766E');

  const cuttingLogLastRow = Math.max(2, cuttingEntries.length + 1);
  cuttingEntries.forEach((entry, idx) => {
    const rNum = idx + 2;
    const row = wsCuttingLog.getRow(rNum);
    row.height = 21;
    const dt = isoToUtcDate(entry.dateIso);

    row.getCell(1).value = entry.id;
    row.getCell(2).value = dt ?? entry.dateIso;
    if (dt) row.getCell(2).numFmt = 'dd-mmm-yy';
    row.getCell(3).value = entry.recordId;
    row.getCell(4).value = entry.factory;
    row.getCell(5).value = entry.line;
    row.getCell(6).value = entry.pgNumber;
    row.getCell(7).value = entry.style;
    row.getCell(8).value = entry.cuttingQty;
    row.getCell(8).numFmt = '#,##0';
    row.getCell(9).value = entry.remarks || null;

    for (let c = 1; c <= cuttingHeaders.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: c === 8 ? 'right' : [1, 2, 3, 4, 5, 6].includes(c) ? 'center' : 'left',
      };
    }
  });
  wsCuttingLog.columns = [
    { width: 16 },
    { width: 14 },
    { width: 18 },
    { width: 11 },
    { width: 13 },
    { width: 13 },
    { width: 38 },
    { width: 14 },
    { width: 26 },
  ];

  // =========================================================================
  // 2. PLANNING DATABASE SHEET (Line-Wise)
  // =========================================================================
  const dbHeaders = [
    'Record ID',
    'Factory',
    'Zone',
    'Line',
    'Capacity (Mc)',
    'Line Category',
    'Slot #',
    'Lifecycle Stage',
    'PG #',
    'Current / Planned Style',
    'Order Status',
    'Order / Planned Qty',
    'End Date',
    'Trigger Date (End - 10D)',
    'Days to Trigger',
    'Action Required',
    'Risk Status',
    'Next Style on Line',
  ];
  wsDb.getRow(1).values = dbHeaders;
  styleHeaderRow(wsDb.getRow(1), dbHeaders.length, COLORS.navyDark);

  const dbRowById = new Map<string, number>();
  const dbLastRow = evaluated.length + 1;

  evaluated.forEach((rec, idx) => {
    const rNum = idx + 2;
    dbRowById.set(rec.id, rNum);
    const row = wsDb.getRow(rNum);
    row.height = 22;

    const endDt = isoToUtcDate(rec.endDateIso);
    const triggerDt = isoToUtcDate(rec.triggerDateIso);

    row.getCell(1).value = rec.id;
    row.getCell(2).value = rec.factory;
    row.getCell(3).value = rec.zone;
    row.getCell(4).value = rec.line;
    row.getCell(5).value = rec.capacityMc;
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).value = rec.productCategory;
    row.getCell(7).value = rec.slot;
    row.getCell(7).numFmt = '0';
    row.getCell(8).value = rec.lifecycleStage;
    row.getCell(9).value = rec.pgNumber;
    row.getCell(10).value = rec.style;

    // K: Order Status (Open / Order Closed dropdown)
    row.getCell(11).value = rec.orderStatus;
    row.getCell(11).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`=Lists!$G$2:$G$${ORDER_STATUS_OPTIONS.length + 1}`],
    };
    row.getCell(11).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.inputFill },
    };

    // L: Order / Planned Qty (editable input cell)
    row.getCell(12).value = rec.plannedQty !== null ? rec.plannedQty : null;
    row.getCell(12).numFmt = '#,##0';
    row.getCell(12).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.inputFill },
    };

    // M: End Date (editable)
    row.getCell(13).value = endDt ?? rec.endDateRaw;
    if (endDt) row.getCell(13).numFmt = 'dd-mmm-yy';
    row.getCell(13).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.inputFill },
    };

    // N: Trigger Date = End Date - 10 Days
    row.getCell(14).value = {
      formula: `IF(ISNUMBER(M${rNum}),M${rNum}-10,"")`,
      result: triggerDt ?? undefined,
    };
    row.getCell(14).numFmt = 'dd-mmm-yy';

    // O: Days to Trigger
    row.getCell(15).value = {
      formula: `IF(ISNUMBER(N${rNum}),N${rNum}-TODAY(),"")`,
      result: rec.daysToTrigger ?? undefined,
    };
    row.getCell(15).numFmt = '0';

    // P: Action Required
    row.getCell(16).value = {
      formula: `IF(OR(K${rNum}="Order Closed",H${rNum}="Order Closed"),"ORDER CLOSED",IF(ISBLANK(L${rNum}),"FO NEED - TAKE ACTION AS PER PLAN",IF(O${rNum}<=0,"URGENT - RAISE FO IMMEDIATELY",IF(O${rNum}<=14,"RAISE FABRIC ORDER BEFORE TRIGGER","SCHEDULE FABRIC ORDER PER TRIGGER"))))`,
      result: rec.actionMessage,
    };

    // Q: Risk Status
    row.getCell(17).value = {
      formula: `IF(OR(K${rNum}="Order Closed",H${rNum}="Order Closed"),"ORDER CLOSED",IF(ISBLANK(L${rNum}),"⚠ PLAN QTY PENDING",IF(O${rNum}<=0,"CRITICAL - OVERDUE TRIGGER",IF(O${rNum}<=14,"HIGH RISK - DUE <= 14 DAYS","MONITORING - TRIGGER > 14D"))))`,
      result: rec.riskStatus,
    };

    row.getCell(18).value = rec.nextStyle;

    for (let c = 1; c <= dbHeaders.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      if (![11, 12, 13, 17].includes(c)) {
        cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
        }
      }
      if ([1, 2, 3, 4, 7, 8, 9, 11, 13, 14, 15].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if ([5, 12].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }

    applyRiskCellStyle(row.getCell(17), rec.riskTier);
    if (rec.plannedQty === null && rec.orderStatus !== 'Order Closed') {
      row.getCell(16).font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.amberText } };
    }
  });

  wsDb.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: dbLastRow, column: dbHeaders.length },
  };
  wsDb.columns = [
    { width: 17 },
    { width: 11 },
    { width: 11 },
    { width: 14 },
    { width: 13 },
    { width: 22 },
    { width: 8 },
    { width: 16 },
    { width: 12 },
    { width: 38 },
    { width: 15 },
    { width: 16 },
    { width: 13 },
    { width: 20 },
    { width: 15 },
    { width: 34 },
    { width: 26 },
    { width: 34 },
  ];

  // =========================================================================
  // 3. FABRIC ORDER TRACKER SHEET
  // =========================================================================
  const trackerHeaders = [
    'Record ID',
    'Factory',
    'Line',
    'Capacity (Mc)',
    'Lifecycle Stage',
    'PG #',
    'Style',
    'Order Qty',
    'FO Issue Qty',
    'Cutting Finished Qty',
    'Daily Target Qty',
    'Cutting Days Left',
    'End Date',
    'Trigger Date (End - 10D)',
    'FO Number',
    'FO Date',
    'FO Status',
    'FO Required',
    'Action Required',
    'Risk Status',
    'Order Status',
  ];
  wsTracker.getRow(1).values = trackerHeaders;
  styleHeaderRow(wsTracker.getRow(1), trackerHeaders.length, 'FF0369A1');

  evaluated.forEach((rec, idx) => {
    const rNum = idx + 2;
    const dbR = dbRowById.get(rec.id) ?? rNum;
    const row = wsTracker.getRow(rNum);
    row.height = 22;

    const endDt = isoToUtcDate(rec.endDateIso);
    const triggerDt = isoToUtcDate(rec.triggerDateIso);

    row.getCell(1).value = { formula: `'Planning Database'!A${dbR}`, result: rec.id };
    row.getCell(2).value = { formula: `'Planning Database'!B${dbR}`, result: rec.factory };
    row.getCell(3).value = { formula: `'Planning Database'!D${dbR}`, result: rec.line };
    row.getCell(4).value = { formula: `'Planning Database'!E${dbR}`, result: rec.capacityMc };
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).value = { formula: `'Planning Database'!H${dbR}`, result: rec.lifecycleStage };
    row.getCell(6).value = { formula: `'Planning Database'!I${dbR}`, result: rec.pgNumber };
    row.getCell(7).value = { formula: `'Planning Database'!J${dbR}`, result: rec.style };

    // H: Order Qty
    row.getCell(8).value = {
      formula: `IF(ISBLANK('Planning Database'!L${dbR}),"",'Planning Database'!L${dbR})`,
      result: rec.plannedQty ?? undefined,
    };
    row.getCell(8).numFmt = '#,##0';

    // I: FO Issue Qty
    row.getCell(9).value = rec.foIssueQty !== null ? rec.foIssueQty : null;
    row.getCell(9).numFmt = '#,##0';

    // J: Cutting Finished Qty (Base + SUMIFS from Daily Cutting Log)
    row.getCell(10).value = {
      formula: `${rec.cuttingBaseQty ?? 0}+SUMIFS('Daily Cutting Log'!$H$2:$H$${cuttingLogLastRow},'Daily Cutting Log'!$C$2:$C$${cuttingLogLastRow},A${rNum})`,
      result: rec.cuttingFinishedQty,
    };
    row.getCell(10).numFmt = '#,##0';

    // K: Daily Target Qty
    row.getCell(11).value = rec.dailyTargetQty !== null ? rec.dailyTargetQty : null;
    row.getCell(11).numFmt = '#,##0';

    // L: Cutting Days Left
    row.getCell(12).value = {
      formula: `IF(AND(ISNUMBER(H${rNum}),ISNUMBER(K${rNum}),K${rNum}>0),ROUNDUP(MAX(0,H${rNum}-J${rNum})/K${rNum},0),"")`,
      result: rec.cuttingDaysRemaining ?? undefined,
    };
    row.getCell(12).numFmt = '0';

    // M: End Date
    row.getCell(13).value = { formula: `'Planning Database'!M${dbR}`, result: endDt ?? undefined };
    row.getCell(13).numFmt = 'dd-mmm-yy';

    // N: Trigger Date (End - 10D)
    row.getCell(14).value = {
      formula: `IF(ISNUMBER(M${rNum}),M${rNum}-10,"")`,
      result: triggerDt ?? undefined,
    };
    row.getCell(14).numFmt = 'dd-mmm-yy';

    // O, P, Q: FO Number, FO Date, FO Status
    row.getCell(15).value = rec.foNumber || null;
    row.getCell(16).value = rec.foDate || null;
    row.getCell(17).value = rec.foStatus;
    row.getCell(17).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`=Lists!$C$2:$C$${FO_STATUS_OPTIONS.length + 1}`],
    };

    // U: Order Status (linked to Planning Database!K)
    row.getCell(21).value = {
      formula: `'Planning Database'!K${dbR}`,
      result: rec.orderStatus,
    };

    // R: FO Required
    row.getCell(18).value = {
      formula: `IF(OR(U${rNum}="Order Closed",E${rNum}="Order Closed"),"NO",IF(OR(ISBLANK('Planning Database'!L${dbR}),Q${rNum}="Pending",Q${rNum}="Delayed"),"YES","NO"))`,
      result: rec.foRequired ? 'YES' : 'NO',
    };

    // S: Action Required
    row.getCell(19).value = {
      formula: `IF(OR(U${rNum}="Order Closed",E${rNum}="Order Closed"),"ORDER CLOSED",IF(ISBLANK('Planning Database'!L${dbR}),"FO NEED - TAKE ACTION AS PER PLAN",IF(AND(ISNUMBER(L${rNum}),L${rNum}<=10,Q${rNum}="Pending"),"CUTTING <= 10D — FABRIC ORDER NEEDED",IF(Q${rNum}="In-House","FABRIC IN-HOUSE - READY FOR LINE",IF(Q${rNum}="FO Raised",IF(N${rNum}<=TODAY(),"EXPEDITE RAISED FO - TRIGGER PASSED","FO RAISED - TRACK EX-MILL DELIVERY"),IF(Q${rNum}="Delayed","ESCALATE DELAYED FABRIC ORDER",IF(N${rNum}<=TODAY(),"URGENT - RAISE FO IMMEDIATELY",IF(N${rNum}<=TODAY()+14,"RAISE FABRIC ORDER BEFORE TRIGGER","SCHEDULE FABRIC ORDER PER TRIGGER"))))))))`,
      result: rec.actionMessage,
    };

    // T: Risk Status
    row.getCell(20).value = {
      formula: `IF(OR(U${rNum}="Order Closed",E${rNum}="Order Closed"),"ORDER CLOSED",IF(ISBLANK('Planning Database'!L${dbR}),"⚠ PLAN QTY PENDING",IF(AND(ISNUMBER(L${rNum}),L${rNum}<=10,Q${rNum}="Pending"),"CRITICAL - CUTTING <= 10D",IF(Q${rNum}="In-House","ON TRACK",IF(Q${rNum}="FO Raised",IF(N${rNum}<=TODAY(),"WATCH - TRIGGER PASSED","FO IN PROGRESS"),IF(Q${rNum}="Delayed","CRITICAL - FO DELAYED",IF(N${rNum}<=TODAY(),"CRITICAL - OVERDUE TRIGGER",IF(N${rNum}<=TODAY()+14,"HIGH RISK - DUE <= 14 DAYS","MONITORING - TRIGGER > 14D"))))))))`,
      result: rec.riskStatus,
    };

    for (let c = 1; c <= trackerHeaders.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      if ([9, 11, 15, 16, 17].includes(c)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inputFill } };
        cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
      } else if (c !== 20) {
        cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
        }
      }

      if ([1, 2, 3, 5, 6, 13, 14, 15, 16, 17, 18, 21].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if ([4, 8, 9, 10, 11, 12].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }

    applyRiskCellStyle(row.getCell(20), rec.riskTier);
  });

  wsTracker.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: dbLastRow, column: trackerHeaders.length },
  };
  wsTracker.columns = [
    { width: 17 },
    { width: 11 },
    { width: 14 },
    { width: 12 },
    { width: 16 },
    { width: 12 },
    { width: 36 },
    { width: 13 },
    { width: 14 },
    { width: 17 },
    { width: 15 },
    { width: 15 },
    { width: 13 },
    { width: 19 },
    { width: 14 },
    { width: 13 },
    { width: 14 },
    { width: 12 },
    { width: 34 },
    { width: 26 },
    { width: 15 },
  ];

  // =========================================================================
  // 5. FO REQUIRED SHEET
  // =========================================================================
  const foRequiredRows = evaluated
    .filter((r) => r.foRequired)
    .sort((a, b) => {
      if (a.isCurrentStyle !== b.isCurrentStyle) return a.isCurrentStyle ? -1 : 1;
      return (a.triggerDateIso || '9999-12-31').localeCompare(b.triggerDateIso || '9999-12-31');
    });

  wsFoReq.mergeCells('A1:M1');
  wsFoReq.getCell('A1').value =
    'ALEX APPARELS — FABRIC ORDER (FO) REQUIRED LIST (ALEX 1, ALEX 3, ALEX 5 & ALEX 12)';
  wsFoReq.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.white } };
  wsFoReq.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
  wsFoReq.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsFoReq.getRow(1).height = 28;

  wsFoReq.mergeCells('A2:M2');
  wsFoReq.getCell('A2').value =
    'Prioritized by Running Style & Earliest Trigger Date. Blank Order/Planned Qty triggers "FO NEED - TAKE ACTION AS PER PLAN".';
  wsFoReq.getCell('A2').font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.textMuted } };
  wsFoReq.getRow(2).height = 20;

  const foHeaders = [
    'Priority #',
    'Record ID',
    'Factory',
    'Line',
    'Cap (Mc)',
    'Lifecycle',
    'PG #',
    'Style',
    'Order Qty',
    'End Date',
    'Trigger Date (End - 10D)',
    'Action Required',
    'Risk Status',
  ];
  wsFoReq.getRow(3).values = foHeaders;
  styleHeaderRow(wsFoReq.getRow(3), foHeaders.length, 'FFB45309');

  foRequiredRows.forEach((rec, idx) => {
    const rNum = idx + 4;
    const dbR = dbRowById.get(rec.id) ?? 2;
    const row = wsFoReq.getRow(rNum);
    row.height = 22;

    row.getCell(1).value = idx + 1;
    row.getCell(2).value = { formula: `'Planning Database'!A${dbR}`, result: rec.id };
    row.getCell(3).value = { formula: `'Planning Database'!B${dbR}`, result: rec.factory };
    row.getCell(4).value = { formula: `'Planning Database'!D${dbR}`, result: rec.line };
    row.getCell(5).value = { formula: `'Planning Database'!E${dbR}`, result: rec.capacityMc };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).value = { formula: `'Planning Database'!H${dbR}`, result: rec.lifecycleStage };
    row.getCell(7).value = { formula: `'Planning Database'!I${dbR}`, result: rec.pgNumber };
    row.getCell(8).value = { formula: `'Planning Database'!J${dbR}`, result: rec.style };
    row.getCell(9).value = {
      formula: `IF(ISBLANK('Planning Database'!L${dbR}),"",'Planning Database'!L${dbR})`,
      result: rec.plannedQty ?? undefined,
    };
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).value = {
      formula: `'Planning Database'!M${dbR}`,
      result: isoToUtcDate(rec.endDateIso) ?? undefined,
    };
    row.getCell(10).numFmt = 'dd-mmm-yy';
    row.getCell(11).value = {
      formula: `'Planning Database'!N${dbR}`,
      result: isoToUtcDate(rec.triggerDateIso) ?? undefined,
    };
    row.getCell(11).numFmt = 'dd-mmm-yy';
    row.getCell(12).value = { formula: `'Fabric Order Tracker'!S${dbR}`, result: rec.actionMessage };
    row.getCell(13).value = { formula: `'Fabric Order Tracker'!T${dbR}`, result: rec.riskStatus };

    for (let c = 1; c <= foHeaders.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      if (c !== 13) {
        cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
        }
      }
      if ([1, 2, 3, 4, 6, 7, 10, 11].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if ([5, 9].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }
    applyRiskCellStyle(row.getCell(13), rec.riskTier);
  });

  wsFoReq.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: Math.max(3, foRequiredRows.length + 3), column: foHeaders.length },
  };
  wsFoReq.columns = [
    { width: 10 },
    { width: 17 },
    { width: 11 },
    { width: 14 },
    { width: 11 },
    { width: 16 },
    { width: 12 },
    { width: 38 },
    { width: 13 },
    { width: 13 },
    { width: 20 },
    { width: 34 },
    { width: 26 },
  ];

  // =========================================================================
  // 6. ACTION REQUIRED SHEET
  // =========================================================================
  const actionRows = evaluated
    .filter(
      (r) =>
        r.orderStatus !== 'Order Closed' &&
        (r.actionRequired ||
          r.styleClassification === 'Open Capacity' ||
          r.isAnomalousPastDate)
    )
    .sort((a, b) => {
      if (a.isCurrentStyle !== b.isCurrentStyle) return a.isCurrentStyle ? -1 : 1;
      return (a.triggerDateIso || '9999-12-31').localeCompare(b.triggerDateIso || '9999-12-31');
    });

  wsActionReq.mergeCells('A1:M1');
  wsActionReq.getCell('A1').value =
    'ALEX APPARELS — ACTION REQUIRED ESCALATION LIST (PLAN QTY PENDING, CUTTING <= 10D & TRIGGERS)';
  wsActionReq.getCell('A1').font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.white } };
  wsActionReq.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF991B1B' } };
  wsActionReq.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsActionReq.getRow(1).height = 28;

  wsActionReq.mergeCells('A2:M2');
  wsActionReq.getCell('A2').value =
    'Immediate actions for Planning & Fabric Procurement Teams.';
  wsActionReq.getCell('A2').font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.textMuted } };
  wsActionReq.getRow(2).height = 20;

  const actionHeaders = [
    'Seq #',
    'Record ID',
    'Factory',
    'Line',
    'Cap (Mc)',
    'Lifecycle',
    'PG #',
    'Style',
    'Order Qty',
    'Trigger Date (End - 10D)',
    'Days',
    'Action Required',
    'Risk Status',
  ];
  wsActionReq.getRow(3).values = actionHeaders;
  styleHeaderRow(wsActionReq.getRow(3), actionHeaders.length, 'FFDC2626');

  actionRows.forEach((rec, idx) => {
    const rNum = idx + 4;
    const dbR = dbRowById.get(rec.id) ?? 2;
    const row = wsActionReq.getRow(rNum);
    row.height = 22;

    row.getCell(1).value = idx + 1;
    row.getCell(2).value = { formula: `'Planning Database'!A${dbR}`, result: rec.id };
    row.getCell(3).value = { formula: `'Planning Database'!B${dbR}`, result: rec.factory };
    row.getCell(4).value = { formula: `'Planning Database'!D${dbR}`, result: rec.line };
    row.getCell(5).value = { formula: `'Planning Database'!E${dbR}`, result: rec.capacityMc };
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).value = { formula: `'Planning Database'!H${dbR}`, result: rec.lifecycleStage };
    row.getCell(7).value = { formula: `'Planning Database'!I${dbR}`, result: rec.pgNumber };
    row.getCell(8).value = { formula: `'Planning Database'!J${dbR}`, result: rec.style };
    row.getCell(9).value = {
      formula: `IF(ISBLANK('Planning Database'!L${dbR}),"",'Planning Database'!L${dbR})`,
      result: rec.plannedQty ?? undefined,
    };
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).value = {
      formula: `'Planning Database'!N${dbR}`,
      result: isoToUtcDate(rec.triggerDateIso) ?? undefined,
    };
    row.getCell(10).numFmt = 'dd-mmm-yy';
    row.getCell(11).value = {
      formula: `'Planning Database'!O${dbR}`,
      result: rec.daysToTrigger ?? undefined,
    };
    row.getCell(11).numFmt = '0';
    row.getCell(12).value = { formula: `'Fabric Order Tracker'!S${dbR}`, result: rec.actionMessage };
    row.getCell(13).value = { formula: `'Fabric Order Tracker'!T${dbR}`, result: rec.riskStatus };

    for (let c = 1; c <= actionHeaders.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      if (c !== 13) {
        cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textPrimary } };
        if (idx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
        }
      }
      if ([1, 2, 3, 4, 6, 7, 10, 11].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if ([5, 9].includes(c)) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }
    applyRiskCellStyle(row.getCell(13), rec.riskTier);
  });

  wsActionReq.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: Math.max(3, actionRows.length + 3), column: actionHeaders.length },
  };
  wsActionReq.columns = [
    { width: 9 },
    { width: 17 },
    { width: 11 },
    { width: 14 },
    { width: 11 },
    { width: 16 },
    { width: 12 },
    { width: 38 },
    { width: 13 },
    { width: 20 },
    { width: 11 },
    { width: 34 },
    { width: 26 },
  ];

  // =========================================================================
  // 1. KPI DASHBOARD SHEET (with Shortcut Summary!)
  // =========================================================================
  wsDashboard.columns = [
    { width: 3 },
    { width: 13 },
    { width: 14 },
    { width: 13 },
    { width: 30 },
    { width: 14 },
    { width: 13 },
    { width: 30 },
    { width: 17 },
    { width: 17 },
    { width: 24 },
  ];

  wsDashboard.mergeCells('B2:K2');
  const titleCell = wsDashboard.getCell('B2');
  titleCell.value = 'ALEX APPARELS — CLUSTER 1 PLANNING & FABRIC ORDER KPI DASHBOARD';
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: COLORS.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsDashboard.getRow(2).height = 34;

  wsDashboard.mergeCells('B3:K3');
  const subCell = wsDashboard.getCell('B3');
  subCell.value = `Master Plan As Of ${meta.asOfDateRaw}  |  Factories: ALEX 1, ALEX 3, ALEX 5, ALEX 12  |  Input Start: End Date - 10D  |  Upcoming FO Trigger: Input Start - 20D`;
  subCell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.textMuted } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsDashboard.getRow(3).height = 22;

  wsDashboard.mergeCells('B5:K5');
  wsDashboard.getCell('B5').value = 'INTERACTIVE FACTORY & LINE DROPDOWN FILTER';
  wsDashboard.getCell('B5').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } };
  wsDashboard.getCell('B5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.indigoAccent } };
  wsDashboard.getCell('B5').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsDashboard.getRow(5).height = 22;

  wsDashboard.getRow(6).height = 26;
  wsDashboard.getCell('B6').value = 'Factory:';
  wsDashboard.getCell('B6').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.textPrimary } };
  wsDashboard.getCell('B6').alignment = { vertical: 'middle', horizontal: 'right' };

  const factoryDropCell = wsDashboard.getCell('C6');
  factoryDropCell.value = 'All Factories';
  factoryDropCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.indigoAccent } };
  factoryDropCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inputFill } };
  factoryDropCell.alignment = { vertical: 'middle', horizontal: 'center' };
  factoryDropCell.border = THIN_BORDER;
  factoryDropCell.dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: [`=Lists!$A$2:$A$${factoryFilterEndRow}`],
  };

  wsDashboard.getCell('D6').value = 'Line:';
  wsDashboard.getCell('D6').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.textPrimary } };
  wsDashboard.getCell('D6').alignment = { vertical: 'middle', horizontal: 'right' };

  const lineDropCell = wsDashboard.getCell('E6');
  lineDropCell.value = 'All Lines';
  lineDropCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.indigoAccent } };
  lineDropCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.inputFill } };
  lineDropCell.alignment = { vertical: 'middle', horizontal: 'center' };
  lineDropCell.border = THIN_BORDER;
  lineDropCell.dataValidation = {
    type: 'list',
    allowBlank: false,
    formulae: [`=Lists!$B$2:$B$${lineFilterEndRow}`],
  };

  wsDashboard.getCell('F6').value = 'Ref Date:';
  wsDashboard.getCell('F6').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.textPrimary } };
  wsDashboard.getCell('F6').alignment = { vertical: 'middle', horizontal: 'right' };

  wsDashboard.getCell('G6').value = { formula: 'TODAY()', result: isoToUtcDate(referenceDateIso) ?? new Date() };
  wsDashboard.getCell('G6').numFmt = 'dd-mmm-yy';
  wsDashboard.getCell('G6').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.textPrimary } };
  wsDashboard.getCell('G6').alignment = { vertical: 'middle', horizontal: 'center' };
  wsDashboard.getCell('G6').border = THIN_BORDER;

  const fCrit = `IF($C$6="All Factories","*",$C$6)`;
  const lCrit = `IF($E$6="All Lines","*",$E$6)`;

  const filteredCards = [
    {
      col: 2,
      label: 'Lines',
      formula: `COUNTIFS(Lists!$D$2:$D$${dirEndRow},${fCrit},Lists!$E$2:$E$${dirEndRow},${lCrit})`,
      result: uniqueLines.length,
    },
    {
      col: 3,
      label: 'Capacity (Mc)',
      formula: `SUMIFS(Lists!$F$2:$F$${dirEndRow},Lists!$D$2:$D$${dirEndRow},${fCrit},Lists!$E$2:$E$${dirEndRow},${lCrit})`,
      result: meta.totalCapacityMc,
    },
    {
      col: 4,
      label: 'Running Styles',
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},${fCrit},'Planning Database'!$D$2:$D$${dbLastRow},${lCrit},'Planning Database'!$H$2:$H$${dbLastRow},"Running")`,
      result: evaluated.filter((r) => r.lifecycleStage === 'Running').length,
    },
    {
      col: 5,
      label: 'Upcoming (Next)',
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},${fCrit},'Planning Database'!$D$2:$D$${dbLastRow},${lCrit},'Planning Database'!$H$2:$H$${dbLastRow},"Upcoming (Next)")`,
      result: evaluated.filter((r) => r.lifecycleStage === 'Upcoming (Next)').length,
    },
    {
      col: 6,
      label: 'Plan Qty Pending',
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},${fCrit},'Planning Database'!$D$2:$D$${dbLastRow},${lCrit},'Planning Database'!$Q$2:$Q$${dbLastRow},"⚠ PLAN QTY PENDING")`,
      result: evaluated.filter(
        (r) => r.plannedQty === null && r.orderStatus !== 'Order Closed'
      ).length,
    },
    {
      col: 7,
      label: 'FO Required',
      formula: `COUNTIFS('Fabric Order Tracker'!$B$2:$B$${dbLastRow},${fCrit},'Fabric Order Tracker'!$C$2:$C$${dbLastRow},${lCrit},'Fabric Order Tracker'!$R$2:$R$${dbLastRow},"YES")`,
      result: foRequiredRows.length,
    },
    {
      col: 8,
      label: 'Cutting <= 10D',
      formula: `COUNTIFS('Fabric Order Tracker'!$B$2:$B$${dbLastRow},${fCrit},'Fabric Order Tracker'!$C$2:$C$${dbLastRow},${lCrit},'Fabric Order Tracker'!$T$2:$T$${dbLastRow},"CRITICAL - CUTTING <= 10D")`,
      result: evaluated.filter(
        (r) =>
          r.isCuttingWithin10Days &&
          r.foStatus === 'Pending' &&
          r.orderStatus !== 'Order Closed'
      ).length,
    },
    {
      col: 9,
      label: 'Triggers <= 14D',
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},${fCrit},'Planning Database'!$D$2:$D$${dbLastRow},${lCrit},'Planning Database'!$K$2:$K$${dbLastRow},"<>Order Closed",'Planning Database'!$O$2:$O$${dbLastRow},"<=14")`,
      result: evaluated.filter(
        (r) =>
          r.orderStatus !== 'Order Closed' &&
          r.daysToTrigger !== null &&
          r.daysToTrigger <= 14
      ).length,
    },
  ];

  wsDashboard.getRow(8).height = 20;
  wsDashboard.getRow(9).height = 28;
  for (const card of filteredCards) {
    const lblCell = wsDashboard.getRow(8).getCell(card.col);
    lblCell.value = card.label;
    lblCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: COLORS.textMuted } };
    lblCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
    lblCell.alignment = { vertical: 'middle', horizontal: 'center' };
    lblCell.border = THIN_BORDER;

    const valCell = wsDashboard.getRow(9).getCell(card.col);
    valCell.value = { formula: card.formula, result: card.result };
    valCell.numFmt = '#,##0';
    valCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: COLORS.navyDark } };
    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.white } };
    valCell.alignment = { vertical: 'middle', horizontal: 'center' };
    valCell.border = THIN_BORDER;
  }

  // Factory-Wise Summary Table (Rows 11-17)
  wsDashboard.mergeCells('B11:J11');
  wsDashboard.getCell('B11').value = 'FACTORY-WISE CAPACITY & FABRIC ORDER KPI SUMMARY';
  wsDashboard.getCell('B11').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } };
  wsDashboard.getCell('B11').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyHeader } };
  wsDashboard.getCell('B11').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsDashboard.getRow(11).height = 22;

  const factoryHeaders = [
    'Factory',
    'Active Lines',
    'Capacity (Mc)',
    'Capacity %',
    'Running Styles',
    'Total Slots',
    'Plan Qty Pending',
    'FO Required',
    'Triggers <= 14D',
  ];
  wsDashboard.getRow(12).height = 24;
  factoryHeaders.forEach((h, i) => {
    const c = wsDashboard.getRow(12).getCell(i + 2);
    c.value = h;
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = THIN_BORDER;
  });

  ALLOWED_FACTORIES.forEach((fac, idx) => {
    const rNum = 13 + idx;
    const row = wsDashboard.getRow(rNum);
    row.height = 22;

    const facLines = uniqueLines.filter((u) => u.factory === fac);
    const facCap = facLines.reduce((acc, u) => acc + u.capacityMc, 0);
    const facRecs = evaluated.filter((r) => r.factory === fac);

    row.getCell(2).value = fac;
    row.getCell(3).value = {
      formula: `COUNTIF(Lists!$D$2:$D$${dirEndRow},B${rNum})`,
      result: facLines.length,
    };
    row.getCell(4).value = {
      formula: `SUMIF(Lists!$D$2:$D$${dirEndRow},B${rNum},Lists!$F$2:$F$${dirEndRow})`,
      result: facCap,
    };
    row.getCell(5).value = {
      formula: `IF($D$17>0,D${rNum}/$D$17,0)`,
      result: meta.totalCapacityMc > 0 ? facCap / meta.totalCapacityMc : 0,
    };
    row.getCell(6).value = {
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},B${rNum},'Planning Database'!$H$2:$H$${dbLastRow},"Running")`,
      result: facRecs.filter((r) => r.lifecycleStage === 'Running').length,
    };
    row.getCell(7).value = {
      formula: `COUNTIF('Planning Database'!$B$2:$B$${dbLastRow},B${rNum})`,
      result: facRecs.length,
    };
    row.getCell(8).value = {
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},B${rNum},'Planning Database'!$Q$2:$Q$${dbLastRow},"⚠ PLAN QTY PENDING")`,
      result: facRecs.filter(
        (r) => r.plannedQty === null && r.orderStatus !== 'Order Closed'
      ).length,
    };
    row.getCell(9).value = {
      formula: `COUNTIFS('Fabric Order Tracker'!$B$2:$B$${dbLastRow},B${rNum},'Fabric Order Tracker'!$R$2:$R$${dbLastRow},"YES")`,
      result: facRecs.filter((r) => r.foRequired).length,
    };
    row.getCell(10).value = {
      formula: `COUNTIFS('Planning Database'!$B$2:$B$${dbLastRow},B${rNum},'Planning Database'!$K$2:$K$${dbLastRow},"<>Order Closed",'Planning Database'!$O$2:$O$${dbLastRow},"<=14")`,
      result: facRecs.filter(
        (r) =>
          r.orderStatus !== 'Order Closed' &&
          r.daysToTrigger !== null &&
          r.daysToTrigger <= 14
      ).length,
    };

    for (let c = 2; c <= 10; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: c === 2,
        color: { argb: COLORS.textPrimary },
      };
      cell.alignment = { vertical: 'middle', horizontal: c === 2 ? 'left' : 'right' };
      if (c === 5) cell.numFmt = '0.0%';
      else if (c > 2) cell.numFmt = '#,##0';
    }
  });

  const totalRow = wsDashboard.getRow(17);
  totalRow.height = 24;
  totalRow.getCell(2).value = 'CLUSTER 1 TOTAL';
  for (let c = 3; c <= 10; c++) {
    const colLetter = String.fromCharCode(64 + c);
    totalRow.getCell(c).value = { formula: `SUM(${colLetter}13:${colLetter}16)` };
    totalRow.getCell(c).numFmt = c === 5 ? '0.0%' : '#,##0';
  }
  for (let c = 2; c <= 10; c++) {
    const cell = totalRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.slateLight } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.navyDark } };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: c === 2 ? 'left' : 'right' };
  }

  // SHORTCUT SUMMARY: IMMEDIATE UPCOMING FO & CUTTING <= 10D PER LINE (Rows 19+)
  wsDashboard.mergeCells('B19:K19');
  wsDashboard.getCell('B19').value =
    'SHORTCUT SUMMARY — IMMEDIATE UPCOMING ORDER FO TRIGGER (INPUT START - 20D) & CUTTING <= 10D ALERTS';
  wsDashboard.getCell('B19').font = { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } };
  wsDashboard.getCell('B19').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF991B1B' } };
  wsDashboard.getCell('B19').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  wsDashboard.getRow(19).height = 24;

  const snapHeaders = [
    'Factory',
    'Line',
    'Running PG #',
    'Running Style',
    'Running End',
    'Next PG #',
    'Immediate Upcoming Style',
    'Input Start (End-10D)',
    'FO Trigger (In-20D)',
    'Shortcut FO Status',
  ];
  wsDashboard.getRow(20).height = 24;
  snapHeaders.forEach((h, i) => {
    const c = wsDashboard.getRow(20).getCell(i + 2);
    c.value = h;
    c.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: COLORS.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyDark } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = THIN_BORDER;
  });

  const sortedShortcuts = [...shortcutSummaries].sort((a, b) => {
    const sevOrder = { critical: 0, warning: 1, upcoming: 2, normal: 3 };
    if (sevOrder[a.summarySeverity] !== sevOrder[b.summarySeverity]) {
      return sevOrder[a.summarySeverity] - sevOrder[b.summarySeverity];
    }
    return (a.upcomingFoTriggerIso || '9999-12-31').localeCompare(
      b.upcomingFoTriggerIso || '9999-12-31'
    );
  });

  sortedShortcuts.forEach((s, idx) => {
    const rNum = 21 + idx;
    const row = wsDashboard.getRow(rNum);
    row.height = 21;

    const runDbR = s.runningRecord ? dbRowById.get(s.runningRecord.id) : undefined;
    const upDbR = s.upcomingRecord ? dbRowById.get(s.upcomingRecord.id) : undefined;

    row.getCell(2).value = s.factory;
    row.getCell(3).value = s.line;
    row.getCell(4).value = s.runningRecord?.pgNumber ?? '—';
    row.getCell(5).value = s.runningRecord?.style ?? 'No Running Style';
    row.getCell(6).value = runDbR
      ? {
          formula: `'Planning Database'!M${runDbR}`,
          result: isoToUtcDate(s.runningRecord?.endDateIso ?? null) ?? undefined,
        }
      : '—';
    if (s.runningRecord?.endDateIso) row.getCell(6).numFmt = 'dd-mmm-yy';

    row.getCell(7).value = s.upcomingRecord?.pgNumber ?? '—';
    row.getCell(8).value = s.upcomingRecord?.style ?? 'No Upcoming Style';
    row.getCell(9).value = runDbR
      ? {
          formula: `IF(ISNUMBER(F${rNum}),F${rNum}-10,"")`,
          result: isoToUtcDate(s.newStyleInputStartIso) ?? undefined,
        }
      : '—';
    if (s.newStyleInputStartIso) row.getCell(9).numFmt = 'dd-mmm-yy';

    row.getCell(10).value = upDbR && runDbR
      ? {
          formula: `IF(ISNUMBER(I${rNum}),I${rNum}-20,"")`,
          result: isoToUtcDate(s.upcomingFoTriggerIso) ?? undefined,
        }
      : '—';
    if (s.upcomingFoTriggerIso) row.getCell(10).numFmt = 'dd-mmm-yy';

    row.getCell(11).value = s.summaryStatus;

    for (let c = 2; c <= 11; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      cell.font = { name: 'Calibri', size: 9.5, color: { argb: COLORS.textPrimary } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: [2, 3, 4, 6, 7, 9, 10].includes(c) ? 'center' : 'left',
      };
    }

    if (s.summarySeverity === 'critical') {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.redFill } };
      row.getCell(11).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: COLORS.redText } };
    } else if (s.summarySeverity === 'warning') {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.amberFill } };
      row.getCell(11).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: COLORS.amberText } };
    } else if (s.summarySeverity === 'upcoming') {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blueFill } };
      row.getCell(11).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: COLORS.blueText } };
    } else {
      row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenFill } };
      row.getCell(11).font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: COLORS.greenText } };
    }
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
