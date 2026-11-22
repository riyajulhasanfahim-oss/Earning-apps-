import { AdType, Advertisement, RewardVerificationMethod } from '../types';

export interface AdNetworkAdapter {
  key: string;
  displayName: string;
  supportedTypes: AdType[];
  defaultVerificationMethod: RewardVerificationMethod;
  supportsIncentivizedDefault: boolean;
  callbackSummary: string;
  instructions: string[];
}

const AD_NETWORK_REGISTRY: AdNetworkAdapter[] = [
  {
    key: 'monetag',
    displayName: 'Monetag',
    supportedTypes: ['rewarded', 'direct_link', 'other'],
    defaultVerificationMethod: 's2s_postback',
    supportsIncentivizedDefault: false,
    callbackSummary:
      'Monetag Rewarded Interstitial SDK (libtl.com) is officially restricted to Telegram Mini Apps (TMA). Standard websites require Monetag Web Direct Link/Vignette on a custom domain with explicit Incentivized S2S Postback approval.',
    instructions: [
      'Outside Telegram Mini Apps, Monetag TMA SDK is disabled; use an approved Web S2S placement URL.',
      'Complete the full 30-second sponsored placement without closing early.',
      'Points credit ONLY after Monetag sends a verified S2S postback (reward_event_type=valued) to our backend.',
    ],
  },
  {
    key: 'applixir',
    displayName: 'AppLixir (Web Rewarded Video)',
    supportedTypes: ['rewarded'],
    defaultVerificationMethod: 's2s_postback',
    supportsIncentivizedDefault: true,
    callbackSummary:
      'Official regular-website fullscreen Rewarded Video SDK (applixir:<zoneId>) verified via Server-to-Server (S2S) Postback.',
    instructions: [
      'Watch the full AppLixir fullscreen rewarded video ad (minimum 30s session).',
      'Do not close the video player before completion.',
      'Points credit ONLY after AppLixir triggers the signed S2S postback to our backend.',
    ],
  },
  {
    key: 'gam_rewarded',
    displayName: 'Google Ad Manager (Web Rewarded GPT)',
    supportedTypes: ['rewarded'],
    defaultVerificationMethod: 'sdk_callback',
    supportsIncentivizedDefault: true,
    callbackSummary:
      'Official Google Publisher Tag (GPT) Web Rewarded Ad unit (gam:/networkCode/unitName) with fullscreen playback & rewardedSlotGranted verification.',
    instructions: [
      'Click to opt into the fullscreen Google Rewarded Ad experience.',
      'Keep watching until the full 30-second session and rewardedSlotGranted event complete.',
      'Server verification validates session duration and unique transaction ID before crediting.',
    ],
  },
  {
    key: 'adsterra',
    displayName: 'Adsterra',
    supportedTypes: ['rewarded', 'direct_link', 'other'],
    defaultVerificationMethod: 's2s_postback',
    supportsIncentivizedDefault: false,
    callbackSummary:
      'Requires explicit Adsterra incentivized traffic approval and S2S postback callback before awarding points.',
    instructions: [
      'Open only placements explicitly approved for incentivized traffic.',
      'Complete the required partner action so Adsterra triggers a verified S2S postback.',
      'Points appear in your wallet automatically once the backend validates the callback.',
    ],
  },
  {
    key: 'rewarded_partner',
    displayName: 'Authorized Rewarded Partner',
    supportedTypes: ['rewarded', 'other'],
    defaultVerificationMethod: 'sdk_callback',
    supportsIncentivizedDefault: true,
    callbackSummary:
      'Verified via signed SDK completion callback or S2S webhook with anti-duplicate transaction tracking.',
    instructions: [
      'View the sponsored rewarded placement in full.',
      'Wait for the partner network callback confirmation.',
      'Check verification status below or in your Ad History.',
    ],
  },
];

export function getAdNetworkAdapter(networkName: string): AdNetworkAdapter {
  const lower = networkName.toLowerCase();
  if (lower.includes('monetag')) return AD_NETWORK_REGISTRY[0];
  if (lower.includes('applixir')) return AD_NETWORK_REGISTRY[1];
  if (lower.includes('google') || lower.includes('gam')) return AD_NETWORK_REGISTRY[2];
  if (lower.includes('adsterra')) return AD_NETWORK_REGISTRY[3];
  return {
    ...AD_NETWORK_REGISTRY[4],
    displayName: networkName || 'Authorized Ad Network',
  };
}

export function getSupportedNetworks(): AdNetworkAdapter[] {
  return AD_NETWORK_REGISTRY;
}

export interface PolicyCheckResult {
  compliant: boolean;
  reason?: string;
}

/**
 * Enforces Rewarded Advertising Policy:
 * 1. Direct Links without explicit incentivized traffic approval CANNOT be reward-eligible.
 * 2. Ads without server-side verification ('none') CANNOT be activated for rewards.
 */
export function checkAdPolicyCompliance(ad: {
  adType: AdType;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
}): PolicyCheckResult {
  if (ad.rewardVerificationMethod === 'none') {
    return {
      compliant: false,
      reason:
        'Ads without server-side verification (S2S Postback or SDK Callback) cannot be activated for rewards.',
    };
  }
  if (ad.adType === 'direct_link' && !ad.incentivizedTrafficAllowed) {
    return {
      compliant: false,
      reason:
        'Direct Link ads cannot be activated for rewards unless Incentivized Traffic is explicitly approved by the Ad Network.',
    };
  }
  return { compliant: true };
}

export function isAdWithinSchedule(ad: Advertisement, dhakaDate: string): boolean {
  if (ad.startDate && dhakaDate < ad.startDate) return false;
  if (ad.endDate && dhakaDate > ad.endDate) return false;
  return true;
}

export function formatAdTypeLabel(adType: AdType): string {
  switch (adType) {
    case 'rewarded':
      return 'Rewarded Ad';
    case 'direct_link':
      return 'Direct Link Ad';
    case 'other':
    default:
      return 'Other Ad';
  }
}

export function formatVerificationMethodLabel(method: RewardVerificationMethod): string {
  switch (method) {
    case 's2s_postback':
      return 'S2S Postback';
    case 'sdk_callback':
      return 'SDK Callback';
    case 'none':
    default:
      return 'Unverified (Disabled)';
  }
}

export function buildPlacementLaunchUrl(
  placementOrUrl: string,
  params: { sessionId: string; userId: string; adId: string; adNetwork?: string },
): string | null {
  const trimmed = placementOrUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const resolved = trimmed
      .replace(/\{sessionId\}|\{session_id\}|\{ymid\}/gi, encodeURIComponent(params.sessionId))
      .replace(/\{userId\}|\{user_id\}|\{subid\}/gi, encodeURIComponent(params.userId))
      .replace(/\{adId\}|\{ad_id\}/gi, encodeURIComponent(params.adId));

    const url = new URL(resolved);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    if (!url.searchParams.has('session_id') && !trimmed.toLowerCase().includes('session')) {
      url.searchParams.set('session_id', params.sessionId);
    }
    if (!url.searchParams.has('subid') && !trimmed.toLowerCase().includes('user')) {
      url.searchParams.set('subid', params.userId);
    }
    if (
      params.adNetwork?.toLowerCase().includes('monetag') &&
      !url.searchParams.has('ymid')
    ) {
      url.searchParams.set('ymid', params.sessionId);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export type AdLaunchKind =
  | 'monetag_sdk'
  | 'gam_rewarded'
  | 'applixir_web'
  | 'external_url'
  | 'unconfigured';

export function resolveAdLaunchKind(placementOrUrl: string): AdLaunchKind {
  const trimmed = placementOrUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return 'external_url';
  }
  if (/^(?:applixir:\/\/|applixir:)[a-zA-Z0-9-]{3,64}$/i.test(trimmed)) {
    return 'applixir_web';
  }
  const gamStripped = trimmed.replace(/^gam:/i, '').trim();
  if (/^\/\d{4,15}\/[a-zA-Z0-9_.\-/]{1,120}$/.test(gamStripped)) {
    return 'gam_rewarded';
  }
  if (
    /^(\d{4,15})$/.test(trimmed) ||
    /^(?:monetag:\/\/|monetag:|zone:|zone_id[:=])(\d{4,15})$/i.test(trimmed)
  ) {
    return 'monetag_sdk';
  }
  return 'unconfigured';
}

