import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseMasterPlanCsv } from '../shared/plannerTypes.ts';
import type {
  DailyCuttingEntry,
  MasterPlanMeta,
  OrderStatus,
  PlanningRecord,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const MASTER_CSV_PATH = path.resolve(
  ROOT_DIR,
  'public/assets/aistudio/11-19_updated_a06c9227.csv'
);
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
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
  adminAuth: AdminAuthStored;
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

function getDefaultInitialAdminAuth(): AdminAuthStored {
  const initialPass = process.env.ADMIN_PANEL_DEFAULT_PASSWORD || '00814020#Ss';
  return createPasswordRecord(initialPass);
}

export function loadDefaultMasterPlan() {
  const csvContent = fs.readFileSync(MASTER_CSV_PATH, 'utf8');
  return parseMasterPlanCsv(csvContent);
}

function normalizeRecords(records: PlanningRecord[]): PlanningRecord[] {
  return records.map((r) => ({
    ...r,
    orderStatus: (r.orderStatus ?? (r.isFinished ? 'Order Closed' : 'Open')) as OrderStatus,
    isFinished: r.orderStatus === 'Order Closed' || Boolean(r.isFinished),
  }));
}

function createInitialState(): PersistedWorkspaceData {
  const parsed = loadDefaultMasterPlan();
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
    siteConfig: { ...DEFAULT_WEBSITE_CONTROL_CONFIG },
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
            recipients: Array.isArray(parsed.reminders?.recipients)
              ? parsed.reminders.recipients
              : [],
            schedule: {
              ...DEFAULT_REMINDER_SCHEDULE,
              ...(parsed.reminders?.schedule ?? {}),
            },
            logs: Array.isArray(parsed.reminders?.logs) ? parsed.reminders.logs : [],
          },
          smtpConfig: parsed.smtpConfig ?? null,
          siteConfig: {
            ...DEFAULT_WEBSITE_CONTROL_CONFIG,
            ...(parsed.siteConfig ?? {}),
          },
          adminAuth: hasAdminAuth
            ? (parsed.adminAuth as AdminAuthStored)
            : getDefaultInitialAdminAuth(),
        };
        if (!hasAdminAuth) {
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

export function getPublicWorkspaceState() {
  const state = getWorkspaceState();
  return {
    meta: state.meta,
    records: state.records,
    cuttingEntries: state.cuttingEntries,
    referenceDateIso: state.referenceDateIso,
    hasCustomEdits: state.hasCustomEdits,
    updatedAtIso: state.updatedAtIso,
    reminders: state.reminders,
    siteConfig: state.siteConfig,
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

export function verifyAdminPassword(candidate: string): boolean {
  if (!candidate) return false;
  const auth = getWorkspaceState().adminAuth;
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
