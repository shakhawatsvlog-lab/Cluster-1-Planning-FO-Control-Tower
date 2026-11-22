import crypto from 'crypto';
import ExcelJS from 'exceljs';
import {
  ALLOWED_FACTORIES,
  detectFullQtyReleasedFromText,
  parseCsvRows,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  FactoryName,
  PlanningRecord,
} from '../shared/plannerTypes.ts';
import type {
  CuttingSheetSyncConfig,
  CuttingSheetSyncLog,
  CuttingSheetSyncMode,
  FactorySyncStatusMap,
} from '../shared/cuttingSheetTypes.ts';
import {
  applySyncedCuttingEntries,
  getWorkspaceState,
} from './workspaceStore.ts';
import type { RecordSheetPatch } from './workspaceStore.ts';
import { MAX_UPLOAD_BYTES, assertSafeExternalUrl } from './security.ts';

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
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function resolveSheetCsvUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  // Handle Google Sheets "Publish to web" URL
  if (trimmed.includes('docs.google.com/spreadsheets/d/e/')) {
    if (trimmed.includes('output=csv')) return trimmed;
    const base = trimmed.replace(/\/pubhtml.*$/i, '/pub');
    try {
      const parsed = new URL(trimmed);
      const gid = parsed.searchParams.get('gid');
      const out = new URL(base);
      out.searchParams.set('output', 'csv');
      if (gid) out.searchParams.set('gid', gid);
      return out.toString();
    } catch {
      return base.includes('?') ? `${base}&output=csv` : `${base}?output=csv`;
    }
  }

  // Handle standard Google Sheets share/edit/view URL
  const sheetMatch = trimmed.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetMatch) {
    const spreadsheetId = sheetMatch[1];
    let gid = '';
    try {
      const u = new URL(trimmed);
      gid = u.searchParams.get('gid') || '';
      if (!gid && u.hash) {
        const hashMatch = u.hash.match(/gid=(\d+)/);
        if (hashMatch) gid = hashMatch[1];
      }
    } catch {
      const hashMatch = trimmed.match(/gid=(\d+)/);
      if (hashMatch) gid = hashMatch[1];
    }
    const exportUrl = new URL(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export`
    );
    exportUrl.searchParams.set('format', 'csv');
    if (gid) exportUrl.searchParams.set('gid', gid);
    return exportUrl.toString();
  }

  // Handle SharePoint / OneDrive for Business shared Excel URLs
  if (/sharepoint\.com/i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (!u.searchParams.has('download')) {
        u.searchParams.set('download', '1');
      }
      return u.toString();
    } catch {
      return trimmed.includes('?') ? `${trimmed}&download=1` : `${trimmed}?download=1`;
    }
  }

  // Handle personal OneDrive URLs
  if (/onedrive\.live\.com/i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (u.pathname.includes('embed')) {
        u.pathname = u.pathname.replace('embed', 'download');
      } else if (!u.searchParams.has('download')) {
        u.searchParams.set('download', '1');
      }
      return u.toString();
    } catch {
      return trimmed.includes('?') ? `${trimmed}&download=1` : `${trimmed}?download=1`;
    }
  }

  // Handle Dropbox shared link
  if (trimmed.includes('dropbox.com') && trimmed.includes('dl=0')) {
    return trimmed.replace('dl=0', 'dl=1');
  }

  return trimmed;
}

export function detectFactoryHintFromText(raw: string): FactoryName | null {
  const upper = raw.toUpperCase();
  if (/\bALEX[\s\-_]*12\b/.test(upper) || /\bA[\s\-_]*12\b/.test(upper) || /\bUNIT[\s\-_]*12\b/.test(upper)) {
    return 'ALEX 12';
  }
  if (/\bALEX[\s\-_]*5\b/.test(upper) || /\bA[\s\-_]*5\b/.test(upper) || /\bUNIT[\s\-_]*5\b/.test(upper)) {
    return 'ALEX 5';
  }
  if (/\bALEX[\s\-_]*3\b/.test(upper) || /\bA[\s\-_]*3\b/.test(upper) || /\bUNIT[\s\-_]*3\b/.test(upper)) {
    return 'ALEX 3';
  }
  if (/\bALEX[\s\-_]*1\b/.test(upper) || /\bA[\s\-_]*1\b/.test(upper) || /\bUNIT[\s\-_]*1\b/.test(upper)) {
    return 'ALEX 1';
  }
  return null;
}

function normalizeFactoryValue(raw: string): FactoryName | null {
  const compact = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  if (compact === 'ALEX12' || compact === 'A12' || compact === 'UNIT12') return 'ALEX 12';
  if (compact === 'ALEX5' || compact === 'A5' || compact === 'UNIT5') return 'ALEX 5';
  if (compact === 'ALEX3' || compact === 'A3' || compact === 'UNIT3') return 'ALEX 3';
  if (compact === 'ALEX1' || compact === 'A1' || compact === 'UNIT1') return 'ALEX 1';
  for (const fac of ALLOWED_FACTORIES) {
    if (fac.replace(/\s+/g, '') === compact) return fac;
  }
  return null;
}

function normalizePgValue(raw: string): string | null {
  const clean = raw.trim().toUpperCase();
  if (!clean) return null;
  const pgMatch = clean.match(/PG[\s#\-:]*(\d{3,8})/i);
  if (pgMatch) return `PG-${pgMatch[1]}`;
  const digitsOnly = clean.match(/^\d{4,7}$/);
  if (digitsOnly) return `PG-${digitsOnly[0]}`;
  return null;
}

function extractExtraStyleCodeTokens(raw: string): string[] {
  const upper = raw.toUpperCase();
  const tokens: string[] = [];
  const matches = upper.match(/\b(TLCS\d{3,4}[A-Z]*|CS\d{3,4}[A-Z]*|LST\d{3,4}[A-Z]*|ST\d{3,4}[A-Z]*|MM\d{3,5}|LK\d{3,4}|K\d{3,4})\b/g);
  if (matches) {
    for (const m of matches) {
      if (!tokens.includes(m)) tokens.push(m);
    }
  }
  const fiveDigits = upper.match(/\b(\d{5})\b/g);
  if (fiveDigits) {
    for (const d of fiveDigits) {
      if (!tokens.includes(d)) tokens.push(d);
    }
  }
  return tokens;
}

function extractLineTokens(raw: string): string[] {
  const cleaned = raw.trim().toUpperCase();
  if (!cleaned) return [];
  const parts = cleaned.split(/[-,/&\s]+/).filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    const m = part.match(/(\d{1,3}[A-Z]?)$/);
    if (m && !tokens.includes(m[1])) {
      tokens.push(m[1]);
    }
  }
  return tokens;
}

function toIsoDate(year: number, monthIndex: number, day: number): string | null {
  if (year < 2000 || year > 2100 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, monthIndex, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== monthIndex ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

export function parseFlexibleSheetDate(raw: string, fallbackYear: number): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  // JS Date.toString() like "Thu Nov 19 2026 00:00:00 GMT..."
  const jsDateMatch = s.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/);
  if (jsDateMatch) {
    const mon = MONTH_MAP[jsDateMatch[1].toLowerCase()];
    if (mon !== undefined) {
      return toIsoDate(Number(jsDateMatch[3]), mon, Number(jsDateMatch[2]));
    }
  }

  // DD-MMM-YY or DD-MMM-YYYY or DD MMM YYYY or DD-MMM
  const dmyText = s.match(/^(\d{1,2})[\s\-/.]([A-Za-z]{3,9})(?:[\s\-/.](\d{2,4}))?$/);
  if (dmyText) {
    const day = Number(dmyText[1]);
    const mon = MONTH_MAP[dmyText[2].toLowerCase()];
    if (mon !== undefined) {
      let yr = fallbackYear;
      if (dmyText[3]) {
        const yNum = Number(dmyText[3]);
        yr = yNum < 100 ? 2000 + yNum : yNum;
      }
      return toIsoDate(yr, mon, day);
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or MM/DD/YYYY
  const slashMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (slashMatch) {
    const a = Number(slashMatch[1]);
    const b = Number(slashMatch[2]);
    const yRaw = Number(slashMatch[3]);
    const year = yRaw < 100 ? 2000 + yRaw : yRaw;
    if (a > 12) {
      return toIsoDate(year, b - 1, a);
    }
    if (b > 12) {
      return toIsoDate(year, a - 1, b);
    }
    return toIsoDate(year, b - 1, a);
  }

  return null;
}

function parseNumericCell(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '').replace(/(pcs|pc|yds|yd|kg)$/i, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

function splitSheetTextRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] || '';
  if (firstLine.includes('\t') && !firstLine.includes(',')) {
    return clean
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split('\t').map((c) => c.trim()));
  }
  return parseCsvRows(clean);
}

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
}

function recordMatchesLineToken(recordLine: string, sheetTokens: string[]): 'exact' | 'digits' | 'none' {
  if (sheetTokens.length === 0) return 'none';
  const recTokens = extractLineTokens(recordLine);
  for (const st of sheetTokens) {
    if (recTokens.includes(st)) return 'exact';
  }
  const sheetDigits = sheetTokens.map((t) => t.replace(/[A-Z]+$/i, '')).filter(Boolean);
  const recDigits = recTokens.map((t) => t.replace(/[A-Z]+$/i, '')).filter(Boolean);
  for (const sd of sheetDigits) {
    if (recDigits.includes(sd)) return 'digits';
  }
  return 'none';
}

function findAllMatchingRecordsForPg(
  records: PlanningRecord[],
  factory: FactoryName | null,
  pgNumber: string | null,
  lineRaw: string | null,
  extraCodes: string[] = []
): PlanningRecord[] {
  let candidates: PlanningRecord[] = [];

  if (pgNumber) {
    candidates = records.filter((r) => {
      if (r.pgNumber.toUpperCase() !== pgNumber.toUpperCase()) return false;
      if (factory && r.factory !== factory) return false;
      return true;
    });
  }

  // Fallback: match by style code tokens (e.g. CS440P, CS440LSP, TLCS440P, or PG digits inside style)
  if (candidates.length === 0 && extraCodes.length > 0) {
    candidates = records.filter((r) => {
      if (factory && r.factory !== factory) return false;
      const upperStyle = r.style.toUpperCase();
      return extraCodes.some((code) => upperStyle.includes(code));
    });
  }

  if (candidates.length === 0) return [];

  const sheetTokens = lineRaw ? extractLineTokens(lineRaw) : [];
  if (sheetTokens.length > 0) {
    const exactLineMatches = candidates.filter(
      (r) => recordMatchesLineToken(r.line, sheetTokens) === 'exact'
    );
    if (exactLineMatches.length > 0) {
      return exactLineMatches;
    }
    const digitLineMatches = candidates.filter(
      (r) => recordMatchesLineToken(r.line, sheetTokens) === 'digits'
    );
    if (digitLineMatches.length > 0) {
      return digitLineMatches;
    }
  }

  return candidates;
}

function findAllRecordsForPgAcrossLines(
  records: PlanningRecord[],
  factory: FactoryName | null,
  pgNumber: string | null,
  extraCodes: string[] = []
): PlanningRecord[] {
  return findAllMatchingRecordsForPg(records, factory, pgNumber, null, extraCodes);
}

function pickMatchingRecord(
  records: PlanningRecord[],
  factory: FactoryName | null,
  pgNumber: string | null,
  lineRaw: string | null,
  extraCodes: string[] = []
): PlanningRecord | null {
  const pool = findAllMatchingRecordsForPg(records, factory, pgNumber, lineRaw, extraCodes);
  if (pool.length === 0) return null;

  return (
    pool.find((r) => r.isManualRunning && r.orderStatus !== 'Order Closed') ??
    pool.find((r) => r.orderStatus !== 'Order Closed') ??
    pool[0]
  );
}

export interface ParsedSheetResult {
  entries: DailyCuttingEntry[];
  recordUpdates: RecordSheetPatch[];
  matchedRows: number;
  unmatchedCount: number;
  sampleUnmatched: string[];
  totalQty: number;
  detectedLayout: 'daily_rows' | 'date_matrix' | 'cumulative_pg' | 'pg_tabs_xlsx';
}

export function parseSheetRowsMatrix(params: {
  rows: string[][];
  records: PlanningRecord[];
  referenceDateIso: string;
  syncMode: CuttingSheetSyncMode;
  defaultFactory?: FactoryName | null;
  sheetLabel?: string;
}): ParsedSheetResult {
  const { rows, records, referenceDateIso, syncMode, defaultFactory, sheetLabel } = params;
  const fallbackYear = Number(referenceDateIso.slice(0, 4)) || new Date().getFullYear();

  if (rows.length < 2) {
    return {
      entries: [],
      recordUpdates: [],
      matchedRows: 0,
      unmatchedCount: 0,
      sampleUnmatched: [],
      totalQty: 0,
      detectedLayout: 'daily_rows',
    };
  }

  // Try to infer factory from sheet title / top rows if not supplied
  let inferredFactory = defaultFactory ?? null;
  if (!inferredFactory) {
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const hint = detectFactoryHintFromText(rows[i].join(' '));
      if (hint) {
        inferredFactory = hint;
        break;
      }
    }
  }

  // Locate header row in first 12 lines
  let headerIdx = -1;
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    const joined = rows[i].map(normalizeHeader).join(' | ');
    if (
      /\bpg\b|pg#|pg no|pg number/.test(joined) &&
      (/cut|qty|pcs|total|ttl|factory|unit|date|line|target|fo/.test(joined) ||
        rows[i].some((c) => parseFlexibleSheetDate(c, fallbackYear) !== null))
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers = rows[headerIdx];
  const normHeaders = headers.map(normalizeHeader);

  const findCol = (patterns: RegExp[], excludeIdx = new Set<number>()): number =>
    normHeaders.findIndex((h, idx) => !excludeIdx.has(idx) && patterns.some((p) => p.test(h)));

  const colFactory = findCol([/^factory$/, /^unit$/, /^plant$/, /^fac$/, /factory/]);
  const colLine = findCol([/^line$/, /^line no$/, /^line#$/, /sewing line/, /^line number$/]);
  const colPg = findCol([/^pg$/, /^pg#$/, /^pg no$/, /^pg number$/, /^pgno$/, /\bpg\b/]);
  const colStyle = findCol([/^des$/, /^style$/, /description/, /style name/]);
  const colDate = findCol([
    /^date$/,
    /cutting date/,
    /cut date/,
    /entry date/,
    /update date/,
    /^tarikh$/,
  ]);
  const colDailyTarget = findCol([
    /per day target/,
    /daily target/,
    /target day/,
    /target\/day/,
    /target qty/,
    /day target/,
    /daily cap/,
    /^target$/,
  ]);
  const colOrderQtyExplicit = findCol([
    /order qty/,
    /planned qty/,
    /plan qty/,
    /^ttl fo$/,
    /fo qty/,
    /po qty/,
    /ttl order/,
    /total order/,
    /^total qty$/,
    /^ttl qty$/,
  ]);
  const reservedCols = new Set<number>(
    [colFactory, colLine, colPg, colStyle, colDate, colDailyTarget, colOrderQtyExplicit].filter(
      (x) => x !== -1
    )
  );
  let colQty = findCol(
    [
      /today.*cut/,
      /daily.*cut/,
      /cutting qty/,
      /cut qty/,
      /cutting finished/,
      /finished qty/,
      /ttl.*cut/,
      /total.*cut/,
      /cut.*till/,
      /ttl input/,
      /^cutting$/,
      /^cut$/,
      /^pcs$/,
    ],
    reservedCols
  );
  let colOrderQty = colOrderQtyExplicit;
  if (colOrderQty === -1 && colQty !== -1) {
    colOrderQty = findCol([/^qty$/], new Set([...reservedCols, colQty]));
  } else if (colQty === -1) {
    colQty = findCol([/^qty$/], reservedCols);
  }
  const colFoStatus = findCol(
    [/fo\s*status/, /fabric\s*status/, /release\s*status/, /fo\s*remark/, /^fo\s*complete/, /^status$/],
    reservedCols
  );
  const colRemarks = findCol(
    [/remark/, /summary/, /^note$/, /^notes$/, /comment/, /feedback/, /shift/],
    new Set([...reservedCols, colQty, colOrderQty].filter((x) => x !== -1))
  );

  const dateMatrixCols: Array<{ idx: number; dateIso: string }> = [];
  headers.forEach((h, idx) => {
    if (
      idx === colDate ||
      idx === colPg ||
      idx === colFactory ||
      idx === colLine ||
      idx === colOrderQty ||
      idx === colDailyTarget ||
      idx === colQty
    ) {
      return;
    }
    const dIso = parseFlexibleSheetDate(h, fallbackYear);
    if (dIso) {
      dateMatrixCols.push({ idx, dateIso: dIso });
    }
  });

  if (colPg === -1) {
    throw new Error(
      `Could not find a "PG#" column${sheetLabel ? ` in "${sheetLabel}"` : ''}. Make sure the sheet has a header row with PG# and Cutting Qty.`
    );
  }

  const useMatrix =
    dateMatrixCols.length >= 2 && (colQty === -1 || syncMode === 'daily_rows') && colDate === -1;

  const isCumulativeCol =
    syncMode === 'cumulative_pg' ||
    (colQty !== -1 &&
      /(ttl|total|till|cum|finished|ttl input)/.test(normHeaders[colQty]) &&
      !/(daily|today)/.test(normHeaders[colQty]));

  const detectedLayout: ParsedSheetResult['detectedLayout'] = useMatrix
    ? 'date_matrix'
    : colDate !== -1 && !isCumulativeCol
      ? 'daily_rows'
      : 'cumulative_pg';

  interface GroupedPgData {
    primaryRecord: PlanningRecord;
    allRecordIds: Set<string>;
    cuttingByDate: Map<string, number>;
    latestCuttingDateIso: string;
    orderQty: number | null;
    orderQtyDateIso: string;
    dailyTargetQty: number | null;
    dailyTargetDateIso: string;
    remarks: Set<string>;
    foFullQtyReleased: boolean;
  }

  const groupedByPrimaryId = new Map<string, GroupedPgData>();

  let matchedRows = 0;
  let unmatchedCount = 0;
  const sampleUnmatched: string[] = [];

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c.trim())) continue;

    const rawPg = row[colPg] || '';
    const pgNumber = normalizePgValue(rawPg);
    const rawStyle = colStyle !== -1 ? row[colStyle] || '' : '';
    const extraCodes = extractExtraStyleCodeTokens(`${rawPg} ${rawStyle}`);
    if (!pgNumber && extraCodes.length === 0) continue;

    const rawFactory = colFactory !== -1 ? row[colFactory] || '' : '';
    const factory = normalizeFactoryValue(rawFactory) ?? inferredFactory ?? null;
    const lineRaw = colLine !== -1 ? row[colLine] || '' : null;

    const allMatched = findAllMatchingRecordsForPg(
      records,
      factory,
      pgNumber,
      lineRaw,
      extraCodes
    );
    const primaryRecord =
      allMatched.find((rec) => rec.isManualRunning && rec.orderStatus !== 'Order Closed') ??
      allMatched.find((rec) => rec.orderStatus !== 'Order Closed') ??
      allMatched[0] ??
      null;

    if (!primaryRecord) {
      unmatchedCount += 1;
      if (sampleUnmatched.length < 6) {
        sampleUnmatched.push(
          `${factory ?? 'Any Factory'} · ${pgNumber || extraCodes[0] || rawPg}${lineRaw ? ` (Line ${lineRaw})` : ''}`
        );
      }
      continue;
    }

    const isPgSummarySheet = Boolean(
      sheetLabel && /summary|status|report/i.test(sheetLabel)
    );
    const updateTargets =
      isPgSummarySheet || !lineRaw
        ? findAllRecordsForPgAcrossLines(records, factory, pgNumber, extraCodes)
        : allMatched;

    let grp = groupedByPrimaryId.get(primaryRecord.id);
    if (!grp) {
      grp = {
        primaryRecord,
        allRecordIds: new Set(updateTargets.map((rec) => rec.id)),
        cuttingByDate: new Map<string, number>(),
        latestCuttingDateIso: '',
        orderQty: null,
        orderQtyDateIso: '',
        dailyTargetQty: null,
        dailyTargetDateIso: '',
        remarks: new Set<string>(),
        foFullQtyReleased: false,
      };
      groupedByPrimaryId.set(primaryRecord.id, grp);
    } else {
      for (const rec of updateTargets) grp.allRecordIds.add(rec.id);
    }

    const rowRemark = colRemarks !== -1 ? (row[colRemarks] || '').trim() : '';
    const rowFoStatus = colFoStatus !== -1 ? (row[colFoStatus] || '').trim() : '';
    if (rowFoStatus) grp.remarks.add(rowFoStatus);
    if (rowRemark) grp.remarks.add(rowRemark);
    if (
      detectFullQtyReleasedFromText(rowRemark) ||
      detectFullQtyReleasedFromText(rowFoStatus)
    ) {
      grp.foFullQtyReleased = true;
    }

    const parsedDate =
      colDate !== -1 ? parseFlexibleSheetDate(row[colDate] || '', fallbackYear) : null;
    const rowDateIso = parsedDate || referenceDateIso;

    if (colOrderQty !== -1) {
      const ordQty = parseNumericCell(row[colOrderQty] || '');
      if (ordQty && rowDateIso >= grp.orderQtyDateIso) {
        grp.orderQty = ordQty;
        grp.orderQtyDateIso = rowDateIso;
      }
    }

    if (colDailyTarget !== -1) {
      const tgtQty = parseNumericCell(row[colDailyTarget] || '');
      if (tgtQty && rowDateIso >= grp.dailyTargetDateIso) {
        grp.dailyTargetQty = tgtQty;
        grp.dailyTargetDateIso = rowDateIso;
      }
    }

    if (useMatrix) {
      let rowHadQty = false;
      for (const dc of dateMatrixCols) {
        const qty = parseNumericCell(row[dc.idx] || '');
        if (!qty) continue;
        rowHadQty = true;
        const prevDateVal = grp.cuttingByDate.get(dc.dateIso) ?? 0;
        grp.cuttingByDate.set(
          dc.dateIso,
          isCumulativeCol ? Math.max(prevDateVal, qty) : prevDateVal + qty
        );
        if (!grp.latestCuttingDateIso || dc.dateIso > grp.latestCuttingDateIso) {
          grp.latestCuttingDateIso = dc.dateIso;
        }
      }
      if (rowHadQty) matchedRows += 1;
      continue;
    }

    if (colQty !== -1) {
      const qty = parseNumericCell(row[colQty] || '');
      if (qty) {
        matchedRows += 1;
        const prevDateVal = grp.cuttingByDate.get(rowDateIso) ?? 0;
        grp.cuttingByDate.set(
          rowDateIso,
          isCumulativeCol ? Math.max(prevDateVal, qty) : prevDateVal + qty
        );
        if (!grp.latestCuttingDateIso || rowDateIso > grp.latestCuttingDateIso) {
          grp.latestCuttingDateIso = rowDateIso;
        }
      } else if (grp.orderQty || grp.dailyTargetQty || rowRemark || rowFoStatus) {
        matchedRows += 1;
      }
    } else if (grp.orderQty || grp.dailyTargetQty || rowRemark || rowFoStatus) {
      matchedRows += 1;
    }
  }

  if (
    colQty === -1 &&
    colOrderQty === -1 &&
    colDailyTarget === -1 &&
    colRemarks === -1 &&
    colFoStatus === -1 &&
    dateMatrixCols.length === 0
  ) {
    throw new Error(
      `Could not find Cutting Qty, Order Qty, Daily Target, or Remarks columns${sheetLabel ? ` in "${sheetLabel}"` : ''}.`
    );
  }

  const entries: DailyCuttingEntry[] = [];
  const recordUpdates: RecordSheetPatch[] = [];
  let totalQty = 0;

  for (const grp of groupedByPrimaryId.values()) {
    const joinedRemark = Array.from(grp.remarks).join(' · ').trim();
    if (
      grp.orderQty !== null ||
      grp.dailyTargetQty !== null ||
      joinedRemark.length > 0 ||
      grp.foFullQtyReleased
    ) {
      recordUpdates.push({
        recordIds: Array.from(grp.allRecordIds),
        plannedQty: grp.orderQty,
        dailyTargetQty: grp.dailyTargetQty,
        sheetRemark: joinedRemark || undefined,
        foFullQtyReleased: grp.foFullQtyReleased,
      });
    }

    if (grp.cuttingByDate.size > 0) {
      const latestDate =
        grp.latestCuttingDateIso ||
        Array.from(grp.cuttingByDate.keys()).sort().pop() ||
        referenceDateIso;

      let finalCuttingQty = 0;
      if (isCumulativeCol) {
        // Take ONLY the latest date's updated total cutting qty (prevent double-counting snapshots)
        finalCuttingQty = grp.cuttingByDate.get(latestDate) ?? 0;
      } else {
        // Daily rows / date columns: sum incremental daily output up to the latest date
        for (const q of grp.cuttingByDate.values()) {
          finalCuttingQty += q;
        }
      }

      if (finalCuttingQty > 0) {
        totalQty += finalCuttingQty;
        const note = Array.from(grp.remarks).join(' · ');
        entries.push({
          id: `SHEET-${grp.primaryRecord.id}-${latestDate}`,
          dateIso: latestDate,
          recordId: grp.primaryRecord.id,
          factory: grp.primaryRecord.factory,
          line: grp.primaryRecord.line,
          pgNumber: grp.primaryRecord.pgNumber,
          style: grp.primaryRecord.style,
          cuttingQty: finalCuttingQty,
          remarks: note
            ? `Latest Total Cut (${latestDate}) · ${note}`
            : `Latest Total Cut (${latestDate})`,
          source: 'sheet',
        });
      }
    }
  }

  entries.sort((a, b) => b.dateIso.localeCompare(a.dateIso));

  return {
    entries,
    recordUpdates,
    matchedRows,
    unmatchedCount,
    sampleUnmatched,
    totalQty,
    detectedLayout,
  };
}

export function parseOnlineCuttingSheetCsv(params: {
  csvText: string;
  records: PlanningRecord[];
  referenceDateIso: string;
  syncMode: CuttingSheetSyncMode;
  defaultFactory?: FactoryName;
}): ParsedSheetResult {
  const rows = splitSheetTextRows(params.csvText);
  return parseSheetRowsMatrix({
    rows,
    records: params.records,
    referenceDateIso: params.referenceDateIso,
    syncMode: params.syncMode,
    defaultFactory: params.defaultFactory ?? null,
  });
}

function extractExcelCellString(rawValue: ExcelJS.CellValue): string {
  if (rawValue === null || rawValue === undefined) return '';
  if (rawValue instanceof Date) {
    const iso = toIsoDate(
      rawValue.getUTCFullYear(),
      rawValue.getUTCMonth(),
      rawValue.getUTCDate()
    );
    return iso ?? '';
  }
  if (typeof rawValue === 'object') {
    const obj = rawValue as unknown as Record<string, unknown>;
    if ('error' in obj && obj.error !== undefined) return '';
    if ('result' in obj) {
      return extractExcelCellString(obj.result as ExcelJS.CellValue);
    }
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return obj.richText
        .map((part: { text?: string }) => part?.text ?? '')
        .join('')
        .trim();
    }
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text.trim();
    }
    if ('hyperlink' in obj && typeof obj.hyperlink === 'string') {
      return String(obj.text ?? obj.hyperlink).trim();
    }
    return '';
  }
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) return '';
    return String(rawValue);
  }
  return String(rawValue).trim();
}

function worksheetToStringMatrix(ws: ExcelJS.Worksheet, maxCols = 40): string[][] {
  const colCount = Math.min(Math.max(ws.actualColumnCount || ws.columnCount || 1, 1), maxCols);
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    let hasValue = false;
    for (let c = 1; c <= colCount; c++) {
      const str = extractExcelCellString(row.getCell(c).value);
      if (str) hasValue = true;
      cells.push(str);
    }
    if (hasValue) {
      rows.push(cells);
    }
  }
  return rows;
}

export async function parseOnlineCuttingXlsxBuffer(params: {
  buffer: Buffer;
  records: PlanningRecord[];
  referenceDateIso: string;
  syncMode: CuttingSheetSyncMode;
  defaultFactory?: FactoryName | null;
  sourceLabel?: string;
}): Promise<ParsedSheetResult> {
  const { buffer, records, referenceDateIso, syncMode, sourceLabel } = params;
  const fallbackYear = Number(referenceDateIso.slice(0, 4)) || new Date().getFullYear();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

  let inferredFactory: FactoryName | null = params.defaultFactory ?? null;
  if (!inferredFactory && sourceLabel) {
    inferredFactory = detectFactoryHintFromText(sourceLabel);
  }
  if (!inferredFactory) {
    for (const ws of wb.worksheets.slice(0, 5)) {
      const nameHint = detectFactoryHintFromText(ws.name);
      if (nameHint) {
        inferredFactory = nameHint;
        break;
      }
      for (let r = 1; r <= Math.min(4, ws.rowCount); r++) {
        const row = ws.getRow(r);
        let joined = '';
        for (let c = 1; c <= Math.min(10, ws.columnCount); c++) {
          const s = extractExcelCellString(row.getCell(c).value);
          if (s) joined += ` ${s}`;
        }
        const rowHint = detectFactoryHintFromText(joined);
        if (rowHint) {
          inferredFactory = rowHint;
          break;
        }
      }
      if (inferredFactory) break;
    }
  }

  const latestEntryByRecord = new Map<
    string,
    {
      record: PlanningRecord;
      dateIso: string;
      qty: number;
      remarks: Set<string>;
    }
  >();
  const recordPatchMap = new Map<
    string,
    {
      recordIds: Set<string>;
      plannedQty: number | null;
      dailyTargetQty: number | null;
      remarks: Set<string>;
      foFullQtyReleased: boolean;
    }
  >();
  const handledPgRecords = new Set<string>();

  let matchedRows = 0;
  let unmatchedCount = 0;
  const sampleUnmatched: string[] = [];
  const handledSheetIds = new Set<number>();
  let usedPgTabLayout = false;

  // PASS 1: Individual PG# follow-up tabs (e.g., "PG#36280 Motion Short" with Order Qty, Daily Target, & Daily Cutting)
  for (const ws of wb.worksheets) {
    const wsNameUpper = ws.name.toUpperCase();
    if (wsNameUpper === 'NOTE' || wsNameUpper === 'NOTES') continue;

    let pgFromMeta: string | null = null;
    let lineFromMeta: string | null = null;
    let styleFromMeta = '';
    let dailyTargetFromMeta: number | null = null;
    let topDateIso: string | null = null;
    let remarkFromMeta = '';
    let releasedFromMeta = false;

    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const k = extractExcelCellString(row.getCell(1).value).toLowerCase();
      const v = extractExcelCellString(row.getCell(2).value);
      if (k === 'pg' || k === 'pg#' || k === 'pg no') {
        pgFromMeta = normalizePgValue(v);
      } else if (k === 'line' || k === 'line no') {
        lineFromMeta = v;
      } else if (k === 'des' || k === 'style') {
        styleFromMeta = v;
      } else if (/per\s*day\s*target|daily\s*target|target\s*\/?\s*day/.test(k)) {
        const tVal = parseNumericCell(v);
        if (tVal) dailyTargetFromMeta = tVal;
      } else if (/remark|fo\s*status|release\s*status|summary/.test(k) && v) {
        remarkFromMeta = remarkFromMeta ? `${remarkFromMeta} · ${v}` : v;
        if (detectFullQtyReleasedFromText(v)) {
          releasedFromMeta = true;
        }
      }

      if (!topDateIso && r <= 4) {
        const maxC = Math.min(Math.max(ws.columnCount, 12), 16);
        for (let c = 1; c < maxC; c++) {
          const lbl = extractExcelCellString(row.getCell(c).value).toLowerCase();
          if (lbl === 'date' || lbl === 'update date') {
            const dIso = parseFlexibleSheetDate(
              extractExcelCellString(row.getCell(c + 1).value),
              fallbackYear
            );
            if (dIso) {
              topDateIso = dIso;
              break;
            }
          }
        }
      }
    }

    const pgFromTabName = normalizePgValue(ws.name);
    const pgNumber = pgFromMeta ?? pgFromTabName;
    const extraCodes = extractExtraStyleCodeTokens(`${ws.name} ${styleFromMeta}`);

    // Scan PO table header (Qty & Cut - till) and Po Data TTL / Daywise date rows
    let poHeaderRow = -1;
    let poQtyCol = -1;
    let poCutCol = -1;
    let poTtlQty: number | null = null;
    let poTtlCut: number | null = null;
    let daywiseTotalCut: number | null = null;
    let poSumQty = 0;
    let poSumCut = 0;

    // Scan Daily Cutting table header (e.g. "DATE/Line | Daily Cutting | Daily Target...")
    let dailyHeaderRow = -1;
    let dailyHeaderIsCumulative = false;
    let dateColIdx = 1;
    let cutColIdx = -1;
    let dailyTargetColIdx = -1;

    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const maxC = Math.min(Math.max(ws.columnCount, 8), 16);
      const cellTexts: string[] = [];
      for (let c = 1; c <= maxC; c++) {
        cellTexts.push(normalizeHeader(extractExcelCellString(row.getCell(c).value)));
      }
      const c1Lower = cellTexts[0] || '';

      if (poHeaderRow === -1 && r >= 7 && r <= 20) {
        const qCol = cellTexts.findIndex((t) => t === 'qty' || t === 'order qty' || t === 'po qty');
        const cCol = cellTexts.findIndex((t) =>
          /^(cut till|cut - till|ttl cut|total cut|cut qty)$/.test(t)
        );
        if (qCol !== -1 && (cellTexts.includes('po') || cellTexts.includes('color') || cCol !== -1)) {
          poHeaderRow = r;
          poQtyCol = qCol + 1;
          poCutCol = cCol !== -1 ? cCol + 1 : -1;
        }
      }

      if (c1Lower.includes('po data ttl')) {
        const qCol = poQtyCol !== -1 ? poQtyCol : 6;
        const cCol = poCutCol !== -1 ? poCutCol : 7;
        const qVal = parseNumericCell(extractExcelCellString(row.getCell(qCol).value));
        const cVal = parseNumericCell(extractExcelCellString(row.getCell(cCol).value));
        if (qVal) poTtlQty = qVal;
        if (cVal) poTtlCut = cVal;
      } else if (c1Lower.includes('daywise date')) {
        const dVal = parseNumericCell(extractExcelCellString(row.getCell(2).value));
        if (dVal) daywiseTotalCut = dVal;
      } else if (
        poHeaderRow !== -1 &&
        dailyHeaderRow === -1 &&
        r > poHeaderRow &&
        poQtyCol !== -1 &&
        !c1Lower.includes('date line')
      ) {
        const qVal = parseNumericCell(extractExcelCellString(row.getCell(poQtyCol).value));
        if (qVal) poSumQty += qVal;
        if (poCutCol !== -1) {
          const cVal = parseNumericCell(extractExcelCellString(row.getCell(poCutCol).value));
          if (cVal) poSumCut += cVal;
        }
      }

      if (dailyHeaderRow === -1) {
        const foundCutCol = cellTexts.findIndex((t) =>
          /^(daily cutting|daily cut|cutting qty|cut qty|total cut|ttl cut|cut till)$/.test(t)
        );
        const foundDateCol = cellTexts.findIndex(
          (t) => t === 'date' || t === 'date line' || t.startsWith('date ')
        );
        if (foundCutCol !== -1 && (foundDateCol !== -1 || r > 15)) {
          dailyHeaderRow = r;
          cutColIdx = foundCutCol + 1;
          dateColIdx = foundDateCol !== -1 ? foundDateCol + 1 : 1;
          dailyHeaderIsCumulative = /(ttl|total|till|cum)/.test(cellTexts[foundCutCol]);
          const foundTgtCol = cellTexts.findIndex((t) =>
            /^(daily target|per day target|target|target qty)$/.test(t)
          );
          if (foundTgtCol !== -1) dailyTargetColIdx = foundTgtCol + 1;
        }
      }
    }

    const isPgTab =
      Boolean(pgFromMeta || pgFromTabName) &&
      (dailyHeaderRow !== -1 || poHeaderRow !== -1 || poTtlQty !== null || dailyTargetFromMeta !== null);

    if (isPgTab && (pgNumber || extraCodes.length > 0)) {
      handledSheetIds.add(ws.id);
      usedPgTabLayout = true;

      let maxDailyCutDate = '';
      let sumDailyCut = 0;
      let latestDailyCutOnMaxDate = 0;
      let latestTargetFromRows: number | null = null;
      let latestTargetDate = '';

      if (dailyHeaderRow !== -1 && cutColIdx !== -1) {
        for (let r = dailyHeaderRow + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const dateStr = extractExcelCellString(row.getCell(dateColIdx).value);
          const dateIso = parseFlexibleSheetDate(dateStr, fallbackYear);
          if (!dateIso) continue;

          if (dailyTargetColIdx !== -1) {
            const tRowVal = parseNumericCell(
              extractExcelCellString(row.getCell(dailyTargetColIdx).value)
            );
            if (tRowVal && dateIso >= latestTargetDate) {
              latestTargetFromRows = tRowVal;
              latestTargetDate = dateIso;
            }
          }

          const cutStr = extractExcelCellString(row.getCell(cutColIdx).value);
          const qty = parseNumericCell(cutStr);
          if (!qty) continue;
          sumDailyCut += qty;
          if (!maxDailyCutDate || dateIso >= maxDailyCutDate) {
            if (dateIso > maxDailyCutDate) {
              latestDailyCutOnMaxDate = qty;
            } else {
              latestDailyCutOnMaxDate = Math.max(latestDailyCutOnMaxDate, qty);
            }
            maxDailyCutDate = dateIso;
          }
        }
      }

      const finalOrderQty = poTtlQty ?? (poSumQty > 0 ? poSumQty : null);
      const finalDailyTarget = latestTargetFromRows ?? dailyTargetFromMeta;
      const finalCuttingQty = dailyHeaderIsCumulative
        ? Math.max(latestDailyCutOnMaxDate, poTtlCut ?? 0)
        : Math.max(poTtlCut ?? 0, sumDailyCut, daywiseTotalCut ?? 0, poSumCut);
      const latestDateIso = maxDailyCutDate || topDateIso || referenceDateIso;

      if (finalCuttingQty === 0 && finalOrderQty === null && finalDailyTarget === null) {
        continue;
      }

      const allMatched = findAllMatchingRecordsForPg(
        records,
        inferredFactory,
        pgNumber,
        lineFromMeta,
        extraCodes
      );
      const primaryRecord =
        allMatched.find((rec) => rec.isManualRunning && rec.orderStatus !== 'Order Closed') ??
        allMatched.find((rec) => rec.orderStatus !== 'Order Closed') ??
        allMatched[0] ??
        null;

      if (!primaryRecord) {
        unmatchedCount += 1;
        if (sampleUnmatched.length < 6) {
          sampleUnmatched.push(
            `${inferredFactory ?? 'Any Factory'} · ${pgNumber || extraCodes[0] || ws.name}${lineFromMeta ? ` (Line ${lineFromMeta})` : ''}`
          );
        }
        continue;
      }

      handledPgRecords.add(primaryRecord.id);
      matchedRows += 1;

      if (
        finalOrderQty !== null ||
        finalDailyTarget !== null ||
        remarkFromMeta.length > 0 ||
        releasedFromMeta
      ) {
        const allPgMatched = findAllRecordsForPgAcrossLines(
          records,
          inferredFactory,
          pgNumber,
          extraCodes
        );
        const targetRecs = allPgMatched.length > 0 ? allPgMatched : allMatched;
        const existingPatch = recordPatchMap.get(primaryRecord.id);
        if (existingPatch) {
          for (const rec of targetRecs) existingPatch.recordIds.add(rec.id);
          if (finalOrderQty !== null) existingPatch.plannedQty = finalOrderQty;
          if (finalDailyTarget !== null) existingPatch.dailyTargetQty = finalDailyTarget;
          if (remarkFromMeta) existingPatch.remarks.add(remarkFromMeta);
          if (releasedFromMeta) existingPatch.foFullQtyReleased = true;
        } else {
          recordPatchMap.set(primaryRecord.id, {
            recordIds: new Set(targetRecs.map((rec) => rec.id)),
            plannedQty: finalOrderQty,
            dailyTargetQty: finalDailyTarget,
            remarks: remarkFromMeta ? new Set([remarkFromMeta]) : new Set(),
            foFullQtyReleased: releasedFromMeta,
          });
        }
      }

      if (finalCuttingQty > 0) {
        const existingEntry = latestEntryByRecord.get(primaryRecord.id);
        const tabNote = `${ws.name}${lineFromMeta ? ` (Line ${lineFromMeta})` : ''}`;
        if (!existingEntry || latestDateIso > existingEntry.dateIso) {
          latestEntryByRecord.set(primaryRecord.id, {
            record: primaryRecord,
            dateIso: latestDateIso,
            qty: finalCuttingQty,
            remarks: new Set([tabNote]),
          });
        } else if (latestDateIso === existingEntry.dateIso) {
          existingEntry.qty = Math.max(existingEntry.qty, finalCuttingQty);
          existingEntry.remarks.add(tabNote);
        }
      }
    }
  }

  // PASS 2: Standard tabular / Summary / date-matrix sheets
  let fallbackLayout: ParsedSheetResult['detectedLayout'] = 'daily_rows';
  for (const ws of wb.worksheets) {
    if (handledSheetIds.has(ws.id)) continue;
    const wsNameUpper = ws.name.toUpperCase();
    if (wsNameUpper === 'NOTE' || wsNameUpper === 'NOTES') continue;
    // When PG tabs were already parsed, only scan Summary tab to fill in any missing PG#s
    const isSummaryFallback = usedPgTabLayout;
    if (isSummaryFallback && !/SUMMARY|STATUS|REPORT/.test(wsNameUpper)) {
      continue;
    }

    const matrixRows = worksheetToStringMatrix(ws);
    if (matrixRows.length < 2) continue;

    try {
      const parsed = parseSheetRowsMatrix({
        rows: matrixRows,
        records,
        referenceDateIso,
        syncMode,
        defaultFactory: inferredFactory,
        sheetLabel: ws.name,
      });
      fallbackLayout = parsed.detectedLayout;

      for (const upd of parsed.recordUpdates) {
        const primaryId = upd.recordIds[0];
        if (!primaryId) continue;
        // Always merge Summary/Status remarks & Full Qty Released even for PGs handled in PASS 1
        const existingPatch = recordPatchMap.get(primaryId);
        if (existingPatch) {
          for (const rid of upd.recordIds) existingPatch.recordIds.add(rid);
          if (existingPatch.plannedQty === null && upd.plannedQty !== undefined && upd.plannedQty !== null) {
            existingPatch.plannedQty = upd.plannedQty;
          }
          if (
            existingPatch.dailyTargetQty === null &&
            upd.dailyTargetQty !== undefined &&
            upd.dailyTargetQty !== null
          ) {
            existingPatch.dailyTargetQty = upd.dailyTargetQty;
          }
          if (upd.sheetRemark) {
            existingPatch.remarks.add(upd.sheetRemark);
          }
          if (upd.foFullQtyReleased) {
            existingPatch.foFullQtyReleased = true;
          }
        } else {
          recordPatchMap.set(primaryId, {
            recordIds: new Set(upd.recordIds),
            plannedQty: upd.plannedQty ?? null,
            dailyTargetQty: upd.dailyTargetQty ?? null,
            remarks: upd.sheetRemark ? new Set([upd.sheetRemark]) : new Set(),
            foFullQtyReleased: Boolean(upd.foFullQtyReleased),
          });
        }
      }

      if (!isSummaryFallback) {
        matchedRows += parsed.matchedRows;
        unmatchedCount += parsed.unmatchedCount;
        for (const s of parsed.sampleUnmatched) {
          if (sampleUnmatched.length < 6 && !sampleUnmatched.includes(s)) {
            sampleUnmatched.push(s);
          }
        }
      }

      for (const entry of parsed.entries) {
        if (isSummaryFallback && handledPgRecords.has(entry.recordId)) continue;
        const matchedRecord = records.find((r) => r.id === entry.recordId);
        if (!matchedRecord) continue;
        const existing = latestEntryByRecord.get(entry.recordId);
        if (!existing || entry.dateIso > existing.dateIso) {
          latestEntryByRecord.set(entry.recordId, {
            record: matchedRecord,
            dateIso: entry.dateIso,
            qty: entry.cuttingQty,
            remarks: new Set([ws.name]),
          });
        } else if (entry.dateIso === existing.dateIso) {
          existing.qty = Math.max(existing.qty, entry.cuttingQty);
          existing.remarks.add(ws.name);
        }
      }
    } catch {
      // Skip unrelated sheets like empty Sheet1 or Note sheets
    }
  }

  const entries: DailyCuttingEntry[] = [];
  let totalQty = 0;

  for (const item of latestEntryByRecord.values()) {
    totalQty += item.qty;
    const note = Array.from(item.remarks).join(' · ');
    entries.push({
      id: `SHEET-${item.record.id}-${item.dateIso}`,
      dateIso: item.dateIso,
      recordId: item.record.id,
      factory: item.record.factory,
      line: item.record.line,
      pgNumber: item.record.pgNumber,
      style: item.record.style,
      cuttingQty: item.qty,
      remarks: note ? `Latest Total Cut (${item.dateIso}) · ${note}` : `Latest Total Cut (${item.dateIso})`,
      source: 'sheet',
    });
  }

  entries.sort((a, b) => b.dateIso.localeCompare(a.dateIso));

  const recordUpdates: RecordSheetPatch[] = Array.from(recordPatchMap.values()).map((p) => {
    const joinedRemark = Array.from(p.remarks).join(' · ').trim();
    return {
      recordIds: Array.from(p.recordIds),
      plannedQty: p.plannedQty,
      dailyTargetQty: p.dailyTargetQty,
      sheetRemark: joinedRemark || undefined,
      foFullQtyReleased: p.foFullQtyReleased,
    };
  });

  return {
    entries,
    recordUpdates,
    matchedRows,
    unmatchedCount,
    sampleUnmatched,
    totalQty,
    detectedLayout: usedPgTabLayout ? 'pg_tabs_xlsx' : fallbackLayout,
  };
}

export async function convertMasterPlanXlsxToCsv(buffer: Buffer): Promise<string> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded Excel file is empty.');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('Uploaded Excel file exceeds the 15 MB limit.');
  }
  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
  if (!isZip) {
    throw new Error('Invalid .xlsx file signature.');
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws =
    wb.worksheets.find((sheet) => {
      const upper = sheet.name.toUpperCase();
      return upper.includes('PLAN') || upper.includes('MASTER') || upper.includes('CLUSTER');
    }) ?? wb.worksheets[0];
  if (!ws) {
    throw new Error('The uploaded .xlsx file does not contain any worksheets.');
  }

  const rows = worksheetToStringMatrix(ws, 60);
  return rows
    .map((cells) =>
      cells
        .map((cell) => {
          if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
          }
          return cell;
        })
        .join(',')
    )
    .join('\n');
}

interface FetchedSheetPayload {
  kind: 'xlsx' | 'csv';
  buffer: Buffer;
  text: string;
}

function mergeCookiesFromHeaders(cookieMap: Map<string, string>, headers: Headers): void {
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const rawList = typeof getSetCookie === 'function' ? getSetCookie.call(headers) : [];
  if (rawList.length === 0) {
    const single = headers.get('set-cookie');
    if (single) rawList.push(single);
  }
  for (const cookieStr of rawList) {
    const firstPair = cookieStr.split(';')[0]?.trim();
    if (!firstPair) continue;
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPair.slice(0, eqIdx).trim();
      const val = firstPair.slice(eqIdx + 1).trim();
      cookieMap.set(name, val);
    }
  }
}

function buildCookieHeader(cookieMap: Map<string, string>): string {
  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function fetchSheetPayload(rawUrl: string): Promise<FetchedSheetPayload> {
  let currentUrl = resolveSheetCsvUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const cookieJar = new Map<string, string>();

  try {
    let finalResponse: Response | null = null;
    for (let hop = 0; hop < 10; hop++) {
      await assertSafeExternalUrl(currentUrl);
      const reqHeaders: Record<string, string> = {
        Accept:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,*/*',
        'User-Agent':
          'Mozilla/5.0 (compatible; AlexApparels-Planning-Sync/1.0)',
      };
      if (cookieJar.size > 0) {
        reqHeaders.Cookie = buildCookieHeader(cookieJar);
      }

      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: reqHeaders,
      });

      mergeCookiesFromHeaders(cookieJar, res.headers);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          finalResponse = res;
          break;
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      finalResponse = res;
      break;
    }

    if (!finalResponse) {
      throw new Error('Too many redirects while fetching online sheet.');
    }

    if (!finalResponse.ok) {
      throw new Error(
        `Sheet returned HTTP ${finalResponse.status}. Confirm the SharePoint/Google Sheet link is shared as "Anyone with the link can view", or upload the .xlsx file directly below.`
      );
    }

    const declaredLength = Number(finalResponse.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      throw new Error('Remote sheet file exceeds the 15 MB size limit.');
    }

    const arrayBuf = await finalResponse.arrayBuffer();
    if (arrayBuf.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error('Remote sheet file exceeds the 15 MB size limit.');
    }
    const buffer = Buffer.from(arrayBuf);
    const contentType = (finalResponse.headers.get('content-type') || '').toLowerCase();

    const isZipMagic = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    const isXlsxContentType =
      contentType.includes('spreadsheetml') ||
      contentType.includes('ms-excel') ||
      (contentType.includes('octet-stream') && isZipMagic);

    if (isZipMagic || isXlsxContentType) {
      return {
        kind: 'xlsx',
        buffer,
        text: '',
      };
    }

    const text = buffer.toString('utf8');
    const head = text.trimStart().slice(0, 400).toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
      if (
        text.includes('accounts.google.com') ||
        text.includes('ServiceLogin') ||
        text.includes('login.microsoftonline.com') ||
        text.includes('Sign in')
      ) {
        throw new Error(
          'Online link requires login. Set sharing to "Anyone with the link (Viewer)" or upload the .xlsx file directly below.'
        );
      }
      throw new Error(
        'The URL returned an HTML webpage instead of Excel/CSV data. Paste a SharePoint/Google Sheet link or upload the .xlsx file directly.'
      );
    }

    return {
      kind: 'csv',
      buffer,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runCuttingSheetSync(params: {
  trigger: 'Auto' | 'Manual';
  force?: boolean;
}): Promise<{
  ok: boolean;
  updated: boolean;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  cuttingSheetSync: CuttingSheetSyncConfig;
  message: string;
}> {
  const state = getWorkspaceState();
  const cfg = state.cuttingSheetSync;
  const primaryUrl = (cfg.sheetUrl || '').trim();
  const factoryUrlEntries = ALLOWED_FACTORIES.map((fac) => ({
    factory: fac,
    url: (cfg.factoryUrls?.[fac] || '').trim(),
  })).filter((x) => Boolean(x.url));

  const nowIso = new Date().toISOString();

  if (!primaryUrl && factoryUrlEntries.length === 0) {
    const errMsg = 'No online cutting sheet URL configured yet.';
    const nextState = applySyncedCuttingEntries({
      replaceSheetEntries: false,
      syncPatch: {
        lastCheckedAtIso: nowIso,
        lastStatus: 'Error',
        lastMessage: errMsg,
      },
    });
    return {
      ok: false,
      updated: false,
      records: nextState.records,
      cuttingEntries: nextState.cuttingEntries,
      cuttingSheetSync: nextState.cuttingSheetSync,
      message: errMsg,
    };
  }

  const sources: Array<{
    label: string;
    url: string;
    defaultFactory?: FactoryName;
  }> = [];

  for (const item of factoryUrlEntries) {
    sources.push({
      label: item.factory,
      url: item.url,
      defaultFactory: item.factory,
    });
  }
  if (primaryUrl && !factoryUrlEntries.some((x) => x.url === primaryUrl)) {
    sources.push({
      label: 'Main Sheet',
      url: primaryUrl,
    });
  }

  const fetchedPayloads: Array<{
    label: string;
    url: string;
    defaultFactory?: FactoryName;
    fetched: FetchedSheetPayload;
  }> = [];
  const sourceErrors: string[] = [];
  const factoryStatusesPatch: FactorySyncStatusMap = {};

  for (const src of sources) {
    try {
      const fetched = await fetchSheetPayload(src.url);
      fetchedPayloads.push({ ...src, fetched });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch online sheet.';
      sourceErrors.push(`${src.label}: ${msg}`);
      if (src.defaultFactory) {
        factoryStatusesPatch[src.defaultFactory] = {
          status: 'Error',
          lastSyncedAtIso: nowIso,
          entriesCount: 0,
          totalQty: 0,
          message: msg,
        };
      }
    }
  }

  if (fetchedPayloads.length === 0) {
    const errMsg = sourceErrors.join(' | ') || 'Failed to fetch online cutting sheet.';
    const logEntry: CuttingSheetSyncLog = {
      id: `CSYNC-${Date.now().toString(36).toUpperCase()}`,
      syncedAtIso: nowIso,
      trigger: params.trigger,
      status: 'Error',
      matchedRows: 0,
      unmatchedCount: 0,
      totalQty: 0,
      message: errMsg,
    };
    const nextState = applySyncedCuttingEntries({
      replaceSheetEntries: false,
      syncPatch: {
        lastCheckedAtIso: nowIso,
        lastStatus: 'Error',
        lastMessage: errMsg,
        factoryStatuses: factoryStatusesPatch,
      },
      logEntry,
    });
    return {
      ok: false,
      updated: false,
      records: nextState.records,
      cuttingEntries: nextState.cuttingEntries,
      cuttingSheetSync: nextState.cuttingSheetSync,
      message: errMsg,
    };
  }

  const hashObj = crypto.createHash('sha256').update(`${cfg.syncMode}::`);
  for (const p of fetchedPayloads) {
    hashObj.update(`${p.label}:${p.url}:`);
    hashObj.update(p.fetched.buffer);
    hashObj.update('\n---SHEET---\n');
  }
  const hash = hashObj.digest('hex');

  if (
    !params.force &&
    sourceErrors.length === 0 &&
    hash === cfg.lastContentHash &&
    cfg.lastStatus === 'Success'
  ) {
    const nextState = applySyncedCuttingEntries({
      replaceSheetEntries: false,
      syncPatch: {
        lastCheckedAtIso: nowIso,
        lastStatus: 'Success',
        lastMessage: `Checked at ${nowIso.slice(11, 16)} UTC — All linked sheets up to date (${cfg.lastMatchedCount} PGs, ${cfg.lastTotalQty.toLocaleString()} pcs).`,
      },
    });
    return {
      ok: true,
      updated: false,
      records: nextState.records,
      cuttingEntries: nextState.cuttingEntries,
      cuttingSheetSync: nextState.cuttingSheetSync,
      message: nextState.cuttingSheetSync.lastMessage,
    };
  }

  const mergedByRecordId = new Map<string, DailyCuttingEntry>();
  const mergedUpdatesMap = new Map<
    string,
    {
      recordIds: Set<string>;
      plannedQty: number | null;
      dailyTargetQty: number | null;
      remarks: Set<string>;
      foFullQtyReleased: boolean;
    }
  >();
  const scopedFactories = new Set<FactoryName>();
  let totalMatchedRows = 0;
  let totalUnmatched = 0;
  const allSamples: string[] = [];

  for (const payload of fetchedPayloads) {
    try {
      const parsed =
        payload.fetched.kind === 'xlsx'
          ? await parseOnlineCuttingXlsxBuffer({
              buffer: payload.fetched.buffer,
              records: state.records,
              referenceDateIso: state.referenceDateIso,
              syncMode: cfg.syncMode,
              defaultFactory: payload.defaultFactory ?? null,
              sourceLabel: `${payload.label} ${payload.url}`,
            })
          : parseOnlineCuttingSheetCsv({
              csvText: payload.fetched.text,
              records: state.records,
              referenceDateIso: state.referenceDateIso,
              syncMode: cfg.syncMode,
              defaultFactory: payload.defaultFactory,
            });

      totalMatchedRows += parsed.matchedRows;
      totalUnmatched += parsed.unmatchedCount;
      for (const s of parsed.sampleUnmatched) {
        if (allSamples.length < 6 && !allSamples.includes(s)) {
          allSamples.push(s);
        }
      }

      if (payload.defaultFactory && (parsed.entries.length > 0 || parsed.recordUpdates.length > 0)) {
        scopedFactories.add(payload.defaultFactory);
      }
      for (const upd of parsed.recordUpdates) {
        const key = upd.recordIds[0] || '';
        if (!key) continue;
        const prev = mergedUpdatesMap.get(key);
        if (prev) {
          for (const rid of upd.recordIds) prev.recordIds.add(rid);
          if (upd.plannedQty !== undefined && upd.plannedQty !== null) {
            prev.plannedQty = upd.plannedQty;
          }
          if (upd.dailyTargetQty !== undefined && upd.dailyTargetQty !== null) {
            prev.dailyTargetQty = upd.dailyTargetQty;
          }
          if (upd.sheetRemark) prev.remarks.add(upd.sheetRemark);
          if (upd.foFullQtyReleased) prev.foFullQtyReleased = true;
        } else {
          mergedUpdatesMap.set(key, {
            recordIds: new Set(upd.recordIds),
            plannedQty: upd.plannedQty ?? null,
            dailyTargetQty: upd.dailyTargetQty ?? null,
            remarks: upd.sheetRemark ? new Set([upd.sheetRemark]) : new Set(),
            foFullQtyReleased: Boolean(upd.foFullQtyReleased),
          });
        }
      }
      for (const entry of parsed.entries) {
        scopedFactories.add(entry.factory);
        const existing = mergedByRecordId.get(entry.recordId);
        if (!existing || entry.dateIso > existing.dateIso) {
          mergedByRecordId.set(entry.recordId, { ...entry });
        } else if (entry.dateIso === existing.dateIso) {
          existing.cuttingQty = Math.max(existing.cuttingQty, entry.cuttingQty);
        }
      }

      if (payload.defaultFactory) {
        const facEntries = parsed.entries.filter((e) => e.factory === payload.defaultFactory);
        const facQty = facEntries.reduce((sum, e) => sum + e.cuttingQty, 0);
        const facPgUpdatesCount = parsed.recordUpdates.length;
        factoryStatusesPatch[payload.defaultFactory] = {
          status: facEntries.length > 0 || facPgUpdatesCount > 0 ? 'Success' : 'Error',
          lastSyncedAtIso: nowIso,
          entriesCount: facEntries.length,
          totalQty: facQty,
          message:
            facEntries.length > 0
              ? `Latest PG cut: ${facEntries.length} PGs (${facQty.toLocaleString()} pcs)`
              : facPgUpdatesCount > 0
                ? `Updated Order Qty & Target for ${facPgUpdatesCount} PG(s)`
                : parsed.unmatchedCount > 0
                  ? `0 of ${parsed.unmatchedCount} PG# matched Master Plan`
                  : 'No PG# cutting or order qty found yet',
        };
      } else {
        for (const fac of ALLOWED_FACTORIES) {
          const facEntries = parsed.entries.filter((e) => e.factory === fac);
          if (facEntries.length > 0) {
            const facQty = facEntries.reduce((sum, e) => sum + e.cuttingQty, 0);
            factoryStatusesPatch[fac] = {
              status: 'Success',
              lastSyncedAtIso: nowIso,
              entriesCount: facEntries.length,
              totalQty: facQty,
              message: `Latest PG cut: ${facEntries.length} PGs (${facQty.toLocaleString()} pcs)`,
            };
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse online sheet.';
      sourceErrors.push(`${payload.label}: ${msg}`);
      if (payload.defaultFactory) {
        factoryStatusesPatch[payload.defaultFactory] = {
          status: 'Error',
          lastSyncedAtIso: nowIso,
          entriesCount: 0,
          totalQty: 0,
          message: msg,
        };
      }
    }
  }

  const syncedEntries = Array.from(mergedByRecordId.values()).sort((a, b) =>
    b.dateIso.localeCompare(a.dateIso)
  );
  const recordUpdates: RecordSheetPatch[] = Array.from(mergedUpdatesMap.values()).map((u) => {
    const joinedRemark = Array.from(u.remarks).join(' · ').trim();
    return {
      recordIds: Array.from(u.recordIds),
      plannedQty: u.plannedQty,
      dailyTargetQty: u.dailyTargetQty,
      sheetRemark: joinedRemark || undefined,
      foFullQtyReleased: u.foFullQtyReleased,
    };
  });
  const releasedUpdatesCount = recordUpdates.filter((u) => u.foFullQtyReleased).length;
  const batchQty = syncedEntries.reduce((sum, e) => sum + e.cuttingQty, 0);
  const canReplaceEntries = syncedEntries.length > 0 && scopedFactories.size > 0;
  const hasAnyUpdate = canReplaceEntries || recordUpdates.length > 0;

  let summaryMsg = '';
  if (syncedEntries.length > 0 || recordUpdates.length > 0) {
    summaryMsg = `Synced ${syncedEntries.length} PG latest cutting totals (${batchQty.toLocaleString()} pcs) & updated ${recordUpdates.length} PG Order Qty / Remarks (${releasedUpdatesCount} Full Qty Released) across ${Array.from(scopedFactories).join(', ')}.${
      totalUnmatched > 0 ? ` ${totalUnmatched} PG#/tab(s) not in Master Plan.` : ''
    }`;
  } else if (totalUnmatched > 0) {
    summaryMsg = `Connected to sheet, but 0 of ${totalUnmatched} PG# rows matched Master Plan (${allSamples.slice(0, 3).join(', ')}).`;
  } else {
    summaryMsg = 'Connected to sheet, but no PG# order qty or cutting rows were found yet.';
  }
  if (sourceErrors.length > 0) {
    summaryMsg += ` Errors: ${sourceErrors.join(' | ')}`;
  }

  const overallOk = hasAnyUpdate || sourceErrors.length === 0;
  const logEntry: CuttingSheetSyncLog = {
    id: `CSYNC-${Date.now().toString(36).toUpperCase()}`,
    syncedAtIso: nowIso,
    trigger: params.trigger,
    status:
      sourceErrors.length > 0 && !hasAnyUpdate
        ? 'Error'
        : hash === cfg.lastContentHash
          ? 'Up to Date'
          : 'Updated',
    matchedRows: totalMatchedRows,
    unmatchedCount: totalUnmatched,
    totalQty: batchQty,
    message: summaryMsg,
    sampleUnmatched: allSamples.length > 0 ? allSamples : undefined,
  };

  const nextState = applySyncedCuttingEntries({
    syncedEntries: canReplaceEntries ? syncedEntries : undefined,
    replaceSheetEntries: canReplaceEntries,
    scopedFactories: Array.from(scopedFactories),
    recordUpdates,
    syncPatch: {
      lastCheckedAtIso: nowIso,
      lastUpdatedAtIso: hasAnyUpdate ? nowIso : cfg.lastUpdatedAtIso,
      lastStatus: sourceErrors.length > 0 ? 'Error' : 'Success',
      lastMessage: summaryMsg,
      lastContentHash: sourceErrors.length === 0 ? hash : cfg.lastContentHash,
      lastUnmatchedCount: totalUnmatched,
      factoryStatuses: factoryStatusesPatch,
    },
    logEntry,
  });

  return {
    ok: overallOk,
    updated: hasAnyUpdate,
    records: nextState.records,
    cuttingEntries: nextState.cuttingEntries,
    cuttingSheetSync: nextState.cuttingSheetSync,
    message: summaryMsg,
  };
}

export async function importCuttingFileBuffer(params: {
  fileName: string;
  buffer?: Buffer;
  csvText?: string;
  defaultFactory?: FactoryName | null;
}): Promise<{
  ok: boolean;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  cuttingSheetSync: CuttingSheetSyncConfig;
  message: string;
}> {
  const state = getWorkspaceState();
  const cfg = state.cuttingSheetSync;
  const nowIso = new Date().toISOString();

  try {
    if (params.buffer && params.buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('Uploaded file exceeds the 15 MB size limit.');
    }
    if (params.csvText && Buffer.byteLength(params.csvText, 'utf8') > MAX_UPLOAD_BYTES) {
      throw new Error('Uploaded CSV file exceeds the 15 MB size limit.');
    }
    const isXlsx =
      params.fileName.toLowerCase().endsWith('.xlsx') ||
      (params.buffer &&
        params.buffer.length >= 2 &&
        params.buffer[0] === 0x50 &&
        params.buffer[1] === 0x4b);

    const parsed = isXlsx
      ? await parseOnlineCuttingXlsxBuffer({
          buffer: params.buffer!,
          records: state.records,
          referenceDateIso: state.referenceDateIso,
          syncMode: cfg.syncMode,
          defaultFactory: params.defaultFactory ?? null,
          sourceLabel: params.fileName,
        })
      : parseOnlineCuttingSheetCsv({
          csvText: params.csvText ?? params.buffer?.toString('utf8') ?? '',
          records: state.records,
          referenceDateIso: state.referenceDateIso,
          syncMode: cfg.syncMode,
          defaultFactory: params.defaultFactory ?? undefined,
        });

    const batchQty = parsed.entries.reduce((sum, e) => sum + e.cuttingQty, 0);
    const scopedFactories = new Set<FactoryName>();
    for (const entry of parsed.entries) {
      scopedFactories.add(entry.factory);
    }
    if (params.defaultFactory) {
      scopedFactories.add(params.defaultFactory);
    } else if (parsed.recordUpdates.length > 0) {
      for (const upd of parsed.recordUpdates) {
        for (const rid of upd.recordIds) {
          const rec = state.records.find((r) => r.id === rid);
          if (rec) scopedFactories.add(rec.factory);
        }
      }
    }

    const factoryStatusesPatch: FactorySyncStatusMap = {};
    for (const fac of scopedFactories) {
      const facEntries = parsed.entries.filter((e) => e.factory === fac);
      const facQty = facEntries.reduce((sum, e) => sum + e.cuttingQty, 0);
      factoryStatusesPatch[fac] = {
        status: facEntries.length > 0 || parsed.recordUpdates.length > 0 ? 'Success' : 'Error',
        lastSyncedAtIso: nowIso,
        entriesCount: facEntries.length,
        totalQty: facQty,
        message:
          facEntries.length > 0
            ? `Uploaded ${facEntries.length} PGs (${facQty.toLocaleString()} pcs)`
            : parsed.recordUpdates.length > 0
              ? `Updated Order Qty & Daily Target for ${parsed.recordUpdates.length} PG(s)`
              : '0 matching entries found in uploaded file',
      };
    }

    const canReplaceEntries = parsed.entries.length > 0 && scopedFactories.size > 0;
    const hasAnyUpdate = canReplaceEntries || parsed.recordUpdates.length > 0;
    const factoryLabel =
      scopedFactories.size > 0 ? Array.from(scopedFactories).join(', ') : 'Master Plan';

    const orderQtyUpdatedCount = parsed.recordUpdates.filter(
      (u) => u.plannedQty !== undefined && u.plannedQty !== null
    ).length;
    const targetUpdatedCount = parsed.recordUpdates.filter(
      (u) => u.dailyTargetQty !== undefined && u.dailyTargetQty !== null
    ).length;
    const releasedUpdatedCount = parsed.recordUpdates.filter(
      (u) => u.foFullQtyReleased
    ).length;

    const summaryMsg = hasAnyUpdate
      ? `Uploaded "${params.fileName}" for ${factoryLabel}: latest cutting totals for ${parsed.entries.length} PG(s) (${batchQty.toLocaleString()} pcs), filled Order Qty (${orderQtyUpdatedCount} PGs), Daily Target (${targetUpdatedCount} PGs)${releasedUpdatedCount > 0 ? `, Full Qty Released (${releasedUpdatedCount} PGs)` : ''}. Other factories preserved.${
          parsed.unmatchedCount > 0 ? ` ${parsed.unmatchedCount} PG#/tab(s) not in Master Plan.` : ''
        }`
      : parsed.unmatchedCount > 0
        ? `Uploaded "${params.fileName}", but 0 of ${parsed.unmatchedCount} PG# items matched current Master Plan (${parsed.sampleUnmatched.slice(0, 3).join(', ')}). Existing data kept unchanged.`
        : `Uploaded "${params.fileName}", but no PG# order qty or cutting rows were found. Existing data kept unchanged.`;

    const logEntry: CuttingSheetSyncLog = {
      id: `CUPL-${Date.now().toString(36).toUpperCase()}`,
      syncedAtIso: nowIso,
      trigger: 'Upload',
      status: hasAnyUpdate ? 'Updated' : 'Error',
      matchedRows: parsed.matchedRows,
      unmatchedCount: parsed.unmatchedCount,
      totalQty: batchQty,
      message: summaryMsg,
      sampleUnmatched: parsed.sampleUnmatched.length > 0 ? parsed.sampleUnmatched : undefined,
    };

    const nextState = applySyncedCuttingEntries({
      syncedEntries: canReplaceEntries ? parsed.entries : undefined,
      replaceSheetEntries: canReplaceEntries,
      scopedFactories: Array.from(scopedFactories),
      recordUpdates: parsed.recordUpdates,
      syncPatch: {
        lastCheckedAtIso: nowIso,
        lastUpdatedAtIso: hasAnyUpdate ? nowIso : cfg.lastUpdatedAtIso,
        lastStatus: hasAnyUpdate ? 'Success' : 'Error',
        lastMessage: summaryMsg,
        lastUnmatchedCount: parsed.unmatchedCount,
        factoryStatuses: factoryStatusesPatch,
      },
      logEntry,
    });

    return {
      ok: hasAnyUpdate,
      records: nextState.records,
      cuttingEntries: nextState.cuttingEntries,
      cuttingSheetSync: nextState.cuttingSheetSync,
      message: summaryMsg,
    };
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : `Failed to parse uploaded file "${params.fileName}".`;
    const logEntry: CuttingSheetSyncLog = {
      id: `CUPL-${Date.now().toString(36).toUpperCase()}`,
      syncedAtIso: nowIso,
      trigger: 'Upload',
      status: 'Error',
      matchedRows: 0,
      unmatchedCount: 0,
      totalQty: 0,
      message: errMsg,
    };
    const nextState = applySyncedCuttingEntries({
      replaceSheetEntries: false,
      syncPatch: {
        lastCheckedAtIso: nowIso,
        lastStatus: 'Error',
        lastMessage: errMsg,
      },
      logEntry,
    });
    return {
      ok: false,
      records: nextState.records,
      cuttingEntries: nextState.cuttingEntries,
      cuttingSheetSync: nextState.cuttingSheetSync,
      message: errMsg,
    };
  }
}
