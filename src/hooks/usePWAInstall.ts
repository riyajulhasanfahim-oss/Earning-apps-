import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'adview_pwa_banner_dismissed_at';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Capture early beforeinstallprompt events even before React mounts
let cachedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let cachedAppInstalled = false;
const promptSubscribers = new Set<() => void>();

function notifySubscribers() {
  promptSubscribers.forEach((cb) => cb());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    cachedDeferredPrompt = e as BeforeInstallPromptEvent;
    notifySubscribers();
  });

  window.addEventListener('appinstalled', () => {
    cachedAppInstalled = true;
    cachedDeferredPrompt = null;
    notifySubscribers();
  });
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const matchStandalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  const androidAppReferrer =
    typeof document !== 'undefined' && document.referrer.startsWith('android-app://');
  return Boolean(cachedAppInstalled || matchStandalone || iosStandalone || androidAppReferrer);
}

function readDismissedState(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => cachedDeferredPrompt,
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsStandalone());
  const [isDismissed, setIsDismissed] = useState<boolean>(() => readDismissedState());

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isMobile = isIOS || isAndroid || /mobile/.test(ua);

  useEffect(() => {
    const syncState = () => {
      setDeferredPrompt(cachedDeferredPrompt);
      setIsInstalled(checkIsStandalone());
    };

    promptSubscribers.add(syncState);
    syncState();

    const media = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayChange = () => syncState();
    media?.addEventListener?.('change', handleDisplayChange);

    return () => {
      promptSubscribers.delete(syncState);
      media?.removeEventListener?.('change', handleDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const activePrompt = deferredPrompt ?? cachedDeferredPrompt;
    if (!activePrompt) {
      return 'unavailable';
    }

    await activePrompt.prompt();
    const { outcome } = await activePrompt.userChoice;

    if (outcome === 'accepted') {
      cachedAppInstalled = true;
      cachedDeferredPrompt = null;
      setDeferredPrompt(null);
      setIsInstalled(true);
      return 'accepted';
    }

    cachedDeferredPrompt = null;
    setDeferredPrompt(null);
    return 'dismissed';
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // Ignore storage errors in restricted browsing contexts
    }
  }, []);

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isDismissed,
    isIOS,
    isAndroid,
    isMobile,
    install,
    dismiss,
  };
}
