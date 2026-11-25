const ADMIN_TOKEN_STORAGE_KEY = 'alex_apparels_admin_session_v1';

export function readStoredAdminToken(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const val = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredAdminToken(token: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (token && token.trim()) {
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export function buildAdminHeaders(
  includeJson = true,
  tokenOverride?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  const token = tokenOverride !== undefined ? tokenOverride : readStoredAdminToken();
  if (token && token.trim()) {
    headers['X-Admin-Token'] = token.trim();
  }
  return headers;
}
