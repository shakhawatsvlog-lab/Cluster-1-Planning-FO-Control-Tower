import type { FactoryName } from './plannerTypes.ts';

export type CuttingSheetSyncMode = 'auto' | 'daily_rows' | 'cumulative_pg';

export type FactorySheetUrlMap = Partial<Record<FactoryName, string>>;

export interface FactorySyncStatus {
  status: 'Idle' | 'Success' | 'Error';
  lastSyncedAtIso: string | null;
  entriesCount: number;
  totalQty: number;
  message: string;
}

export type FactorySyncStatusMap = Partial<Record<FactoryName, FactorySyncStatus>>;

export interface CuttingSheetSyncLog {
  id: string;
  syncedAtIso: string;
  trigger: 'Auto' | 'Manual' | 'Upload';
  status: 'Updated' | 'Up to Date' | 'Error';
  matchedRows: number;
  unmatchedCount: number;
  totalQty: number;
  message: string;
  sampleUnmatched?: string[];
}

export interface CuttingSheetSyncConfig {
  enabled: boolean;
  sheetUrl: string;
  factoryUrls: FactorySheetUrlMap;
  outputSheetUrl: string;
  outputFactoryUrls: FactorySheetUrlMap;
  packingSheetUrl: string;
  packingFactoryUrls: FactorySheetUrlMap;
  factoryStatuses: FactorySyncStatusMap;
  syncMode: CuttingSheetSyncMode;
  intervalMinutes: number;
  lastCheckedAtIso: string | null;
  lastUpdatedAtIso: string | null;
  lastStatus: 'Idle' | 'Success' | 'Error';
  lastMessage: string;
  lastContentHash: string;
  lastMatchedCount: number;
  lastUnmatchedCount: number;
  lastTotalQty: number;
  lastOutputMatchedCount?: number;
  lastOutputTotalQty?: number;
  lastPackingMatchedCount?: number;
  lastPackingTotalQty?: number;
  logs: CuttingSheetSyncLog[];
}

export const DEFAULT_CUTTING_SHEET_CONFIG: CuttingSheetSyncConfig = {
  enabled: false,
  sheetUrl: '',
  factoryUrls: {},
  outputSheetUrl: '',
  outputFactoryUrls: {},
  packingSheetUrl: '',
  packingFactoryUrls: {},
  factoryStatuses: {},
  syncMode: 'auto',
  intervalMinutes: 60,
  lastCheckedAtIso: null,
  lastUpdatedAtIso: null,
  lastStatus: 'Idle',
  lastMessage: 'No online cutting sheet linked yet.',
  lastContentHash: '',
  lastMatchedCount: 0,
  lastUnmatchedCount: 0,
  lastTotalQty: 0,
  lastOutputMatchedCount: 0,
  lastOutputTotalQty: 0,
  lastPackingMatchedCount: 0,
  lastPackingTotalQty: 0,
  logs: [],
};

export const CUTTING_SYNC_INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every 1 hour (Recommended)' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Once Daily (Every 24 hours)' },
];
