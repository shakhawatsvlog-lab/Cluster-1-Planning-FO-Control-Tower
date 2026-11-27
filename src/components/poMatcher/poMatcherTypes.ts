export type PoMatcherLang = 'en' | 'bn';

export interface FactoryPoRow {
  id: string;
  fileId: string;
  fileName: string;
  factoryName: string;
  sheetName: string;
  rawRowIndex: number; // 0-based index in rawRows
  pgNumber: string;
  poNumber: string;
  color: string;
  qty: number;
  finalInsp: string;
}

export interface FactorySheetTab {
  sheetName: string;
  pgNormalized: string;
  headers: string[];
  rawRows: string[][];
  parsedRows: FactoryPoRow[];
}

export interface FactoryWorkbookFile {
  id: string;
  fileName: string;
  factoryName: string;
  sheets: FactorySheetTab[];
  totalRows: number;
  totalQty: number;
}

export interface SourceImageFile {
  id: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  rotationDeg: number;
  zoom: number;
  status: 'pending' | 'scanning' | 'done' | 'error';
  errorMessage?: string;
  extractedCount: number;
}

export interface SourcePoRecord {
  id: string;
  pgNumber: string;
  poNumber: string;
  color: string;
  qty: number;
  sourceLabel: string;
  sourceType: 'image' | 'excel' | 'manual';
}

export type MatchType = 'exact_pg_po' | 'po_diff_pg' | 'not_found';

export interface MatchedPoResult {
  id: string;
  sourceId: string;
  sourcePg: string;
  sourcePo: string;
  sourceColor: string;
  sourceQty: number;
  sourceLabel: string;
  matchType: MatchType;
  factoryFileId?: string;
  factoryFileName?: string;
  factoryName: string;
  sheetName: string;
  rawRowIndex?: number;
  matchedRowIndices: number[];
  factoryPg: string;
  factoryPo: string;
  factoryColor: string;
  factoryQty: number | null;
  qtyDiff: number | null;
  finalInsp: string;
  splitGroupCount: number;
  splitOccurrenceIndex: number;
  distinctFactoryCount: number;
}

export interface FactorySummaryMetric {
  factoryName: string;
  matchedLines: number;
  uniquePos: number;
  totalFactoryQty: number;
  earliestFinalInsp: string;
}

export interface PoMatcherCopy {
  portalBack: string;
  title: string;
  subtitle: string;
  navDataFiles: string;
  navSourceFile: string;
  navResultBox: string;
  navSheetViewer: string;
  loadSampleBtn: string;
  clearAllBtn: string;
  exportExcelBtn: string;
  step1Title: string;
  step1Hint: string;
  step1DropText: string;
  step1BrowseBtn: string;
  step1FilesCount: string;
  factoryNameLabel: string;
  viewWorkbookTip: string;
  removeTip: string;
  step2Title: string;
  step2Hint: string;
  step2DropText: string;
  step2PhotoBtn: string;
  step2ExcelBtn: string;
  ocrScanningBadge: string;
  ocrDoneBadge: string;
  ocrPendingBadge: string;
  ocrErrorBadge: string;
  zoomInTip: string;
  zoomOutTip: string;
  rotateTip: string;
  rescanBtn: string;
  sourceTableTitle: string;
  addRowBtn: string;
  quickLookupTitle: string;
  quickLookupHint: string;
  quickLookupBtn: string;
  pgLabel: string;
  poLabel: string;
  colorLabel: string;
  qtyLabel: string;
  startMatchBtn: string;
  rerunMatchBtn: string;
  matchingBusyBtn: string;
  step3Title: string;
  step3Subtitle: string;
  kpiTotalSource: string;
  kpiMatched: string;
  kpiNotFound: string;
  kpiMatchedQty: string;
  factorySummaryTitle: string;
  searchPlaceholder: string;
  allFactoriesOption: string;
  filterAll: string;
  filterMatched: string;
  filterNotFound: string;
  colFactory: string;
  colPg: string;
  colPo: string;
  colLoadingDate: string;
  colColor: string;
  colQtyCompare: string;
  colSheetFile: string;
  colStatus: string;
  statusExact: string;
  statusDiffPg: string;
  statusNotFound: string;
  splitLabel: string;
  jumpToSheetHint: string;
  emptyResultsTitle: string;
  emptyResultsDesc: string;
  viewerTitle: string;
  viewerSubtitle: string;
  viewerEmpty: string;
  shareStripTitle: string;
  shareCopyBtn: string;
  shareCopiedBtn: string;
  shareNativeBtn: string;
  footerCredit: string;
}

export const PO_MATCHER_COPY: Record<PoMatcherLang, PoMatcherCopy> = {
  en: {
    portalBack: 'Back to Portal',
    title: 'SheetLens — Factory PG# & PO Allocation Matcher',
    subtitle:
      'Match 5–15 factory Excel sheets against a buyer PO photo or Excel list to verify running Factory, Qty, Color, and Final insp. date.',
    navDataFiles: '1. Data Files',
    navSourceFile: '2. Source File',
    navResultBox: '3. Result Box',
    navSheetViewer: 'Sheet Viewer',
    loadSampleBtn: 'Load Sample Data',
    clearAllBtn: 'Clear All',
    exportExcelBtn: 'Export Results',
    step1Title: '1. Factory Data Files (5–15+ Excel Workbooks)',
    step1Hint:
      'Drop multiple .xlsx, .xls, or .csv workbooks. Auto-reads all PG# tabs, detects PO, Color, Qty, and Final insp., and fills merged PO cells.',
    step1DropText: 'Drop factory Excel files here or choose multiple files',
    step1BrowseBtn: 'Select Factory Excel Files',
    step1FilesCount: 'Uploaded Factory Files',
    factoryNameLabel: 'Factory Name',
    viewWorkbookTip: 'Inspect workbook in Sheet Viewer',
    removeTip: 'Remove',
    step2Title: '2. Source File (JPG Photo, Excel, or Quick Lookup)',
    step2Hint:
      'Upload a JPG/PNG slip photo (AI OCR reads leading-zero POs) or a Source Excel/CSV list, then edit or add items below.',
    step2DropText: 'Drop Source JPG/PNG photo or Source Excel (.xlsx/.xls/.csv)',
    step2PhotoBtn: 'Upload Photo / Camera',
    step2ExcelBtn: 'Upload Source Excel',
    ocrScanningBadge: 'Reading Photo...',
    ocrDoneBadge: 'OCR Ready',
    ocrPendingBadge: 'Queued for OCR',
    ocrErrorBadge: 'OCR Error',
    zoomInTip: 'Zoom In',
    zoomOutTip: 'Zoom Out',
    rotateTip: 'Rotate 90°',
    rescanBtn: 'Re-scan',
    sourceTableTitle: 'Extracted & Editable Source PO List',
    addRowBtn: 'Add Empty Row',
    quickLookupTitle: 'Quick Lookup (PG# & PO)',
    quickLookupHint: 'Type any PG# or PO# directly to add and match right away.',
    quickLookupBtn: 'Add & Match',
    pgLabel: 'PG#',
    poLabel: 'PO#',
    colorLabel: 'Color',
    qtyLabel: 'Qty',
    startMatchBtn: 'Start Matching · Find Factory',
    rerunMatchBtn: 'Re-Run Matching',
    matchingBusyBtn: 'Scanning & Matching...',
    step3Title: '3. Matched Factory Result Box',
    step3Subtitle:
      'Shows every matched factory occurrence separately (including POs split across 2+ factories). Tap any matched row to jump to Sheet Viewer.',
    kpiTotalSource: 'Total Source POs',
    kpiMatched: 'Matched in Factory',
    kpiNotFound: 'Not Found',
    kpiMatchedQty: 'Total Matched Qty',
    factorySummaryTitle: 'Factory-Wise Summary',
    searchPlaceholder: 'Search PO, PG#, Factory, Color, Final insp., or Sheet...',
    allFactoriesOption: 'All Factories',
    filterAll: 'All Results',
    filterMatched: 'Matched Only',
    filterNotFound: 'Not Found',
    colFactory: 'Factory & Split',
    colPg: 'PG#',
    colPo: 'PO Number',
    colLoadingDate: 'Loading Date (Final insp.)',
    colColor: 'Color',
    colQtyCompare: 'Factory Qty / Source Qty',
    colSheetFile: 'Sheet Tab & File',
    colStatus: 'Match Status',
    statusExact: 'Matched (PG# + PO)',
    statusDiffPg: 'PO Match (Diff PG#)',
    statusNotFound: 'Not Found',
    splitLabel: 'Split PO',
    jumpToSheetHint: 'View in Sheet',
    emptyResultsTitle: 'Ready to Match Factory Allocations',
    emptyResultsDesc:
      'Upload your factory Excel workbooks in Step 1, add a Source photo/Excel or Quick Lookup in Step 2, then press "Start Matching · Find Factory".',
    viewerTitle: 'Factory Excel Sheet Viewer',
    viewerSubtitle:
      'Inspect raw factory tabs and verify matched PO rows highlighted directly in the sheet.',
    viewerEmpty: 'Upload at least one Factory Excel workbook in Step 1 to browse its PG# tabs here.',
    shareStripTitle: 'Share This Website',
    shareCopyBtn: 'Copy Link',
    shareCopiedBtn: 'Copied!',
    shareNativeBtn: 'Share',
    footerCredit: 'Created by Shakhawat Hossain (Factory Planner-Central Planning)',
  },
  bn: {
    portalBack: 'পোর্টালে ফিরুন',
    title: 'SheetLens — ফ্যাক্টরি PG# ও PO অ্যালোকেশন ম্যাচিং',
    subtitle:
      '৫–১৫টি ফ্যাক্টরি এক্সেল শিটের সাথে সোর্স JPG ছবি বা এক্সেল লিস্ট মিলিয়ে কোন ফ্যাক্টরিতে কোন PO, Qty ও Final insp. তারিখ আছে তা যাচাই করুন।',
    navDataFiles: '১. ডেটা ফাইল',
    navSourceFile: '২. সোর্স ফাইল',
    navResultBox: '৩. রেজাল্ট বক্স',
    navSheetViewer: 'শিট ভিউয়ার',
    loadSampleBtn: 'স্যাম্পল ডেটা লোড',
    clearAllBtn: 'সব মুছুন',
    exportExcelBtn: 'এক্সেল ডাউনলোড',
    step1Title: '১. ফ্যাক্টরি ডেটা ফাইল (৫–১৫+ এক্সেল ফাইল)',
    step1Hint:
      'একাধিক .xlsx, .xls বা .csv ফাইল আপলোড করুন। সব PG# ট্যাব, PO, Color, Qty ও Final insp. অটো রিড হবে এবং মার্জড PO সেল পূরণ হবে।',
    step1DropText: 'ফ্যাক্টরি এক্সেল ফাইল এখানে ড্রপ করুন বা সিলেক্ট করুন',
    step1BrowseBtn: 'ফ্যাক্টরি এক্সেল সিলেক্ট করুন',
    step1FilesCount: 'আপলোডকৃত ফ্যাক্টরি ফাইল',
    factoryNameLabel: 'ফ্যাক্টরির নাম',
    viewWorkbookTip: 'শিট ভিউয়ারে দেখুন',
    removeTip: 'বাদ দিন',
    step2Title: '২. সোর্স ফাইল (JPG ছবি, এক্সেল বা কুইক লুকআপ)',
    step2Hint:
      'PO ছবির JPG/PNG আপলোড করুন (AI OCR সামনের শূন্যসহ PO পড়বে) অথবা সোর্স এক্সেল/CSV দিন এবং নিচে এডিট করুন।',
    step2DropText: 'সোর্স JPG/PNG ছবি বা সোর্স এক্সেল (.xlsx/.xls/.csv) দিন',
    step2PhotoBtn: 'ছবি / ক্যামেরা আপলোড',
    step2ExcelBtn: 'সোর্স এক্সেল আপলোড',
    ocrScanningBadge: 'ছবি পড়া হচ্ছে...',
    ocrDoneBadge: 'OCR সম্পন্ন',
    ocrPendingBadge: 'স্ক্যানের অপেক্ষায়',
    ocrErrorBadge: 'OCR ত্রুটি',
    zoomInTip: 'জুম ইন',
    zoomOutTip: 'জুম আউট',
    rotateTip: '৯০° ঘোরান',
    rescanBtn: 'আবার স্ক্যান',
    sourceTableTitle: 'প্রাপ্ত ও এডিটযোগ্য সোর্স PO তালিকা',
    addRowBtn: 'নতুন সারি যোগ',
    quickLookupTitle: 'কুইক লুকআপ (PG# ও PO)',
    quickLookupHint: 'সরাসরি PG# বা PO# লিখে এখনই যোগ ও ম্যাচ করুন।',
    quickLookupBtn: 'যোগ ও ম্যাচ করুন',
    pgLabel: 'PG#',
    poLabel: 'PO#',
    colorLabel: 'রঙ (Color)',
    qtyLabel: 'পরিমাণ (Qty)',
    startMatchBtn: 'ম্যাচিং শুরু · ফ্যাক্টরি খুঁজুন',
    rerunMatchBtn: 'আবার ম্যাচিং চালান',
    matchingBusyBtn: 'স্ক্যান ও ম্যাচিং চলছে...',
    step3Title: '৩. ম্যাচ হওয়া ফ্যাক্টরি রেজাল্ট বক্স',
    step3Subtitle:
      'একই PO একাধিক ফ্যাক্টরিতে ভাগ থাকলে সবগুলো আলাদাভাবে দেখাবে। যেকোনো ম্যাচ রো-তে ক্লিক করলে শিট ভিউয়ারে নিয়ে যাবে।',
    kpiTotalSource: 'মোট সোর্স PO',
    kpiMatched: 'ফ্যাক্টরিতে পাওয়া গেছে',
    kpiNotFound: 'পাওয়া যায়নি',
    kpiMatchedQty: 'মোট ম্যাচ Qty',
    factorySummaryTitle: 'ফ্যাক্টরি-ভিত্তিক সারসংক্ষেপ',
    searchPlaceholder: 'PO, PG#, ফ্যাক্টরি, Color, Final insp. বা শিট খুঁজুন...',
    allFactoriesOption: 'সব ফ্যাক্টরি',
    filterAll: 'সব ফলাফল',
    filterMatched: 'শুধু ম্যাচকৃত',
    filterNotFound: 'পাওয়া যায়নি',
    colFactory: 'ফ্যাক্টরি ও স্প্লিট',
    colPg: 'PG#',
    colPo: 'PO নম্বর',
    colLoadingDate: 'লোডিং তারিখ (Final insp.)',
    colColor: 'Color',
    colQtyCompare: 'ফ্যাক্টরি Qty / সোর্স Qty',
    colSheetFile: 'শিট ট্যাব ও ফাইল',
    colStatus: 'স্ট্যাটাস',
    statusExact: 'ম্যাচ (PG# + PO)',
    statusDiffPg: 'PO ম্যাচ (ভিন্ন PG#)',
    statusNotFound: 'পাওয়া যায়নি',
    splitLabel: 'স্প্লিট PO',
    jumpToSheetHint: 'শিটে দেখুন',
    emptyResultsTitle: 'ফ্যাক্টরি অ্যালোকেশন ম্যাচ করার জন্য প্রস্তুত',
    emptyResultsDesc:
      'ধাপ ১-এ ফ্যাক্টরি এক্সেল, ধাপ ২-এ সোর্স ছবি/এক্সেল বা কুইক লুকআপ দিয়ে "ম্যাচিং শুরু · ফ্যাক্টরি খুঁজুন" বাটনে চাপ দিন।',
    viewerTitle: 'ফ্যাক্টরি এক্সেল শিট ভিউয়ার',
    viewerSubtitle:
      'মূল এক্সেল ট্যাব দেখুন এবং ম্যাচ হওয়া রো সরাসরি হাইলাইট অবস্থায় যাচাই করুন।',
    viewerEmpty: 'এখানে ট্যাব দেখতে ধাপ ১-এ অন্তত একটি ফ্যাক্টরি এক্সেল আপলোড করুন।',
    shareStripTitle: 'ওয়েবসাইটটি শেয়ার করুন',
    shareCopyBtn: 'লিংক কপি',
    shareCopiedBtn: 'কপি হয়েছে!',
    shareNativeBtn: 'শেয়ার',
    footerCredit: 'Created by Shakhawat Hossain (Factory Planner-Central Planning)',
  },
};
