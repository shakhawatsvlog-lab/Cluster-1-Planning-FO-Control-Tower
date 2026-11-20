import type { FactoryName } from './plannerTypes.ts';

export type ReminderAlertScope = 'urgent_and_due_soon' | 'urgent_only' | 'all_lines';

export type SmtpProviderPreset = 'gmail' | 'outlook' | 'custom';

export interface ReminderRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
  factories: FactoryName[]; // Empty array means all 4 factories
  active: boolean;
  addedAtIso: string;
}

export interface ReminderScheduleConfig {
  enabled: boolean;
  dailySendTime: string; // 24h HH:mm format, e.g. "08:30"
  timezone: string; // IANA timezone, e.g. "Africa/Cairo", "Asia/Dhaka"
  alertScope: ReminderAlertScope;
  lastSentDateLocal: string | null; // YYYY-MM-DD in configured timezone
  lastAttemptIso: string | null;
}

export interface ReminderDeliveryLog {
  id: string;
  sentAtIso: string;
  triggerType: 'Automatic Daily' | 'Manual Send';
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
  lastSentDateLocal: null,
  lastAttemptIso: null,
};

export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'Africa/Cairo', label: 'Egypt (Africa/Cairo · GMT+2)' },
  { value: 'Asia/Dhaka', label: 'Bangladesh (Asia/Dhaka · GMT+6)' },
  { value: 'Asia/Dubai', label: 'UAE (Asia/Dubai · GMT+4)' },
  { value: 'Europe/London', label: 'UK (Europe/London)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
