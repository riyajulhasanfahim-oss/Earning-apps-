import { AdNetworkConfig, AdPlacementRecord, AdSessionRecord } from '../types';

export interface AdapterCapabilities {
  supportsS2S: boolean;
  supportsSdkCallback: boolean;
  supportsClicksReporting: boolean;
  supportsApiHealthCheck: boolean;
  incentivizedPolicySummary: string;
}

export interface AdapterInitResult {
  initialized: boolean;
  readyForPlayback: boolean;
  reason?: string;
}

export interface AdapterLoadResult {
  loaded: boolean;
  launchUrl: string | null;
  zoneId: string | null;
  reason?: string;
}

export interface AdapterShowResult {
  shown: boolean;
  mode: 'sdk_overlay' | 'external_placement' | 'unconfigured';
  reason?: string;
}

export interface AdapterCompletionPayload {
  providerTxId: string;
  rawStatus: string;
  rewardEligible: boolean;
  verifiedByProvider: boolean;
}

export interface AdapterVerifyResult {
  verified: boolean;
  requiresServerPostback: boolean;
  reason: string;
}

export interface RewardedNetworkAdapter {
  readonly networkId: string;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities;
  initialize(config: Partial<AdNetworkConfig>): Promise<AdapterInitResult>;
  loadAd(placement: Pick<AdPlacementRecord, 'destinationUrl' | 'zoneOrPlacementCode' | 'rewardEligible'>): Promise<AdapterLoadResult>;
  showAd(loadResult: AdapterLoadResult, session: Pick<AdSessionRecord, 'sessionId' | 'userId' | 'adId'>): Promise<AdapterShowResult>;
  handleCompletion(payload: Partial<AdapterCompletionPayload>): AdapterCompletionPayload;
  verifyReward(session: Pick<AdSessionRecord, 'sessionId' | 'status'>): Promise<AdapterVerifyResult>;
}

function buildResolvedPlacementUrl(
  rawUrl: string,
  session: { sessionId: string; userId: string; adId: string },
): string | null {
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const resolved = trimmed
      .replace(/\{sessionId\}|\{session_id\}|\{ymid\}/gi, encodeURIComponent(session.sessionId))
      .replace(/\{userId\}|\{user_id\}|\{subid\}/gi, encodeURIComponent(session.userId))
      .replace(/\{adId\}|\{ad_id\}/gi, encodeURIComponent(session.adId));
    const url = new URL(resolved);
    if (!url.searchParams.has('ymid') && !url.searchParams.has('session_id')) {
      url.searchParams.set('session_id', session.sessionId);
    }
    if (!url.searchParams.has('subid')) {
      url.searchParams.set('subid', session.userId);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export class MonetagAdAdapter implements RewardedNetworkAdapter {
  readonly networkId = 'monetag';
  readonly displayName = 'Monetag';
  readonly capabilities: AdapterCapabilities = {
    supportsS2S: true,
    supportsSdkCallback: true,
    supportsClicksReporting: false,
    supportsApiHealthCheck: false,
    incentivizedPolicySummary:
      'Supports Monetag Rewarded SDK & S2S postbacks (ymid / subid / tx_id) for explicitly approved rewarded placements.',
  };

  async initialize(config: Partial<AdNetworkConfig>): Promise<AdapterInitResult> {
    if (!config.enabled) {
      return { initialized: false, readyForPlayback: false, reason: 'Monetag network is disabled.' };
    }
    if (!config.publisherId && !config.websiteId && !config.placementId) {
      return {
        initialized: false,
        readyForPlayback: false,
        reason: 'Missing Monetag Publisher ID, Website ID, or Placement Zone ID.',
      };
    }
    if (!config.secretConfigured) {
      return {
        initialized: true,
        readyForPlayback: false,
        reason: 'Monetag Callback Secret is not configured on the server yet.',
      };
    }
    return { initialized: true, readyForPlayback: true };
  }

  async loadAd(
    placement: Pick<AdPlacementRecord, 'destinationUrl' | 'zoneOrPlacementCode' | 'rewardEligible'>,
  ): Promise<AdapterLoadResult> {
    const url = placement.destinationUrl.trim();
    const zone = placement.zoneOrPlacementCode.trim();
    if (!url && !zone) {
      return {
        loaded: false,
        launchUrl: null,
        zoneId: null,
        reason: 'No Monetag rewarded zone ID or destination URL configured.',
      };
    }
    return {
      loaded: true,
      launchUrl: /^https?:\/\//i.test(url) ? url : null,
      zoneId: zone || null,
    };
  }

  async showAd(
    loadResult: AdapterLoadResult,
    session: Pick<AdSessionRecord, 'sessionId' | 'userId' | 'adId'>,
  ): Promise<AdapterShowResult> {
    if (!loadResult.loaded) {
      return { shown: false, mode: 'unconfigured', reason: loadResult.reason || 'Ad not loaded' };
    }
    const resolvedUrl = loadResult.launchUrl
      ? buildResolvedPlacementUrl(loadResult.launchUrl, session)
      : null;
    if (resolvedUrl) {
      return { shown: true, mode: 'external_placement' };
    }
    if (loadResult.zoneId) {
      return { shown: true, mode: 'sdk_overlay' };
    }
    return { shown: false, mode: 'unconfigured', reason: 'No valid Monetag placement target.' };
  }

  handleCompletion(payload: Partial<AdapterCompletionPayload>): AdapterCompletionPayload {
    return {
      providerTxId: String(payload.providerTxId || '').trim(),
      rawStatus: String(payload.rawStatus || 'pending'),
      rewardEligible: Boolean(payload.rewardEligible),
      // Never treat client completion as trusted until S2S callback verifies it
      verifiedByProvider: false,
    };
  }

  async verifyReward(session: Pick<AdSessionRecord, 'sessionId' | 'status'>): Promise<AdapterVerifyResult> {
    if (session.status === 'completed') {
      return {
        verified: true,
        requiresServerPostback: true,
        reason: 'Reward verified by Monetag S2S postback.',
      };
    }
    return {
      verified: false,
      requiresServerPostback: true,
      reason: 'Awaiting verified Monetag S2S postback on server Cloud Function.',
    };
  }
}

export class AdsterraAdAdapter implements RewardedNetworkAdapter {
  readonly networkId = 'adsterra';
  readonly displayName = 'Adsterra';
  readonly capabilities: AdapterCapabilities = {
    supportsS2S: true,
    supportsSdkCallback: false,
    supportsClicksReporting: false,
    supportsApiHealthCheck: true,
    incentivizedPolicySummary:
      'Adsterra forbids incentivized traffic on standard Direct Links. Rewards are blocked unless explicitly approved with S2S postback.',
  };

  async initialize(config: Partial<AdNetworkConfig>): Promise<AdapterInitResult> {
    if (!config.enabled) {
      return { initialized: false, readyForPlayback: false, reason: 'Adsterra network is disabled.' };
    }
    if (!config.publisherId && !config.websiteId && !config.placementId) {
      return {
        initialized: false,
        readyForPlayback: false,
        reason: 'Missing Adsterra Publisher ID, Website ID, or Placement ID.',
      };
    }
    return {
      initialized: true,
      readyForPlayback: Boolean(config.incentivizedTrafficAllowed && config.secretConfigured),
      reason:
        config.incentivizedTrafficAllowed && config.secretConfigured
          ? undefined
          : 'Standard Adsterra placements remain non-rewarded unless incentivized approval + S2S secret are configured.',
    };
  }

  async loadAd(
    placement: Pick<AdPlacementRecord, 'destinationUrl' | 'zoneOrPlacementCode' | 'rewardEligible'>,
  ): Promise<AdapterLoadResult> {
    const url = placement.destinationUrl.trim();
    if (!/^https?:\/\//i.test(url) && !placement.zoneOrPlacementCode.trim()) {
      return {
        loaded: false,
        launchUrl: null,
        zoneId: null,
        reason: 'Adsterra placement URL or placement ID is required.',
      };
    }
    return {
      loaded: true,
      launchUrl: /^https?:\/\//i.test(url) ? url : null,
      zoneId: placement.zoneOrPlacementCode.trim() || null,
    };
  }

  async showAd(
    loadResult: AdapterLoadResult,
    session: Pick<AdSessionRecord, 'sessionId' | 'userId' | 'adId'>,
  ): Promise<AdapterShowResult> {
    if (!loadResult.loaded || !loadResult.launchUrl) {
      return {
        shown: false,
        mode: 'unconfigured',
        reason: 'No valid Adsterra placement URL configured.',
      };
    }
    const resolved = buildResolvedPlacementUrl(loadResult.launchUrl, session);
    return resolved
      ? { shown: true, mode: 'external_placement' }
      : { shown: false, mode: 'unconfigured', reason: 'Invalid Adsterra URL.' };
  }

  handleCompletion(payload: Partial<AdapterCompletionPayload>): AdapterCompletionPayload {
    return {
      providerTxId: String(payload.providerTxId || '').trim(),
      rawStatus: String(payload.rawStatus || 'unrewarded_visit'),
      rewardEligible: Boolean(payload.rewardEligible),
      verifiedByProvider: false,
    };
  }

  async verifyReward(session: Pick<AdSessionRecord, 'sessionId' | 'status'>): Promise<AdapterVerifyResult> {
    if (session.status === 'completed') {
      return {
        verified: true,
        requiresServerPostback: true,
        reason: 'Verified via Adsterra S2S postback.',
      };
    }
    return {
      verified: false,
      requiresServerPostback: true,
      reason: 'Ordinary Direct Link visits do not award points; server S2S confirmation required.',
    };
  }
}

export class AuthorizedPartnerAdapter implements RewardedNetworkAdapter {
  readonly networkId: string;
  readonly displayName: string;
  readonly capabilities: AdapterCapabilities = {
    supportsS2S: true,
    supportsSdkCallback: true,
    supportsClicksReporting: false,
    supportsApiHealthCheck: true,
    incentivizedPolicySummary:
      'Authorized Rewarded Partner Network requiring explicit incentivized consent and HMAC-verified S2S callback.',
  };

  constructor(networkId = 'custom_partner', displayName = 'Authorized Partner') {
    this.networkId = networkId;
    this.displayName = displayName;
  }

  async initialize(config: Partial<AdNetworkConfig>): Promise<AdapterInitResult> {
    if (!config.enabled) {
      return { initialized: false, readyForPlayback: false, reason: 'Network disabled.' };
    }
    if (!config.rewardVerificationSupported) {
      return {
        initialized: true,
        readyForPlayback: false,
        reason: 'This network does not expose a Reward Verification API; reward earning disabled.',
      };
    }
    if (!config.secretConfigured) {
      return {
        initialized: true,
        readyForPlayback: false,
        reason: 'Callback secret is required before enabling rewards.',
      };
    }
    return { initialized: true, readyForPlayback: true };
  }

  async loadAd(
    placement: Pick<AdPlacementRecord, 'destinationUrl' | 'zoneOrPlacementCode' | 'rewardEligible'>,
  ): Promise<AdapterLoadResult> {
    const url = placement.destinationUrl.trim();
    const zone = placement.zoneOrPlacementCode.trim();
    if (!url && !zone) {
      return { loaded: false, launchUrl: null, zoneId: null, reason: 'Placement not configured.' };
    }
    return {
      loaded: true,
      launchUrl: /^https?:\/\//i.test(url) ? url : null,
      zoneId: zone || null,
    };
  }

  async showAd(
    loadResult: AdapterLoadResult,
    session: Pick<AdSessionRecord, 'sessionId' | 'userId' | 'adId'>,
  ): Promise<AdapterShowResult> {
    if (!loadResult.loaded) {
      return { shown: false, mode: 'unconfigured', reason: loadResult.reason };
    }
    if (loadResult.launchUrl && buildResolvedPlacementUrl(loadResult.launchUrl, session)) {
      return { shown: true, mode: 'external_placement' };
    }
    return loadResult.zoneId
      ? { shown: true, mode: 'sdk_overlay' }
      : { shown: false, mode: 'unconfigured', reason: 'Missing placement code or URL.' };
  }

  handleCompletion(payload: Partial<AdapterCompletionPayload>): AdapterCompletionPayload {
    return {
      providerTxId: String(payload.providerTxId || '').trim(),
      rawStatus: String(payload.rawStatus || 'pending'),
      rewardEligible: Boolean(payload.rewardEligible),
      verifiedByProvider: false,
    };
  }

  async verifyReward(session: Pick<AdSessionRecord, 'sessionId' | 'status'>): Promise<AdapterVerifyResult> {
    return {
      verified: session.status === 'completed',
      requiresServerPostback: true,
      reason:
        session.status === 'completed'
          ? 'Reward verified via signed partner callback.'
          : 'Waiting for signed S2S callback.',
    };
  }
}

export function createNetworkAdapter(networkId: string, networkName?: string): RewardedNetworkAdapter {
  const lower = `${networkId} ${networkName || ''}`.toLowerCase();
  if (lower.includes('monetag')) return new MonetagAdAdapter();
  if (lower.includes('adsterra')) return new AdsterraAdAdapter();
  return new AuthorizedPartnerAdapter(networkId || 'custom_partner', networkName || 'Authorized Partner');
}
