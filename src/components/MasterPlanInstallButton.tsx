import { useState } from 'react';
import { Check, CheckCircle2, Copy, Download, Info, Smartphone, X } from 'lucide-react';
import { usePWAInstall, type BrowserInstallEnvironment } from '../hooks/usePWAInstall.ts';

function getBrowserInstructions(browserKind: BrowserInstallEnvironment): {
  title: string;
  subtitle: string;
  steps: string[];
} {
  switch (browserKind) {
    case 'ios-safari':
      return {
        title: 'Install Alpine Master Plan on iPhone / iPad',
        subtitle: 'Add the Master Plan directly to your Home Screen via Safari.',
        steps: [
          'Tap the Share button at the bottom or top toolbar of Safari.',
          'Scroll down and select Add to Home Screen.',
          'Confirm the name as Master Plan and tap Add.',
        ],
      };
    case 'ios-other':
      return {
        title: 'Install Alpine Master Plan on iOS',
        subtitle: 'iOS requires Safari to install Home Screen web applications.',
        steps: [
          'Copy the Master Plan link below and open it in Apple Safari.',
          'Tap the Share icon in the Safari toolbar.',
          'Select Add to Home Screen, confirm Master Plan, and tap Add.',
        ],
      };
    case 'android-chrome':
      return {
        title: 'Install Alpine Master Plan on Android',
        subtitle: 'Install from your browser menu to launch directly into Master Plan.',
        steps: [
          'Tap the browser menu icon (three dots) in the top-right corner of Chrome.',
          'Select Install app or Add to Home screen.',
          'Confirm Alpine Master Plan to place the shortcut on your launcher.',
        ],
      };
    case 'desktop-safari':
      return {
        title: 'Install Alpine Master Plan on Mac Safari',
        subtitle: 'Add Master Plan to your macOS Dock using Safari.',
        steps: [
          'Open the File menu in the top Safari menu bar (or click Share).',
          'Choose Add to Dock.',
          'Keep the name Alpine Master Plan and click Add.',
        ],
      };
    case 'firefox':
      return {
        title: 'Install Alpine Master Plan',
        subtitle: 'Firefox desktop does not offer one-click PWA prompts.',
        steps: [
          'Copy the Master Plan link below and open it in Google Chrome or Microsoft Edge.',
          'Click the Install icon in the address bar (or Menu -> Install Alpine Master Plan).',
          'Or bookmark this direct /master-plan URL for quick read-only access.',
        ],
      };
    case 'desktop-chrome-edge':
    default:
      return {
        title: 'Install Alpine Master Plan App',
        subtitle: 'Install from Chrome or Edge to open directly at the Master Plan view.',
        steps: [
          'Click the Install app icon on the right side of the browser address bar, or open the browser menu (three dots).',
          'Choose Apps -> Install Alpine Master Plan (or Cast, save, and share -> Install page as app).',
          'If viewing inside an embedded preview frame, copy the Master Plan link below and open it in a dedicated browser tab first.',
        ],
      };
  }
}

export function MasterPlanInstallButton() {
  const { isInstallable, isInstalled, isIOS, browserKind, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const masterPlanUrl =
    typeof window !== 'undefined' ? window.location.href : '/master-plan';

  const handleCopyUrl = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(masterPlanUrl);
        setCopiedUrl(true);
        window.setTimeout(() => setCopiedUrl(false), 2200);
      }
    } catch {
      // Ignore clipboard permission errors
    }
  };

  if (isInstalled) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title="Running as installed Alpine Master Plan app"
          className="h-9 px-3 rounded-lg border border-teal-300/85 bg-teal-50/90 text-teal-900 hover:bg-teal-100/80 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
          <span className="hidden sm:inline">App Installed</span>
          <span className="sm:hidden">Installed</span>
        </button>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm ct-surface rounded-2xl p-5 shadow-2xl space-y-3 relative overflow-hidden">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-teal-500"
              />
              <div className="flex items-start justify-between gap-2 pt-1">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-teal-700 shrink-0" />
                  <h3 className="font-display text-sm font-bold text-slate-950">
                    Alpine Master Plan Installed
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  aria-label="Close app status dialog"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                You are viewing the installed standalone <strong>Alpine Master Plan</strong> app. It opens directly into the read-only Four-Factory schedule with live updates enabled.
              </p>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="w-full h-9 rounded-lg bg-[#0a1633] hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  const handleClick = async () => {
    if (isInstallable) {
      setInstalling(true);
      try {
        const accepted = await install();
        if (!accepted) {
          setShowModal(false);
        }
      } finally {
        setInstalling(false);
      }
      return;
    }
    setShowModal(true);
  };

  const instructions = getBrowserInstructions(browserKind);

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={installing}
        title={
          isInstallable
            ? 'Install Alpine Master Plan directly on your device'
            : 'View installation steps for your browser'
        }
        className="h-9 px-3 rounded-lg border border-cyan-500/40 bg-white/95 hover:bg-cyan-50/75 hover:border-cyan-600 text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-all whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
      >
        {isIOS ? (
          <Smartphone className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
        ) : (
          <Download className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
        )}
        <span className="hidden md:inline">
          {installing ? 'Installing...' : 'Install Master Plan App'}
        </span>
        <span className="md:hidden">{installing ? '...' : 'Install App'}</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4">
          <div className="w-full max-w-md ct-surface rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 relative overflow-hidden">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-teal-500"
            />
            <div className="flex items-start justify-between gap-3 pt-1">
              <div className="flex items-center gap-3">
                <img
                  src={`${import.meta.env.BASE_URL}master-plan-192x192.png`}
                  alt="Alpine Master Plan"
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl border border-cyan-500/30 shrink-0"
                />
                <div>
                  <h3 className="font-display text-sm sm:text-base font-bold text-slate-950">
                    {instructions.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">{instructions.subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                aria-label="Close installation guide"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="space-y-2.5 text-xs text-slate-700 list-decimal list-inside bg-slate-50/90 border border-slate-200/80 rounded-xl p-3.5">
              {instructions.steps.map((step, i) => (
                <li key={i} className="leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>

            <div className="flex items-start gap-2 text-[11px] text-slate-500">
              <Info className="w-3.5 h-3.5 text-cyan-700 shrink-0 mt-0.5" />
              <span>
                Installed app name: <strong>Alpine Master Plan</strong> · Opens directly at{' '}
                <span className="font-mono text-slate-700">/master-plan</span> (Read-Only).
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleCopyUrl()}
                className="flex-1 h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-teal-700" />
                    <span>Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-cyan-700" />
                    <span>Copy Master Plan Link</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-9 px-4 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
