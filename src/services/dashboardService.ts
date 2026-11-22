import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  activeFirebaseConfig as firebaseConfig,
  auth,
  db,
  getAppCheckTokenHeader,
  handleFirestoreError,
  OperationType,
  reportSystemError,
} from '../lib/firebase';
import {
  AdCompletionRecord,
  AdminLogRecord,
  AdminRole,
  AdSessionRecord,
  AdType,
  Advertisement,
  DailyAdLimitRecord,
  DailyBonusAdConfig,
  DailyBonusState,
  EconomyConfig,
  FraudLogRecord,
  MfsAccountType,
  NotificationItem,
  PaymentMethodConfig,
  PaymentMethodId,
  ReferralLeaderboardEntry,
  ReferralLogRecord,
  ReferralRewardRecord,
  ReferralSettingsConfig,
  ReferredUser,
  RewardVerificationMethod,
  TransactionDirection,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
  UserProfile,
  WalletDocRecord,
  WalletLedgerEntry,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
  WithdrawalStatus,
} from '../types';
import {
  DEFAULT_DAILY_AD_LIMIT,
  formatDhakaDateTime,
  getDefaultReferralSettings,
  getDefaultWithdrawalSettings,
  getDhakaDateKey,
  maskAccountNumber,
  maskUsername,
} from './appService';
import { mapReferralDoc } from './authService';
import { checkAdPolicyCompliance, isAdWithinSchedule } from './adNetworkPolicy';

function formatFirestoreTimestamp(ts: unknown): { label: string; millis: number } {
  if (ts instanceof Timestamp) {
    const date = ts.toDate();
    return {
      millis: date.getTime(),
      label: formatDhakaDateTime(date.getTime()),
    };
  }
  return { millis: 0, label: 'Recent' };
}

function mapAdvertisementDoc(id: string, data: Record<string, unknown>): Advertisement {
  const created = formatFirestoreTimestamp(data.createdAt);
  const updated = formatFirestoreTimestamp(data.updatedAt);
  const rawType = String(data.adType || 'rewarded');
  const adType: AdType =
    rawType === 'direct_link' || rawType === 'other' ? rawType : 'rewarded';
  const rawVerify = String(data.rewardVerificationMethod || 's2s_postback');
  const rewardVerificationMethod: RewardVerificationMethod =
    rawVerify === 'sdk_callback' || rawVerify === 'none' ? rawVerify : 's2s_postback';

  return {
    id,
    adId: String(data.adId || id),
    adName: String(data.adName || 'Sponsored Ad'),
    adNetwork: String(data.adNetwork || 'Monetag'),
    adType,
    placementOrUrl: String(data.placementOrUrl || ''),
    rewardPoints: Number(data.rewardPoints || 0),
    dailyLimit: Math.max(1, Number(data.dailyLimit || 1)),
    estimatedDuration: normalizeAdDurationSeconds(data.estimatedDuration),
    startDate: String(data.startDate || ''),
    endDate: String(data.endDate || ''),
    status: data.status === 'active' ? 'active' : 'inactive',
    allowedCountries: String(data.allowedCountries || 'ALL'),
    rewardVerificationMethod,
    incentivizedTrafficAllowed: Boolean(data.incentivizedTrafficAllowed),
    description: String(data.description || ''),
    createdAtMillis: created.millis,
    updatedAtMillis: updated.millis,
  };
}

export async function resolveUserAdminRole(
  uid: string,
): Promise<{ hasAdminMarker: boolean; role: AdminRole | null }> {
  if (!uid) return { hasAdminMarker: false, role: null };

  let claimRole: AdminRole | null = null;
  try {
    const current = auth.currentUser;
    if (current && current.uid === uid && current.emailVerified) {
      const tokenRes = await current.getIdTokenResult();
      const rawClaim = tokenRes.claims?.adminRole;
      if (rawClaim === 'super_admin' || rawClaim === 'admin' || rawClaim === 'support_admin') {
        claimRole = rawClaim;
      }
    }
  } catch {
    // Non-blocking claim lookup; marker fallback follows
  }

  try {
    await getDocsFromServer(query(collection(db, 'admins'), limit(1)));
    return { hasAdminMarker: true, role: claimRole ?? 'super_admin' };
  } catch {
    // Non-super-admin users fail admins list query cleanly
  }

  try {
    const snap = await getDocFromServer(doc(db, 'admins', uid));
    if (snap.exists()) {
      const data = snap.data();
      const docRole =
        data?.role === 'super_admin' || data?.role === 'admin' || data?.role === 'support_admin'
          ? (data.role as AdminRole)
          : 'admin';
      return { hasAdminMarker: true, role: claimRole ?? docRole };
    }
  } catch {
    // Non-admin users fail admins/{uid} lookup cleanly
  }

  return { hasAdminMarker: false, role: claimRole };
}

export async function checkUserIsAdminMarker(uid: string): Promise<boolean> {
  const res = await resolveUserAdminRole(uid);
  return res.hasAdminMarker || res.role === 'super_admin' || res.role === 'admin';
}

/**
 * Subscribes to `appSettings/wallet` (Phase 5 primary) and falls back cleanly
 * to `appConfig/economy` (Phase 3/4 compatibility) so conversion rate, limits,
 * and feature toggles stay synchronized across the entire app.
 */
export function subscribeToWalletAndEconomySettings(
  onData: (config: EconomyConfig) => void,
  onError: (err: Error) => void,
): () => void {
  let latestAppSettings: Record<string, unknown> | null = null;
  let latestEconomyConfig: Record<string, unknown> | null = null;

  const emitMerged = () => {
    const src = latestAppSettings ?? latestEconomyConfig;
    if (!src) {
      onData({
        pointsPerBdt: null,
        dailyBonusPoints: null,
        minimumWithdrawPoints: null,
        maximumWithdrawAmountBdt: null,
        dailyAdLimit: DEFAULT_DAILY_AD_LIMIT,
        walletEnabled: true,
        earningEnabled: true,
      });
      return;
    }

    const pickPositiveNum = (key: string): number | null => {
      const val = latestAppSettings?.[key] ?? latestEconomyConfig?.[key];
      return typeof val === 'number' && val > 0 ? val : null;
    };

    const rawDailyAdLimit =
      latestAppSettings?.dailyAdLimit ?? latestEconomyConfig?.dailyAdLimit;

    onData({
      pointsPerBdt: pickPositiveNum('pointsPerBdt'),
      dailyBonusPoints: pickPositiveNum('dailyBonusPoints'),
      minimumWithdrawPoints: pickPositiveNum('minimumWithdrawPoints'),
      maximumWithdrawAmountBdt: pickPositiveNum('maximumWithdrawAmountBdt'),
      dailyAdLimit:
        typeof rawDailyAdLimit === 'number' && rawDailyAdLimit >= 1
          ? Math.floor(rawDailyAdLimit)
          : DEFAULT_DAILY_AD_LIMIT,
      walletEnabled:
        typeof latestAppSettings?.walletEnabled === 'boolean'
          ? latestAppSettings.walletEnabled
          : true,
      earningEnabled:
        typeof latestAppSettings?.earningEnabled === 'boolean'
          ? latestAppSettings.earningEnabled
          : true,
    });
  };

  const unsubSettings = onSnapshot(
    doc(db, 'appSettings', 'wallet'),
    (snap) => {
      latestAppSettings = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'appSettings/wallet');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  const unsubEconomy = onSnapshot(
    doc(db, 'appConfig', 'economy'),
    (snap) => {
      latestEconomyConfig = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      emitMerged();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, 'appConfig/economy');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );

  return () => {
    unsubSettings();
    unsubEconomy();
  };
}

export function subscribeToEconomyConfig(
  onData: (config: EconomyConfig) => void,
  onError: (err: Error) => void,
): () => void {
  return subscribeToWalletAndEconomySettings(onData, onError);
}

export function subscribeToUserWallet(
  uid: string,
  onData: (wallet: WalletDocRecord | null) => void,
  onError: (err: Error) => void,
): () => void {
  const path = `wallets/${uid}`;
  return onSnapshot(
    doc(db, 'wallets', uid),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      const updated = formatFirestoreTimestamp(data.updatedAt);
      onData({
        userId: String(data.userId || uid),
        totalPoints: Number(data.totalPoints || 0),
        availablePoints: Number(data.availablePoints ?? data.totalPoints ?? 0),
        pendingPoints: Number(data.pendingPoints || 0),
        reservedPoints: Number(data.reservedPoints || 0),
        totalEarnedPoints: Number(data.totalEarnedPoints || 0),
        totalWithdrawnPoints: Number(data.totalWithdrawnPoints || 0),
        totalWithdrawnBdt: Number(data.totalWithdrawnBdt || 0),
        updatedAtMillis: updated.millis,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToUserWalletLedger(
  uid: string,
  onData: (entries: WalletLedgerEntry[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'walletLedger';
  const q = query(collection(db, 'walletLedger'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: WalletLedgerEntry[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        const rawEntryType = String(data.entryType || 'credit');
        const entryType =
          rawEntryType === 'debit' || rawEntryType === 'reserve' || rawEntryType === 'release'
            ? rawEntryType
            : 'credit';
        const rawStatus = String(data.status || 'completed');
        const status: TransactionStatus =
          rawStatus === 'pending' || rawStatus === 'rejected' || rawStatus === 'reversed'
            ? rawStatus
            : 'completed';
        return {
          id: d.id,
          entryId: String(data.entryId || d.id),
          transactionId: String(data.transactionId || ''),
          userId: String(data.userId || uid),
          entryType,
          transactionType: (data.transactionType as TransactionType) || 'ad_reward',
          pointsDelta: Number(data.pointsDelta || 0),
          bdtAmount: Number(data.bdtAmount || 0),
          conversionRateUsed:
            typeof data.conversionRateUsed === 'number' && data.conversionRateUsed > 0
              ? data.conversionRateUsed
              : null,
          previousPoints: Number(data.previousPoints || 0),
          newPoints: Number(data.newPoints || 0),
          previousReservedPoints: Number(data.previousReservedPoints || 0),
          newReservedPoints: Number(data.newReservedPoints || 0),
          status,
          description: String(data.description || ''),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

/**
 * Regular users only see active advertisements matching Rewarded Advertising Policy & schedule.
 */
export function subscribeToActiveAdvertisements(
  onData: (ads: Advertisement[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'advertisements';
  const q = query(collection(db, 'advertisements'), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      const todayDhaka = getDhakaDateKey();
      const items = snap.docs
        .map((d) => mapAdvertisementDoc(d.id, d.data() as Record<string, unknown>))
        .filter((ad) => {
          const policy = checkAdPolicyCompliance(ad);
          return policy.compliant && isAdWithinSchedule(ad, todayDhaka);
        });
      items.sort((a, b) => b.rewardPoints - a.rewardPoints);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllAdvertisements(
  onData: (ads: Advertisement[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'advertisements';
  return onSnapshot(
    collection(db, 'advertisements'),
    (snap) => {
      const items = snap.docs.map((d) =>
        mapAdvertisementDoc(d.id, d.data() as Record<string, unknown>),
      );
      items.sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToDailyAdLimit(
  uid: string,
  onData: (record: DailyAdLimitRecord) => void,
  onError: (err: Error) => void,
): () => void {
  const todayDhaka = getDhakaDateKey();
  const docId = `${uid}_${todayDhaka}`;
  const path = `dailyAdLimits/${docId}`;
  return onSnapshot(
    doc(db, 'dailyAdLimits', docId),
    (snap) => {
      if (!snap.exists()) {
        onData({
          userId: uid,
          dhakaDate: todayDhaka,
          completedCount: 0,
          earnedPoints: 0,
          completedAdIds: [],
        });
        return;
      }
      const data = snap.data();
      onData({
        userId: String(data.userId || uid),
        dhakaDate: String(data.dhakaDate || todayDhaka),
        completedCount: Number(data.completedCount || 0),
        earnedPoints: Number(data.earnedPoints || 0),
        completedAdIds: Array.isArray(data.completedAdIds)
          ? data.completedAdIds.map((v) => String(v))
          : [],
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAdSessions(
  uid: string,
  onData: (sessions: AdSessionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'adSessions';
  const q = query(collection(db, 'adSessions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: AdSessionRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        const rawStatus = String(data.status || 'pending');
        const status =
          rawStatus === 'completed' || rawStatus === 'rejected' ? rawStatus : 'pending';
        return {
          id: d.id,
          sessionId: String(data.sessionId || d.id),
          userId: String(data.userId || uid),
          adId: String(data.adId || ''),
          adName: String(data.adName || 'Advertisement'),
          adNetwork: String(data.adNetwork || 'Partner Network'),
          expectedRewardPoints: Number(data.expectedRewardPoints || 0),
          dhakaDate: String(data.dhakaDate || ''),
          status,
          transactionId: String(data.transactionId || ''),
          rejectionReason: String(data.rejectionReason || ''),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAdCompletions(
  uid: string,
  onData: (completions: AdCompletionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'adCompletions';
  const q = query(collection(db, 'adCompletions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: AdCompletionRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        return {
          id: d.id,
          completionId: String(data.completionId || d.id),
          providerTxId: String(data.providerTxId || ''),
          sessionId: String(data.sessionId || ''),
          userId: String(data.userId || uid),
          adId: String(data.adId || ''),
          adName: String(data.adName || 'Advertisement'),
          adNetwork: String(data.adNetwork || 'Partner Network'),
          rewardPoints: Number(data.rewardPoints || 0),
          transactionId: String(data.transactionId || ''),
          dhakaDate: String(data.dhakaDate || ''),
          status: data.status === 'rejected' ? 'rejected' : 'completed',
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToFraudLogs(
  onData: (logs: FraudLogRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'fraudLogs';
  return onSnapshot(
    collection(db, 'fraudLogs'),
    (snap) => {
      const items: FraudLogRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        const sev = String(data.severity || 'medium');
        return {
          id: d.id,
          userId: String(data.userId || 'unknown'),
          reason: String(data.reason || 'Security alert'),
          details: String(data.details || ''),
          severity: sev === 'low' || sev === 'high' ? sev : 'medium',
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export const MIN_AD_VIEW_SECONDS = 30;
export const MAX_AD_VIEW_SECONDS = 180;

/**
 * Normalizes ad viewing duration in seconds.
 * Converts invalid/oversized values (e.g. 3000s/ms) or <30s values cleanly to 30s.
 */
export function normalizeAdDurationSeconds(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < MIN_AD_VIEW_SECONDS || n > MAX_AD_VIEW_SECONDS) {
    return MIN_AD_VIEW_SECONDS;
  }
  return n;
}

export const AD_SESSION_ERROR_MESSAGES: Record<string, string> = {
  EARNING_DISABLED: 'Ad earning is temporarily paused by the Administrator.',
  USER_NOT_ACTIVE: 'Your account is not active and cannot watch ads.',
  AD_NOT_FOUND: 'This advertisement is no longer available.',
  AD_INACTIVE: 'This advertisement is currently inactive.',
  AD_NOT_ELIGIBLE: 'This advertisement does not meet verification requirements.',
  INCENTIVIZED_TRAFFIC_DISALLOWED:
    'This Direct Link does not have Incentivized Traffic approval.',
  GLOBAL_DAILY_LIMIT_REACHED:
    "Today's global ad limit has been reached. Try again tomorrow (Asia/Dhaka).",
  PER_AD_DAILY_LIMIT_REACHED:
    'Daily limit for this advertisement has already been completed today.',
  RATE_LIMIT_EXCEEDED: 'Please wait a few seconds before starting or completing another ad.',
  ABNORMALLY_FAST_AD_COMPLETION:
    'Full 30-second ad viewing session was not completed yet. Zero points awarded.',
  S2S_POSTBACK_REQUIRED_FOR_DIRECT_LINK:
    'Direct Link ads cannot be credited without verified Ad Network S2S postback.',
  S2S_POSTBACK_REQUIRED:
    'This ad requires verified Ad Network S2S postback confirmation.',
  MONETAG_SDK_REQUIRES_TELEGRAM_MINI_APP:
    'Monetag Rewarded Interstitial SDK is only supported inside Telegram Mini Apps and cannot be used on regular websites.',
  MONETAG_EVENT_NOT_VALUED:
    'Monetag reported this impression as non-valued (not_valued). Complete viewing the ad to earn points.',
  APPLIXIR_STATUS_NOT_COMPLETED:
    'AppLixir reported this video ad was closed or not completed. Zero points credited.',
  APPLIXIR_NOT_CONFIGURED:
    'AppLixir is not configured yet. Set a valid Site ID in Admin Panel and APPLIXIR_API_KEY + APPLIXIR_SECRET_KEY in Backend Environment Variables before watching AppLixir ads. 0 points credited.',
  NETWORK_DISABLED: 'This ad network is currently disabled by Administrator.',
  NETWORK_REWARD_NOT_ELIGIBLE:
    'Rewards are not enabled for this ad network in Admin Panel.',
  CAMPAIGN_DISABLED: 'This ad campaign is currently paused.',
  CAMPAIGN_REWARD_INELIGIBLE: 'This ad campaign is not marked reward-eligible.',
  CAMPAIGN_GLOBAL_DAILY_LIMIT_REACHED:
    'This campaign has reached its global daily completion limit.',
  INVALID_CALLBACK_SIGNATURE:
    'Ad network S2S callback signature/secret verification failed. Check the Callback Secret in Admin Panel.',
  EXPIRED_CALLBACK: 'Ad network S2S callback timestamp expired before verification.',
  DUPLICATE_PROVIDER_TX: 'Reward for this ad session has already been credited.',
  DUPLICATE_CALLBACK_EVENT: 'Duplicate ad callback detected; reward was already processed.',
  SDK_ZONE_MISMATCH: 'Ad zone mismatch detected. Reward rejected.',
  SESSION_NOT_FOUND:
    'Verification session was not found on the server. Please close and start a new ad session.',
  SESSION_MISMATCH: 'Session ownership mismatch detected. Please restart the ad session.',
  SESSION_REJECTED: 'This ad session was cancelled or rejected.',
  SESSION_ALREADY_FINALIZED: 'This ad session has already been finalized.',
  DAILY_BONUS_ALREADY_CLAIMED: 'You have already claimed today’s Daily Check-in Bonus.',
  DAILY_BONUS_DISABLED:
    'Daily Check-in Bonus advertisement is currently paused by the Administrator.',
  DAILY_BONUS_NOT_CONFIGURED:
    'Daily Check-in Bonus Monetag Direct Link is not configured yet in Admin Panel.',
  USE_DAILY_BONUS_ENDPOINT: 'Use the Daily Check-in Bonus button to start your daily bonus session.',
};

export function mapAdSessionErrorMessage(code: string, fallback?: string): string {
  const clean = String(code || '').trim();
  if (clean && AD_SESSION_ERROR_MESSAGES[clean]) {
    return AD_SESSION_ERROR_MESSAGES[clean];
  }
  return fallback || clean || 'Unable to verify reward completion.';
}

export async function initiateAdSession(
  user: UserProfile,
  ad: Advertisement,
  todayCompletions: AdCompletionRecord[],
  dailyAdLimit: DailyAdLimitRecord | null,
  globalDailyLimit: number,
  earningEnabled = true,
): Promise<AdSessionRecord> {
  if (!earningEnabled) {
    throw new Error(AD_SESSION_ERROR_MESSAGES.EARNING_DISABLED);
  }

  if (user.accountStatus !== 'active') {
    throw new Error(AD_SESSION_ERROR_MESSAGES.USER_NOT_ACTIVE);
  }

  if (ad.status !== 'active') {
    throw new Error(AD_SESSION_ERROR_MESSAGES.AD_INACTIVE);
  }

  const policy = checkAdPolicyCompliance(ad);
  if (!policy.compliant) {
    throw new Error(policy.reason || 'This ad violates Rewarded Advertising Policy.');
  }

  const todayDhaka = getDhakaDateKey();
  if (!isAdWithinSchedule(ad, todayDhaka)) {
    throw new Error('This advertisement is outside its active campaign schedule.');
  }

  const completedTodayGlobal =
    dailyAdLimit && dailyAdLimit.dhakaDate === todayDhaka
      ? dailyAdLimit.completedCount
      : todayCompletions.filter((c) => c.dhakaDate === todayDhaka && c.status === 'completed')
          .length;

  if (completedTodayGlobal >= globalDailyLimit) {
    throw new Error(
      `Today's global ad limit (${globalDailyLimit} ads) has been reached. Try again tomorrow (Asia/Dhaka).`,
    );
  }

  const completedTodayForThisAd = todayCompletions.filter(
    (c) => c.adId === ad.adId && c.dhakaDate === todayDhaka && c.status === 'completed',
  ).length;

  if (completedTodayForThisAd >= ad.dailyLimit) {
    throw new Error(
      `Daily limit for ${ad.adName} (${ad.dailyLimit}/day) has already been completed today.`,
    );
  }

  // Prefer server-authoritative createAdSession Cloud Function first
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const [idToken, appCheckHeaders] = await Promise.all([
        currentUser.getIdToken(),
        getAppCheckTokenHeader(),
      ]);
      const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/createAdSession`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...appCheckHeaders,
        },
        body: JSON.stringify({ adId: ad.adId }),
      });

      if (response.status !== 404) {
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          sessionId?: string;
          dhakaDate?: string;
          error?: string;
        };
        if (response.ok && body.ok && body.sessionId) {
          return {
            id: body.sessionId,
            sessionId: body.sessionId,
            userId: user.uid,
            adId: ad.adId,
            adName: ad.adName,
            adNetwork: ad.adNetwork,
            expectedRewardPoints: ad.rewardPoints,
            dhakaDate: body.dhakaDate || todayDhaka,
            status: 'pending',
            transactionId: '',
            rejectionReason: '',
            createdAtLabel: 'Just now',
            createdAtMillis: Date.now(),
          };
        }
        const errCode = body.error || '';
        throw new Error(
          AD_SESSION_ERROR_MESSAGES[errCode] ||
            errCode ||
            'Could not start verified ad session.',
        );
      }
    } catch (err) {
      // Only fall back to Firestore rules-validated session creation if Cloud Function is unreachable (404 / network error)
      // NEVER fall back for AppLixir ads because AppLixir requires backend credentials & S2S postback verification.
      const isAppLixir =
        ad.adNetwork.toLowerCase().includes('applixir') ||
        /^applixir:/i.test(ad.placementOrUrl.trim());
      if (isAppLixir) {
        if (
          err instanceof Error &&
          (err.message.includes('Failed to fetch') ||
            err.message.includes('NetworkError') ||
            err.message.includes('fetch'))
        ) {
          throw new Error(
            'AppLixir Rewarded Ads require the deployed Firebase Cloud Functions backend (`createAdSession` & `verifyAdNetworkCallback`). 0 points credited.',
          );
        }
        throw err;
      }
      if (
        err instanceof Error &&
        !err.message.includes('Failed to fetch') &&
        !err.message.includes('NetworkError') &&
        !err.message.includes('fetch')
      ) {
        throw err;
      }
    }
  }

  if (
    ad.adNetwork.toLowerCase().includes('applixir') ||
    /^applixir:/i.test(ad.placementOrUrl.trim())
  ) {
    throw new Error(AD_SESSION_ERROR_MESSAGES.APPLIXIR_NOT_CONFIGURED);
  }

  const randomSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  const sessionId = `sess_${Date.now()}_${randomSuffix}`;
  const path = `adSessions/${sessionId}`;

  try {
    await setDoc(doc(db, 'adSessions', sessionId), {
      sessionId,
      userId: user.uid,
      adId: ad.adId,
      adName: ad.adName.slice(0, 100),
      adNetwork: ad.adNetwork.slice(0, 60),
      expectedRewardPoints: ad.rewardPoints,
      dhakaDate: todayDhaka,
      status: 'pending',
      transactionId: '',
      rejectionReason: '',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }

  return {
    id: sessionId,
    sessionId,
    userId: user.uid,
    adId: ad.adId,
    adName: ad.adName,
    adNetwork: ad.adNetwork,
    expectedRewardPoints: ad.rewardPoints,
    dhakaDate: todayDhaka,
    status: 'pending',
    transactionId: '',
    rejectionReason: '',
    createdAtLabel: 'Just now',
    createdAtMillis: Date.now(),
  };
}

export async function confirmSdkAdSessionReward(params: {
  sessionId: string;
  adId: string;
  sdkZoneId: string;
  watchedSeconds: number;
  sdkVerified: boolean;
  platformContext?: 'telegram_mini_app' | 'web_gpt';
}): Promise<{ ok: boolean; rewardPoints?: number; txId?: string; error?: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { ok: false, error: 'Authentication required.' };
  }

  const [idToken, appCheckHeaders] = await Promise.all([
    currentUser.getIdToken(),
    getAppCheckTokenHeader(),
  ]);
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/confirmSdkAdCompletion`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (response.status === 404) {
      return {
        ok: false,
        error:
          'Backend verification Cloud Function (confirmSdkAdCompletion) is not deployed yet. Deploy functions to credit verified SDK rewards.',
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      rewardPoints?: number;
      txId?: string;
      error?: string;
    };

    if (!response.ok || !body.ok) {
      const code = body.error || '';
      return {
        ok: false,
        error: mapAdSessionErrorMessage(
          code,
          'Backend verification rejected this ad session.',
        ),
      };
    }

    return {
      ok: true,
      rewardPoints: Number(body.rewardPoints || 0),
      txId: body.txId || params.sessionId,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort
        ? 'Backend verification request timed out. Please tap Retry Verification.'
        : 'Unable to reach backend verification service. Zero points credited until server verification completes.',
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export interface AdSessionVerificationResult {
  ok: boolean;
  status:
    | 'completed'
    | 'pending'
    | 'awaiting_timer'
    | 'rejected'
    | 'backend_unavailable'
    | 'error';
  rewardPoints?: number;
  txId?: string;
  remainingSec?: number;
  lastCallbackError?: string;
  error?: string;
  retryable?: boolean;
}

export async function verifyAdSessionRewardStatus(
  sessionId: string,
): Promise<AdSessionVerificationResult> {
  if (!sessionId) {
    return {
      ok: false,
      status: 'error',
      error: 'Missing ad session ID.',
      retryable: false,
    };
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    return {
      ok: false,
      status: 'error',
      error: 'Authentication required to verify reward.',
      retryable: false,
    };
  }

  const [idToken, appCheckHeaders] = await Promise.all([
    currentUser.getIdToken(),
    getAppCheckTokenHeader(),
  ]);
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/verifyAdSessionReward`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    });

    if (response.status === 404) {
      const maybeBody = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (maybeBody?.error === 'SESSION_NOT_FOUND') {
        return {
          ok: false,
          status: 'rejected',
          error: AD_SESSION_ERROR_MESSAGES.SESSION_NOT_FOUND,
          retryable: false,
        };
      }
      return {
        ok: false,
        status: 'backend_unavailable',
        error:
          'Reward verification service (verifyAdSessionReward) is not deployed yet on this Firebase project. Deploy Cloud Functions so Monetag S2S callbacks can verify & credit rewards.',
        retryable: false,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: string;
      rewardPoints?: number;
      txId?: string;
      remainingSec?: number;
      lastCallbackError?: string;
      error?: string;
    };

    if (response.ok && body.ok) {
      if (body.status === 'completed') {
        return {
          ok: true,
          status: 'completed',
          rewardPoints: Number(body.rewardPoints || 0),
          txId: body.txId || sessionId,
        };
      }
      if (body.status === 'awaiting_timer') {
        return {
          ok: true,
          status: 'awaiting_timer',
          remainingSec: Number(body.remainingSec || 1),
        };
      }
      return {
        ok: true,
        status: 'pending',
        ...(body.lastCallbackError
          ? {
              lastCallbackError: mapAdSessionErrorMessage(
                body.lastCallbackError,
                body.lastCallbackError,
              ),
            }
          : {}),
      };
    }

    const errCode = body.error || '';
    const isRejected =
      body.status === 'rejected' || response.status === 409 || response.status === 403;
    return {
      ok: false,
      status: isRejected ? 'rejected' : 'error',
      error: mapAdSessionErrorMessage(
        errCode,
        `Verification failed (HTTP ${response.status}).`,
      ),
      ...(body.lastCallbackError ? { lastCallbackError: body.lastCallbackError } : {}),
      retryable: errCode === 'RATE_LIMIT_EXCEEDED' || response.status >= 500,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: 'error',
      error: isAbort
        ? 'Verification server request timed out.'
        : 'Unable to reach verification server. Please check your connection and retry.',
      retryable: true,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function cancelPendingAdSession(
  sessionId: string,
  reason = 'CLOSED_BEFORE_30_SECONDS',
): Promise<void> {
  if (!sessionId) return;
  const cleanReason = reason.trim().slice(0, 180) || 'CLOSED_BEFORE_30_SECONDS';
  const currentUser = auth.currentUser;

  if (currentUser) {
    try {
      const [idToken, appCheckHeaders] = await Promise.all([
        currentUser.getIdToken(),
        getAppCheckTokenHeader(),
      ]);
      const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/cancelAdSession`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
          ...appCheckHeaders,
        },
        body: JSON.stringify({ sessionId, reason: cleanReason }),
      });
      if (response.ok) return;
    } catch {
      // Fallback to Firestore owner rejection rule below
    }
  }

  try {
    await updateDoc(doc(db, 'adSessions', sessionId), {
      status: 'rejected',
      rejectionReason: cleanReason,
    });
  } catch {
    // Session may already be completed or finalized
  }
}

export interface SaveAdvertisementInput {
  adId: string;
  adName: string;
  adNetwork: string;
  adType: AdType;
  placementOrUrl: string;
  rewardPoints: number;
  dailyLimit: number;
  estimatedDuration: number;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  allowedCountries: string;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
  description: string;
  isNew: boolean;
}

export async function saveAdvertisement(input: SaveAdvertisementInput): Promise<void> {
  if (input.status === 'active') {
    const policy = checkAdPolicyCompliance(input);
    if (!policy.compliant) {
      throw new Error(policy.reason);
    }
  }

  const cleanAdId = input.adId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleanAdId.length < 2) {
    throw new Error('Ad ID must be at least 2 valid characters.');
  }

  const path = `advertisements/${cleanAdId}`;
  try {
    const ref = doc(db, 'advertisements', cleanAdId);
    if (input.isNew) {
      await setDoc(ref, {
        adId: cleanAdId,
        adName: input.adName.trim(),
        adNetwork: input.adNetwork.trim(),
        adType: input.adType,
        placementOrUrl: input.placementOrUrl.trim(),
        rewardPoints: Number(input.rewardPoints),
        dailyLimit: Math.max(1, Number(input.dailyLimit)),
        estimatedDuration: normalizeAdDurationSeconds(input.estimatedDuration),
        startDate: input.startDate.trim(),
        endDate: input.endDate.trim(),
        status: input.status,
        allowedCountries: input.allowedCountries.trim() || 'ALL',
        rewardVerificationMethod: input.rewardVerificationMethod,
        incentivizedTrafficAllowed: Boolean(input.incentivizedTrafficAllowed),
        description: input.description.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        adName: input.adName.trim(),
        adNetwork: input.adNetwork.trim(),
        adType: input.adType,
        placementOrUrl: input.placementOrUrl.trim(),
        rewardPoints: Number(input.rewardPoints),
        dailyLimit: Math.max(1, Number(input.dailyLimit)),
        estimatedDuration: normalizeAdDurationSeconds(input.estimatedDuration),
        startDate: input.startDate.trim(),
        endDate: input.endDate.trim(),
        status: input.status,
        allowedCountries: input.allowedCountries.trim() || 'ALL',
        rewardVerificationMethod: input.rewardVerificationMethod,
        incentivizedTrafficAllowed: Boolean(input.incentivizedTrafficAllowed),
        description: input.description.trim(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, input.isNew ? OperationType.CREATE : OperationType.UPDATE, path);
  }
}

export async function syncLinkedAdvertisementFields(
  linkedAdId: string,
  fields: {
    placementOrUrl?: string;
    status?: 'active' | 'inactive';
  },
): Promise<void> {
  const cleanId = linkedAdId.trim();
  if (!cleanId) return;
  try {
    const ref = doc(db, 'advertisements', cleanId);
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) return;
    const updates: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (typeof fields.placementOrUrl === 'string' && fields.placementOrUrl.trim()) {
      updates.placementOrUrl = fields.placementOrUrl.trim();
    }
    if (fields.status === 'active' || fields.status === 'inactive') {
      updates.status = fields.status;
    }
    await updateDoc(ref, updates);
  } catch {
    // Non-blocking sync if linked advertisement doc does not exist or rules disallow invalid state
  }
}

export async function toggleAdvertisementStatus(ad: Advertisement): Promise<void> {
  const nextStatus = ad.status === 'active' ? 'inactive' : 'active';
  if (nextStatus === 'active') {
    const policy = checkAdPolicyCompliance(ad);
    if (!policy.compliant) {
      throw new Error(policy.reason);
    }
  }
  const path = `advertisements/${ad.adId}`;
  try {
    await updateDoc(doc(db, 'advertisements', ad.adId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAdvertisement(adId: string): Promise<void> {
  const path = `advertisements/${adId}`;
  try {
    await deleteDoc(doc(db, 'advertisements', adId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveEconomyConfig(config: {
  pointsPerBdt: number | null;
  dailyBonusPoints: number | null;
  minimumWithdrawPoints: number | null;
  maximumWithdrawAmountBdt?: number | null;
  dailyAdLimit: number;
  walletEnabled?: boolean;
  earningEnabled?: boolean;
}): Promise<void> {
  const cleanRate =
    config.pointsPerBdt && config.pointsPerBdt > 0 ? config.pointsPerBdt : null;
  const cleanBonus =
    config.dailyBonusPoints && config.dailyBonusPoints > 0 ? config.dailyBonusPoints : null;
  const cleanMinWithdraw =
    config.minimumWithdrawPoints && config.minimumWithdrawPoints > 0
      ? config.minimumWithdrawPoints
      : null;
  const cleanMaxWithdrawBdt =
    config.maximumWithdrawAmountBdt && config.maximumWithdrawAmountBdt > 0
      ? config.maximumWithdrawAmountBdt
      : null;
  const cleanDailyLimit = Math.max(1, Math.floor(config.dailyAdLimit || DEFAULT_DAILY_AD_LIMIT));

  try {
    await Promise.all([
      setDoc(
        doc(db, 'appSettings', 'wallet'),
        {
          pointsPerBdt: cleanRate,
          dailyBonusPoints: cleanBonus,
          minimumWithdrawPoints: cleanMinWithdraw,
          maximumWithdrawAmountBdt: cleanMaxWithdrawBdt,
          dailyAdLimit: cleanDailyLimit,
          walletEnabled: config.walletEnabled ?? true,
          earningEnabled: config.earningEnabled ?? true,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
      setDoc(
        doc(db, 'appConfig', 'economy'),
        {
          pointsPerBdt: cleanRate,
          dailyBonusPoints: cleanBonus,
          minimumWithdrawPoints: cleanMinWithdraw,
          dailyAdLimit: cleanDailyLimit,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'appSettings/wallet');
  }
}

function mapWithdrawalRequestDoc(
  id: string,
  data: Record<string, unknown>,
): WithdrawalRequestRecord {
  const created = formatFirestoreTimestamp(data.createdAt);
  const proc = formatFirestoreTimestamp(data.processingDate);
  const paid = formatFirestoreTimestamp(data.paidAt);

  const rawMethod = String(data.methodId || 'bkash').toLowerCase();
  const methodId: PaymentMethodId =
    rawMethod === 'nagad' || rawMethod === 'rocket' || rawMethod === 'bank'
      ? rawMethod
      : 'bkash';

  const rawAcctType = String(
    data.accountType || (methodId === 'bank' ? 'bank_account' : 'personal'),
  ).toLowerCase();
  const accountType: MfsAccountType =
    rawAcctType === 'agent' || rawAcctType === 'merchant' || rawAcctType === 'bank_account'
      ? rawAcctType
      : 'personal';

  const rawStatus = String(data.status || 'pending').toLowerCase();
  const status: WithdrawalStatus =
    rawStatus === 'processing' ||
    rawStatus === 'approved' ||
    rawStatus === 'paid' ||
    rawStatus === 'rejected' ||
    rawStatus === 'cancelled'
      ? rawStatus
      : rawStatus === 'completed'
        ? 'paid'
        : rawStatus === 'reversed'
          ? 'cancelled'
          : 'pending';

  const accountNumber = String(data.accountNumber || '');
  const maskedAccountNumber = String(
    data.maskedAccountNumber || maskAccountNumber(accountNumber, methodId),
  );

  return {
    id,
    requestId: String(data.requestId || id),
    transactionId: String(data.transactionId || `tx_${id}`),
    userId: String(data.userId || ''),
    methodId,
    accountNumber,
    maskedAccountNumber,
    accountType,
    optionalNote: String(data.optionalNote || ''),
    pointsReserved: Number(data.pointsReserved || 0),
    grossBdt: Number(data.grossBdt || 0),
    feeBdt: Number(data.feeBdt || 0),
    netBdt: Number(data.netBdt || 0),
    conversionRateUsed: Number(data.conversionRateUsed || 0),
    dhakaDate: String(data.dhakaDate || ''),
    dhakaMonth: String(data.dhakaMonth || ''),
    status,
    payoutTransactionId: String(data.payoutTransactionId || ''),
    rejectionReason: String(data.rejectionReason || ''),
    requestDateLabel: created.label,
    processingDateLabel: proc.millis > 0 ? proc.label : '',
    paidAtLabel: paid.millis > 0 ? paid.label : '',
    createdAtMillis: created.millis,
  };
}

export function subscribeToPaymentMethods(
  onData: (methods: PaymentMethodConfig[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'paymentMethods';
  return onSnapshot(
    collection(db, 'paymentMethods'),
    (snap) => {
      const items: PaymentMethodConfig[] = snap.docs
        .map((d): PaymentMethodConfig | null => {
          const data = d.data();
          const rawId = String(data.methodId || d.id).toLowerCase();
          if (
            rawId !== 'bkash' &&
            rawId !== 'nagad' &&
            rawId !== 'rocket' &&
            rawId !== 'bank'
          ) {
            return null;
          }
          const allowedRaw = Array.isArray(data.allowedAccountTypes)
            ? data.allowedAccountTypes.map((v) => String(v))
            : rawId === 'bank'
              ? ['bank_account']
              : ['personal', 'agent', 'merchant'];
          const allowedAccountTypes: MfsAccountType[] = allowedRaw.filter(
            (t): t is MfsAccountType =>
              t === 'personal' || t === 'agent' || t === 'merchant' || t === 'bank_account',
          );
          const item: PaymentMethodConfig = {
            id: rawId as PaymentMethodId,
            name: String(data.name || rawId),
            enabled: typeof data.enabled === 'boolean' ? data.enabled : true,
            minPoints:
              typeof data.minPoints === 'number' && data.minPoints >= 1
                ? data.minPoints
                : null,
            feePercent: typeof data.feePercent === 'number' ? data.feePercent : 2,
            processingWindow: String(
              data.processingWindow || 'Within 24 hours after admin verification',
            ),
            allowedAccountTypes:
              allowedAccountTypes.length > 0
                ? allowedAccountTypes
                : rawId === 'bank'
                  ? ['bank_account']
                  : ['personal', 'agent', 'merchant'],
            accountHint:
              rawId === 'bank'
                ? 'Account No, Account Holder & Bank/Branch Name'
                : `11-digit ${String(data.name || rawId)} number (e.g. 017XXXXXXXX)`,
          };
          if (data.bengaliName) {
            item.bengaliName = String(data.bengaliName);
          }
          return item;
        })
        .filter((x): x is PaymentMethodConfig => x !== null);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToWithdrawalSettings(
  economy: EconomyConfig,
  onData: (settings: WithdrawalSettingsConfig) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'withdrawalSettings/config';
  return onSnapshot(
    doc(db, 'withdrawalSettings', 'config'),
    (snap) => {
      const def = getDefaultWithdrawalSettings(economy);
      if (!snap.exists()) {
        onData(def);
        return;
      }
      const data = snap.data();
      const allowedRaw = Array.isArray(data.allowedMethods)
        ? data.allowedMethods.map((v) => String(v))
        : def.allowedMethods;
      const allowedMethods = allowedRaw.filter(
        (m): m is PaymentMethodId =>
          m === 'bkash' || m === 'nagad' || m === 'rocket' || m === 'bank',
      );

      onData({
        withdrawalEnabled:
          typeof data.withdrawalEnabled === 'boolean'
            ? data.withdrawalEnabled
            : def.withdrawalEnabled,
        minimumWithdrawPoints:
          typeof data.minimumWithdrawPoints === 'number' && data.minimumWithdrawPoints >= 1
            ? data.minimumWithdrawPoints
            : def.minimumWithdrawPoints,
        maximumWithdrawBdt:
          typeof data.maximumWithdrawBdt === 'number' && data.maximumWithdrawBdt >= 1
            ? data.maximumWithdrawBdt
            : def.maximumWithdrawBdt,
        defaultFeePercent:
          typeof data.defaultFeePercent === 'number'
            ? data.defaultFeePercent
            : def.defaultFeePercent,
        dailyLimitBdt:
          typeof data.dailyLimitBdt === 'number' && data.dailyLimitBdt >= 1
            ? data.dailyLimitBdt
            : null,
        dailyLimitCount:
          typeof data.dailyLimitCount === 'number' && data.dailyLimitCount >= 1
            ? Math.floor(data.dailyLimitCount)
            : def.dailyLimitCount,
        monthlyLimitBdt:
          typeof data.monthlyLimitBdt === 'number' && data.monthlyLimitBdt >= 1
            ? data.monthlyLimitBdt
            : null,
        processingTimeLabel: String(data.processingTimeLabel || def.processingTimeLabel),
        allowedMethods: allowedMethods.length > 0 ? allowedMethods : def.allowedMethods,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToUserWithdrawalRequests(
  uid: string,
  onData: (requests: WithdrawalRequestRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'withdrawalRequests';
  const q = query(collection(db, 'withdrawalRequests'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) =>
        mapWithdrawalRequestDoc(d.id, d.data() as Record<string, unknown>),
      );
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllWithdrawalRequests(
  onData: (requests: WithdrawalRequestRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'withdrawalRequests';
  return onSnapshot(
    collection(db, 'withdrawalRequests'),
    (snap) => {
      const items = snap.docs.map((d) =>
        mapWithdrawalRequestDoc(d.id, d.data() as Record<string, unknown>),
      );
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAdminLogs(
  onData: (logs: AdminLogRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'adminLogs';
  return onSnapshot(
    collection(db, 'adminLogs'),
    (snap) => {
      const items: AdminLogRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        const rawRole = String(data.adminRole || '');
        const mappedRole: AdminRole | undefined =
          rawRole === 'super_admin' || rawRole === 'admin' || rawRole === 'support_admin'
            ? rawRole
            : undefined;
        return {
          id: d.id,
          logId: String(data.logId || d.id),
          adminUid: String(data.adminUid || ''),
          adminEmail: String(data.adminEmail || ''),
          adminRole: mappedRole,
          action: String(data.action || ''),
          targetId: String(data.targetId || ''),
          previousValue: data.previousValue ? String(data.previousValue) : undefined,
          newValue: data.newValue ? String(data.newValue) : undefined,
          metadata: data.metadata ? String(data.metadata) : undefined,
          details: String(data.details || ''),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

const WITHDRAW_ERROR_MESSAGES: Record<string, string> = {
  WALLET_OR_WITHDRAWALS_DISABLED: 'Withdrawals are currently paused by the Administrator.',
  CONVERSION_RATE_UNSET: 'Points-to-BDT rate has not been configured by the Admin yet.',
  USER_NOT_ACTIVE: 'Only active accounts can request a withdrawal.',
  PAYMENT_METHOD_DISABLED: 'This payment method is currently disabled by the Administrator.',
  PAYMENT_METHOD_NOT_ALLOWED: 'This payment method is not permitted right now.',
  BELOW_MINIMUM_WITHDRAW: 'Requested amount is below the minimum withdrawal limit.',
  EXCEEDS_MAXIMUM_WITHDRAW: 'Requested amount exceeds the maximum single withdrawal limit.',
  DAILY_WITHDRAW_COUNT_LIMIT_REACHED: 'Daily withdrawal count limit reached for today.',
  DAILY_WITHDRAW_BDT_LIMIT_EXCEEDED: 'Daily withdrawal BDT limit exceeded for today.',
  MONTHLY_WITHDRAW_BDT_LIMIT_EXCEEDED: 'Monthly withdrawal BDT limit exceeded for this month.',
  INSUFFICIENT_AVAILABLE_BALANCE: 'Insufficient available balance for this withdrawal.',
  DUPLICATE_WITHDRAW_REQUEST: 'Duplicate withdrawal request detected. Please wait a moment.',
  CONCURRENT_PENDING_WITHDRAWAL_EXISTS:
    'You already have an active pending withdrawal request. Please wait for review or cancel your pending request first.',
  RATE_LIMIT_EXCEEDED:
    'Too many requests in a short window. Please wait a couple of minutes before trying again.',
};

/**
 * Dispatches a secure Withdrawal Request to our deployed Cloud Function
 * (`requestWithdrawal`), which validates walletEnabled, withdrawalSettings,
 * paymentMethod status, account format, daily/monthly caps, and reserves points
 * atomically in `wallets/{uid}` + `walletLedger` + `transactions`.
 * Never mutates wallet balance on the client!
 */
export async function submitSecureWithdrawalRequest(payload: {
  methodId: PaymentMethodId;
  accountType: MfsAccountType;
  amountBdt: number;
  accountNumber: string;
  optionalNote?: string;
}): Promise<{ requestId: string; transactionId: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required before submitting a withdrawal request.');
  }
  const idToken = await currentUser.getIdToken();
  const appCheckHeaders = await getAppCheckTokenHeader();
  const requestId = `wd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/requestWithdrawal`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({
        requestId,
        methodId: payload.methodId,
        accountType: payload.accountType,
        amountBdt: payload.amountBdt,
        accountNumber: payload.accountNumber.trim(),
        optionalNote: (payload.optionalNote ?? '').trim().slice(0, 200),
      }),
    });
  } catch (err) {
    void reportSystemError(
      'requestWithdrawal_network',
      err instanceof Error ? err.message : 'Withdrawal backend unreachable',
      'high',
      'cloud_function',
    );
    throw new Error(
      'Withdrawal backend Cloud Function is unreachable right now. Deploy functions (`firebase deploy --only functions`) on a Blaze project to enable live payout reservations.',
    );
  }

  let body: { ok?: boolean; error?: string; requestId?: string; transactionId?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error('Invalid response from withdrawal backend.');
  }

  if (!response.ok || !body.ok) {
    const rawCode = body.error || '';
    throw new Error(
      WITHDRAW_ERROR_MESSAGES[rawCode] ||
        rawCode ||
        'Withdrawal request rejected by backend validation.',
    );
  }

  return {
    requestId: body.requestId || requestId,
    transactionId: body.transactionId || requestId,
  };
}

/**
 * Allows the authenticated owner to cancel ONLY a `pending` withdrawal request
 * via our deployed Cloud Function (`cancelWithdrawalRequest`), releasing reservedPoints once.
 */
export async function cancelPendingWithdrawalRequest(requestId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required.');
  }
  const idToken = await currentUser.getIdToken();
  const appCheckHeaders = await getAppCheckTokenHeader();
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/cancelWithdrawalRequest`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({ requestId }),
    });
  } catch (err) {
    void reportSystemError(
      'cancelWithdrawalRequest_network',
      err instanceof Error ? err.message : 'Cancel backend unreachable',
      'medium',
      'cloud_function',
    );
    throw new Error(
      'Cancellation backend Cloud Function is unreachable right now. Deploy functions (`firebase deploy --only functions`) on a Blaze project.',
    );
  }

  let body: { ok?: boolean; error?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error('Invalid response from cancellation backend.');
  }

  if (!response.ok || !body.ok) {
    throw new Error(body.error || 'Only pending requests can be cancelled.');
  }
}

async function writeAdminAuditLog(
  adminUser: { uid: string; email: string },
  action: string,
  targetId: string,
  details: string,
): Promise<void> {
  const logId = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'adminLogs', logId), {
      logId,
      adminUid: adminUser.uid,
      adminEmail: adminUser.email || 'admin@adviewearn.com',
      action: action.slice(0, 80),
      targetId: targetId.slice(0, 128),
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `adminLogs/${logId}`);
  }
}

export async function savePaymentMethodConfig(
  method: PaymentMethodConfig,
  adminUser: { uid: string; email: string },
): Promise<void> {
  const path = `paymentMethods/${method.id}`;
  try {
    await setDoc(doc(db, 'paymentMethods', method.id), {
      methodId: method.id,
      name: method.name.trim(),
      bengaliName: method.bengaliName || '',
      enabled: Boolean(method.enabled),
      minPoints: method.minPoints && method.minPoints >= 1 ? Math.floor(method.minPoints) : null,
      feePercent: Math.max(0, Math.min(50, Number(method.feePercent || 0))),
      processingWindow: method.processingWindow.trim() || 'Within 24 hours',
      allowedAccountTypes: method.allowedAccountTypes,
      updatedAt: serverTimestamp(),
    });
    await writeAdminAuditLog(
      adminUser,
      'payment_method_updated',
      method.id,
      `${method.name}: enabled=${method.enabled}, fee=${method.feePercent}%, minPts=${method.minPoints ?? 'default'}`,
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveWithdrawalSettingsConfig(
  settings: WithdrawalSettingsConfig,
  adminUser: { uid: string; email: string },
): Promise<void> {
  const path = 'withdrawalSettings/config';
  try {
    await Promise.all([
      setDoc(doc(db, 'withdrawalSettings', 'config'), {
        withdrawalEnabled: Boolean(settings.withdrawalEnabled),
        minimumWithdrawPoints:
          settings.minimumWithdrawPoints && settings.minimumWithdrawPoints >= 1
            ? Math.floor(settings.minimumWithdrawPoints)
            : null,
        maximumWithdrawBdt:
          settings.maximumWithdrawBdt && settings.maximumWithdrawBdt >= 1
            ? Number(settings.maximumWithdrawBdt)
            : null,
        defaultFeePercent: Math.max(0, Math.min(50, Number(settings.defaultFeePercent || 0))),
        dailyLimitBdt:
          settings.dailyLimitBdt && settings.dailyLimitBdt >= 1
            ? Number(settings.dailyLimitBdt)
            : null,
        dailyLimitCount: Math.max(1, Math.min(100, Math.floor(settings.dailyLimitCount || 3))),
        monthlyLimitBdt:
          settings.monthlyLimitBdt && settings.monthlyLimitBdt >= 1
            ? Number(settings.monthlyLimitBdt)
            : null,
        processingTimeLabel:
          settings.processingTimeLabel.trim() || 'Within 24 hours (Admin verification)',
        allowedMethods: settings.allowedMethods,
        updatedAt: serverTimestamp(),
      }),
      setDoc(
        doc(db, 'appSettings', 'wallet'),
        {
          walletEnabled: Boolean(settings.withdrawalEnabled),
          minimumWithdrawPoints:
            settings.minimumWithdrawPoints && settings.minimumWithdrawPoints >= 1
              ? Math.floor(settings.minimumWithdrawPoints)
              : null,
          maximumWithdrawAmountBdt:
            settings.maximumWithdrawBdt && settings.maximumWithdrawBdt >= 1
              ? Number(settings.maximumWithdrawBdt)
              : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ]);
    await writeAdminAuditLog(
      adminUser,
      'withdrawal_settings_updated',
      'config',
      `enabled=${settings.withdrawalEnabled}, minPts=${settings.minimumWithdrawPoints ?? 'unset'}, maxBdt=${settings.maximumWithdrawBdt ?? 'unset'}, dailyCap=${settings.dailyLimitBdt ?? 'none'}/${settings.dailyLimitCount}x, monthlyCap=${settings.monthlyLimitBdt ?? 'none'}`,
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Admin lifecycle action: Processing / Approved / Paid / Rejected.
 * Calls deployed `adminManageWithdrawal` Cloud Function when available, and falls back cleanly
 * to an Admin-authorized Firestore atomic `runTransaction` (guarded by `isAdmin()` in firestore.rules)
 * if Functions aren't deployed yet on the project.
 */
export async function adminUpdateWithdrawalStatus(params: {
  requestId: string;
  action: 'processing' | 'approved' | 'paid' | 'rejected';
  payoutTransactionId?: string;
  rejectionReason?: string;
  adminUser: { uid: string; email: string };
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required.');

  const { requestId, action, payoutTransactionId = '', rejectionReason = '', adminUser } = params;
  if (action === 'paid' && payoutTransactionId.trim().length < 4) {
    throw new Error('Please enter the real payout Transaction ID before marking as Paid.');
  }
  if (action === 'rejected' && rejectionReason.trim().length < 3) {
    throw new Error('Please provide a clear rejection reason.');
  }

  try {
    const [idToken, appCheckHeaders] = await Promise.all([
      currentUser.getIdToken(),
      getAppCheckTokenHeader(),
    ]);
    const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/adminManageWithdrawal`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({
        requestId,
        action,
        payoutTransactionId: payoutTransactionId.trim(),
        rejectionReason: rejectionReason.trim(),
      }),
    });
    if (response.ok) {
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (body.ok) return;
      throw new Error(body.error || 'Admin action rejected.');
    }
    if (response.status >= 400 && response.status < 500 && response.status !== 404) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Admin action rejected.');
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !err.message.includes('Failed to fetch') &&
      !err.message.includes('NetworkError') &&
      !err.message.includes('Load failed')
    ) {
      throw err;
    }
  }

  // Admin-authorized Firestore transaction fallback (only succeeds for verified isAdmin() in firestore.rules)
  const requestRef = doc(db, 'withdrawalRequests', requestId);
  const logId = `adm_${Date.now()}_${requestId}`;
  const logRef = doc(db, 'adminLogs', logId);

  try {
    await runTransaction(db, async (txn) => {
      const reqSnap = await txn.get(requestRef);
      if (!reqSnap.exists()) {
        throw new Error('Withdrawal request not found.');
      }
      const reqData = reqSnap.data();
      const currStatus = String(reqData.status || '');
      if (['paid', 'rejected', 'cancelled'].includes(currStatus)) {
        throw new Error('This withdrawal request is already finalized.');
      }

      const targetUid = String(reqData.userId);
      const walletRef = doc(db, 'wallets', targetUid);
      const userRef = doc(db, 'users', targetUid);
      const txId = String(reqData.transactionId || `tx_${requestId}`);
      const txRef = doc(db, 'transactions', txId);

      const [walletSnap, userSnap] = await Promise.all([txn.get(walletRef), txn.get(userRef)]);
      const nowServer = serverTimestamp();
      const pointsReserved = Math.max(0, Number(reqData.pointsReserved || 0));
      const netBdt = Number(reqData.netBdt || 0);
      const grossBdt = Number(reqData.grossBdt || 0);
      const w = walletSnap.exists() ? walletSnap.data() : {};
      const u = userSnap.exists() ? userSnap.data() : {};
      const totalPoints = Number(w.totalPoints ?? u.points ?? 0);
      const prevReserved = Number(w.reservedPoints ?? pointsReserved);
      const prevAvailable = Number(w.availablePoints ?? Math.max(0, totalPoints - prevReserved));

      if (action === 'processing' || action === 'approved') {
        txn.update(requestRef, {
          status: action,
          processingDate: nowServer,
        });
      } else if (action === 'paid') {
        const cleanTxId = payoutTransactionId.trim();
        const newReserved = Math.max(0, prevReserved - pointsReserved);
        const newTotalPoints = Math.max(0, totalPoints - pointsReserved);
        const debitLedgerId = `led_paid_${requestId}`;

        txn.update(requestRef, {
          status: 'paid',
          payoutTransactionId: cleanTxId,
          processingDate: nowServer,
          paidAt: nowServer,
        });
        txn.set(
          txRef,
          {
            status: 'completed',
            subtitle: `Paid via ${String(reqData.methodId).toUpperCase()} · Tx ${cleanTxId}`,
            description: `Payout completed (${cleanTxId})`,
          },
          { merge: true },
        );
        txn.set(doc(db, 'walletLedger', debitLedgerId), {
          entryId: debitLedgerId,
          transactionId: txId,
          userId: targetUid,
          entryType: 'debit',
          transactionType: 'withdrawal',
          pointsDelta: -pointsReserved,
          bdtAmount: grossBdt,
          conversionRateUsed: Number(reqData.conversionRateUsed || 0),
          previousPoints: totalPoints,
          newPoints: newTotalPoints,
          previousReservedPoints: prevReserved,
          newReservedPoints: newReserved,
          status: 'completed',
          description: `Payout sent · Tx ${cleanTxId}`,
          createdAt: nowServer,
        });
        txn.set(
          walletRef,
          {
            userId: targetUid,
            totalPoints: newTotalPoints,
            reservedPoints: newReserved,
            totalWithdrawnPoints: Number(w.totalWithdrawnPoints || 0) + pointsReserved,
            totalWithdrawnBdt: Number(w.totalWithdrawnBdt || 0) + netBdt,
            updatedAt: nowServer,
          },
          { merge: true },
        );
        txn.set(doc(db, 'notifications', `notif_paid_${requestId}`), {
          userId: targetUid,
          title: 'Withdrawal Paid',
          message: `Your payout of ৳${netBdt.toFixed(2)} (${String(reqData.methodId).toUpperCase()}) is marked Paid. Ref: ${cleanTxId}`,
          read: false,
          createdAt: nowServer,
        });
      } else if (action === 'rejected') {
        const cleanReason = rejectionReason.trim();
        const newReserved = Math.max(0, prevReserved - pointsReserved);
        const newAvailable = prevAvailable + pointsReserved;
        const releaseLedgerId = `led_rej_${requestId}`;

        txn.update(requestRef, {
          status: 'rejected',
          rejectionReason: cleanReason,
          processingDate: nowServer,
        });
        txn.set(
          txRef,
          {
            status: 'rejected',
            subtitle: `Rejected: ${cleanReason}`,
            description: `Withdrawal rejected · ${pointsReserved} Pts refunded`,
          },
          { merge: true },
        );
        txn.set(doc(db, 'walletLedger', releaseLedgerId), {
          entryId: releaseLedgerId,
          transactionId: txId,
          userId: targetUid,
          entryType: 'release',
          transactionType: 'refund',
          pointsDelta: pointsReserved,
          bdtAmount: grossBdt,
          conversionRateUsed: Number(reqData.conversionRateUsed || 0),
          previousPoints: totalPoints,
          newPoints: totalPoints,
          previousReservedPoints: prevReserved,
          newReservedPoints: newReserved,
          status: 'rejected',
          description: `Rejected & refunded: ${cleanReason}`,
          createdAt: nowServer,
        });
        txn.set(
          walletRef,
          {
            userId: targetUid,
            availablePoints: newAvailable,
            reservedPoints: newReserved,
            updatedAt: nowServer,
          },
          { merge: true },
        );
        txn.update(userRef, {
          points: newAvailable,
        });
        txn.set(doc(db, 'notifications', `notif_rej_${requestId}`), {
          userId: targetUid,
          title: 'Withdrawal Rejected & Refunded',
          message: `Your withdrawal (${requestId}) was rejected (${cleanReason}). ${pointsReserved} Points returned to your wallet.`,
          read: false,
          createdAt: nowServer,
        });
      }

      txn.set(logRef, {
        logId,
        adminUid: adminUser.uid,
        adminEmail: adminUser.email || 'admin@adviewearn.com',
        action: `withdrawal_${action}`,
        targetId: requestId,
        details:
          action === 'paid'
            ? `Marked Paid (Tx: ${payoutTransactionId.trim()}) for ${targetUid}`
            : action === 'rejected'
              ? `Rejected (${rejectionReason.trim()}) & refunded ${pointsReserved} Pts`
              : `Updated status from ${currStatus} to ${action}`,
        createdAt: nowServer,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `withdrawalRequests/${requestId}`);
  }
}

export function subscribeToUserTransactions(
  uid: string,
  onData: (txs: TransactionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'transactions';
  const q = query(collection(db, 'transactions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: TransactionRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        const type = (data.type as TransactionType) || 'ad_reward';
        const rawStatus = String(data.status || 'completed');
        const status: TransactionStatus =
          rawStatus === 'pending' || rawStatus === 'rejected' || rawStatus === 'reversed'
            ? rawStatus
            : 'completed';
        const pointsDelta = Number(data.pointsDelta || 0);
        const rawDir = String(data.direction || '');
        const direction: TransactionDirection =
          rawDir === 'debit' || rawDir === 'credit'
            ? rawDir
            : pointsDelta < 0 || type === 'withdrawal' || type === 'admin_debit'
              ? 'debit'
              : 'credit';

        return {
          id: d.id,
          transactionId: String(data.transactionId || d.id),
          userId: String(data.userId || uid),
          title: String(data.title || 'Transaction'),
          subtitle: String(data.subtitle || ''),
          description: String(data.description || data.subtitle || ''),
          type,
          direction,
          pointsDelta,
          points: typeof data.points === 'number' ? data.points : Math.abs(pointsDelta),
          bdtAmount: typeof data.bdtAmount === 'number' ? data.bdtAmount : null,
          conversionRateUsed:
            typeof data.conversionRateUsed === 'number' && data.conversionRateUsed > 0
              ? data.conversionRateUsed
              : null,
          timestamp: label,
          dhakaDate: millis > 0 ? getDhakaDateKey(new Date(millis)) : '',
          createdAtMillis: millis,
          status,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToDailyBonusState(
  uid: string,
  onData: (state: DailyBonusState) => void,
  onError: (err: Error) => void,
): () => void {
  const path = `dailyBonuses/${uid}`;
  return onSnapshot(
    doc(db, 'dailyBonuses', uid),
    (snap) => {
      if (!snap.exists()) {
        onData({
          streakDays: 0,
          lastClaimDate: '',
          lastClaimPoints: 0,
          claimedToday: false,
        });
        return;
      }
      const data = snap.data();
      const lastClaimDate = String(data.lastClaimDate || '');
      const todayKey = getDhakaDateKey();
      onData({
        streakDays: Number(data.streakDays || 0),
        lastClaimDate,
        lastClaimPoints: Number(data.lastClaimPoints || 0),
        claimedToday: Boolean(lastClaimDate && lastClaimDate === todayKey),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export const DAILY_CHECKIN_BONUS_AD_ID = 'daily_checkin_bonus';

export function getDefaultDailyBonusAdConfig(): DailyBonusAdConfig {
  return {
    enabled: false,
    monetagDirectLinkUrl: '',
    rewardPoints: null,
    durationSeconds: MIN_AD_VIEW_SECONDS,
    incentivizedTrafficAllowed: false,
  };
}

export function subscribeToDailyBonusAdConfig(
  onData: (config: DailyBonusAdConfig) => void,
  onError?: (err: Error) => void,
): () => void {
  const path = 'appSettings/dailyBonus';
  return onSnapshot(
    doc(db, 'appSettings', 'dailyBonus'),
    (snap) => {
      if (!snap.exists()) {
        onData(getDefaultDailyBonusAdConfig());
        return;
      }
      const data = snap.data();
      onData({
        enabled: Boolean(data.enabled),
        monetagDirectLinkUrl: String(data.monetagDirectLinkUrl || ''),
        rewardPoints:
          typeof data.rewardPoints === 'number' && data.rewardPoints >= 1
            ? Math.floor(data.rewardPoints)
            : null,
        durationSeconds: normalizeAdDurationSeconds(data.durationSeconds),
        incentivizedTrafficAllowed: Boolean(data.incentivizedTrafficAllowed),
      });
    },
    (error) => {
      if (!onError) return;
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function saveDailyBonusAdConfig(
  input: DailyBonusAdConfig,
): Promise<{ usedCloudFunction: boolean }> {
  const cleanUrl = input.monetagDirectLinkUrl.trim().slice(0, 500);
  const cleanReward =
    input.rewardPoints !== null && Number.isFinite(input.rewardPoints) && input.rewardPoints >= 1
      ? Math.floor(input.rewardPoints)
      : 0;
  const cleanDuration = normalizeAdDurationSeconds(input.durationSeconds);
  const enabled = Boolean(input.enabled);
  const incentivized = Boolean(input.incentivizedTrafficAllowed);

  if (cleanUrl && !/^https:\/\/.+/i.test(cleanUrl)) {
    throw new Error('Monetag Direct Link URL must start with https://');
  }
  if (enabled) {
    if (!/^https:\/\/.+/i.test(cleanUrl)) {
      throw new Error('Please enter a valid HTTPS Monetag Direct Link URL before enabling.');
    }
    if (cleanReward < 1) {
      throw new Error('Daily Bonus Reward Points must be at least 1.');
    }
    if (!incentivized) {
      throw new Error(
        'Confirm Monetag Incentivized Traffic approval before enabling Daily Check-in Bonus rewards.',
      );
    }
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication required.');
  }

  try {
    const [idToken, appCheckHeaders] = await Promise.all([
      currentUser.getIdToken(),
      getAppCheckTokenHeader(),
    ]);
    const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/updateDailyBonusAdSettings`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({
        enabled,
        monetagDirectLinkUrl: cleanUrl,
        rewardPoints: cleanReward,
        durationSeconds: cleanDuration,
        incentivizedTrafficAllowed: incentivized,
      }),
    });

    if (response.ok) {
      return { usedCloudFunction: true };
    }
    if (response.status !== 404) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Could not update Daily Check-in Bonus settings.');
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !err.message.includes('Failed to fetch') &&
      !err.message.includes('NetworkError') &&
      !err.message.includes('Load failed')
    ) {
      throw err;
    }
  }

  // Admin-authorized Firestore fallback when Cloud Functions are not yet deployed
  try {
    const ops: Array<Promise<unknown>> = [
      setDoc(
        doc(db, 'appSettings', 'dailyBonus'),
        {
          enabled,
          monetagDirectLinkUrl: cleanUrl,
          rewardPoints: cleanReward,
          durationSeconds: cleanDuration,
          incentivizedTrafficAllowed: incentivized,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ];

    if (cleanReward >= 1) {
      ops.push(
        setDoc(
          doc(db, 'appSettings', 'wallet'),
          { dailyBonusPoints: cleanReward, updatedAt: serverTimestamp() },
          { merge: true },
        ),
        setDoc(
          doc(db, 'appConfig', 'economy'),
          { dailyBonusPoints: cleanReward, updatedAt: serverTimestamp() },
          { merge: true },
        ),
      );
    }

    await Promise.all(ops);
    return { usedCloudFunction: false };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'appSettings/dailyBonus');
  }
}

export async function initiateDailyBonusAdSession(user: UserProfile): Promise<{
  session: AdSessionRecord;
  ad: Advertisement;
  launchUrl: string;
}> {
  if (user.accountStatus !== 'active') {
    throw new Error(AD_SESSION_ERROR_MESSAGES.USER_NOT_ACTIVE);
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to claim your Daily Check-in Bonus.');
  }

  const [idToken, appCheckHeaders] = await Promise.all([
    currentUser.getIdToken(),
    getAppCheckTokenHeader(),
  ]);
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/startDailyBonusSession`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({}),
    });
  } catch {
    throw new Error(
      'Unable to connect to the verification server. Deploy Cloud Functions (`startDailyBonusSession`) before claiming Daily Check-in Bonus.',
    );
  }

  if (response.status === 404) {
    throw new Error(
      'Daily Check-in Bonus verification backend (`startDailyBonusSession`) is not deployed yet.',
    );
  }

  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    sessionId?: string;
    adId?: string;
    dhakaDate?: string;
    rewardPoints?: number;
    durationSeconds?: number;
    launchUrl?: string;
    error?: string;
  };

  if (!response.ok || !body.ok || !body.sessionId || !body.launchUrl) {
    const code = body.error || '';
    throw new Error(
      AD_SESSION_ERROR_MESSAGES[code] ||
        code ||
        'Could not start Daily Check-in Bonus advertisement session.',
    );
  }

  const rewardPoints = Number(body.rewardPoints || 0);
  const durationSeconds = normalizeAdDurationSeconds(body.durationSeconds);
  const dhakaDate = body.dhakaDate || getDhakaDateKey();
  const adId = body.adId || DAILY_CHECKIN_BONUS_AD_ID;

  const session: AdSessionRecord = {
    id: body.sessionId,
    sessionId: body.sessionId,
    userId: user.uid,
    adId,
    adName: 'Daily Check-in Bonus',
    adNetwork: 'Monetag',
    expectedRewardPoints: rewardPoints,
    dhakaDate,
    status: 'pending',
    transactionId: '',
    rejectionReason: '',
    createdAtLabel: 'Just now',
    createdAtMillis: Date.now(),
  };

  const ad: Advertisement = {
    id: adId,
    adId,
    adName: 'Daily Check-in Bonus',
    adNetwork: 'Monetag',
    adType: 'direct_link',
    placementOrUrl: body.launchUrl,
    rewardPoints,
    dailyLimit: 1,
    estimatedDuration: durationSeconds,
    startDate: '',
    endDate: '',
    status: 'active',
    allowedCountries: 'ALL',
    rewardVerificationMethod: 's2s_postback',
    incentivizedTrafficAllowed: true,
    description: 'Daily Check-in Bonus Monetag Advertisement',
    createdAtMillis: Date.now(),
    updatedAtMillis: Date.now(),
  };

  return { session, ad, launchUrl: body.launchUrl };
}

export function subscribeToUserNotifications(
  uid: string,
  onData: (items: NotificationItem[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'notifications';
  const q = query(collection(db, 'notifications'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: NotificationItem[] = snap.docs.map((d) => {
        const data = d.data();
        const { label } = formatFirestoreTimestamp(data.createdAt);
        return {
          id: d.id,
          title: String(data.title || 'Notification'),
          message: String(data.message || ''),
          timeLabel: label,
          read: Boolean(data.read),
          fromFirestore: true,
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function markFirestoreNotificationRead(notifId: string): Promise<void> {
  const path = `notifications/${notifId}`;
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Phase 7: Referral & Invite Friends System ---

export function subscribeToReferralSettings(
  onData: (settings: ReferralSettingsConfig) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'referralSettings/config';
  return onSnapshot(
    doc(db, 'referralSettings', 'config'),
    (snap) => {
      const def = getDefaultReferralSettings();
      if (!snap.exists()) {
        onData(def);
        return;
      }
      const data = snap.data();
      onData({
        referralEnabled:
          typeof data.referralEnabled === 'boolean' ? data.referralEnabled : def.referralEnabled,
        referrerBonusPoints:
          typeof data.referrerBonusPoints === 'number' && data.referrerBonusPoints >= 0
            ? data.referrerBonusPoints
            : null,
        newUserBonusPoints:
          typeof data.newUserBonusPoints === 'number' && data.newUserBonusPoints >= 0
            ? data.newUserBonusPoints
            : null,
        minimumQualificationAds:
          typeof data.minimumQualificationAds === 'number' && data.minimumQualificationAds >= 0
            ? Math.floor(data.minimumQualificationAds)
            : def.minimumQualificationAds,
        requireEmailVerified:
          typeof data.requireEmailVerified === 'boolean'
            ? data.requireEmailVerified
            : def.requireEmailVerified,
        requireActiveAccount:
          typeof data.requireActiveAccount === 'boolean'
            ? data.requireActiveAccount
            : def.requireActiveAccount,
        maxReferralsPerUser:
          typeof data.maxReferralsPerUser === 'number' && data.maxReferralsPerUser >= 1
            ? Math.floor(data.maxReferralsPerUser)
            : null,
        dailyReferralCap:
          typeof data.dailyReferralCap === 'number' && data.dailyReferralCap >= 1
            ? Math.floor(data.dailyReferralCap)
            : def.dailyReferralCap,
        referralRulesText: String(data.referralRulesText || def.referralRulesText),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToUserReferralRewards(
  uid: string,
  onData: (rewards: ReferralRewardRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'referralRewards';
  const q = query(collection(db, 'referralRewards'), where('referrerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: ReferralRewardRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        return {
          id: d.id,
          rewardId: String(data.rewardId || d.id),
          referralId: String(data.referralId || ''),
          referrerUid: String(data.referrerUid || uid),
          referredUid: String(data.referredUid || ''),
          referrerBonusPoints: Number(data.referrerBonusPoints || 0),
          newUserBonusPoints: Number(data.newUserBonusPoints || 0),
          transactionId: String(data.transactionId || ''),
          newUserTransactionId: String(data.newUserTransactionId || ''),
          status: data.status === 'reversed' ? 'reversed' : 'credited',
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToReferralLeaderboard(
  onData: (entries: ReferralLeaderboardEntry[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'referralLeaderboard';
  return onSnapshot(
    collection(db, 'referralLeaderboard'),
    (snap) => {
      const items: ReferralLeaderboardEntry[] = snap.docs.map((d) => {
        const data = d.data();
        const { millis } = formatFirestoreTimestamp(data.updatedAt);
        return {
          uid: String(data.uid || d.id),
          publicUsername: String(data.publicUsername || `@${maskUsername(d.id)}`),
          totalQualifiedReferrals: Number(data.totalQualifiedReferrals || 0),
          totalReferralRewards: Number(data.totalReferralRewards || 0),
          updatedAtMillis: millis,
        };
      });
      items.sort(
        (a, b) =>
          b.totalQualifiedReferrals - a.totalQualifiedReferrals ||
          b.totalReferralRewards - a.totalReferralRewards,
      );
      onData(items.slice(0, 20));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllReferrals(
  onData: (referrals: ReferredUser[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'referrals';
  return onSnapshot(
    collection(db, 'referrals'),
    (snap) => {
      const items = snap.docs.map((d) =>
        mapReferralDoc(d.id, d.data() as Record<string, unknown>),
      );
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToReferralLogs(
  onData: (logs: ReferralLogRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'referralLogs';
  return onSnapshot(
    collection(db, 'referralLogs'),
    (snap) => {
      const items: ReferralLogRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatFirestoreTimestamp(data.createdAt);
        const sev = String(data.severity || 'low');
        return {
          id: d.id,
          logId: String(data.logId || d.id),
          referrerUid: String(data.referrerUid || ''),
          referredUid: String(data.referredUid || ''),
          eventType: String(data.eventType || 'referral_event'),
          severity: sev === 'medium' || sev === 'high' ? sev : 'low',
          details: String(data.details || ''),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export async function requestReferralQualificationCheck(referredUid?: string): Promise<{
  creditedCount: number;
  statuses: string[];
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required.');
  }
  const [idToken, appCheckHeaders] = await Promise.all([
    currentUser.getIdToken(),
    getAppCheckTokenHeader(),
  ]);
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/qualifyReferralBonus`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify(referredUid ? { referredUid } : {}),
    });
  } catch (err) {
    void reportSystemError(
      'qualifyReferralBonus_network',
      err instanceof Error ? err.message : 'Referral qualification backend unreachable',
      'medium',
      'cloud_function',
    );
    throw new Error(
      'Referral verification Cloud Function is unreachable. Deploy functions (`firebase deploy --only functions`) on a Blaze project to enable automatic backend bonus credits.',
    );
  }

  let body: {
    ok?: boolean;
    error?: string;
    results?: Array<{ status?: string }>;
  } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new Error('Invalid response from referral verification backend.');
  }

  if (!response.ok || !body.ok) {
    throw new Error(body.error || 'Could not verify referral qualification.');
  }

  const results = Array.isArray(body.results) ? body.results : [];
  const statuses = results.map((r) => String(r.status || 'unknown'));
  const creditedCount = statuses.filter((s) => s === 'rewarded').length;
  return { creditedCount, statuses };
}

export async function saveReferralSettingsConfig(
  settings: ReferralSettingsConfig,
  adminUser: { uid: string; email: string },
): Promise<void> {
  const path = 'referralSettings/config';
  const cleanReferrerBonus =
    settings.referrerBonusPoints !== null && settings.referrerBonusPoints >= 0
      ? Math.floor(settings.referrerBonusPoints)
      : null;
  const cleanNewUserBonus =
    settings.newUserBonusPoints !== null && settings.newUserBonusPoints >= 0
      ? Math.floor(settings.newUserBonusPoints)
      : null;
  const cleanMaxReferrals =
    settings.maxReferralsPerUser !== null && settings.maxReferralsPerUser >= 1
      ? Math.floor(settings.maxReferralsPerUser)
      : null;
  const cleanMinAds = Math.max(0, Math.min(1000, Math.floor(settings.minimumQualificationAds || 0)));
  const cleanDailyCap = Math.max(1, Math.min(1000, Math.floor(settings.dailyReferralCap || 25)));
  const cleanRulesText = settings.referralRulesText.trim().slice(0, 600);

  try {
    const logId = `reflog_${Date.now()}_cfg`;
    await Promise.all([
      setDoc(doc(db, 'referralSettings', 'config'), {
        referralEnabled: Boolean(settings.referralEnabled),
        referrerBonusPoints: cleanReferrerBonus,
        newUserBonusPoints: cleanNewUserBonus,
        minimumQualificationAds: cleanMinAds,
        requireEmailVerified: Boolean(settings.requireEmailVerified),
        requireActiveAccount: Boolean(settings.requireActiveAccount),
        maxReferralsPerUser: cleanMaxReferrals,
        dailyReferralCap: cleanDailyCap,
        referralRulesText:
          cleanRulesText ||
          'Invited friends must verify email and complete qualifying ads before reward release.',
        updatedAt: serverTimestamp(),
      }),
      writeAdminAuditLog(
        adminUser,
        'referral_settings_updated',
        'config',
        `enabled=${settings.referralEnabled}, referrerBonus=${cleanReferrerBonus ?? 'unset'}, newUserBonus=${cleanNewUserBonus ?? 'unset'}, minAds=${cleanMinAds}`,
      ),
      setDoc(doc(db, 'referralLogs', logId), {
        logId,
        referrerUid: adminUser.uid,
        referredUid: '',
        eventType: 'referral_settings_updated',
        severity: 'low',
        details: `Admin updated referral settings: enabled=${settings.referralEnabled}, referrerBonus=${cleanReferrerBonus ?? 'unset'}, minAds=${cleanMinAds}`,
        createdAt: serverTimestamp(),
      }),
    ]);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminManageReferral(payload: {
  referredUid: string;
  action: 'qualify_credit' | 'reject';
  rejectionReason?: string;
  adminUser: { uid: string; email: string };
}): Promise<void> {
  const { referredUid, action, rejectionReason = '', adminUser } = payload;
  if (action === 'reject' && rejectionReason.trim().length < 3) {
    throw new Error('Please enter a clear rejection reason.');
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication required.');
  }
  const [idToken, appCheckHeaders] = await Promise.all([
    currentUser.getIdToken(),
    getAppCheckTokenHeader(),
  ]);
  const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/adminManageReferral`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({
        referredUid,
        action,
        rejectionReason: rejectionReason.trim(),
      }),
    });
    if (response.ok) return;
    if (response.status !== 404) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Admin referral action rejected.');
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !err.message.includes('Failed to fetch') &&
      !err.message.includes('NetworkError') &&
      !err.message.includes('Load failed')
    ) {
      throw err;
    }
  }

  // Admin-authorized Firestore transaction fallback (only succeeds for verified isAdmin() in firestore.rules)
  const refDocRef = doc(db, 'referrals', referredUid);
  const rewardDocRef = doc(db, 'referralRewards', referredUid);
  const settingsRef = doc(db, 'referralSettings', 'config');
  const appSettingsRef = doc(db, 'appSettings', 'wallet');
  const logId = `adm_${Date.now()}_ref_${referredUid}`;
  const refLogId = `reflog_${Date.now()}_${referredUid}`;

  try {
    await runTransaction(db, async (txn) => {
      const [refSnap, rewardSnap, settingsSnap, appSettingsSnap] = await Promise.all([
        txn.get(refDocRef),
        txn.get(rewardDocRef),
        txn.get(settingsRef),
        txn.get(appSettingsRef),
      ]);
      if (!refSnap.exists()) {
        throw new Error('Referral record not found.');
      }
      const refData = refSnap.data();
      if (refData.rewardStatus === 'credited' || rewardSnap.exists()) {
        throw new Error('Referral reward has already been credited.');
      }

      const nowServer = serverTimestamp();

      if (action === 'reject') {
        const cleanReason = rejectionReason.trim();
        txn.update(refDocRef, {
          qualificationStatus: 'rejected',
          rewardStatus: 'rejected',
          rejectionReason: cleanReason,
          status: 'inactive',
        });
        txn.set(doc(db, 'referralLogs', refLogId), {
          logId: refLogId,
          referrerUid: String(refData.referrerUid || ''),
          referredUid,
          eventType: 'admin_rejected_referral',
          severity: 'medium',
          details: `Rejected by Admin: ${cleanReason}`,
          createdAt: nowServer,
        });
        txn.set(doc(db, 'adminLogs', logId), {
          logId,
          adminUid: adminUser.uid,
          adminEmail: adminUser.email || 'admin@adviewearn.com',
          action: 'referral_reject',
          targetId: referredUid,
          details: `Rejected referral: ${cleanReason}`,
          createdAt: nowServer,
        });
        return;
      }

      const rs = settingsSnap.exists() ? settingsSnap.data() : {};
      const referrerBonusPoints =
        typeof rs.referrerBonusPoints === 'number' && rs.referrerBonusPoints > 0
          ? Math.floor(rs.referrerBonusPoints)
          : 0;
      const newUserBonusPoints =
        typeof rs.newUserBonusPoints === 'number' && rs.newUserBonusPoints > 0
          ? Math.floor(rs.newUserBonusPoints)
          : 0;
      if (referrerBonusPoints <= 0 && newUserBonusPoints <= 0) {
        throw new Error('Configure Referrer Bonus Points in Referral Settings first.');
      }

      const referrerUid = String(refData.referrerUid || '');
      if (!referrerUid || referrerUid === referredUid) {
        throw new Error('Invalid or self-referral cannot be credited.');
      }

      const referrerUserRef = doc(db, 'users', referrerUid);
      const referrerWalletRef = doc(db, 'wallets', referrerUid);
      const referredUserRef = doc(db, 'users', referredUid);
      const referredWalletRef = doc(db, 'wallets', referredUid);
      const leaderboardRef = doc(db, 'referralLeaderboard', referrerUid);

      const [referrerUserSnap, referrerWalletSnap, referredUserSnap, referredWalletSnap, lbSnap] =
        await Promise.all([
          txn.get(referrerUserRef),
          txn.get(referrerWalletRef),
          txn.get(referredUserRef),
          txn.get(referredWalletRef),
          txn.get(leaderboardRef),
        ]);

      if (!referrerUserSnap.exists() || !referredUserSnap.exists()) {
        throw new Error('Referrer or referred user profile not found.');
      }

      const referrerUserData = referrerUserSnap.data();
      const referredUserData = referredUserSnap.data();
      const appSet = appSettingsSnap.exists() ? appSettingsSnap.data() : {};
      const pointsPerBdt =
        typeof appSet.pointsPerBdt === 'number' && appSet.pointsPerBdt > 0
          ? appSet.pointsPerBdt
          : null;
      const rateUsed = pointsPerBdt ?? 0;

      const maskedReferred = `@${maskUsername(String(refData.referredUsername || refData.referredName || 'member'))}`;
      const referrerPublicUsername = `@${maskUsername(String(referrerUserData.username || referrerUserData.fullName || 'member'))}`;
      const txId = `tx_ref_${referredUid}`;
      const ledgerId = `led_ref_${referredUid}`;
      const newUserTxId = `tx_refnew_${referredUid}`;
      const newUserLedgerId = `led_refnew_${referredUid}`;

      if (referrerBonusPoints > 0) {
        const rw = referrerWalletSnap.exists() ? referrerWalletSnap.data() : {};
        const prevTotal = Number(rw.totalPoints ?? referrerUserData.points ?? 0);
        const prevReserved = Number(rw.reservedPoints ?? 0);
        const prevAvail = Number(rw.availablePoints ?? Math.max(0, prevTotal - prevReserved));
        const prevEarned = Number(rw.totalEarnedPoints ?? referrerUserData.totalEarnings ?? 0);
        const bdtSnap = pointsPerBdt ? Number((referrerBonusPoints / pointsPerBdt).toFixed(2)) : 0;
        const desc = `Referral reward for ${maskedReferred}`;

        txn.set(doc(db, 'transactions', txId), {
          transactionId: txId,
          userId: referrerUid,
          title: 'Referral Bonus',
          subtitle: desc,
          description: desc,
          type: 'referral_bonus',
          direction: 'credit',
          pointsDelta: referrerBonusPoints,
          points: referrerBonusPoints,
          bdtAmount: pointsPerBdt ? bdtSnap : null,
          conversionRateUsed: pointsPerBdt,
          status: 'completed',
          createdAt: nowServer,
        });
        txn.set(doc(db, 'walletLedger', ledgerId), {
          entryId: ledgerId,
          transactionId: txId,
          userId: referrerUid,
          entryType: 'credit',
          transactionType: 'referral_bonus',
          pointsDelta: referrerBonusPoints,
          bdtAmount: bdtSnap,
          conversionRateUsed: rateUsed,
          previousPoints: prevTotal,
          newPoints: prevTotal + referrerBonusPoints,
          previousReservedPoints: prevReserved,
          newReservedPoints: prevReserved,
          status: 'completed',
          description: desc,
          createdAt: nowServer,
        });
        txn.set(referrerWalletRef, {
          userId: referrerUid,
          totalPoints: prevTotal + referrerBonusPoints,
          availablePoints: prevAvail + referrerBonusPoints,
          pendingPoints: Number(rw.pendingPoints ?? 0),
          reservedPoints: prevReserved,
          totalEarnedPoints: prevEarned + referrerBonusPoints,
          totalWithdrawnPoints: Number(rw.totalWithdrawnPoints ?? 0),
          totalWithdrawnBdt: Number(rw.totalWithdrawnBdt ?? 0),
          updatedAt: nowServer,
        });
        txn.update(referrerUserRef, {
          points: prevAvail + referrerBonusPoints,
          totalEarnings: prevEarned + referrerBonusPoints,
        });
        txn.set(doc(db, 'notifications', `notif_ref_${referredUid}`), {
          userId: referrerUid,
          title: 'Referral Reward Credited!',
          message: `${maskedReferred} qualified! You earned +${referrerBonusPoints} Points.`,
          read: false,
          createdAt: nowServer,
        });
      }

      if (newUserBonusPoints > 0) {
        const nw = referredWalletSnap.exists() ? referredWalletSnap.data() : {};
        const nPrevTotal = Number(nw.totalPoints ?? referredUserData.points ?? 0);
        const nPrevReserved = Number(nw.reservedPoints ?? 0);
        const nPrevAvail = Number(nw.availablePoints ?? Math.max(0, nPrevTotal - nPrevReserved));
        const nPrevEarned = Number(nw.totalEarnedPoints ?? referredUserData.totalEarnings ?? 0);
        const nBdtSnap = pointsPerBdt ? Number((newUserBonusPoints / pointsPerBdt).toFixed(2)) : 0;
        const nDesc = `Welcome referral bonus (${String(refData.referralCodeUsed || '')})`;

        txn.set(doc(db, 'transactions', newUserTxId), {
          transactionId: newUserTxId,
          userId: referredUid,
          title: 'Welcome Referral Bonus',
          subtitle: nDesc,
          description: nDesc,
          type: 'referral_bonus',
          direction: 'credit',
          pointsDelta: newUserBonusPoints,
          points: newUserBonusPoints,
          bdtAmount: pointsPerBdt ? nBdtSnap : null,
          conversionRateUsed: pointsPerBdt,
          status: 'completed',
          createdAt: nowServer,
        });
        txn.set(doc(db, 'walletLedger', newUserLedgerId), {
          entryId: newUserLedgerId,
          transactionId: newUserTxId,
          userId: referredUid,
          entryType: 'credit',
          transactionType: 'referral_bonus',
          pointsDelta: newUserBonusPoints,
          bdtAmount: nBdtSnap,
          conversionRateUsed: rateUsed,
          previousPoints: nPrevTotal,
          newPoints: nPrevTotal + newUserBonusPoints,
          previousReservedPoints: nPrevReserved,
          newReservedPoints: nPrevReserved,
          status: 'completed',
          description: nDesc,
          createdAt: nowServer,
        });
        txn.set(referredWalletRef, {
          userId: referredUid,
          totalPoints: nPrevTotal + newUserBonusPoints,
          availablePoints: nPrevAvail + newUserBonusPoints,
          pendingPoints: Number(nw.pendingPoints ?? 0),
          reservedPoints: nPrevReserved,
          totalEarnedPoints: nPrevEarned + newUserBonusPoints,
          totalWithdrawnPoints: Number(nw.totalWithdrawnPoints ?? 0),
          totalWithdrawnBdt: Number(nw.totalWithdrawnBdt ?? 0),
          updatedAt: nowServer,
        });
        txn.update(referredUserRef, {
          points: nPrevAvail + newUserBonusPoints,
          totalEarnings: nPrevEarned + newUserBonusPoints,
        });
      }

      txn.update(refDocRef, {
        qualificationStatus: 'rewarded',
        rewardStatus: 'credited',
        rewardPoints: referrerBonusPoints,
        bonusEarnedPoints: referrerBonusPoints,
        newUserBonusPoints,
        rejectionReason: '',
        qualifiedAt: nowServer,
        rewardedAt: nowServer,
      });

      txn.set(rewardDocRef, {
        rewardId: referredUid,
        referralId: referredUid,
        referrerUid,
        referredUid,
        referrerBonusPoints,
        newUserBonusPoints,
        transactionId: txId,
        newUserTransactionId: newUserBonusPoints > 0 ? newUserTxId : '',
        status: 'credited',
        createdAt: nowServer,
      });

      const lbPrev = lbSnap.exists() ? lbSnap.data() : {};
      txn.set(leaderboardRef, {
        uid: referrerUid,
        publicUsername: referrerPublicUsername,
        totalQualifiedReferrals: Number(lbPrev.totalQualifiedReferrals || 0) + 1,
        totalReferralRewards: Number(lbPrev.totalReferralRewards || 0) + referrerBonusPoints,
        updatedAt: nowServer,
      });

      txn.set(doc(db, 'referralLogs', refLogId), {
        logId: refLogId,
        referrerUid,
        referredUid,
        eventType: 'admin_credited_referral',
        severity: 'low',
        details: `Admin approved & credited ${referrerBonusPoints} Pts to referrer ${referrerUid}.`,
        createdAt: nowServer,
      });

      txn.set(doc(db, 'adminLogs', logId), {
        logId,
        adminUid: adminUser.uid,
        adminEmail: adminUser.email || 'admin@adviewearn.com',
        action: 'referral_qualify_credit',
        targetId: referredUid,
        details: `Approved & credited ${referrerBonusPoints} Pts`,
        createdAt: nowServer,
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `referrals/${referredUid}`);
  }
}

