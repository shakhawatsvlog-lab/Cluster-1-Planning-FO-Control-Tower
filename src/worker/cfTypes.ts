export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: {
    duration?: number;
    changes?: number;
    last_row_id?: number;
    changed_db?: boolean;
    size_after?: number;
    rows_read?: number;
    rows_written?: number;
  };
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[]
  ): Promise<D1Result<T>[]>;
}

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
  noRetry?: () => void;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface WorkerEnv {
  DB: D1Database;
  NODE_ENV?: string;
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  AI_ENABLED?: string;
  EMAIL_ENABLED?: string;
  EMAIL_FROM?: string;
  SESSION_SECRET?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_RECOVERY_EMAIL?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_WEBHOOK_URL?: string;
  EMAIL_WEBHOOK_SECRET?: string;
}
