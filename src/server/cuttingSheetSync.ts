import type {
  DailyCuttingEntry,
  FactoryName,
  PlanningRecord,
} from '../shared/plannerTypes.ts';
import type { CuttingSheetSyncConfig } from '../shared/cuttingSheetTypes.ts';
import {
  applySyncedCuttingEntries,
  getWorkspaceState,
} from './workspaceStore.ts';
import { MAX_UPLOAD_BYTES, assertSafeExternalUrl } from './security.ts';
import {
  convertMasterPlanXlsxToCsv,
  detectFactoryHintFromText,
  importCuttingFileBufferCore,
  parseFlexibleSheetDate,
  parseOnlineCuttingSheetCsv,
  parseOnlineCuttingXlsxBuffer,
  parseSheetRowsMatrix,
  resolveSheetCsvUrl,
  runCuttingSheetSyncCore,
  type ParsedSheetResult,
  type SheetSyncRole,
} from './cuttingSheetCore.ts';

export {
  convertMasterPlanXlsxToCsv,
  detectFactoryHintFromText,
  parseFlexibleSheetDate,
  parseOnlineCuttingSheetCsv,
  parseOnlineCuttingXlsxBuffer,
  parseSheetRowsMatrix,
  resolveSheetCsvUrl,
};
export type { ParsedSheetResult, SheetSyncRole };

const nodeDeps = {
  getState: () => getWorkspaceState(),
  applySynced: (params: Parameters<typeof applySyncedCuttingEntries>[0]) =>
    applySyncedCuttingEntries(params),
  assertUrlSafe: (url: string) => assertSafeExternalUrl(url),
  maxUploadBytes: MAX_UPLOAD_BYTES,
};

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
  return runCuttingSheetSyncCore(params, nodeDeps);
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
  return importCuttingFileBufferCore(params, nodeDeps);
}
