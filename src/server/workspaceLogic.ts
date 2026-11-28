import crypto from 'node:crypto';
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
  CuttingSheetLinkRole,
  CuttingSheetLinkScope,
  CuttingSheetSyncConfig,
  CuttingSheetSyncLog,
} from '../shared/cuttingSheetTypes.ts';
import { DEFAULT_MASTER_PLAN_CSV } from '../shared/defaultMasterPlanCsv.ts';

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

export interface SyncVersionSnapshot {
  version: string;
  referenceDateIso: string;
  cuttingUpdatedAtIso: string | null;
  cuttingCheckedAtIso: string | null;
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

export function hashPasswordWithSalt(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function createPasswordRecord(plainPassword: string): AdminAuthStored {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    passwordHash: hashPasswordWithSalt(plainPassword, salt),
    passwordSalt: salt,
    updatedAtIso: new Date().toISOString(),
  };
}

export function verifyPasswordAgainstAuth(
  candidate: string,
  auth: AdminAuthStored | null | undefined
): boolean {
  if (!candidate || !auth?.passwordHash || !auth?.passwordSalt) return false;
  const computedHex = hashPasswordWithSalt(candidate, auth.passwordSalt);
  const a = Buffer.from(computedHex, 'hex');
  const b = Buffer.from(auth.passwordHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function loadDefaultMasterPlanFromString(csvContent = DEFAULT_MASTER_PLAN_CSV) {
  return parseMasterPlanCsv(csvContent);
}

export function normalizeRecords(records: PlanningRecord[]): PlanningRecord[] {
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

export function normalizeRecipients(
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

export function buildInitialWorkspaceData(options: {
  csvContent?: string;
  initialAdminPassword?: string;
  recoveryEmail?: string;
}): PersistedWorkspaceData {
  const parsed = loadDefaultMasterPlanFromString(options.csvContent ?? DEFAULT_MASTER_PLAN_CSV);
  const envPass = (options.initialAdminPassword || '').trim();
  const envRecovery = (options.recoveryEmail || '').trim().toLowerCase();
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
    adminAuth: envPass.length >= 6 ? createPasswordRecord(envPass) : null,
  };
}

export function hydrateWorkspaceData(
  parsed: Partial<PersistedWorkspaceData> | null | undefined,
  options: {
    initialAdminPassword?: string;
    recoveryEmail?: string;
  } = {}
): { state: PersistedWorkspaceData; needsSave: boolean } | null {
  if (!parsed?.meta || !Array.isArray(parsed?.records) || parsed.records.length === 0) {
    return null;
  }
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
  const envPass = (options.initialAdminPassword || '').trim();
  const resolvedAuth: AdminAuthStored | null = hasAdminAuth
    ? (parsed.adminAuth as AdminAuthStored)
    : envPass.length >= 6
      ? createPasswordRecord(envPass)
      : null;

  const envRecovery = (options.recoveryEmail || '').trim().toLowerCase();
  const hydratedSiteConfig: WebsiteControlConfig = {
    ...DEFAULT_WEBSITE_CONTROL_CONFIG,
    ...(parsed.siteConfig ?? {}),
  };
  if (!hydratedSiteConfig.recoveryEmail && envRecovery) {
    hydratedSiteConfig.recoveryEmail = envRecovery;
  }

  const state: PersistedWorkspaceData = {
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
    siteConfig: hydratedSiteConfig,
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
    adminAuth: resolvedAuth,
  };

  return {
    state,
    needsSave: !hasAdminAuth && Boolean(resolvedAuth),
  };
}

export function getSyncVersionFromState(state: PersistedWorkspaceData): SyncVersionSnapshot {
  return {
    version: state.updatedAtIso,
    referenceDateIso: state.referenceDateIso,
    cuttingUpdatedAtIso: state.cuttingSheetSync?.lastUpdatedAtIso ?? null,
    cuttingCheckedAtIso: state.cuttingSheetSync?.lastCheckedAtIso ?? null,
  };
}

export function getPublicWorkspaceFromState(state: PersistedWorkspaceData, isAdmin = false) {
  const needsInitialSetup = !(state.adminAuth?.passwordHash && state.adminAuth?.passwordSalt);

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

export function getPublicMasterPlanFromState(
  state: PersistedWorkspaceData,
  factoryFilter?: FactoryName
): PublicMasterPlanResponse {
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

export function getPublicFoNeededFromState(
  state: PersistedWorkspaceData,
  factoryFilter?: FactoryName | null
): PublicFoNeededResponse {
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

export function buildSafetyBackupPayload(state: PersistedWorkspaceData) {
  return {
    meta: state.meta,
    records: state.records,
    cuttingEntries: state.cuttingEntries,
    referenceDateIso: state.referenceDateIso,
    reminders: state.reminders,
    siteConfig: state.siteConfig,
    cuttingSheetSync: state.cuttingSheetSync,
  };
}

export function applyOutputQtyPatchToState(
  current: PersistedWorkspaceData,
  recordIds: string[],
  outputQty: number | null
): {
  nextState: PersistedWorkspaceData;
  updatedCount: number;
  updatedAtIso: string;
  records: PlanningRecord[];
} {
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

  if (updatedCount === 0) {
    return {
      nextState: current,
      updatedCount: 0,
      updatedAtIso: current.updatedAtIso,
      records: nextRecords,
    };
  }

  const nextState: PersistedWorkspaceData = {
    ...current,
    records: nextRecords,
    hasCustomEdits: true,
    updatedAtIso: nowIso,
  };
  return {
    nextState,
    updatedCount,
    updatedAtIso: nowIso,
    records: nextRecords,
  };
}

export function applyPackingQtyPatchToState(
  current: PersistedWorkspaceData,
  recordIds: string[],
  packingQty: number | null
): {
  nextState: PersistedWorkspaceData;
  updatedCount: number;
  updatedAtIso: string;
  records: PlanningRecord[];
} {
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

  if (updatedCount === 0) {
    return {
      nextState: current,
      updatedCount: 0,
      updatedAtIso: current.updatedAtIso,
      records: nextRecords,
    };
  }

  const nextState: PersistedWorkspaceData = {
    ...current,
    records: nextRecords,
    hasCustomEdits: true,
    updatedAtIso: nowIso,
  };
  return {
    nextState,
    updatedCount,
    updatedAtIso: nowIso,
    records: nextRecords,
  };
}

export function applySyncedCuttingToState(
  current: PersistedWorkspaceData,
  params: {
    syncedEntries?: DailyCuttingEntry[];
    replaceSheetEntries: boolean;
    scopedFactories?: FactoryName[];
    recordUpdates?: RecordSheetPatch[];
    syncPatch: Partial<CuttingSheetSyncConfig>;
    logEntry?: CuttingSheetSyncLog;
  }
): PersistedWorkspaceData {
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
        if (!isPrimary && upd.outputQty !== undefined && upd.outputQty !== null) {
          clearDuplicateOutputIds.add(rid);
        }
        if (!isPrimary && upd.packingQty !== undefined && upd.packingQty !== null) {
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
            upd.plannedQty !== undefined && upd.plannedQty !== null
              ? upd.plannedQty
              : prev.plannedQty,
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
          nextReleased &&
          (rec.foIssueQty === null || rec.foIssueQty === undefined) &&
          nextPlanned !== null
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
      params.syncPatch.lastTotalQty !== undefined ? params.syncPatch.lastTotalQty : totalSheetQty,
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

  const hashChanged =
    params.syncPatch.lastContentHash !== undefined &&
    params.syncPatch.lastContentHash !== current.cuttingSheetSync.lastContentHash;
  const statusChanged =
    params.syncPatch.lastStatus !== undefined &&
    params.syncPatch.lastStatus !== current.cuttingSheetSync.lastStatus;
  const hasRealChange =
    params.replaceSheetEntries ||
    recordsModified ||
    hashChanged ||
    statusChanged ||
    params.logEntry?.status === 'Updated' ||
    params.logEntry?.status === 'Error';

  return {
    ...current,
    records: nextRecords,
    cuttingEntries: nextEntries,
    hasCustomEdits:
      params.replaceSheetEntries || recordsModified ? true : current.hasCustomEdits,
    updatedAtIso: hasRealChange ? new Date().toISOString() : current.updatedAtIso,
    cuttingSheetSync: nextSync,
  };
}

export function hasConfiguredSheetLinks(cfg: CuttingSheetSyncConfig): boolean {
  return (
    Boolean((cfg.sheetUrl || '').trim()) ||
    Boolean((cfg.outputSheetUrl || '').trim()) ||
    Boolean((cfg.packingSheetUrl || '').trim()) ||
    Object.values(cfg.factoryUrls || {}).some((v) => typeof v === 'string' && Boolean(v.trim())) ||
    Object.values(cfg.outputFactoryUrls || {}).some(
      (v) => typeof v === 'string' && Boolean(v.trim())
    ) ||
    Object.values(cfg.packingFactoryUrls || {}).some(
      (v) => typeof v === 'string' && Boolean(v.trim())
    )
  );
}

export function removeCuttingSheetLinkFromConfig(
  current: CuttingSheetSyncConfig,
  target: { role: CuttingSheetLinkRole; scope: CuttingSheetLinkScope }
): CuttingSheetSyncConfig {
  const nextFactoryUrls = { ...(current.factoryUrls ?? {}) };
  const nextOutputFactoryUrls = { ...(current.outputFactoryUrls ?? {}) };
  const nextPackingFactoryUrls = { ...(current.packingFactoryUrls ?? {}) };
  const nextFactoryStatuses = { ...(current.factoryStatuses ?? {}) };
  let nextSheetUrl = current.sheetUrl || '';
  let nextOutputSheetUrl = current.outputSheetUrl || '';
  let nextPackingSheetUrl = current.packingSheetUrl || '';

  if (target.role === 'cutting') {
    if (target.scope === 'combined') {
      nextSheetUrl = '';
    } else {
      delete nextFactoryUrls[target.scope];
      delete nextFactoryStatuses[target.scope];
    }
  } else if (target.role === 'output') {
    if (target.scope === 'combined') {
      nextOutputSheetUrl = '';
    } else {
      delete nextOutputFactoryUrls[target.scope];
    }
  } else if (target.role === 'packing') {
    if (target.scope === 'combined') {
      nextPackingSheetUrl = '';
    } else {
      delete nextPackingFactoryUrls[target.scope];
    }
  }

  const nextSync: CuttingSheetSyncConfig = {
    ...current,
    sheetUrl: nextSheetUrl,
    factoryUrls: nextFactoryUrls,
    outputSheetUrl: nextOutputSheetUrl,
    outputFactoryUrls: nextOutputFactoryUrls,
    packingSheetUrl: nextPackingSheetUrl,
    packingFactoryUrls: nextPackingFactoryUrls,
    factoryStatuses: nextFactoryStatuses,
    lastContentHash: '',
  };

  const stillHasLinks = hasConfiguredSheetLinks(nextSync);
  if (!stillHasLinks) {
    nextSync.enabled = false;
    nextSync.lastStatus = 'Idle';
    nextSync.lastMessage = 'All online sheet links removed.';
  } else {
    nextSync.lastMessage = `Removed ${target.scope === 'combined' ? 'Combined' : target.scope} ${target.role} link. Remaining links remain active.`;
  }

  return nextSync;
}

export function applySnapshotRestoreToState(
  current: PersistedWorkspaceData,
  snapshot: {
    meta: MasterPlanMeta;
    records: PlanningRecord[];
    cuttingEntries?: DailyCuttingEntry[];
    referenceDateIso?: string;
    reminders?: Partial<ReminderWorkspaceState>;
    siteConfig?: Partial<WebsiteControlConfig>;
    cuttingSheetSync?: Partial<CuttingSheetSyncConfig>;
  }
): PersistedWorkspaceData {
  const mergedSchedule: ReminderScheduleConfig = {
    ...DEFAULT_REMINDER_SCHEDULE,
    ...current.reminders.schedule,
    ...(snapshot.reminders?.schedule ?? {}),
  };
  return {
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
}

export function appendDeliveryLogToState(
  current: PersistedWorkspaceData,
  log: ReminderDeliveryLog
): PersistedWorkspaceData {
  const nextReminders: ReminderWorkspaceState = {
    ...current.reminders,
    logs: [log, ...current.reminders.logs].slice(0, 50),
  };
  return {
    ...current,
    updatedAtIso: new Date().toISOString(),
    reminders: nextReminders,
  };
}
