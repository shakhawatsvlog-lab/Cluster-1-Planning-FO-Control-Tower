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
  isManualRunning?: boolean;
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
  foChecklistConfirmed?: boolean;
  foChecklistConfirmedAtIso?: string | null;
  upcomingFoSelected?: boolean;
  upcomingFoSelectedAtIso?: string | null;
  sheetRemark?: string;
  foFullQtyReleased?: boolean;
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
  source?: 'manual' | 'sheet';
}

export interface EvaluatedPlanningRecord extends PlanningRecord {
  lifecycleStage: LineLifecycleStage;
  effectiveIssueQty: number | null;
  isFullQtyReleased: boolean;
  newStyleOutputStartIso: string | null;
  daysToNewStyleOutputStart: number | null;
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
  newStyleOutputStartIso: string | null; // Running End Date + 1 Day (when new style starts output)
  daysToNewStyleOutputStart: number | null;
  newStyleInputStartIso: string | null; // Running End Date - inputOffset Days
  daysToNewStyleInputStart: number | null; // Remaining days from referenceDateIso to New Style Input Start
  upcomingFoTriggerIso: string | null; // Input Start Date - foOffset Days (default 15D)
  daysToUpcomingFoTrigger: number | null;
  cuttingAlertActive: boolean; // Cutting <= 10 days left on running style
  upcomingFoAlertActive: boolean; // Upcoming FO trigger <= 0
  hasManualRunning: boolean;
  hasActionableUpcomingFo: boolean;
  foNeedReason: string;
  summaryStatus:
    | 'FO REQUIRED NOW'
    | 'CUTTING <= 10D · FO NEEDED'
    | 'FO DUE SOON'
    | 'ON SCHEDULE'
    | 'NO UPCOMING PLAN'
    | 'SET RUNNING STYLE';
  summarySeverity: 'critical' | 'warning' | 'upcoming' | 'normal';
}

export interface PgFoChecklistItem {
  key: string;
  factory: FactoryName;
  pgNumber: string;
  style: string;
  stageTag: 'RUNNING ORDER' | 'UPCOMING ORDER';
  lines: string[];
  totalCapacityMc: number;
  orderQty: number | null;
  issueQty: number | null;
  runningEndIso: string | null;
  newStyleOutputStartIso: string | null; // Running End + 1D
  daysToNewStyleOutputStart: number | null;
  inputStartIso: string | null;
  daysToInputStart: number | null;
  foTriggerIso: string | null;
  daysToFoTrigger: number | null;
  foStatus: FoStatus;
  foNumber: string;
  isFullQtyReleased: boolean;
  sheetRemark: string;
  cuttingFinishedQty: number;
  cuttingDaysRemaining: number | null;
  cuttingAlertActive: boolean;
  needsFo: boolean;
  isActionableWindow: boolean;
  statusLabel: string;
  reasonLabel: string;
  severity: 'released' | 'critical' | 'warning' | 'upcoming' | 'normal';
  primaryRecord: EvaluatedPlanningRecord;
  recordIds: string[];
  allSelected: boolean;
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
            isCurrentStyle: false,
            isManualRunning: false,
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
            foChecklistConfirmed: false,
            foChecklistConfirmedAtIso: null,
            upcomingFoSelected: false,
            upcomingFoSelectedAtIso: null,
            sheetRemark: '',
            foFullQtyReleased: false,
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

export function detectFullQtyReleasedFromText(text: string): boolean {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  if (
    /\b(not\s+released|unreleased|pending|partial(?:ly)?\s*(?:released|issued)?|on\s+hold|waiting|balance\s+due)\b/i.test(
      clean
    )
  ) {
    return false;
  }
  return /(full\s*(?:qty|qnty|quantity|fo|fabric)?\s*(?:is\s*|are\s*)?(?:released|issued|ok|done|complete|completed|received)|100%\s*(?:fo\s*|qty\s*)?(?:released|issued|received)|fo\s*(?:complete|completed|released|full|done)|all\s*(?:fabric|qty)\s*(?:released|issued)|\bin[\s-]*house\b)/i.test(
    clean
  );
}

export function getEffectiveIssueQty(
  rec: Pick<PlanningRecord, 'plannedQty' | 'foIssueQty'>
): number | null {
  if (rec.foIssueQty !== null && rec.foIssueQty !== undefined && !Number.isNaN(rec.foIssueQty)) {
    return rec.foIssueQty;
  }
  if (rec.plannedQty !== null && rec.plannedQty !== undefined && !Number.isNaN(rec.plannedQty)) {
    return rec.plannedQty;
  }
  return null;
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

export function buildPgSheetCuttingTotalsMap(
  cuttingEntries: DailyCuttingEntry[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of cuttingEntries) {
    if (entry.source !== 'sheet') continue;
    const pg = (entry.pgNumber || '').trim().toUpperCase();
    if (!pg || pg === '—') continue;
    const key = `${entry.factory}::${pg}`;
    map.set(key, Math.max(map.get(key) ?? 0, entry.cuttingQty || 0));
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
    const manualRunning = sorted.find(
      (item) =>
        Boolean(item.isManualRunning) &&
        item.orderStatus !== 'Order Closed' &&
        !item.isFinished
    );

    let upcomingAssigned = false;
    for (const item of sorted) {
      if (item.orderStatus === 'Order Closed' || item.isFinished) {
        stageMap.set(item.id, 'Order Closed');
      } else if (manualRunning && item.id === manualRunning.id) {
        stageMap.set(item.id, 'Running');
      } else if (
        manualRunning &&
        !upcomingAssigned &&
        item.slot > manualRunning.slot
      ) {
        stageMap.set(item.id, 'Upcoming (Next)');
        upcomingAssigned = true;
      } else {
        stageMap.set(item.id, 'Queued');
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
  const directManualTotals = new Map<string, number>();
  const directSheetTotals = new Map<string, number>();
  for (const entry of cuttingEntries) {
    if (entry.source === 'sheet') {
      directSheetTotals.set(
        entry.recordId,
        (directSheetTotals.get(entry.recordId) ?? 0) + (entry.cuttingQty || 0)
      );
    } else {
      directManualTotals.set(
        entry.recordId,
        (directManualTotals.get(entry.recordId) ?? 0) + (entry.cuttingQty || 0)
      );
    }
  }
  const pgSheetTotals = buildPgSheetCuttingTotalsMap(cuttingEntries);
  const lifecycleMap = computeLineLifecycleMap(records);

  return records.map((record) => {
    const lifecycleStage = lifecycleMap.get(record.id) ?? 'Queued';
    const isCurrentStyle = lifecycleStage === 'Running';
    const triggerDateIso = addDaysIso(record.endDateIso, -inputOffset);
    const daysToEnd = diffDaysIso(record.endDateIso, referenceDateIso);
    const daysToTrigger = diffDaysIso(triggerDateIso, referenceDateIso);

    const isOrderClosed = record.orderStatus === 'Order Closed' || record.isFinished;
    const effectiveIssueQty = getEffectiveIssueQty(record);
    const isFullQtyReleased =
      !isOrderClosed &&
      (Boolean(record.foFullQtyReleased) ||
        record.foStatus === 'In-House' ||
        detectFullQtyReleasedFromText(record.sheetRemark || '') ||
        detectFullQtyReleasedFromText(record.fabricNote || ''));

    // New Style Output starts 1 day after order end date (e.g., running ends 25 Nov -> output starts 26 Nov)
    const newStyleOutputStartIso = addDaysIso(record.endDateIso, 1);
    const daysToNewStyleOutputStart = diffDaysIso(newStyleOutputStartIso, referenceDateIso);

    const directManual = directManualTotals.get(record.id) ?? 0;
    const directSheet = directSheetTotals.get(record.id) ?? 0;
    const pgKey =
      record.pgNumber && record.pgNumber !== '—'
        ? `${record.factory}::${record.pgNumber.toUpperCase()}`
        : '';
    const pgSheet = pgKey && !isOrderClosed ? (pgSheetTotals.get(pgKey) ?? 0) : 0;
    const effectiveSheet = directSheet > 0 ? directSheet : pgSheet;

    const cuttingFinishedQty = (record.cuttingBaseQty ?? 0) + directManual + effectiveSheet;

    let cuttingRemainingQty: number | null = null;
    let cuttingDaysRemaining: number | null = null;
    let estimatedCuttingFinishIso: string | null = null;
    let isCuttingWithin10Days = false;

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

    const commonExtras = {
      isCurrentStyle,
      triggerDateIso,
      lifecycleStage,
      effectiveIssueQty,
      isFullQtyReleased,
      newStyleOutputStartIso,
      daysToNewStyleOutputStart,
      cuttingFinishedQty,
      cuttingRemainingQty,
      cuttingDaysRemaining,
      estimatedCuttingFinishIso,
      isCuttingWithin10Days,
      daysToEnd,
      daysToTrigger,
    };

    if (isOrderClosed) {
      return {
        ...record,
        ...commonExtras,
        isFinished: true,
        orderStatus: 'Order Closed',
        lifecycleStage: 'Order Closed',
        isCuttingWithin10Days: false,
        foRequired: false,
        actionRequired: false,
        actionMessage: 'ORDER CLOSED',
        riskStatus: 'ORDER CLOSED',
        riskTier: 'closed',
      };
    }

    if (isFullQtyReleased) {
      const remarkDetail = (record.sheetRemark || record.fabricNote || '').trim();
      return {
        ...record,
        ...commonExtras,
        foRequired: false,
        actionRequired: false,
        actionMessage: remarkDetail
          ? `FULL QTY RELEASED — ${remarkDetail}`
          : 'FULL QTY RELEASED - FABRIC COMPLETE',
        riskStatus: 'FULL QTY RELEASED',
        riskTier: 'on_track',
      };
    }

    if (isPlannedQtyBlank) {
      return {
        ...record,
        ...commonExtras,
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
        ...commonExtras,
        foRequired: true,
        actionRequired: true,
        actionMessage: `CUTTING FINISH IN ${cuttingDaysRemaining}D — FABRIC ORDER NEEDED`,
        riskStatus: 'CRITICAL - CUTTING <= 10D',
        riskTier: 'critical',
      };
    }

    if (record.foStatus === 'FO Raised') {
      const overdue = daysToTrigger !== null && daysToTrigger <= 0;
      return {
        ...record,
        ...commonExtras,
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
        ...commonExtras,
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
        ...commonExtras,
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
        ...commonExtras,
        foRequired: true,
        actionRequired: true,
        actionMessage: 'RAISE FABRIC ORDER BEFORE TRIGGER',
        riskStatus: 'HIGH RISK - DUE <= 14 DAYS',
        riskTier: 'high',
      };
    }

    return {
      ...record,
      ...commonExtras,
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
  const foOffset = Math.max(1, options.upcomingFoOffsetDays ?? 15);
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
    const hasManualRunning = runningRecord !== null;

    // Rule: New style output starts 1 day after Running Style End Date (e.g., ends 25 Nov -> 26 Nov)
    const newStyleOutputStartIso = runningRecord?.endDateIso
      ? addDaysIso(runningRecord.endDateIso, 1)
      : null;
    const daysToNewStyleOutputStart = diffDaysIso(newStyleOutputStartIso, referenceDateIso);

    // Rule: New style input starts N days before Running Style End Date (default 10D)
    const newStyleInputStartIso = runningRecord?.endDateIso
      ? addDaysIso(runningRecord.endDateIso, -inputOffset)
      : null;

    // Rule: Fabric Order required M days before New Style Input Start Date (default 15D)
    const upcomingFoTriggerIso = newStyleInputStartIso
      ? addDaysIso(newStyleInputStartIso, -foOffset)
      : null;

    const daysToNewStyleInputStart = diffDaysIso(newStyleInputStartIso, referenceDateIso);
    const daysToUpcomingFoTrigger = diffDaysIso(upcomingFoTriggerIso, referenceDateIso);
    const cuttingAlertActive = Boolean(runningRecord?.isCuttingWithin10Days);

    const upcomingNeedsFo =
      upcomingRecord !== null &&
      !upcomingRecord.isFullQtyReleased &&
      upcomingRecord.foStatus !== 'In-House' &&
      upcomingRecord.foStatus !== 'FO Raised';

    const upcomingFoAlertActive =
      hasManualRunning &&
      upcomingNeedsFo &&
      daysToUpcomingFoTrigger !== null &&
      daysToUpcomingFoTrigger <= 0;

    const upcomingFoDueSoon =
      hasManualRunning &&
      upcomingNeedsFo &&
      daysToUpcomingFoTrigger !== null &&
      daysToUpcomingFoTrigger > 0 &&
      daysToUpcomingFoTrigger <= 15;

    const hasActionableUpcomingFo =
      hasManualRunning &&
      (upcomingFoAlertActive || upcomingFoDueSoon || cuttingAlertActive);

    let summaryStatus: LineShortcutSummary['summaryStatus'] = 'ON SCHEDULE';
    let summarySeverity: LineShortcutSummary['summarySeverity'] = 'normal';
    let foNeedReason = `Upcoming order outside ${foOffset}-day FO window`;

    if (!hasManualRunning) {
      summaryStatus = 'SET RUNNING STYLE';
      summarySeverity = 'normal';
      foNeedReason = 'Select active Running Style manually to track next FO date';
    } else if (!upcomingRecord) {
      summaryStatus = cuttingAlertActive ? 'CUTTING <= 10D · FO NEEDED' : 'NO UPCOMING PLAN';
      summarySeverity = cuttingAlertActive ? 'critical' : 'normal';
      foNeedReason = cuttingAlertActive
        ? `Running cutting ends in ${runningRecord?.cuttingDaysRemaining ?? 0}D — confirm next style & FO`
        : 'No queued style after running order';
    } else if (upcomingRecord.isFullQtyReleased) {
      summaryStatus = 'ON SCHEDULE';
      summarySeverity = 'normal';
      foNeedReason = upcomingRecord.sheetRemark
        ? `FULL QTY RELEASED (${upcomingRecord.sheetRemark})`
        : 'FULL QTY RELEASED';
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
      foNeedReason = `${foOffset}D before input start (${formatDisplayDate(newStyleInputStartIso)}) reached on ${formatDisplayDate(upcomingFoTriggerIso)}`;
    } else if (upcomingFoDueSoon) {
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
      newStyleOutputStartIso,
      daysToNewStyleOutputStart,
      newStyleInputStartIso,
      daysToNewStyleInputStart,
      upcomingFoTriggerIso,
      daysToUpcomingFoTrigger,
      cuttingAlertActive,
      upcomingFoAlertActive,
      hasManualRunning,
      hasActionableUpcomingFo,
      foNeedReason,
      summaryStatus,
      summarySeverity,
    };
  });
}

export function buildPgFoChecklistItems(
  evaluatedRecords: EvaluatedPlanningRecord[],
  shortcutSummaries: LineShortcutSummary[],
  referenceDateIso: string,
  options: PlanningRuleOptions = {}
): PgFoChecklistItem[] {
  const inputOffset = Math.max(1, options.inputStartOffsetDays ?? 10);
  const foOffset = Math.max(1, options.upcomingFoOffsetDays ?? 15);

  const shortcutByLineKey = new Map<string, LineShortcutSummary>();
  for (const s of shortcutSummaries) {
    shortcutByLineKey.set(`${s.factory}::${s.line}`, s);
  }

  interface Bucket {
    factory: FactoryName;
    pgIdentity: string;
    pgNumber: string;
    stageTag: 'RUNNING ORDER' | 'UPCOMING ORDER';
    records: EvaluatedPlanningRecord[];
  }

  const buckets = new Map<string, Bucket>();

  for (const rec of evaluatedRecords) {
    if (rec.orderStatus === 'Order Closed' || rec.isFinished) continue;
    if (rec.styleClassification === 'Open Capacity') continue;

    // Strictly step-by-step: only currently Running and immediate Upcoming (Next) after Running.
    // Queued slots (Slot 3, 4, 5...) step in automatically one by one when the Running order finishes.
    const isRunning = rec.lifecycleStage === 'Running';
    const isUpcomingNext = rec.lifecycleStage === 'Upcoming (Next)';
    if (!isRunning && !isUpcomingNext) {
      continue;
    }

    const stageTag: 'RUNNING ORDER' | 'UPCOMING ORDER' = isRunning
      ? 'RUNNING ORDER'
      : 'UPCOMING ORDER';
    const pgNorm =
      rec.pgNumber && rec.pgNumber !== '—' ? rec.pgNumber.trim().toUpperCase() : rec.id;
    const key = `${rec.factory}::${pgNorm}::${stageTag}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        factory: rec.factory,
        pgIdentity: pgNorm,
        pgNumber: rec.pgNumber || '—',
        stageTag,
        records: [],
      };
      buckets.set(key, bucket);
    }
    bucket.records.push(rec);
  }

  const items: PgFoChecklistItem[] = [];

  for (const [key, bucket] of buckets.entries()) {
    const recs = [...bucket.records].sort((a, b) => a.line.localeCompare(b.line));
    const primaryRecord = recs[0];

    const lineCapMap = new Map<string, number>();
    for (const r of recs) {
      if (!lineCapMap.has(r.line)) {
        lineCapMap.set(r.line, r.capacityMc || 0);
      }
    }
    const lines = Array.from(lineCapMap.keys());
    const totalCapacityMc = Array.from(lineCapMap.values()).reduce((sum, c) => sum + c, 0);

    const plannedValues = recs
      .map((r) => r.plannedQty)
      .filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
    const orderQty = plannedValues.length > 0 ? Math.max(...plannedValues) : null;

    const issueValues = recs
      .map((r) => r.effectiveIssueQty)
      .filter((v): v is number => v !== null && v !== undefined && !Number.isNaN(v));
    const issueQty = issueValues.length > 0 ? Math.max(...issueValues) : orderQty;

    const isFullQtyReleased = recs.some((r) => r.isFullQtyReleased);
    const remarksSet = new Set<string>();
    for (const r of recs) {
      const sr = (r.sheetRemark || '').trim();
      const fn = (r.fabricNote || '').trim();
      if (sr) remarksSet.add(sr);
      else if (fn && detectFullQtyReleasedFromText(fn)) remarksSet.add(fn);
    }
    const sheetRemark = Array.from(remarksSet).join(' · ');

    const cuttingFinishedQty = recs.reduce(
      (maxCut, r) => Math.max(maxCut, r.cuttingFinishedQty || 0),
      0
    );
    const cuttingDaysVals = recs
      .map((r) => r.cuttingDaysRemaining)
      .filter((d): d is number => d !== null && d !== undefined);
    const cuttingDaysRemaining =
      cuttingDaysVals.length > 0 ? Math.min(...cuttingDaysVals) : null;

    let runningEndIso: string | null = null;
    let newStyleOutputStartIso: string | null = null;
    let inputStartIso: string | null = null;
    let foTriggerIso: string | null = null;
    let lineCuttingAlert = recs.some((r) => r.isCuttingWithin10Days);

    if (bucket.stageTag === 'RUNNING ORDER') {
      const endDates = recs
        .map((r) => r.endDateIso)
        .filter((d): d is string => Boolean(d))
        .sort();
      runningEndIso = endDates[0] ?? null;
      newStyleOutputStartIso = addDaysIso(runningEndIso, 1);
      inputStartIso = addDaysIso(runningEndIso, -inputOffset);
      foTriggerIso = addDaysIso(inputStartIso, -foOffset);
    } else {
      const associatedShortcuts = recs
        .map((r) => shortcutByLineKey.get(`${r.factory}::${r.line}`) ?? null)
        .filter((sc): sc is LineShortcutSummary => sc !== null);
      const runningEnds = associatedShortcuts
        .map((sc) => sc.runningRecord?.endDateIso ?? null)
        .filter((d): d is string => Boolean(d))
        .sort();
      if (associatedShortcuts.some((sc) => sc.cuttingAlertActive)) {
        lineCuttingAlert = true;
      }

      if (runningEnds.length > 0) {
        runningEndIso = runningEnds[0];
        newStyleOutputStartIso = addDaysIso(runningEndIso, 1);
        inputStartIso = addDaysIso(runningEndIso, -inputOffset);
        foTriggerIso = addDaysIso(inputStartIso, -foOffset);
      } else {
        const ownEnds = recs
          .map((r) => r.endDateIso)
          .filter((d): d is string => Boolean(d))
          .sort();
        const ownEnd = ownEnds[0] ?? null;
        newStyleOutputStartIso = ownEnd ? addDaysIso(ownEnd, 1) : null;
        inputStartIso = ownEnd ? addDaysIso(ownEnd, -inputOffset) : null;
        foTriggerIso = inputStartIso ? addDaysIso(inputStartIso, -foOffset) : null;
      }
    }

    const daysToNewStyleOutputStart = diffDaysIso(newStyleOutputStartIso, referenceDateIso);
    const daysToInputStart = diffDaysIso(inputStartIso, referenceDateIso);
    const daysToFoTrigger = diffDaysIso(foTriggerIso, referenceDateIso);

    const anyFoRaised = recs.some((r) => r.foStatus === 'FO Raised');
    const anyDelayed = recs.some((r) => r.foStatus === 'Delayed');
    const foStatus = isFullQtyReleased
      ? 'In-House'
      : anyDelayed
        ? 'Delayed'
        : anyFoRaised
          ? 'FO Raised'
          : primaryRecord.foStatus;
    const foNumber =
      recs.map((r) => (r.foNumber || '').trim()).find(Boolean) || '';

    const needsFo =
      !isFullQtyReleased &&
      foStatus !== 'In-House' &&
      (foStatus !== 'FO Raised' || (daysToFoTrigger !== null && daysToFoTrigger <= 0));

    const foOverdue = needsFo && daysToFoTrigger !== null && daysToFoTrigger <= 0;
    const foDueSoon =
      needsFo && daysToFoTrigger !== null && daysToFoTrigger > 0 && daysToFoTrigger <= 15;

    // Recent actionable window: due now/overdue, due within 15D, cutting <= 10D, delayed, or missing trigger date.
    // Distant styles (> 15D away) wait until their turn enters the recent window step by step.
    const isActionableWindow =
      isFullQtyReleased ||
      (needsFo &&
        (lineCuttingAlert ||
          foOverdue ||
          foDueSoon ||
          anyDelayed ||
          daysToFoTrigger === null));

    let statusLabel = 'ON SCHEDULE';
    let severity: PgFoChecklistItem['severity'] = 'upcoming';
    let reasonLabel = '';

    if (isFullQtyReleased) {
      statusLabel = 'FULL QTY RELEASED';
      severity = 'released';
      reasonLabel = sheetRemark
        ? `Sheet Summary: ${sheetRemark}`
        : 'Full fabric quantity released & complete';
    } else if (lineCuttingAlert && foOverdue) {
      statusLabel = 'FO REQUIRED NOW';
      severity = 'critical';
      reasonLabel = `Cutting alert + FO trigger passed (${formatDisplayDate(foTriggerIso)})`;
    } else if (lineCuttingAlert) {
      statusLabel = 'CUTTING <= 10D · FO NEEDED';
      severity = 'critical';
      reasonLabel = `Cutting finishes in ${cuttingDaysRemaining ?? 0}D — confirm FO`;
    } else if (foOverdue) {
      statusLabel = 'FO REQUIRED NOW';
      severity = 'critical';
      reasonLabel = `${foOffset}D before input start (${formatDisplayDate(inputStartIso)}) passed`;
    } else if (anyDelayed) {
      statusLabel = 'CRITICAL - FO DELAYED';
      severity = 'critical';
      reasonLabel = 'Escalate delayed fabric order';
    } else if (foDueSoon) {
      statusLabel = 'FO DUE SOON';
      severity = 'warning';
      reasonLabel = `FO needed in ${daysToFoTrigger}D (${formatDisplayDate(foTriggerIso)})`;
    } else if (daysToFoTrigger !== null && daysToFoTrigger > 15) {
      statusLabel = 'LATER · STEP BY STEP';
      severity = 'normal';
      reasonLabel =
        sheetRemark ||
        `FO needed in ${daysToFoTrigger}D (${formatDisplayDate(foTriggerIso)})`;
    } else if (orderQty === null) {
      statusLabel = 'PLAN QTY PENDING · FO NEED';
      severity = 'warning';
      reasonLabel = 'Order/Issue qty pending — check FO status';
    } else if (foStatus === 'FO Raised') {
      statusLabel = 'FO IN PROGRESS';
      severity = 'upcoming';
      reasonLabel = sheetRemark || 'FO raised — awaiting full qty release';
    } else {
      statusLabel =
        bucket.stageTag === 'RUNNING ORDER' ? 'RUNNING · FO PENDING' : 'UPCOMING · SCHEDULED';
      severity = bucket.stageTag === 'RUNNING ORDER' ? 'warning' : 'upcoming';
      reasonLabel =
        sheetRemark ||
        (foTriggerIso
          ? `FO trigger on ${formatDisplayDate(foTriggerIso)}`
          : 'Monitor FO release');
    }

    const recordIds = recs.map((r) => r.id);
    const allSelected =
      recordIds.length > 0 && recs.every((r) => Boolean(r.upcomingFoSelected));

    items.push({
      key,
      factory: bucket.factory,
      pgNumber: bucket.pgNumber,
      style: primaryRecord.style,
      stageTag: bucket.stageTag,
      lines,
      totalCapacityMc,
      orderQty,
      issueQty,
      runningEndIso,
      newStyleOutputStartIso,
      daysToNewStyleOutputStart,
      inputStartIso,
      daysToInputStart,
      foTriggerIso,
      daysToFoTrigger,
      foStatus,
      foNumber,
      isFullQtyReleased,
      sheetRemark,
      cuttingFinishedQty,
      cuttingDaysRemaining,
      cuttingAlertActive: lineCuttingAlert,
      needsFo,
      isActionableWindow,
      statusLabel,
      reasonLabel,
      severity,
      primaryRecord,
      recordIds,
      allSelected,
    });
  }

  const sevRank: Record<PgFoChecklistItem['severity'], number> = {
    critical: 0,
    warning: 1,
    upcoming: 2,
    normal: 3,
    released: 4,
  };

  return items.sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity]) {
      return sevRank[a.severity] - sevRank[b.severity];
    }
    return (a.foTriggerIso || '9999-12-31').localeCompare(b.foTriggerIso || '9999-12-31');
  });
}

export interface PgWiseQtySummary {
  uniquePgCount: number;
  releasedPgCount: number;
  foNeededPgCount: number;
  totalPgOrderQty: number;
  totalPgIssueQty: number;
  byFactory: Record<
    FactoryName,
    {
      uniquePgCount: number;
      releasedPgCount: number;
      foNeededPgCount: number;
      orderQty: number;
      issueQty: number;
    }
  >;
}

export function computePgWiseQtySummary(pgItems: PgFoChecklistItem[]): PgWiseQtySummary {
  const seenPg = new Map<
    string,
    {
      factory: FactoryName;
      orderQty: number;
      issueQty: number;
      released: boolean;
      needsFo: boolean;
    }
  >();

  for (const item of pgItems) {
    const pgKey = `${item.factory}::${
      item.pgNumber && item.pgNumber !== '—' ? item.pgNumber.toUpperCase() : item.key
    }`;
    const existing = seenPg.get(pgKey);
    const ord = item.orderQty ?? 0;
    const iss = item.issueQty ?? ord;
    if (!existing) {
      seenPg.set(pgKey, {
        factory: item.factory,
        orderQty: ord,
        issueQty: iss,
        released: item.isFullQtyReleased,
        needsFo: item.needsFo,
      });
    } else {
      existing.orderQty = Math.max(existing.orderQty, ord);
      existing.issueQty = Math.max(existing.issueQty, iss);
      existing.released = existing.released || item.isFullQtyReleased;
      existing.needsFo = existing.needsFo && !existing.released ? true : item.needsFo;
    }
  }

  const byFactory: PgWiseQtySummary['byFactory'] = {
    'ALEX 1': { uniquePgCount: 0, releasedPgCount: 0, foNeededPgCount: 0, orderQty: 0, issueQty: 0 },
    'ALEX 3': { uniquePgCount: 0, releasedPgCount: 0, foNeededPgCount: 0, orderQty: 0, issueQty: 0 },
    'ALEX 5': { uniquePgCount: 0, releasedPgCount: 0, foNeededPgCount: 0, orderQty: 0, issueQty: 0 },
    'ALEX 12': { uniquePgCount: 0, releasedPgCount: 0, foNeededPgCount: 0, orderQty: 0, issueQty: 0 },
  };

  let uniquePgCount = 0;
  let releasedPgCount = 0;
  let foNeededPgCount = 0;
  let totalPgOrderQty = 0;
  let totalPgIssueQty = 0;

  for (const entry of seenPg.values()) {
    uniquePgCount += 1;
    if (entry.released) releasedPgCount += 1;
    if (entry.needsFo && !entry.released) foNeededPgCount += 1;
    totalPgOrderQty += entry.orderQty;
    totalPgIssueQty += entry.issueQty;

    const facBucket = byFactory[entry.factory];
    facBucket.uniquePgCount += 1;
    if (entry.released) facBucket.releasedPgCount += 1;
    if (entry.needsFo && !entry.released) facBucket.foNeededPgCount += 1;
    facBucket.orderQty += entry.orderQty;
    facBucket.issueQty += entry.issueQty;
  }

  return {
    uniquePgCount,
    releasedPgCount,
    foNeededPgCount,
    totalPgOrderQty,
    totalPgIssueQty,
    byFactory,
  };
}
