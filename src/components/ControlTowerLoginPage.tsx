import { useState } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { buildRouteHref } from '../lib/routes.ts';
import { SiteFooter } from './SiteFooter.tsx';

interface ControlTowerLoginPageProps {
  companyName: string;
  portalTitle: string;
  checkingSession: boolean;
  needsInitialSetup: boolean;
  initialNotice?: string | null;
  onUnlock: (password: string) => Promise<{ ok: boolean; error?: string }>;
  onBootstrapAdmin: (payload: {
    password: string;
    recoveryEmail?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onBackToPortal: () => void;
}

export function ControlTowerLoginPage({
  companyName,
  portalTitle,
  checkingSession,
  needsInitialSetup,
  initialNotice,
  onUnlock,
  onBootstrapAdmin,
  onBackToPortal,
}: ControlTowerLoginPageProps) {
  const [password, setPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logoError, setLogoError] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      const result = needsInitialSetup
        ? await onBootstrapAdmin({
            password,
            recoveryEmail: recoveryEmail.trim() || undefined,
          })
        : await onUnlock(password);
      if (!result.ok) {
        setAuthError(result.error || 'Authentication failed. Please check your password.');
        return;
      }
      setPassword('');
      setRecoveryEmail('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative app-shell-height flex flex-col robotics-workspace-bg text-slate-900 overflow-x-clip">
      {/* Subtle Background Grid & Ambient Glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 robotics-portal-grid" />
        <div
          className="robotics-orb-primary absolute -top-28 left-1/4 w-[440px] h-[440px] rounded-full opacity-45 blur-3xl"
          style={{
            background:
              'radial-gradient(circle, rgba(6, 182, 212, 0.18) 0%, transparent 70%)',
          }}
        />
        <div
          className="robotics-scan-beam absolute inset-x-0 h-[1.5px]"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(6, 182, 212, 0.22) 50%, transparent 100%)',
          }}
        />
      </div>

      {/* Frosted Header Bar */}
      <header className="relative z-20 ct-header-glass ct-safe-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {!logoError ? (
              <img
                src={`${import.meta.env.BASE_URL}assets/aistudio/OIP__1__63903905.webp`}
                alt={companyName}
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="h-8 w-auto object-contain shrink-0"
              />
            ) : (
              <span className="font-display text-base font-bold tracking-tight text-slate-950">
                {companyName.toUpperCase()}
              </span>
            )}
            <span
              className="hidden sm:inline-block h-5 w-px bg-cyan-900/15 shrink-0"
              aria-hidden="true"
            />
            <span className="hidden sm:inline text-xs font-semibold text-slate-700 truncate">
              Control Tower Access
            </span>
          </div>

          <a
            href={buildRouteHref('landing')}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              onBackToPortal();
            }}
            className="h-9 px-3.5 rounded-lg border border-slate-300/80 bg-white/90 hover:bg-white hover:border-cyan-500/60 text-slate-700 hover:text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Entry Portal</span>
          </a>
        </div>
      </header>

      {/* Centered Glassmorphic Auth Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-10">
        <div className="robotics-enter relative w-full max-w-md ct-surface rounded-2xl p-6 sm:p-8 space-y-6 overflow-hidden shadow-[0_20px_50px_-20px_rgba(8,145,178,0.28)]">
          <div
            className="robotics-border-pulse absolute top-0 inset-x-0 h-[3px] bg-gradient-to-r from-[#0a1633] via-cyan-500 to-teal-500"
            aria-hidden="true"
          />

          <div className="flex items-start gap-3.5 pt-1">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0a1633] via-[#12295a] to-[#0891b2] text-white flex items-center justify-center shrink-0 shadow-[0_8px_18px_-6px_rgba(8,145,178,0.45)]">
              {needsInitialSetup ? (
                <ShieldCheck className="w-5 h-5 text-cyan-200" />
              ) : (
                <Lock className="w-5 h-5 text-cyan-200" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-800">
                Control Tower
              </p>
              <h1 className="font-display text-lg font-bold text-slate-950 leading-snug">
                {needsInitialSetup ? 'Initialize Admin Account' : 'Admin Sign In'}
              </h1>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {needsInitialSetup
                  ? `Create the administrator password for ${portalTitle}.`
                  : `Sign in with your administrator password to open ${companyName} Control Tower.`}
              </p>
            </div>
          </div>

          {initialNotice && (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50/70 px-3.5 py-2.5 text-xs text-cyan-950">
              {initialNotice}
            </div>
          )}

          {checkingSession ? (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-xs text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-700" />
              <span>Verifying session status...</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="control-tower-admin-password"
                  className="text-xs font-semibold text-slate-700"
                >
                  {needsInitialSetup ? 'New Admin Password (min 8 chars)' : 'Admin Password'}
                </label>
                <div className="relative">
                  <input
                    id="control-tower-admin-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    minLength={needsInitialSetup ? 8 : 1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      needsInitialSetup
                        ? 'Create strong admin password'
                        : 'Enter administrator password'
                    }
                    className="w-full h-11 pl-3.5 pr-10 rounded-xl border border-slate-300/90 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-600 focus:border-cyan-600 transition-shadow"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {needsInitialSetup && (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="control-tower-recovery-email"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Recovery Email (Optional)
                  </label>
                  <input
                    id="control-tower-recovery-email"
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="planner@company.com"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300/90 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-600 focus:border-cyan-600 transition-shadow"
                  />
                </div>
              )}

              {authError && (
                <div
                  role="alert"
                  className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5"
                >
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !password}
                className="w-full h-11 px-4 rounded-xl bg-gradient-to-r from-[#0a1633] via-[#102652] to-[#0891b2] hover:from-[#0f214a] hover:to-[#06b6d4] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_10px_24px_-10px_rgba(8,145,178,0.55)] transition-all cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-200" />
                ) : (
                  <Unlock className="w-4 h-4 text-cyan-200" />
                )}
                <span>
                  {submitting
                    ? 'Authenticating...'
                    : needsInitialSetup
                      ? 'Save Password & Enter Control Tower'
                      : 'Sign In to Control Tower'}
                </span>
              </button>
            </form>
          )}
        </div>
      </main>

      <SiteFooter
        maxWidthClass="max-w-5xl"
        leftContent={
          <span>
            {companyName} — Control Tower Admin Gateway ·{' '}
            <span className="font-mono">ALEX 1 · ALEX 3 · ALEX 5 · ALEX 12</span>
          </span>
        }
      />
    </div>
  );
}
