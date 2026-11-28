import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { APP_RELEASE, getEffectiveReleaseKey } from '../shared/releaseInfo.ts';

const SEEN_RELEASE_STORAGE_KEY = 'alex_apparels_seen_release_v1';

function readSeenReleaseKey(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(SEEN_RELEASE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSeenReleaseKey(key: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SEEN_RELEASE_STORAGE_KEY, key);
  } catch {
    // Ignore storage errors in restricted browsing modes
  }
}

export function SystemUpdatePopup() {
  const releaseKey = getEffectiveReleaseKey();
  const [showUpdatedPopup, setShowUpdatedPopup] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(() =>
    typeof window !== 'undefined' ? Boolean(window.__alexSwUpdateReady) : false,
  );

  useEffect(() => {
    const seen = readSeenReleaseKey();
    if (seen !== releaseKey) {
      const timer = window.setTimeout(() => {
        setShowUpdatedPopup(true);
      }, 550);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [releaseKey]);

  useEffect(() => {
    const handleSwUpdate = () => {
      setSwUpdateAvailable(true);
    };
    window.addEventListener('alex:sw-update-ready', handleSwUpdate);
    return () => {
      window.removeEventListener('alex:sw-update-ready', handleSwUpdate);
    };
  }, []);

  const handleDismiss = () => {
    writeSeenReleaseKey(releaseKey);
    setShowUpdatedPopup(false);
  };

  const handleApplySwUpdate = () => {
    if (typeof window.__alexApplySwUpdate === 'function') {
      window.__alexApplySwUpdate();
    } else {
      window.location.reload();
    }
  };

  if (!showUpdatedPopup && !swUpdateAvailable) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[430px] z-[60] pointer-events-none flex flex-col gap-2.5"
      role="region"
      aria-label="System update notification"
    >
      {swUpdateAvailable && (
        <div className="pointer-events-auto rounded-2xl bg-white/95 backdrop-blur-md border border-teal-200 shadow-[0_20px_50px_-12px_rgba(10,22,51,0.28)] overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="h-[3px] bg-gradient-to-r from-teal-600 via-cyan-500 to-emerald-500" />
          <div className="p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-700 to-cyan-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <RefreshCw className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-950">
                    New Update Deployed
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    A newer version is ready. Load it now to see the latest changes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSwUpdateAvailable(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                  aria-label="Dismiss refresh prompt"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleApplySwUpdate}
                  className="h-9 px-3.5 rounded-xl bg-gradient-to-r from-teal-700 to-cyan-600 hover:brightness-110 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Load New Version</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUpdatedPopup && (
        <div
          role="dialog"
          aria-labelledby="system-updated-popup-title"
          className="pointer-events-auto rounded-2xl bg-white/95 backdrop-blur-md border border-cyan-200/90 shadow-[0_22px_54px_-12px_rgba(10,22,51,0.3)] overflow-hidden transition-all"
        >
          <div className="h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-teal-500" />
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0a1633] via-[#102652] to-[#0891b2] text-white flex items-center justify-center shrink-0 shadow-[0_8px_18px_-6px_rgba(8,145,178,0.5)]">
                <Sparkles className="w-4 h-4 text-cyan-200" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        id="system-updated-popup-title"
                        className="font-display text-sm font-bold text-slate-950"
                      >
                        {APP_RELEASE.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-[10px] font-semibold">
                        {APP_RELEASE.version}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                      Deployed {APP_RELEASE.releasedAt}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDismiss}
                    className="p-1.5 -mr-1 -mt-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
                    aria-label="Close system update notice"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  {APP_RELEASE.subtitle}
                </p>
              </div>
            </div>

            {/* Expandable See Details section with arrow sign */}
            <div className="border-t border-slate-200/80 pt-2.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsExpanded((v) => !v)}
                  aria-expanded={detailsExpanded}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-800 hover:text-cyan-950 py-1 px-1.5 -ml-1.5 rounded-lg hover:bg-cyan-50/80 cursor-pointer transition-colors"
                >
                  {detailsExpanded ? (
                    <ChevronDown className="w-4 h-4 text-cyan-700 transition-transform duration-200" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-cyan-700 transition-transform duration-200" />
                  )}
                  <span>{detailsExpanded ? 'Hide details' : 'See details'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDismiss}
                  className="h-8 px-3.5 rounded-xl bg-gradient-to-r from-[#0a1633] via-[#102652] to-[#0891b2] hover:brightness-110 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-200" />
                  <span>Got it</span>
                </button>
              </div>

              {detailsExpanded && (
                <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                  {APP_RELEASE.highlights.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-xl bg-slate-50/90 border border-slate-200/80 px-3 py-2.5 space-y-1"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-cyan-50 border border-cyan-200/80 text-cyan-900 text-[10px] font-semibold">
                          {item.category}
                        </span>
                        <span className="text-xs font-semibold text-slate-900">
                          {item.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
