import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Wifi } from 'lucide-react';
import {
  getProgressiveBackoffDelayMs,
  isBrowserOffline,
  probeServerHealth,
} from '../lib/syncClient.ts';

const WAKEUP_TOTAL_SECONDS = 90;

interface BackendWakeupPanelProps {
  onReconnected: () => void;
  onManualRetry: () => void;
  isRetrying?: boolean;
}

function formatMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function BackendWakeupPanel({
  onReconnected,
  onManualRetry,
  isRetrying = false,
}: BackendWakeupPanelProps) {
  const [secondsLeft, setSecondsLeft] = useState(WAKEUP_TOTAL_SECONDS);
  const [attemptCount, setAttemptCount] = useState(0);
  const [nextProbeSeconds, setNextProbeSeconds] = useState<number>(2);
  const [retryCycle, setRetryCycle] = useState(0);
  const probeInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const secondsLeftRef = useRef(WAKEUP_TOTAL_SECONDS);
  const onReconnectedRef = useRef(onReconnected);

  useEffect(() => {
    onReconnectedRef.current = onReconnected;
  }, [onReconnected]);

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
  }, [secondsLeft]);

  useEffect(() => {
    mountedRef.current = true;
    const abortController = new AbortController();
    let nextProbeTimerId: number | null = null;
    let backoffIndex = 0;

    const countdownId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          secondsLeftRef.current = 0;
          return 0;
        }
        const next = prev - 1;
        secondsLeftRef.current = next;
        return next;
      });
      setNextProbeSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);

    const scheduleNextProbe = (delayMs: number) => {
      if (!mountedRef.current || secondsLeftRef.current <= 0) return;
      if (nextProbeTimerId !== null) {
        window.clearTimeout(nextProbeTimerId);
      }
      setNextProbeSeconds(Math.max(1, Math.ceil(delayMs / 1000)));
      nextProbeTimerId = window.setTimeout(() => {
        void runHealthProbe();
      }, delayMs);
    };

    const runHealthProbe = async () => {
      if (!mountedRef.current || secondsLeftRef.current <= 0) return;
      if (probeInFlightRef.current) return;

      if (isBrowserOffline()) {
        const delayMs = getProgressiveBackoffDelayMs(backoffIndex);
        backoffIndex += 1;
        scheduleNextProbe(delayMs);
        return;
      }

      probeInFlightRef.current = true;
      setAttemptCount((prev) => prev + 1);
      setNextProbeSeconds(0);

      try {
        const healthy = await probeServerHealth(abortController.signal);
        if (!mountedRef.current) return;
        if (healthy) {
          onReconnectedRef.current();
          return;
        }
      } finally {
        probeInFlightRef.current = false;
      }

      const delayMs = getProgressiveBackoffDelayMs(backoffIndex);
      backoffIndex += 1;
      scheduleNextProbe(delayMs);
    };

    // Start first probe cleanly with progressive backoff (2s -> 4s -> 8s -> 15s -> 30s)
    scheduleNextProbe(getProgressiveBackoffDelayMs(0));

    const handleOnline = () => {
      backoffIndex = 0;
      void runHealthProbe();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      mountedRef.current = false;
      window.clearInterval(countdownId);
      if (nextProbeTimerId !== null) {
        window.clearTimeout(nextProbeTimerId);
      }
      window.removeEventListener('online', handleOnline);
      abortController.abort();
    };
  }, [retryCycle]);

  const handleManualResetRetry = () => {
    setSecondsLeft(WAKEUP_TOTAL_SECONDS);
    secondsLeftRef.current = WAKEUP_TOTAL_SECONDS;
    setAttemptCount(0);
    setNextProbeSeconds(2);
    setRetryCycle((c) => c + 1);
    onManualRetry();
  };

  const progressPct = Math.round(
    ((WAKEUP_TOTAL_SECONDS - secondsLeft) / WAKEUP_TOTAL_SECONDS) * 100
  );
  const timerFinished = secondsLeft <= 0;

  return (
    <section
      aria-live="polite"
      aria-label="Reconnecting to Master Plan Server"
      className="ct-surface rounded-2xl border border-cyan-200/80 overflow-hidden shadow-lg max-w-3xl mx-auto"
    >
      {/* Top Robotics Status Bar */}
      <div className="bg-gradient-to-r from-[#07132c] via-[#0b2248] to-[#0a354b] px-5 sm:px-7 py-3.5 text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs font-medium text-cyan-100">
          <Wifi className="w-4 h-4 text-cyan-300" />
          <span>Alpine Master Plan Server Connection</span>
        </div>

        <div className="inline-flex items-center gap-2 bg-white/10 border border-cyan-300/25 px-3 py-1 rounded-lg">
          <span className="text-[11px] text-cyan-100/85">Wake-up countdown</span>
          <span className="font-mono font-bold text-sm text-cyan-200 tabular-nums">
            {formatMmSs(secondsLeft)}
          </span>
        </div>
      </div>

      <div className="p-6 sm:p-8 flex flex-col items-center text-center space-y-5 bg-gradient-to-b from-white to-slate-50/80">
        {/* Playful Corporate SVG Illustration: Mouse unplugging cable & confused Cat inspecting */}
        <div className="w-full max-w-[340px] rounded-2xl bg-gradient-to-br from-cyan-50/75 via-white to-teal-50/60 border border-cyan-200/60 p-4 shadow-inner">
          <svg
            viewBox="0 0 320 155"
            className="w-full h-auto"
            role="img"
            aria-label="Animated mouse unplugging the server cable while a confused cat inspects the plug"
          >
            <ellipse cx="160" cy="138" rx="126" ry="9" fill="rgba(10, 22, 51, 0.08)" />
            <rect
              x="16"
              y="72"
              width="34"
              height="60"
              rx="6"
              fill="#0a1633"
              stroke="#0891b2"
              strokeWidth="1.5"
            />
            <circle cx="27" cy="85" r="2.5" fill="#22d3ee" />
            <circle cx="38" cy="85" r="2.5" fill="#f59e0b" />
            <rect x="23" y="96" width="20" height="22" rx="3" fill="#1e293b" stroke="#38bdf8" strokeWidth="1" />

            <path
              d="M44 108 C 58 108, 62 124, 78 122 C 92 120, 98 112, 114 114"
              fill="none"
              stroke="#0891b2"
              strokeWidth="3.2"
              strokeLinecap="round"
            />

            <g className="mp-cable-spark">
              <circle cx="146" cy="112" r="5" fill="rgba(245, 158, 11, 0.25)" />
              <path
                d="M142 103 L145 109 M150 104 L147 110 M153 113 L147 113"
                stroke="#f59e0b"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>

            <path
              d="M156 115 C 174 118, 186 128, 206 126"
              fill="none"
              stroke="#0d9488"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeDasharray="4 3"
            />
            <rect x="148" y="109" width="12" height="10" rx="2" fill="#0f172a" />
            <line x1="143" y1="112" x2="148" y2="112" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="143" y1="116" x2="148" y2="116" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" />

            <g className="mp-mouse-tug">
              <path
                d="M72 118 C 58 114, 55 128, 45 123"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <ellipse cx="90" cy="118" rx="18" ry="12" fill="#64748b" />
              <ellipse cx="95" cy="120" rx="11" ry="8" fill="#94a3b8" />
              <circle cx="101" cy="107" r="6" fill="#475569" />
              <circle cx="101" cy="107" r="3.4" fill="#fca5a5" />
              <circle cx="105" cy="115" r="1.7" fill="#0f172a" />
              <circle cx="111" cy="118" r="2.2" fill="#fb7185" />
              <circle cx="112" cy="121" r="2.6" fill="#64748b" />
            </g>

            <g>
              <path
                className="mp-cat-tail"
                d="M273 125 C 294 122, 298 96, 286 92"
                fill="none"
                stroke="#0f2347"
                strokeWidth="7"
                strokeLinecap="round"
              />
              <ellipse cx="248" cy="111" rx="26" ry="23" fill="#1e3a5f" />
              <ellipse cx="244" cy="115" rx="13" ry="16" fill="#e2e8f0" />
              <ellipse cx="231" cy="131" rx="7" ry="4.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
              <ellipse cx="250" cy="132" rx="7" ry="4.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />

              <g className="mp-cat-head">
                <polygon points="222,68 228,44 242,60" fill="#0f2347" />
                <polygon points="226,64 230,50 238,60" fill="#7dd3fc" opacity="0.65" />
                <polygon points="247,59 261,44 267,68" fill="#0f2347" />
                <polygon points="251,59 259,50 263,64" fill="#7dd3fc" opacity="0.65" />
                <ellipse cx="244" cy="77" rx="24" ry="20" fill="#1e3a5f" />
                <circle cx="235" cy="75" r="4.2" fill="#ffffff" />
                <circle cx="253" cy="75" r="4.2" fill="#ffffff" />
                <circle cx="234.5" cy="75.5" r="2.1" fill="#0a1633" />
                <circle cx="252.5" cy="75.5" r="2.1" fill="#0a1633" />
                <circle cx="233.7" cy="74.6" r="0.8" fill="#22d3ee" />
                <circle cx="251.7" cy="74.6" r="0.8" fill="#22d3ee" />
                <polygon points="241,82 247,82 244,85" fill="#fda4af" />
                <path
                  d="M240 87 Q 244 89 248 87"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line x1="214" y1="78" x2="225" y2="80" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="214" y1="84" x2="225" y2="83" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="263" y1="80" x2="274" y2="78" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="263" y1="83" x2="274" y2="84" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
              </g>

              <g className="mp-cat-question">
                <rect
                  x="269"
                  y="24"
                  width="26"
                  height="24"
                  rx="8"
                  fill="#ffffff"
                  stroke="#0891b2"
                  strokeWidth="1.5"
                />
                <text
                  x="282"
                  y="41"
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="700"
                  fill="#0891b2"
                >
                  ?
                </text>
              </g>
            </g>
          </svg>
        </div>

        {/* Friendly Clear Copy */}
        <div className="space-y-1.5 max-w-md">
          <h2 className="font-display text-lg sm:text-xl font-bold text-slate-950">
            We&apos;re checking what happened...
          </h2>
          <p className="text-sm font-medium text-cyan-800">
            Our little team is reconnecting the server.
          </p>
          <p className="text-xs sm:text-sm text-slate-600">
            Please wait while we bring your Master Plan back online.
          </p>
        </div>

        {/* Progress Bar & Live Progressive Backoff Status */}
        <div className="w-full max-w-sm space-y-2">
          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#0a1633] via-cyan-600 to-teal-500 transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(4, progressPct))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
            <span>
              {timerFinished
                ? 'Initial wake-up window reached'
                : attemptCount > 0
                  ? `Checking server status (check #${attemptCount})...`
                  : 'Preparing reconnection check...'}
            </span>
            <span className="font-semibold text-slate-700">{formatMmSs(secondsLeft)}</span>
          </div>
        </div>

        {/* Manual Retry Action once 90s reaches 00:00 */}
        {timerFinished && (
          <div className="pt-1 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleManualResetRetry}
              disabled={isRetrying}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#0a1633] via-cyan-800 to-teal-700 hover:from-[#0f224d] hover:to-teal-600 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
              <span>Refresh / Try Again</span>
            </button>
            <span className="text-[11px] text-slate-500">
              Your selected factory and date filters will remain preserved.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
