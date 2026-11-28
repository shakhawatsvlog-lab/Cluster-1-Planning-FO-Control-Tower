export interface ReleaseHighlight {
  category: string;
  title: string;
  description: string;
}

export interface AppReleaseInfo {
  version: string;
  releasedAt: string;
  title: string;
  subtitle: string;
  highlights: ReleaseHighlight[];
}

export const APP_RELEASE: AppReleaseInfo = {
  version: 'v2.6.0',
  releasedAt: '2026-11-28',
  title: 'System Updated',
  subtitle:
    'A new update has been deployed with permanent sheet link auto-sync, SheetLens, and faster live syncing.',
  highlights: [
    {
      category: 'Auto-Sync Links',
      title: 'Permanent Online Sheet Links & Automatic Change Detection',
      description:
        'Save Google Sheets or SharePoint Excel links once permanently until manually deleted. View all saved links in one place while Cutting, Output, and Packing changes sync automatically.',
    },
    {
      category: 'New Module',
      title: 'SheetLens (PO & PG# Allocation Matcher)',
      description:
        'Upload 5–15 factory Excel workbooks and cross-check against JPG photo slips (AI Vision OCR) or Excel PO lists with multi-factory split detection and Excel export.',
    },
    {
      category: 'Master Plan',
      title: 'Auto Output & Packing Qty + Streamlined Cutting Qty',
      description:
        'Master Plan automatically collects Output Qty and Packing Qty from uploaded or linked sheets with a unified Cutting Qty view.',
    },
    {
      category: 'Performance',
      title: 'Silent 15-Second Background Sync & Release Alerts',
      description:
        'Replaced full-page auto-reloads with silent background synchronization, preserving your active tab, filters, and edits across Cloudflare Workers D1.',
    },
  ],
};

export function getEffectiveReleaseKey(): string {
  const rawBuildId =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_APP_BUILD_ID === 'string'
      ? import.meta.env.VITE_APP_BUILD_ID.trim()
      : '';
  return rawBuildId ? `${APP_RELEASE.version}+${rawBuildId}` : APP_RELEASE.version;
}
