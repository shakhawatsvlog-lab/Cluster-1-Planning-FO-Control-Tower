import * as XLSX from 'xlsx';
import type {
  FactoryPoRow,
  FactorySheetTab,
  FactorySummaryMetric,
  FactoryWorkbookFile,
  MatchedPoResult,
  SourcePoRecord,
} from './poMatcherTypes.ts';

const BLOCKED_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function normalizePgKey(raw: string): string {
  const clean = (raw || '').trim().toUpperCase();
  if (!clean) return '';
  const withoutPrefix = clean.replace(/^PG\s*[#:\-_]?\s*/i, '').trim();
  const digitsOnly = withoutPrefix.replace(/[^A-Z0-9]/g, '');
  if (/^\d+$/.test(digitsOnly)) {
    return digitsOnly.replace(/^0+/, '') || '0';
  }
  return digitsOnly || withoutPrefix;
}

export function extractPgFromSheetName(sheetName: string): string {
  const trimmed = (sheetName || '').trim();
  if (!trimmed) return '';
  const pgMatch = trimmed.match(/PG\s*[#:\-_]?\s*([A-Z0-9-]+)/i);
  if (pgMatch?.[1]) {
    return `PG#${pgMatch[1].trim()}`;
  }
  if (/^\d{4,7}$/.test(trimmed)) {
    return `PG#${trimmed}`;
  }
  return '';
}

export function normalizePoExact(raw: string): string {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^PO\s*[#:\-_]?\s*/i, '');
}

export function normalizePoNumeric(raw: string): string {
  const exact = normalizePoExact(raw);
  if (!exact) return '';
  if (/^\d+$/.test(exact)) {
    return exact.replace(/^0+/, '') || '0';
  }
  return exact;
}

export function inferFactoryNameFromFileName(fileName: string): string {
  const withoutExt = fileName.replace(/\.[a-z0-9]+$/i, '').trim();
  const upper = withoutExt.toUpperCase();

  const alexMatch = upper.match(/ALEX[\s_\-]*(\d{1,2})/);
  if (alexMatch?.[1]) {
    return `ALEX ${alexMatch[1]}`;
  }

  const cleaned = withoutExt
    .replace(/[_\-]+/g, ' ')
    .replace(/\b(master|plan|allocation|po|pg|sheet|data|schedule|export|list|factory)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned) return cleaned;
  return withoutExt.replace(/[_\-]+/g, ' ').trim() || 'Factory File';
}

function formatCellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dd = String(cell.getUTCDate()).padStart(2, '0');
    const mmm = months[cell.getUTCMonth()] || 'Jan';
    const yy = String(cell.getUTCFullYear()).slice(-2);
    return `${dd}-${mmm}-${yy}`;
  }
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return '';
    return String(cell);
  }
  return String(cell).replace(/\r?\n/g, ' ').trim();
}

function parseNumericQty(raw: string): number {
  const clean = (raw || '').replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!clean) return 0;
  const num = Number(clean);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

interface DetectedColumnIndices {
  headerRowIndex: number;
  pgCol: number;
  poCol: number;
  colorCol: number;
  qtyCol: number;
  finalInspCol: number;
}

function scoreHeaderToken(headerText: string): {
  isPg: boolean;
  isPo: boolean;
  isColor: boolean;
  isQty: boolean;
  isFinalInsp: boolean;
} {
  const h = headerText
    .toLowerCase()
    .replace(/[^a-z0-9.#/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!h || BLOCKED_PROTO_KEYS.has(h)) {
    return { isPg: false, isPo: false, isColor: false, isQty: false, isFinalInsp: false };
  }

  const isPg =
    h === 'pg' ||
    h === 'pg#' ||
    h === 'pg no' ||
    h === 'pg number' ||
    h === 'program' ||
    h === 'program no' ||
    /\bpg\b/.test(h);

  const isPo =
    h === 'po' ||
    h === 'po#' ||
    h === 'po no' ||
    h === 'po number' ||
    h === 'order no' ||
    h === 'buyer po' ||
    h === 'purchase order' ||
    /\bpo\s*(no|number|#)?\b/.test(h);

  const isColor =
    h === 'color' ||
    h === 'colour' ||
    h === 'color name' ||
    h === 'colour name' ||
    h === 'shade' ||
    /\bcolou?r\b/.test(h);

  const isQty =
    h === 'qty' ||
    h === 'quantity' ||
    h === 'order qty' ||
    h === 'total qty' ||
    h === 'po qty' ||
    h === 'pcs' ||
    /\b(order|total|po|alloc|allocation)?\s*qty\b/.test(h) ||
    /\bquantity\b/.test(h);

  const isFinalInsp =
    h.includes('final insp') ||
    h.includes('final inspection') ||
    h.includes('loading date') ||
    h.includes('ex-factory') ||
    h.includes('ex factory') ||
    h.includes('insp date') ||
    h.includes('inspection date') ||
    h.includes('ship date') ||
    h.includes('handover');

  return { isPg, isPo, isColor, isQty, isFinalInsp };
}

function detectColumnsInRows(rows: string[][]): DetectedColumnIndices {
  let bestScore = -1;
  let best: DetectedColumnIndices = {
    headerRowIndex: 0,
    pgCol: -1,
    poCol: -1,
    colorCol: -1,
    qtyCol: -1,
    finalInspCol: -1,
  };

  const scanLimit = Math.min(rows.length, 20);
  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r] || [];
    let pgCol = -1;
    let poCol = -1;
    let colorCol = -1;
    let qtyCol = -1;
    let finalInspCol = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = row[c] || '';
      if (!cell) continue;
      const flags = scoreHeaderToken(cell);
      if (flags.isPg && pgCol === -1) pgCol = c;
      if (flags.isPo && poCol === -1) poCol = c;
      if (flags.isColor && colorCol === -1) colorCol = c;
      if (flags.isQty && qtyCol === -1) qtyCol = c;
      if (flags.isFinalInsp && finalInspCol === -1) finalInspCol = c;
    }

    const score =
      (poCol >= 0 ? 4 : 0) +
      (qtyCol >= 0 ? 2 : 0) +
      (colorCol >= 0 ? 2 : 0) +
      (finalInspCol >= 0 ? 2 : 0) +
      (pgCol >= 0 ? 1 : 0);

    if (score > bestScore && score >= 4) {
      bestScore = score;
      best = { headerRowIndex: r, pgCol, poCol, colorCol, qtyCol, finalInspCol };
    }
  }

  return best;
}

function isSummaryOrTotalRow(row: string[]): boolean {
  const joined = row.join(' ').trim().toUpperCase();
  if (!joined) return true;
  return /^(GRAND\s+)?(TOTAL|SUB\s*TOTAL|SUMMARY)\b/.test(joined) || /\bGRAND TOTAL\b/.test(joined);
}

function readWorkbookSafely(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    bookVBA: false,
    cellDates: true,
    raw: false,
  });
}

function worksheetToRawGrid(sheet: XLSX.WorkSheet): string[][] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  });

  // Also propagate horizontal/vertical merged cell top-left display values onto a copy for accurate PO/Final insp. reading
  const merges = Array.isArray(sheet['!merges']) ? sheet['!merges'] : [];
  const rows: string[][] = matrix.map((r) =>
    Array.isArray(r) ? r.map((cell) => formatCellValue(cell)) : []
  );

  if (merges.length > 0 && rows.length > 0) {
    // Convert sheet ref range if needed so row indices align with dense matrix
    const rangeRef = sheet['!ref'];
    if (rangeRef) {
      const decoded = XLSX.utils.decode_range(rangeRef);
      const dense: string[][] = [];
      for (let r = decoded.s.r; r <= decoded.e.r; r++) {
        const line: string[] = [];
        let hasAny = false;
        for (let c = decoded.s.c; c <= decoded.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cellObj = sheet[addr] as XLSX.CellObject | undefined;
          const text = cellObj
            ? formatCellValue(cellObj.w ?? cellObj.v ?? '')
            : '';
          if (text) hasAny = true;
          line.push(text);
        }
        dense.push(hasAny ? line : line);
      }

      for (const m of merges) {
        const topLeft = dense[m.s.r - decoded.s.r]?.[m.s.c - decoded.s.c] || '';
        if (!topLeft) continue;
        for (let r = m.s.r; r <= m.e.r; r++) {
          for (let c = m.s.c; c <= m.e.c; c++) {
            const rr = r - decoded.s.r;
            const cc = c - decoded.s.c;
            if (dense[rr] && !dense[rr][cc]) {
              dense[rr][cc] = topLeft;
            }
          }
        }
      }

      // Drop completely empty trailing/leading rows cleanly
      return dense.filter((line) => line.some((c) => c.trim().length > 0));
    }
  }

  return rows;
}

export function parseFactoryWorkbookBuffer(params: {
  fileId: string;
  fileName: string;
  buffer: ArrayBuffer;
  overrideFactoryName?: string;
}): FactoryWorkbookFile {
  const wb = readWorkbookSafely(params.buffer);
  const factoryName = params.overrideFactoryName?.trim() || inferFactoryNameFromFileName(params.fileName);

  const sheets: FactorySheetTab[] = [];
  let totalRows = 0;
  let totalQty = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rawRows = worksheetToRawGrid(ws);
    if (rawRows.length === 0) continue;

    const detected = detectColumnsInRows(rawRows);
    const headers = rawRows[detected.headerRowIndex] || [];
    const tabPgFallback = extractPgFromSheetName(sheetName);
    const parsedRows: FactoryPoRow[] = [];

    if (detected.poCol >= 0) {
      let lastPg = tabPgFallback;
      let lastPo = '';
      let lastFinalInsp = '';

      for (let r = detected.headerRowIndex + 1; r < rawRows.length; r++) {
        const row = rawRows[r] || [];
        if (isSummaryOrTotalRow(row)) {
          lastPo = '';
          lastFinalInsp = '';
          continue;
        }

        const cellPg = detected.pgCol >= 0 ? (row[detected.pgCol] || '').trim() : '';
        const cellPo = (row[detected.poCol] || '').trim();
        const cellColor = detected.colorCol >= 0 ? (row[detected.colorCol] || '').trim() : '';
        const cellQtyRaw = detected.qtyCol >= 0 ? (row[detected.qtyCol] || '').trim() : '';
        const cellInsp = detected.finalInspCol >= 0 ? (row[detected.finalInspCol] || '').trim() : '';
        const qty = parseNumericQty(cellQtyRaw);

        // New PO starts a fresh group (reset carried Final insp. unless specified on this row)
        if (cellPo) {
          lastPo = cellPo;
          lastFinalInsp = cellInsp || lastFinalInsp;
          if (cellPg) lastPg = cellPg;
        } else if (cellColor || qty > 0) {
          // Multi-color continuation row beneath a merged or blank PO cell
          if (cellPg) lastPg = cellPg;
          if (cellInsp) lastFinalInsp = cellInsp;
        } else {
          continue;
        }

        if (!lastPo) continue;

        const resolvedPg = cellPg || lastPg || tabPgFallback || '';
        const resolvedInsp = cellInsp || lastFinalInsp || '';

        const entry: FactoryPoRow = {
          id: `${params.fileId}::${sheetName}::${r}`,
          fileId: params.fileId,
          fileName: params.fileName,
          factoryName,
          sheetName,
          rawRowIndex: r,
          pgNumber: resolvedPg,
          poNumber: lastPo,
          color: cellColor,
          qty,
          finalInsp: resolvedInsp,
        };
        parsedRows.push(entry);
        totalRows += 1;
        totalQty += qty;
      }
    }

    sheets.push({
      sheetName,
      pgNormalized: normalizePgKey(tabPgFallback || sheetName),
      headers,
      rawRows,
      parsedRows,
    });
  }

  return {
    id: params.fileId,
    fileName: params.fileName,
    factoryName,
    sheets,
    totalRows,
    totalQty,
  };
}

export function parseSourceWorkbookBuffer(params: {
  fileName: string;
  buffer: ArrayBuffer;
}): SourcePoRecord[] {
  const wb = readWorkbookSafely(params.buffer);
  const extracted: SourcePoRecord[] = [];
  let seq = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rawRows = worksheetToRawGrid(ws);
    if (rawRows.length === 0) continue;

    const detected = detectColumnsInRows(rawRows);
    const tabPgFallback = extractPgFromSheetName(sheetName);
    const poCol = detected.poCol >= 0 ? detected.poCol : 0;

    let lastPg = tabPgFallback;
    let lastPo = '';

    const startRow = detected.poCol >= 0 ? detected.headerRowIndex + 1 : 0;
    for (let r = startRow; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      if (isSummaryOrTotalRow(row)) {
        lastPo = '';
        continue;
      }

      const cellPg = detected.pgCol >= 0 ? (row[detected.pgCol] || '').trim() : '';
      const cellPo = (row[poCol] || '').trim();
      const cellColor = detected.colorCol >= 0 ? (row[detected.colorCol] || '').trim() : '';
      const cellQty = detected.qtyCol >= 0 ? parseNumericQty(row[detected.qtyCol] || '') : 0;

      // Skip accidental header text when no header was detected
      if (!detected.poCol && /^(po|po#|po no|order no|pg|pg#)$/i.test(cellPo)) {
        continue;
      }

      if (cellPo) {
        lastPo = cellPo;
        if (cellPg) lastPg = cellPg;
      } else if (cellColor || cellQty > 0) {
        if (cellPg) lastPg = cellPg;
      } else {
        continue;
      }

      if (!lastPo) continue;
      seq += 1;
      extracted.push({
        id: `SRC-XLS-${Date.now()}-${seq}`,
        pgNumber: cellPg || lastPg || tabPgFallback || '',
        poNumber: lastPo,
        color: cellColor,
        qty: cellQty,
        sourceLabel: `${params.fileName} (${sheetName})`,
        sourceType: 'excel',
      });
    }
  }

  return extracted;
}

interface GroupedFactoryOccurrence {
  fileId: string;
  fileName: string;
  factoryName: string;
  sheetName: string;
  pgNumber: string;
  poNumber: string;
  color: string;
  qty: number;
  finalInsp: string;
  rawRowIndex: number;
  matchedRowIndices: number[];
}

function buildOccurrenceGroups(rows: FactoryPoRow[], sourceColor: string): GroupedFactoryOccurrence[] {
  const cleanSourceColor = sourceColor.trim().toUpperCase();

  // Group rows by factoryFile + sheet + exact/normalized PO so multi-color rows in the same factory sheet
  // roll up cleanly unless the source record asks for a specific color.
  const byBucket = new Map<string, FactoryPoRow[]>();
  for (const r of rows) {
    const bucketKey = `${r.fileId}::${r.sheetName}::${normalizePoNumeric(r.poNumber)}`;
    const list = byBucket.get(bucketKey);
    if (list) {
      list.push(r);
    } else {
      byBucket.set(bucketKey, [r]);
    }
  }

  const groups: GroupedFactoryOccurrence[] = [];
  for (const bucketRows of byBucket.values()) {
    let chosen = bucketRows;
    if (cleanSourceColor) {
      const colorFiltered = bucketRows.filter((r) => {
        const rc = r.color.trim().toUpperCase();
        return rc && (rc === cleanSourceColor || rc.includes(cleanSourceColor) || cleanSourceColor.includes(rc));
      });
      if (colorFiltered.length > 0) {
        chosen = colorFiltered;
      }
    }

    const first = chosen[0];
    const uniqueColors = Array.from(
      new Set(chosen.map((r) => r.color.trim()).filter(Boolean))
    );
    const totalQty = chosen.reduce((sum, r) => sum + (r.qty || 0), 0);
    const inspDates = Array.from(
      new Set(chosen.map((r) => r.finalInsp.trim()).filter(Boolean))
    );

    groups.push({
      fileId: first.fileId,
      fileName: first.fileName,
      factoryName: first.factoryName,
      sheetName: first.sheetName,
      pgNumber: first.pgNumber,
      poNumber: first.poNumber,
      color: uniqueColors.join(', '),
      qty: totalQty,
      finalInsp: inspDates.join(' / '),
      rawRowIndex: first.rawRowIndex,
      matchedRowIndices: chosen.map((r) => r.rawRowIndex),
    });
  }

  return groups;
}

export function runPoAllocationMatching(
  sourceRecords: SourcePoRecord[],
  workbooks: FactoryWorkbookFile[]
): MatchedPoResult[] {
  const allFactoryRows: FactoryPoRow[] = [];
  for (const wb of workbooks) {
    for (const sheet of wb.sheets) {
      allFactoryRows.push(...sheet.parsedRows);
    }
  }

  const results: MatchedPoResult[] = [];

  for (const src of sourceRecords) {
    const srcPoExact = normalizePoExact(src.poNumber);
    const srcPoNum = normalizePoNumeric(src.poNumber);
    const srcPgKey = normalizePgKey(src.pgNumber);

    if (!srcPoExact && !srcPoNum) {
      results.push({
        id: `RES-${src.id}-NF`,
        sourceId: src.id,
        sourcePg: src.pgNumber,
        sourcePo: src.poNumber,
        sourceColor: src.color,
        sourceQty: src.qty,
        sourceLabel: src.sourceLabel,
        matchType: 'not_found',
        factoryName: '—',
        sheetName: '—',
        matchedRowIndices: [],
        factoryPg: '—',
        factoryPo: '—',
        factoryColor: '—',
        factoryQty: null,
        qtyDiff: null,
        finalInsp: '—',
        splitGroupCount: 0,
        splitOccurrenceIndex: 0,
        distinctFactoryCount: 0,
      });
      continue;
    }

    // Match all factory rows sharing exact PO or leading-zero-normalized PO
    const poCandidateRows = allFactoryRows.filter((row) => {
      const fExact = normalizePoExact(row.poNumber);
      const fNum = normalizePoNumeric(row.poNumber);
      return (srcPoExact && fExact === srcPoExact) || (srcPoNum && fNum === srcPoNum);
    });

    if (poCandidateRows.length === 0) {
      results.push({
        id: `RES-${src.id}-NF`,
        sourceId: src.id,
        sourcePg: src.pgNumber,
        sourcePo: src.poNumber,
        sourceColor: src.color,
        sourceQty: src.qty,
        sourceLabel: src.sourceLabel,
        matchType: 'not_found',
        factoryName: '—',
        sheetName: '—',
        matchedRowIndices: [],
        factoryPg: '—',
        factoryPo: '—',
        factoryColor: '—',
        factoryQty: null,
        qtyDiff: null,
        finalInsp: '—',
        splitGroupCount: 0,
        splitOccurrenceIndex: 0,
        distinctFactoryCount: 0,
      });
      continue;
    }

    const pgMatchedRows = srcPgKey
      ? poCandidateRows.filter((row) => {
          const fPgKey = normalizePgKey(row.pgNumber);
          return Boolean(fPgKey && fPgKey === srcPgKey);
        })
      : [];

    const useExactPg = pgMatchedRows.length > 0;
    const chosenRows = useExactPg ? pgMatchedRows : poCandidateRows;
    const matchType: MatchedPoResult['matchType'] = useExactPg ? 'exact_pg_po' : 'po_diff_pg';

    const occurrences = buildOccurrenceGroups(chosenRows, src.color);
    const distinctFactoryCount = new Set(
      occurrences.map((o) => o.factoryName.trim().toUpperCase())
    ).size;

    occurrences.forEach((occ, idx) => {
      const qtyDiff = src.qty > 0 ? occ.qty - src.qty : null;
      results.push({
        id: `RES-${src.id}-${occ.fileId}-${occ.sheetName}-${idx}`,
        sourceId: src.id,
        sourcePg: src.pgNumber,
        sourcePo: src.poNumber,
        sourceColor: src.color,
        sourceQty: src.qty,
        sourceLabel: src.sourceLabel,
        matchType,
        factoryFileId: occ.fileId,
        factoryFileName: occ.fileName,
        factoryName: occ.factoryName,
        sheetName: occ.sheetName,
        rawRowIndex: occ.rawRowIndex,
        matchedRowIndices: occ.matchedRowIndices,
        factoryPg: occ.pgNumber || '—',
        factoryPo: occ.poNumber,
        factoryColor: occ.color || '—',
        factoryQty: occ.qty,
        qtyDiff,
        finalInsp: occ.finalInsp || '—',
        splitGroupCount: occurrences.length,
        splitOccurrenceIndex: idx + 1,
        distinctFactoryCount,
      });
    });
  }

  return results;
}

export function buildFactorySummaries(results: MatchedPoResult[]): FactorySummaryMetric[] {
  const byFactory = new Map<
    string,
    { pos: Set<string>; lines: number; totalQty: number; dates: string[] }
  >();

  for (const r of results) {
    if (r.matchType === 'not_found') continue;
    const key = r.factoryName;
    const entry = byFactory.get(key) || {
      pos: new Set<string>(),
      lines: 0,
      totalQty: 0,
      dates: [],
    };
    entry.lines += 1;
    entry.pos.add(normalizePoNumeric(r.factoryPo || r.sourcePo));
    entry.totalQty += r.factoryQty || 0;
    if (r.finalInsp && r.finalInsp !== '—') {
      entry.dates.push(r.finalInsp);
    }
    byFactory.set(key, entry);
  }

  return Array.from(byFactory.entries()).map(([factoryName, stats]) => ({
    factoryName,
    matchedLines: stats.lines,
    uniquePos: stats.pos.size,
    totalFactoryQty: stats.totalQty,
    earliestFinalInsp: stats.dates[0] || '—',
  }));
}

export function exportMatchedResultsWorkbook(
  results: MatchedPoResult[],
  summaries: FactorySummaryMetric[]
): void {
  const wb = XLSX.utils.book_new();

  const detailRows = results.map((r, idx) => ({
    SL: idx + 1,
    Factory: r.factoryName,
    'Split PO Info':
      r.splitGroupCount > 1
        ? `Split (${r.splitOccurrenceIndex} of ${r.splitGroupCount}${r.distinctFactoryCount > 1 ? ` · ${r.distinctFactoryCount} Factories` : ''})`
        : 'Single Allocation',
    'Source PG#': r.sourcePg || '—',
    'Factory PG#': r.factoryPg || '—',
    'PO Number': r.factoryPo !== '—' ? r.factoryPo : r.sourcePo,
    'Final Insp. / Loading Date': r.finalInsp || '—',
    Color: r.factoryColor !== '—' ? r.factoryColor : r.sourceColor || '—',
    'Source Qty': r.sourceQty || 0,
    'Factory Qty': r.factoryQty ?? 0,
    'Qty Diff': r.qtyDiff ?? '',
    'Sheet Tab': r.sheetName,
    'Data File': r.factoryFileName || '—',
    'Match Status':
      r.matchType === 'exact_pg_po'
        ? 'Matched (PG# + PO)'
        : r.matchType === 'po_diff_pg'
          ? 'PO Match (Diff PG#)'
          : 'Not Found',
  }));

  const summaryRows = summaries.map((s) => ({
    Factory: s.factoryName,
    'Matched Allocations': s.matchedLines,
    'Unique POs': s.uniquePos,
    'Total Factory Qty (Pcs)': s.totalFactoryQty,
    'Sample / First Final Insp.': s.earliestFinalInsp,
  }));

  const detailWs = XLSX.utils.json_to_sheet(
    detailRows.length > 0
      ? detailRows
      : [{ Info: 'No matching results available to export.' }]
  );
  detailWs['!cols'] = [
    { wch: 5 },
    { wch: 14 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 22 },
    { wch: 20 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 16 },
    { wch: 26 },
    { wch: 20 },
  ];

  const summaryWs = XLSX.utils.json_to_sheet(
    summaryRows.length > 0
      ? summaryRows
      : [{ Info: 'No matched factories yet.' }]
  );
  summaryWs['!cols'] = [
    { wch: 16 },
    { wch: 20 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
  ];

  XLSX.utils.book_append_sheet(wb, detailWs, 'Factory PO Results');
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Factory Summary');

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Alex_PO_PG_Matcher_Results_${today}.xlsx`);
}

function createSampleWorkbookArrayBuffer(
  sheets: Array<{ name: string; rows: Array<Array<string | number>> }>
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return out;
}

function generateSampleSlipJpgDataUrl(): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 760;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('BUYER PO ALLOCATION SLIP — CLUSTER 1 VERIFICATION', 28, 42);

  ctx.fillStyle = '#475569';
  ctx.font = '13px monospace';
  ctx.fillText('Ref: Sample Buyer Allocation Photo (Generated Demo Slip)', 28, 66);

  // Table header
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(28, 86, 704, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px monospace';
  ctx.fillText('PG#', 42, 108);
  ctx.fillText('PO NUMBER', 165, 108);
  ctx.fillText('COLOR', 370, 108);
  ctx.fillText('ORDER QTY', 585, 108);

  const sampleLines = [
    ['PG#36280', '0021548218', 'JET BLACK', '1,200'],
    ['PG#36280', '0021549910', 'NAVY BLAZER', '2,400'],
    ['PG#36292', '0021550120', 'HEATHER GREY', '950'],
    ['PG#36304', '0021550455', 'OLIVE NIGHT', '1,650'],
    ['PG#36399', '0021559999', 'CHARCOAL', '600'],
  ];

  sampleLines.forEach((line, idx) => {
    const y = 148 + idx * 46;
    ctx.fillStyle = idx % 2 === 0 ? '#f8fafc' : '#ffffff';
    ctx.fillRect(28, y - 24, 704, 42);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(28, y - 24, 704, 42);

    ctx.fillStyle = '#0f172a';
    ctx.font = '15px monospace';
    ctx.fillText(line[0], 42, y + 3);
    ctx.fillText(line[1], 165, y + 3);
    ctx.fillText(line[2], 370, y + 3);
    ctx.fillText(line[3], 600, y + 3);
  });

  return canvas.toDataURL('image/jpeg', 0.9);
}

export function createSampleMatcherBundle(): {
  workbooks: FactoryWorkbookFile[];
  sampleImageUrl: string;
  sourceRecords: SourcePoRecord[];
} {
  const alex1Buf = createSampleWorkbookArrayBuffer([
    {
      name: 'PG#36280',
      rows: [
        ['PG#', 'PO No', 'Color', 'Order Qty', 'Final insp.'],
        ['PG#36280', '0021548218', 'JET BLACK', 700, '04-Dec-26'],
        ['', '', 'JET BLACK (B)', 500, ''],
        ['PG#36280', '0021549910', 'NAVY BLAZER', 1400, '07-Dec-26'],
      ],
    },
    {
      name: 'PG#36285',
      rows: [
        ['PG#', 'PO No', 'Color', 'Order Qty', 'Final insp.'],
        ['PG#36285', '0021548601', 'PURE WHITE', 1800, '11-Dec-26'],
      ],
    },
  ]);

  const alex3Buf = createSampleWorkbookArrayBuffer([
    {
      name: 'PG#36292',
      rows: [
        ['PG#', 'PO Number', 'Colour', 'Qty', 'Final insp.'],
        ['PG#36292', '0021550120', 'HEATHER GREY', 950, '09-Dec-26'],
      ],
    },
    {
      name: 'PG#36304',
      rows: [
        ['PG#', 'PO Number', 'Colour', 'Qty', 'Final insp.'],
        ['PG#36304', '21550455', 'OLIVE NIGHT', 1650, '14-Dec-26'],
      ],
    },
  ]);

  const alex5Buf = createSampleWorkbookArrayBuffer([
    {
      name: 'PG#36280',
      rows: [
        ['PG#', 'PO No', 'Color', 'Order Qty', 'Loading Date'],
        ['PG#36280', '0021549910', 'NAVY BLAZER', 1000, '08-Dec-26'],
      ],
    },
    {
      name: 'PG#36310',
      rows: [
        ['PG#', 'PO No', 'Color', 'Order Qty', 'Loading Date'],
        ['PG#36310', '0021552211', 'DEEP TEAL', 2100, '18-Dec-26'],
      ],
    },
  ]);

  const workbooks: FactoryWorkbookFile[] = [
    parseFactoryWorkbookBuffer({
      fileId: 'SAMPLE-ALEX1',
      fileName: 'ALEX_1_Master_Allocation.xlsx',
      buffer: alex1Buf,
      overrideFactoryName: 'ALEX 1',
    }),
    parseFactoryWorkbookBuffer({
      fileId: 'SAMPLE-ALEX3',
      fileName: 'ALEX_3_Line_Schedule.xlsx',
      buffer: alex3Buf,
      overrideFactoryName: 'ALEX 3',
    }),
    parseFactoryWorkbookBuffer({
      fileId: 'SAMPLE-ALEX5',
      fileName: 'ALEX_5_Export_Plan.xlsx',
      buffer: alex5Buf,
      overrideFactoryName: 'ALEX 5',
    }),
  ];

  const sourceRecords: SourcePoRecord[] = [
    {
      id: 'SAMPLE-SRC-1',
      pgNumber: 'PG#36280',
      poNumber: '0021548218',
      color: 'JET BLACK',
      qty: 1200,
      sourceLabel: 'Sample_Buyer_PO_List.jpg',
      sourceType: 'image',
    },
    {
      id: 'SAMPLE-SRC-2',
      pgNumber: 'PG#36280',
      poNumber: '0021549910',
      color: 'NAVY BLAZER',
      qty: 2400,
      sourceLabel: 'Sample_Buyer_PO_List.jpg',
      sourceType: 'image',
    },
    {
      id: 'SAMPLE-SRC-3',
      pgNumber: 'PG#36292',
      poNumber: '0021550120',
      color: 'HEATHER GREY',
      qty: 950,
      sourceLabel: 'Sample_Buyer_PO_List.jpg',
      sourceType: 'image',
    },
    {
      id: 'SAMPLE-SRC-4',
      pgNumber: 'PG#36304',
      poNumber: '0021550455',
      color: 'OLIVE NIGHT',
      qty: 1650,
      sourceLabel: 'Sample_Buyer_PO_List.jpg',
      sourceType: 'image',
    },
    {
      id: 'SAMPLE-SRC-5',
      pgNumber: 'PG#36399',
      poNumber: '0021559999',
      color: 'CHARCOAL',
      qty: 600,
      sourceLabel: 'Sample_Buyer_PO_List.jpg',
      sourceType: 'image',
    },
  ];

  return {
    workbooks,
    sampleImageUrl: generateSampleSlipJpgDataUrl(),
    sourceRecords,
  };
}
