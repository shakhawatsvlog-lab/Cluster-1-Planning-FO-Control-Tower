export const DEFAULT_BACKEND_URL =
  'https://cluster-1-planning-fo-control-tower-9b844.containers.snapdeploy.app';

export const DEFAULT_FRONTEND_URL =
  'https://shakhawatsvlog-lab.github.io/Cluster-1-Planning-FO-Control-Tower';

export function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  const envBase =
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    typeof import.meta.env.VITE_API_BASE_URL === 'string'
      ? import.meta.env.VITE_API_BASE_URL.trim()
      : '';

  if (envBase) {
    return stripTrailingSlashes(envBase);
  }

  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    // Keep local dev & AI Studio preview relative to same-origin Express server
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
      return '';
    }
  }

  return stripTrailingSlashes(DEFAULT_BACKEND_URL);
}

export function apiUrl(path: string): string {
  const cleanPath = `/${path.replace(/^\/+/, '')}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}
