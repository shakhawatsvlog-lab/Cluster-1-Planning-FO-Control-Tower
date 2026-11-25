import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  QrCode,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import type { FactoryName } from '../shared/plannerTypes.ts';
import type { NavTab } from './Sidebar.tsx';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import { DEFAULT_BACKEND_URL, stripTrailingSlashes } from '../lib/apiBase.ts';

interface AppLinkModalProps {
  open: boolean;
  onClose: () => void;
  appUrl: string;
  activeTab: NavTab;
  selectedFactory: FactoryName | 'ALL';
  portalTitle: string;
}

export function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => execCommandCopy(text));
  }
  return Promise.resolve(execCommandCopy(text));
}

function execCommandCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function resolveBaseAppLinks(appUrlFromServer: string): {
  currentOrigin: string;
  sharedTeamOrigin: string | null;
} {
  const basePath =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL.replace(/^\/+|\/+$/g, '')
      : '';
  const clientHost =
    typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin)
      ? stripTrailingSlashes(window.location.origin)
      : '';
  const clientOrigin = clientHost
    ? basePath
      ? `${clientHost}/${basePath}`
      : clientHost
    : '';
  const serverOrigin =
    appUrlFromServer && /^https?:\/\//i.test(appUrlFromServer)
      ? stripTrailingSlashes(appUrlFromServer)
      : stripTrailingSlashes(DEFAULT_BACKEND_URL);

  const currentOrigin = clientOrigin || serverOrigin;
  const isDevHost = /^https:\/\/ais-dev-/i.test(currentOrigin);
  const sharedTeamOrigin = isDevHost
    ? currentOrigin.replace(/^https:\/\/ais-dev-/i, 'https://ais-pre-')
    : null;

  return { currentOrigin, sharedTeamOrigin };
}

export function AppLinkModal({
  open,
  onClose,
  appUrl,
  activeTab,
  selectedFactory,
  portalTitle,
}: AppLinkModalProps) {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const { currentOrigin, sharedTeamOrigin } = useMemo(
    () => resolveBaseAppLinks(appUrl),
    [appUrl]
  );

  const [linkMode, setLinkMode] = useState<'team' | 'current'>(
    sharedTeamOrigin ? 'team' : 'current'
  );
  const [includeCurrentView, setIncludeCurrentView] = useState(false);
  const [copiedState, setCopiedState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (!sharedTeamOrigin && linkMode === 'team') {
      setLinkMode('current');
    }
  }, [sharedTeamOrigin, linkMode]);

  const baseSelectedOrigin =
    linkMode === 'team' && sharedTeamOrigin ? sharedTeamOrigin : currentOrigin;

  const generatedLink = useMemo(() => {
    if (!baseSelectedOrigin) return '';
    if (!includeCurrentView) return `${baseSelectedOrigin}/`;
    const params = new URLSearchParams();
    if (activeTab && activeTab !== 'dashboard') {
      params.set('tab', activeTab);
    }
    if (selectedFactory && selectedFactory !== 'ALL') {
      params.set('factory', selectedFactory);
    }
    const qs = params.toString();
    return qs ? `${baseSelectedOrigin}/?${qs}` : `${baseSelectedOrigin}/`;
  }, [baseSelectedOrigin, includeCurrentView, activeTab, selectedFactory]);

  useEffect(() => {
    if (!open || !generatedLink) return;
    let active = true;
    QRCode.toDataURL(generatedLink, {
      width: 240,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [open, generatedLink]);

  if (!open) return null;

  const handleCopy = async () => {
    if (!generatedLink) return;
    const ok = await copyTextWithFallback(generatedLink);
    setCopiedState(ok ? 'copied' : 'failed');
    setShareNote(
      ok
        ? 'App link copied! Paste in WhatsApp, Email, or any Android / iPhone / PC browser.'
        : 'Copy blocked by browser — please select the link box above and copy manually.'
    );
    window.setTimeout(() => setCopiedState('idle'), 2600);
  };

  const handleNativeShare = async () => {
    if (!generatedLink) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: portalTitle || 'Alex Apparels Planning Portal',
          text: 'Open Alex Apparels — Cluster 1 Planning & FO Control Tower (Android, iOS & Desktop):',
          url: generatedLink,
        });
        setShareNote('Shared successfully.');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    await handleCopy();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-[2px] p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-link-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600/30 border border-blue-400/40 flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4 text-blue-300" />
            </div>
            <div className="min-w-0">
              <h2 id="app-link-modal-title" className="text-sm sm:text-base font-semibold truncate">
                Universal App Link · Android, iOS &amp; PC
              </h2>
              <p className="text-xs text-slate-300 truncate">
                Copy, scan QR, or install on any phone or computer
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close App Link dialog"
            className="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {sharedTeamOrigin && (
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setLinkMode('team')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  linkMode === 'team'
                    ? 'bg-white text-blue-700 shadow-xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Team Shared Link (Android / iOS)
              </button>
              <button
                type="button"
                onClick={() => setLinkMode('current')}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  linkMode === 'current'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Current Session Link
              </button>
            </div>
          )}

          {/* Generated Link Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="generated-app-link-input"
                className="text-xs font-semibold text-slate-700"
              >
                Generated App URL
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeCurrentView}
                  onChange={(e) => setIncludeCurrentView(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Link to current tab/factory</span>
              </label>
            </div>

            <div className="flex items-stretch gap-2">
              <input
                id="generated-app-link-input"
                type="text"
                readOnly
                value={generatedLink}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                onClick={handleCopy}
                className={`px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer ${
                  copiedState === 'copied'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {copiedState === 'copied' ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>
            </div>

            {shareNote && (
              <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                {shareNote}
              </p>
            )}
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleNativeShare}
              className="flex-1 min-w-[140px] h-10 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Share (WhatsApp / Mobile)</span>
            </button>
            <a
              href={generatedLink}
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-slate-500 shrink-0" />
              <span>Open</span>
            </a>
          </div>

          {/* QR Code & Mobile Device Guide */}
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-center rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-col items-center justify-center bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs mx-auto">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Scan QR code to open app on Android or iOS"
                  className="w-28 h-28 object-contain"
                />
              ) : (
                <div className="w-28 h-28 flex items-center justify-center text-slate-400">
                  <QrCode className="w-10 h-10" />
                </div>
              )}
              <span className="mt-1 text-[10px] font-medium text-slate-500">
                Scan with Phone Camera
              </span>
            </div>

            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                <Smartphone className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Works on All Devices (Android &amp; iOS)</span>
              </div>
              <div className="space-y-1.5 leading-relaxed">
                <p>
                  <strong className="text-slate-800">Android (Chrome):</strong> Open link &rarr;
                  tap <span className="font-mono text-slate-800">&#8942;</span> Menu &rarr;{' '}
                  <strong>Install app / Add to Home screen</strong>.
                </p>
                <p>
                  <strong className="text-slate-800">iPhone / iPad (Safari):</strong> Open link
                  &rarr; tap <strong>Share</strong> &rarr; <strong>Add to Home Screen</strong>.
                </p>
              </div>
              {isInstallable && !isInstalled && (
                <button
                  type="button"
                  onClick={install}
                  className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>Install App on This Device</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
