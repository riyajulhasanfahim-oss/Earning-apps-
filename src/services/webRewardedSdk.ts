/**
 * Authorized Regular-Website Rewarded Ad SDK Integrations:
 * 1. Google Ad Manager Rewarded Ads (GPT OutOfPageFormat.REWARDED)
 * 2. AppLixir Web Rewarded Video (cdn.applixir.com/applixir.sdk.3.0.js) + S2S Postback
 */

export interface WebRewardedAdOutcome {
  verified: boolean;
  provider: 'gam_rewarded' | 'applixir_web';
  placementRef: string;
  error?: string;
}

export function extractGamRewardedUnitPath(placementOrUrl: string): string | null {
  const trimmed = placementOrUrl.trim();
  const stripped = trimmed.replace(/^gam:/i, '').trim();
  if (/^\/\d{4,15}\/[a-zA-Z0-9_.\-/]{1,120}$/.test(stripped)) {
    return stripped;
  }
  return null;
}

let gptLoadPromise: Promise<boolean> | null = null;
function loadGoogleGptSdk(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const w = window as unknown as {
    googletag?: {
      apiReady?: boolean;
      cmd: Array<() => void>;
    };
  };
  if (w.googletag && w.googletag.apiReady) return Promise.resolve(true);
  if (gptLoadPromise) return gptLoadPromise;

  gptLoadPromise = new Promise<boolean>((resolve) => {
    w.googletag = w.googletag || { cmd: [] };
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="securepubads.g.doubleclick.net/tag/js/gpt.js"]',
    );
    if (existing) {
      w.googletag.cmd.push(() => resolve(true));
      window.setTimeout(() => resolve(Boolean(w.googletag?.apiReady)), 5000);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
    script.async = true;
    script.onload = () => {
      w.googletag = w.googletag || { cmd: [] };
      w.googletag.cmd.push(() => resolve(true));
    };
    script.onerror = () => {
      gptLoadPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return gptLoadPromise;
}

/**
 * Invokes Google Ad Manager Rewarded Ad (GPT OutOfPageFormat.REWARDED) on standard websites.
 */
export async function showGoogleRewardedAd(adUnitPath: string): Promise<WebRewardedAdOutcome> {
  const cleanPath = extractGamRewardedUnitPath(adUnitPath);
  if (!cleanPath) {
    return {
      verified: false,
      provider: 'gam_rewarded',
      placementRef: adUnitPath,
      error: 'Invalid Google Ad Manager Rewarded Ad Unit path. 0 points credited.',
    };
  }

  const loaded = await loadGoogleGptSdk();
  if (!loaded) {
    return {
      verified: false,
      provider: 'gam_rewarded',
      placementRef: cleanPath,
      error: 'Google Publisher Tag (GPT) script failed to load (check AdBlocker). 0 points credited.',
    };
  }

  return new Promise<WebRewardedAdOutcome>((resolve) => {
    let settled = false;
    let granted = false;

    const finish = (outcome: WebRewardedAdOutcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(outcome);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        verified: false,
        provider: 'gam_rewarded',
        placementRef: cleanPath,
        error: 'Google Rewarded Ad timed out or had no fill. 0 points credited.',
      });
    }, 25000);

    const w = window as unknown as {
      googletag?: {
        cmd: Array<() => void>;
        enums: { OutOfPageFormat: { REWARDED: unknown } };
        defineOutOfPageSlot: (path: string, format: unknown) => unknown;
        pubads: () => {
          addEventListener: (event: string, cb: (ev: { slot: unknown; makeRewardedVisible?: () => void }) => void) => void;
        };
        enableServices: () => void;
        display: (slot: unknown) => void;
        destroySlots: (slots: unknown[]) => void;
      };
    };

    try {
      w.googletag!.cmd.push(() => {
        const gt = w.googletag!;
        const slot = gt.defineOutOfPageSlot(cleanPath, gt.enums.OutOfPageFormat.REWARDED);
        if (!slot) {
          finish({
            verified: false,
            provider: 'gam_rewarded',
            placementRef: cleanPath,
            error: 'Browser/viewport does not support GPT Rewarded slot. 0 points credited.',
          });
          return;
        }
        const slotTyped = slot as { addService: (svc: unknown) => unknown };
        const pubads = gt.pubads();
        slotTyped.addService(pubads);

        pubads.addEventListener('rewardedSlotReady', (event) => {
          if (event.slot !== slot) return;
          window.clearTimeout(timeoutId);
          event.makeRewardedVisible?.();
        });
        pubads.addEventListener('rewardedSlotGranted', (event) => {
          if (event.slot !== slot) return;
          granted = true;
        });
        pubads.addEventListener('rewardedSlotClosed', (event) => {
          if (event.slot !== slot) return;
          gt.destroySlots([slot]);
          finish({
            verified: granted,
            provider: 'gam_rewarded',
            placementRef: cleanPath,
            error: granted
              ? undefined
              : 'Google Rewarded Ad closed before reward grant. 0 points credited.',
          });
        });

        gt.enableServices();
        gt.display(slot);
      });
    } catch {
      finish({
        verified: false,
        provider: 'gam_rewarded',
        placementRef: cleanPath,
        error: 'Google Rewarded Ad failed to initialize. 0 points credited.',
      });
    }
  });
}

export function isValidAppLixirPlacementToken(raw: string): boolean {
  const clean = raw.replace(/^applixir:\/\//i, '').replace(/^applixir:/i, '').trim();
  if (!clean || /^(demo|test|placeholder|0+|none|null|undefined)$/i.test(clean)) {
    return false;
  }
  return /^\d{3,12}$/.test(clean) || /^[a-zA-Z0-9-]{8,64}$/.test(clean);
}

export function isAppLixirV6Key(token: string): boolean {
  const clean = token.replace(/^applixir:\/\//i, '').replace(/^applixir:/i, '').trim();
  return !/^\d{3,12}$/.test(clean) && /^[a-zA-Z0-9-]{8,64}$/.test(clean);
}

export function extractAppLixirSiteId(placementOrUrl: string, adNetwork = ''): string | null {
  const trimmed = placementOrUrl.trim();
  const prefixed = trimmed.match(/^(?:applixir:\/\/|applixir:)([a-zA-Z0-9-]{3,64})$/i);
  if (prefixed && isValidAppLixirPlacementToken(prefixed[1])) {
    return prefixed[1];
  }
  if (adNetwork.toLowerCase().includes('applixir') && isValidAppLixirPlacementToken(trimmed)) {
    return trimmed;
  }
  return null;
}

let appLixirV6LoadPromise: Promise<boolean> | null = null;
function loadAppLixirV6Sdk(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const w = window as unknown as {
    initializeAndOpenPlayer?: (opts: Record<string, unknown>) => void;
  };
  if (typeof w.initializeAndOpenPlayer === 'function') return Promise.resolve(true);
  if (appLixirV6LoadPromise) return appLixirV6LoadPromise;

  appLixirV6LoadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="cdn.applixir.com/applixir.app.v6"]',
    );
    if (existing) {
      window.setTimeout(() => resolve(typeof w.initializeAndOpenPlayer === 'function'), 700);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.applixir.com/applixir.app.v6.1.0.js';
    script.async = true;
    script.onload = () => resolve(typeof w.initializeAndOpenPlayer === 'function');
    script.onerror = () => {
      appLixirV6LoadPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return appLixirV6LoadPromise;
}

let appLixirV3LoadPromise: Promise<boolean> | null = null;
function loadAppLixirV3Sdk(): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const w = window as unknown as { invokeAdReward?: (opts: Record<string, unknown>) => void };
  if (typeof w.invokeAdReward === 'function') return Promise.resolve(true);
  if (appLixirV3LoadPromise) return appLixirV3LoadPromise;

  appLixirV3LoadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="cdn.applixir.com/applixir.sdk"]',
    );
    if (existing) {
      window.setTimeout(() => resolve(typeof w.invokeAdReward === 'function'), 700);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.applixir.com/applixir.sdk.3.0.js';
    script.async = true;
    script.onload = () => resolve(typeof w.invokeAdReward === 'function');
    script.onerror = () => {
      appLixirV3LoadPromise = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return appLixirV3LoadPromise;
}

/**
 * Invokes AppLixir Web Rewarded Video SDK on standard websites.
 * Supports AppLixir v6 (`initializeAndOpenPlayer`) and numeric Site/Zone IDs.
 * Actual point crediting NEVER happens client-side — requires official AppLixir S2S Postback verification.
 */
export async function showAppLixirRewardedAd(
  siteOrKey: string,
  userId: string,
  sessionId: string,
  adId = '',
): Promise<WebRewardedAdOutcome> {
  if (!isValidAppLixirPlacementToken(siteOrKey)) {
    return {
      verified: false,
      provider: 'applixir_web',
      placementRef: siteOrKey,
      error: 'Missing or invalid AppLixir Site ID / Player Key. 0 points credited.',
    };
  }

  if (isAppLixirV6Key(siteOrKey)) {
    const loaded = await loadAppLixirV6Sdk();
    const w = window as unknown as {
      initializeAndOpenPlayer?: (opts: Record<string, unknown>) => void;
    };
    if (!loaded || typeof w.initializeAndOpenPlayer !== 'function') {
      return {
        verified: false,
        provider: 'applixir_web',
        placementRef: siteOrKey,
        error: 'AppLixir v6 Web SDK failed to load (check network/AdBlocker). 0 points credited.',
      };
    }

    let container = document.getElementById('applixir-ad-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'applixir-ad-container';
      container.style.cssText = 'position:relative;z-index:2147483000;';
      document.body.appendChild(container);
    }

    return new Promise<WebRewardedAdOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: WebRewardedAdOutcome) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(loadTimeout);
        resolve(outcome);
      };

      const loadTimeout = window.setTimeout(() => {
        finish({
          verified: false,
          provider: 'applixir_web',
          placementRef: siteOrKey,
          error: 'AppLixir video player did not respond in time. 0 points credited.',
        });
      }, 25000);

      try {
        w.initializeAndOpenPlayer!({
          apiKey: siteOrKey,
          injectionElementId: 'applixir-ad-container',
          userId,
          customData: { sessionId, adId },
          adStatusCallbackFn: (status: unknown) => {
            const type =
              typeof status === 'string'
                ? status
                : typeof status === 'object' && status !== null
                  ? String((status as { type?: unknown }).type || '')
                  : '';
            const normalized = type.toLowerCase();
            if (normalized === 'loaded' || normalized === 'started' || normalized === 'playing') {
              window.clearTimeout(loadTimeout);
            } else if (
              normalized === 'complete' ||
              normalized === 'ad-watched' ||
              normalized === 'rewarded'
            ) {
              finish({
                verified: true,
                provider: 'applixir_web',
                placementRef: siteOrKey,
              });
            } else if (
              normalized === 'closed' ||
              normalized === 'skip' ||
              normalized === 'skipped' ||
              normalized === 'sys-closing' ||
              normalized === 'no-ads'
            ) {
              finish({
                verified: false,
                provider: 'applixir_web',
                placementRef: siteOrKey,
                error: `AppLixir reported "${normalized}" before full completion. 0 points credited.`,
              });
            }
          },
          adErrorCallbackFn: (err: unknown) => {
            const errObj = err as { getError?: () => { data?: unknown } } | undefined;
            const detail =
              typeof errObj?.getError === 'function'
                ? String(errObj.getError()?.data || '')
                : err instanceof Error
                  ? err.message
                  : '';
            finish({
              verified: false,
              provider: 'applixir_web',
              placementRef: siteOrKey,
              error: detail
                ? `AppLixir error: ${detail}. 0 points credited.`
                : 'AppLixir video ad unavailable or blocked. 0 points credited.',
            });
          },
        });
      } catch {
        finish({
          verified: false,
          provider: 'applixir_web',
          placementRef: siteOrKey,
          error: 'AppLixir v6 SDK invocation failed. 0 points credited.',
        });
      }
    });
  }

  const loaded = await loadAppLixirV3Sdk();
  const w = window as unknown as { invokeAdReward?: (opts: Record<string, unknown>) => void };
  if (!loaded || typeof w.invokeAdReward !== 'function') {
    return {
      verified: false,
      provider: 'applixir_web',
      placementRef: siteOrKey,
      error: 'AppLixir Web SDK failed to load (check AdBlocker). 0 points credited.',
    };
  }

  let container = document.getElementById('applixir_vanishing_div');
  if (!container) {
    container = document.createElement('div');
    container.id = 'applixir_vanishing_div';
    container.style.cssText = 'position:relative;z-index:2147483000;width:0px;height:0px;';
    document.body.appendChild(container);
  }

  return new Promise<WebRewardedAdOutcome>((resolve) => {
    let adWatched = false;
    let settled = false;

    const finish = (outcome: WebRewardedAdOutcome) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(loadTimeout);
      resolve(outcome);
    };

    const loadTimeout = window.setTimeout(() => {
      finish({
        verified: false,
        provider: 'applixir_web',
        placementRef: siteOrKey,
        error: 'AppLixir video ad timed out or did not fill. 0 points credited.',
      });
    }, 25000);

    try {
      w.invokeAdReward!({
        zoneId: Number(siteOrKey),
        userId,
        custom1: sessionId,
        custom2: adId,
        adStatusCb: (status: string) => {
          if (status === 'ad-started' || status === 'ad-loaded') {
            window.clearTimeout(loadTimeout);
          } else if (status === 'ad-watched' || status === 'rewarded') {
            adWatched = true;
          } else if (status === 'sys-closing' || status === 'fb-watched') {
            finish({
              verified: adWatched,
              provider: 'applixir_web',
              placementRef: siteOrKey,
              error: adWatched
                ? undefined
                : 'Video ad closed before full completion. 0 points credited.',
            });
          } else if (
            status === 'ad-blocker' ||
            status === 'network-error' ||
            status === 'cors-error' ||
            status === 'no-ads'
          ) {
            finish({
              verified: false,
              provider: 'applixir_web',
              placementRef: siteOrKey,
              error: `AppLixir reported "${status}". 0 points credited.`,
            });
          }
        },
      });
    } catch {
      finish({
        verified: false,
        provider: 'applixir_web',
        placementRef: siteOrKey,
        error: 'AppLixir SDK invocation failed. 0 points credited.',
      });
    }
  });
}
