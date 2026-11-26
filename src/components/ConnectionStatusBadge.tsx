import { RefreshCw, WifiOff } from 'lucide-react';

export type SyncConnectionState = 'connected' | 'syncing' | 'reconnecting' | 'offline';

interface ConnectionStatusBadgeProps {
  status: SyncConnectionState;
  lastSyncedAt?: string | null;
  retryInSeconds?: number | null;
}

export function ConnectionStatusBadge({
  status,
  lastSyncedAt = null,
  retryInSeconds = null,
}: ConnectionStatusBadgeProps) {
  const config =
    status === 'syncing'
      ? {
          label: 'Syncing',
          pillClass: 'border-cyan-200 bg-cyan-50/90 text-cyan-900',
          dotClass: 'bg-cyan-600',
          title: 'Checking for updated planning data...',
        }
      : status === 'reconnecting'
        ? {
            label:
              retryInSeconds && retryInSeconds > 0
                ? `Reconnecting (${retryInSeconds}s)`
                : 'Reconnecting',
            pillClass: 'border-amber-300/90 bg-amber-50/95 text-amber-900',
            dotClass: 'bg-amber-500 animate-pulse',
            title: 'Server is waking up or temporarily unreachable. Reconnecting automatically...',
          }
        : status === 'offline'
          ? {
              label: 'Offline',
              pillClass: 'border-rose-200 bg-rose-50/95 text-rose-800',
              dotClass: 'bg-rose-500',
              title: 'No network connection. Background sync will resume automatically when online.',
            }
          : {
              label: 'Connected',
              pillClass: 'border-emerald-200/90 bg-white/95 text-slate-700',
              dotClass: 'bg-emerald-500',
              title: lastSyncedAt
                ? `Server connected · Last synced at ${lastSyncedAt}`
                : 'Server connection active (15s smart background sync)',
            };

  return (
    <div
      role="status"
      aria-live="polite"
      title={config.title}
      className={`h-8 sm:h-9 px-2.5 rounded-lg border text-[11px] sm:text-xs font-medium inline-flex items-center gap-1.5 shadow-2xs transition-colors whitespace-nowrap shrink-0 ${config.pillClass}`}
    >
      {status === 'syncing' ? (
        <RefreshCw className="w-3 h-3 text-cyan-700 animate-spin shrink-0" />
      ) : status === 'offline' ? (
        <WifiOff className="w-3 h-3 text-rose-600 shrink-0" />
      ) : (
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${config.dotClass}`}
          aria-hidden="true"
        />
      )}
      <span className="tabular-nums">{config.label}</span>
    </div>
  );
}
