import type { ReactNode } from 'react';

export const CREATOR_CREDIT = 'Created by Shakhawat Hossain (Factory Planner)';

interface SiteFooterProps {
  leftContent: ReactNode;
  maxWidthClass?: string;
}

export function SiteFooter({
  leftContent,
  maxWidthClass = 'max-w-[1600px]',
}: SiteFooterProps) {
  return (
    <footer className="relative z-10 border-t border-slate-200/80 bg-white/75 backdrop-blur-sm ct-safe-footer">
      <div
        className={`${maxWidthClass} mx-auto px-3 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4 text-xs text-slate-500`}
      >
        <div className="min-w-0">{leftContent}</div>
        <div className="font-medium text-slate-600 sm:text-right shrink-0">
          {CREATOR_CREDIT}
        </div>
      </div>
    </footer>
  );
}
