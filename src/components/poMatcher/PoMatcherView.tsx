import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  GitFork,
  Globe,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiUrl } from '../../lib/apiBase.ts';
import { copyTextWithFallback } from '../AppLinkModal.tsx';
import {
  buildFactorySummaries,
  createSampleMatcherBundle,
  exportMatchedResultsWorkbook,
  inferFactoryNameFromFileName,
  parseFactoryWorkbookBuffer,
  parseSourceWorkbookBuffer,
  runPoAllocationMatching,
} from './poMatcherEngine.ts';
import { PO_MATCHER_COPY } from './poMatcherTypes.ts';
import type {
  FactoryWorkbookFile,
  MatchedPoResult,
  PoMatcherLang,
  SourceImageFile,
  SourcePoRecord,
} from './poMatcherTypes.ts';

interface PoMatcherViewProps {
  companyName?: string;
  onBackToPortal: () => void;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function prepareImageDataUrlForOcr(
  file: File
): Promise<{ dataUrl: string; mimeType: string }> {
  const extMatch = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch?.[1] || '';
  const rawMime =
    file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp'
      ? file.type
      : IMAGE_MIME_BY_EXT[ext] || 'image/jpeg';

  const originalDataUrl = await readFileAsDataUrl(file);
  const needsCompression =
    file.size > 3.5 * 1024 * 1024 ||
    (rawMime !== 'image/jpeg' && rawMime !== 'image/png' && rawMime !== 'image/webp');

  if (!needsCompression || typeof document === 'undefined') {
    return { dataUrl: originalDataUrl, mimeType: rawMime };
  }

  // Resize oversized mobile camera photos cleanly to fit API limits while preserving text legibility
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 2200;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round((img.width || 1) * scale));
      const h = Math.max(1, Math.round((img.height || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: originalDataUrl, mimeType: rawMime });
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.88),
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => resolve({ dataUrl: originalDataUrl, mimeType: rawMime });
    img.src = originalDataUrl;
  });
}

async function renderRotatedImageForOcr(
  dataUrl: string,
  mimeType: string,
  rotationDeg: number
): Promise<{ base64: string; mimeType: string }> {
  const normalizedRot = ((rotationDeg % 360) + 360) % 360;
  if (normalizedRot === 0 || typeof document === 'undefined') {
    const commaIdx = dataUrl.indexOf(',');
    return {
      base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
      mimeType,
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const swap = normalizedRot === 90 || normalizedRot === 270;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const commaIdx = dataUrl.indexOf(',');
        resolve({
          base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
          mimeType,
        });
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((normalizedRot * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      const outUrl = canvas.toDataURL('image/jpeg', 0.9);
      const commaIdx = outUrl.indexOf(',');
      resolve({
        base64: commaIdx >= 0 ? outUrl.slice(commaIdx + 1) : outUrl,
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => {
      const commaIdx = dataUrl.indexOf(',');
      resolve({
        base64: commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl,
        mimeType,
      });
    };
    img.src = dataUrl;
  });
}

function isSpreadsheetFileName(name: string): boolean {
  return /\.(xlsx|xls|xlsm|csv)$/i.test(name.trim());
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp)$/i.test(file.name.trim());
}

export function PoMatcherView({
  companyName = 'Alex Apparels',
  onBackToPortal,
}: PoMatcherViewProps) {
  const [lang, setLang] = useState<PoMatcherLang>('en');
  const copy = PO_MATCHER_COPY[lang];

  const [workbooks, setWorkbooks] = useState<FactoryWorkbookFile[]>([]);
  const [sourceImages, setSourceImages] = useState<SourceImageFile[]>([]);
  const [sourceRecords, setSourceRecords] = useState<SourcePoRecord[]>([]);
  const [results, setResults] = useState<MatchedPoResult[]>([]);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [dirtySinceRun, setDirtySinceRun] = useState(false);

  const [factoryDragOver, setFactoryDragOver] = useState(false);
  const [sourceDragOver, setSourceDragOver] = useState(false);
  const [parsingFactoryFiles, setParsingFactoryFiles] = useState(false);
  const [matchingBusy, setMatchingBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'info' | 'error' | 'success'; text: string } | null>(
    null
  );

  // Quick Manual Lookup inputs
  const [quickPg, setQuickPg] = useState('');
  const [quickPo, setQuickPo] = useState('');
  const [quickColor, setQuickColor] = useState('');
  const [quickQty, setQuickQty] = useState('');

  // Result Filters
  const [resultSearch, setResultSearch] = useState('');
  const [resultFactoryFilter, setResultFactoryFilter] = useState<string>('ALL');
  const [resultStatusFilter, setResultStatusFilter] = useState<'ALL' | 'MATCHED' | 'NOT_FOUND'>(
    'ALL'
  );

  // Sheet Viewer state
  const [viewerFileId, setViewerFileId] = useState<string>('');
  const [viewerSheetName, setViewerSheetName] = useState<string>('');
  const [viewerHighlightedRows, setViewerHighlightedRows] = useState<number[]>([]);

  // Share bar state
  const [linkCopied, setLinkCopied] = useState(false);
  const [logoError, setLogoError] = useState(false);

  // Refs for quick section scrolling and file inputs
  const step1Ref = useRef<HTMLElement | null>(null);
  const step2Ref = useRef<HTMLElement | null>(null);
  const step3Ref = useRef<HTMLElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);
  const factoryInputRef = useRef<HTMLInputElement | null>(null);
  const sourcePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const sourceExcelInputRef = useRef<HTMLInputElement | null>(null);
  const highlightedRowElRef = useRef<HTMLTableRowElement | null>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.href;
  }, []);

  const canNativeShare = useMemo(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    []
  );

  // Keep viewer selection synced cleanly when workbooks change
  useEffect(() => {
    if (workbooks.length === 0) {
      setViewerFileId('');
      setViewerSheetName('');
      setViewerHighlightedRows([]);
      return;
    }
    const currentFile = workbooks.find((w) => w.id === viewerFileId) || workbooks[0];
    if (currentFile.id !== viewerFileId) {
      setViewerFileId(currentFile.id);
      setViewerSheetName(currentFile.sheets[0]?.sheetName || '');
      setViewerHighlightedRows([]);
    } else if (
      currentFile.sheets.length > 0 &&
      !currentFile.sheets.some((s) => s.sheetName === viewerSheetName)
    ) {
      setViewerSheetName(currentFile.sheets[0].sheetName);
      setViewerHighlightedRows([]);
    }
  }, [workbooks, viewerFileId, viewerSheetName]);

  const scrollToSection = (ref: React.RefObject<HTMLElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Handle Factory Excel Files Upload
  const handleFactoryFilesSelected = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => isSpreadsheetFileName(f.name));
    if (files.length === 0) {
      setNotice({
        type: 'error',
        text: 'Please upload .xlsx, .xls, or .csv factory allocation files.',
      });
      return;
    }

    setParsingFactoryFiles(true);
    setNotice(null);
    try {
      const parsedList: FactoryWorkbookFile[] = [];
      for (const file of files) {
        const buffer = await readFileAsArrayBuffer(file);
        const fileId = `FAC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const parsed = parseFactoryWorkbookBuffer({
          fileId,
          fileName: file.name,
          buffer,
        });
        parsedList.push(parsed);
      }

      setWorkbooks((prev) => [...prev, ...parsedList]);
      setDirtySinceRun(true);
      const totalNewRows = parsedList.reduce((sum, w) => sum + w.totalRows, 0);
      setNotice({
        type: 'success',
        text: `Loaded ${parsedList.length} factory workbook(s) with ${totalNewRows.toLocaleString()} parsed PO allocation rows.`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to parse one or more Excel workbooks.',
      });
    } finally {
      setParsingFactoryFiles(false);
    }
  }, []);

  // AI Vision OCR call to /api/extract-image
  const scanImageFileWithOcr = useCallback(
    async (imageFile: SourceImageFile): Promise<SourcePoRecord[]> => {
      setSourceImages((prev) =>
        prev.map((img) =>
          img.id === imageFile.id ? { ...img, status: 'scanning', errorMessage: undefined } : img
        )
      );

      try {
        const prepared = await renderRotatedImageForOcr(
          imageFile.dataUrl,
          imageFile.mimeType,
          imageFile.rotationDeg
        );

        const res = await fetch(apiUrl('/api/extract-image'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: prepared.base64,
            mimeType: prepared.mimeType,
          }),
        });

        const payload = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          sourceRecords?: Array<{
            pgNumber?: string;
            poNumber?: string;
            color?: string;
            qty?: number;
          }>;
        } | null;

        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || `OCR failed (${res.status})`);
        }

        const extracted = Array.isArray(payload.sourceRecords) ? payload.sourceRecords : [];
        const newRecords: SourcePoRecord[] = extracted.map((item, idx) => ({
          id: `SRC-IMG-${imageFile.id}-${Date.now()}-${idx}`,
          pgNumber: (item.pgNumber || '').trim(),
          poNumber: (item.poNumber || '').trim(),
          color: (item.color || '').trim(),
          qty: typeof item.qty === 'number' && Number.isFinite(item.qty) ? Math.round(item.qty) : 0,
          sourceLabel: imageFile.fileName,
          sourceType: 'image',
        }));

        setSourceImages((prev) =>
          prev.map((img) =>
            img.id === imageFile.id
              ? { ...img, status: 'done', extractedCount: newRecords.length, errorMessage: undefined }
              : img
          )
        );

        return newRecords;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to scan photo via AI OCR.';
        setSourceImages((prev) =>
          prev.map((img) =>
            img.id === imageFile.id ? { ...img, status: 'error', errorMessage: msg } : img
          )
        );
        throw new Error(msg);
      }
    },
    []
  );

  // Handle Source Files Upload (both images and Source Excel/CSV)
  const handleSourceFilesSelected = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setNotice(null);
      const imageCandidates: File[] = [];
      const excelCandidates: File[] = [];

      for (const f of files) {
        if (isSpreadsheetFileName(f.name)) {
          excelCandidates.push(f);
        } else if (isImageFile(f)) {
          imageCandidates.push(f);
        }
      }

      if (imageCandidates.length === 0 && excelCandidates.length === 0) {
        setNotice({
          type: 'error',
          text: 'Please upload a JPG/PNG/WebP photo or a Source Excel (.xlsx, .xls, .csv) file.',
        });
        return;
      }

      if (excelCandidates.length > 0) {
        try {
          const allExcelRows: SourcePoRecord[] = [];
          for (const f of excelCandidates) {
            const buf = await readFileAsArrayBuffer(f);
            const rows = parseSourceWorkbookBuffer({ fileName: f.name, buffer: buf });
            allExcelRows.push(...rows);
          }
          if (allExcelRows.length > 0) {
            setSourceRecords((prev) => [...prev, ...allExcelRows]);
            setDirtySinceRun(true);
            setNotice({
              type: 'success',
              text: `Parsed ${allExcelRows.length} source PO row(s) from ${excelCandidates.length} Excel file(s).`,
            });
          } else {
            setNotice({
              type: 'error',
              text: 'No PO rows detected inside the uploaded Source Excel file.',
            });
          }
        } catch (err) {
          setNotice({
            type: 'error',
            text: err instanceof Error ? err.message : 'Failed to read Source Excel file.',
          });
        }
      }

      if (imageCandidates.length > 0) {
        const addedImages: SourceImageFile[] = [];
        for (const f of imageCandidates) {
          const prepared = await prepareImageDataUrlForOcr(f);
          addedImages.push({
            id: `IMG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: f.name,
            mimeType: prepared.mimeType,
            dataUrl: prepared.dataUrl,
            rotationDeg: 0,
            zoom: 1,
            status: 'pending',
            extractedCount: 0,
          });
        }

        setSourceImages((prev) => [...prev, ...addedImages]);
        setDirtySinceRun(true);

        // Immediately run OCR on newly uploaded images so user sees live extracted rows right away
        let scannedTotal = 0;
        let ocrErrorText = '';
        for (const imgObj of addedImages) {
          try {
            const rows = await scanImageFileWithOcr(imgObj);
            if (rows.length > 0) {
              setSourceRecords((prev) => [...prev, ...rows]);
              scannedTotal += rows.length;
            }
          } catch (err) {
            ocrErrorText = err instanceof Error ? err.message : 'Photo OCR failed.';
          }
        }

        if (scannedTotal > 0) {
          setNotice({
            type: 'success',
            text: `AI Vision OCR extracted ${scannedTotal} PO item(s) from ${addedImages.length} photo(s). Review below or run Matching.`,
          });
        } else if (ocrErrorText) {
          setNotice({
            type: 'error',
            text: ocrErrorText,
          });
        }
      }
    },
    [scanImageFileWithOcr]
  );

  // Re-scan an existing image (e.g. after rotating 90°)
  const handleRescanImage = useCallback(
    async (imageId: string) => {
      const target = sourceImages.find((img) => img.id === imageId);
      if (!target) return;
      setNotice(null);
      try {
        const rows = await scanImageFileWithOcr(target);
        setSourceRecords((prev) => [
          ...prev.filter((r) => !(r.sourceType === 'image' && r.sourceLabel === target.fileName)),
          ...rows,
        ]);
        setDirtySinceRun(true);
        setNotice({
          type: 'success',
          text: `Re-scanned "${target.fileName}" and extracted ${rows.length} PO row(s).`,
        });
      } catch (err) {
        setNotice({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to re-scan photo.',
        });
      }
    },
    [sourceImages, scanImageFileWithOcr]
  );

  // Primary Action Bar: Scan any pending images, then match all Source POs against Factory workbooks
  const handleStartMatching = useCallback(
    async (overrideSources?: SourcePoRecord[], overrideWorkbooks?: FactoryWorkbookFile[]) => {
      const activeWorkbooks = overrideWorkbooks ?? workbooks;
      if (activeWorkbooks.length === 0) {
        setNotice({
          type: 'error',
          text: 'Please upload at least one Factory Excel workbook in Step 1 first.',
        });
        scrollToSection(step1Ref);
        return;
      }

      setMatchingBusy(true);
      setNotice(null);

      try {
        let workingSources = overrideSources ?? sourceRecords;

        // Scan any queued source images that haven't completed OCR yet
        const pendingImages = sourceImages.filter((img) => img.status === 'pending');
        if (pendingImages.length > 0 && !overrideSources) {
          const newlyExtracted: SourcePoRecord[] = [];
          for (const imgObj of pendingImages) {
            const rows = await scanImageFileWithOcr(imgObj);
            newlyExtracted.push(...rows);
          }
          if (newlyExtracted.length > 0) {
            workingSources = [...workingSources, ...newlyExtracted];
            setSourceRecords(workingSources);
          }
        }

        if (workingSources.length === 0) {
          setNotice({
            type: 'error',
            text: 'Add at least one Source PO (photo, Excel, or Quick Lookup) in Step 2 before matching.',
          });
          scrollToSection(step2Ref);
          return;
        }

        const nextResults = runPoAllocationMatching(workingSources, activeWorkbooks);
        setResults(nextResults);
        setHasRunOnce(true);
        setDirtySinceRun(false);
        setResultFactoryFilter('ALL');
        setResultStatusFilter('ALL');

        const matchedCount = nextResults.filter((r) => r.matchType !== 'not_found').length;
        setNotice({
          type: 'success',
          text: `Matching complete: found ${matchedCount} factory allocation occurrence(s) across ${workingSources.length} source PO item(s).`,
        });

        window.setTimeout(() => {
          scrollToSection(step3Ref);
        }, 80);
      } catch (err) {
        setNotice({
          type: 'error',
          text: err instanceof Error ? err.message : 'Matching failed. Please inspect your inputs.',
        });
      } finally {
        setMatchingBusy(false);
      }
    },
    [workbooks, sourceRecords, sourceImages, scanImageFileWithOcr]
  );

  const handleQuickLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pg = quickPg.trim();
    const po = quickPo.trim();
    if (!pg && !po) {
      setNotice({
        type: 'error',
        text: 'Enter a PO# or PG# to add & match.',
      });
      return;
    }

    const parsedQty = Number(quickQty.replace(/,/g, '').trim());
    const newItem: SourcePoRecord = {
      id: `SRC-MANUAL-${Date.now()}`,
      pgNumber: pg,
      poNumber: po,
      color: quickColor.trim(),
      qty: Number.isFinite(parsedQty) && parsedQty > 0 ? Math.round(parsedQty) : 0,
      sourceLabel: 'Quick Lookup',
      sourceType: 'manual',
    };

    const nextSources = [...sourceRecords, newItem];
    setSourceRecords(nextSources);
    setQuickPg('');
    setQuickPo('');
    setQuickColor('');
    setQuickQty('');
    setDirtySinceRun(true);

    if (workbooks.length > 0) {
      await handleStartMatching(nextSources, workbooks);
    }
  };

  const handleLoadSampleData = () => {
    const bundle = createSampleMatcherBundle();
    setWorkbooks(bundle.workbooks);
    setSourceRecords(bundle.sourceRecords);
    setSourceImages(
      bundle.sampleImageUrl
        ? [
            {
              id: 'SAMPLE-IMG-1',
              fileName: 'Sample_Buyer_PO_List.jpg',
              mimeType: 'image/jpeg',
              dataUrl: bundle.sampleImageUrl,
              rotationDeg: 0,
              zoom: 1,
              status: 'done',
              extractedCount: bundle.sourceRecords.length,
            },
          ]
        : []
    );
    const initialResults = runPoAllocationMatching(bundle.sourceRecords, bundle.workbooks);
    setResults(initialResults);
    setHasRunOnce(true);
    setDirtySinceRun(false);
    setResultFactoryFilter('ALL');
    setResultStatusFilter('ALL');
    setResultSearch('');
    setViewerFileId(bundle.workbooks[0]?.id || '');
    setViewerSheetName(bundle.workbooks[0]?.sheets[0]?.sheetName || '');
    setViewerHighlightedRows([]);
    setNotice({
      type: 'success',
      text: 'Loaded 3 sample factory workbooks (including Split PO 0021549910 across ALEX 1 & ALEX 5) and a sample PO list.',
    });
  };

  const handleClearAll = () => {
    setWorkbooks([]);
    setSourceImages([]);
    setSourceRecords([]);
    setResults([]);
    setHasRunOnce(false);
    setDirtySinceRun(false);
    setResultSearch('');
    setResultFactoryFilter('ALL');
    setResultStatusFilter('ALL');
    setQuickPg('');
    setQuickPo('');
    setQuickColor('');
    setQuickQty('');
    setViewerFileId('');
    setViewerSheetName('');
    setViewerHighlightedRows([]);
    setNotice({ type: 'info', text: 'Cleared all factory files, source items, and match results.' });
  };

  const handleJumpToSheetRow = (res: MatchedPoResult) => {
    if (!res.factoryFileId || !res.sheetName) return;
    setViewerFileId(res.factoryFileId);
    setViewerSheetName(res.sheetName);
    setViewerHighlightedRows(
      res.matchedRowIndices.length > 0
        ? res.matchedRowIndices
        : typeof res.rawRowIndex === 'number'
          ? [res.rawRowIndex]
          : []
    );
    window.setTimeout(() => {
      viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => {
        highlightedRowElRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 220);
    }, 50);
  };

  // Summary metrics & filters
  const factorySummaries = useMemo(() => buildFactorySummaries(results), [results]);

  const kpis = useMemo(() => {
    const uniqueSourceIds = new Set(sourceRecords.map((s) => s.id));
    const matchedSourceIds = new Set(
      results.filter((r) => r.matchType !== 'not_found').map((r) => r.sourceId)
    );
    const notFoundCount = results.filter((r) => r.matchType === 'not_found').length;
    const matchedQty = results.reduce(
      (sum, r) => sum + (r.matchType !== 'not_found' ? r.factoryQty || 0 : 0),
      0
    );
    return {
      totalSource: uniqueSourceIds.size,
      matchedOccurrences: results.filter((r) => r.matchType !== 'not_found').length,
      matchedUniqueSource: matchedSourceIds.size,
      notFoundCount,
      matchedQty,
    };
  }, [sourceRecords, results]);

  const distinctMatchedFactories = useMemo(() => {
    return Array.from(
      new Set(results.filter((r) => r.matchType !== 'not_found').map((r) => r.factoryName))
    ).sort();
  }, [results]);

  const filteredResults = useMemo(() => {
    const q = resultSearch.trim().toLowerCase();
    return results.filter((r) => {
      if (resultStatusFilter === 'MATCHED' && r.matchType === 'not_found') return false;
      if (resultStatusFilter === 'NOT_FOUND' && r.matchType !== 'not_found') return false;
      if (
        resultFactoryFilter !== 'ALL' &&
        (r.matchType === 'not_found' || r.factoryName !== resultFactoryFilter)
      ) {
        return false;
      }
      if (!q) return true;
      const hay = [
        r.factoryName,
        r.sourcePg,
        r.factoryPg,
        r.sourcePo,
        r.factoryPo,
        r.finalInsp,
        r.sourceColor,
        r.factoryColor,
        r.sheetName,
        r.factoryFileName || '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [results, resultSearch, resultFactoryFilter, resultStatusFilter]);

  const activeViewerFile = useMemo(
    () => workbooks.find((w) => w.id === viewerFileId) || workbooks[0] || null,
    [workbooks, viewerFileId]
  );

  const activeViewerSheet = useMemo(() => {
    if (!activeViewerFile) return null;
    return (
      activeViewerFile.sheets.find((s) => s.sheetName === viewerSheetName) ||
      activeViewerFile.sheets[0] ||
      null
    );
  }, [activeViewerFile, viewerSheetName]);

  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    const ok = await copyTextWithFallback(shareUrl);
    if (ok) {
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2400);
    }
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;
    if (canNativeShare) {
      try {
        await navigator.share({
          title: `${companyName} — PO & PG# Matcher`,
          text: 'Check factory PO allocations, PG# tabs, quantities, and Final insp. dates.',
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or share failed; fall back to copy
      }
    }
    await handleCopyShareLink();
  };

  return (
    <div className="min-h-screen app-shell-height flex flex-col robotics-workspace-bg text-slate-900">
      {/* Compact Sticky Top Bar */}
      <header className="sticky top-0 z-40 ct-header-glass ct-safe-header">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 min-h-[60px] py-2 flex flex-wrap items-center justify-between gap-2.5">
          {/* Left: Back to Portal + Brand Title */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={onBackToPortal}
              className="min-h-[44px] px-3 rounded-xl border border-slate-300/90 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{copy.portalBack}</span>
            </button>

            <div className="hidden sm:flex items-center gap-2.5 min-w-0">
              {!logoError ? (
                <img
                  src={`${import.meta.env.BASE_URL}assets/aistudio/OIP__1__63903905.webp`}
                  alt={companyName}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-7 w-auto object-contain shrink-0"
                />
              ) : null}
              <span className="h-5 w-px bg-slate-200 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <h1 className="font-display text-sm sm:text-base font-bold text-slate-950 truncate">
                  {copy.title}
                </h1>
              </div>
            </div>
          </div>

          {/* Right: Language Switcher + Sample + Clear + Export */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            {/* EN / বাংলা Switcher */}
            <div
              role="group"
              aria-label="Language switcher"
              className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-0.5"
            >
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`min-h-[40px] px-2.5 rounded-[10px] text-xs font-semibold transition-colors cursor-pointer ${
                  lang === 'en'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang('bn')}
                className={`min-h-[40px] px-2.5 rounded-[10px] text-xs font-semibold transition-colors cursor-pointer ${
                  lang === 'bn'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                বাংলা
              </button>
            </div>

            <button
              type="button"
              onClick={handleLoadSampleData}
              className="min-h-[44px] px-3 rounded-xl border border-emerald-300/90 bg-emerald-50/80 hover:bg-emerald-100/80 text-emerald-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>{copy.loadSampleBtn}</span>
            </button>

            {(workbooks.length > 0 || sourceRecords.length > 0 || sourceImages.length > 0) && (
              <button
                type="button"
                onClick={handleClearAll}
                className="min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white hover:bg-rose-50 hover:border-rose-300 text-slate-700 hover:text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{copy.clearAllBtn}</span>
              </button>
            )}

            <button
              type="button"
              disabled={results.length === 0}
              onClick={() => exportMatchedResultsWorkbook(results, factorySummaries)}
              className="min-h-[44px] px-3.5 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-600 hover:from-emerald-800 hover:to-teal-700 disabled:opacity-45 disabled:pointer-events-none text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer transition-all"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{copy.exportExcelBtn}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5 sm:space-y-6">
        {/* Mobile Title + Horizontal Quick-Jump Nav Bar */}
        <div className="space-y-3">
          <div className="sm:hidden">
            <h1 className="font-display text-lg font-bold text-slate-950">{copy.title}</h1>
            <p className="text-xs text-slate-600 mt-0.5">{copy.subtitle}</p>
          </div>
          <p className="hidden sm:block text-sm text-slate-600">{copy.subtitle}</p>

          <nav
            aria-label="Workspace quick navigation"
            className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar"
          >
            <button
              type="button"
              onClick={() => scrollToSection(step1Ref)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white/95 hover:border-emerald-400 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2"
            >
              <span>{copy.navDataFiles}</span>
              <span className="font-mono tabular-nums text-emerald-700">{workbooks.length}</span>
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(step2Ref)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white/95 hover:border-emerald-400 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2"
            >
              <span>{copy.navSourceFile}</span>
              <span className="font-mono tabular-nums text-emerald-700">{sourceRecords.length}</span>
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(step3Ref)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white/95 hover:border-emerald-400 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2"
            >
              <span>{copy.navResultBox}</span>
              <span className="font-mono tabular-nums text-emerald-700">{results.length}</span>
            </button>
            <button
              type="button"
              onClick={() => scrollToSection(viewerRef)}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white/95 hover:border-emerald-400 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-2"
            >
              <span>{copy.navSheetViewer}</span>
              <span className="font-mono tabular-nums text-slate-500">
                {activeViewerFile?.sheets.length ?? 0}
              </span>
            </button>
          </nav>
        </div>

        {/* Status Feedback Banner */}
        {notice && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-xs sm:text-sm flex items-start justify-between gap-3 ${
              notice.type === 'error'
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : notice.type === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  : 'border-cyan-200 bg-cyan-50/80 text-cyan-950'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {notice.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              )}
              <span>{notice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss message"
              className="min-h-[36px] min-w-[36px] -my-1 -mr-1 inline-flex items-center justify-center rounded-lg hover:bg-black/5 cursor-pointer shrink-0"
            >
              <XCircle className="w-4 h-4 opacity-60" />
            </button>
          </div>
        )}

        {/* Dual Upload Grid: Step 1 (Factory Data Files) + Step 2 (Source File & Quick Lookup) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* STEP 1: FACTORY DATA FILES */}
          <section
            ref={step1Ref}
            aria-labelledby="step1-heading"
            className="ct-surface rounded-2xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="step1-heading" className="font-display text-base sm:text-lg font-bold text-slate-950">
                  {copy.step1Title}
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{copy.step1Hint}</p>
              </div>
              <span className="font-mono text-xs font-semibold text-emerald-800 tabular-nums whitespace-nowrap shrink-0">
                {workbooks.length} files
              </span>
            </div>

            {/* Drag & Drop + File Picker */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setFactoryDragOver(true);
              }}
              onDragLeave={() => setFactoryDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setFactoryDragOver(false);
                if (e.dataTransfer.files?.length) {
                  void handleFactoryFilesSelected(e.dataTransfer.files);
                }
              }}
              className={`rounded-xl border-2 border-dashed p-4 sm:p-5 text-center transition-colors ${
                factoryDragOver
                  ? 'border-emerald-500 bg-emerald-50/70'
                  : 'border-slate-300 bg-slate-50/60 hover:border-emerald-400'
              }`}
            >
              <FileSpreadsheet className="w-8 h-8 text-emerald-700 mx-auto mb-2" />
              <p className="text-xs sm:text-sm font-medium text-slate-700">{copy.step1DropText}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">.xlsx · .xls · .csv (multi-file)</p>

              <input
                ref={factoryInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.xlsm,.csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handleFactoryFilesSelected(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={parsingFactoryFiles}
                onClick={() => factoryInputRef.current?.click()}
                className="mt-3 min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors"
              >
                {parsingFactoryFiles ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>{copy.step1BrowseBtn}</span>
              </button>
            </div>

            {/* Uploaded Factory Workbooks List */}
            {workbooks.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                  <span>{copy.step1FilesCount}</span>
                  <span className="font-mono tabular-nums">
                    {workbooks.reduce((s, w) => s + w.totalRows, 0).toLocaleString()} rows ·{' '}
                    {workbooks.reduce((s, w) => s + w.totalQty, 0).toLocaleString()} pcs
                  </span>
                </div>

                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-0.5">
                  {workbooks.map((wb) => (
                    <div
                      key={wb.id}
                      className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2.5 justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`factory-name-${wb.id}`}>
                            {copy.factoryNameLabel}
                          </label>
                          <input
                            id={`factory-name-${wb.id}`}
                            type="text"
                            value={wb.factoryName}
                            onChange={(e) => {
                              const nextName = e.target.value;
                              setWorkbooks((prev) =>
                                prev.map((item) => {
                                  if (item.id !== wb.id) return item;
                                  return {
                                    ...item,
                                    factoryName: nextName,
                                    sheets: item.sheets.map((s) => ({
                                      ...s,
                                      parsedRows: s.parsedRows.map((r) => ({
                                        ...r,
                                        factoryName: nextName.trim() || inferFactoryNameFromFileName(item.fileName),
                                      })),
                                    })),
                                  };
                                })
                              );
                              setDirtySinceRun(true);
                            }}
                            placeholder={copy.factoryNameLabel}
                            className="min-h-[44px] w-full sm:max-w-[200px] px-3 rounded-lg border border-slate-300 bg-slate-50/70 focus:bg-white focus:border-emerald-500 focus:outline-none text-sm font-semibold text-slate-900"
                          />
                          <span className="text-xs text-slate-500 truncate" title={wb.fileName}>
                            {wb.fileName}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                          {wb.sheets.length} tab(s) · {wb.totalRows.toLocaleString()} PO rows ·{' '}
                          {wb.totalQty.toLocaleString()} pcs
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          title={copy.viewWorkbookTip}
                          onClick={() => {
                            setViewerFileId(wb.id);
                            setViewerSheetName(wb.sheets[0]?.sheetName || '');
                            setViewerHighlightedRows([]);
                            scrollToSection(viewerRef);
                          }}
                          className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-800 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title={copy.removeTip}
                          onClick={() => {
                            setWorkbooks((prev) => prev.filter((item) => item.id !== wb.id));
                            setDirtySinceRun(true);
                          }}
                          className="min-h-[44px] min-w-[44px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-300 text-slate-500 hover:text-rose-700 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* STEP 2: SOURCE FILE (PHOTO OCR / EXCEL / QUICK LOOKUP) */}
          <section
            ref={step2Ref}
            aria-labelledby="step2-heading"
            className="ct-surface rounded-2xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="step2-heading" className="font-display text-base sm:text-lg font-bold text-slate-950">
                  {copy.step2Title}
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{copy.step2Hint}</p>
              </div>
              <span className="font-mono text-xs font-semibold text-cyan-800 tabular-nums whitespace-nowrap shrink-0">
                {sourceRecords.length} items
              </span>
            </div>

            {/* Source Photo + Source Excel Upload Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setSourceDragOver(true);
              }}
              onDragLeave={() => setSourceDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setSourceDragOver(false);
                if (e.dataTransfer.files?.length) {
                  void handleSourceFilesSelected(e.dataTransfer.files);
                }
              }}
              className={`rounded-xl border-2 border-dashed p-4 sm:p-5 text-center transition-colors ${
                sourceDragOver
                  ? 'border-cyan-500 bg-cyan-50/70'
                  : 'border-slate-300 bg-slate-50/60 hover:border-cyan-400'
              }`}
            >
              <ImageIcon className="w-8 h-8 text-cyan-700 mx-auto mb-2" />
              <p className="text-xs sm:text-sm font-medium text-slate-700">{copy.step2DropText}</p>

              <input
                ref={sourcePhotoInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handleSourceFilesSelected(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <input
                ref={sourceExcelInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.xlsm,.csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handleSourceFilesSelected(e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => sourcePhotoInputRef.current?.click()}
                  className="min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-cyan-700 to-teal-600 hover:from-cyan-800 hover:to-teal-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>{copy.step2PhotoBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() => sourceExcelInputRef.current?.click()}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                  <span>{copy.step2ExcelBtn}</span>
                </button>
              </div>
            </div>

            {/* Uploaded Source Image Previews (Zoom / Rotate 90° / Re-scan) */}
            {sourceImages.length > 0 && (
              <div className="space-y-3">
                {sourceImages.map((img) => (
                  <div
                    key={img.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate">
                          {img.fileName}
                        </div>
                        <div
                          className={`text-[11px] font-medium ${
                            img.status === 'scanning'
                              ? 'text-cyan-700'
                              : img.status === 'done'
                                ? 'text-emerald-700'
                                : img.status === 'error'
                                  ? 'text-rose-700'
                                  : 'text-slate-500'
                          }`}
                        >
                          {img.status === 'scanning'
                            ? copy.ocrScanningBadge
                            : img.status === 'done'
                              ? `${copy.ocrDoneBadge} · ${img.extractedCount} rows`
                              : img.status === 'error'
                                ? `${copy.ocrErrorBadge}: ${img.errorMessage || ''}`
                                : copy.ocrPendingBadge}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        <button
                          type="button"
                          title={copy.zoomOutTip}
                          onClick={() =>
                            setSourceImages((prev) =>
                              prev.map((item) =>
                                item.id === img.id
                                  ? { ...item, zoom: Math.max(0.6, Number((item.zoom - 0.25).toFixed(2))) }
                                  : item
                              )
                            )
                          }
                          className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"
                        >
                          <ZoomOut className="w-4 h-4 text-slate-700" />
                        </button>
                        <button
                          type="button"
                          title={copy.zoomInTip}
                          onClick={() =>
                            setSourceImages((prev) =>
                              prev.map((item) =>
                                item.id === img.id
                                  ? { ...item, zoom: Math.min(2.5, Number((item.zoom + 0.25).toFixed(2))) }
                                  : item
                              )
                            )
                          }
                          className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"
                        >
                          <ZoomIn className="w-4 h-4 text-slate-700" />
                        </button>
                        <button
                          type="button"
                          title={copy.rotateTip}
                          onClick={() =>
                            setSourceImages((prev) =>
                              prev.map((item) =>
                                item.id === img.id
                                  ? { ...item, rotationDeg: (item.rotationDeg + 90) % 360 }
                                  : item
                              )
                            )
                          }
                          className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"
                        >
                          <RotateCw className="w-4 h-4 text-slate-700" />
                        </button>
                        <button
                          type="button"
                          disabled={img.status === 'scanning'}
                          onClick={() => void handleRescanImage(img.id)}
                          className="min-h-[44px] px-3 rounded-lg border border-cyan-300 bg-cyan-50 hover:bg-cyan-100 text-cyan-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          {img.status === 'scanning' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          <span>{copy.rescanBtn}</span>
                        </button>
                        <button
                          type="button"
                          title={copy.removeTip}
                          onClick={() => {
                            setSourceImages((prev) => prev.filter((item) => item.id !== img.id));
                            setSourceRecords((prev) =>
                              prev.filter(
                                (r) => !(r.sourceType === 'image' && r.sourceLabel === img.fileName)
                              )
                            );
                            setDirtySinceRun(true);
                          }}
                          className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-300 text-slate-500 hover:text-rose-700 inline-flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-900/5 overflow-auto max-h-56 flex items-center justify-center p-2">
                      <img
                        src={img.dataUrl}
                        alt={img.fileName}
                        style={{
                          transform: `scale(${img.zoom}) rotate(${img.rotationDeg}deg)`,
                          transformOrigin: 'center center',
                        }}
                        className="max-h-48 w-auto object-contain transition-transform duration-200"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Editable Live Source PO Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  {copy.sourceTableTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setSourceRecords((prev) => [
                      ...prev,
                      {
                        id: `SRC-NEW-${Date.now()}`,
                        pgNumber: '',
                        poNumber: '',
                        color: '',
                        qty: 0,
                        sourceLabel: 'Manual Row',
                        sourceType: 'manual',
                      },
                    ]);
                    setDirtySinceRun(true);
                  }}
                  className="min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{copy.addRowBtn}</span>
                </button>
              </div>

              {sourceRecords.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="max-h-[260px] overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-700 border-b border-slate-200">
                        <tr>
                          <th className="py-2 px-2 font-semibold">{copy.pgLabel}</th>
                          <th className="py-2 px-2 font-semibold">{copy.poLabel}</th>
                          <th className="py-2 px-2 font-semibold">{copy.colorLabel}</th>
                          <th className="py-2 px-2 font-semibold text-right">{copy.qtyLabel}</th>
                          <th className="py-2 px-1.5 w-11" aria-label="Remove row" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sourceRecords.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/80">
                            <td className="p-1.5 min-w-[92px]">
                              <input
                                type="text"
                                value={row.pgNumber}
                                aria-label="Source PG Number"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSourceRecords((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, pgNumber: val } : r))
                                  );
                                  setDirtySinceRun(true);
                                }}
                                placeholder="PG#36280"
                                className="min-h-[44px] w-full px-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:outline-none font-mono text-xs"
                              />
                            </td>
                            <td className="p-1.5 min-w-[116px]">
                              <input
                                type="text"
                                value={row.poNumber}
                                aria-label="Source PO Number"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSourceRecords((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, poNumber: val } : r))
                                  );
                                  setDirtySinceRun(true);
                                }}
                                placeholder="0021548218"
                                className="min-h-[44px] w-full px-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:outline-none font-mono text-xs font-semibold text-slate-900"
                              />
                            </td>
                            <td className="p-1.5 min-w-[100px]">
                              <input
                                type="text"
                                value={row.color}
                                aria-label="Source Color"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSourceRecords((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, color: val } : r))
                                  );
                                  setDirtySinceRun(true);
                                }}
                                placeholder="BLACK"
                                className="min-h-[44px] w-full px-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:outline-none text-xs"
                              />
                            </td>
                            <td className="p-1.5 min-w-[78px]">
                              <input
                                type="number"
                                min={0}
                                value={row.qty || ''}
                                aria-label="Source Quantity"
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setSourceRecords((prev) =>
                                    prev.map((r) =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            qty: Number.isFinite(val) && val >= 0 ? Math.round(val) : 0,
                                          }
                                        : r
                                    )
                                  );
                                  setDirtySinceRun(true);
                                }}
                                placeholder="0"
                                className="min-h-[44px] w-full px-2 rounded-lg border border-slate-200 focus:border-emerald-500 focus:outline-none font-mono tabular-nums text-right text-xs"
                              />
                            </td>
                            <td className="p-1 text-center">
                              <button
                                type="button"
                                aria-label={copy.removeTip}
                                onClick={() => {
                                  setSourceRecords((prev) => prev.filter((r) => r.id !== row.id));
                                  setDirtySinceRun(true);
                                }}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Lookup Form (PG# & PO) */}
            <form
              onSubmit={handleQuickLookupSubmit}
              className="rounded-xl border border-slate-200 bg-slate-50/90 p-3.5 space-y-2.5"
            >
              <div>
                <h3 className="text-xs font-bold text-slate-800">{copy.quickLookupTitle}</h3>
                <p className="text-[11px] text-slate-500">{copy.quickLookupHint}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <input
                  type="text"
                  value={quickPg}
                  onChange={(e) => setQuickPg(e.target.value)}
                  placeholder={copy.pgLabel}
                  className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white focus:border-emerald-500 focus:outline-none text-xs font-mono"
                />
                <input
                  type="text"
                  value={quickPo}
                  onChange={(e) => setQuickPo(e.target.value)}
                  placeholder={copy.poLabel}
                  className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white focus:border-emerald-500 focus:outline-none text-xs font-mono"
                />
                <input
                  type="text"
                  value={quickColor}
                  onChange={(e) => setQuickColor(e.target.value)}
                  placeholder={copy.colorLabel}
                  className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white focus:border-emerald-500 focus:outline-none text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={quickQty}
                  onChange={(e) => setQuickQty(e.target.value)}
                  placeholder={copy.qtyLabel}
                  className="min-h-[44px] px-3 rounded-lg border border-slate-300 bg-white focus:border-emerald-500 focus:outline-none text-xs font-mono tabular-nums"
                />
                <button
                  type="submit"
                  className="col-span-2 sm:col-span-1 min-h-[44px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span>{copy.quickLookupBtn}</span>
                </button>
              </div>
            </form>
          </section>
        </div>

        {/* EXPLICIT ACTION BAR: START MATCHING / RE-RUN MATCHING */}
        <div className="ct-surface rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="text-xs sm:text-sm text-slate-700">
            <span className="font-semibold text-slate-950">{workbooks.length}</span> factory
            workbook(s) ·{' '}
            <span className="font-semibold text-slate-950">{sourceRecords.length}</span> source
            PO(s)
            {sourceImages.some((i) => i.status === 'pending') && (
              <span className="text-cyan-800 font-medium">
                {' '}
                · {sourceImages.filter((i) => i.status === 'pending').length} photo(s) queued for
                OCR
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={matchingBusy}
            onClick={() => void handleStartMatching()}
            className="min-h-[48px] px-6 rounded-xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 hover:from-emerald-800 hover:to-teal-500 disabled:opacity-60 text-white text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2 shadow-[0_12px_28px_-10px_rgba(5,150,105,0.55)] cursor-pointer transition-all"
          >
            {matchingBusy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{copy.matchingBusyBtn}</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                <span>
                  {hasRunOnce && dirtySinceRun
                    ? copy.rerunMatchBtn
                    : hasRunOnce
                      ? copy.rerunMatchBtn
                      : copy.startMatchBtn}
                </span>
              </>
            )}
          </button>
        </div>

        {/* STEP 3: MATCHED FACTORY RESULT BOX */}
        <section
          ref={step3Ref}
          aria-labelledby="step3-heading"
          className="ct-surface rounded-2xl p-4 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 id="step3-heading" className="font-display text-lg sm:text-xl font-bold text-slate-950">
                {copy.step3Title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 mt-0.5">{copy.step3Subtitle}</p>
            </div>
          </div>

          {!hasRunOnce && results.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center space-y-2">
              <Layers className="w-8 h-8 text-emerald-700 mx-auto" />
              <h3 className="font-display text-base font-bold text-slate-900">
                {copy.emptyResultsTitle}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto">
                {copy.emptyResultsDesc}
              </p>
            </div>
          ) : (
            <>
              {/* KPI Summary Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {copy.kpiTotalSource}
                  </div>
                  <div className="font-mono text-2xl font-bold text-slate-950 tabular-nums mt-1">
                    {kpis.totalSource}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                    {copy.kpiMatched}
                  </div>
                  <div className="font-mono text-2xl font-bold text-emerald-900 tabular-nums mt-1">
                    {kpis.matchedOccurrences}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">
                    {copy.kpiNotFound}
                  </div>
                  <div className="font-mono text-2xl font-bold text-rose-900 tabular-nums mt-1">
                    {kpis.notFoundCount}
                  </div>
                </div>
                <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-800">
                    {copy.kpiMatchedQty}
                  </div>
                  <div className="font-mono text-2xl font-bold text-cyan-950 tabular-nums mt-1">
                    {kpis.matchedQty.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Factory-Wise Summary Strip */}
              {factorySummaries.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    {copy.factorySummaryTitle}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {factorySummaries.map((fac) => (
                      <button
                        key={fac.factoryName}
                        type="button"
                        onClick={() =>
                          setResultFactoryFilter((prev) =>
                            prev === fac.factoryName ? 'ALL' : fac.factoryName
                          )
                        }
                        className={`text-left rounded-xl border p-3.5 transition-colors cursor-pointer min-h-[44px] ${
                          resultFactoryFilter === fac.factoryName
                            ? 'border-emerald-600 bg-emerald-50/80 ring-1 ring-emerald-500'
                            : 'border-slate-200 bg-white hover:border-emerald-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display text-sm font-bold text-slate-950">
                            {fac.factoryName}
                          </span>
                          <span className="font-mono text-xs font-semibold text-emerald-800 tabular-nums">
                            {fac.totalFactoryQty.toLocaleString()} pcs
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1 font-mono tabular-nums">
                          {fac.uniquePos} PO(s) · {fac.matchedLines} row(s) · Insp: {fac.earliestFinalInsp}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Search, Factory Dropdown & Status Filter Bar */}
              <div className="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={resultSearch}
                    onChange={(e) => setResultSearch(e.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="min-h-[44px] w-full pl-9 pr-3 rounded-xl border border-slate-300 bg-white focus:border-emerald-500 focus:outline-none text-xs sm:text-sm"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={resultFactoryFilter}
                    aria-label="Filter by factory"
                    onChange={(e) => setResultFactoryFilter(e.target.value)}
                    className="min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white focus:border-emerald-500 focus:outline-none text-xs font-semibold text-slate-800"
                  >
                    <option value="ALL">{copy.allFactoriesOption}</option>
                    {distinctMatchedFactories.map((fac) => (
                      <option key={fac} value={fac}>
                        {fac}
                      </option>
                    ))}
                  </select>

                  <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5">
                    {(['ALL', 'MATCHED', 'NOT_FOUND'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setResultStatusFilter(tab)}
                        className={`min-h-[40px] px-3 rounded-[10px] text-xs font-semibold cursor-pointer transition-colors ${
                          resultStatusFilter === tab
                            ? 'bg-white text-emerald-800 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab === 'ALL'
                          ? copy.filterAll
                          : tab === 'MATCHED'
                            ? copy.filterMatched
                            : copy.filterNotFound}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* DESKTOP TABLE VIEW */}
              <div className="hidden lg:block border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-900 text-white">
                      <tr>
                        <th className="py-3 px-3 font-semibold">{copy.colFactory}</th>
                        <th className="py-3 px-3 font-semibold">{copy.colPg}</th>
                        <th className="py-3 px-3 font-semibold">{copy.colPo}</th>
                        <th className="py-3 px-3 font-semibold">{copy.colLoadingDate}</th>
                        <th className="py-3 px-3 font-semibold">{copy.colColor}</th>
                        <th className="py-3 px-3 font-semibold text-right">{copy.colQtyCompare}</th>
                        <th className="py-3 px-3 font-semibold">{copy.colSheetFile}</th>
                        <th className="py-3 px-3 font-semibold">{copy.colStatus}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredResults.map((res) => {
                        const matched = res.matchType !== 'not_found';
                        return (
                          <tr
                            key={res.id}
                            onClick={() => matched && handleJumpToSheetRow(res)}
                            className={`transition-colors ${
                              matched
                                ? 'hover:bg-emerald-50/70 cursor-pointer'
                                : 'bg-rose-50/30'
                            }`}
                          >
                            <td className="py-3 px-3 align-top">
                              <div className="font-display font-bold text-sm text-slate-950">
                                {res.factoryName}
                              </div>
                              {res.splitGroupCount > 1 && (
                                <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 mt-0.5">
                                  <GitFork className="w-3 h-3 shrink-0" />
                                  <span>
                                    {copy.splitLabel} · {res.splitOccurrenceIndex} of{' '}
                                    {res.splitGroupCount}
                                    {res.distinctFactoryCount > 1
                                      ? ` (${res.distinctFactoryCount} factories)`
                                      : ''}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 align-top font-mono">
                              <div className="font-semibold text-slate-900">
                                {matched ? res.factoryPg : res.sourcePg || '—'}
                              </div>
                              {matched && res.sourcePg && res.sourcePg !== res.factoryPg && (
                                <div className="text-[11px] text-slate-500">
                                  Src: {res.sourcePg}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 align-top font-mono font-semibold text-slate-950 tabular-nums">
                              {matched ? res.factoryPo : res.sourcePo || '—'}
                            </td>
                            <td className="py-3 px-3 align-top font-mono font-semibold text-cyan-900 tabular-nums">
                              {res.finalInsp || '—'}
                            </td>
                            <td className="py-3 px-3 align-top text-slate-700">
                              {matched ? res.factoryColor : res.sourceColor || '—'}
                            </td>
                            <td className="py-3 px-3 align-top text-right font-mono tabular-nums">
                              {matched ? (
                                <>
                                  <div className="font-bold text-slate-950">
                                    {(res.factoryQty ?? 0).toLocaleString()}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    Src: {res.sourceQty.toLocaleString()}
                                    {res.qtyDiff !== null && res.qtyDiff !== 0
                                      ? ` (${res.qtyDiff > 0 ? `+${res.qtyDiff.toLocaleString()}` : res.qtyDiff.toLocaleString()})`
                                      : ''}
                                  </div>
                                </>
                              ) : (
                                <div className="text-slate-600">
                                  Src: {res.sourceQty.toLocaleString()}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 align-top">
                              <div className="font-mono font-medium text-slate-800">
                                {res.sheetName}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                                {res.factoryFileName || '—'}
                              </div>
                            </td>
                            <td className="py-3 px-3 align-top whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
                                  res.matchType === 'exact_pg_po'
                                    ? 'bg-emerald-100 text-emerald-900'
                                    : res.matchType === 'po_diff_pg'
                                      ? 'bg-amber-100 text-amber-900'
                                      : 'bg-rose-100 text-rose-900'
                                }`}
                              >
                                {res.matchType === 'exact_pg_po'
                                  ? copy.statusExact
                                  : res.matchType === 'po_diff_pg'
                                    ? copy.statusDiffPg
                                    : copy.statusNotFound}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* MOBILE STACKED CARD VIEW (touch-friendly >= 44px) */}
              <div className="lg:hidden space-y-3">
                {filteredResults.map((res) => {
                  const matched = res.matchType !== 'not_found';
                  return (
                    <div
                      key={res.id}
                      onClick={() => matched && handleJumpToSheetRow(res)}
                      role={matched ? 'button' : undefined}
                      tabIndex={matched ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (matched && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleJumpToSheetRow(res);
                        }
                      }}
                      className={`rounded-xl border p-4 space-y-3 ${
                        matched
                          ? 'border-slate-200 bg-white active:bg-emerald-50/70 cursor-pointer'
                          : 'border-rose-200 bg-rose-50/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-display text-base font-bold text-slate-950">
                            {res.factoryName}
                          </div>
                          {res.splitGroupCount > 1 && (
                            <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 mt-0.5">
                              <GitFork className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                {copy.splitLabel} · {res.splitOccurrenceIndex} of{' '}
                                {res.splitGroupCount}
                              </span>
                            </div>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${
                            res.matchType === 'exact_pg_po'
                              ? 'bg-emerald-100 text-emerald-900'
                              : res.matchType === 'po_diff_pg'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-rose-100 text-rose-900'
                          }`}
                        >
                          {res.matchType === 'exact_pg_po'
                            ? copy.statusExact
                            : res.matchType === 'po_diff_pg'
                              ? copy.statusDiffPg
                              : copy.statusNotFound}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[11px] text-slate-500">{copy.colPo}</div>
                          <div className="font-mono font-bold text-slate-950 tabular-nums">
                            {matched ? res.factoryPo : res.sourcePo || '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">{copy.colPg}</div>
                          <div className="font-mono font-semibold text-slate-900">
                            {matched ? res.factoryPg : res.sourcePg || '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">{copy.colLoadingDate}</div>
                          <div className="font-mono font-semibold text-cyan-900 tabular-nums">
                            {res.finalInsp || '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">{copy.colColor}</div>
                          <div className="font-medium text-slate-800">
                            {matched ? res.factoryColor : res.sourceColor || '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">{copy.colQtyCompare}</div>
                          <div className="font-mono font-semibold text-slate-950 tabular-nums">
                            {matched
                              ? `${(res.factoryQty ?? 0).toLocaleString()} / ${res.sourceQty.toLocaleString()}`
                              : `0 / ${res.sourceQty.toLocaleString()}`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">{copy.colSheetFile}</div>
                          <div className="font-mono text-slate-800 truncate">
                            {res.sheetName} · {res.factoryFileName || '—'}
                          </div>
                        </div>
                      </div>

                      {matched && (
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-end text-xs font-semibold text-emerald-700 gap-1">
                          <Eye className="w-3.5 h-3.5" />
                          <span>{copy.jumpToSheetHint}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* FACTORY EXCEL SHEET VIEWER */}
        <section
          ref={viewerRef}
          aria-labelledby="viewer-heading"
          className="ct-surface rounded-2xl p-4 sm:p-6 space-y-4"
        >
          <div>
            <h2 id="viewer-heading" className="font-display text-lg font-bold text-slate-950">
              {copy.viewerTitle}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">{copy.viewerSubtitle}</p>
          </div>

          {workbooks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center text-xs sm:text-sm text-slate-600">
              {copy.viewerEmpty}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Factory Workbook Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {workbooks.map((wb) => (
                  <button
                    key={wb.id}
                    type="button"
                    onClick={() => {
                      setViewerFileId(wb.id);
                      setViewerSheetName(wb.sheets[0]?.sheetName || '');
                      setViewerHighlightedRows([]);
                    }}
                    className={`min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      activeViewerFile?.id === wb.id
                        ? 'border-emerald-600 bg-emerald-700 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-400'
                    }`}
                  >
                    {wb.factoryName} · {wb.fileName}
                  </button>
                ))}
              </div>

              {/* PG# Sheet Tabs inside Selected Workbook */}
              {activeViewerFile && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {activeViewerFile.sheets.map((s) => (
                    <button
                      key={s.sheetName}
                      type="button"
                      onClick={() => {
                        setViewerSheetName(s.sheetName);
                        setViewerHighlightedRows([]);
                      }}
                      className={`min-h-[44px] px-3 rounded-lg border text-xs font-mono font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                        activeViewerSheet?.sheetName === s.sheetName
                          ? 'border-cyan-600 bg-cyan-50 text-cyan-950'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white'
                      }`}
                    >
                      {s.sheetName} ({s.parsedRows.length})
                    </button>
                  ))}
                </div>
              )}

              {/* Sheet Grid */}
              {activeViewerSheet && (
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <tbody>
                        {activeViewerSheet.rawRows.map((cells, rIdx) => {
                          const isHighlighted = viewerHighlightedRows.includes(rIdx);
                          const isHeaderRow = rIdx === 0;
                          return (
                            <tr
                              key={rIdx}
                              ref={
                                isHighlighted && rIdx === viewerHighlightedRows[0]
                                  ? highlightedRowElRef
                                  : undefined
                              }
                              className={
                                isHighlighted
                                  ? 'bg-emerald-100 ring-2 ring-inset ring-emerald-600 font-semibold text-emerald-950'
                                  : isHeaderRow
                                    ? 'bg-slate-900 text-white font-semibold sticky top-0 z-10'
                                    : 'border-t border-slate-100 hover:bg-slate-50'
                              }
                            >
                              <td
                                className={`py-2 px-2.5 font-mono tabular-nums text-[11px] w-10 select-none ${
                                  isHeaderRow ? 'text-slate-300' : 'text-slate-400 bg-slate-50/70'
                                }`}
                              >
                                {rIdx + 1}
                              </td>
                              {cells.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="py-2 px-3 whitespace-nowrap font-mono tabular-nums"
                                >
                                  {cell || '—'}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* SHARE THIS WEBSITE STRIP */}
        <section
          aria-label="Share this website"
          className="ct-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-800">
              <Globe className="w-4 h-4 shrink-0" />
              <span>{copy.shareStripTitle}</span>
            </div>
            <div className="font-mono text-xs text-slate-600 truncate">{shareUrl}</div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyShareLink()}
              className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {linkCopied ? (
                <>
                  <Check className="w-4 h-4 text-emerald-700" />
                  <span className="text-emerald-800">{copy.shareCopiedBtn}</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-600" />
                  <span>{copy.shareCopyBtn}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              <span>{copy.shareNativeBtn}</span>
            </button>
          </div>
        </section>
      </main>

      {/* Bottom Footer with exact requested credit */}
      <footer className="relative z-10 border-t border-slate-200/80 bg-white/80 backdrop-blur-sm ct-safe-footer">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 text-xs text-slate-500">
          <div>
            {companyName} — Factory PG# &amp; PO Allocation Matcher ·{' '}
            <span className="font-mono">ALEX 1 · ALEX 3 · ALEX 5 · ALEX 12</span>
          </div>
          <div className="font-semibold text-slate-700 sm:text-right shrink-0">
            {copy.footerCredit}
          </div>
        </div>
      </footer>
    </div>
  );
}
