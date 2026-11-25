import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type BrowserInstallEnvironment =
  | 'ios-safari'
  | 'ios-other'
  | 'android-chrome'
  | 'desktop-chrome-edge'
  | 'desktop-safari'
  | 'firefox'
  | 'other';

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function detectBrowserEnvironment(): {
  isIOS: boolean;
  browserKind: BrowserInstallEnvironment;
} {
  if (typeof window === 'undefined') {
    return { isIOS: false, browserKind: 'other' };
  }
  const ua = window.navigator.userAgent.toLowerCase();
  const isIOSDevice =
    /iphone|ipad|ipod/.test(ua) ||
    (ua.includes('macintosh') && 'ontouchend' in document);

  if (isIOSDevice) {
    const isCriOSOrFxiOS = /crios|fxios|edgios|opios/.test(ua);
    return {
      isIOS: true,
      browserKind: isCriOSOrFxiOS ? 'ios-other' : 'ios-safari',
    };
  }

  if (/android/.test(ua)) {
    return { isIOS: false, browserKind: 'android-chrome' };
  }

  if (/firefox/.test(ua)) {
    return { isIOS: false, browserKind: 'firefox' };
  }

  if (/safari/.test(ua) && !/chrome|chromium|edg|opr/.test(ua)) {
    return { isIOS: false, browserKind: 'desktop-safari' };
  }

  if (/chrome|chromium|edg/.test(ua)) {
    return { isIOS: false, browserKind: 'desktop-chrome-edge' };
  }

  return { isIOS: false, browserKind: 'other' };
}

// Module-level store so `beforeinstallprompt` captured early (e.g. on `/` before navigating to `/master-plan`)
// remains immediately usable everywhere without missing events.
let sharedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let sharedInstalled = false;
let listenersBound = false;
const subscribers = new Set<() => void>();

function notifySubscribers() {
  for (const fn of subscribers) {
    fn();
  }
}

function bindGlobalPwaListeners() {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  sharedInstalled = detectStandalone();

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    sharedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    sharedInstalled = true;
    sharedDeferredPrompt = null;
    notifySubscribers();
  });
}

if (typeof window !== 'undefined') {
  bindGlobalPwaListeners();
}

export function usePWAInstall() {
  const [{ isIOS, browserKind }] = useState(() => detectBrowserEnvironment());
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => sharedDeferredPrompt
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(
    () => sharedInstalled || detectStandalone()
  );

  useEffect(() => {
    bindGlobalPwaListeners();

    const syncFromShared = () => {
      setDeferredPrompt(sharedDeferredPrompt);
      setIsInstalled(sharedInstalled || detectStandalone());
    };

    syncFromShared();
    subscribers.add(syncFromShared);

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayChange = () => {
      if (mediaQuery.matches) {
        sharedInstalled = true;
      }
      syncFromShared();
    };
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleDisplayChange);
    }

    return () => {
      subscribers.delete(syncFromShared);
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleDisplayChange);
      }
    };
  }, []);

  const install = async () => {
    const promptEvent = sharedDeferredPrompt || deferredPrompt;
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      sharedInstalled = true;
      sharedDeferredPrompt = null;
      notifySubscribers();
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    browserKind,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
