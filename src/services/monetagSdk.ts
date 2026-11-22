const loadedSdkZones = new Map<string, Promise<boolean>>();

interface TelegramWebAppWindow extends Window {
  Telegram?: {
    WebApp?: {
      initData?: string;
    };
  };
}

/**
 * Monetag's Rewarded Interstitial SDK (libtl.com/sdk.js) is officially built for
 * Telegram Mini Apps (TMA). Never force-load or execute it on a regular browser website.
 */
export function isTelegramMiniAppContext(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as TelegramWebAppWindow).Telegram;
  return typeof tg?.WebApp?.initData === 'string' && tg.WebApp.initData.trim().length > 0;
}

/**
 * Extracts a numeric Monetag Zone ID when configured as a zone code
 * (e.g. "8912345", "zone:8912345", or "monetag://8912345").
 * Returns null for http(s):// external URLs.
 */
export function extractMonetagZoneId(placementOrUrl: string): string | null {
  const trimmed = placementOrUrl.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }
  const directDigits = trimmed.match(/^(\d{4,15})$/);
  if (directDigits) {
    return directDigits[1];
  }
  const prefixed = trimmed.match(/^(?:monetag:\/\/|monetag:|zone:|zone_id[:=])(\d{4,15})$/i);
  if (prefixed) {
    return prefixed[1];
  }
  return null;
}

function getSdkFunctionName(zoneId: string): string {
  return `show_${zoneId}`;
}

function getGlobalSdkFn(
  zoneId: string,
): ((opts?: Record<string, unknown>) => Promise<unknown> | unknown) | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as Record<string, unknown>)[getSdkFunctionName(zoneId)];
  return typeof candidate === 'function'
    ? (candidate as (opts?: Record<string, unknown>) => Promise<unknown> | unknown)
    : null;
}

/**
 * Preloads Monetag TMA Rewarded SDK ONLY inside an active Telegram Mini App context.
 * Never loads libtl.com/sdk.js on regular websites.
 */
export function preloadMonetagSdk(zoneId: string): Promise<boolean> {
  if (
    typeof document === 'undefined' ||
    !/^\d{4,15}$/.test(zoneId) ||
    !isTelegramMiniAppContext()
  ) {
    return Promise.resolve(false);
  }
  if (getGlobalSdkFn(zoneId)) {
    return Promise.resolve(true);
  }
  const existing = loadedSdkZones.get(zoneId);
  if (existing) {
    return existing;
  }

  const promise = new Promise<boolean>((resolve) => {
    const fnName = getSdkFunctionName(zoneId);
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-zone="${zoneId}"][data-sdk="${fnName}"]`,
    );

    const pollReady = (attemptsLeft: number) => {
      if (getGlobalSdkFn(zoneId)) {
        resolve(true);
        return;
      }
      if (attemptsLeft <= 0) {
        resolve(false);
        return;
      }
      window.setTimeout(() => pollReady(attemptsLeft - 1), 150);
    };

    if (existingScript) {
      pollReady(20);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://libtl.com/sdk.js';
    script.async = true;
    script.setAttribute('data-zone', zoneId);
    script.setAttribute('data-sdk', fnName);

    const timeout = window.setTimeout(() => {
      resolve(Boolean(getGlobalSdkFn(zoneId)));
    }, 8000);

    script.onload = () => {
      window.clearTimeout(timeout);
      pollReady(12);
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      loadedSdkZones.delete(zoneId);
      resolve(false);
    };

    document.head.appendChild(script);
  });

  loadedSdkZones.set(zoneId, promise);
  return promise;
}

export interface MonetagShowOutcome {
  verified: boolean;
  zoneId: string;
  blockedNonTelegram?: boolean;
  error?: string;
}

/**
 * Triggers Monetag Rewarded Interstitial ONLY inside Telegram Mini Apps.
 * Outside Telegram (regular website), refuses to force-run the TMA SDK and awards 0 points.
 */
export async function showMonetagRewardedAd(
  zoneId: string,
  sessionId: string,
): Promise<MonetagShowOutcome> {
  if (!isTelegramMiniAppContext()) {
    return {
      verified: false,
      zoneId,
      blockedNonTelegram: true,
      error:
        'Monetag Rewarded Interstitial SDK (libtl.com) is officially limited to Telegram Mini Apps and is not supported on regular websites. Use an authorized Web Rewarded Network (AppLixir, Google Ad Manager Rewarded GPT, or S2S Placement URL).',
    };
  }

  if (!/^\d{4,15}$/.test(zoneId)) {
    return { verified: false, zoneId, error: 'Invalid Monetag Zone ID configured.' };
  }

  const ready = await preloadMonetagSdk(zoneId);
  const sdkFn = getGlobalSdkFn(zoneId);
  if (!ready || !sdkFn) {
    return {
      verified: false,
      zoneId,
      error:
        'Monetag SDK could not initialize (check AdBlocker or Zone ID configuration). No reward credited.',
    };
  }

  try {
    let result: unknown;
    try {
      result = await sdkFn({ ymid: sessionId });
    } catch {
      result = await sdkFn();
    }

    // Per Monetag TMA docs: check reward_event_type === 'valued' when returned
    if (
      result &&
      typeof result === 'object' &&
      'reward_event_type' in result &&
      (result as { reward_event_type?: unknown }).reward_event_type !== 'valued'
    ) {
      return {
        verified: false,
        zoneId,
        error: 'Monetag reported a non-valued event (closed early or unverified). 0 points credited.',
      };
    }

    return { verified: true, zoneId };
  } catch (err) {
    return {
      verified: false,
      zoneId,
      error:
        err instanceof Error && err.message
          ? `Ad was closed or failed before completion (${err.message}).`
          : 'Ad was closed or failed before completion. No reward credited.',
    };
  }
}
