import {
  DAILY_CHECKIN_BONUS_AD_ID,
  db,
  FieldValue,
  getDhakaDateKey,
  logFailedTransaction,
  logFraudAttempt,
  MIN_AD_VIEW_DURATION_SEC,
  normalizeAdDurationSeconds,
  sanitizeId,
  timingSafeEqualString,
  verifyAppLixirMd5Signature,
  verifyCallbackSecretOrHmac,
} from './helpers';

export const MAX_CALLBACK_AGE_SEC = 900; // 15 minutes
export const MAX_FUTURE_SKEW_SEC = 60; // 1 minute clock skew tolerance

export type NetworkHealthStatus =
  | 'connected'
  | 'configuration_required'
  | 'verification_pending'
  | 'error'
  | 'disabled';

export interface TimestampValidationResult {
  valid: boolean;
  expired: boolean;
  futureSkew: boolean;
  parsedSec: number | null;
  reason?: string;
}

export function parseCallbackTimestampSec(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Support millisecond timestamps (> 1e12) or second timestamps
  return num > 1_000_000_000_000 ? Math.floor(num / 1000) : Math.floor(num);
}

export function validateCallbackTimestamp(
  tsSec: number | null,
  nowSec: number = Math.floor(Date.now() / 1000),
): TimestampValidationResult {
  if (tsSec === null) {
    // Timestamp optional only when provider template omits {ts}; when supplied it MUST be fresh.
    return { valid: true, expired: false, futureSkew: false, parsedSec: null };
  }
  const age = nowSec - tsSec;
  if (age > MAX_CALLBACK_AGE_SEC) {
    return {
      valid: false,
      expired: true,
      futureSkew: false,
      parsedSec: tsSec,
      reason: `EXPIRED_CALLBACK (age=${age}s > ${MAX_CALLBACK_AGE_SEC}s)`,
    };
  }
  if (tsSec - nowSec > MAX_FUTURE_SKEW_SEC) {
    return {
      valid: false,
      expired: false,
      futureSkew: true,
      parsedSec: tsSec,
      reason: `INVALID_FUTURE_TIMESTAMP (+${tsSec - nowSec}s)`,
    };
  }
  return { valid: true, expired: false, futureSkew: false, parsedSec: tsSec };
}

export function resolveNetworkHealthStatus(input: {
  enabled: boolean;
  publisherId?: string;
  websiteId?: string;
  placementId?: string;
  integrationType: string;
  rewardVerificationSupported: boolean;
  secretConfigured: boolean;
  apiCheckOk?: boolean | null;
  apiCheckError?: string;
  hasVerifiedCallbacks?: boolean;
}): { status: NetworkHealthStatus; message: string } {
  if (!input.enabled) {
    return { status: 'disabled', message: 'Network disabled by Administrator.' };
  }
  if (input.apiCheckOk === false) {
    return {
      status: 'error',
      message: input.apiCheckError || 'Provider API check failed.',
    };
  }

  const hasIds = Boolean(
    (input.publisherId && input.publisherId.trim()) ||
      (input.websiteId && input.websiteId.trim()) ||
      (input.placementId && input.placementId.trim()),
  );

  if (!hasIds) {
    return {
      status: 'configuration_required',
      message: 'Enter Publisher ID, Website ID, or Placement ID from your network dashboard.',
    };
  }

  const needsSecret =
    input.integrationType === 's2s_postback' ||
    input.integrationType === 'sdk_callback' ||
    input.integrationType === 'hybrid';

  if (needsSecret && input.rewardVerificationSupported && !input.secretConfigured) {
    return {
      status: 'configuration_required',
      message: 'Configure server-side Callback Secret / API Key before activating rewards.',
    };
  }

  if (input.apiCheckOk === true || input.hasVerifiedCallbacks) {
    return {
      status: 'connected',
      message:
        input.apiCheckOk === true
          ? 'Provider API reachability and server configuration verified.'
          : 'Configuration valid and verified S2S postback completions recorded.',
    };
  }

  return {
    status: 'verification_pending',
    message:
      'Credentials saved. Waiting for a verified live S2S callback or provider API ping.',
  };
}

export async function writeAdNetworkLog(params: {
  networkId: string;
  actorUid?: string;
  actorEmail?: string;
  eventType: string;
  severity: 'info' | 'warning' | 'error';
  status?: string;
  details: string;
}): Promise<void> {
  const logId = sanitizeId(`anl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await db
    .collection('adNetworkLogs')
    .doc(logId)
    .set({
      logId,
      networkId: String(params.networkId || 'unknown').slice(0, 64),
      ...(params.actorUid ? { actorUid: params.actorUid.slice(0, 128) } : {}),
      ...(params.actorEmail ? { actorEmail: params.actorEmail.slice(0, 120) } : {}),
      eventType: params.eventType.slice(0, 80),
      severity: params.severity,
      ...(params.status ? { status: params.status.slice(0, 40) } : {}),
      details: params.details.slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});
}

export async function recordAdAnalyticsDelta(params: {
  networkId: string;
  networkName: string;
  dhakaDate: string;
  clicksSupported: boolean;
  deltaImpressions?: number;
  deltaVerified?: number;
  deltaRejected?: number;
  deltaRewards?: number;
}): Promise<void> {
  const analyticsId = sanitizeId(`${params.networkId}_${params.dhakaDate}`);
  const ref = db.collection('adAnalytics').doc(analyticsId);

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    const prev = snap.exists ? snap.data()! : {};
    txn.set(
      ref,
      {
        analyticsId,
        networkId: params.networkId,
        networkName: params.networkName.slice(0, 80),
        dhakaDate: params.dhakaDate,
        impressions: Math.max(0, Number(prev.impressions || 0) + (params.deltaImpressions || 0)),
        clicks: prev.clicks ?? null,
        clicksSupported: Boolean(prev.clicksSupported ?? params.clicksSupported),
        verifiedCompletions: Math.max(
          0,
          Number(prev.verifiedCompletions || 0) + (params.deltaVerified || 0),
        ),
        rejectedCompletions: Math.max(
          0,
          Number(prev.rejectedCompletions || 0) + (params.deltaRejected || 0),
        ),
        totalRewardsDistributed: Math.max(
          0,
          Number(prev.totalRewardsDistributed || 0) + (params.deltaRewards || 0),
        ),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export interface NetworkCallbackExecutionContext {
  sessionId: string;
  userId: string;
  adId: string;
  providerTxId: string;
  eventId: string;
  networkId: string;
  campaignId: string;
  providedSecret: string;
  providedSignature: string;
  rawTimestamp: unknown;
  clientIp: string;
  applixirParams?: {
    gameApiKey: string;
    gameId: string;
    rawUserId: string;
    tid: string;
    status: string;
    signature: string;
    secretKeyParam: string;
  };
  monetagParams?: {
    rewardEventType: string;
  };
  executeRewardTransaction: (params: {
    sessionId: string;
    userId: string;
    adId: string;
    providerTxId: string;
  }) => Promise<{ rewardPoints: number; txId: string; bdtSnapshot: number }>;
  onRewardCompleted?: (userId: string) => Promise<void>;
}

export async function processVerifiedNetworkCallback(
  ctx: NetworkCallbackExecutionContext,
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const dhakaToday = getDhakaDateKey();
  const effectiveEventId = sanitizeId(ctx.eventId || ctx.providerTxId || `evt_${Date.now()}`);
  const callbackId = sanitizeId(`cb_${effectiveEventId}`);
  const callbackRef = db.collection('adCallbacks').doc(callbackId);

  // Resolve network & secret metadata when networkId or campaignId is present
  let resolvedNetworkId = ctx.networkId ? sanitizeId(ctx.networkId) : '';
  if (
    !resolvedNetworkId &&
    ctx.applixirParams &&
    (ctx.applixirParams.gameApiKey ||
      ctx.applixirParams.gameId ||
      ctx.applixirParams.tid ||
      ctx.applixirParams.signature)
  ) {
    resolvedNetworkId = 'applixir';
  }

  let campaignData: FirebaseFirestore.DocumentData | null = null;
  let networkData: FirebaseFirestore.DocumentData | null = null;

  if (ctx.campaignId) {
    const campSnap = await db.collection('adCampaigns').doc(sanitizeId(ctx.campaignId)).get();
    if (campSnap.exists) {
      campaignData = campSnap.data()!;
      if (!resolvedNetworkId && campaignData.networkId) {
        resolvedNetworkId = sanitizeId(String(campaignData.networkId));
      }
    }
  }

  let expectedNetworkSecret = '';
  let storedNetworkApiKey = '';
  if (resolvedNetworkId) {
    const [netSnap, secSnap] = await Promise.all([
      db.collection('adNetworks').doc(resolvedNetworkId).get(),
      db.collection('adNetworkSecrets').doc(resolvedNetworkId).get(),
    ]);
    if (netSnap.exists) {
      networkData = netSnap.data()!;
    }
    if (secSnap.exists) {
      const secData = secSnap.data()!;
      if (typeof secData.callbackSecret === 'string') {
        expectedNetworkSecret = String(secData.callbackSecret).trim();
      }
      if (typeof secData.apiKey === 'string') {
        storedNetworkApiKey = String(secData.apiKey).trim();
      }
    }
  }

  const envFallbackSecret = (process.env.POSTBACK_SECRET || '').trim();
  const envAppLixirSecret = (process.env.APPLIXIR_SECRET_KEY || '').trim();
  const envAppLixirApiKey = (process.env.APPLIXIR_API_KEY || '').trim();
  const networkName = String(
    networkData?.networkName || campaignData?.networkName || resolvedNetworkId || 'Ad Network',
  );
  const clicksSupported = Boolean(networkData?.clicksSupported ?? false);
  const analyticsNetId = resolvedNetworkId || 'default_network';

  // 0. AppLixir status rejection check (never reward failed/cancelled callbacks)
  const appLixirStatusLower = (ctx.applixirParams?.status || '').trim().toLowerCase();
  if (
    appLixirStatusLower &&
    ['failed', 'fail', 'cancelled', 'canceled', 'rejected', 'error', '0', 'false'].includes(
      appLixirStatusLower,
    )
  ) {
    const failId = sanitizeId(`cb_rej_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await Promise.all([
      db.collection('adCallbacks').doc(failId).set({
        callbackId: failId,
        eventId: effectiveEventId,
        networkId: analyticsNetId,
        campaignId: ctx.campaignId || '',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        status: 'rejected',
        signatureValid: true,
        timestampValid: true,
        replayDetected: false,
        rewardPoints: 0,
        rejectionReason: 'APPLIXIR_STATUS_NOT_COMPLETED',
        callbackTimestampSec: parseCallbackTimestampSec(ctx.rawTimestamp) ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_status_rejected',
        severity: 'warning',
        status: 'rejected',
        details: `Rejected non-completed AppLixir callback status="${appLixirStatusLower}" for session=${ctx.sessionId}`,
      }),
    ]);
    return { httpStatus: 403, body: { ok: false, error: 'APPLIXIR_STATUS_NOT_COMPLETED' } };
  }

  // 0b. Monetag reward_event_type check (never reward not_valued events)
  const monetagEventLower = (ctx.monetagParams?.rewardEventType || '').trim().toLowerCase();
  if (
    monetagEventLower &&
    ['not_valued', 'not-valued', 'rejected', 'failed', '0', 'false'].includes(monetagEventLower)
  ) {
    const failId = sanitizeId(`cb_rej_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await Promise.all([
      db.collection('adCallbacks').doc(failId).set({
        callbackId: failId,
        eventId: effectiveEventId,
        networkId: analyticsNetId,
        campaignId: ctx.campaignId || '',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        status: 'rejected',
        signatureValid: true,
        timestampValid: true,
        replayDetected: false,
        rewardPoints: 0,
        rejectionReason: 'MONETAG_EVENT_NOT_VALUED',
        callbackTimestampSec: parseCallbackTimestampSec(ctx.rawTimestamp) ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_monetag_not_valued',
        severity: 'warning',
        status: 'rejected',
        details: `Rejected Monetag callback reward_event_type="${monetagEventLower}" for session=${ctx.sessionId}`,
      }),
    ]);
    return { httpStatus: 403, body: { ok: false, error: 'MONETAG_EVENT_NOT_VALUED' } };
  }

  // 1. Validate Signature / Secret
  const payloadToSign = `${ctx.sessionId}:${ctx.userId}:${ctx.providerTxId}`;
  const payloadWithTs =
    ctx.rawTimestamp !== undefined && ctx.rawTimestamp !== ''
      ? `${payloadToSign}:${String(ctx.rawTimestamp)}`
      : payloadToSign;

  let signatureValid = false;

  if (resolvedNetworkId === 'applixir') {
    const effectiveAppLixirSecret = envAppLixirSecret || expectedNetworkSecret;
    const effectiveAppLixirApiKey = envAppLixirApiKey || storedNetworkApiKey;
    const incomingApiKey = (ctx.applixirParams?.gameApiKey || '').trim();

    // When backend API Key is configured and AppLixir sends gameApiKey, require timing-safe match
    const apiKeyMatchOk =
      !effectiveAppLixirApiKey ||
      !incomingApiKey ||
      timingSafeEqualString(incomingApiKey, effectiveAppLixirApiKey);

    if (apiKeyMatchOk && effectiveAppLixirSecret) {
      const md5Valid = Boolean(
        ctx.applixirParams?.signature &&
          verifyAppLixirMd5Signature({
            gameApiKey: incomingApiKey,
            gameId: ctx.applixirParams.gameId || '',
            userId: ctx.applixirParams.rawUserId || ctx.userId || '',
            tid: ctx.applixirParams.tid || ctx.providerTxId || '',
            signature: ctx.applixirParams.signature,
            secret: effectiveAppLixirSecret,
          }),
      );

      const hmacOrSecretValid =
        verifyCallbackSecretOrHmac(
          ctx.providedSecret || ctx.applixirParams?.secretKeyParam || '',
          ctx.providedSignature,
          payloadWithTs,
          effectiveAppLixirSecret,
        ) ||
        verifyCallbackSecretOrHmac(
          ctx.providedSecret || ctx.applixirParams?.secretKeyParam || '',
          ctx.providedSignature,
          payloadToSign,
          effectiveAppLixirSecret,
        );

      signatureValid = md5Valid || hmacOrSecretValid;
    }
  } else {
    const sigMatchedNetwork = expectedNetworkSecret
      ? verifyCallbackSecretOrHmac(
          ctx.providedSecret,
          ctx.providedSignature,
          payloadWithTs,
          expectedNetworkSecret,
        ) ||
        verifyCallbackSecretOrHmac(
          ctx.providedSecret,
          ctx.providedSignature,
          payloadToSign,
          expectedNetworkSecret,
        )
      : false;

    const sigMatchedGlobal = envFallbackSecret
      ? verifyCallbackSecretOrHmac(
          ctx.providedSecret,
          ctx.providedSignature,
          payloadToSign,
          envFallbackSecret,
        )
      : false;

    signatureValid = sigMatchedNetwork || sigMatchedGlobal;
  }

  if (!signatureValid) {
    const failId = sanitizeId(`cb_fail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await Promise.all([
      db.collection('adCallbacks').doc(failId).set({
        callbackId: failId,
        eventId: effectiveEventId,
        networkId: analyticsNetId,
        campaignId: ctx.campaignId || '',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        status: 'invalid_signature',
        signatureValid: false,
        timestampValid: true,
        replayDetected: false,
        rewardPoints: 0,
        rejectionReason: 'INVALID_CALLBACK_SIGNATURE',
        callbackTimestampSec: parseCallbackTimestampSec(ctx.rawTimestamp) ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_invalid_signature',
        severity: 'error',
        status: 'rejected',
        details: `Invalid callback signature/secret from IP ${ctx.clientIp} (eventId=${effectiveEventId}, session=${ctx.sessionId})`,
      }),
      logFraudAttempt(
        ctx.userId,
        'Invalid S2S callback authentication',
        `Rejected callback from IP ${ctx.clientIp} for session ${ctx.sessionId} (network=${analyticsNetId})`,
        'high',
      ),
      recordAdAnalyticsDelta({
        networkId: analyticsNetId,
        networkName,
        dhakaDate: dhakaToday,
        clicksSupported,
        deltaRejected: 1,
      }),
    ]);
    return { httpStatus: 401, body: { ok: false, error: 'Unauthorized postback signature' } };
  }

  // 2. Validate Timestamp & Anti-Expiry
  const parsedTs = parseCallbackTimestampSec(ctx.rawTimestamp);
  const tsCheck = validateCallbackTimestamp(parsedTs);
  if (!tsCheck.valid) {
    const expId = sanitizeId(`cb_exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await Promise.all([
      db.collection('adCallbacks').doc(expId).set({
        callbackId: expId,
        eventId: effectiveEventId,
        networkId: analyticsNetId,
        campaignId: ctx.campaignId || '',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        status: 'expired',
        signatureValid: true,
        timestampValid: false,
        replayDetected: false,
        rewardPoints: 0,
        rejectionReason: tsCheck.reason || 'EXPIRED_CALLBACK',
        callbackTimestampSec: parsedTs ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_expired',
        severity: 'warning',
        status: 'expired',
        details: `${tsCheck.reason} (eventId=${effectiveEventId})`,
      }),
      recordAdAnalyticsDelta({
        networkId: analyticsNetId,
        networkName,
        dhakaDate: dhakaToday,
        clicksSupported,
        deltaRejected: 1,
      }),
    ]);
    return { httpStatus: 409, body: { ok: false, error: 'EXPIRED_CALLBACK' } };
  }

  // 3. Required parameter check
  if (!ctx.sessionId || !ctx.userId || !ctx.adId || !ctx.providerTxId) {
    await Promise.all([
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_malformed',
        severity: 'warning',
        status: 'rejected',
        details: `Missing parameters: sessionId=${ctx.sessionId}, adId=${ctx.adId}, providerTxId=${ctx.providerTxId}`,
      }),
      logFraudAttempt(
        ctx.userId,
        'Malformed S2S postback parameters',
        `Missing required parameters: sessionId=${ctx.sessionId}, adId=${ctx.adId}, providerTxId=${ctx.providerTxId}`,
        'medium',
      ),
    ]);
    return { httpStatus: 400, body: { ok: false, error: 'Missing required postback parameters' } };
  }

  // Resolve session timing early so valid early S2S postbacks (<30s) can be held safely as awaiting_duration
  let heldSessionReleaseSec = 0;
  let shouldHoldEarlyCallback = false;
  if (ctx.sessionId) {
    const sessSnap = await db.collection('adSessions').doc(ctx.sessionId).get();
    if (sessSnap.exists) {
      const sessData = sessSnap.data()!;
      if (
        sessData.status === 'pending' &&
        sessData.userId === ctx.userId &&
        sessData.adId === ctx.adId &&
        sessData.createdAt &&
        typeof sessData.createdAt.toMillis === 'function'
      ) {
        let requiredDurationSec = MIN_AD_VIEW_DURATION_SEC;
        if (ctx.adId === DAILY_CHECKIN_BONUS_AD_ID) {
          const bonusSnap = await db.collection('appSettings').doc('dailyBonus').get();
          if (bonusSnap.exists) {
            requiredDurationSec = normalizeAdDurationSeconds(bonusSnap.data()!.durationSeconds);
          }
        } else {
          const adSnap = await db.collection('advertisements').doc(ctx.adId).get();
          if (adSnap.exists) {
            requiredDurationSec = normalizeAdDurationSeconds(adSnap.data()!.estimatedDuration);
          }
        }
        const elapsedSinceStartSec = (Date.now() - sessData.createdAt.toMillis()) / 1000;
        if (elapsedSinceStartSec < requiredDurationSec) {
          shouldHoldEarlyCallback = true;
          heldSessionReleaseSec = Math.max(1, Math.ceil(requiredDurationSec - elapsedSinceStartSec));
        }
      }
    }
  }

  // 4. Replay Attack / Duplicate Event ID protection
  const existingCb = await callbackRef.get();
  if (existingCb.exists) {
    const existingStatus = String(existingCb.data()?.status || '');
    if (existingStatus === 'awaiting_duration') {
      if (shouldHoldEarlyCallback) {
        return {
          httpStatus: 202,
          body: {
            ok: true,
            status: 'awaiting_duration',
            callbackId,
            eventId: effectiveEventId,
            sessionId: ctx.sessionId,
            releaseAfterSec: heldSessionReleaseSec,
          },
        };
      }
      // 30s+ now elapsed: allow execution to proceed below and finalize this held callback atomically.
    } else {
      const dupId = sanitizeId(`cb_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
      await Promise.all([
        db.collection('adCallbacks').doc(dupId).set({
          callbackId: dupId,
          eventId: effectiveEventId,
          networkId: analyticsNetId,
          campaignId: ctx.campaignId || '',
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          status: 'duplicate',
          signatureValid: true,
          timestampValid: true,
          replayDetected: true,
          rewardPoints: 0,
          rejectionReason: 'DUPLICATE_CALLBACK_EVENT',
          callbackTimestampSec: parsedTs ?? 0,
          createdAt: FieldValue.serverTimestamp(),
        }),
        writeAdNetworkLog({
          networkId: analyticsNetId,
          eventType: 'callback_replay_blocked',
          severity: 'error',
          status: 'duplicate',
          details: `Blocked duplicate/replayed callback eventId=${effectiveEventId} (providerTxId=${ctx.providerTxId})`,
        }),
        logFraudAttempt(
          ctx.userId,
          'Replay / Duplicate S2S callback blocked',
          `eventId=${effectiveEventId}, providerTxId=${ctx.providerTxId}`,
          'high',
        ),
        recordAdAnalyticsDelta({
          networkId: analyticsNetId,
          networkName,
          dhakaDate: dhakaToday,
          clicksSupported,
          deltaRejected: 1,
        }),
      ]);
      return { httpStatus: 409, body: { ok: false, error: 'DUPLICATE_CALLBACK_EVENT' } };
    }
  }

  const recordPolicyRejection = async (code: string, status = 403) => {
    const rejId = sanitizeId(`cb_rej_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    await Promise.all([
      db.collection('adCallbacks').doc(rejId).set({
        callbackId: rejId,
        eventId: effectiveEventId,
        networkId: analyticsNetId,
        campaignId: ctx.campaignId || '',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        status: 'rejected',
        signatureValid: true,
        timestampValid: true,
        replayDetected: false,
        rewardPoints: 0,
        rejectionReason: code,
        callbackTimestampSec: parsedTs ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_policy_rejected',
        severity: 'warning',
        status: 'rejected',
        details: `Callback rejected (${code}) for session=${ctx.sessionId}`,
      }),
    ]);
    return { httpStatus: status, body: { ok: false, error: code } };
  };

  // 5. Network & Campaign Eligibility + Global Daily Limit checks
  if (networkData) {
    if (!networkData.enabled) {
      return recordPolicyRejection('NETWORK_DISABLED', 403);
    }
    if (!networkData.rewardEnabled || !networkData.incentivizedTrafficAllowed || !networkData.rewardVerificationSupported) {
      return recordPolicyRejection('NETWORK_REWARD_NOT_ELIGIBLE', 403);
    }
  }

  if (campaignData) {
    if (campaignData.status !== 'active') {
      return recordPolicyRejection('CAMPAIGN_DISABLED', 403);
    }
    if (!campaignData.rewardEligible || !campaignData.incentivizedTrafficAllowed || campaignData.rewardVerificationMethod === 'none') {
      return recordPolicyRejection('CAMPAIGN_REWARD_INELIGIBLE', 403);
    }
    const campDate = String(campaignData.globalCompletedDhakaDate || '');
    const campCount = campDate === dhakaToday ? Number(campaignData.globalCompletedToday || 0) : 0;
    const globalDailyLimit = Math.max(1, Number(campaignData.globalDailyLimit || 1));
    if (campCount >= globalDailyLimit) {
      return recordPolicyRejection('CAMPAIGN_GLOBAL_DAILY_LIMIT_REACHED', 429);
    }
  }

  // 5b. Hold valid early (<30s) S2S postbacks cleanly without crediting before timer completes
  if (shouldHoldEarlyCallback) {
    await Promise.all([
      callbackRef.set(
        {
          callbackId,
          eventId: effectiveEventId,
          networkId: analyticsNetId,
          campaignId: ctx.campaignId || '',
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          adId: ctx.adId,
          providerTxId: ctx.providerTxId,
          status: 'awaiting_duration',
          signatureValid: true,
          timestampValid: true,
          replayDetected: false,
          rewardPoints: 0,
          rejectionReason: '',
          callbackTimestampSec: parsedTs ?? Math.floor(Date.now() / 1000),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_awaiting_duration',
        severity: 'info',
        status: 'awaiting_duration',
        details: `Verified S2S callback held until 30s timer completes (session=${ctx.sessionId}, releaseAfter=${heldSessionReleaseSec}s)`,
      }),
    ]);

    return {
      httpStatus: 202,
      body: {
        ok: true,
        status: 'awaiting_duration',
        callbackId,
        eventId: effectiveEventId,
        sessionId: ctx.sessionId,
        releaseAfterSec: heldSessionReleaseSec,
      },
    };
  }

  // 6. Execute Atomic Reward Transaction & Write Verified Callback + Analytics
  try {
    const outcome = await ctx.executeRewardTransaction({
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      adId: ctx.adId,
      providerTxId: ctx.providerTxId,
    });

    await Promise.all([
      callbackRef.set(
        {
          callbackId,
          eventId: effectiveEventId,
          networkId: analyticsNetId,
          campaignId: ctx.campaignId || '',
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          adId: ctx.adId,
          providerTxId: ctx.providerTxId,
          status: 'processed',
          signatureValid: true,
          timestampValid: true,
          replayDetected: false,
          rewardPoints: outcome.rewardPoints,
          rejectionReason: '',
          callbackTimestampSec: parsedTs ?? Math.floor(Date.now() / 1000),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
      recordAdAnalyticsDelta({
        networkId: analyticsNetId,
        networkName,
        dhakaDate: dhakaToday,
        clicksSupported,
        deltaImpressions: 1,
        deltaVerified: 1,
        deltaRewards: outcome.rewardPoints,
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: 'callback_processed',
        severity: 'info',
        status: 'processed',
        details: `Verified S2S completion for user=${ctx.userId}, ad=${ctx.adId}, eventId=${effectiveEventId}, +${outcome.rewardPoints} Pts`,
      }),
      ctx.campaignId && campaignData
        ? db
            .collection('adCampaigns')
            .doc(sanitizeId(ctx.campaignId))
            .update({
              globalCompletedToday:
                campaignData.globalCompletedDhakaDate === dhakaToday
                  ? FieldValue.increment(1)
                  : 1,
              globalCompletedDhakaDate: dhakaToday,
              updatedAt: FieldValue.serverTimestamp(),
            })
            .catch(() => {})
        : Promise.resolve(),
      resolvedNetworkId
        ? db
            .collection('adNetworks')
            .doc(resolvedNetworkId)
            .update({
              healthStatus: 'connected',
              healthMessage: `Live S2S callback verified (${dhakaToday}).`,
              updatedAt: FieldValue.serverTimestamp(),
            })
            .catch(() => {})
        : Promise.resolve(),
    ]);

    if (ctx.onRewardCompleted) {
      await ctx.onRewardCompleted(ctx.userId).catch(() => {});
    }

    return { httpStatus: 200, body: { ok: true, callbackId, eventId: effectiveEventId, ...outcome } };
  } catch (err) {
    const code = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
    const rejId = sanitizeId(`cb_rej_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    const isDuplicate = code === 'DUPLICATE_PROVIDER_TX';

    await Promise.all([
      db.collection('adCallbacks').doc(rejId).set({
        callbackId: rejId,
        eventId: effectiveEventId,
        networkId: analyticsNetId,
        campaignId: ctx.campaignId || '',
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        status: isDuplicate ? 'duplicate' : 'rejected',
        signatureValid: true,
        timestampValid: true,
        replayDetected: isDuplicate,
        rewardPoints: 0,
        rejectionReason: code.slice(0, 280),
        callbackTimestampSec: parsedTs ?? 0,
        createdAt: FieldValue.serverTimestamp(),
      }),
      recordAdAnalyticsDelta({
        networkId: analyticsNetId,
        networkName,
        dhakaDate: dhakaToday,
        clicksSupported,
        deltaRejected: 1,
      }),
      writeAdNetworkLog({
        networkId: analyticsNetId,
        eventType: isDuplicate ? 'callback_duplicate_tx' : 'callback_rejected',
        severity: isDuplicate ? 'error' : 'warning',
        status: isDuplicate ? 'duplicate' : 'rejected',
        details: `Callback rejected (${code}): sessionId=${ctx.sessionId}, providerTxId=${ctx.providerTxId}`,
      }),
      logFraudAttempt(
        ctx.userId,
        `Postback rejected: ${code}`,
        `sessionId=${ctx.sessionId}, adId=${ctx.adId}, providerTxId=${ctx.providerTxId}`,
        code === 'DUPLICATE_PROVIDER_TX' || code === 'RATE_LIMIT_EXCEEDED' ? 'high' : 'medium',
      ),
      logFailedTransaction({
        userId: ctx.userId,
        operation: 'verifyAdNetworkCallback',
        errorCode: code,
        transactionId: ctx.providerTxId,
        details: `sessionId=${ctx.sessionId}, adId=${ctx.adId}`,
      }),
    ]);

    if (
      code === 'USER_NOT_ACTIVE' ||
      code === 'GLOBAL_DAILY_LIMIT_REACHED' ||
      code === 'PER_AD_DAILY_LIMIT_REACHED' ||
      code === 'DAILY_BONUS_ALREADY_CLAIMED' ||
      code === 'RATE_LIMIT_EXCEEDED' ||
      code === 'INCENTIVIZED_TRAFFIC_DISALLOWED'
    ) {
      await db
        .collection('adSessions')
        .doc(ctx.sessionId)
        .update({
          status: 'rejected',
          rejectionReason: code,
        })
        .catch(() => {});
    }

    return { httpStatus: 409, body: { ok: false, error: code } };
  }
}
