import type { DailyCuttingEntry, FactoryName, MasterPlanMeta, PlanningRecord } from '../shared/plannerTypes.ts';
import type {
  CuttingSheetLinkRole,
  CuttingSheetLinkScope,
  CuttingSheetSyncConfig,
  CuttingSheetSyncLog,
} from '../shared/cuttingSheetTypes.ts';
import type {
  ReminderDeliveryLog,
  ReminderRecipient,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
} from '../shared/reminderTypes.ts';
import type { WebsiteControlConfig } from '../shared/controlPanelTypes.ts';
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
  hasConfiguredSheetLinks,
  hydrateWorkspaceData,
  normalizeRecords,
  removeCuttingSheetLinkFromConfig,
  verifyPasswordAgainstAuth,
  type PersistedWorkspaceData,
  type RecordSheetPatch,
  type SmtpStoredConfig,
  type SyncVersionSnapshot,
} from '../server/workspaceLogic.ts';
import type { D1Database, WorkerEnv } from './cfTypes.ts';

const WORKSPACE_ROW_ID = 'primary';

export interface PendingPasswordOtpRecord {
  codeHash: string;
  salt: string;
  expiresAt: number;
  attempts: number;
  targetEmail: string;
}

const initializedDbs = new WeakSet<D1Database>();

export async function ensureD1Schema(db: D1Database): Promise<void> {
  if (initializedDbs.has(db)) return;
  try {
    await db.batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS workspace_state (
          id TEXT PRIMARY KEY,
          data_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS workspace_backups (
          id TEXT PRIMARY KEY,
          reason TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`
      ),
      db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_backups_created
         ON workspace_backups (created_at DESC)`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS admin_otp (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          code_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          target_email TEXT NOT NULL
        )`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS revoked_sessions (
          sid TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        )`
      ),
      db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_revoked_sessions_exp
         ON revoked_sessions (expires_at)`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS login_attempts (
          ip TEXT PRIMARY KEY,
          failures INTEGER NOT NULL DEFAULT 0,
          window_start INTEGER NOT NULL,
          locked_until INTEGER NOT NULL DEFAULT 0
        )`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS rate_limits (
          bucket_key TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          reset_at INTEGER NOT NULL
        )`
      ),
    ]);
    initializedDbs.add(db);
  } catch (err) {
    initializedDbs.delete(db);
    throw err;
  }
}

async function writeSafetyBackupD1(
  db: D1Database,
  state: PersistedWorkspaceData,
  reason: string
): Promise<void> {
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, '-').toLowerCase().slice(0, 48) || 'backup';
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${safeReason}-${Math.random().toString(36).slice(2, 7)}`;
  const payload = JSON.stringify(buildSafetyBackupPayload(state));
  await db
    .prepare(
      `INSERT INTO workspace_backups (id, reason, payload_json, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, safeReason, payload, createdAt)
    .run();

  await db
    .prepare(
      `DELETE FROM workspace_backups
       WHERE id NOT IN (
         SELECT id FROM workspace_backups
         ORDER BY created_at DESC
         LIMIT 15
       )`
    )
    .run();
}

export async function saveWorkspaceStateD1(
  env: WorkerEnv,
  state: PersistedWorkspaceData,
  safetyReason?: string
): Promise<void> {
  await ensureD1Schema(env.DB);
  if (safetyReason) {
    try {
      const existing = await env.DB.prepare(
        `SELECT data_json FROM workspace_state WHERE id = ?`
      )
        .bind(WORKSPACE_ROW_ID)
        .first<{ data_json: string }>();
      if (existing?.data_json) {
        const parsedPrev = JSON.parse(existing.data_json) as PersistedWorkspaceData;
        if (parsedPrev?.records?.length) {
          await writeSafetyBackupD1(env.DB, parsedPrev, safetyReason);
        }
      }
    } catch {
      // Do not fail primary save if safety snapshot insert fails
    }
  }

  const serialized = JSON.stringify(state);
  await env.DB.prepare(
    `INSERT INTO workspace_state (id, data_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data_json = excluded.data_json,
       updated_at = excluded.updated_at`
  )
    .bind(WORKSPACE_ROW_ID, serialized, state.updatedAtIso)
    .run();
}

export async function getWorkspaceStateD1(env: WorkerEnv): Promise<PersistedWorkspaceData> {
  await ensureD1Schema(env.DB);
  const row = await env.DB.prepare(
    `SELECT data_json FROM workspace_state WHERE id = ?`
  )
    .bind(WORKSPACE_ROW_ID)
    .first<{ data_json: string }>();

  if (row?.data_json) {
    try {
      const parsed = JSON.parse(row.data_json) as Partial<PersistedWorkspaceData>;
      const hydrated = hydrateWorkspaceData(parsed, {
        initialAdminPassword: env.ADMIN_PASSWORD,
        recoveryEmail: env.ADMIN_RECOVERY_EMAIL,
      });
      if (hydrated) {
        if (hydrated.needsSave) {
          await saveWorkspaceStateD1(env, hydrated.state);
        }
        return hydrated.state;
      }
    } catch (err) {
      console.error('Failed to parse workspace_state row in D1:', err);
    }
  }

  const initial = buildInitialWorkspaceData({
    initialAdminPassword: env.ADMIN_PASSWORD,
    recoveryEmail: env.ADMIN_RECOVERY_EMAIL,
  });
  await saveWorkspaceStateD1(env, initial);
  return initial;
}

export async function getSyncVersionSnapshotD1(env: WorkerEnv): Promise<SyncVersionSnapshot> {
  const state = await getWorkspaceStateD1(env);
  return getSyncVersionFromState(state);
}

export async function getPublicWorkspaceStateD1(env: WorkerEnv, isAdmin = false) {
  const state = await getWorkspaceStateD1(env);
  return getPublicWorkspaceFromState(state, isAdmin);
}

export async function getPublicMasterPlanStateD1(env: WorkerEnv, factoryFilter?: FactoryName) {
  const state = await getWorkspaceStateD1(env);
  return getPublicMasterPlanFromState(state, factoryFilter);
}

export async function getPublicFoNeededStateD1(
  env: WorkerEnv,
  factoryFilter?: FactoryName | null
) {
  const state = await getWorkspaceStateD1(env);
  return getPublicFoNeededFromState(state, factoryFilter);
}

export async function updatePlanningWorkspaceD1(
  env: WorkerEnv,
  data: {
    meta: MasterPlanMeta;
    records: PlanningRecord[];
    cuttingEntries: DailyCuttingEntry[];
    referenceDateIso: string;
    hasCustomEdits: boolean;
  }
): Promise<PersistedWorkspaceData> {
  const current = await getWorkspaceStateD1(env);
  const reason = current.records.length !== data.records.length ? 'before-save' : undefined;
  const planChanged =
    current.records.length !== data.records.length ||
    current.meta.title !== data.meta.title ||
    current.meta.asOfDateIso !== data.meta.asOfDateIso;
  const next: PersistedWorkspaceData = {
    ...current,
    meta: data.meta,
    records: normalizeRecords(data.records),
    cuttingEntries: Array.isArray(data.cuttingEntries) ? data.cuttingEntries : [],
    referenceDateIso: data.referenceDateIso || current.referenceDateIso,
    hasCustomEdits: data.hasCustomEdits,
    updatedAtIso: new Date().toISOString(),
    cuttingSheetSync:
      planChanged && hasConfiguredSheetLinks(current.cuttingSheetSync)
        ? { ...current.cuttingSheetSync, lastContentHash: '' }
        : current.cuttingSheetSync,
  };
  await saveWorkspaceStateD1(env, next, reason);
  return next;
}

export async function resetPlanningWorkspaceD1(env: WorkerEnv): Promise<PersistedWorkspaceData> {
  const current = await getWorkspaceStateD1(env);
  const defaults = buildInitialWorkspaceData({
    initialAdminPassword: env.ADMIN_PASSWORD,
    recoveryEmail: env.ADMIN_RECOVERY_EMAIL,
  });
  const next: PersistedWorkspaceData = {
    ...current,
    meta: defaults.meta,
    records: defaults.records,
    cuttingEntries: [],
    referenceDateIso: new Date().toISOString().slice(0, 10),
    hasCustomEdits: false,
    updatedAtIso: new Date().toISOString(),
    cuttingSheetSync: hasConfiguredSheetLinks(current.cuttingSheetSync)
      ? { ...current.cuttingSheetSync, lastContentHash: '' }
      : current.cuttingSheetSync,
  };
  await saveWorkspaceStateD1(env, next, 'before-reset');
  return next;
}

export async function updateRecordsOutputQtyD1(
  env: WorkerEnv,
  recordIds: string[],
  outputQty: number | null
): Promise<{ updatedCount: number; updatedAtIso: string; records: PlanningRecord[] }> {
  const current = await getWorkspaceStateD1(env);
  const result = applyOutputQtyPatchToState(current, recordIds, outputQty);
  if (result.updatedCount > 0) {
    await saveWorkspaceStateD1(env, result.nextState);
  }
  return {
    updatedCount: result.updatedCount,
    updatedAtIso: result.updatedAtIso,
    records: result.records,
  };
}

export async function updateRecordsPackingQtyD1(
  env: WorkerEnv,
  recordIds: string[],
  packingQty: number | null
): Promise<{ updatedCount: number; updatedAtIso: string; records: PlanningRecord[] }> {
  const current = await getWorkspaceStateD1(env);
  const result = applyPackingQtyPatchToState(current, recordIds, packingQty);
  if (result.updatedCount > 0) {
    await saveWorkspaceStateD1(env, result.nextState);
  }
  return {
    updatedCount: result.updatedCount,
    updatedAtIso: result.updatedAtIso,
    records: result.records,
  };
}

export async function getSiteConfigD1(env: WorkerEnv): Promise<WebsiteControlConfig> {
  return (await getWorkspaceStateD1(env)).siteConfig;
}

export async function updateSiteConfigD1(
  env: WorkerEnv,
  patch: Partial<WebsiteControlConfig>
): Promise<WebsiteControlConfig> {
  const current = await getWorkspaceStateD1(env);
  const nextSiteConfig: WebsiteControlConfig = {
    ...current.siteConfig,
    ...patch,
  };
  const next: PersistedWorkspaceData = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    siteConfig: nextSiteConfig,
  };
  await saveWorkspaceStateD1(env, next);
  return nextSiteConfig;
}

export async function getAdminAuthUpdatedAtIsoD1(env: WorkerEnv): Promise<string | null> {
  const auth = (await getWorkspaceStateD1(env)).adminAuth;
  return auth?.updatedAtIso || null;
}

export async function isAdminPasswordConfiguredD1(env: WorkerEnv): Promise<boolean> {
  const auth = (await getWorkspaceStateD1(env)).adminAuth;
  return Boolean(auth?.passwordHash && auth?.passwordSalt);
}

export async function bootstrapInitialAdminPasswordD1(
  env: WorkerEnv,
  plainPassword: string,
  recoveryEmail?: string
): Promise<void> {
  const trimmed = plainPassword.trim();
  if (trimmed.length < 8) {
    throw new Error('Admin password must be at least 8 characters long.');
  }
  const current = await getWorkspaceStateD1(env);
  if (current.adminAuth?.passwordHash && current.adminAuth?.passwordSalt) {
    throw new Error('Admin password is already configured.');
  }
  const next: PersistedWorkspaceData = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    siteConfig: recoveryEmail
      ? { ...current.siteConfig, recoveryEmail: recoveryEmail.trim().toLowerCase() }
      : current.siteConfig,
    adminAuth: createPasswordRecord(trimmed),
  };
  await saveWorkspaceStateD1(env, next);
}

export async function verifyAdminPasswordD1(
  env: WorkerEnv,
  candidate: string
): Promise<boolean> {
  const current = await getWorkspaceStateD1(env);
  return verifyPasswordAgainstAuth(candidate, current.adminAuth);
}

export async function updateAdminPasswordD1(
  env: WorkerEnv,
  newPlainPassword: string
): Promise<void> {
  const current = await getWorkspaceStateD1(env);
  const next: PersistedWorkspaceData = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    adminAuth: createPasswordRecord(newPlainPassword),
  };
  await saveWorkspaceStateD1(env, next);
}

export async function restoreWorkspaceSnapshotD1(
  env: WorkerEnv,
  snapshot: {
    meta: MasterPlanMeta;
    records: PlanningRecord[];
    cuttingEntries?: DailyCuttingEntry[];
    referenceDateIso?: string;
    reminders?: Partial<ReminderWorkspaceState>;
    siteConfig?: Partial<WebsiteControlConfig>;
    cuttingSheetSync?: Partial<CuttingSheetSyncConfig>;
  }
): Promise<PersistedWorkspaceData> {
  const current = await getWorkspaceStateD1(env);
  const next = applySnapshotRestoreToState(current, snapshot);
  await saveWorkspaceStateD1(env, next, 'before-restore');
  return next;
}

export async function updateReminderScheduleD1(
  env: WorkerEnv,
  patch: Partial<ReminderScheduleConfig>
): Promise<ReminderWorkspaceState> {
  const current = await getWorkspaceStateD1(env);
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    schedule: {
      ...current.reminders.schedule,
      ...patch,
    },
  };
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  });
  return nextReminders;
}

export async function addReminderRecipientD1(
  env: WorkerEnv,
  recipient: ReminderRecipient
): Promise<ReminderWorkspaceState> {
  const current = await getWorkspaceStateD1(env);
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    recipients: [...current.reminders.recipients, recipient],
  };
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  });
  return nextReminders;
}

export async function updateReminderRecipientD1(
  env: WorkerEnv,
  id: string,
  patch: Partial<ReminderRecipient>
): Promise<ReminderWorkspaceState> {
  const current = await getWorkspaceStateD1(env);
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    recipients: current.reminders.recipients.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  };
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  });
  return nextReminders;
}

export async function deleteReminderRecipientD1(
  env: WorkerEnv,
  id: string
): Promise<ReminderWorkspaceState> {
  const current = await getWorkspaceStateD1(env);
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    recipients: current.reminders.recipients.filter((r) => r.id !== id),
  };
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  });
  return nextReminders;
}

export async function appendReminderDeliveryLogD1(
  env: WorkerEnv,
  log: ReminderDeliveryLog
): Promise<ReminderWorkspaceState> {
  const current = await getWorkspaceStateD1(env);
  const next = appendDeliveryLogToState(current, log);
  await saveWorkspaceStateD1(env, next);
  return next.reminders;
}

export async function getStoredSmtpConfigD1(env: WorkerEnv): Promise<SmtpStoredConfig | null> {
  return (await getWorkspaceStateD1(env)).smtpConfig ?? null;
}

export async function saveStoredSmtpConfigD1(
  env: WorkerEnv,
  smtpConfig: SmtpStoredConfig | null
): Promise<void> {
  const current = await getWorkspaceStateD1(env);
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    smtpConfig,
  });
}

export async function updateCuttingSheetSyncConfigD1(
  env: WorkerEnv,
  patch: Partial<CuttingSheetSyncConfig>
): Promise<CuttingSheetSyncConfig> {
  const current = await getWorkspaceStateD1(env);
  const nextSync: CuttingSheetSyncConfig = {
    ...current.cuttingSheetSync,
    ...patch,
    factoryUrls:
      patch.factoryUrls !== undefined
        ? { ...patch.factoryUrls }
        : { ...(current.cuttingSheetSync.factoryUrls ?? {}) },
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
  if (patch.enabled === undefined && hasConfiguredSheetLinks(nextSync)) {
    nextSync.enabled = true;
  }
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    cuttingSheetSync: nextSync,
  });
  return nextSync;
}

export async function removeCuttingSheetLinkD1(
  env: WorkerEnv,
  target: { role: CuttingSheetLinkRole; scope: CuttingSheetLinkScope }
): Promise<CuttingSheetSyncConfig> {
  const current = await getWorkspaceStateD1(env);
  const nextSync = removeCuttingSheetLinkFromConfig(current.cuttingSheetSync, target);
  await saveWorkspaceStateD1(env, {
    ...current,
    updatedAtIso: new Date().toISOString(),
    cuttingSheetSync: nextSync,
  });
  return nextSync;
}

export async function applySyncedCuttingDataD1(
  env: WorkerEnv,
  params: {
    syncedEntries?: DailyCuttingEntry[];
    replaceSheetEntries: boolean;
    scopedFactories?: FactoryName[];
    recordUpdates?: RecordSheetPatch[];
    syncPatch: Partial<CuttingSheetSyncConfig>;
    logEntry?: CuttingSheetSyncLog;
  }
): Promise<PersistedWorkspaceData> {
  const current = await getWorkspaceStateD1(env);
  const next = applySyncedCuttingToState(current, params);
  await saveWorkspaceStateD1(env, next);
  return next;
}

// =========================================================================
// PERSISTENT ADMIN OTP STATE (SURVIVES WORKER ISOLATE RESTARTS)
// =========================================================================
export async function getPendingOtpD1(env: WorkerEnv): Promise<PendingPasswordOtpRecord | null> {
  await ensureD1Schema(env.DB);
  const row = await env.DB.prepare(
    `SELECT code_hash, salt, expires_at, attempts, target_email
     FROM admin_otp
     WHERE id = 1`
  ).first<{
    code_hash: string;
    salt: string;
    expires_at: number;
    attempts: number;
    target_email: string;
  }>();
  if (!row) return null;
  return {
    codeHash: row.code_hash,
    salt: row.salt,
    expiresAt: Number(row.expires_at),
    attempts: Number(row.attempts),
    targetEmail: row.target_email,
  };
}

export async function savePendingOtpD1(
  env: WorkerEnv,
  otp: PendingPasswordOtpRecord
): Promise<void> {
  await ensureD1Schema(env.DB);
  await env.DB.prepare(
    `INSERT INTO admin_otp (id, code_hash, salt, expires_at, attempts, target_email)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       code_hash = excluded.code_hash,
       salt = excluded.salt,
       expires_at = excluded.expires_at,
       attempts = excluded.attempts,
       target_email = excluded.target_email`
  )
    .bind(otp.codeHash, otp.salt, otp.expiresAt, otp.attempts, otp.targetEmail)
    .run();
}

export async function incrementPendingOtpAttemptD1(env: WorkerEnv): Promise<void> {
  await ensureD1Schema(env.DB);
  await env.DB.prepare(`UPDATE admin_otp SET attempts = attempts + 1 WHERE id = 1`).run();
}

export async function clearPendingOtpD1(env: WorkerEnv): Promise<void> {
  await ensureD1Schema(env.DB);
  await env.DB.prepare(`DELETE FROM admin_otp WHERE id = 1`).run();
}
