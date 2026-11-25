import { useState } from 'react';
import { CREATOR_CREDIT } from './SiteFooter.tsx';

interface MasterPlanSplashScreenProps {
  fading: boolean;
}

export function MasterPlanSplashScreen({ fading }: MasterPlanSplashScreenProps) {
  const [iconError, setIconError] = useState(false);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading Alpine Master Plan"
      className={`fixed inset-0 z-[70] sidebar-shell-height flex flex-col items-center justify-between pt-[max(2.5rem,calc(env(safe-area-inset-top,0px)+1rem))] pb-[max(2.5rem,calc(env(safe-area-inset-bottom,0px)+1rem))] pl-[max(1.5rem,env(safe-area-inset-left,0px))] pr-[max(1.5rem,env(safe-area-inset-right,0px))] text-white transition-all duration-300 ease-out ${
        fading ? 'opacity-0 scale-[1.015] pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{
        background:
          'radial-gradient(900px 520px at 50% 28%, rgba(8, 145, 178, 0.24) 0%, rgba(13, 148, 136, 0.12) 42%, transparent 72%), linear-gradient(155deg, #061026 0%, #0a1b3d 55%, #082c42 100%)',
      }}
    >
      {/* Subtle futuristic coordinate grid backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(34, 211, 238, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(34, 211, 238, 0.08) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />

      {/* Top spacer */}
      <div className="relative z-10 text-[11px] font-mono tracking-[0.2em] uppercase text-cyan-200/75">
        Alpine Egypt · Cluster 1
      </div>

      {/* Centered Brand Icon + Title + Loader */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-md w-full space-y-6 robotics-enter">
        <div className="relative flex items-center justify-center">
          {/* Glowing Cyan / Teal Halo */}
          <div
            aria-hidden="true"
            className="mp-splash-halo absolute -inset-4 rounded-3xl blur-2xl"
            style={{
              background:
                'radial-gradient(circle, rgba(34, 211, 238, 0.35) 0%, rgba(20, 184, 166, 0.2) 55%, transparent 75%)',
            }}
          />

          <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-3xl p-2 bg-white/10 backdrop-blur-md border border-cyan-300/35 shadow-[0_20px_50px_-14px_rgba(6,182,212,0.55)] flex items-center justify-center">
            {!iconError ? (
              <img
                src={`${import.meta.env.BASE_URL}master-plan-192x192.png`}
                alt="Alpine Master Plan"
                referrerPolicy="no-referrer"
                onError={() => setIconError(true)}
                className="w-full h-full object-contain rounded-2xl"
              />
            ) : (
              <svg
                viewBox="0 0 64 64"
                className="w-16 h-16"
                fill="none"
                aria-hidden="true"
              >
                <path d="M32 10L16 38H25L32 24L39 38H48L32 10Z" fill="#FFFFFF" />
                <path d="M32 28L26 38H38L32 28Z" fill="#22D3EE" />
                <rect x="14" y="44" width="7" height="10" rx="2" fill="#38BDF8" />
                <rect x="24" y="46" width="7" height="8" rx="2" fill="#22D3EE" />
                <rect x="34" y="45" width="7" height="9" rx="2" fill="#2DD4BF" />
                <rect x="44" y="42" width="7" height="12" rx="2" fill="#FFFFFF" />
              </svg>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-[0.06em] text-white">
            ALPINE MASTER PLAN
          </h1>
          <p className="text-xs sm:text-sm text-cyan-100/80">
            Four-Factory Live Production Planning Schedule
          </p>
        </div>

        {/* Sleek Animated Loading Bar */}
        <div className="w-56 sm:w-64 space-y-2.5">
          <div className="mp-splash-loader-track h-1.5 w-full rounded-full bg-white/10 border border-cyan-300/20">
            <div className="mp-splash-loader-bar h-full rounded-full bg-gradient-to-r from-cyan-400 via-teal-300 to-white shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
          </div>
          <p className="text-[11px] font-mono tracking-wide text-cyan-200/75">
            Initializing live factory schedule...
          </p>
        </div>
      </div>

      {/* Prominent Exact Creator Credit */}
      <div className="relative z-10 text-center">
        <div className="px-4 py-2 rounded-xl border border-cyan-300/20 bg-white/5 backdrop-blur-xs">
          <p className="text-xs sm:text-sm font-semibold tracking-wide text-white">
            {CREATOR_CREDIT}
          </p>
        </div>
      </div>
    </div>
  );
}
