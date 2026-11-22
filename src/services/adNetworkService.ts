import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import {
  activeFirebaseConfig as firebaseConfig,
  auth,
  db,
  getAppCheckTokenHeader,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  AdAnalyticsRecord,
  AdCallbackRecord,
  AdCallbackStatus,
  AdCampaignRecord,
  AdminRole,
  AdNetworkConfig,
  AdNetworkHealthStatus,
  AdNetworkIntegrationType,
  AdNetworkLogRecord,
  AdNetworkLogoKey,
  AdPlacementRecord,
  AdType,
  AppLixirEnvCredentialsStatus,
  RewardVerificationMethod,
} from '../types';
import { formatDhakaDateTime } from './appService';
import { recordAdminAuditLogClient } from './adminService';
import { normalizeAdDurationSeconds } from './dashboardService';

function formatTs(ts: unknown): { label: string; millis: number } {
  if (ts instanceof Timestamp) {
    const ms = ts.toDate().getTime();
    return { millis: ms, label: formatDhakaDateTime(ms) };
  }
  return { millis: 0, label: 'Not tested yet' };
}

export function getCanonicalCallbackUrl(networkId: string): string {
  const clean = networkId.trim().toLowerCase();
  if (clean === 'applixir') {
    return `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=applixir`;
  }
  if (clean === 'monetag') {
    return `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=monetag&session_id={ymid}&user_id={subid}&provider_tx_id={click_id}&reward_event_type={reward_event_type}&secret=YOUR_MONETAG_CALLBACK_SECRET`;
  }
  const cleanId = encodeURIComponent(networkId || 'monetag');
  return `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=${cleanId}&session_id={ymid}&user_id={subid}&provider_tx_id={tx_id}&ad_id={ad_id}&ts={ts}&sig={sig}`;
}

export function getDefaultNetworkTemplates(): AdNetworkConfig[] {
  return [
    {
      id: 'applixir',
      networkId: 'applixir',
      networkName: 'AppLixir',
      logoKey: 'applixir',
      integrationType: 's2s_postback',
      publisherId: '',
      websiteId: '',
      placementId: '',
      directLinkUrl: '',
      apiBaseUrl: '',
      callbackUrl: getCanonicalCallbackUrl('applixir'),
      postbackParamsTemplate:
        'gameApiKey={gameApiKey}&gameId={gameId}&userId={userId}&tid={tid}&customData={customData}&signature={signature}',
      incentivizedTrafficAllowed: true,
      rewardVerificationSupported: true,
      rewardEnabled: false,
      clicksSupported: false,
      apiHealthSupported: false,
      secretConfigured: false,
      secretHint: '',
      healthStatus: 'configuration_required',
      healthMessage:
        'Enter your AppLixir Site ID here and set APPLIXIR_API_KEY + APPLIXIR_SECRET_KEY in Backend Environment Variables before enabling rewards.',
      enabled: false,
      lastTestedAt: '',
      updatedAtLabel: 'Template (Not Saved)',
      updatedAtMillis: 0,
    },
    {
      id: 'monetag',
      networkId: 'monetag',
      networkName: 'Monetag',
      logoKey: 'monetag',
      integrationType: 's2s_postback',
      publisherId: '',
      websiteId: '',
      placementId: '',
      directLinkUrl: '',
      apiBaseUrl: '',
      callbackUrl: getCanonicalCallbackUrl('monetag'),
      postbackParamsTemplate: 'ymid={session_id}&subid={user_id}&tx_id={provider_tx_id}&ts={ts}&sig={hmac}',
      incentivizedTrafficAllowed: true,
      rewardVerificationSupported: true,
      rewardEnabled: false,
      clicksSupported: false,
      apiHealthSupported: false,
      secretConfigured: false,
      secretHint: '',
      healthStatus: 'configuration_required',
      healthMessage: 'Enter your Monetag Publisher/Zone ID and configure the server Callback Secret.',
      enabled: false,
      lastTestedAt: '',
      updatedAtLabel: 'Template (Not Saved)',
      updatedAtMillis: 0,
    },
    {
      id: 'adsterra',
      networkId: 'adsterra',
      networkName: 'Adsterra',
      logoKey: 'adsterra',
      integrationType: 'direct_link',
      publisherId: '',
      websiteId: '',
      placementId: '',
      directLinkUrl: '',
      apiBaseUrl: 'https://api3.adsterratools.com/publisher',
      callbackUrl: getCanonicalCallbackUrl('adsterra'),
      postbackParamsTemplate: 'subid={user_id}&ymid={session_id}&tx_id={provider_tx_id}&ts={ts}',
      incentivizedTrafficAllowed: false,
      rewardVerificationSupported: false,
      rewardEnabled: false,
      clicksSupported: false,
      apiHealthSupported: true,
      secretConfigured: false,
      secretHint: '',
      healthStatus: 'configuration_required',
      healthMessage:
        'Adsterra Direct Links are non-incentivized by default. Enable rewards only with explicit account manager approval & S2S callback.',
      enabled: false,
      lastTestedAt: '',
      updatedAtLabel: 'Template (Not Saved)',
      updatedAtMillis: 0,
    },
  ];
}

export function subscribeToAdNetworks(
  onData: (networks: AdNetworkConfig[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adNetworks'),
    (snap) => {
      const items: AdNetworkConfig[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.updatedAt);
        const logoRaw = String(data.logoKey || 'custom');
        const logoKey: AdNetworkLogoKey =
          logoRaw === 'monetag' || logoRaw === 'applixir' || logoRaw === 'adsterra'
            ? logoRaw
            : 'custom';
        const intRaw = String(data.integrationType || 's2s_postback');
        const integrationType: AdNetworkIntegrationType =
          intRaw === 'sdk_callback' || intRaw === 'direct_link' || intRaw === 'hybrid'
            ? intRaw
            : 's2s_postback';
        const healthRaw = String(data.healthStatus || 'configuration_required');
        const healthStatus: AdNetworkHealthStatus =
          healthRaw === 'connected' ||
          healthRaw === 'verification_pending' ||
          healthRaw === 'error' ||
          healthRaw === 'disabled'
            ? healthRaw
            : 'configuration_required';

        return {
          id: d.id,
          networkId: String(data.networkId || d.id),
          networkName: String(data.networkName || d.id),
          logoKey,
          integrationType,
          publisherId: String(data.publisherId || ''),
          websiteId: String(data.websiteId || ''),
          placementId: String(data.placementId || ''),
          directLinkUrl: String(data.directLinkUrl || ''),
          apiBaseUrl: String(data.apiBaseUrl || ''),
          callbackUrl: String(data.callbackUrl || getCanonicalCallbackUrl(d.id)),
          postbackParamsTemplate: String(data.postbackParamsTemplate || ''),
          incentivizedTrafficAllowed: Boolean(data.incentivizedTrafficAllowed),
          rewardVerificationSupported: Boolean(data.rewardVerificationSupported),
          rewardEnabled: Boolean(data.rewardEnabled),
          clicksSupported: Boolean(data.clicksSupported),
          apiHealthSupported: Boolean(data.apiHealthSupported),
          secretConfigured: Boolean(data.secretConfigured),
          secretHint: String(data.secretHint || ''),
          healthStatus,
          healthMessage: String(data.healthMessage || ''),
          enabled: Boolean(data.enabled),
          lastTestedAt: String(data.lastTestedAt || ''),
          updatedAtLabel: label,
          updatedAtMillis: millis,
        };
      });
      items.sort((a, b) => a.networkName.localeCompare(b.networkName));
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, 'adNetworks');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
  );
}

export function subscribeToAdPlacements(
  onData: (placements: AdPlacementRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adPlacements'),
    (snap) => {
      const items: AdPlacementRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.updatedAt);
        const typeRaw = String(data.adType || 'direct_link');
        const adType: AdType =
          typeRaw === 'rewarded' || typeRaw === 'other' ? typeRaw : 'direct_link';
        return {
          id: d.id,
          placementId: String(data.placementId || d.id),
          networkId: String(data.networkId || ''),
          networkName: String(data.networkName || ''),
          placementName: String(data.placementName || ''),
          placementCategory: String(data.placementCategory || 'General'),
          adType,
          destinationUrl: String(data.destinationUrl || ''),
          zoneOrPlacementCode: String(data.zoneOrPlacementCode || ''),
          startDate: String(data.startDate || ''),
          endDate: String(data.endDate || ''),
          status: data.status === 'active' ? 'active' : 'inactive',
          incentivizedTrafficApproved: Boolean(data.incentivizedTrafficApproved),
          rewardEligible: Boolean(data.rewardEligible),
          linkedAdId: String(data.linkedAdId || ''),
          updatedAtLabel: label,
          updatedAtMillis: millis,
        };
      });
      items.sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, 'adPlacements');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
  );
}

export function subscribeToAdCampaigns(
  onData: (campaigns: AdCampaignRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adCampaigns'),
    (snap) => {
      const items: AdCampaignRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.updatedAt);
        const typeRaw = String(data.campaignType || 'rewarded');
        const campaignType: AdType =
          typeRaw === 'direct_link' || typeRaw === 'other' ? typeRaw : 'rewarded';
        const verRaw = String(data.rewardVerificationMethod || 's2s_postback');
        const rewardVerificationMethod: RewardVerificationMethod =
          verRaw === 'sdk_callback' || verRaw === 'none' ? verRaw : 's2s_postback';
        return {
          id: d.id,
          campaignId: String(data.campaignId || d.id),
          campaignName: String(data.campaignName || ''),
          networkId: String(data.networkId || ''),
          networkName: String(data.networkName || ''),
          placementId: String(data.placementId || ''),
          campaignType,
          rewardPoints: Number(data.rewardPoints || 0),
          dailyUserLimit: Number(data.dailyUserLimit || 1),
          globalDailyLimit: Number(data.globalDailyLimit || 100),
          globalCompletedToday: Number(data.globalCompletedToday || 0),
          globalCompletedDhakaDate: String(data.globalCompletedDhakaDate || ''),
          estimatedDuration: normalizeAdDurationSeconds(data.estimatedDuration),
          startDate: String(data.startDate || ''),
          endDate: String(data.endDate || ''),
          targetCountries: String(data.targetCountries || 'ALL'),
          rewardVerificationMethod,
          incentivizedTrafficAllowed: Boolean(data.incentivizedTrafficAllowed),
          rewardEligible: Boolean(data.rewardEligible),
          status: data.status === 'active' ? 'active' : 'inactive',
          linkedAdId: String(data.linkedAdId || ''),
          updatedAtLabel: label,
          updatedAtMillis: millis,
        };
      });
      items.sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, 'adCampaigns');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
  );
}

export function subscribeToAdCallbacks(
  onData: (callbacks: AdCallbackRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adCallbacks'),
    (snap) => {
      const items: AdCallbackRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        const stRaw = String(data.status || 'rejected');
        const status: AdCallbackStatus =
          stRaw === 'processed' ||
          stRaw === 'awaiting_duration' ||
          stRaw === 'duplicate' ||
          stRaw === 'expired' ||
          stRaw === 'invalid_signature'
            ? stRaw
            : 'rejected';
        return {
          id: d.id,
          callbackId: String(data.callbackId || d.id),
          eventId: String(data.eventId || ''),
          networkId: String(data.networkId || ''),
          campaignId: String(data.campaignId || ''),
          sessionId: String(data.sessionId || ''),
          userId: String(data.userId || ''),
          status,
          signatureValid: Boolean(data.signatureValid),
          timestampValid: Boolean(data.timestampValid),
          replayDetected: Boolean(data.replayDetected),
          rewardPoints: Number(data.rewardPoints || 0),
          rejectionReason: String(data.rejectionReason || ''),
          callbackTimestampSec: Number(data.callbackTimestampSec || 0),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, 'adCallbacks');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
  );
}

export function subscribeToAdAnalytics(
  onData: (analytics: AdAnalyticsRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adAnalytics'),
    (snap) => {
      const items: AdAnalyticsRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.updatedAt);
        return {
          id: d.id,
          analyticsId: String(data.analyticsId || d.id),
          networkId: String(data.networkId || ''),
          networkName: String(data.networkName || data.networkId || ''),
          dhakaDate: String(data.dhakaDate || ''),
          impressions: Number(data.impressions || 0),
          clicks: typeof data.clicks === 'number' ? data.clicks : null,
          clicksSupported: Boolean(data.clicksSupported),
          verifiedCompletions: Number(data.verifiedCompletions || 0),
          rejectedCompletions: Number(data.rejectedCompletions || 0),
          totalRewardsDistributed: Number(data.totalRewardsDistributed || 0),
          updatedAtLabel: label,
          updatedAtMillis: millis,
        };
      });
      items.sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, 'adAnalytics');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
  );
}

export function subscribeToAdNetworkLogs(
  onData: (logs: AdNetworkLogRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adNetworkLogs'),
    (snap) => {
      const items: AdNetworkLogRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        const sev = String(data.severity || 'info');
        return {
          id: d.id,
          logId: String(data.logId || d.id),
          networkId: String(data.networkId || ''),
          actorUid: String(data.actorUid || ''),
          actorEmail: String(data.actorEmail || ''),
          eventType: String(data.eventType || 'event'),
          severity: sev === 'error' || sev === 'warning' ? sev : 'info',
          status: String(data.status || ''),
          details: String(data.details || ''),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      if (onError) {
        try {
          handleFirestoreError(error, OperationType.LIST, 'adNetworkLogs');
        } catch (wrapped) {
          onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    },
  );
}

async function invokeAdNetworkCloudFunction<T = Record<string, unknown>>(
  functionName: string,
  payload: Record<string, unknown>,
): Promise<{ reached: boolean; ok: boolean; data?: T; error?: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { reached: false, ok: false, error: 'Authentication required.' };
  }
  const [idToken, appCheckHeaders] = await Promise.all([
    currentUser.getIdToken(),
    getAppCheckTokenHeader(),
  ]);
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/${functionName}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 404) {
      return { reached: false, ok: false, error: 'Cloud Function not deployed yet.' };
    }
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!response.ok || !body.ok) {
      return {
        reached: true,
        ok: false,
        error: body.error || `Request failed (${response.status})`,
      };
    }
    return { reached: true, ok: true, data: body };
  } catch {
    return { reached: false, ok: false, error: 'Cloud Function unreachable.' };
  }
}

export async function recordAdNetworkLogClient(params: {
  networkId: string;
  actor: { uid: string; email: string };
  eventType: string;
  severity: 'info' | 'warning' | 'error';
  status?: string;
  details: string;
}): Promise<void> {
  const logId = `anl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await setDoc(doc(db, 'adNetworkLogs', logId), {
      logId,
      networkId: params.networkId.slice(0, 64),
      actorUid: params.actor.uid,
      actorEmail: params.actor.email.slice(0, 120),
      eventType: params.eventType.slice(0, 80),
      severity: params.severity,
      status: (params.status || '').slice(0, 40),
      details: params.details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking
  }
}

function resolveClientHealth(input: {
  enabled: boolean;
  publisherId: string;
  websiteId: string;
  placementId: string;
  integrationType: AdNetworkIntegrationType;
  rewardVerificationSupported: boolean;
  secretConfigured: boolean;
}): { status: AdNetworkHealthStatus; message: string } {
  if (!input.enabled) {
    return { status: 'disabled', message: 'Network disabled by Administrator.' };
  }
  const hasIds = Boolean(
    input.publisherId.trim() || input.websiteId.trim() || input.placementId.trim(),
  );
  if (!hasIds) {
    return {
      status: 'configuration_required',
      message: 'Enter Publisher ID, Website ID, or Placement ID from your Ad Network account.',
    };
  }
  const needsSecret =
    input.integrationType === 's2s_postback' ||
    input.integrationType === 'sdk_callback' ||
    input.integrationType === 'hybrid';
  if (needsSecret && input.rewardVerificationSupported && !input.secretConfigured) {
    return {
      status: 'configuration_required',
      message: 'Callback Secret required via deployed Cloud Function before live reward verification.',
    };
  }
  return {
    status: 'verification_pending',
    message: 'Credentials saved. Awaiting live provider callback or Cloud Function verification.',
  };
}

export async function saveAdNetworkConfiguration(params: {
  networkId: string;
  networkName: string;
  logoKey: AdNetworkLogoKey;
  integrationType: AdNetworkIntegrationType;
  publisherId: string;
  websiteId: string;
  placementId: string;
  directLinkUrl: string;
  apiBaseUrl: string;
  callbackUrl: string;
  postbackParamsTemplate: string;
  incentivizedTrafficAllowed: boolean;
  rewardVerificationSupported: boolean;
  rewardEnabled: boolean;
  clicksSupported: boolean;
  apiHealthSupported: boolean;
  enabled: boolean;
  existingSecretConfigured: boolean;
  existingSecretHint: string;
  callbackSecretInput?: string;
  apiKeyInput?: string;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<{
  usedCloudFunction: boolean;
  healthStatus: AdNetworkHealthStatus;
  healthMessage: string;
  envCredentials?: AppLixirEnvCredentialsStatus;
}> {
  if (
    params.rewardEnabled &&
    (!params.incentivizedTrafficAllowed || !params.rewardVerificationSupported)
  ) {
    throw new Error(
      'Reward feature cannot be enabled unless Incentivized Traffic AND Reward Verification API are supported.',
    );
  }

  const cleanId = params.networkId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_');
  if (!cleanId || params.networkName.trim().length < 2) {
    throw new Error('Valid Network ID and Network Name are required.');
  }

  const hasNewSecrets = Boolean(
    params.callbackSecretInput?.trim() || params.apiKeyInput?.trim(),
  );

  // Always call Cloud Function first so private credentials go ONLY to adNetworkSecrets (never client Firestore)
  const fnRes = await invokeAdNetworkCloudFunction<{
    healthStatus: AdNetworkHealthStatus;
    healthMessage: string;
    envCredentials?: AppLixirEnvCredentialsStatus;
  }>('saveAdNetworkConfig', {
    networkId: cleanId,
    networkName: params.networkName.trim(),
    logoKey: params.logoKey,
    integrationType: params.integrationType,
    publisherId: params.publisherId.trim(),
    websiteId: params.websiteId.trim(),
    placementId: params.placementId.trim(),
    directLinkUrl: params.directLinkUrl.trim(),
    apiBaseUrl: params.apiBaseUrl.trim(),
    callbackUrl: params.callbackUrl.trim() || getCanonicalCallbackUrl(cleanId),
    postbackParamsTemplate: params.postbackParamsTemplate.trim(),
    incentivizedTrafficAllowed: params.incentivizedTrafficAllowed,
    rewardVerificationSupported: params.rewardVerificationSupported,
    rewardEnabled: params.rewardEnabled,
    clicksSupported: params.clicksSupported,
    apiHealthSupported: params.apiHealthSupported,
    enabled: params.enabled,
    callbackSecret: params.callbackSecretInput?.trim() || '',
    apiKey: params.apiKeyInput?.trim() || '',
  });

  if (fnRes.reached) {
    if (!fnRes.ok || !fnRes.data) {
      throw new Error(fnRes.error || 'Failed to save network configuration.');
    }
    return {
      usedCloudFunction: true,
      healthStatus: fnRes.data.healthStatus,
      healthMessage: fnRes.data.healthMessage,
      envCredentials: fnRes.data.envCredentials,
    };
  }

  if (hasNewSecrets) {
    throw new Error(
      'Secrets (Callback Secret / API Key) can ONLY be stored via the deployed `saveAdNetworkConfig` Cloud Function (`adNetworkSecrets` is server-only). Deploy `functions/` on Firebase Blaze to store provider secrets securely, or clear the secret fields to save public metadata only.',
    );
  }

  const health = resolveClientHealth({
    enabled: params.enabled,
    publisherId: params.publisherId,
    websiteId: params.websiteId,
    placementId: params.placementId,
    integrationType: params.integrationType,
    rewardVerificationSupported: params.rewardVerificationSupported,
    secretConfigured: params.existingSecretConfigured,
  });

  try {
    await setDoc(
      doc(db, 'adNetworks', cleanId),
      {
        networkId: cleanId,
        networkName: params.networkName.trim().slice(0, 80),
        logoKey: params.logoKey,
        integrationType: params.integrationType,
        publisherId: params.publisherId.trim().slice(0, 120),
        websiteId: params.websiteId.trim().slice(0, 120),
        placementId: params.placementId.trim().slice(0, 120),
        directLinkUrl: params.directLinkUrl.trim().slice(0, 500),
        apiBaseUrl: params.apiBaseUrl.trim().slice(0, 300),
        callbackUrl: (params.callbackUrl.trim() || getCanonicalCallbackUrl(cleanId)).slice(0, 500),
        postbackParamsTemplate: params.postbackParamsTemplate.trim().slice(0, 400),
        incentivizedTrafficAllowed: params.incentivizedTrafficAllowed,
        rewardVerificationSupported: params.rewardVerificationSupported,
        rewardEnabled: params.rewardEnabled,
        clicksSupported: params.clicksSupported,
        apiHealthSupported: params.apiHealthSupported,
        secretConfigured: params.existingSecretConfigured,
        secretHint: params.existingSecretHint,
        healthStatus: health.status,
        healthMessage: health.message.slice(0, 300),
        enabled: params.enabled,
        lastTestedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await Promise.all([
      recordAdNetworkLogClient({
        networkId: cleanId,
        actor: params.adminUser,
        eventType: 'network_config_saved',
        severity: 'info',
        status: health.status,
        details: `Updated public metadata for ${params.networkName} (enabled=${params.enabled}, health=${health.status})`,
      }),
      recordAdminAuditLogClient({
        adminUser: params.adminUser,
        action: 'ad_network_config_updated',
        targetId: cleanId,
        newValue: `enabled=${params.enabled}, health=${health.status}`,
        details: `Updated Ad Network ${params.networkName} (${cleanId})`,
      }),
    ]);

    return {
      usedCloudFunction: false,
      healthStatus: health.status,
      healthMessage: health.message,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `adNetworks/${cleanId}`);
  }
}

export async function testAdNetworkHealth(params: {
  network: AdNetworkConfig;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<{
  healthStatus: AdNetworkHealthStatus;
  healthMessage: string;
  usedCloudFunction: boolean;
  envCredentials?: AppLixirEnvCredentialsStatus;
}> {
  const { network, adminUser } = params;

  const fnRes = await invokeAdNetworkCloudFunction<{
    healthStatus: AdNetworkHealthStatus;
    healthMessage: string;
    envCredentials?: AppLixirEnvCredentialsStatus;
  }>('testAdNetworkConnection', { networkId: network.networkId });

  if (fnRes.reached) {
    if (!fnRes.ok || !fnRes.data) {
      throw new Error(fnRes.error || 'Network connection test failed.');
    }
    return {
      healthStatus: fnRes.data.healthStatus,
      healthMessage: fnRes.data.healthMessage,
      usedCloudFunction: true,
      envCredentials: fnRes.data.envCredentials,
    };
  }

  // Honest client fallback: evaluates configuration completeness without faking "Connected"
  const health = resolveClientHealth({
    enabled: network.enabled,
    publisherId: network.publisherId,
    websiteId: network.websiteId,
    placementId: network.placementId,
    integrationType: network.integrationType,
    rewardVerificationSupported: network.rewardVerificationSupported,
    secretConfigured: network.secretConfigured,
  });

  try {
    await setDoc(
      doc(db, 'adNetworks', network.networkId),
      {
        networkId: network.networkId,
        networkName: network.networkName,
        logoKey: network.logoKey,
        integrationType: network.integrationType,
        publisherId: network.publisherId,
        websiteId: network.websiteId,
        placementId: network.placementId,
        directLinkUrl: network.directLinkUrl,
        apiBaseUrl: network.apiBaseUrl,
        callbackUrl: network.callbackUrl,
        postbackParamsTemplate: network.postbackParamsTemplate,
        incentivizedTrafficAllowed: network.incentivizedTrafficAllowed,
        rewardVerificationSupported: network.rewardVerificationSupported,
        rewardEnabled: network.rewardEnabled,
        clicksSupported: network.clicksSupported,
        apiHealthSupported: network.apiHealthSupported,
        secretConfigured: network.secretConfigured,
        secretHint: network.secretHint,
        healthStatus: health.status,
        healthMessage: `${health.message} (Deploy Cloud Functions to run live provider API ping.)`.slice(
          0,
          300,
        ),
        enabled: network.enabled,
        lastTestedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await recordAdNetworkLogClient({
      networkId: network.networkId,
      actor: adminUser,
      eventType: 'network_health_checked',
      severity: health.status === 'configuration_required' ? 'warning' : 'info',
      status: health.status,
      details: health.message,
    });

    return {
      healthStatus: health.status,
      healthMessage: health.message,
      usedCloudFunction: false,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `adNetworks/${network.networkId}`);
  }
}

export async function saveAdPlacementOrDirectLink(params: {
  placementId: string;
  networkId: string;
  networkName: string;
  placementName: string;
  placementCategory: string;
  adType: AdType;
  destinationUrl: string;
  zoneOrPlacementCode: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  incentivizedTrafficApproved: boolean;
  rewardEligible: boolean;
  linkedAdId: string;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  const cleanId = params.placementId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleanId || params.placementName.trim().length < 2) {
    throw new Error('Placement ID and Name are required.');
  }

  // Enforce Direct Link policy: ordinary direct links cannot claim reward eligibility
  const effectiveRewardEligible =
    params.adType === 'direct_link'
      ? Boolean(params.incentivizedTrafficApproved && params.rewardEligible)
      : Boolean(params.rewardEligible && params.incentivizedTrafficApproved);

  if (params.adType === 'direct_link' && params.rewardEligible && !params.incentivizedTrafficApproved) {
    throw new Error(
      'Direct Links without explicit Network Incentivized Traffic Approval cannot be marked Reward Eligible.',
    );
  }

  try {
    await setDoc(doc(db, 'adPlacements', cleanId), {
      placementId: cleanId,
      networkId: params.networkId.trim(),
      networkName: params.networkName.trim().slice(0, 80),
      placementName: params.placementName.trim().slice(0, 100),
      placementCategory: params.placementCategory.trim().slice(0, 60) || 'General',
      adType: params.adType,
      destinationUrl: params.destinationUrl.trim().slice(0, 500),
      zoneOrPlacementCode: params.zoneOrPlacementCode.trim().slice(0, 120),
      startDate: params.startDate.trim().slice(0, 20),
      endDate: params.endDate.trim().slice(0, 20),
      status: params.status,
      incentivizedTrafficApproved: params.incentivizedTrafficApproved,
      rewardEligible: effectiveRewardEligible,
      linkedAdId: params.linkedAdId.trim().slice(0, 80),
      updatedAt: serverTimestamp(),
    });

    await Promise.all([
      recordAdNetworkLogClient({
        networkId: params.networkId,
        actor: params.adminUser,
        eventType: 'placement_saved',
        severity: 'info',
        status: params.status,
        details: `Saved ${params.adType} placement "${params.placementName}" (rewardEligible=${effectiveRewardEligible})`,
      }),
      recordAdminAuditLogClient({
        adminUser: params.adminUser,
        action: 'ad_placement_saved',
        targetId: cleanId,
        newValue: `${params.placementName} (${params.status}, rewardEligible=${effectiveRewardEligible})`,
        details: `Saved placement "${params.placementName}" on ${params.networkName}`,
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `adPlacements/${cleanId}`);
  }
}

export async function deleteAdPlacementRecord(params: {
  placement: AdPlacementRecord;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'adPlacements', params.placement.placementId));
    await Promise.all([
      recordAdNetworkLogClient({
        networkId: params.placement.networkId,
        actor: params.adminUser,
        eventType: 'placement_deleted',
        severity: 'warning',
        details: `Deleted placement "${params.placement.placementName}" (${params.placement.placementId})`,
      }),
      recordAdminAuditLogClient({
        adminUser: params.adminUser,
        action: 'ad_placement_deleted',
        targetId: params.placement.placementId,
        previousValue: params.placement.placementName,
        newValue: 'deleted',
        details: `Deleted ad placement ${params.placement.placementName}`,
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `adPlacements/${params.placement.placementId}`);
  }
}

export async function saveAdCampaignRecord(params: {
  campaignId: string;
  campaignName: string;
  networkId: string;
  networkName: string;
  placementId: string;
  campaignType: AdType;
  rewardPoints: number;
  dailyUserLimit: number;
  globalDailyLimit: number;
  estimatedDuration: number;
  startDate: string;
  endDate: string;
  targetCountries: string;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
  rewardEligible: boolean;
  status: 'active' | 'inactive';
  linkedAdId: string;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  const cleanId = params.campaignId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleanId || params.campaignName.trim().length < 2) {
    throw new Error('Campaign ID and Campaign Name are required.');
  }

  const effectiveEligible =
    params.rewardEligible &&
    params.incentivizedTrafficAllowed &&
    params.rewardVerificationMethod !== 'none' &&
    (params.campaignType !== 'direct_link' || params.incentivizedTrafficAllowed);

  const effectiveRewardPoints = effectiveEligible
    ? Math.max(0, Math.floor(params.rewardPoints))
    : 0;

  if (params.rewardPoints > 0 && !effectiveEligible) {
    throw new Error(
      'Reward Points require Incentivized Traffic approval and Server Verification (S2S Postback or SDK Callback).',
    );
  }

  try {
    await setDoc(
      doc(db, 'adCampaigns', cleanId),
      {
        campaignId: cleanId,
        campaignName: params.campaignName.trim().slice(0, 100),
        networkId: params.networkId.trim(),
        networkName: params.networkName.trim().slice(0, 80),
        placementId: params.placementId.trim().slice(0, 80),
        campaignType: params.campaignType,
        rewardPoints: effectiveRewardPoints,
        dailyUserLimit: Math.max(1, Math.floor(params.dailyUserLimit)),
        globalDailyLimit: Math.max(1, Math.floor(params.globalDailyLimit)),
        estimatedDuration: normalizeAdDurationSeconds(params.estimatedDuration),
        startDate: params.startDate.trim().slice(0, 20),
        endDate: params.endDate.trim().slice(0, 20),
        targetCountries: params.targetCountries.trim().slice(0, 120) || 'ALL',
        rewardVerificationMethod: params.rewardVerificationMethod,
        incentivizedTrafficAllowed: params.incentivizedTrafficAllowed,
        rewardEligible: effectiveEligible,
        status: params.status,
        linkedAdId: params.linkedAdId.trim().slice(0, 80),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await Promise.all([
      recordAdNetworkLogClient({
        networkId: params.networkId,
        actor: params.adminUser,
        eventType: 'campaign_saved',
        severity: 'info',
        status: params.status,
        details: `Saved campaign "${params.campaignName}" (+${effectiveRewardPoints} Pts, userCap=${params.dailyUserLimit}, globalCap=${params.globalDailyLimit})`,
      }),
      recordAdminAuditLogClient({
        adminUser: params.adminUser,
        action: 'ad_campaign_saved',
        targetId: cleanId,
        newValue: `${params.campaignName} (${params.status}, ${effectiveRewardPoints} Pts)`,
        details: `Saved campaign "${params.campaignName}" (${params.networkName})`,
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `adCampaigns/${cleanId}`);
  }
}

export async function deleteAdCampaignRecord(params: {
  campaign: AdCampaignRecord;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'adCampaigns', params.campaign.campaignId));
    await Promise.all([
      recordAdNetworkLogClient({
        networkId: params.campaign.networkId,
        actor: params.adminUser,
        eventType: 'campaign_deleted',
        severity: 'warning',
        details: `Deleted campaign "${params.campaign.campaignName}" (${params.campaign.campaignId})`,
      }),
      recordAdminAuditLogClient({
        adminUser: params.adminUser,
        action: 'ad_campaign_deleted',
        targetId: params.campaign.campaignId,
        previousValue: params.campaign.campaignName,
        newValue: 'deleted',
        details: `Deleted campaign ${params.campaign.campaignName}`,
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `adCampaigns/${params.campaign.campaignId}`);
  }
}
