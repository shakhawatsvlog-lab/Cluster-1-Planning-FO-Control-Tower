import { apiUrl } from './apiBase.ts';

export const BACKGROUND_SYNC_INTERVAL_MS = 15_000;
export const SYNC_FOCUS_COOLDOWN_MS = 2_500;
export const SYNC_REQUEST_TIMEOUT_MS = 12_000;
export const HEALTH_PROBE_TIMEOUT_MS = 5_000;
export const PROGRESSIVE_BACKOFF_STEPS_MS = [2000, 4000, 8000, 15000, 30000] as const;

export class HttpStatusError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function isColdStartOrNetworkFailure(err: unknown): boolean {
  if (isBrowserOffline()) {
    return true;
  }
  if (err instanceof HttpStatusError) {
    return (
      err.status === 502 ||
      err.status === 503 ||
      err.status === 504 ||
      (err.status >= 520 && err.status <= 524)
    );
  }
  if (err instanceof TypeError) {
    return true;
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('load failed') ||
      msg.includes('network request failed') ||
      msg.includes('timed out')
    );
  }
  return false;
}

export function getProgressiveBackoffDelayMs(attemptIndex: number): number {
  const safeIdx = Math.max(0, Math.min(attemptIndex, PROGRESSIVE_BACKOFF_STEPS_MS.length - 1));
  return PROGRESSIVE_BACKOFF_STEPS_MS[safeIdx];
}

export async function probeServerHealth(parentSignal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) return false;
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl('/api/health'), {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const payload = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(payload?.ok);
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

export function formatCurrentTimeLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
