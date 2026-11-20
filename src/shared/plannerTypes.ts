export type FactoryName = 'ALEX 1' | 'ALEX 3' | 'ALEX 5' | 'ALEX 12';

export type FoStatus = 'Pending' | 'FO Raised' | 'In-House' | 'Delayed';

export type OrderStatus = 'Open' | 'Order Closed';

export type StyleClassification = 'Confirmed Style' | 'Booked Allocation' | 'Open Capacity';

export type LineLifecycleStage = 'Order Closed' | 'Running' | 'Upcoming (Next)' | 'Queued';

export interface PlanningRecord {
  id: string;
  factory: FactoryName;
  zone: string;
  line: string;
  capacityMc: number;
  productCategory: string;
  slot: number;
  isCurrentStyle: boolean;
  isFinished: boolean;
  orderStatus: OrderStatus;
  pgNumber: string;
  style: string;
  nextStyle: string;
  styleClassification: StyleClassification;
  styleQtyHint: number | null;
  plannedQty: number | null; // Order Qty / Planned Qty
  foIssueQty: number | null; // Fabric Order Issue Qty
  cuttingBaseQty: number | null; // Optional opening cutting qty before daily log
  dailyTargetQty: number | null; // Daily cutting target qty
  endDateRaw: string;
  endDateIso: string | null;
  triggerDateIso: string | null;
  isAnomalousPastDate: boolean;
  foNumber: string;
  foDate: string;
  foStatus: FoStatus;
  fabricNote: string;
}

export interface DailyCuttingEntry {
  id: string;
  dateIso: string;
  recordId: string;
  factory: FactoryName;
  line: string;
  pgNumber: string;
  style: string;
  cuttingQty: number;
  remarks: string;
}

export interface EvaluatedPlanningRecord extends PlanningRecord {
  lifecycleStage: LineLifecycleStage;
  cuttingFinishedQty: number;
  cuttingRemainingQty: number | null;
  cuttingDaysRemaining: number | null;
  estimatedCuttingFinishIso: string | null;
  isCuttingWithin10Days: boolean;
  daysToEnd: number | null;
  daysToTrigger: number | null;
  foRequired: boolean;
  actionRequired: boolean;
  actionMessage: string;
  riskStatus: string;
  riskTier: 'plan_qty_pending' | 'critical' | 'high' | 'monitoring' | 'on_track' | 'closed';
}

export interface LineShortcutSummary {
  factory: FactoryName;
  zone: string;
  line: string;
  capacityMc: number;
  productCategory: string;
  runningRecord: EvaluatedPlanningRecord | null;
  upcomingRecord: EvaluatedPlanningRecord | null;
  newStyleInputStartIso: string | null; // Running End Date - 10 Days
  upcomingFoTriggerIso: string | null; // Input Start Date - 20 Days (= Running End Date - 30 Days)
  daysToUpcomingFoTrigger: number | null;
  cuttingAlertActive: boolean; // Cutting <= 10 days left on running style
  upcomingFoAlertActive: boolean; // Upcoming FO trigger <= 0 or <= 15 days
  foNeedReason: string;
  summaryStatus: 'FO REQUIRED NOW' | 'CUTTING <= 10D · FO NEEDED' | 'FO DUE SOON' | 'ON SCHEDULE' | 'NO UPCOMING PLAN';
  summarySeverity: 'critical' | 'warning' | 'upcoming' | 'normal';
}

export interface MasterPlanMeta {
  title: string;
  asOfDateRaw: string;
  asOfDateIso: string;
  factoriesIncluded: FactoryName[];
  totalLines: number;
  totalCapacityMc: number;
}

export interface ParsedMasterPlan {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
}

export const ALLOWED_FACTORIES: FactoryName[] = ['ALEX 1', 'ALEX 3', 'ALEX 5', 'ALEX 12'];

export const FO_STATUS_OPTIONS: FoStatus[] = ['Pending', 'FO Raised', 'In-House', 'Delayed'];

export const ORDER_STATUS_OPTIONS: OrderStatus[] = ['Open', 'Order Closed'];

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseCsvRows(csvText: string): string[][] {
  const cleanText = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const ch = cleanText[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleanText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r') {
        if (cleanText[i + 1] === '\n') {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parseShortDateToIso(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '#N/A') return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(trimmed);
  if (!match) return null;

  const day = Number(match[1]);
  const monthIdx = MONTH_MAP[match[2].toLowerCase()];
  if (monthIdx === undefined) return null;

  let year = Number(match[3]);
  if (year < 100) {
    year += 2000;
  }

  const dt = new Date(Date.UTC(year, monthIdx, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== monthIdx ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }

  return formatIsoFromUtcDate(dt);
}

export function formatIsoFromUtcDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoToUtcDate(iso: string | null): Date | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function addDaysIso(iso: string | null, deltaDays: number): string | null {
  const dt = isoToUtcDate(iso);
  if (!dt) return null;
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return formatIsoFromUtcDate(dt);
}

export function diffDaysIso(targetIso: string | null, baseIso: string): number | null {
  const target = isoToUtcDate(targetIso);
  const base = isoToUtcDate(baseIso);
  if (!target || !base) return null;
  return Math.round((target.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDisplayDate(iso: string | null): string {
  const dt = isoToUtcDate(iso);
  if (!dt) return '—';
  const d = String(dt.getUTCDate()).padStart(2, '0');
  const m = MONTH_NAMES[dt.getUTCMonth()];
  const y = String(dt.getUTCFullYear()).slice(-2);
  return `${d}-${m}-${y}`;
}

export function extractPgNumber(style: string): string {
  const explicitPgNum = /\bPG\s*-?\s*(\d{4,6})\b/i.exec(style);
  if (explicitPgNum) return `PG-${explicitPgNum[1]}`;

  const explicitPgCode = /\bPG\s*-\s*([A-Z0-9]{3,10})\b/i.exec(style);
  if (explicitPgCode) return `PG-${explicitPgCode[1].toUpperCase()}`;

  const fiveDigitCode = /\b(3\d{4}|2\d{4})\b/.exec(style);
  if (fiveDigitCode) return `PG-${fiveDigitCode[1]}`;

  const sanmarCode = /\b(MM\d{3,5}|ST\d{3,4}[A-Z]*|LST\d{3,4}[A-Z]*|CS\d{3,4}[A-Z]*|K\d{3,4}|LK\d{3,4}|LOG\s*\d{3}|OGIO\s*\d{3})\b/i.exec(
    style
  );
  if (sanmarCode) return sanmarCode[1].replace(/\s+/g, '').toUpperCase();

  return '—';
}

function normalizeLineName(raw: string): string {
  const cleaned = raw.replace(/'/g, '').replace(/\s+/g, ' ').trim();
  if (/^LINE\s+\d+/i.test(cleaned)) {
    return cleaned.replace(/^LINE/i, 'Line');
  }
  return cleaned;
}

function parseCapacityMc(raw: string): number {
  const match = /(\d+(?:\.\d+)?)/.exec(raw.replace(/,/g, ''));
  return match ? Math.round(Number(match[1])) : 0;
}

function classifyStyle(style: string): StyleClassification {
  const upper = style.toUpperCase();
  if (upper === 'OPEN' || upper.includes('OPEN WORKING')) {
    return 'Open Capacity';
  }
  if (upper.startsWith('BOOKED')) {
    return 'Booked Allocation';
  }
  return 'Confirmed Style';
}

function extractStyleQtyHint(style: string): number | null {
  const kMatch = /\b(\d+(?:\.\d+)?)\s*k\b/i.exec(style);
  if (kMatch) {
    return Math.round(Number(kMatch[1]) * 1000);
  }
  const pcsMatch = /\b(\d{3,7})\s*pcs\b/i.exec(style);
  if (pcsMatch) {
    return Number(pcsMatch[1]);
  }
  return null;
}

function detectFactorySection(rowText: string): FactoryName | null {
  const norm = rowText.trim().toUpperCase();
  if (/^ALEX\s*1\b/.test(norm)) return 'ALEX 1';
  if (/^ALEX\s*3\b/.test(norm)) return 'ALEX 3';
  if (/^ALEX\s*5\b/.test(norm)) return 'ALEX 5';
  if (/^ALEX\s*12\b/.test(norm)) return 'ALEX 12';
  return null;
}

function isNonTargetSection(rowText: string): boolean {
  const norm = rowText.trim().toUpperCase();
  return (
    /^ANM\b/.test(norm) ||
    /^GMG\b/.test(norm) ||
    /^MAY\s*TEX\b/.test(norm) ||
    /^FABULOUS\b/.test(norm) ||
    /^TSA\b/.test(norm) ||
    /^BC\s*1\b/.test(norm) ||
    /^SANMAR\s*-\s*NOV/.test(norm)
  );
}

interface LineBlockColumn {
  colIdx: number;
  line: string;
  capacityMc: number;
  productCategory: string;
  slots: Array<{
    slot: number;
    style: string;
    endDateRaw: string;
    endDateIso: string | null;
  }>;
}

export function parseMasterPlanCsv(csvText: string): ParsedMasterPlan {
  const rows = parseCsvRows(csvText);

  const headerLine = rows[0]?.[1]?.trim() || 'Alpine Egypt - Cluster 1 Production Plan';
  const asOfMatch = /As of\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i.exec(headerLine);
  const asOfDateRaw = asOfMatch ? asOfMatch[1] : '18-Nov-26';
  const asOfDateIso = parseShortDateToIso(asOfDateRaw) || '2026-11-18';

  let activeFactory: FactoryName | null = null;
  let activeZone = 'Main Floor';
  let inTargetZone = false;

  const records: PlanningRecord[] = [];
  const lineRegistry = new Map<string, number>();

  let i = 1;
  while (i < rows.length) {
    const row = rows[i] || [];
    const col0 = (row[0] || '').trim();
    const col1 = (row[1] || '').trim();

    if (isNonTargetSection(col1) || isNonTargetSection(col0)) {
      activeFactory = null;
      inTargetZone = false;
      i++;
      continue;
    }

    const detectedFactory = detectFactorySection(col1);
    if (detectedFactory) {
      activeFactory = detectedFactory;
      activeZone = detectedFactory === 'ALEX 12' ? 'Zone 1' : 'Main Floor';
      inTargetZone = true;
      i++;
      continue;
    }

    if (activeFactory === 'ALEX 12' && /^ZONE\s*\d+/i.test(col1)) {
      const zMatch = /ZONE\s*(\d+)/i.exec(col1);
      activeZone = zMatch ? `Zone ${zMatch[1]}` : 'Zone';
      inTargetZone = true;
      i++;
      continue;
    }

    const looksLikeLineHeader =
      inTargetZone &&
      activeFactory !== null &&
      col0 === '' &&
      col1 !== '' &&
      (/^(Line|SMPL)/i.test(col1.replace(/'/g, '')) || /\bMc\b/i.test(row[2] || ''));

    if (looksLikeLineHeader && activeFactory) {
      const lineRow = row;
      const categoryRow = rows[i + 1] || [];
      const columns: LineBlockColumn[] = [];

      for (let c = 1; c < lineRow.length - 1; c += 2) {
        const rawLine = (lineRow[c] || '').trim();
        const rawCap = (lineRow[c + 1] || '').trim();
        if (!rawLine || rawLine === '0') continue;

        const capacityMc = parseCapacityMc(rawCap);
        if (capacityMc <= 0) continue;

        const line = normalizeLineName(rawLine);
        const productCategory = (categoryRow[c] || '').trim() || 'General';
        columns.push({
          colIdx: c,
          line,
          capacityMc,
          productCategory,
          slots: [],
        });
        lineRegistry.set(`${activeFactory}::${line}`, capacityMc);
      }

      let j = i + 2;
      while (j < rows.length) {
        const slotRow = rows[j] || [];
        const slotCol0 = (slotRow[0] || '').trim();
        const slotCol1 = (slotRow[1] || '').trim();

        if (/^Alex\s*\d+/i.test(slotCol0)) {
          j++;
          break;
        }
        if (
          detectFactorySection(slotCol1) ||
          isNonTargetSection(slotCol1) ||
          (activeFactory === 'ALEX 12' && /^ZONE\s*\d+/i.test(slotCol1))
        ) {
          break;
        }

        const slotNum = /^\d+$/.test(slotCol0) ? Number(slotCol0) : null;
        if (slotNum !== null) {
          for (const col of columns) {
            const style = (slotRow[col.colIdx] || '').replace(/\s+/g, ' ').trim();
            const endDateRaw = (slotRow[col.colIdx + 1] || '').trim();
            if (!style || style === '#N/A') continue;

            const endDateIso = parseShortDateToIso(endDateRaw);
            col.slots.push({
              slot: slotNum,
              style,
              endDateRaw,
              endDateIso,
            });
          }
        }
        j++;
      }

      for (const col of columns) {
        for (let idx = 0; idx < col.slots.length; idx++) {
          const item = col.slots[idx];
          const nextItem = col.slots[idx + 1];
          const triggerDateIso = addDaysIso(item.endDateIso, -10);
          const isAnomalousPastDate =
            item.endDateIso !== null && item.endDateIso < '2026-09-01';

          const cleanFactorySlug = activeFactory.replace(/\s+/g, '');
          const cleanLineSlug = col.line.replace(/[^A-Za-z0-9]/g, '');
          const id = `${cleanFactorySlug}-${cleanLineSlug}-S${item.slot}`;

          records.push({
            id,
            factory: activeFactory,
            zone: activeZone,
            line: col.line,
            capacityMc: col.capacityMc,
            productCategory: col.productCategory,
            slot: item.slot,
            isCurrentStyle: item.slot === 1,
            isFinished: false,
            orderStatus: 'Open',
            pgNumber: extractPgNumber(item.style),
            style: item.style,
            nextStyle: nextItem ? nextItem.style : 'End of Current Queue',
            styleClassification: classifyStyle(item.style),
            styleQtyHint: extractStyleQtyHint(item.style),
            plannedQty: null,
            foIssueQty: null,
            cuttingBaseQty: null,
            dailyTargetQty: null,
            endDateRaw: item.endDateRaw,
            endDateIso: item.endDateIso,
            triggerDateIso,
            isAnomalousPastDate,
            foNumber: '',
            foDate: '',
            foStatus: 'Pending',
            fabricNote: '',
          });
        }
      }

      i = j;
      continue;
    }

    i++;
  }

  let totalCapacityMc = 0;
  for (const cap of lineRegistry.values()) {
    totalCapacityMc += cap;
  }

  return {
    meta: {
      title: headerLine,
      asOfDateRaw,
      asOfDateIso,
      factoriesIncluded: ALLOWED_FACTORIES,
      totalLines: lineRegistry.size,
      totalCapacityMc,
    },
    records,
  };
}

export function buildCuttingTotalsMap(
  cuttingEntries: DailyCuttingEntry[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of cuttingEntries) {
    map.set(entry.recordId, (map.get(entry.recordId) ?? 0) + (entry.cuttingQty || 0));
  }
  return map;
}

export function computeLineLifecycleMap(
  records: PlanningRecord[]
): Map<string, LineLifecycleStage> {
  const grouped = new Map<string, PlanningRecord[]>();
  for (const rec of records) {
    const key = `${rec.factory}::${rec.line}`;
    const list = grouped.get(key) ?? [];
    list.push(rec);
    grouped.set(key, list);
  }

  const stageMap = new Map<string, LineLifecycleStage>();
  for (const list of grouped.values()) {
    const sorted = [...list].sort((a, b) => a.slot - b.slot);
    let activeOrderCount = 0;
    for (const item of sorted) {
      if (item.orderStatus === 'Order Closed' || item.isFinished) {
        stageMap.set(item.id, 'Order Closed');
      } else if (activeOrderCount === 0) {
        stageMap.set(item.id, 'Running');
        activeOrderCount++;
      } else if (activeOrderCount === 1) {
        stageMap.set(item.id, 'Upcoming (Next)');
        activeOrderCount++;
      } else {
        stageMap.set(item.id, 'Queued');
        activeOrderCount++;
      }
    }
  }

  return stageMap;
}

export interface PlanningRuleOptions {
  inputStartOffsetDays?: number;
  upcomingFoOffsetDays?: number;
  cuttingAlertDays?: number;
}

export function evaluatePlanningRecords(
  records: PlanningRecord[],
  cuttingEntries: DailyCuttingEntry[],
  referenceDateIso: string,
  options: PlanningRuleOptions = {}
): EvaluatedPlanningRecord[] {
  const inputOffset = Math.max(1, options.inputStartOffsetDays ?? 10);
  const cuttingAlertLimit = Math.max(1, options.cuttingAlertDays ?? 10);
  const cuttingTotals = buildCuttingTotalsMap(cuttingEntries);
  const lifecycleMap = computeLineLifecycleMap(records);

  return records.map((record) => {
    const lifecycleStage = lifecycleMap.get(record.id) ?? (record.slot === 1 ? 'Running' : 'Queued');
    const isCurrentStyle = lifecycleStage === 'Running';
    const triggerDateIso = addDaysIso(record.endDateIso, -inputOffset);
    const daysToEnd = diffDaysIso(record.endDateIso, referenceDateIso);
    const daysToTrigger = diffDaysIso(triggerDateIso, referenceDateIso);

    const cuttingFinishedQty =
      (record.cuttingBaseQty ?? 0) + (cuttingTotals.get(record.id) ?? 0);

    let cuttingRemainingQty: number | null = null;
    let cuttingDaysRemaining: number | null = null;
    let estimatedCuttingFinishIso: string | null = null;
    let isCuttingWithin10Days = false;

    const isOrderClosed = record.orderStatus === 'Order Closed' || record.isFinished;

    if (record.plannedQty !== null && record.plannedQty > 0) {
      cuttingRemainingQty = Math.max(0, record.plannedQty - cuttingFinishedQty);
      if (record.dailyTargetQty !== null && record.dailyTargetQty > 0) {
        cuttingDaysRemaining = Math.ceil(cuttingRemainingQty / record.dailyTargetQty);
        estimatedCuttingFinishIso = addDaysIso(referenceDateIso, cuttingDaysRemaining);
        if (cuttingDaysRemaining <= cuttingAlertLimit && !isOrderClosed) {
          isCuttingWithin10Days = true;
        }
      } else if (cuttingRemainingQty === 0 && !isOrderClosed) {
        cuttingDaysRemaining = 0;
        estimatedCuttingFinishIso = referenceDateIso;
        isCuttingWithin10Days = true;
      }
    }

    const isPlannedQtyBlank =
      record.plannedQty === null ||
      record.plannedQty === undefined ||
      Number.isNaN(record.plannedQty);

    if (isOrderClosed) {
      return {
        ...record,
        isFinished: true,
        orderStatus: 'Order Closed',
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage: 'Order Closed',
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days: false,
        daysToEnd,
        daysToTrigger,
        foRequired: false,
        actionRequired: false,
        actionMessage: 'ORDER CLOSED',
        riskStatus: 'ORDER CLOSED',
        riskTier: 'closed',
      };
    }

    if (isPlannedQtyBlank) {
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: true,
        actionRequired: true,
        actionMessage: 'FO NEED - TAKE ACTION AS PER PLAN',
        riskStatus: '⚠ PLAN QTY PENDING',
        riskTier: 'plan_qty_pending',
      };
    }

    if (isCuttingWithin10Days && record.foStatus === 'Pending') {
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: true,
        actionRequired: true,
        actionMessage: `CUTTING FINISH IN ${cuttingDaysRemaining}D — FABRIC ORDER NEEDED`,
        riskStatus: 'CRITICAL - CUTTING <= 10D',
        riskTier: 'critical',
      };
    }

    if (record.foStatus === 'In-House') {
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: false,
        actionRequired: false,
        actionMessage: 'FABRIC IN-HOUSE - READY FOR LINE',
        riskStatus: 'ON TRACK',
        riskTier: 'on_track',
      };
    }

    if (record.foStatus === 'FO Raised') {
      const overdue = daysToTrigger !== null && daysToTrigger <= 0;
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: false,
        actionRequired: overdue,
        actionMessage: overdue
          ? 'EXPEDITE RAISED FO - TRIGGER PASSED'
          : 'FO RAISED - TRACK EX-MILL DELIVERY',
        riskStatus: overdue ? 'WATCH - TRIGGER PASSED' : 'FO IN PROGRESS',
        riskTier: overdue ? 'high' : 'on_track',
      };
    }

    if (record.foStatus === 'Delayed') {
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: true,
        actionRequired: true,
        actionMessage: 'ESCALATE DELAYED FABRIC ORDER',
        riskStatus: 'CRITICAL - FO DELAYED',
        riskTier: 'critical',
      };
    }

    if (daysToTrigger !== null && daysToTrigger <= 0) {
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: true,
        actionRequired: true,
        actionMessage: 'URGENT - RAISE FO IMMEDIATELY',
        riskStatus: 'CRITICAL - OVERDUE TRIGGER',
        riskTier: 'critical',
      };
    }

    if (daysToTrigger !== null && daysToTrigger <= 14) {
      return {
        ...record,
        isCurrentStyle,
        triggerDateIso,
        lifecycleStage,
        cuttingFinishedQty,
        cuttingRemainingQty,
        cuttingDaysRemaining,
        estimatedCuttingFinishIso,
        isCuttingWithin10Days,
        daysToEnd,
        daysToTrigger,
        foRequired: true,
        actionRequired: true,
        actionMessage: 'RAISE FABRIC ORDER BEFORE TRIGGER',
        riskStatus: 'HIGH RISK - DUE <= 14 DAYS',
        riskTier: 'high',
      };
    }

    return {
      ...record,
      isCurrentStyle,
      triggerDateIso,
      lifecycleStage,
      cuttingFinishedQty,
      cuttingRemainingQty,
      cuttingDaysRemaining,
      estimatedCuttingFinishIso,
      isCuttingWithin10Days,
      daysToEnd,
      daysToTrigger,
      foRequired: true,
      actionRequired: false,
      actionMessage: 'SCHEDULE FABRIC ORDER PER TRIGGER',
      riskStatus: 'MONITORING - TRIGGER > 14D',
      riskTier: 'monitoring',
    };
  });
}

export function buildLineShortcutSummaries(
  evaluatedRecords: EvaluatedPlanningRecord[],
  referenceDateIso: string,
  options: PlanningRuleOptions = {}
): LineShortcutSummary[] {
  const inputOffset = Math.max(1, options.inputStartOffsetDays ?? 10);
  const foOffset = Math.max(1, options.upcomingFoOffsetDays ?? 20);
  const lineOrder: string[] = [];
  const lineGroups = new Map<string, EvaluatedPlanningRecord[]>();

  for (const rec of evaluatedRecords) {
    const key = `${rec.factory}::${rec.line}`;
    if (!lineGroups.has(key)) {
      lineOrder.push(key);
      lineGroups.set(key, []);
    }
    lineGroups.get(key)!.push(rec);
  }

  return lineOrder.map((key) => {
    const list = lineGroups.get(key)!;
    const sorted = [...list].sort((a, b) => a.slot - b.slot);
    const sample = sorted[0];

    const runningRecord =
      sorted.find((r) => r.lifecycleStage === 'Running') ?? null;
    const upcomingRecord =
      sorted.find((r) => r.lifecycleStage === 'Upcoming (Next)') ?? null;

    // Rule: New style input starts N days before Running Style End Date (default 10D)
    const newStyleInputStartIso = runningRecord?.endDateIso
      ? addDaysIso(runningRecord.endDateIso, -inputOffset)
      : null;

    // Rule: Fabric Order required M days before New Style Input Start Date (default 20D)
    const upcomingFoTriggerIso = newStyleInputStartIso
      ? addDaysIso(newStyleInputStartIso, -foOffset)
      : null;

    const daysToUpcomingFoTrigger = diffDaysIso(upcomingFoTriggerIso, referenceDateIso);
    const cuttingAlertActive = Boolean(runningRecord?.isCuttingWithin10Days);

    const upcomingNeedsFo =
      upcomingRecord !== null &&
      upcomingRecord.foStatus !== 'In-House' &&
      upcomingRecord.foStatus !== 'FO Raised';

    const upcomingFoAlertActive =
      upcomingNeedsFo &&
      daysToUpcomingFoTrigger !== null &&
      daysToUpcomingFoTrigger <= 0;

    let summaryStatus: LineShortcutSummary['summaryStatus'] = 'ON SCHEDULE';
    let summarySeverity: LineShortcutSummary['summarySeverity'] = 'normal';
    let foNeedReason = 'Upcoming order outside 20-day FO window';

    if (!upcomingRecord) {
      summaryStatus = cuttingAlertActive ? 'CUTTING <= 10D · FO NEEDED' : 'NO UPCOMING PLAN';
      summarySeverity = cuttingAlertActive ? 'critical' : 'normal';
      foNeedReason = cuttingAlertActive
        ? `Running cutting ends in ${runningRecord?.cuttingDaysRemaining ?? 0}D — confirm next style & FO`
        : 'No queued style after running order';
    } else if (cuttingAlertActive && upcomingFoAlertActive) {
      summaryStatus = 'FO REQUIRED NOW';
      summarySeverity = 'critical';
      foNeedReason = `Cutting <= 10D (${runningRecord?.cuttingDaysRemaining ?? 0}D left) & Upcoming FO trigger passed (${formatDisplayDate(upcomingFoTriggerIso)})`;
    } else if (cuttingAlertActive) {
      summaryStatus = 'CUTTING <= 10D · FO NEEDED';
      summarySeverity = 'critical';
      foNeedReason = `Running cutting finishes in ${runningRecord?.cuttingDaysRemaining ?? 0}D — arrange fabric for ${upcomingRecord.pgNumber}`;
    } else if (upcomingFoAlertActive) {
      summaryStatus = 'FO REQUIRED NOW';
      summarySeverity = 'critical';
      foNeedReason = `20D before input start (${formatDisplayDate(newStyleInputStartIso)}) reached on ${formatDisplayDate(upcomingFoTriggerIso)}`;
    } else if (
      upcomingNeedsFo &&
      daysToUpcomingFoTrigger !== null &&
      daysToUpcomingFoTrigger <= 15
    ) {
      summaryStatus = 'FO DUE SOON';
      summarySeverity = 'warning';
      foNeedReason = `FO trigger in ${daysToUpcomingFoTrigger}D (${formatDisplayDate(upcomingFoTriggerIso)})`;
    } else if (upcomingNeedsFo && daysToUpcomingFoTrigger !== null) {
      summaryStatus = 'ON SCHEDULE';
      summarySeverity = 'upcoming';
      foNeedReason = `FO trigger on ${formatDisplayDate(upcomingFoTriggerIso)} (${daysToUpcomingFoTrigger}D)`;
    } else {
      summaryStatus = 'ON SCHEDULE';
      summarySeverity = 'normal';
      foNeedReason = `Upcoming FO status: ${upcomingRecord.foStatus}`;
    }

    return {
      factory: sample.factory,
      zone: sample.zone,
      line: sample.line,
      capacityMc: sample.capacityMc,
      productCategory: sample.productCategory,
      runningRecord,
      upcomingRecord,
      newStyleInputStartIso,
      upcomingFoTriggerIso,
      daysToUpcomingFoTrigger,
      cuttingAlertActive,
      upcomingFoAlertActive,
      foNeedReason,
      summaryStatus,
      summarySeverity,
    };
  });
}
