export type AppPortalRoute = 'landing' | 'control_tower' | 'master_plan';

const BASE_PREFIX = '/Cluster-1-Planning-FO-Control-Tower';

function stripBasePrefix(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === BASE_PREFIX || normalized.startsWith(`${BASE_PREFIX}/`)) {
    const rest = normalized.slice(BASE_PREFIX.length);
    return rest || '/';
  }
  return normalized;
}

export function getAppRoute(pathname?: string): AppPortalRoute {
  const target =
    pathname !== undefined
      ? pathname
      : typeof window !== 'undefined'
        ? window.location.pathname
        : '/';
  const stripped = stripBasePrefix(target).toLowerCase();
  if (stripped === '/control-tower' || stripped.startsWith('/control-tower/')) {
    return 'control_tower';
  }
  if (stripped === '/master-plan' || stripped.startsWith('/master-plan/')) {
    return 'master_plan';
  }
  return 'landing';
}

function getActiveBasePrefix(): string {
  if (typeof window === 'undefined') return '';
  const path = window.location.pathname;
  if (path === BASE_PREFIX || path.startsWith(`${BASE_PREFIX}/`)) {
    return BASE_PREFIX;
  }
  return '';
}

export function buildRouteHref(route: AppPortalRoute): string {
  const prefix = getActiveBasePrefix();
  if (route === 'control_tower') {
    return `${prefix}/control-tower`;
  }
  if (route === 'master_plan') {
    return `${prefix}/master-plan`;
  }
  return prefix ? `${prefix}/` : '/';
}

export function navigateToRoute(route: AppPortalRoute, replace = false): void {
  if (typeof window === 'undefined') return;
  const href = buildRouteHref(route);
  if (replace) {
    window.history.replaceState({}, '', href);
  } else {
    window.history.pushState({}, '', href);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function restoreGitHubPagesSpaRedirect(): AppPortalRoute {
  if (typeof window === 'undefined') return 'landing';
  try {
    const params = new URLSearchParams(window.location.search);
    const pendingPath = params.get('p');
    if (
      pendingPath &&
      pendingPath.startsWith('/') &&
      !pendingPath.startsWith('//') &&
      !/[\r\n]/.test(pendingPath)
    ) {
      const targetUrl = new URL(pendingPath, window.location.origin);
      if (targetUrl.origin === window.location.origin) {
        const nextRoute = getAppRoute(targetUrl.pathname);
        const cleanHref = buildRouteHref(nextRoute);
        const search = targetUrl.search || '';
        const hash = targetUrl.hash || '';
        window.history.replaceState({}, '', `${cleanHref}${search}${hash}`);
        return nextRoute;
      }
    }
  } catch {
    // Ignore malformed query redirect params
  }
  return getAppRoute();
}
