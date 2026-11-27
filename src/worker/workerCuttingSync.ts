import type { Buffer } from 'node:buffer';
import type { FactoryName } from '../shared/plannerTypes.ts';
import {
  importCuttingFileBufferCore,
  runCuttingSheetSyncCore,
  type CuttingSheetSyncDeps,
} from '../server/cuttingSheetCore.ts';
import type { WorkerEnv } from './cfTypes.ts';
import { applySyncedCuttingDataD1, getWorkspaceStateD1 } from './d1Store.ts';
import { MAX_UPLOAD_BYTES, assertSafeExternalUrlWorker } from './workerSecurity.ts';

function buildWorkerSyncDeps(env: WorkerEnv): CuttingSheetSyncDeps {
  return {
    getState: () => getWorkspaceStateD1(env),
    applySynced: (params) => applySyncedCuttingDataD1(env, params),
    assertUrlSafe: assertSafeExternalUrlWorker,
    maxUploadBytes: MAX_UPLOAD_BYTES,
  };
}

export async function runCuttingSheetSyncWorker(
  env: WorkerEnv,
  params: { trigger: 'Auto' | 'Manual'; force?: boolean }
) {
  return runCuttingSheetSyncCore(params, buildWorkerSyncDeps(env));
}

export async function importCuttingFileBufferWorker(
  env: WorkerEnv,
  params: {
    fileName: string;
    buffer?: Buffer;
    csvText?: string;
    defaultFactory?: FactoryName | null;
  }
) {
  return importCuttingFileBufferCore(params, buildWorkerSyncDeps(env));
}

export async function runScheduledCuttingSheetCheckWorker(env: WorkerEnv): Promise<void> {
  const cfg = (await getWorkspaceStateD1(env)).cuttingSheetSync;
  if (!cfg.enabled) return;
  const hasUrl =
    Boolean(cfg.sheetUrl.trim()) ||
    Boolean((cfg.outputSheetUrl || '').trim()) ||
    Boolean((cfg.packingSheetUrl || '').trim()) ||
    Object.values(cfg.factoryUrls || {}).some((v) => typeof v === 'string' && Boolean(v.trim())) ||
    Object.values(cfg.outputFactoryUrls || {}).some(
      (v) => typeof v === 'string' && Boolean(v.trim())
    ) ||
    Object.values(cfg.packingFactoryUrls || {}).some(
      (v) => typeof v === 'string' && Boolean(v.trim())
    );
  if (!hasUrl) return;

  const intervalMs = Math.max(1, cfg.intervalMinutes || 5) * 60_000;
  const elapsedMs = cfg.lastCheckedAtIso
    ? Date.now() - Date.parse(cfg.lastCheckedAtIso)
    : Infinity;
  if (Number.isFinite(elapsedMs) && elapsedMs < intervalMs) return;

  await runCuttingSheetSyncWorker(env, { trigger: 'Auto', force: false });
}
