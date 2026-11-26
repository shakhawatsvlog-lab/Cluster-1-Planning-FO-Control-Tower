import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOWED_FACTORIES,
  buildSelectedFoSummaryRows,
  evaluatePlanningRecords,
  parseMasterPlanCsv,
} from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  FactoryName,
  MasterPlanMeta,
  OrderStatus,
  PlanningRecord,
  PublicFoNeededResponse,
  PublicMasterPlanRecord,
  PublicMasterPlanResponse,
} from '../shared/plannerTypes.ts';
import { DEFAULT_REMINDER_SCHEDULE } from '../shared/reminderTypes.ts';
import type {
  ReminderDeliveryLog,
  ReminderRecipient,
  ReminderScheduleConfig,
  ReminderWorkspaceState,
  SmtpProviderPreset,
} from '../shared/reminderTypes.ts';
import { DEFAULT_WEBSITE_CONTROL_CONFIG } from '../shared/controlPanelTypes.ts';
import type { WebsiteControlConfig } from '../shared/controlPanelTypes.ts';
import { DEFAULT_CUTTING_SHEET_CONFIG } from '../shared/cuttingSheetTypes.ts';
import type {
  CuttingSheetSyncConfig,
  CuttingSheetSyncLog,
} from '../shared/cuttingSheetTypes.ts';

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

export interface SmtpStoredConfig {
  providerPreset: SmtpProviderPreset;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export interface AdminAuthStored {
  passwordHash: string;
  passwordSalt: string;
  updatedAtIso: string;
}

export interface PersistedWorkspaceData {
  meta: MasterPlanMeta;
  records: PlanningRecord[];
  cuttingEntries: DailyCuttingEntry[];
  referenceDateIso: string;
  hasCustomEdits: boolean;
  updatedAtIso: string;
  reminders: ReminderWorkspaceState;
  smtpConfig: SmtpStoredConfig | null;
  siteConfig: WebsiteControlConfig;
  cuttingSheetSync: CuttingSheetSyncConfig;
  adminAuth: AdminAuthStored | null;
}

function hashPasswordWithSalt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordRecord(plainPassword: string): AdminAuthStored {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    passwordHash: hashPasswordWithSalt(plainPassword, salt),
    passwordSalt: salt,
    updatedAtIso: new Date().toISOString(),
  };
}

function getDefaultInitialAdminAuth(): AdminAuthStored | null {
  const envPass = (
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PANEL_DEFAULT_PASSWORD ||
    ''
  ).trim();
  if (envPass.length >= 6) {
    return createPasswordRecord(envPass);
  }
  return null;
}

export function loadDefaultMasterPlan() {
  const csvContent = fs.readFileSync(MASTER_CSV_PATH, 'utf8');
  return parseMasterPlanCsv(csvContent);
}

function normalizeRecords(records: PlanningRecord[]): PlanningRecord[] {
  return records.map((r) => {
    const orderStatus = (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus;
    const isClosed = orderStatus === 'Order Closed' || Boolean(r.isFinished);
    const cuttingInputQty =
      r.cuttingInputQty !== null &&
      r.cuttingInputQty !== undefined &&
      Number.isFinite(r.cuttingInputQty) &&
      r.cuttingInputQty >= 0
        ? Math.round(r.cuttingInputQty)
        : null;
    const outputQty =
      r.outputQty !== null &&
      r.outputQty !== undefined &&
      Number.isFinite(r.outputQty) &&
      r.outputQty >= 0
        ? Math.round(r.outputQty)
        : null;
    const packingQty =
      r.packingQty !== null &&
      r.packingQty !== undefined &&
      Number.isFinite(r.packingQty) &&
      r.packingQty >= 0
        ? Math.round(r.packingQty)
        : null;
    return {
      ...r,
      orderStatus,
      isFinished: isClosed,
      isManualRunning: isClosed ? false : Boolean(r.isManualRunning),
      cuttingInputQty,
      outputQty,
      outputUpdatedAtIso:
        typeof r.outputUpdatedAtIso === 'string' ? r.outputUpdatedAtIso : null,
      packingQty,
      packingUpdatedAtIso:
        typeof r.packingUpdatedAtIso === 'string' ? r.packingUpdatedAtIso : null,
      foChecklistConfirmed: Boolean(r.foChecklistConfirmed),
      foChecklistConfirmedAtIso:
        typeof r.foChecklistConfirmedAtIso === 'string' ? r.foChecklistConfirmedAtIso : null,
      upcomingFoSelected: Boolean(r.upcomingFoSelected),
      upcomingFoSelectedAtIso:
        typeof r.upcomingFoSelectedAtIso === 'string' ? r.upcomingFoSelectedAtIso : null,
      sheetRemark: typeof r.sheetRemark === 'string' ? r.sheetRemark : '',
      foFullQtyReleased: Boolean(r.foFullQtyReleased),
    };
  });
}

function normalizeRecipients(
  recipients: Partial<ReminderRecipient>[] | undefined,
  fallbackSendTime: string
): ReminderRecipient[] {
  if (!Array.isArray(recipients)) return [];
  return recipients.map((r) => ({
    id: r.id || `RECIP-${Date.now().toString(36).toUpperCase()}`,
    name: r.name || 'Recipient',
    email: r.email || '',
    role: r.role || 'Merchandising / Planning',
    factories: Array.isArray(r.factories) ? r.factories : [],
    active: r.active !== undefined ? Boolean(r.active) : true,
    frequency:
      r.frequency === 'weekly' || r.frequency === 'monthly' || r.frequency === 'daily'
        ? r.frequency
        : 'daily',
    sendTime:
      typeof r.sendTime === 'string' && /^\d{2}:\d{2}$/.test(r.sendTime)
        ? r.sendTime
        : fallbackSendTime,
    dayOfWeek:
      typeof r.dayOfWeek === 'number' && r.dayOfWeek >= 0 && r.dayOfWeek <= 6
        ? Math.round(r.dayOfWeek)
        : 1,
    dayOfMonth:
      typeof r.dayOfMonth === 'number' && r.dayOfMonth >= 1 && r.dayOfMonth <= 31
        ? Math.round(r.dayOfMonth)
        : 1,
    lastSentDateLocal: typeof r.lastSentDateLocal === 'string' ? r.lastSentDateLocal : null,
    customNote: typeof r.customNote === 'string' ? r.customNote : '',
    addedAtIso: r.addedAtIso || new Date().toISOString(),
  }));
}

function createInitialState(): PersistedWorkspaceData {
  const parsed = loadDefaultMasterPlan();
  const envRecovery = (process.env.ADMIN_RECOVERY_EMAIL || '').trim().toLowerCase();
  return {
    meta: parsed.meta,
    records: parsed.records,
    cuttingEntries: [],
    referenceDateIso: new Date().toISOString().slice(0, 10),
    hasCustomEdits: false,
    updatedAtIso: new Date().toISOString(),
    reminders: {
      recipients: [],
      schedule: { ...DEFAULT_REMINDER_SCHEDULE },
      logs: [],
    },
    smtpConfig: null,
    siteConfig: {
      ...DEFAULT_WEBSITE_CONTROL_CONFIG,
      ...(envRecovery ? { recoveryEmail: envRecovery } : {}),
    },
    cuttingSheetSync: { ...DEFAULT_CUTTING_SHEET_CONFIG },
    adminAuth: getDefaultInitialAdminAuth(),
  };
}

let cachedState: PersistedWorkspaceData | null = null;

export function getWorkspaceState(): PersistedWorkspaceData {
  if (cachedState) {
    return cachedState;
  }

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceData>;
      if (parsed?.meta && Array.isArray(parsed?.records) && parsed.records.length > 0) {
        const hasAdminAuth = Boolean(
          parsed.adminAuth?.passwordHash && parsed.adminAuth?.passwordSalt
        );
        const mergedSchedule: ReminderScheduleConfig = {
          ...DEFAULT_REMINDER_SCHEDULE,
          ...(parsed.reminders?.schedule ?? {}),
          customMessage:
            typeof parsed.reminders?.schedule?.customMessage === 'string'
              ? parsed.reminders.schedule.customMessage
              : '',
        };
        cachedState = {
          meta: parsed.meta,
          records: normalizeRecords(parsed.records),
          cuttingEntries: Array.isArray(parsed.cuttingEntries) ? parsed.cuttingEntries : [],
          referenceDateIso:
            typeof parsed.referenceDateIso === 'string' && parsed.referenceDateIso
              ? parsed.referenceDateIso
              : new Date().toISOString().slice(0, 10),
          hasCustomEdits: Boolean(parsed.hasCustomEdits),
          updatedAtIso: parsed.updatedAtIso || new Date().toISOString(),
          reminders: {
            recipients: normalizeRecipients(
              parsed.reminders?.recipients,
              mergedSchedule.dailySendTime
            ),
            schedule: mergedSchedule,
            logs: Array.isArray(parsed.reminders?.logs) ? parsed.reminders.logs : [],
          },
          smtpConfig: parsed.smtpConfig ?? null,
          siteConfig: {
            ...DEFAULT_WEBSITE_CONTROL_CONFIG,
            ...(parsed.siteConfig ?? {}),
          },
          cuttingSheetSync: {
            ...DEFAULT_CUTTING_SHEET_CONFIG,
            ...(parsed.cuttingSheetSync ?? {}),
            factoryUrls: {
              ...(parsed.cuttingSheetSync?.factoryUrls ?? {}),
            },
            outputSheetUrl:
              typeof parsed.cuttingSheetSync?.outputSheetUrl === 'string'
                ? parsed.cuttingSheetSync.outputSheetUrl
                : '',
            outputFactoryUrls: {
              ...(parsed.cuttingSheetSync?.outputFactoryUrls ?? {}),
            },
            packingSheetUrl:
              typeof parsed.cuttingSheetSync?.packingSheetUrl === 'string'
                ? parsed.cuttingSheetSync.packingSheetUrl
                : '',
            packingFactoryUrls: {
              ...(parsed.cuttingSheetSync?.packingFactoryUrls ?? {}),
            },
            factoryStatuses: {
              ...(parsed.cuttingSheetSync?.factoryStatuses ?? {}),
            },
            logs: Array.isArray(parsed.cuttingSheetSync?.logs)
              ? parsed.cuttingSheetSync!.logs
              : [],
          },
          adminAuth: hasAdminAuth
            ? (parsed.adminAuth as AdminAuthStored)
            : getDefaultInitialAdminAuth(),
        };
        if (!hasAdminAuth && cachedState.adminAuth) {
          writeStateToDisk(cachedState);
        }
        return cachedState;
      }
    }
  } catch (err) {
    console.error('Failed to read persisted workspace-state.json, resetting to master CSV:', err);
  }

  cachedState = createInitialState();
  writeStateToDisk(cachedState);
  return cachedState;
}

export interface SyncVersionSnapshot {
  version: string;
  referenceDateIso: string;
  cuttingUpdatedAtIso: string | null;
  cuttingCheckedAtIso: string | null;
}

export function getSyncVersionSnapshot(): SyncVersionSnapshot {
  const state = getWorkspaceState();
  return {
    version: state.updatedAtIso,
    referenceDateIso: state.referenceDateIso,
    cuttingUpdatedAtIso: state.cuttingSheetSync?.lastUpdatedAtIso ?? null,
    cuttingCheckedAtIso: state.cuttingSheetSync?.lastCheckedAtIso ?? null,
  };
}

export function getPublicWorkspaceState(isAdmin = false) {
  const state = getWorkspaceState();
  const needsInitialSetup = !isAdminPasswordConfigured();

  if (isAdmin) {
    return {
      meta: state.meta,
      records: state.records,
      cuttingEntries: state.cuttingEntries,
      referenceDateIso: state.referenceDateIso,
      hasCustomEdits: state.hasCustomEdits,
      updatedAtIso: state.updatedAtIso,
      reminders: state.reminders,
      siteConfig: state.siteConfig,
      cuttingSheetSync: state.cuttingSheetSync,
      needsInitialSetup,
    };
  }

  return {
    meta: state.meta,
    records: state.records,
    cuttingEntries: state.cuttingEntries,
    referenceDateIso: state.referenceDateIso,
    hasCustomEdits: state.hasCustomEdits,
    updatedAtIso: state.updatedAtIso,
    reminders: {
      recipients: [],
      schedule: {
        ...state.reminders.schedule,
        customMessage: '',
      },
      logs: [],
    },
    siteConfig: {
      ...state.siteConfig,
      recoveryEmail: '',
    },
    cuttingSheetSync: {
      ...state.cuttingSheetSync,
      sheetUrl: '',
      factoryUrls: {},
      outputSheetUrl: '',
      outputFactoryUrls: {},
      packingSheetUrl: '',
      packingFactoryUrls: {},
      lastContentHash: '',
      lastMessage:
        state.cuttingSheetSync.lastStatus === 'Success'
          ? 'Synced'
          : state.cuttingSheetSync.lastStatus === 'Error'
            ? 'Sync attention needed'
            : '',
      logs: [],
    },
    needsInitialSetup,
  };
}

export function getPublicMasterPlanState(factoryFilter?: FactoryName): PublicMasterPlanResponse {
  const state = getWorkspaceState();
  const evaluated = evaluatePlanningRecords(
    state.records,
    state.cuttingEntries,
    state.referenceDateIso,
    {
      inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
      upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
      cuttingAlertDays: state.siteConfig.cuttingAlertDays,
    }
  );

  const scopedEvaluated = factoryFilter
    ? evaluated.filter((rec) => rec.factory === factoryFilter)
    : evaluated;

  const lineCapacityMap = new Map<string, number>();
  for (const rec of scopedEvaluated) {
    const lineKey = `${rec.factory}::${rec.line}`;
    if (!lineCapacityMap.has(lineKey)) {
      lineCapacityMap.set(lineKey, rec.capacityMc || 0);
    }
  }
  const scopedTotalLines = factoryFilter ? lineCapacityMap.size : state.meta.totalLines;
  const scopedTotalCapacityMc = factoryFilter
    ? Array.from(lineCapacityMap.values()).reduce((sum, cap) => sum + cap, 0)
    : state.meta.totalCapacityMc;

  const sanitizedRecords: PublicMasterPlanRecord[] = scopedEvaluated.map((rec) => ({
    id: rec.id,
    factory: rec.factory,
    zone: rec.zone,
    line: rec.line,
    capacityMc: rec.capacityMc,
    productCategory: rec.productCategory,
    slot: rec.slot,
    orderStatus: rec.orderStatus,
    pgNumber: rec.pgNumber,
    style: rec.style,
    nextStyle: rec.nextStyle,
    styleClassification: rec.styleClassification,
    styleQtyHint: rec.styleQtyHint,
    plannedQty: rec.plannedQty,
    endDateIso: rec.endDateIso,
    triggerDateIso: rec.triggerDateIso,
    newStyleOutputStartIso: rec.newStyleOutputStartIso,
    estimatedOutputStartIso: rec.estimatedOutputStartIso,
    estimatedOutputStatus: rec.estimatedOutputStatus,
    precedingRunningPgNumber: rec.precedingRunningPgNumber,
    precedingRunningEndDateIso: rec.precedingRunningEndDateIso,
    cuttingInputQty: rec.cuttingInputQty,
    cuttingOutputQty: rec.cuttingOutputQty,
    outputQty: rec.outputQty,
    balanceToOutput: rec.balanceToOutput,
    outputStatus: rec.outputStatus,
    outputUpdatedAtIso: rec.outputUpdatedAtIso ?? null,
    packingQty: rec.packingQty,
    balanceToPack: rec.balanceToPack,
    packingStatus: rec.packingStatus,
    packingUpdatedAtIso: rec.packingUpdatedAtIso ?? null,
    estimatedCuttingFinishIso: rec.estimatedCuttingFinishIso,
    lifecycleStage: rec.lifecycleStage,
    actionMessage: rec.actionMessage,
    riskStatus: rec.riskStatus,
    riskTier: rec.riskTier,
  }));

  const hasCuttingData = sanitizedRecords.some((r) => r.cuttingOutputQty > 0);
  const hasCuttingInputColumn = sanitizedRecords.some((r) => r.cuttingInputQty !== null);
  const hasOutputData = sanitizedRecords.some((r) => r.outputQty !== null);
  const hasPackingData = sanitizedRecords.some((r) => r.packingQty !== null);

  return {
    meta: {
      title: state.meta.title,
      asOfDateRaw: state.meta.asOfDateRaw,
      asOfDateIso: state.meta.asOfDateIso,
      factoriesIncluded: [...state.meta.factoriesIncluded],
      totalLines: scopedTotalLines,
      totalCapacityMc: scopedTotalCapacityMc,
    },
    selectedFactory: factoryFilter ?? null,
    records: sanitizedRecords,
    referenceDateIso: state.referenceDateIso,
    updatedAtIso: state.updatedAtIso,
    cuttingSheetSummary: {
      hasCuttingData,
      hasCuttingInputColumn,
      hasOutputData,
      hasPackingData,
      lastSyncedAtIso: state.cuttingSheetSync?.lastUpdatedAtIso ?? null,
    },
    branding: {
      companyName: state.siteConfig.companyName,
      portalTitle: state.siteConfig.portalTitle,
    },
  };
}

export function getPublicFoNeededState(
  factoryFilter?: FactoryName | null
): PublicFoNeededResponse {
  const state = getWorkspaceState();
  const { rows, totalIssueQty, uniquePgIssueQty } = buildSelectedFoSummaryRows({
    records: state.records,
    cuttingEntries: state.cuttingEntries,
    referenceDateIso: state.referenceDateIso,
    ruleOptions: {
      inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
      upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
      cuttingAlertDays: state.siteConfig.cuttingAlertDays,
    },
    factoryFilter: factoryFilter ?? null,
  });

  return {
    meta: {
      title: state.meta.title,
      asOfDateRaw: state.meta.asOfDateRaw,
      asOfDateIso: state.meta.asOfDateIso,
      factoriesIncluded: [...state.meta.factoriesIncluded],
    },
    referenceDateIso: state.referenceDateIso,
    updatedAtIso: state.updatedAtIso,
    selectedCount: rows.length,
    totalIssueQty,
    uniquePgIssueQty,
    rows,
    branding: {
      companyName: state.siteConfig.companyName,
      portalTitle: state.siteConfig.portalTitle,
    },
  };
}

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
    const safeSnapshot = {
      meta: state.meta,
      records: state.records,
      cuttingEntries: state.cuttingEntries,
      referenceDateIso: state.referenceDateIso,
      reminders: state.reminders,
      siteConfig: state.siteConfig,
      cuttingSheetSync: state.cuttingSheetSync,
    };
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

export function isAdminPasswordConfigured(): boolean {
  const auth = getWorkspaceState().adminAuth;
  return Boolean(auth?.passwordHash && auth?.passwordSalt);
}

export function getAdminAuthUpdatedAtIso(): string | null {
  return getWorkspaceState().adminAuth?.updatedAtIso ?? null;
}

export function verifyAdminPassword(candidate: string): boolean {
  if (!candidate) return false;
  const auth = getWorkspaceState().adminAuth;
  if (!auth?.passwordHash || !auth?.passwordSalt) return false;
  const computedHex = hashPasswordWithSalt(candidate, auth.passwordSalt);
  const a = Buffer.from(computedHex, 'hex');
  const b = Buffer.from(auth.passwordHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
  const mergedSchedule: ReminderScheduleConfig = {
    ...DEFAULT_REMINDER_SCHEDULE,
    ...current.reminders.schedule,
    ...(snapshot.reminders?.schedule ?? {}),
  };
  const next: PersistedWorkspaceData = {
    ...current,
    meta: snapshot.meta,
    records: normalizeRecords(snapshot.records),
    cuttingEntries: Array.isArray(snapshot.cuttingEntries)
      ? snapshot.cuttingEntries
      : current.cuttingEntries,
    referenceDateIso: snapshot.referenceDateIso || current.referenceDateIso,
    hasCustomEdits: true,
    updatedAtIso: new Date().toISOString(),
    reminders: snapshot.reminders
      ? {
          recipients: normalizeRecipients(
            snapshot.reminders.recipients,
            mergedSchedule.dailySendTime
          ),
          schedule: mergedSchedule,
          logs: Array.isArray(snapshot.reminders.logs)
            ? snapshot.reminders.logs
            : current.reminders.logs,
        }
      : current.reminders,
    siteConfig: snapshot.siteConfig
      ? {
          ...current.siteConfig,
          ...snapshot.siteConfig,
        }
      : current.siteConfig,
    cuttingSheetSync: snapshot.cuttingSheetSync
      ? {
          ...current.cuttingSheetSync,
          ...snapshot.cuttingSheetSync,
          factoryUrls: {
            ...(snapshot.cuttingSheetSync.factoryUrls ?? current.cuttingSheetSync.factoryUrls),
          },
          outputSheetUrl:
            snapshot.cuttingSheetSync.outputSheetUrl ?? current.cuttingSheetSync.outputSheetUrl,
          outputFactoryUrls: {
            ...(snapshot.cuttingSheetSync.outputFactoryUrls ??
              current.cuttingSheetSync.outputFactoryUrls),
          },
          packingSheetUrl:
            snapshot.cuttingSheetSync.packingSheetUrl ?? current.cuttingSheetSync.packingSheetUrl,
          packingFactoryUrls: {
            ...(snapshot.cuttingSheetSync.packingFactoryUrls ??
              current.cuttingSheetSync.packingFactoryUrls),
          },
          factoryStatuses: {
            ...(snapshot.cuttingSheetSync.factoryStatuses ??
              current.cuttingSheetSync.factoryStatuses),
          },
        }
      : current.cuttingSheetSync,
  };
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
  const idSet = new Set(recordIds);
  const nowIso = new Date().toISOString();
  const sanitizedQty =
    outputQty !== null && Number.isFinite(outputQty) && outputQty >= 0
      ? Math.round(outputQty)
      : null;

  let updatedCount = 0;
  const nextRecords = current.records.map((rec) => {
    if (!idSet.has(rec.id)) return rec;
    updatedCount += 1;
    return {
      ...rec,
      outputQty: sanitizedQty,
      outputUpdatedAtIso: sanitizedQty !== null ? nowIso : null,
    };
  });

  if (updatedCount > 0) {
    cachedState = {
      ...current,
      records: nextRecords,
      hasCustomEdits: true,
      updatedAtIso: nowIso,
    };
    writeStateToDisk(cachedState);
  }

  return {
    updatedCount,
    updatedAtIso: cachedState?.updatedAtIso ?? nowIso,
    records: nextRecords,
  };
}

export function updateRecordsPackingQty(
  recordIds: string[],
  packingQty: number | null
): { updatedCount: number; updatedAtIso: string; records: PlanningRecord[] } {
  const current = getWorkspaceState();
  const idSet = new Set(recordIds);
  const nowIso = new Date().toISOString();
  const sanitizedQty =
    packingQty !== null && Number.isFinite(packingQty) && packingQty >= 0
      ? Math.round(packingQty)
      : null;

  let updatedCount = 0;
  const nextRecords = current.records.map((rec) => {
    if (!idSet.has(rec.id)) return rec;
    updatedCount += 1;
    return {
      ...rec,
      packingQty: sanitizedQty,
      packingUpdatedAtIso: sanitizedQty !== null ? nowIso : null,
    };
  });

  if (updatedCount > 0) {
    cachedState = {
      ...current,
      records: nextRecords,
      hasCustomEdits: true,
      updatedAtIso: nowIso,
    };
    writeStateToDisk(cachedState);
  }

  return {
    updatedCount,
    updatedAtIso: cachedState?.updatedAtIso ?? nowIso,
    records: nextRecords,
  };
}

export interface RecordSheetPatch {
  primaryRecordId?: string;
  recordIds: string[];
  plannedQty?: number | null;
  dailyTargetQty?: number | null;
  cuttingInputQty?: number | null;
  outputQty?: number | null;
  packingQty?: number | null;
  sheetRemark?: string;
  foFullQtyReleased?: boolean;
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
  let nextEntries = current.cuttingEntries;
  let nextRecords = current.records;
  let recordsModified = false;

  if (params.recordUpdates && params.recordUpdates.length > 0) {
    const patchByRecordId = new Map<
      string,
      {
        plannedQty?: number | null;
        dailyTargetQty?: number | null;
        cuttingInputQty?: number | null;
        outputQty?: number | null;
        packingQty?: number | null;
        sheetRemark?: string;
        foFullQtyReleased?: boolean;
      }
    >();
    const clearDuplicateOutputIds = new Set<string>();
    const clearDuplicatePackingIds = new Set<string>();
    for (const upd of params.recordUpdates) {
      const primaryId = upd.primaryRecordId || upd.recordIds[0];
      for (const rid of upd.recordIds) {
        const isPrimary = rid === primaryId;
        if (
          !isPrimary &&
          upd.outputQty !== undefined &&
          upd.outputQty !== null
        ) {
          clearDuplicateOutputIds.add(rid);
        }
        if (
          !isPrimary &&
          upd.packingQty !== undefined &&
          upd.packingQty !== null
        ) {
          clearDuplicatePackingIds.add(rid);
        }
        const prev = patchByRecordId.get(rid) ?? {};
        const mergedRemark =
          upd.sheetRemark && upd.sheetRemark.trim()
            ? prev.sheetRemark && prev.sheetRemark !== upd.sheetRemark.trim()
              ? `${prev.sheetRemark} · ${upd.sheetRemark.trim()}`
              : upd.sheetRemark.trim()
            : prev.sheetRemark;
        patchByRecordId.set(rid, {
          plannedQty:
            upd.plannedQty !== undefined && upd.plannedQty !== null ? upd.plannedQty : prev.plannedQty,
          dailyTargetQty:
            upd.dailyTargetQty !== undefined && upd.dailyTargetQty !== null
              ? upd.dailyTargetQty
              : prev.dailyTargetQty,
          cuttingInputQty:
            isPrimary && upd.cuttingInputQty !== undefined && upd.cuttingInputQty !== null
              ? upd.cuttingInputQty
              : prev.cuttingInputQty,
          outputQty:
            isPrimary && upd.outputQty !== undefined && upd.outputQty !== null
              ? upd.outputQty
              : prev.outputQty,
          packingQty:
            isPrimary && upd.packingQty !== undefined && upd.packingQty !== null
              ? upd.packingQty
              : prev.packingQty,
          sheetRemark: mergedRemark,
          foFullQtyReleased: Boolean(prev.foFullQtyReleased || upd.foFullQtyReleased),
        });
      }
    }
    if (patchByRecordId.size > 0) {
      const nowIso = new Date().toISOString();
      nextRecords = current.records.map((rec) => {
        const upd = patchByRecordId.get(rec.id);
        if (!upd) return rec;
        const nextPlanned =
          upd.plannedQty !== undefined && upd.plannedQty !== null ? upd.plannedQty : rec.plannedQty;
        const nextTarget =
          upd.dailyTargetQty !== undefined && upd.dailyTargetQty !== null
            ? upd.dailyTargetQty
            : rec.dailyTargetQty;
        const nextCuttingInput =
          upd.cuttingInputQty !== undefined && upd.cuttingInputQty !== null
            ? upd.cuttingInputQty
            : (rec.cuttingInputQty ?? null);
        const shouldClearDupOutput =
          clearDuplicateOutputIds.has(rec.id) &&
          (upd.outputQty === undefined || upd.outputQty === null);
        const nextOutputQty =
          upd.outputQty !== undefined && upd.outputQty !== null
            ? upd.outputQty
            : shouldClearDupOutput
              ? null
              : (rec.outputQty ?? null);
        const nextOutputUpdatedAt =
          upd.outputQty !== undefined && upd.outputQty !== null
            ? nowIso
            : shouldClearDupOutput
              ? null
              : (rec.outputUpdatedAtIso ?? null);
        const shouldClearDupPack =
          clearDuplicatePackingIds.has(rec.id) &&
          (upd.packingQty === undefined || upd.packingQty === null);
        const nextPackingQty =
          upd.packingQty !== undefined && upd.packingQty !== null
            ? upd.packingQty
            : shouldClearDupPack
              ? null
              : (rec.packingQty ?? null);
        const nextPackingUpdatedAt =
          upd.packingQty !== undefined && upd.packingQty !== null
            ? nowIso
            : shouldClearDupPack
              ? null
              : (rec.packingUpdatedAtIso ?? null);
        const nextRemark =
          upd.sheetRemark !== undefined && upd.sheetRemark.trim()
            ? upd.sheetRemark.trim()
            : rec.sheetRemark || '';
        const nextReleased = Boolean(rec.foFullQtyReleased || upd.foFullQtyReleased);
        const nextFoStatus =
          nextReleased && rec.foStatus !== 'In-House' ? 'In-House' : rec.foStatus;
        const nextIssueQty =
          nextReleased && (rec.foIssueQty === null || rec.foIssueQty === undefined) && nextPlanned !== null
            ? nextPlanned
            : rec.foIssueQty;

        if (
          nextPlanned === rec.plannedQty &&
          nextTarget === rec.dailyTargetQty &&
          nextCuttingInput === (rec.cuttingInputQty ?? null) &&
          nextOutputQty === (rec.outputQty ?? null) &&
          nextPackingQty === (rec.packingQty ?? null) &&
          nextRemark === (rec.sheetRemark || '') &&
          nextReleased === Boolean(rec.foFullQtyReleased) &&
          nextFoStatus === rec.foStatus &&
          nextIssueQty === rec.foIssueQty
        ) {
          return rec;
        }
        recordsModified = true;
        return {
          ...rec,
          plannedQty: nextPlanned,
          foIssueQty: nextIssueQty,
          dailyTargetQty: nextTarget,
          cuttingInputQty: nextCuttingInput,
          outputQty: nextOutputQty,
          outputUpdatedAtIso: nextOutputUpdatedAt,
          packingQty: nextPackingQty,
          packingUpdatedAtIso: nextPackingUpdatedAt,
          sheetRemark: nextRemark,
          foFullQtyReleased: nextReleased,
          foStatus: nextFoStatus,
        };
      });
    }
  }

  if (params.replaceSheetEntries && params.syncedEntries) {
    const scopeSet =
      params.scopedFactories && params.scopedFactories.length > 0
        ? new Set<FactoryName>(params.scopedFactories)
        : new Set<FactoryName>(ALLOWED_FACTORIES);

    const preserved = current.cuttingEntries.filter(
      (e) => e.source !== 'sheet' || !scopeSet.has(e.factory)
    );
    nextEntries = [...params.syncedEntries, ...preserved].sort((a, b) =>
      b.dateIso.localeCompare(a.dateIso)
    );
  }

  const allSheetEntries = nextEntries.filter((e) => e.source === 'sheet');
  const totalSheetQty = allSheetEntries.reduce((sum, e) => sum + e.cuttingQty, 0);
  const outputEnteredRecords = nextRecords.filter(
    (r) => r.outputQty !== null && r.outputQty !== undefined
  );
  const totalOutputQty = outputEnteredRecords.reduce((sum, r) => sum + (r.outputQty || 0), 0);
  const packingEnteredRecords = nextRecords.filter(
    (r) => r.packingQty !== null && r.packingQty !== undefined
  );
  const totalPackingQty = packingEnteredRecords.reduce((sum, r) => sum + (r.packingQty || 0), 0);

  const nextLogs = params.logEntry
    ? [params.logEntry, ...current.cuttingSheetSync.logs].slice(0, 30)
    : current.cuttingSheetSync.logs;

  const nextSync: CuttingSheetSyncConfig = {
    ...current.cuttingSheetSync,
    ...params.syncPatch,
    factoryStatuses: {
      ...(current.cuttingSheetSync.factoryStatuses ?? {}),
      ...(params.syncPatch.factoryStatuses ?? {}),
    },
    lastMatchedCount:
      params.syncPatch.lastMatchedCount !== undefined
        ? params.syncPatch.lastMatchedCount
        : allSheetEntries.length,
    lastTotalQty:
      params.syncPatch.lastTotalQty !== undefined
        ? params.syncPatch.lastTotalQty
        : totalSheetQty,
    lastOutputMatchedCount: outputEnteredRecords.length,
    lastOutputTotalQty: totalOutputQty,
    lastPackingMatchedCount: packingEnteredRecords.length,
    lastPackingTotalQty: totalPackingQty,
    logs: nextLogs,
  };

  if (params.replaceSheetEntries) {
    nextSync.lastMatchedCount = allSheetEntries.length;
    nextSync.lastTotalQty = totalSheetQty;
  }

  cachedState = {
    ...current,
    records: nextRecords,
    cuttingEntries: nextEntries,
    hasCustomEdits:
      params.replaceSheetEntries || recordsModified ? true : current.hasCustomEdits,
    updatedAtIso: new Date().toISOString(),
    cuttingSheetSync: nextSync,
  };
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
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    logs: [log, ...current.reminders.logs].slice(0, 50),
  };
  cachedState = {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  };
  writeStateToDisk(cachedState);
  return nextReminders;
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
