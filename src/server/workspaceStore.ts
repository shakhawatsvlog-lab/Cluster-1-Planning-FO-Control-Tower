import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  DailyCuttingEntry,
  FactoryName,
  MasterPlanMeta,
  PlanningRecord,
  PublicFoNeededResponse,
  PublicMasterPlanResponse,
} from '../shared/plannerTypes.ts';
import type {
  ReminderDeliveryLog,
  ReminderRecipient,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
} from '../shared/reminderTypes.ts';
import type { WebsiteControlConfig } from '../shared/controlPanelTypes.ts';
import type {
  CuttingSheetSyncConfig,
  CuttingSheetSyncLog,
} from '../shared/cuttingSheetTypes.ts';
import {
  appendDeliveryLogToState,
  applyOutputQtyPatchToState,
  applyPackingQtyPatchToState,
  applySnapshotRestoreToState,
  applySyncedCuttingToState,
  buildInitialWorkspaceData,
  buildSafetyBackupPayload,
  createPasswordRecord,
  getPublicFoNeededFromState,
  getPublicMasterPlanFromState,
  getPublicWorkspaceFromState,
  getSyncVersionFromState,
  hydrateWorkspaceData,
  loadDefaultMasterPlanFromString,
  normalizeRecords,
  verifyPasswordAgainstAuth,
  type AdminAuthStored,
  type PersistedWorkspaceData,
  type RecordSheetPatch,
  type SmtpStoredConfig,
  type SyncVersionSnapshot,
} from './workspaceLogic.ts';

export type {
  AdminAuthStored,
  PersistedWorkspaceData,
  RecordSheetPatch,
  SmtpStoredConfig,
  SyncVersionSnapshot,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const MASTER_CSV_PATH = path.resolve(
  ROOT_DIR,
  'public/assets/aistudio/11-19_updated_a06c9227.csv'
);
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const BACKUP_DIR = path.resolve(DATA_DIR, 'backups');
const STATE_FILE_PATH = path.resolve(DATA_DIR, 'workspace-state.json');

function getInitialEnvAdminOptions() {
  return {
    initialAdminPassword:
      process.env.ADMIN_PASSWORD || process.env.ADMIN_PANEL_DEFAULT_PASSWORD || '',
    recoveryEmail: process.env.ADMIN_RECOVERY_EMAIL || '',
  };
}

export function loadDefaultMasterPlan() {
  const csvContent = fs.existsSync(MASTER_CSV_PATH)
    ? fs.readFileSync(MASTER_CSV_PATH, 'utf8')
    : undefined;
  return loadDefaultMasterPlanFromString(csvContent);
}

let cachedState: PersistedWorkspaceData | null = null;

function writeStateToDisk(state: PersistedWorkspaceData): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = `${STATE_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, STATE_FILE_PATH);
  } catch (err) {
    console.error('Failed to persist workspace-state.json:', err);
  }
}

function saveSafetyBackupSnapshot(reason: 'reset' | 'restore', state: PersistedWorkspaceData): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.resolve(BACKUP_DIR, `pre-${reason}-${stamp}.json`);
    const safeSnapshot = buildSafetyBackupPayload(state);
    fs.writeFileSync(filePath, JSON.stringify(safeSnapshot, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    for (const old of files.slice(15)) {
      fs.unlinkSync(path.resolve(BACKUP_DIR, old));
    }
  } catch (err) {
    console.error('Failed to create pre-change safety snapshot:', err);
  }
}

export function getWorkspaceState(): PersistedWorkspaceData {
  if (cachedState) {
    return cachedState;
  }

  const envOpts = getInitialEnvAdminOptions();

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceData>;
      const hydrated = hydrateWorkspaceData(parsed, envOpts);
      if (hydrated) {
        cachedState = hydrated.state;
        if (hydrated.needsSave) {
          writeStateToDisk(cachedState);
        }
        return cachedState;
      }
    }
  } catch (err) {
    console.error('Failed to read persisted workspace-state.json, resetting to master CSV:', err);
  }

  const csvContent = fs.existsSync(MASTER_CSV_PATH)
    ? fs.readFileSync(MASTER_CSV_PATH, 'utf8')
    : undefined;
  cachedState = buildInitialWorkspaceData({
    csvContent,
    initialAdminPassword: envOpts.initialAdminPassword,
    recoveryEmail: envOpts.recoveryEmail,
  });
  writeStateToDisk(cachedState);
  return cachedState;
}

export function getSyncVersionSnapshot(): SyncVersionSnapshot {
  return getSyncVersionFromState(getWorkspaceState());
}

export function getPublicWorkspaceState(isAdmin = false) {
  return getPublicWorkspaceFromState(getWorkspaceState(), isAdmin);
}

export function getPublicMasterPlanState(factoryFilter?: FactoryName): PublicMasterPlanResponse {
  return getPublicMasterPlanFromState(getWorkspaceState(), factoryFilter);
}

export function getPublicFoNeededState(
  factoryFilter?: FactoryName | null
): PublicFoNeededResponse {
  return getPublicFoNeededFromState(getWorkspaceState(), factoryFilter);
}

export function isAdminPasswordConfigured(): boolean {
  const auth = getWorkspaceState().adminAuth;
  return Boolean(auth?.passwordHash && auth?.passwordSalt);
}

export function getAdminAuthUpdatedAtIso(): string | null {
  return getWorkspaceState().adminAuth?.updatedAtIso ?? null;
}

export function verifyAdminPassword(candidate: string): boolean {
  return verifyPasswordAgainstAuth(candidate, getWorkspaceState().adminAuth);
}

export function updateAdminPassword(newPassword: string): void {
  const current = getWorkspaceState();
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    adminAuth: createPasswordRecord(newPassword),
  };
  writeStateToDisk(cachedState);
}

export function bootstrapInitialAdminPassword(
  newPassword: string,
  recoveryEmail?: string
): PersistedWorkspaceData {
  if (isAdminPasswordConfigured()) {
    throw new Error('Admin password is already configured.');
  }
  const current = getWorkspaceState();
  const nextSiteConfig =
    recoveryEmail && recoveryEmail.trim()
      ? { ...current.siteConfig, recoveryEmail: recoveryEmail.trim().toLowerCase() }
      : current.siteConfig;
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    siteConfig: nextSiteConfig,
    adminAuth: createPasswordRecord(newPassword),
  };
  writeStateToDisk(cachedState);
  return cachedState;
}

export function getSiteConfig(): WebsiteControlConfig {
  return getWorkspaceState().siteConfig;
}

export function updateSiteConfig(patch: Partial<WebsiteControlConfig>): WebsiteControlConfig {
  const current = getWorkspaceState();
  const nextSiteConfig: WebsiteControlConfig = {
    ...current.siteConfig,
    ...patch,
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    siteConfig: nextSiteConfig,
  };
  writeStateToDisk(cachedState);
  return nextSiteConfig;
}

export function updatePlanningWorkspace(patch: {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  hasCustomEdits?: boolean;
}): PersistedWorkspaceData {
  const current = getWorkspaceState();
  const next: PersistedWorkspaceData = {
    ...current,
    meta: patch.meta,
    records: normalizeRecords(patch.records),
    cuttingEntries: patch.cuttingEntries,
    referenceDateIso: patch.referenceDateIso || current.referenceDateIso,
    hasCustomEdits: patch.hasCustomEdits ?? true,
    updatedAtIso: new Date().toISOString(),
  };
  cachedState = next;
  writeStateToDisk(next);
  return next;
}

export function resetPlanningWorkspace(): PersistedWorkspaceData {
  const current = getWorkspaceState();
  saveSafetyBackupSnapshot('reset', current);
  const defaults = loadDefaultMasterPlan();
  const next: PersistedWorkspaceData = {
    ...current,
    meta: defaults.meta,
    records: defaults.records,
    cuttingEntries: [],
    hasCustomEdits: false,
    updatedAtIso: new Date().toISOString(),
  };
  cachedState = next;
  writeStateToDisk(next);
  return next;
}

export function restoreWorkspaceSnapshot(snapshot: {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries?: DailyCuttingEntry[];
  referenceDateIso?: string;
  reminders?: Partial<ReminderWorkspaceState>;
  siteConfig?: Partial<WebsiteControlConfig>;
  cuttingSheetSync?: Partial<CuttingSheetSyncConfig>;
}): PersistedWorkspaceData {
  const current = getWorkspaceState();
  saveSafetyBackupSnapshot('restore', current);
  const next = applySnapshotRestoreToState(current, snapshot);
  cachedState = next;
  writeStateToDisk(next);
  return next;
}

export function updateCuttingSheetSyncConfig(
  patch: Partial<CuttingSheetSyncConfig>
): CuttingSheetSyncConfig {
  const current = getWorkspaceState();
  const nextSync: CuttingSheetSyncConfig = {
    ...current.cuttingSheetSync,
    ...patch,
    factoryUrls:
      patch.factoryUrls !== undefined
        ? { ...patch.factoryUrls }
        : { ...current.cuttingSheetSync.factoryUrls },
    outputFactoryUrls:
      patch.outputFactoryUrls !== undefined
        ? { ...patch.outputFactoryUrls }
        : { ...(current.cuttingSheetSync.outputFactoryUrls ?? {}) },
    packingFactoryUrls:
      patch.packingFactoryUrls !== undefined
        ? { ...patch.packingFactoryUrls }
        : { ...(current.cuttingSheetSync.packingFactoryUrls ?? {}) },
    factoryStatuses:
      patch.factoryStatuses !== undefined
        ? { ...patch.factoryStatuses }
        : { ...(current.cuttingSheetSync.factoryStatuses ?? {}) },
    logs: patch.logs !== undefined ? patch.logs : current.cuttingSheetSync.logs,
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    cuttingSheetSync: nextSync,
  };
  writeStateToDisk(cachedState);
  return nextSync;
}

export function updateRecordsOutputQty(
  recordIds: string[],
  outputQty: number | null
): { updatedCount: number; updatedAtIso: string; records: PlanningRecord[] } {
  const current = getWorkspaceState();
  const res = applyOutputQtyPatchToState(current, recordIds, outputQty);
  if (res.updatedCount > 0) {
    cachedState = res.nextState;
    writeStateToDisk(cachedState);
  }
  return {
    updatedCount: res.updatedCount,
    updatedAtIso: res.updatedAtIso,
    records: res.records,
  };
}

export function updateRecordsPackingQty(
  recordIds: string[],
  packingQty: number | null
): { updatedCount: number; updatedAtIso: string; records: PlanningRecord[] } {
  const current = getWorkspaceState();
  const res = applyPackingQtyPatchToState(current, recordIds, packingQty);
  if (res.updatedCount > 0) {
    cachedState = res.nextState;
    writeStateToDisk(cachedState);
  }
  return {
    updatedCount: res.updatedCount,
    updatedAtIso: res.updatedAtIso,
    records: res.records,
  };
}

export function applySyncedCuttingEntries(params: {
  syncedEntries?: DailyCuttingEntry[];
  replaceSheetEntries: boolean;
  scopedFactories?: FactoryName[];
  recordUpdates?: RecordSheetPatch[];
  syncPatch: Partial<CuttingSheetSyncConfig>;
  logEntry?: CuttingSheetSyncLog;
}): PersistedWorkspaceData {
  const current = getWorkspaceState();
  cachedState = applySyncedCuttingToState(current, params);
  writeStateToDisk(cachedState);
  return cachedState;
}

export function updateReminderSchedule(
  patch: Partial<ReminderScheduleConfig>
): ReminderWorkspaceState {
  const current = getWorkspaceState();
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    schedule: {
      ...current.reminders.schedule,
      ...patch,
    },
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  };
  writeStateToDisk(cachedState);
  return nextReminders;
}

export function addReminderRecipient(recipient: ReminderRecipient): ReminderWorkspaceState {
  const current = getWorkspaceState();
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    recipients: [recipient, ...current.reminders.recipients],
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  };
  writeStateToDisk(cachedState);
  return nextReminders;
}

export function updateReminderRecipient(
  id: string,
  patch: Partial<ReminderRecipient>
): ReminderWorkspaceState {
  const current = getWorkspaceState();
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    recipients: current.reminders.recipients.map((r) =>
      r.id === id ? { ...r, ...patch } : r
    ),
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  };
  writeStateToDisk(cachedState);
  return nextReminders;
}

export function deleteReminderRecipient(id: string): ReminderWorkspaceState {
  const current = getWorkspaceState();
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    recipients: current.reminders.recipients.filter((r) => r.id !== id),
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  };
  writeStateToDisk(cachedState);
  return nextReminders;
}

export function appendReminderDeliveryLog(log: ReminderDeliveryLog): ReminderWorkspaceState {
  const current = getWorkspaceState();
  cachedState = appendDeliveryLogToState(current, log);
  writeStateToDisk(cachedState);
  return cachedState.reminders;
}

export function getStoredSmtpConfig(): SmtpStoredConfig | null {
  return getWorkspaceState().smtpConfig;
}

export function saveStoredSmtpConfig(config: SmtpStoredConfig | null): void {
  const current = getWorkspaceState();
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    smtpConfig: config,
  };
  writeStateToDisk(cachedState);
}
