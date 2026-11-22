import type { FactoryName } from './plannerTypes.ts';

export type ReminderAlertScope = 'urgent_and_due_soon' | 'urgent_only' | 'all_lines';

export type RecipientFrequency = 'daily' | 'weekly' | 'monthly';

export type SmtpProviderPreset = 'gmail' | 'outlook' | 'custom';

export interface ReminderRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
  factories: FactoryName[]; // Empty array means all 4 factories
  active: boolean;
  frequency: RecipientFrequency;
  sendTime: string; // 24h HH:mm format, e.g. "08:30"
  dayOfWeek: number; // 0 (Sun) .. 6 (Sat) for weekly
  dayOfMonth: number; // 1 .. 31 for monthly
  lastSentDateLocal: string | null; // YYYY-MM-DD in configured timezone
  customNote?: string;
  addedAtIso: string;
}

export interface ReminderScheduleConfig {
  enabled: boolean;
  dailySendTime: string; // Default 24h HH:mm format, e.g. "08:30"
  timezone: string; // IANA timezone, e.g. "Africa/Cairo", "Asia/Dhaka"
  alertScope: ReminderAlertScope;
  customMessage: string; // Manual custom text/note sent with email digest
  lastSentDateLocal: string | null; // YYYY-MM-DD in configured timezone
  lastAttemptIso: string | null;
}

export interface ReminderDeliveryLog {
  id: string;
  sentAtIso: string;
  triggerType: 'Automatic Daily' | 'Automatic Scheduled' | 'Manual Send';
  recipientCount: number;
  recipients: string[];
  urgentLineCount: number;
  dueSoonLineCount: number;
  cutting10dCount: number;
  status: 'Sent' | 'Failed' | 'SMTP Not Configured';
  message: string;
}

export interface ReminderWorkspaceState {
  recipients: ReminderRecipient[];
  schedule: ReminderScheduleConfig;
  logs: ReminderDeliveryLog[];
}

export interface SmtpSettingsPublic {
  configured: boolean;
  source: 'workspace' | 'env' | 'none';
  providerPreset: SmtpProviderPreset;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  hasPassword: boolean;
  // Backward-compatible alias used in UI summaries
  senderEmail: string | null;
}

export type SmtpStatusInfo = SmtpSettingsPublic;

export const DEFAULT_REMINDER_SCHEDULE: ReminderScheduleConfig = {
  enabled: true,
  dailySendTime: '08:30',
  timezone: 'Africa/Cairo',
  alertScope: 'urgent_and_due_soon',
  customMessage: '',
  lastSentDateLocal: null,
  lastAttemptIso: null,
};

export const WEEKDAY_OPTIONS: Array<{ value: number; label: string; short: string }> = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
];

export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Africa/Cairo', label: 'Egypt (Africa/Cairo · GMT+2)' },
  { value: 'Asia/Dhaka', label: 'Bangladesh (Asia/Dhaka · GMT+6)' },
  { value: 'Asia/Dubai', label: 'UAE (Asia/Dubai · GMT+4)' },
  { value: 'Europe/London', label: 'UK (Europe/London)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export const DEFAULT_SAVED_FO_EMAIL_BODY = [
  'Dear Fabric & Merchandising Team,',
  '',
  'Please find below the selected Upcoming Fabric Order (FO) requirements prioritized from our Cluster 1 Production Planning Control Tower.',
  '',
  'Action Requested:',
  '1. Review each listed PG#, Style, and Order Qty and confirm fabric booking/issuance.',
  '2. Raise the Fabric Order (FO) on or before the indicated "FO Date Needed" so fabric arrives before line input start.',
  '3. Reply with the FO# and confirmed Ex-Mill / In-House delivery dates.',
  '',
  'The formatted Excel sheet (.xlsx) is attached for easy filtering and follow-up.',
  '',
  'Best regards,',
  'Production Planning Team',
  'Alex Apparels (Cluster 1)',
].join('\n');

export function buildDefaultSavedFoEmailSubject(
  itemCount: number,
  referenceDateIso: string
): string {
  return `[Alex Apparels] Selected Upcoming FO Requirement (${itemCount} ${
    itemCount === 1 ? 'Style' : 'Styles'
  } · ${referenceDateIso})`;
}

