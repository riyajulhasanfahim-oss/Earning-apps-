import * as crypto from 'crypto';
import * as functionsV1 from 'firebase-functions/v1';
import { onRequest } from 'firebase-functions/v2/https';
import type { Request } from 'firebase-functions/v2/https';

interface HttpsResponse {
  status(code: number): HttpsResponse;
  json(body: unknown): unknown;
}
import {
  AdminRole,
  adminAuth,
  calcBdtSnapshot,
  DAILY_CHECKIN_BONUS_AD_ID,
  db,
  extractRequestMetadata,
  FieldValue,
  getAppLixirBackendEnvStatus,
  getDhakaDateKey,
  getDhakaMonthKey,
  getDhakaYesterdayDateKey,
  isValidAppLixirSiteOrKey,
  logFailedTransaction,
  logSystemError,
  maskAccountNumber,
  maskPublicUsername,
  MIN_AD_VIEW_DURATION_SEC,
  MIN_SECONDS_BETWEEN_COMPLETIONS,
  normalizeAdDurationSeconds,
  PAYMENT_FEES,
  readActiveAppSettings,
  sanitizeId,
  VALID_ACCOUNT_TYPES,
  validateMethodAccount,
  verifyAuthAndRole,
  writeAdminAuditLog,
  writeReferralSecurityLog,
} from './helpers';
import {
  computeLedgerReconciliation,
  executeAtomicWalletCredit,
  executeAtomicWalletDebit,
} from './walletCore';
import {
  processVerifiedNetworkCallback,
  recordAdAnalyticsDelta,
  resolveNetworkHealthStatus,
  writeAdNetworkLog,
} from './adNetworkEngine';
import {
  createFraudReport,
  enforceRateLimit,
  evaluateAuthSecuritySignals,
  evaluateReferralFraudSignals,
  evaluateRiskFactors,
  evaluateWithdrawalFraudSignals,
  FraudReviewStatus,
  hashNetworkIdentifier,
  writeSecurityAuditLog,
} from './fraudEngine';

// ============================================================================
// 1. AUTHENTICATION LIFECYCLE TRIGGERS (v1 Auth Triggers)
// ============================================================================

export const onUserCreate = functionsV1.auth.user().onCreate(async (user) => {
  const uid = user.uid;
  const nowServer = FieldValue.serverTimestamp();
  const walletRef = db.collection('wallets').doc(uid);
  const dailyBonusRef = db.collection('dailyBonuses').doc(uid);
  const notifRef = db.collection('notifications').doc(sanitizeId(`notif_welcome_${uid}`));

  try {
    await db.runTransaction(async (txn) => {
      const [walletSnap, bonusSnap] = await Promise.all([
        txn.get(walletRef),
        txn.get(dailyBonusRef),
      ]);

      if (!walletSnap.exists) {
        txn.set(walletRef, {
          userId: uid,
          totalPoints: 0,
          availablePoints: 0,
          pendingPoints: 0,
          reservedPoints: 0,
          totalEarnedPoints: 0,
          totalWithdrawnPoints: 0,
          totalWithdrawnBdt: 0,
          updatedAt: nowServer,
        });
      }

      if (!bonusSnap.exists) {
        txn.set(dailyBonusRef, {
          uid,
          streakDays: 0,
          lastClaimDate: '',
          lastClaimPoints: 0,
          updatedAt: nowServer,
        });
      }

      txn.set(
        notifRef,
        {
          userId: uid,
          title: 'Welcome to AdView Earn',
          message: 'Verify your email and watch rewarded ads to start earning points safely.',
          read: false,
          createdAt: nowServer,
        },
        { merge: true },
      );
    });
  } catch (err) {
    await logSystemError(
      uid,
      'cloud_function',
      'onUserCreate',
      err instanceof Error ? err.message : 'Failed to initialize user wallet',
      'high',
    );
  }
});

export const onUserDelete = functionsV1.auth.user().onDelete(async (user) => {
  const uid = user.uid;
  const nowServer = FieldValue.serverTimestamp();

  try {
    const batch = db.batch();
    const codesSnap = await db.collection('referralCodes').where('ownerUid', '==', uid).get();
    codesSnap.forEach((docSnap) => {
      batch.update(docSnap.ref, { active: false });
    });

    batch.set(
      db.collection('users').doc(uid),
      { accountStatus: 'banned' },
      { merge: true },
    );
    batch.delete(db.collection('admins').doc(uid));

    await batch.commit();
    await writeAdminAuditLog({
      adminUid: 'system',
      adminEmail: 'system@adviewearn.com',
      action: 'auth_user_deleted',
      targetId: uid,
      details: `Cleaned up referralCodes (${codesSnap.size}) and revoked admin markers on account deletion.`,
    });
  } catch (err) {
    await logSystemError(
      uid,
      'cloud_function',
      'onUserDelete',
      err instanceof Error ? err.message : 'Failed cleanup on user delete',
      'high',
    );
  }

  void nowServer;
});

// ============================================================================
// 2. WALLET & LEDGER FUNCTIONS
// ============================================================================

export const getWalletBalance = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req);
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  try {
    const uid = check.auth.uid;
    const [walletSnap, userSnap, settings, reconciliation] = await Promise.all([
      db.collection('wallets').doc(uid).get(),
      db.collection('users').doc(uid).get(),
      readActiveAppSettings(),
      computeLedgerReconciliation(uid, false),
    ]);

    const w = walletSnap.exists ? walletSnap.data()! : {};
    const u = userSnap.exists ? userSnap.data()! : {};
    const totalPoints = Number(w.totalPoints ?? u.points ?? 0);
    const reservedPoints = Number(w.reservedPoints ?? 0);
    const availablePoints = Number(
      w.availablePoints ?? Math.max(0, totalPoints - reservedPoints),
    );

    res.status(200).json({
      ok: true,
      wallet: {
        userId: uid,
        totalPoints,
        availablePoints,
        pendingPoints: Number(w.pendingPoints ?? 0),
        reservedPoints,
        totalEarnedPoints: Number(w.totalEarnedPoints ?? u.totalEarnings ?? 0),
        totalWithdrawnPoints: Number(w.totalWithdrawnPoints ?? 0),
        totalWithdrawnBdt: Number(w.totalWithdrawnBdt ?? 0),
        pointsPerBdt: settings.pointsPerBdt,
        availableBdt: calcBdtSnapshot(availablePoints, settings.pointsPerBdt),
        reconciliationStatus: reconciliation.status,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'WALLET_FETCH_FAILED',
    });
  }
});

export const getTransactionHistory = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req);
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const rawLimit = Number((req.body as Record<string, unknown> | undefined)?.limit ?? req.query.limit ?? 50);
  const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50));

  try {
    const uid = check.auth.uid;
    const [txSnap, ledgerSnap] = await Promise.all([
      db.collection('transactions').where('userId', '==', uid).limit(limit).get(),
      db.collection('walletLedger').where('userId', '==', uid).limit(limit).get(),
    ]);

    const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ledger = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.status(200).json({ ok: true, transactions, ledger });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'TX_HISTORY_FAILED',
    });
  }
});

export const processWalletCredit = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetUserId = sanitizeId(String(body.userId || ''));
  const points = Math.floor(Number(body.points || 0));
  const title = String(body.title || 'Admin Wallet Credit').trim();
  const description = String(body.description || body.reason || '').trim();
  const idempotencyKey = sanitizeId(
    String(body.idempotencyKey || `adm_cr_${targetUserId}_${Date.now()}`),
  );

  if (!targetUserId || points <= 0 || description.length < 3) {
    res.status(400).json({ ok: false, error: 'Valid userId, positive points, and reason required' });
    return;
  }

  try {
    const result = await db.runTransaction(async (txn) =>
      executeAtomicWalletCredit(txn, {
        userId: targetUserId,
        points,
        transactionType: 'admin_credit',
        title,
        description,
        idempotencyKey,
      }),
    );

    await Promise.all([
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        action: 'wallet_credit',
        targetId: targetUserId,
        details: `Credited +${points} Pts (${description}) · Tx ${result.txId}`,
      }),
      writeSecurityAuditLog({
        userId: targetUserId,
        eventType: 'balance_credited_by_admin',
        category: 'wallet',
        severity: 'info',
        transactionId: result.txId,
        details: `Admin ${check.auth.email} credited +${points} Pts (${description})`,
      }),
    ]);

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'WALLET_CREDIT_FAILED';
    await logFailedTransaction({
      userId: targetUserId,
      operation: 'processWalletCredit',
      errorCode: code,
      details: description,
    });
    res.status(409).json({ ok: false, error: code });
  }
});

export const processWalletDebit = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetUserId = sanitizeId(String(body.userId || ''));
  const points = Math.floor(Number(body.points || 0));
  const title = String(body.title || 'Admin Wallet Debit').trim();
  const description = String(body.description || body.reason || '').trim();
  const idempotencyKey = sanitizeId(
    String(body.idempotencyKey || `adm_db_${targetUserId}_${Date.now()}`),
  );

  if (!targetUserId || points <= 0 || description.length < 3) {
    res.status(400).json({ ok: false, error: 'Valid userId, positive points, and reason required' });
    return;
  }

  try {
    const result = await db.runTransaction(async (txn) =>
      executeAtomicWalletDebit(txn, {
        userId: targetUserId,
        points,
        transactionType: 'admin_debit',
        title,
        description,
        idempotencyKey,
      }),
    );

    await Promise.all([
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        action: 'wallet_debit',
        targetId: targetUserId,
        details: `Debited -${points} Pts (${description}) · Tx ${result.txId}`,
      }),
      writeSecurityAuditLog({
        userId: targetUserId,
        eventType: 'balance_debited_by_admin',
        category: 'wallet',
        severity: 'low',
        transactionId: result.txId,
        details: `Admin ${check.auth.email} debited -${points} Pts (${description})`,
      }),
    ]);

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'WALLET_DEBIT_FAILED';
    await logFailedTransaction({
      userId: targetUserId,
      operation: 'processWalletDebit',
      errorCode: code,
      details: description,
    });
    res.status(409).json({ ok: false, error: code });
  }
});

export const reconcileWalletLedger = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'support_admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetUserId = sanitizeId(String(body.userId || req.query.userId || ''));
  if (!targetUserId) {
    res.status(400).json({ ok: false, error: 'userId is required for ledger reconciliation' });
    return;
  }

  try {
    const report = await computeLedgerReconciliation(targetUserId, true);
    res.status(200).json({ ok: true, report });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'RECONCILIATION_FAILED',
    });
  }
});

// ============================================================================
// 3. ADVERTISEMENT SESSIONS, VERIFICATION & DAILY LIMITS
// ============================================================================

async function executeVerifiedAdRewardTransaction(params: {
  sessionId: string;
  userId: string;
  adId: string;
  providerTxId: string;
}): Promise<{ rewardPoints: number; txId: string; bdtSnapshot: number }> {
  const { sessionId, userId, adId, providerTxId } = params;
  const dhakaToday = getDhakaDateKey();
  const isDailyBonus = adId === DAILY_CHECKIN_BONUS_AD_ID;
  const completionId = sanitizeId(`comp_${providerTxId}`);
  const txId = sanitizeId(`tx_${providerTxId}`);
  const ledgerId = sanitizeId(`led_${txId}`);

  const sessionRef = db.collection('adSessions').doc(sessionId);
  const completionRef = db.collection('adCompletions').doc(completionId);
  const userRef = db.collection('users').doc(userId);
  const walletRef = db.collection('wallets').doc(userId);
  const ledgerRef = db.collection('walletLedger').doc(ledgerId);
  const adRef = db.collection('advertisements').doc(adId);
  const dailyLimitRef = db.collection('dailyAdLimits').doc(`${userId}_${dhakaToday}`);
  const dailyBonusConfigRef = db.collection('appSettings').doc('dailyBonus');
  const dailyBonusUserRef = db.collection('dailyBonuses').doc(userId);
  const transactionRef = db.collection('transactions').doc(txId);

  return db.runTransaction(async (txn) => {
    const [
      completionSnap,
      sessionSnap,
      userSnap,
      walletSnap,
      adOrBonusConfigSnap,
      dailyOrBonusUserSnap,
      txSnap,
      settings,
    ] = await Promise.all([
      txn.get(completionRef),
      txn.get(sessionRef),
      txn.get(userRef),
      txn.get(walletRef),
      txn.get(isDailyBonus ? dailyBonusConfigRef : adRef),
      txn.get(isDailyBonus ? dailyBonusUserRef : dailyLimitRef),
      txn.get(transactionRef),
      readActiveAppSettings(txn),
    ]);

    if (!settings.earningEnabled) {
      throw new Error('EARNING_DISABLED');
    }
    if (completionSnap.exists || txSnap.exists) {
      throw new Error('DUPLICATE_PROVIDER_TX');
    }
    if (!sessionSnap.exists) {
      throw new Error('SESSION_NOT_FOUND');
    }
    const sessionData = sessionSnap.data()!;
    if (sessionData.userId !== userId || sessionData.adId !== adId) {
      throw new Error('SESSION_MISMATCH');
    }
    if (sessionData.status !== 'pending') {
      throw new Error('SESSION_ALREADY_FINALIZED');
    }

    const sessionCreatedAt = sessionData.createdAt;
    if (!sessionCreatedAt || typeof sessionCreatedAt.toMillis !== 'function') {
      throw new Error('INVALID_SESSION_TIMESTAMP');
    }

    if (!userSnap.exists) {
      throw new Error('USER_NOT_FOUND');
    }
    const userData = userSnap.data()!;
    if (userData.accountStatus !== 'active') {
      throw new Error('USER_NOT_ACTIVE');
    }

    let requiredDurationSec = MIN_AD_VIEW_DURATION_SEC;
    let rewardPoints = 0;
    let adName = 'Advertisement';
    let adNetwork = 'Partner Network';
    let nextStreakDays = 1;
    let currentCount = 0;
    let currentEarned = 0;
    let completedAdIds: string[] = [];

    if (isDailyBonus) {
      if (!adOrBonusConfigSnap.exists) {
        throw new Error('DAILY_BONUS_NOT_CONFIGURED');
      }
      const bonusCfg = adOrBonusConfigSnap.data()!;
      if (bonusCfg.enabled !== true) {
        throw new Error('AD_INACTIVE');
      }
      if (bonusCfg.incentivizedTrafficAllowed !== true) {
        throw new Error('INCENTIVIZED_TRAFFIC_DISALLOWED');
      }
      requiredDurationSec = normalizeAdDurationSeconds(bonusCfg.durationSeconds);
      const elapsedSinceStartSec = (Date.now() - sessionCreatedAt.toMillis()) / 1000;
      if (elapsedSinceStartSec < requiredDurationSec) {
        throw new Error('ABNORMALLY_FAST_AD_COMPLETION');
      }

      const prevBonus = dailyOrBonusUserSnap.exists ? dailyOrBonusUserSnap.data()! : {};
      const lastClaimDate = String(prevBonus.lastClaimDate || '');
      if (lastClaimDate === dhakaToday) {
        throw new Error('DAILY_BONUS_ALREADY_CLAIMED');
      }
      const yesterdayDhaka = getDhakaYesterdayDateKey(dhakaToday);
      const prevStreak = Math.max(0, Math.floor(Number(prevBonus.streakDays || 0)));
      nextStreakDays = lastClaimDate === yesterdayDhaka ? prevStreak + 1 : 1;

      rewardPoints = Math.max(
        0,
        Math.floor(Number(bonusCfg.rewardPoints || settings.dailyBonusPoints || 0)),
      );
      if (rewardPoints <= 0) {
        throw new Error('INVALID_REWARD_AMOUNT');
      }
      adName = 'Daily Check-in Bonus';
      adNetwork = 'Monetag';
    } else {
      if (!adOrBonusConfigSnap.exists) {
        throw new Error('AD_NOT_FOUND');
      }
      const adData = adOrBonusConfigSnap.data()!;
      if (adData.status !== 'active') {
        throw new Error('AD_INACTIVE');
      }
      if (adData.rewardVerificationMethod === 'none') {
        throw new Error('AD_VERIFICATION_DISABLED');
      }
      if (adData.adType === 'direct_link' && adData.incentivizedTrafficAllowed !== true) {
        throw new Error('INCENTIVIZED_TRAFFIC_DISALLOWED');
      }

      requiredDurationSec = normalizeAdDurationSeconds(adData.estimatedDuration);
      const elapsedSinceStartSec = (Date.now() - sessionCreatedAt.toMillis()) / 1000;
      if (elapsedSinceStartSec < requiredDurationSec) {
        throw new Error('ABNORMALLY_FAST_AD_COMPLETION');
      }

      const existingDaily = dailyOrBonusUserSnap.exists ? dailyOrBonusUserSnap.data()! : null;
      currentCount = Number(existingDaily?.completedCount || 0);
      currentEarned = Number(existingDaily?.earnedPoints || 0);
      completedAdIds = Array.isArray(existingDaily?.completedAdIds)
        ? existingDaily!.completedAdIds.map((x: unknown) => String(x))
        : [];

      const lastUpdatedAt = existingDaily?.updatedAt;
      if (lastUpdatedAt && typeof lastUpdatedAt.toMillis === 'function') {
        const elapsedSec = (Date.now() - lastUpdatedAt.toMillis()) / 1000;
        if (elapsedSec < MIN_SECONDS_BETWEEN_COMPLETIONS) {
          throw new Error('RATE_LIMIT_EXCEEDED');
        }
      }

      if (currentCount >= settings.dailyAdLimit) {
        throw new Error('GLOBAL_DAILY_LIMIT_REACHED');
      }

      const perAdLimit = Math.max(1, Number(adData.dailyLimit || 1));
      const completedCountForThisAd = completedAdIds.filter((id) => id === adId).length;
      if (completedCountForThisAd >= perAdLimit) {
        throw new Error('PER_AD_DAILY_LIMIT_REACHED');
      }

      rewardPoints = Math.max(0, Number(adData.rewardPoints || 0));
      if (rewardPoints <= 0) {
        throw new Error('INVALID_REWARD_AMOUNT');
      }
      adName = String(adData.adName || 'Advertisement');
      adNetwork = String(adData.adNetwork || 'Partner Network');
    }

    const w = walletSnap.exists ? walletSnap.data()! : {};
    const prevTotalPoints = Number(w.totalPoints ?? userData.points ?? 0);
    const prevReserved = Number(w.reservedPoints ?? 0);
    const prevAvailable = Number(
      w.availablePoints ?? Math.max(0, prevTotalPoints - prevReserved),
    );
    const prevPending = Number(w.pendingPoints ?? 0);
    const prevTotalEarned = Number(w.totalEarnedPoints ?? userData.totalEarnings ?? 0);
    const prevWithdrawnPts = Number(w.totalWithdrawnPoints ?? 0);
    const prevWithdrawnBdt = Number(w.totalWithdrawnBdt ?? 0);

    const newTotalPoints = prevTotalPoints + rewardPoints;
    const newAvailablePoints = prevAvailable + rewardPoints;
    const rateUsed = settings.pointsPerBdt ?? 0;
    const bdtSnapshot = calcBdtSnapshot(rewardPoints, settings.pointsPerBdt);
    const description = isDailyBonus
      ? `Daily Check-in Bonus · Day ${nextStreakDays} Streak`
      : `${adNetwork} · S2S Tx ${providerTxId}`;
    const txType = isDailyBonus ? 'daily_bonus' : 'ad_reward';
    const nowServer = FieldValue.serverTimestamp();

    txn.set(completionRef, {
      completionId,
      providerTxId,
      sessionId,
      userId,
      adId,
      adName,
      adNetwork,
      rewardPoints,
      transactionId: txId,
      dhakaDate: dhakaToday,
      status: 'completed',
      createdAt: nowServer,
    });

    txn.update(sessionRef, {
      status: 'completed',
      transactionId: txId,
      rejectionReason: '',
    });

    if (isDailyBonus) {
      txn.set(
        dailyBonusUserRef,
        {
          uid: userId,
          streakDays: nextStreakDays,
          lastClaimDate: dhakaToday,
          lastClaimPoints: rewardPoints,
          updatedAt: nowServer,
        },
        { merge: true },
      );
    } else {
      txn.set(
        dailyLimitRef,
        {
          userId,
          dhakaDate: dhakaToday,
          completedCount: currentCount + 1,
          earnedPoints: currentEarned + rewardPoints,
          completedAdIds: [...completedAdIds, adId],
          updatedAt: nowServer,
        },
        { merge: true },
      );
    }

    txn.set(transactionRef, {
      transactionId: txId,
      userId,
      title: adName,
      subtitle: description,
      description,
      type: txType,
      direction: 'credit',
      pointsDelta: rewardPoints,
      points: rewardPoints,
      bdtAmount: settings.pointsPerBdt ? bdtSnapshot : null,
      conversionRateUsed: settings.pointsPerBdt ?? null,
      status: 'completed',
      createdAt: nowServer,
    });

    txn.set(ledgerRef, {
      entryId: ledgerId,
      transactionId: txId,
      userId,
      entryType: 'credit',
      transactionType: txType,
      pointsDelta: rewardPoints,
      bdtAmount: bdtSnapshot,
      conversionRateUsed: rateUsed,
      previousPoints: prevTotalPoints,
      newPoints: newTotalPoints,
      previousReservedPoints: prevReserved,
      newReservedPoints: prevReserved,
      status: 'completed',
      description,
      createdAt: nowServer,
    });

    txn.set(walletRef, {
      userId,
      totalPoints: newTotalPoints,
      availablePoints: newAvailablePoints,
      pendingPoints: prevPending,
      reservedPoints: prevReserved,
      totalEarnedPoints: prevTotalEarned + rewardPoints,
      totalWithdrawnPoints: prevWithdrawnPts,
      totalWithdrawnBdt: prevWithdrawnBdt,
      updatedAt: nowServer,
    });

    if (isDailyBonus) {
      txn.update(userRef, {
        points: newAvailablePoints,
        totalEarnings: prevTotalEarned + rewardPoints,
      });
    } else {
      txn.update(userRef, {
        points: newAvailablePoints,
        totalEarnings: prevTotalEarned + rewardPoints,
        totalAdViews: FieldValue.increment(1),
      });
    }

    return { rewardPoints, txId, bdtSnapshot };
  });
}

export const createAdSession = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const adId = sanitizeId(String(body.adId || ''));
  if (!adId) {
    res.status(400).json({ ok: false, error: 'Missing adId' });
    return;
  }
  if (adId === DAILY_CHECKIN_BONUS_AD_ID) {
    res.status(403).json({ ok: false, error: 'USE_DAILY_BONUS_ENDPOINT' });
    return;
  }

  const uid = check.auth.uid;
  const sessionRate = await enforceRateLimit({
    bucketKey: `ad_sess_${uid}`,
    actionName: 'createAdSession',
    actorId: uid,
    maxRequests: 15,
    windowSeconds: 60,
  });
  if (!sessionRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: sessionRate.retryAfterSec,
    });
    return;
  }

  const dhakaToday = getDhakaDateKey();
  const randomToken = crypto.randomBytes(6).toString('hex');
  const sessionId = sanitizeId(`sess_${Date.now()}_${uid.slice(0, 6)}_${randomToken}`);

  try {
    const [settings, userSnap, adSnap, dailySnap] = await Promise.all([
      readActiveAppSettings(),
      db.collection('users').doc(uid).get(),
      db.collection('advertisements').doc(adId).get(),
      db.collection('dailyAdLimits').doc(`${uid}_${dhakaToday}`).get(),
    ]);

    if (!settings.earningEnabled) {
      res.status(403).json({ ok: false, error: 'EARNING_DISABLED' });
      return;
    }
    if (!userSnap.exists || userSnap.data()!.accountStatus !== 'active') {
      res.status(403).json({ ok: false, error: 'USER_NOT_ACTIVE' });
      return;
    }
    if (!adSnap.exists) {
      res.status(404).json({ ok: false, error: 'AD_NOT_FOUND' });
      return;
    }
    const adData = adSnap.data()!;
    if (adData.status !== 'active' || adData.rewardVerificationMethod === 'none') {
      res.status(403).json({ ok: false, error: 'AD_NOT_ELIGIBLE' });
      return;
    }
    if (adData.adType === 'direct_link' && adData.incentivizedTrafficAllowed !== true) {
      res.status(403).json({ ok: false, error: 'INCENTIVIZED_TRAFFIC_DISALLOWED' });
      return;
    }

    const adNetLower = String(adData.adNetwork || '').toLowerCase();
    const placementStr = String(adData.placementOrUrl || '').trim();
    const isAppLixirAd = adNetLower.includes('applixir') || /^applixir:/i.test(placementStr);

    if (isAppLixirAd) {
      if (adData.rewardVerificationMethod !== 's2s_postback') {
        res.status(403).json({ ok: false, error: 'S2S_POSTBACK_REQUIRED' });
        return;
      }
      const [appNetSnap, appSecSnap] = await Promise.all([
        db.collection('adNetworks').doc('applixir').get(),
        db.collection('adNetworkSecrets').doc('applixir').get(),
      ]);
      const appNet = appNetSnap.exists ? appNetSnap.data()! : null;
      const appSec = appSecSnap.exists ? appSecSnap.data()! : {};
      if (appNet && appNet.enabled === false) {
        res.status(403).json({ ok: false, error: 'NETWORK_DISABLED' });
        return;
      }
      if (appNet && appNet.rewardEnabled === false) {
        res.status(403).json({ ok: false, error: 'NETWORK_REWARD_NOT_ELIGIBLE' });
        return;
      }

      const envStatus = getAppLixirBackendEnvStatus();
      const hasSiteId =
        isValidAppLixirSiteOrKey(placementStr) ||
        isValidAppLixirSiteOrKey(String(appNet?.websiteId || '')) ||
        isValidAppLixirSiteOrKey(String(appNet?.placementId || '')) ||
        envStatus.siteIdConfigured;
      const hasSecretKey =
        envStatus.secretKeyConfigured || Boolean(String(appSec.callbackSecret || '').trim());
      const hasApiKey =
        envStatus.apiKeyConfigured || Boolean(String(appSec.apiKey || '').trim());

      if (!hasSiteId || !hasSecretKey || !hasApiKey) {
        res.status(412).json({
          ok: false,
          error: 'APPLIXIR_NOT_CONFIGURED',
          missing: {
            siteId: !hasSiteId,
            apiKey: !hasApiKey,
            secretKey: !hasSecretKey,
          },
        });
        return;
      }
    }

    const daily = dailySnap.exists ? dailySnap.data()! : {};
    const completedCount = Number(daily.completedCount || 0);
    const completedAdIds: string[] = Array.isArray(daily.completedAdIds)
      ? daily.completedAdIds.map((x: unknown) => String(x))
      : [];
    if (completedCount >= settings.dailyAdLimit) {
      res.status(429).json({ ok: false, error: 'GLOBAL_DAILY_LIMIT_REACHED' });
      return;
    }
    const perAdCount = completedAdIds.filter((id) => id === adId).length;
    if (perAdCount >= Math.max(1, Number(adData.dailyLimit || 1))) {
      res.status(429).json({ ok: false, error: 'PER_AD_DAILY_LIMIT_REACHED' });
      return;
    }

    const requiredDurationSec = normalizeAdDurationSeconds(adData.estimatedDuration);

    await db.collection('adSessions').doc(sessionId).create({
      sessionId,
      userId: uid,
      adId,
      adName: String(adData.adName || 'Sponsored Ad').slice(0, 100),
      adNetwork: String(adData.adNetwork || 'Partner Network').slice(0, 60),
      expectedRewardPoints: Number(adData.rewardPoints || 0),
      dhakaDate: dhakaToday,
      status: 'pending',
      transactionId: '',
      rejectionReason: '',
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      ok: true,
      sessionId,
      adId,
      dhakaDate: dhakaToday,
      requiredDurationSec,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'CREATE_AD_SESSION_FAILED',
    });
  }
});

export const enforceDailyAdLimit = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req);
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const adId = String(body.adId || req.query.adId || '').trim();
  const uid = check.auth.uid;
  const dhakaDate = getDhakaDateKey();

  try {
    const [settings, dailySnap, adSnap] = await Promise.all([
      readActiveAppSettings(),
      db.collection('dailyAdLimits').doc(`${uid}_${dhakaDate}`).get(),
      adId ? db.collection('advertisements').doc(adId).get() : Promise.resolve(null),
    ]);

    const daily = dailySnap.exists ? dailySnap.data()! : {};
    const completedCount = Number(daily.completedCount || 0);
    const completedAdIds: string[] = Array.isArray(daily.completedAdIds)
      ? daily.completedAdIds.map((x: unknown) => String(x))
      : [];

    const globalAllowed = completedCount < settings.dailyAdLimit;
    let perAdAllowed = true;
    let perAdRemaining = 1;

    if (adSnap && adSnap.exists) {
      const perAdLimit = Math.max(1, Number(adSnap.data()!.dailyLimit || 1));
      const perAdCompleted = completedAdIds.filter((id) => id === adId).length;
      perAdAllowed = perAdCompleted < perAdLimit;
      perAdRemaining = Math.max(0, perAdLimit - perAdCompleted);
    }

    res.status(200).json({
      ok: true,
      dhakaDate,
      allowed: settings.earningEnabled && globalAllowed && perAdAllowed,
      earningEnabled: settings.earningEnabled,
      completedToday: completedCount,
      globalDailyLimit: settings.dailyAdLimit,
      globalRemaining: Math.max(0, settings.dailyAdLimit - completedCount),
      perAdAllowed,
      perAdRemaining,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'LIMIT_CHECK_FAILED',
    });
  }
});

async function handleVerifiedPostbackOrSdkCompletion(req: Request, res: HttpsResponse): Promise<void> {
  const source = (req.method === 'POST' ? (req.body ?? {}) : req.query) as Record<string, unknown>;
  const stripMacro = (raw: unknown): string => {
    const val = String(raw ?? '').trim();
    return /^\{[^}]+\}$/.test(val) ? '' : val;
  };

  // Parse AppLixir v6 `customData` (URL-encoded JSON or raw sessionId string)
  let customDataSessionId = '';
  let customDataAdId = '';
  const rawCustomData = source.customData;
  if (typeof rawCustomData === 'string' && rawCustomData.trim()) {
    const trimmedCustom = rawCustomData.trim();
    if (trimmedCustom.startsWith('{') && !/^\{[^}:]+\}$/.test(trimmedCustom)) {
      try {
        const parsed = JSON.parse(trimmedCustom) as Record<string, unknown>;
        customDataSessionId = stripMacro(parsed.sessionId || parsed.session_id);
        customDataAdId = stripMacro(parsed.adId || parsed.ad_id);
      } catch {
        // Ignore malformed customData JSON
      }
    } else if (!/^\{[^}]+\}$/.test(trimmedCustom)) {
      customDataSessionId = trimmedCustom;
    }
  } else if (rawCustomData && typeof rawCustomData === 'object') {
    const obj = rawCustomData as Record<string, unknown>;
    customDataSessionId = stripMacro(obj.sessionId || obj.session_id);
    customDataAdId = stripMacro(obj.adId || obj.ad_id);
  }

  const rawSessionToken = stripMacro(
    source.sessionId ||
      source.session_id ||
      source.ymid ||
      source.request_var ||
      customDataSessionId ||
      source.custom1,
  );
  const sessionId = rawSessionToken ? sanitizeId(rawSessionToken).replace(/^id_\d+$/, '') : '';
  const rawUserId = stripMacro(
    source.userId || source.user_id || source.userid || source.subid,
  );
  let userId = rawUserId;
  let adId = stripMacro(source.adId || source.ad_id || customDataAdId || source.custom2);

  const gameApiKey = stripMacro(source.gameApiKey);
  const gameId = stripMacro(source.gameId);
  const tid = stripMacro(source.tid || source.trans_id);
  const appLixirStatus = stripMacro(source.status);
  const appLixirSignature = stripMacro(source.signature);
  const appLixirSecretKeyParam = stripMacro(source.secretKey);
  const rewardEventType = stripMacro(source.reward_event_type);

  let networkId = stripMacro(source.networkId || source.network_id || source.net);
  if (!networkId && (gameApiKey || gameId || tid || appLixirSignature)) {
    networkId = 'applixir';
  } else if (
    !networkId &&
    (stripMacro(source.ymid) ||
      stripMacro(source.zone_id) ||
      rewardEventType ||
      stripMacro(source.estimated_price))
  ) {
    networkId = 'monetag';
  }

  const campaignId = stripMacro(source.campaignId || source.campaign_id);
  let providerTxId = stripMacro(
    source.providerTxId ||
      source.provider_tx_id ||
      source.tx_id ||
      source.transaction_id ||
      source.click_id ||
      source.clickid ||
      source.conversion_id ||
      source.request_id ||
      tid,
  );
  const rawTimestamp = source.ts ?? source.timestamp ?? req.headers['x-postback-timestamp'];

  const providedSecret = stripMacro(req.headers['x-postback-secret'] || source.secret);
  const providedSignature = stripMacro(req.headers['x-postback-signature'] || source.sig);

  // Hydrate adId, userId, and networkId when omitted from server-created adSessions/{sessionId}
  if (sessionId && (!adId || !userId || !networkId)) {
    try {
      const sessSnap = await db.collection('adSessions').doc(sessionId).get();
      if (sessSnap.exists) {
        const sess = sessSnap.data()!;
        if (!adId && typeof sess.adId === 'string') {
          adId = String(sess.adId).trim();
        }
        if (!userId && typeof sess.userId === 'string') {
          userId = String(sess.userId).trim();
        }
        if (!networkId && typeof sess.adNetwork === 'string') {
          const netLower = String(sess.adNetwork).toLowerCase();
          if (netLower.includes('monetag')) networkId = 'monetag';
          else if (netLower.includes('applixir')) networkId = 'applixir';
          else if (netLower.includes('adsterra')) networkId = 'adsterra';
        }
      }
    } catch {
      // Downstream parameter validation handles missing fields safely
    }
  }

  if (!providerTxId && networkId.toLowerCase() === 'monetag' && sessionId) {
    providerTxId = sanitizeId(`monetag_${sessionId}`);
  }
  const eventId = stripMacro(source.eventId || source.event_id) || providerTxId || '';

  const cbRate = await enforceRateLimit({
    bucketKey: `ad_cb_${hashNetworkIdentifier(req)}_${sanitizeId(userId || 'anon').slice(0, 24)}`,
    actionName: 'verifyAdCallback',
    actorId: userId || 'callback',
    maxRequests: 40,
    windowSeconds: 60,
  });
  if (!cbRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: cbRate.retryAfterSec,
    });
    return;
  }

  const result = await processVerifiedNetworkCallback({
    sessionId,
    userId,
    adId,
    providerTxId,
    eventId,
    networkId,
    campaignId,
    providedSecret,
    providedSignature,
    rawTimestamp,
    clientIp: req.ip || 'unknown',
    applixirParams:
      networkId === 'applixir' || gameApiKey || gameId || tid || appLixirSignature || appLixirStatus
        ? {
            gameApiKey,
            gameId,
            rawUserId,
            tid,
            status: appLixirStatus,
            signature: appLixirSignature,
            secretKeyParam: appLixirSecretKeyParam,
          }
        : undefined,
    monetagParams:
      networkId.toLowerCase() === 'monetag' || rewardEventType
        ? { rewardEventType }
        : undefined,
    executeRewardTransaction: executeVerifiedAdRewardTransaction,
    onRewardCompleted: async (uid) => {
      await Promise.all([
        processReferralQualification(uid),
        writeSecurityAuditLog({
          userId: uid,
          eventType: 'ad_reward_credited',
          category: 'ad_reward',
          severity: 'info',
          transactionId: providerTxId || eventId,
          details: `Verified callback credited reward for ad ${adId} (session ${sessionId})`,
        }),
      ]);
    },
  });

  if (result.httpStatus >= 400) {
    const errCode = String(result.body.error || 'CALLBACK_REJECTED');
    if (errCode === 'ABNORMALLY_FAST_AD_COMPLETION' && userId) {
      const assessment = evaluateRiskFactors([
        { signal: `Abnormally fast ad completion attempt (< ${MIN_AD_VIEW_DURATION_SEC}s) on ad ${adId}`, weight: 65 },
      ]);
      await createFraudReport({
        category: 'ad_reward',
        assessment,
        userId,
        title: 'Abnormally Fast Ad Completion Blocked',
        details: `Callback for session ${sessionId} (${adId}) arrived before ${MIN_AD_VIEW_DURATION_SEC}s elapsed and was rejected.`,
        relatedTxId: providerTxId || eventId,
        actionTaken: 'Reward rejected safely',
      });
    }
    await writeSecurityAuditLog({
      userId: userId || 'callback',
      eventType: 'ad_reward_rejected',
      category: 'ad_reward',
      severity: errCode === 'INVALID_CALLBACK_SIGNATURE' ? 'high' : 'medium',
      transactionId: providerTxId || eventId,
      details: `Callback rejected (${errCode}) for ad ${adId || 'unknown'}`,
    });
  }

  res.status(result.httpStatus).json(result.body);
}

export const verifyAdRewardPostback = onRequest(
  { cors: false, secrets: ['POSTBACK_SECRET'] },
  handleVerifiedPostbackOrSdkCompletion,
);

export const verifyAdNetworkCallback = onRequest(
  { cors: false, secrets: ['POSTBACK_SECRET'] },
  handleVerifiedPostbackOrSdkCompletion,
);

export const verifyAdCompletion = onRequest(
  { cors: false, secrets: ['POSTBACK_SECRET'] },
  handleVerifiedPostbackOrSdkCompletion,
);

export const processAdReward = onRequest(
  { cors: false, secrets: ['POSTBACK_SECRET'] },
  handleVerifiedPostbackOrSdkCompletion,
);

export const confirmSdkAdCompletion = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const uid = check.auth.uid;
  const sdkRate = await enforceRateLimit({
    bucketKey: `sdk_reward_${uid}`,
    actionName: 'confirmSdkAdCompletion',
    actorId: uid,
    maxRequests: 15,
    windowSeconds: 60,
  });
  if (!sdkRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: sdkRate.retryAfterSec,
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sessionId = sanitizeId(String(body.sessionId || '').trim());
  const adId = sanitizeId(String(body.adId || '').trim());
  const rawSdkZone = String(body.sdkZoneId || '').trim();
  const sdkZoneId = rawSdkZone.replace(/[^a-zA-Z0-9_.\-/]/g, '');
  const sdkVerified = body.sdkVerified === true;
  const watchedSeconds = Number(body.watchedSeconds || 0);
  const platformContext = String(body.platformContext || '').trim();

  if (!sessionId || !adId || !sdkVerified || !sdkZoneId) {
    res.status(400).json({ ok: false, error: 'SDK_VERIFICATION_INCOMPLETE' });
    return;
  }
  if (adId === DAILY_CHECKIN_BONUS_AD_ID) {
    res.status(403).json({ ok: false, error: 'S2S_POSTBACK_REQUIRED_FOR_DIRECT_LINK' });
    return;
  }

  try {
    const [sessionSnap, adSnap] = await Promise.all([
      db.collection('adSessions').doc(sessionId).get(),
      db.collection('advertisements').doc(adId).get(),
    ]);

    if (!sessionSnap.exists) {
      res.status(404).json({ ok: false, error: 'SESSION_NOT_FOUND' });
      return;
    }
    const sessionData = sessionSnap.data()!;
    if (sessionData.userId !== uid || sessionData.adId !== adId) {
      res.status(403).json({ ok: false, error: 'SESSION_MISMATCH' });
      return;
    }
    if (sessionData.status !== 'pending') {
      res.status(409).json({ ok: false, error: 'SESSION_ALREADY_FINALIZED' });
      return;
    }
    if (!adSnap.exists) {
      res.status(404).json({ ok: false, error: 'AD_NOT_FOUND' });
      return;
    }
    const adData = adSnap.data()!;
    if (adData.status !== 'active') {
      res.status(403).json({ ok: false, error: 'AD_INACTIVE' });
      return;
    }
    // Direct links MUST NEVER be rewarded via client/SDK timer alone
    if (adData.adType === 'direct_link') {
      res.status(403).json({ ok: false, error: 'S2S_POSTBACK_REQUIRED_FOR_DIRECT_LINK' });
      return;
    }
    if (adData.rewardVerificationMethod !== 'sdk_callback') {
      res.status(403).json({ ok: false, error: 'S2S_POSTBACK_REQUIRED' });
      return;
    }

    const adNetworkLower = String(adData.adNetwork || '').toLowerCase();
    const configuredPlacement = String(adData.placementOrUrl || '').trim();
    if (adNetworkLower.includes('applixir') || /^applixir:/i.test(configuredPlacement)) {
      res.status(403).json({
        ok: false,
        error: 'S2S_POSTBACK_REQUIRED',
      });
      return;
    }
    if (adNetworkLower.includes('monetag') && platformContext !== 'telegram_mini_app') {
      res.status(403).json({
        ok: false,
        error: 'MONETAG_SDK_REQUIRES_TELEGRAM_MINI_APP',
      });
      return;
    }

    const configuredGamUnit = configuredPlacement.replace(/^gam:/i, '').trim();
    const isGamPath =
      platformContext === 'web_gpt' &&
      /^\/\d{4,15}\/[a-zA-Z0-9_.\-/]{1,120}$/.test(configuredGamUnit) &&
      configuredGamUnit === sdkZoneId;
    const numericPlacementMatch = configuredPlacement.match(/(\d{4,15})/);
    const isNumericMatch = Boolean(numericPlacementMatch && numericPlacementMatch[1] === sdkZoneId);

    if (!isGamPath && !isNumericMatch) {
      res.status(403).json({ ok: false, error: 'SDK_ZONE_MISMATCH' });
      return;
    }

    const requiredDurationSec = normalizeAdDurationSeconds(adData.estimatedDuration);
    const createdAt = sessionData.createdAt;
    const elapsedSec =
      createdAt && typeof createdAt.toMillis === 'function'
        ? (Date.now() - createdAt.toMillis()) / 1000
        : 0;

    if (elapsedSec < requiredDurationSec || watchedSeconds < requiredDurationSec) {
      const assessment = evaluateRiskFactors([
        {
          signal: `Early SDK completion attempt (${elapsedSec.toFixed(1)}s < ${requiredDurationSec}s) on ad ${adId}`,
          weight: 55,
        },
      ]);
      await createFraudReport({
        category: 'ad_reward',
        assessment,
        userId: uid,
        title: 'Early Ad Completion Attempt Blocked',
        details: `SDK completion for session ${sessionId} arrived after ${elapsedSec.toFixed(1)}s (min ${requiredDurationSec}s).`,
        relatedTxId: sessionId,
        actionTaken: 'Reward denied',
      });
      res.status(409).json({
        ok: false,
        error: 'ABNORMALLY_FAST_AD_COMPLETION',
        requiredDurationSec,
        elapsedSec: Math.floor(elapsedSec),
      });
      return;
    }

    const providerTxId = sanitizeId(`sdk_${sessionId}`);
    const outcome = await executeVerifiedAdRewardTransaction({
      sessionId,
      userId: uid,
      adId,
      providerTxId,
    });

    const dhakaToday = getDhakaDateKey();
    const networkName = String(adData.adNetwork || 'Monetag');
    const networkId = networkName.toLowerCase().includes('monetag')
      ? 'monetag'
      : sanitizeId(networkName.toLowerCase());
    const callbackId = sanitizeId(`cb_sdk_${sessionId}`);

    await Promise.all([
      db.collection('adCallbacks').doc(callbackId).set({
        callbackId,
        eventId: providerTxId,
        networkId,
        campaignId: '',
        sessionId,
        userId: uid,
        status: 'processed',
        signatureValid: true,
        timestampValid: true,
        replayDetected: false,
        rewardPoints: outcome.rewardPoints,
        rejectionReason: '',
        callbackTimestampSec: Math.floor(Date.now() / 1000),
        createdAt: FieldValue.serverTimestamp(),
      }),
      recordAdAnalyticsDelta({
        networkId,
        networkName,
        dhakaDate: dhakaToday,
        clicksSupported: false,
        deltaImpressions: 1,
        deltaVerified: 1,
        deltaRewards: outcome.rewardPoints,
      }),
      writeAdNetworkLog({
        networkId,
        actorUid: uid,
        eventType: 'sdk_callback_processed',
        severity: 'info',
        status: 'processed',
        details: `Verified Rewarded SDK completion (zone=${sdkZoneId}, ${Math.floor(elapsedSec)}s) for user=${uid}, +${outcome.rewardPoints} Pts`,
      }),
      processReferralQualification(uid),
      writeSecurityAuditLog({
        userId: uid,
        eventType: 'ad_reward_credited',
        category: 'ad_reward',
        severity: 'info',
        transactionId: outcome.txId,
        details: `Verified SDK callback credited +${outcome.rewardPoints} Pts for ad ${adId} (session ${sessionId})`,
      }),
    ]);

    res.status(200).json({ ok: true, ...outcome });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'SDK_VERIFICATION_FAILED';
    const statusCode =
      code === 'DUPLICATE_PROVIDER_TX' || code === 'SESSION_ALREADY_FINALIZED' || code === 'ABNORMALLY_FAST_AD_COMPLETION'
        ? 409
        : code === 'GLOBAL_DAILY_LIMIT_REACHED' || code === 'PER_AD_DAILY_LIMIT_REACHED' || code === 'RATE_LIMIT_EXCEEDED'
          ? 429
          : 400;
    res.status(statusCode).json({ ok: false, error: code });
  }
});

export const verifyAdSessionReward = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const uid = check.auth.uid;
  const verifyRate = await enforceRateLimit({
    bucketKey: `ad_verify_${uid}`,
    actionName: 'verifyAdSessionReward',
    actorId: uid,
    maxRequests: 40,
    windowSeconds: 60,
  });
  if (!verifyRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: verifyRate.retryAfterSec,
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sessionId = sanitizeId(String(body.sessionId || '').trim());
  if (!sessionId) {
    res.status(400).json({ ok: false, error: 'Missing sessionId' });
    return;
  }

  try {
    const sessionRef = db.collection('adSessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      res.status(404).json({ ok: false, error: 'SESSION_NOT_FOUND' });
      return;
    }

    const sessionData = sessionSnap.data()!;
    if (sessionData.userId !== uid) {
      res.status(403).json({ ok: false, error: 'SESSION_MISMATCH' });
      return;
    }

    if (sessionData.status === 'completed') {
      const txId = String(sessionData.transactionId || sessionId);
      let rewardPoints = Number(sessionData.expectedRewardPoints || 0);
      if (txId) {
        const txSnap = await db.collection('transactions').doc(txId).get().catch(() => null);
        if (txSnap && txSnap.exists) {
          rewardPoints = Number(txSnap.data()?.points ?? txSnap.data()?.pointsDelta ?? rewardPoints);
        }
      }
      res.status(200).json({
        ok: true,
        status: 'completed',
        rewardPoints,
        txId,
      });
      return;
    }

    if (sessionData.status === 'rejected') {
      res.status(409).json({
        ok: false,
        status: 'rejected',
        error: String(sessionData.rejectionReason || 'SESSION_REJECTED'),
      });
      return;
    }

    const adId = String(sessionData.adId || '');
    const isDailyBonus = adId === DAILY_CHECKIN_BONUS_AD_ID;
    const adOrBonusSnap = await db
      .collection(isDailyBonus ? 'appSettings' : 'advertisements')
      .doc(isDailyBonus ? 'dailyBonus' : adId)
      .get();

    const requiredDurationSec = adOrBonusSnap.exists
      ? normalizeAdDurationSeconds(
          isDailyBonus
            ? adOrBonusSnap.data()!.durationSeconds
            : adOrBonusSnap.data()!.estimatedDuration,
        )
      : MIN_AD_VIEW_DURATION_SEC;

    const createdAt = sessionData.createdAt;
    const elapsedSec =
      createdAt && typeof createdAt.toMillis === 'function'
        ? (Date.now() - createdAt.toMillis()) / 1000
        : 0;

    if (elapsedSec < requiredDurationSec) {
      res.status(200).json({
        ok: true,
        status: 'awaiting_timer',
        remainingSec: Math.max(1, Math.ceil(requiredDurationSec - elapsedSec)),
        elapsedSec: Math.floor(elapsedSec),
        requiredDurationSec,
      });
      return;
    }

    // Look up callbacks already received for this sessionId (held or rejected)
    const callbacksSnap = await db
      .collection('adCallbacks')
      .where('sessionId', '==', sessionId)
      .limit(20)
      .get();

    const callbackDocs = callbacksSnap.docs.map((d) => ({
      ref: d.ref,
      data: d.data(),
    }));

    // Release verified early S2S callback once 30s+ timer has completed
    const heldCallback = callbackDocs.find(
      (c) =>
        c.data.status === 'awaiting_duration' &&
        c.data.signatureValid === true &&
        c.data.timestampValid === true,
    );

    if (heldCallback) {
      const cbData = heldCallback.data;
      const providerTxId = sanitizeId(
        String(cbData.providerTxId || cbData.eventId || `cb_${sessionId}`),
      );
      const networkId = String(cbData.networkId || 'monetag');
      const dhakaToday = getDhakaDateKey();
      const networkName = String(sessionData.adNetwork || 'Partner Network');

      try {
        const outcome = await executeVerifiedAdRewardTransaction({
          sessionId,
          userId: uid,
          adId,
          providerTxId,
        });

        await Promise.all([
          heldCallback.ref.update({
            status: 'processed',
            rewardPoints: outcome.rewardPoints,
            rejectionReason: '',
          }),
          recordAdAnalyticsDelta({
            networkId,
            networkName,
            dhakaDate: dhakaToday,
            clicksSupported: false,
            deltaImpressions: 1,
            deltaVerified: 1,
            deltaRewards: outcome.rewardPoints,
          }),
          writeAdNetworkLog({
            networkId,
            actorUid: uid,
            eventType: 'callback_processed',
            severity: 'info',
            status: 'processed',
            details: `Released held S2S callback for user=${uid}, ad=${adId}, session=${sessionId}, +${outcome.rewardPoints} Pts`,
          }),
          networkId
            ? db
                .collection('adNetworks')
                .doc(networkId)
                .update({
                  healthStatus: 'connected',
                  healthMessage: `Live S2S callback verified (${dhakaToday}).`,
                  updatedAt: FieldValue.serverTimestamp(),
                })
                .catch(() => {})
            : Promise.resolve(),
          processReferralQualification(uid),
          writeSecurityAuditLog({
            userId: uid,
            eventType: 'ad_reward_credited',
            category: 'ad_reward',
            severity: 'info',
            transactionId: outcome.txId,
            details: `Verified held S2S callback credited +${outcome.rewardPoints} Pts for ad ${adId} (session ${sessionId})`,
          }),
        ]);

        res.status(200).json({
          ok: true,
          status: 'completed',
          rewardPoints: outcome.rewardPoints,
          txId: outcome.txId,
        });
        return;
      } catch (releaseErr) {
        const releaseCode = releaseErr instanceof Error ? releaseErr.message : 'UNKNOWN_ERROR';
        if (releaseCode === 'DUPLICATE_PROVIDER_TX' || releaseCode === 'SESSION_ALREADY_FINALIZED') {
          const latestSnap = await sessionRef.get();
          const latestData = latestSnap.exists ? latestSnap.data()! : null;
          if (latestData && latestData.status === 'completed') {
            res.status(200).json({
              ok: true,
              status: 'completed',
              rewardPoints: Number(latestData.expectedRewardPoints || 0),
              txId: String(latestData.transactionId || sessionId),
            });
            return;
          }
        }
        res.status(409).json({
          ok: false,
          status: 'rejected',
          error: releaseCode,
        });
        return;
      }
    }

    // Surface definitive provider/policy rejections immediately instead of timing out
    const terminalReasons = new Set([
      'MONETAG_EVENT_NOT_VALUED',
      'APPLIXIR_STATUS_NOT_COMPLETED',
      'NETWORK_DISABLED',
      'NETWORK_REWARD_NOT_ELIGIBLE',
      'CAMPAIGN_DISABLED',
      'CAMPAIGN_REWARD_INELIGIBLE',
      'CAMPAIGN_GLOBAL_DAILY_LIMIT_REACHED',
      'USER_NOT_ACTIVE',
      'GLOBAL_DAILY_LIMIT_REACHED',
      'PER_AD_DAILY_LIMIT_REACHED',
      'DAILY_BONUS_ALREADY_CLAIMED',
      'INCENTIVIZED_TRAFFIC_DISALLOWED',
    ]);

    const rejectedCallbacks = callbackDocs
      .filter((c) => c.data.status !== 'processed' && c.data.status !== 'awaiting_duration')
      .sort((a, b) => {
        const ta = a.data.createdAt?.toMillis ? a.data.createdAt.toMillis() : 0;
        const tb = b.data.createdAt?.toMillis ? b.data.createdAt.toMillis() : 0;
        return tb - ta;
      });

    const latestRejected = rejectedCallbacks[0];
    const lastCallbackError = latestRejected
      ? String(latestRejected.data.rejectionReason || latestRejected.data.status || '')
      : '';

    if (lastCallbackError && terminalReasons.has(lastCallbackError)) {
      res.status(409).json({
        ok: false,
        status: 'rejected',
        error: lastCallbackError,
        lastCallbackError,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      status: 'pending',
      callbackArrived: false,
      elapsedSec: Math.floor(elapsedSec),
      requiredDurationSec,
      ...(lastCallbackError ? { lastCallbackError } : {}),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'SESSION_VERIFICATION_FAILED',
    });
  }
});

export const cancelAdSession = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const uid = check.auth.uid;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sessionId = sanitizeId(String(body.sessionId || '').trim());
  const reason = String(body.reason || 'CLOSED_BEFORE_30_SECONDS').trim().slice(0, 180);

  if (!sessionId) {
    res.status(400).json({ ok: false, error: 'Missing sessionId' });
    return;
  }

  try {
    const sessionRef = db.collection('adSessions').doc(sessionId);
    const result = await db.runTransaction(async (txn) => {
      const snap = await txn.get(sessionRef);
      if (!snap.exists) {
        return { found: false, alreadyFinalized: false };
      }
      const data = snap.data()!;
      if (data.userId !== uid) {
        throw new Error('SESSION_MISMATCH');
      }
      if (data.status !== 'pending') {
        return { found: true, alreadyFinalized: true, status: String(data.status) };
      }
      txn.update(sessionRef, {
        status: 'rejected',
        rejectionReason: reason || 'CLOSED_BEFORE_30_SECONDS',
      });
      return { found: true, alreadyFinalized: false, status: 'rejected' };
    });

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'CANCEL_SESSION_FAILED';
    res.status(code === 'SESSION_MISMATCH' ? 403 : 500).json({ ok: false, error: code });
  }
});

// ============================================================================
// 4. WITHDRAWAL LIFECYCLE FUNCTIONS
// ============================================================================

async function handleCreateWithdrawalRequest(req: Request, res: HttpsResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }
  const uid = check.auth.uid;
  const wdRate = await enforceRateLimit({
    bucketKey: `wd_req_${uid}`,
    actionName: 'createWithdrawalRequest',
    actorId: uid,
    maxRequests: 5,
    windowSeconds: 120,
  });
  if (!wdRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: wdRate.retryAfterSec,
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const requestId = sanitizeId(String(body.requestId || `wd_${uid}_${Date.now()}`));
  const methodId = String(body.methodId || '').toLowerCase();
  const accountType = String(
    body.accountType || (methodId === 'bank' ? 'bank_account' : 'personal'),
  ).toLowerCase();
  const rawAccountNumber = String(body.accountNumber || '').trim();
  const optionalNote = String(body.optionalNote || '').trim().slice(0, 200);
  const amountBdt = Number(body.amountBdt || 0);

  if (
    !(methodId in PAYMENT_FEES) ||
    !VALID_ACCOUNT_TYPES.includes(accountType) ||
    Number.isNaN(amountBdt) ||
    amountBdt <= 0
  ) {
    res.status(400).json({ ok: false, error: 'Invalid withdrawal payload' });
    return;
  }

  const acctCheck = validateMethodAccount(methodId, rawAccountNumber);
  if (!acctCheck.valid) {
    res.status(400).json({
      ok: false,
      error: 'Invalid account number format for selected payment method',
    });
    return;
  }
  const accountNumber = acctCheck.normalized;
  const maskedAccountNumber = maskAccountNumber(accountNumber, methodId);

  const txId = sanitizeId(`tx_${requestId}`);
  const ledgerId = sanitizeId(`led_${txId}`);
  const dhakaDate = getDhakaDateKey();
  const dhakaMonth = getDhakaMonthKey();

  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('wallets').doc(uid);
  const requestRef = db.collection('withdrawalRequests').doc(requestId);
  const txRef = db.collection('transactions').doc(txId);
  const ledgerRef = db.collection('walletLedger').doc(ledgerId);
  const wdSettingsRef = db.collection('withdrawalSettings').doc('config');
  const methodRef = db.collection('paymentMethods').doc(methodId);
  const userWithdrawalsQuery = db.collection('withdrawalRequests').where('userId', '==', uid);

  try {
    const result = await db.runTransaction(async (txn) => {
      const [userSnap, walletSnap, reqSnap, settings, wdSettingsSnap, methodSnap, existingReqsSnap] =
        await Promise.all([
          txn.get(userRef),
          txn.get(walletRef),
          txn.get(requestRef),
          readActiveAppSettings(txn),
          txn.get(wdSettingsRef),
          txn.get(methodRef),
          txn.get(userWithdrawalsQuery),
        ]);

      if (reqSnap.exists) {
        throw new Error('DUPLICATE_WITHDRAW_REQUEST');
      }

      const wdSettings = wdSettingsSnap.exists ? wdSettingsSnap.data()! : {};
      const wdEnabled =
        settings.walletEnabled &&
        (typeof wdSettings.withdrawalEnabled === 'boolean' ? wdSettings.withdrawalEnabled : true);
      if (!wdEnabled) {
        throw new Error('WALLET_OR_WITHDRAWALS_DISABLED');
      }

      if (!settings.pointsPerBdt || settings.pointsPerBdt <= 0) {
        throw new Error('CONVERSION_RATE_UNSET');
      }

      if (!userSnap.exists) {
        throw new Error('USER_NOT_FOUND');
      }
      const userData = userSnap.data()!;
      if (userData.accountStatus !== 'active') {
        throw new Error('USER_NOT_ACTIVE');
      }

      const methodDoc = methodSnap.exists ? methodSnap.data()! : null;
      if (methodDoc && methodDoc.enabled === false) {
        throw new Error('PAYMENT_METHOD_DISABLED');
      }
      if (Array.isArray(wdSettings.allowedMethods) && !wdSettings.allowedMethods.includes(methodId)) {
        throw new Error('PAYMENT_METHOD_NOT_ALLOWED');
      }

      const feePercent =
        methodDoc && typeof methodDoc.feePercent === 'number'
          ? methodDoc.feePercent
          : PAYMENT_FEES[methodId];
      const feeBdt = Number(((amountBdt * feePercent) / 100).toFixed(2));
      const netBdt = Number(Math.max(0, amountBdt - feeBdt).toFixed(2));
      const pointsRequired = Math.round(amountBdt * settings.pointsPerBdt);

      const globalMinPts =
        typeof wdSettings.minimumWithdrawPoints === 'number' && wdSettings.minimumWithdrawPoints >= 1
          ? wdSettings.minimumWithdrawPoints
          : (settings.minimumWithdrawPoints ?? 1000);
      const minPts =
        methodDoc && typeof methodDoc.minPoints === 'number' && methodDoc.minPoints >= 1
          ? methodDoc.minPoints
          : methodId === 'bank'
            ? globalMinPts * 2
            : globalMinPts;

      if (pointsRequired < minPts) {
        throw new Error('BELOW_MINIMUM_WITHDRAW');
      }

      const maxSingleBdt =
        typeof wdSettings.maximumWithdrawBdt === 'number' && wdSettings.maximumWithdrawBdt >= 1
          ? wdSettings.maximumWithdrawBdt
          : settings.maximumWithdrawAmountBdt;
      if (maxSingleBdt !== null && amountBdt > maxSingleBdt) {
        throw new Error('EXCEEDS_MAXIMUM_WITHDRAW');
      }

      let todayCount = 0;
      let todayBdt = 0;
      let monthBdt = 0;
      let activePendingCount = 0;
      existingReqsSnap.forEach((docSnap) => {
        const d = docSnap.data();
        if (d.status === 'rejected' || d.status === 'cancelled') return;
        if (d.status === 'pending' || d.status === 'processing') {
          activePendingCount += 1;
        }
        const gross = Number(d.grossBdt || 0);
        if (d.dhakaDate === dhakaDate) {
          todayCount += 1;
          todayBdt += gross;
        }
        if (d.dhakaMonth === dhakaMonth) {
          monthBdt += gross;
        }
      });

      if (activePendingCount >= 1) {
        throw new Error('CONCURRENT_PENDING_WITHDRAWAL_EXISTS');
      }

      const dailyLimitCount =
        typeof wdSettings.dailyLimitCount === 'number' && wdSettings.dailyLimitCount >= 1
          ? wdSettings.dailyLimitCount
          : 3;
      if (todayCount >= dailyLimitCount) {
        throw new Error('DAILY_WITHDRAW_COUNT_LIMIT_REACHED');
      }
      if (
        typeof wdSettings.dailyLimitBdt === 'number' &&
        wdSettings.dailyLimitBdt >= 1 &&
        todayBdt + amountBdt > wdSettings.dailyLimitBdt
      ) {
        throw new Error('DAILY_WITHDRAW_BDT_LIMIT_EXCEEDED');
      }
      if (
        typeof wdSettings.monthlyLimitBdt === 'number' &&
        wdSettings.monthlyLimitBdt >= 1 &&
        monthBdt + amountBdt > wdSettings.monthlyLimitBdt
      ) {
        throw new Error('MONTHLY_WITHDRAW_BDT_LIMIT_EXCEEDED');
      }

      const w = walletSnap.exists ? walletSnap.data()! : {};
      const totalPoints = Number(w.totalPoints ?? userData.points ?? 0);
      const prevReserved = Number(w.reservedPoints ?? 0);
      const availablePoints = Number(w.availablePoints ?? Math.max(0, totalPoints - prevReserved));

      if (availablePoints < pointsRequired) {
        throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
      }

      const newAvailable = availablePoints - pointsRequired;
      const newReserved = prevReserved + pointsRequired;
      const nowServer = FieldValue.serverTimestamp();
      const description = `${methodId.toUpperCase()} (${accountType}) · ${maskedAccountNumber} (Reserved)`;

      txn.set(requestRef, {
        requestId,
        transactionId: txId,
        userId: uid,
        methodId,
        accountNumber,
        maskedAccountNumber,
        accountType,
        optionalNote,
        pointsReserved: pointsRequired,
        grossBdt: amountBdt,
        feeBdt,
        netBdt,
        conversionRateUsed: settings.pointsPerBdt,
        dhakaDate,
        dhakaMonth,
        status: 'pending',
        payoutTransactionId: '',
        rejectionReason: '',
        processingDate: null,
        paidAt: null,
        createdAt: nowServer,
      });

      txn.set(txRef, {
        transactionId: txId,
        userId: uid,
        title: `${methodId.toUpperCase()} Withdrawal`,
        subtitle: description,
        description,
        type: 'withdrawal',
        direction: 'debit',
        pointsDelta: -pointsRequired,
        points: pointsRequired,
        bdtAmount: amountBdt,
        conversionRateUsed: settings.pointsPerBdt,
        status: 'pending',
        createdAt: nowServer,
      });

      txn.set(ledgerRef, {
        entryId: ledgerId,
        transactionId: txId,
        userId: uid,
        entryType: 'reserve',
        transactionType: 'withdrawal',
        pointsDelta: -pointsRequired,
        bdtAmount: amountBdt,
        conversionRateUsed: settings.pointsPerBdt,
        previousPoints: totalPoints,
        newPoints: totalPoints,
        previousReservedPoints: prevReserved,
        newReservedPoints: newReserved,
        status: 'pending',
        description,
        createdAt: nowServer,
      });

      txn.set(walletRef, {
        userId: uid,
        totalPoints,
        availablePoints: newAvailable,
        pendingPoints: Number(w.pendingPoints ?? 0),
        reservedPoints: newReserved,
        totalEarnedPoints: Number(w.totalEarnedPoints ?? userData.totalEarnings ?? 0),
        totalWithdrawnPoints: Number(w.totalWithdrawnPoints ?? 0),
        totalWithdrawnBdt: Number(w.totalWithdrawnBdt ?? 0),
        updatedAt: nowServer,
      });

      txn.update(userRef, {
        points: newAvailable,
      });

      const createdTs = userData.createdAt;
      const userCreatedAtMs =
        createdTs && typeof createdTs.toMillis === 'function' ? createdTs.toMillis() : undefined;

      return {
        requestId,
        transactionId: txId,
        pointsReserved: pointsRequired,
        userEmail: String(userData.email || ''),
        userName: String(userData.fullName || ''),
        userCreatedAtMs,
        todayCount,
      };
    });

    await Promise.all([
      evaluateWithdrawalFraudSignals({
        userId: uid,
        userEmail: result.userEmail,
        userName: result.userName,
        accountNumber,
        methodId,
        amountBdt,
        requestId: result.requestId,
        transactionId: result.transactionId,
        userCreatedAtMs: result.userCreatedAtMs,
        todayCount: result.todayCount,
      }),
      writeSecurityAuditLog({
        userId: uid,
        eventType: 'withdrawal_requested',
        category: 'withdrawal',
        severity: 'info',
        transactionId: result.transactionId,
        details: `Requested ৳${amountBdt.toFixed(2)} via ${methodId.toUpperCase()} (${result.pointsReserved} Pts reserved)`,
      }),
    ]);

    res.status(200).json({
      ok: true,
      requestId: result.requestId,
      transactionId: result.transactionId,
      pointsReserved: result.pointsReserved,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'WITHDRAW_FAILED';
    await logFailedTransaction({
      userId: uid,
      operation: 'createWithdrawalRequest',
      errorCode: code,
      transactionId: txId,
      details: `method=${methodId}, amountBdt=${amountBdt}`,
    });
    res.status(409).json({ ok: false, error: code });
  }
}

export const requestWithdrawal = onRequest({ cors: true }, handleCreateWithdrawalRequest);
export const createWithdrawalRequest = onRequest({ cors: true }, handleCreateWithdrawalRequest);

export const cancelWithdrawalRequest = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }
  const uid = check.auth.uid;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const requestId = sanitizeId(String(body.requestId || ''));
  if (!requestId) {
    res.status(400).json({ ok: false, error: 'Missing requestId' });
    return;
  }

  const requestRef = db.collection('withdrawalRequests').doc(requestId);
  const walletRef = db.collection('wallets').doc(uid);
  const userRef = db.collection('users').doc(uid);
  const releaseLedgerId = sanitizeId(`led_cancel_${requestId}`);
  const releaseLedgerRef = db.collection('walletLedger').doc(releaseLedgerId);

  try {
    await db.runTransaction(async (txn) => {
      const [reqSnap, walletSnap, userSnap] = await Promise.all([
        txn.get(requestRef),
        txn.get(walletRef),
        txn.get(userRef),
      ]);

      if (!reqSnap.exists) {
        throw new Error('REQUEST_NOT_FOUND');
      }
      const reqData = reqSnap.data()!;
      if (reqData.userId !== uid) {
        throw new Error('UNAUTHORIZED_REQUEST_OWNER');
      }
      if (reqData.status !== 'pending') {
        throw new Error('ONLY_PENDING_REQUESTS_CAN_BE_CANCELLED');
      }

      const pointsReserved = Math.max(0, Number(reqData.pointsReserved || 0));
      const txId = String(reqData.transactionId || `tx_${requestId}`);
      const txRef = db.collection('transactions').doc(txId);
      const w = walletSnap.exists ? walletSnap.data()! : {};
      const u = userSnap.exists ? userSnap.data()! : {};

      const totalPoints = Number(w.totalPoints ?? u.points ?? 0);
      const prevReserved = Number(w.reservedPoints ?? pointsReserved);
      const prevAvailable = Number(w.availablePoints ?? Math.max(0, totalPoints - prevReserved));
      const newReserved = Math.max(0, prevReserved - pointsReserved);
      const newAvailable = prevAvailable + pointsReserved;
      const nowServer = FieldValue.serverTimestamp();
      const description = `Cancelled by user · ${pointsReserved} Pts released`;

      txn.update(requestRef, {
        status: 'cancelled',
        processingDate: nowServer,
      });

      txn.set(
        txRef,
        {
          status: 'reversed',
          subtitle: description,
          description,
        },
        { merge: true },
      );

      txn.set(releaseLedgerRef, {
        entryId: releaseLedgerId,
        transactionId: txId,
        userId: uid,
        entryType: 'release',
        transactionType: 'refund',
        pointsDelta: pointsReserved,
        bdtAmount: Number(reqData.grossBdt || 0),
        conversionRateUsed: Number(reqData.conversionRateUsed || 0),
        previousPoints: totalPoints,
        newPoints: totalPoints,
        previousReservedPoints: prevReserved,
        newReservedPoints: newReserved,
        status: 'reversed',
        description,
        createdAt: nowServer,
      });

      txn.set(
        walletRef,
        {
          userId: uid,
          totalPoints,
          availablePoints: newAvailable,
          reservedPoints: newReserved,
          updatedAt: nowServer,
        },
        { merge: true },
      );

      txn.update(userRef, {
        points: newAvailable,
      });
    });

    res.status(200).json({ ok: true, requestId, status: 'cancelled' });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'CANCEL_FAILED';
    res.status(409).json({ ok: false, error: code });
  }
});

async function executeAdminWithdrawalTransition(params: {
  adminUid: string;
  adminEmail: string;
  adminRole?: AdminRole | null;
  metadata?: string;
  requestId: string;
  action: 'processing' | 'approved' | 'paid' | 'rejected';
  payoutTransactionId?: string;
  rejectionReason?: string;
}): Promise<void> {
  const {
    adminUid,
    adminEmail,
    adminRole,
    metadata = '',
    requestId,
    action,
    payoutTransactionId = '',
    rejectionReason = '',
  } = params;

  const requestRef = db.collection('withdrawalRequests').doc(requestId);
  const logId = sanitizeId(`adm_${Date.now()}_${requestId}`);
  const logRef = db.collection('adminLogs').doc(logId);

  await db.runTransaction(async (txn) => {
    const reqSnap = await txn.get(requestRef);
    if (!reqSnap.exists) {
      throw new Error('REQUEST_NOT_FOUND');
    }
    const reqData = reqSnap.data()!;
    const currStatus = String(reqData.status || '');
    if (['paid', 'rejected', 'cancelled'].includes(currStatus)) {
      throw new Error('REQUEST_ALREADY_FINALIZED');
    }

    const targetUid = String(reqData.userId);
    const walletRef = db.collection('wallets').doc(targetUid);
    const userRef = db.collection('users').doc(targetUid);
    const txId = String(reqData.transactionId || `tx_${requestId}`);
    const txRef = db.collection('transactions').doc(txId);

    const [walletSnap, userSnap] = await Promise.all([txn.get(walletRef), txn.get(userRef)]);

    const nowServer = FieldValue.serverTimestamp();
    const pointsReserved = Math.max(0, Number(reqData.pointsReserved || 0));
    const netBdt = Number(reqData.netBdt || 0);
    const grossBdt = Number(reqData.grossBdt || 0);
    const w = walletSnap.exists ? walletSnap.data()! : {};
    const u = userSnap.exists ? userSnap.data()! : {};
    const totalPoints = Number(w.totalPoints ?? u.points ?? 0);
    const prevReserved = Number(w.reservedPoints ?? pointsReserved);
    const prevAvailable = Number(w.availablePoints ?? Math.max(0, totalPoints - prevReserved));

    if (action === 'processing' || action === 'approved') {
      txn.update(requestRef, {
        status: action,
        processingDate: nowServer,
      });
    } else if (action === 'paid') {
      const newReserved = Math.max(0, prevReserved - pointsReserved);
      const newTotalPoints = Math.max(0, totalPoints - pointsReserved);
      const debitLedgerId = sanitizeId(`led_paid_${requestId}`);
      const debitLedgerRef = db.collection('walletLedger').doc(debitLedgerId);

      txn.update(requestRef, {
        status: 'paid',
        payoutTransactionId,
        processingDate: nowServer,
        paidAt: nowServer,
      });

      txn.set(
        txRef,
        {
          status: 'completed',
          subtitle: `Paid via ${String(reqData.methodId).toUpperCase()} · Tx ${payoutTransactionId}`,
          description: `Payout completed (${payoutTransactionId})`,
        },
        { merge: true },
      );

      txn.set(debitLedgerRef, {
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
        description: `Payout sent · Tx ${payoutTransactionId}`,
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

      txn.set(db.collection('notifications').doc(sanitizeId(`notif_paid_${requestId}`)), {
        userId: targetUid,
        title: 'Withdrawal Paid',
        message: `Your payout of ৳${netBdt.toFixed(2)} (${String(reqData.methodId).toUpperCase()}) is marked Paid. Ref: ${payoutTransactionId}`,
        read: false,
        createdAt: nowServer,
      });
    } else if (action === 'rejected') {
      const newReserved = Math.max(0, prevReserved - pointsReserved);
      const newAvailable = prevAvailable + pointsReserved;
      const releaseLedgerId = sanitizeId(`led_rej_${requestId}`);
      const releaseLedgerRef = db.collection('walletLedger').doc(releaseLedgerId);

      txn.update(requestRef, {
        status: 'rejected',
        rejectionReason,
        processingDate: nowServer,
      });

      txn.set(
        txRef,
        {
          status: 'rejected',
          subtitle: `Rejected: ${rejectionReason}`,
          description: `Withdrawal rejected · ${pointsReserved} Pts refunded`,
        },
        { merge: true },
      );

      txn.set(releaseLedgerRef, {
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
        description: `Rejected & refunded: ${rejectionReason}`,
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

      txn.set(db.collection('notifications').doc(sanitizeId(`notif_rej_${requestId}`)), {
        userId: targetUid,
        title: 'Withdrawal Rejected & Refunded',
        message: `Your withdrawal (${requestId}) was rejected (${rejectionReason}). ${pointsReserved} Points returned to your wallet.`,
        read: false,
        createdAt: nowServer,
      });
    }

    txn.set(logRef, {
      logId,
      adminUid,
      adminEmail: adminEmail || 'admin@adviewearn.com',
      ...(adminRole ? { adminRole } : {}),
      action: `withdrawal_${action}`,
      targetId: requestId,
      previousValue: currStatus,
      newValue: action,
      ...(metadata ? { metadata } : {}),
      details:
        action === 'paid'
          ? `Marked Paid (Tx: ${payoutTransactionId}) for ${targetUid}`
          : action === 'rejected'
            ? `Rejected (${rejectionReason}) & refunded ${pointsReserved} Pts`
            : `Updated status from ${currStatus} to ${action}`,
      createdAt: nowServer,
    });
  });
}

function makeAdminWithdrawalHandler(fixedAction?: 'approved' | 'rejected' | 'paid') {
  return onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }

    const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
    if (!check.auth) {
      res.status(check.status || 403).json({ ok: false, error: check.error });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = sanitizeId(String(body.requestId || ''));
    const action = (fixedAction || String(body.action || '').toLowerCase()) as
      | 'processing'
      | 'approved'
      | 'paid'
      | 'rejected';
    const payoutTransactionId = String(body.payoutTransactionId || '').trim().slice(0, 128);
    const rejectionReason = String(body.rejectionReason || '').trim().slice(0, 300);

    if (!requestId || !['processing', 'approved', 'paid', 'rejected'].includes(action)) {
      res.status(400).json({ ok: false, error: 'Invalid admin withdrawal action payload' });
      return;
    }
    if (action === 'paid' && payoutTransactionId.length < 4) {
      res.status(400).json({
        ok: false,
        error: 'Real payout transaction ID is required to mark Paid',
      });
      return;
    }
    if (action === 'rejected' && rejectionReason.length < 3) {
      res.status(400).json({ ok: false, error: 'Rejection reason is required' });
      return;
    }

    try {
      await executeAdminWithdrawalTransition({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        adminRole: check.auth.adminRole,
        metadata: extractRequestMetadata(req),
        requestId,
        action,
        payoutTransactionId,
        rejectionReason,
      });
      await writeSecurityAuditLog({
        userId: check.auth.uid,
        eventType: `withdrawal_${action}`,
        category: 'withdrawal',
        severity: action === 'rejected' ? 'low' : 'info',
        transactionId: payoutTransactionId || requestId,
        details: `Admin ${check.auth.email} updated withdrawal ${requestId} to ${action}`,
      });
      res.status(200).json({ ok: true, requestId, action });
    } catch (err) {
      const code = err instanceof Error ? err.message : 'ADMIN_ACTION_FAILED';
      await logFailedTransaction({
        userId: check.auth.uid,
        operation: `withdrawal_${action}`,
        errorCode: code,
        transactionId: requestId,
        details: `Admin ${check.auth.uid} failed ${action} on ${requestId}`,
      });
      res.status(409).json({ ok: false, error: code });
    }
  });
}

export const adminManageWithdrawal = makeAdminWithdrawalHandler();
export const approveWithdrawal = makeAdminWithdrawalHandler('approved');
export const rejectWithdrawal = makeAdminWithdrawalHandler('rejected');
export const markWithdrawalPaid = makeAdminWithdrawalHandler('paid');

// ============================================================================
// 5. REFERRAL & INVITE FRIENDS FUNCTIONS
// ============================================================================

async function processReferralQualification(referredUid: string): Promise<{
  status: string;
  rewardPoints?: number;
  newUserBonusPoints?: number;
}> {
  const referralRef = db.collection('referrals').doc(referredUid);
  const rewardRef = db.collection('referralRewards').doc(referredUid);
  const refSettingsRef = db.collection('referralSettings').doc('config');
  const referredUserRef = db.collection('users').doc(referredUid);

  const [referralSnap, rewardSnap, refSettingsSnap, referredUserSnap] = await Promise.all([
    referralRef.get(),
    rewardRef.get(),
    refSettingsRef.get(),
    referredUserRef.get(),
  ]);

  if (!referralSnap.exists) {
    return { status: 'no_referral' };
  }

  const refData = referralSnap.data()!;
  const referrerUid = String(refData.referrerUid || '');

  if (
    rewardSnap.exists ||
    refData.rewardStatus === 'credited' ||
    refData.qualificationStatus === 'rewarded'
  ) {
    return { status: 'already_credited' };
  }

  if (refData.qualificationStatus === 'rejected') {
    return { status: 'rejected' };
  }

  if (!referrerUid || referrerUid === referredUid) {
    await referralRef.update({
      qualificationStatus: 'rejected',
      rewardStatus: 'rejected',
      rejectionReason: 'Self-referral is prohibited.',
      status: 'inactive',
    });
    await writeReferralSecurityLog({
      referrerUid,
      referredUid,
      eventType: 'self_referral_blocked',
      severity: 'high',
      details: `Blocked self-referral attempt for UID ${referredUid}.`,
    });
    return { status: 'rejected' };
  }

  const rs = refSettingsSnap.exists ? refSettingsSnap.data()! : {};
  const referralEnabled = typeof rs.referralEnabled === 'boolean' ? rs.referralEnabled : true;
  if (!referralEnabled) {
    return { status: 'referral_disabled' };
  }

  const referrerBonusPoints =
    typeof rs.referrerBonusPoints === 'number' && rs.referrerBonusPoints > 0
      ? Math.floor(rs.referrerBonusPoints)
      : 0;
  const newUserBonusPoints =
    typeof rs.newUserBonusPoints === 'number' && rs.newUserBonusPoints > 0
      ? Math.floor(rs.newUserBonusPoints)
      : 0;

  if (referrerBonusPoints <= 0 && newUserBonusPoints <= 0) {
    return { status: 'bonus_not_configured' };
  }

  const minAds = Math.max(0, Number(rs.minimumQualificationAds ?? 1));
  const requireEmailVerified =
    typeof rs.requireEmailVerified === 'boolean' ? rs.requireEmailVerified : true;
  const requireActiveAccount =
    typeof rs.requireActiveAccount === 'boolean' ? rs.requireActiveAccount : true;
  const maxReferralsPerUser =
    typeof rs.maxReferralsPerUser === 'number' && rs.maxReferralsPerUser >= 1
      ? Math.floor(rs.maxReferralsPerUser)
      : null;
  const dailyReferralCap = Math.max(1, Number(rs.dailyReferralCap ?? 25));

  if (!referredUserSnap.exists) {
    return { status: 'user_not_found' };
  }
  const referredUserData = referredUserSnap.data()!;

  if (requireActiveAccount && referredUserData.accountStatus !== 'active') {
    await referralRef.update({
      qualificationStatus: 'rejected',
      rewardStatus: 'rejected',
      rejectionReason: 'Referred user account is not active.',
      status: 'inactive',
    });
    await writeReferralSecurityLog({
      referrerUid,
      referredUid,
      eventType: 'inactive_account_rejected',
      severity: 'medium',
      details: `Referred user ${referredUid} status=${referredUserData.accountStatus}.`,
    });
    return { status: 'rejected' };
  }

  if (requireEmailVerified && referredUserData.emailVerified !== true) {
    if (refData.qualificationStatus === 'registered') {
      await referralRef.update({ qualificationStatus: 'pending' });
    }
    return { status: 'pending_email_verification' };
  }

  const adViews = Number(referredUserData.totalAdViews || 0);
  if (adViews < minAds) {
    if (refData.qualificationStatus === 'registered') {
      await referralRef.update({ qualificationStatus: 'pending' });
    }
    return { status: 'pending_ad_qualification' };
  }

  const existingReferralsSnap = await db
    .collection('referrals')
    .where('referrerUid', '==', referrerUid)
    .get();

  const dhakaToday = getDhakaDateKey();
  let totalCreditedForReferrer = 0;
  let todayCreditedForReferrer = 0;
  existingReferralsSnap.forEach((docSnap) => {
    const d = docSnap.data();
    if (d.rewardStatus === 'credited' || d.qualificationStatus === 'rewarded') {
      totalCreditedForReferrer += 1;
      const rTs = d.rewardedAt;
      if (rTs && typeof rTs.toDate === 'function' && getDhakaDateKey(rTs.toDate()) === dhakaToday) {
        todayCreditedForReferrer += 1;
      }
    }
  });

  if (maxReferralsPerUser !== null && totalCreditedForReferrer >= maxReferralsPerUser) {
    await referralRef.update({
      qualificationStatus: 'rejected',
      rewardStatus: 'rejected',
      rejectionReason: `Referrer reached maximum referral limit (${maxReferralsPerUser}).`,
    });
    await writeReferralSecurityLog({
      referrerUid,
      referredUid,
      eventType: 'max_referrals_cap_reached',
      severity: 'medium',
      details: `Referrer ${referrerUid} reached maxReferralsPerUser=${maxReferralsPerUser}.`,
    });
    return { status: 'cap_reached' };
  }

  if (todayCreditedForReferrer >= dailyReferralCap) {
    await writeReferralSecurityLog({
      referrerUid,
      referredUid,
      eventType: 'daily_referral_rate_limit',
      severity: 'medium',
      details: `Referrer ${referrerUid} reached daily cap ${dailyReferralCap} on ${dhakaToday}.`,
    });
    return { status: 'daily_cap_reached' };
  }

  const referrerUserRef = db.collection('users').doc(referrerUid);
  const referrerWalletRef = db.collection('wallets').doc(referrerUid);
  const referredWalletRef = db.collection('wallets').doc(referredUid);
  const leaderboardRef = db.collection('referralLeaderboard').doc(referrerUid);

  const txId = sanitizeId(`tx_ref_${referredUid}`);
  const ledgerId = sanitizeId(`led_ref_${referredUid}`);
  const newUserTxId = sanitizeId(`tx_refnew_${referredUid}`);
  const newUserLedgerId = sanitizeId(`led_refnew_${referredUid}`);

  await db.runTransaction(async (txn) => {
    const [
      freshRefSnap,
      freshRewardSnap,
      referrerUserSnap,
      referrerWalletSnap,
      referredWalletSnap,
      leaderboardSnap,
      appSettings,
    ] = await Promise.all([
      txn.get(referralRef),
      txn.get(rewardRef),
      txn.get(referrerUserRef),
      txn.get(referrerWalletRef),
      txn.get(referredWalletRef),
      txn.get(leaderboardRef),
      readActiveAppSettings(txn),
    ]);

    if (!freshRefSnap.exists || freshRewardSnap.exists) {
      throw new Error('ALREADY_CREDITED');
    }
    const freshData = freshRefSnap.data()!;
    if (freshData.rewardStatus === 'credited' || freshData.qualificationStatus === 'rewarded') {
      throw new Error('ALREADY_CREDITED');
    }
    if (!referrerUserSnap.exists) {
      throw new Error('REFERRER_NOT_FOUND');
    }

    const referrerUserData = referrerUserSnap.data()!;
    if (requireActiveAccount && referrerUserData.accountStatus !== 'active') {
      throw new Error('REFERRER_NOT_ACTIVE');
    }

    const nowServer = FieldValue.serverTimestamp();
    const rateUsed = appSettings.pointsPerBdt ?? 0;
    const maskedReferred = `@${maskPublicUsername(String(freshData.referredUsername || freshData.referredName || 'member'))}`;
    const referrerPublicUsername = `@${maskPublicUsername(String(referrerUserData.username || referrerUserData.fullName || 'member'))}`;

    if (referrerBonusPoints > 0) {
      const rw = referrerWalletSnap.exists ? referrerWalletSnap.data()! : {};
      const prevTotal = Number(rw.totalPoints ?? referrerUserData.points ?? 0);
      const prevReserved = Number(rw.reservedPoints ?? 0);
      const prevAvail = Number(rw.availablePoints ?? Math.max(0, prevTotal - prevReserved));
      const prevEarned = Number(rw.totalEarnedPoints ?? referrerUserData.totalEarnings ?? 0);
      const bdtSnap = calcBdtSnapshot(referrerBonusPoints, appSettings.pointsPerBdt);
      const desc = `Referral reward for ${maskedReferred}`;

      txn.set(db.collection('transactions').doc(txId), {
        transactionId: txId,
        userId: referrerUid,
        title: 'Referral Bonus',
        subtitle: desc,
        description: desc,
        type: 'referral_bonus',
        direction: 'credit',
        pointsDelta: referrerBonusPoints,
        points: referrerBonusPoints,
        bdtAmount: appSettings.pointsPerBdt ? bdtSnap : null,
        conversionRateUsed: appSettings.pointsPerBdt ?? null,
        status: 'completed',
        createdAt: nowServer,
      });

      txn.set(db.collection('walletLedger').doc(ledgerId), {
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

      txn.set(db.collection('notifications').doc(sanitizeId(`notif_ref_${referredUid}`)), {
        userId: referrerUid,
        title: 'Referral Reward Credited!',
        message: `${maskedReferred} qualified! You earned +${referrerBonusPoints} Points.`,
        read: false,
        createdAt: nowServer,
      });
    }

    if (newUserBonusPoints > 0) {
      const nw = referredWalletSnap.exists ? referredWalletSnap.data()! : {};
      const nPrevTotal = Number(nw.totalPoints ?? referredUserData.points ?? 0);
      const nPrevReserved = Number(nw.reservedPoints ?? 0);
      const nPrevAvail = Number(nw.availablePoints ?? Math.max(0, nPrevTotal - nPrevReserved));
      const nPrevEarned = Number(nw.totalEarnedPoints ?? referredUserData.totalEarnings ?? 0);
      const nBdtSnap = calcBdtSnapshot(newUserBonusPoints, appSettings.pointsPerBdt);
      const nDesc = `Welcome referral bonus (${String(freshData.referralCodeUsed || '')})`;

      txn.set(db.collection('transactions').doc(newUserTxId), {
        transactionId: newUserTxId,
        userId: referredUid,
        title: 'Welcome Referral Bonus',
        subtitle: nDesc,
        description: nDesc,
        type: 'referral_bonus',
        direction: 'credit',
        pointsDelta: newUserBonusPoints,
        points: newUserBonusPoints,
        bdtAmount: appSettings.pointsPerBdt ? nBdtSnap : null,
        conversionRateUsed: appSettings.pointsPerBdt ?? null,
        status: 'completed',
        createdAt: nowServer,
      });

      txn.set(db.collection('walletLedger').doc(newUserLedgerId), {
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

    txn.update(referralRef, {
      qualificationStatus: 'rewarded',
      rewardStatus: 'credited',
      rewardPoints: referrerBonusPoints,
      bonusEarnedPoints: referrerBonusPoints,
      newUserBonusPoints,
      rejectionReason: '',
      qualifiedAt: nowServer,
      rewardedAt: nowServer,
    });

    txn.set(rewardRef, {
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

    const lbPrev = leaderboardSnap.exists ? leaderboardSnap.data()! : {};
    txn.set(leaderboardRef, {
      uid: referrerUid,
      publicUsername: referrerPublicUsername,
      totalQualifiedReferrals: Number(lbPrev.totalQualifiedReferrals || 0) + 1,
      totalReferralRewards: Number(lbPrev.totalReferralRewards || 0) + referrerBonusPoints,
      updatedAt: nowServer,
    });
  });

  await Promise.all([
    writeReferralSecurityLog({
      referrerUid,
      referredUid,
      eventType: 'referral_reward_credited',
      severity: 'low',
      details: `Credited ${referrerBonusPoints} Pts to referrer ${referrerUid} and ${newUserBonusPoints} Pts to referred ${referredUid}.`,
    }),
    writeSecurityAuditLog({
      userId: referrerUid,
      eventType: 'referral_bonus_credited',
      category: 'referral',
      severity: 'info',
      transactionId: txId,
      details: `Referral qualified (${referredUid}); credited +${referrerBonusPoints} Pts to referrer and +${newUserBonusPoints} Pts welcome bonus`,
    }),
    evaluateReferralFraudSignals({
      referrerUid,
      referredUid,
      referredPhone: String(referredUserSnap.data()?.phoneNumber || ''),
      referrerRecent24hCount: todayCreditedForReferrer + 1,
    }),
  ]);

  return { status: 'rewarded', rewardPoints: referrerBonusPoints, newUserBonusPoints };
}

export const generateReferralCode = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req);
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const uid = check.auth.uid;
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists && userSnap.data()!.referralCode) {
      res.status(200).json({ ok: true, code: userSnap.data()!.referralCode, existing: true });
      return;
    }

    const username = String(userSnap.data()?.username || 'member');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `ADV${Math.floor(10000 + Math.random() * 89999)}`;
      const codeRef = db.collection('referralCodes').doc(candidate);
      const snap = await codeRef.get();
      if (!snap.exists) {
        await codeRef.set({
          code: candidate,
          ownerUid: uid,
          username,
          active: true,
          createdAt: FieldValue.serverTimestamp(),
        });
        if (userSnap.exists) {
          await userSnap.ref.update({ referralCode: candidate });
        }
        res.status(200).json({ ok: true, code: candidate, existing: false });
        return;
      }
    }

    res.status(503).json({ ok: false, error: 'UNABLE_TO_ALLOCATE_UNIQUE_CODE' });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'GENERATE_CODE_FAILED',
    });
  }
});

export const validateReferralCode = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const valRate = await enforceRateLimit({
    bucketKey: `ref_val_${hashNetworkIdentifier(req)}`,
    actionName: 'validateReferralCode',
    actorId: hashNetworkIdentifier(req),
    maxRequests: 30,
    windowSeconds: 60,
  });
  if (!valRate.allowed) {
    res.status(429).json({
      ok: false,
      valid: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: valRate.retryAfterSec,
    });
    return;
  }

  const source = req.method === 'POST' ? (req.body ?? {}) : req.query;
  const code = String(source.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{3,30}$/.test(code)) {
    res.status(400).json({ ok: false, valid: false, error: 'Invalid code format' });
    return;
  }

  try {
    const snap = await db.collection('referralCodes').doc(code).get();
    if (!snap.exists || snap.data()!.active !== true) {
      res.status(200).json({ ok: true, valid: false });
      return;
    }
    const data = snap.data()!;
    res.status(200).json({
      ok: true,
      valid: true,
      code,
      referrerMaskedUsername: `@${maskPublicUsername(String(data.username || 'member'))}`,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      valid: false,
      error: err instanceof Error ? err.message : 'VALIDATION_FAILED',
    });
  }
});

async function handleQualifyReferral(req: Request, res: HttpsResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req);
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }
  const uid = check.auth.uid;
  const qualRate = await enforceRateLimit({
    bucketKey: `ref_qual_${uid}`,
    actionName: 'qualifyReferral',
    actorId: uid,
    maxRequests: 15,
    windowSeconds: 60,
  });
  if (!qualRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: qualRate.retryAfterSec,
    });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetReferredUid = String(body.referredUid || '').trim();

  try {
    if (targetReferredUid) {
      const refSnap = await db.collection('referrals').doc(targetReferredUid).get();
      if (!refSnap.exists) {
        res.status(200).json({
          ok: true,
          results: [{ referredUid: targetReferredUid, status: 'no_referral' }],
        });
        return;
      }
      const refData = refSnap.data()!;
      if (refData.referrerUid !== uid && refData.referredUid !== uid) {
        res.status(403).json({ ok: false, error: 'Unauthorized referral check' });
        return;
      }
      const result = await processReferralQualification(targetReferredUid);
      res.status(200).json({ ok: true, results: [{ referredUid: targetReferredUid, ...result }] });
      return;
    }

    const [ownAsReferred, asReferrerSnap] = await Promise.all([
      processReferralQualification(uid),
      db.collection('referrals').where('referrerUid', '==', uid).get(),
    ]);

    const results: Array<Record<string, unknown>> = [{ referredUid: uid, ...ownAsReferred }];
    for (const d of asReferrerSnap.docs) {
      const data = d.data();
      if (data.rewardStatus !== 'credited' && data.qualificationStatus !== 'rejected') {
        const outcome = await processReferralQualification(d.id);
        results.push({ referredUid: d.id, ...outcome });
      }
    }

    res.status(200).json({ ok: true, results });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'REFERRAL_CHECK_FAILED',
    });
  }
}

export const qualifyReferralBonus = onRequest({ cors: true }, handleQualifyReferral);
export const qualifyReferral = onRequest({ cors: true }, handleQualifyReferral);

async function handleAdminReferral(req: Request, res: HttpsResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const referredUid = sanitizeId(String(body.referredUid || ''));
  const action = String(body.action || 'qualify_credit').toLowerCase();
  const rejectionReason = String(body.rejectionReason || '').trim().slice(0, 300);

  if (!referredUid || !['qualify_credit', 'reject'].includes(action)) {
    res.status(400).json({ ok: false, error: 'Invalid admin referral action payload' });
    return;
  }
  if (action === 'reject' && rejectionReason.length < 3) {
    res.status(400).json({ ok: false, error: 'Rejection reason is required' });
    return;
  }

  try {
    if (action === 'qualify_credit') {
      const outcome = await processReferralQualification(referredUid);
      if (outcome.status !== 'rewarded' && outcome.status !== 'already_credited') {
        res.status(409).json({ ok: false, error: outcome.status });
        return;
      }
      await writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        action: 'referral_qualify_credit',
        targetId: referredUid,
        details: `Admin triggered referral reward: ${outcome.status}`,
      });
      res.status(200).json({ ok: true, referredUid, ...outcome });
      return;
    }

    const refDoc = db.collection('referrals').doc(referredUid);
    const snap = await refDoc.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: 'Referral record not found' });
      return;
    }
    const data = snap.data()!;
    if (data.rewardStatus === 'credited') {
      res.status(409).json({ ok: false, error: 'Cannot reject an already credited referral' });
      return;
    }

    await refDoc.update({
      qualificationStatus: 'rejected',
      rewardStatus: 'rejected',
      rejectionReason,
      status: 'inactive',
    });

    await writeReferralSecurityLog({
      referrerUid: String(data.referrerUid || ''),
      referredUid,
      eventType: 'admin_rejected_referral',
      severity: 'medium',
      details: `Rejected by Admin: ${rejectionReason}`,
    });

    res.status(200).json({ ok: true, referredUid, status: 'rejected' });
  } catch (err) {
    res.status(409).json({
      ok: false,
      error: err instanceof Error ? err.message : 'ADMIN_REFERRAL_ACTION_FAILED',
    });
  }
}

export const adminManageReferral = onRequest({ cors: true }, handleAdminReferral);
export const processReferralReward = onRequest({ cors: true }, handleAdminReferral);

// ============================================================================
// 6. ADMIN RBAC (3-TIER CUSTOM CLAIMS), SETTINGS, USERS, ADS & BACKUP EXPORT
// ============================================================================

export const setAdminRoleClaim = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'super_admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawUid = String(body.targetUid || '').trim();
  const targetEmail = String(body.targetEmail || '').trim().toLowerCase();
  const rawRole = body.role === null || body.role === '' ? null : String(body.role);

  if (!rawUid && !targetEmail) {
    res.status(400).json({ ok: false, error: 'targetUid or targetEmail is required' });
    return;
  }
  if (rawRole !== null && !['super_admin', 'admin', 'support_admin'].includes(rawRole)) {
    res.status(400).json({
      ok: false,
      error: 'role must be super_admin, admin, support_admin, or null',
    });
    return;
  }

  try {
    const targetUser = rawUid
      ? await adminAuth.getUser(sanitizeId(rawUid))
      : await adminAuth.getUserByEmail(targetEmail);
    const targetUid = targetUser.uid;

    if (targetUid === check.auth.uid && rawRole !== 'super_admin') {
      res.status(409).json({
        ok: false,
        error: 'Super Admin cannot revoke their own super_admin claim.',
      });
      return;
    }

    const existingClaims = { ...(targetUser.customClaims || {}) };
    const previousRole = String(existingClaims.adminRole || 'none');
    if (rawRole === null) {
      delete existingClaims.adminRole;
      await adminAuth.setCustomUserClaims(targetUid, existingClaims);
      await db.collection('admins').doc(targetUid).delete();
    } else {
      const role = rawRole as AdminRole;
      await adminAuth.setCustomUserClaims(targetUid, {
        ...existingClaims,
        adminRole: role,
      });
      await db.collection('admins').doc(targetUid).set(
        {
          uid: targetUid,
          role,
          email: String(targetUser.email || ''),
          assignedBy: check.auth.uid,
          grantedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    await adminAuth.revokeRefreshTokens(targetUid);
    await writeAdminAuditLog({
      adminUid: check.auth.uid,
      adminEmail: check.auth.email,
      adminRole: check.auth.adminRole,
      action: 'admin_role_updated',
      targetId: targetUid,
      previousValue: previousRole,
      newValue: rawRole ?? 'revoked',
      metadata: extractRequestMetadata(req),
      details: `Assigned adminRole=${rawRole ?? 'revoked'} to ${targetUser.email || targetUid}`,
    });

    res.status(200).json({ ok: true, targetUid, email: targetUser.email || '', role: rawRole });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'SET_ADMIN_ROLE_FAILED',
    });
  }
});

export const updateSiteSettings = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'super_admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const websiteName = String(body.websiteName || 'AdView Earn').trim().slice(0, 80);
  if (websiteName.length < 2) {
    res.status(400).json({ ok: false, error: 'Website Name must be at least 2 characters' });
    return;
  }

  const siteRef = db.collection('appSettings').doc('site');
  const prevSnap = await siteRef.get();
  const prevData = prevSnap.exists ? prevSnap.data()! : {};

  const nextPayload = {
    websiteName,
    websiteLogoUrl: String(body.websiteLogoUrl || '').trim().slice(0, 500),
    websiteFaviconUrl: String(body.websiteFaviconUrl || '').trim().slice(0, 500),
    websiteDescription: String(body.websiteDescription || '').trim().slice(0, 400),
    supportEmail: String(body.supportEmail || '').trim().slice(0, 120),
    supportContact: String(body.supportContact || '').trim().slice(0, 120),
    maintenanceMode: Boolean(body.maintenanceMode),
    registrationEnabled:
      typeof body.registrationEnabled === 'boolean' ? body.registrationEnabled : true,
    updatedAt: FieldValue.serverTimestamp(),
  };

  try {
    await Promise.all([
      siteRef.set(nextPayload, { merge: true }),
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        adminRole: check.auth.adminRole,
        action: 'site_settings_updated',
        targetId: 'site',
        previousValue: `name=${String(prevData.websiteName || 'AdView Earn')}, maint=${Boolean(prevData.maintenanceMode)}, reg=${prevData.registrationEnabled !== false}`,
        newValue: `name=${websiteName}, maint=${nextPayload.maintenanceMode}, reg=${nextPayload.registrationEnabled}`,
        metadata: extractRequestMetadata(req),
        details: `Updated website settings (${websiteName})`,
      }),
    ]);
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'SITE_SETTINGS_UPDATE_FAILED',
    });
  }
});

export const updateAppSettings = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const pointsPerBdt =
    typeof body.pointsPerBdt === 'number' && body.pointsPerBdt > 0 ? body.pointsPerBdt : null;
  const dailyBonusPoints =
    typeof body.dailyBonusPoints === 'number' && body.dailyBonusPoints >= 1
      ? Math.floor(body.dailyBonusPoints)
      : null;
  const minimumWithdrawPoints =
    typeof body.minimumWithdrawPoints === 'number' && body.minimumWithdrawPoints >= 1
      ? Math.floor(body.minimumWithdrawPoints)
      : null;
  const maximumWithdrawAmountBdt =
    typeof body.maximumWithdrawAmountBdt === 'number' && body.maximumWithdrawAmountBdt >= 1
      ? Number(body.maximumWithdrawAmountBdt)
      : null;
  const dailyAdLimit =
    typeof body.dailyAdLimit === 'number' && body.dailyAdLimit >= 1
      ? Math.floor(body.dailyAdLimit)
      : 20;
  const walletEnabled = typeof body.walletEnabled === 'boolean' ? body.walletEnabled : true;
  const earningEnabled = typeof body.earningEnabled === 'boolean' ? body.earningEnabled : true;
  const nowServer = FieldValue.serverTimestamp();

  try {
    const prevWalletSnap = await db.collection('appSettings').doc('wallet').get();
    const prev = prevWalletSnap.exists ? prevWalletSnap.data()! : {};

    await Promise.all([
      db.collection('appSettings').doc('wallet').set(
        {
          pointsPerBdt,
          dailyBonusPoints,
          minimumWithdrawPoints,
          maximumWithdrawAmountBdt,
          dailyAdLimit,
          walletEnabled,
          earningEnabled,
          updatedAt: nowServer,
        },
        { merge: true },
      ),
      db.collection('appConfig').doc('economy').set(
        {
          pointsPerBdt,
          dailyBonusPoints,
          minimumWithdrawPoints,
          dailyAdLimit,
          updatedAt: nowServer,
        },
        { merge: true },
      ),
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        adminRole: check.auth.adminRole,
        action: 'app_settings_updated',
        targetId: 'wallet',
        previousValue: `rate=${prev.pointsPerBdt ?? 'unset'}, dailyAds=${prev.dailyAdLimit ?? 'unset'}, wallet=${prev.walletEnabled ?? true}, earning=${prev.earningEnabled ?? true}`,
        newValue: `rate=${pointsPerBdt ?? 'unset'}, dailyAds=${dailyAdLimit}, wallet=${walletEnabled}, earning=${earningEnabled}`,
        metadata: extractRequestMetadata(req),
        details: `rate=${pointsPerBdt ?? 'unset'}, minWd=${minimumWithdrawPoints ?? 'unset'}, dailyAds=${dailyAdLimit}, wallet=${walletEnabled}, earning=${earningEnabled}`,
      }),
    ]);

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'SETTINGS_UPDATE_FAILED',
    });
  }
});

export const updateUserStatus = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetUserId = sanitizeId(String(body.userId || ''));
  const accountStatus = String(body.accountStatus || '').toLowerCase();
  const reason = String(body.reason || 'Admin account status review').trim().slice(0, 300);

  if (!targetUserId || !['active', 'restricted', 'suspended', 'banned'].includes(accountStatus)) {
    res.status(400).json({
      ok: false,
      error: 'userId and valid accountStatus (active/restricted/suspended/banned) required',
    });
    return;
  }

  try {
    const userRef = db.collection('users').doc(targetUserId);
    const prevSnap = await userRef.get();
    const prevStatus = prevSnap.exists ? String(prevSnap.data()!.accountStatus || 'unknown') : 'unknown';

    await userRef.update({ accountStatus });
    if (accountStatus !== 'active') {
      await adminAuth.revokeRefreshTokens(targetUserId).catch(() => {});
    }
    await Promise.all([
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        adminRole: check.auth.adminRole,
        action: 'user_status_updated',
        targetId: targetUserId,
        previousValue: prevStatus,
        newValue: accountStatus,
        metadata: extractRequestMetadata(req),
        details: `Set accountStatus=${accountStatus}. Reason: ${reason}`,
      }),
      writeSecurityAuditLog({
        userId: targetUserId,
        eventType: accountStatus === 'active' ? 'account_restored' : `account_${accountStatus}`,
        category: 'account_restriction',
        severity: accountStatus === 'active' ? 'info' : 'high',
        details: `Admin ${check.auth.email} changed accountStatus ${prevStatus} -> ${accountStatus}: ${reason}`,
      }),
    ]);

    res.status(200).json({ ok: true, userId: targetUserId, accountStatus });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'USER_STATUS_UPDATE_FAILED',
    });
  }
});

export const adjustUserPoints = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const targetUserId = sanitizeId(String(body.userId || ''));
  const deltaPoints = Math.trunc(Number(body.pointsDelta || 0));
  const reason = String(body.reason || '').trim().slice(0, 300);
  const idempotencyKey = sanitizeId(
    String(body.idempotencyKey || `adj_${targetUserId}_${Date.now()}`),
  );

  if (!targetUserId || deltaPoints === 0 || reason.length < 3) {
    res.status(400).json({
      ok: false,
      error: 'userId, non-zero integer pointsDelta, and reason (>= 3 chars) required',
    });
    return;
  }

  try {
    const result = await db.runTransaction(async (txn) => {
      if (deltaPoints > 0) {
        return executeAtomicWalletCredit(txn, {
          userId: targetUserId,
          points: deltaPoints,
          transactionType: 'admin_credit',
          title: 'Admin Points Adjustment',
          description: reason,
          idempotencyKey,
        });
      }
      return executeAtomicWalletDebit(txn, {
        userId: targetUserId,
        points: Math.abs(deltaPoints),
        transactionType: 'admin_debit',
        title: 'Admin Points Deduction',
        description: reason,
        idempotencyKey,
      });
    });

    await writeAdminAuditLog({
      adminUid: check.auth.uid,
      adminEmail: check.auth.email,
      adminRole: check.auth.adminRole,
      action: 'admin_adjust_points',
      targetId: targetUserId,
      previousValue: String(result.previousPoints),
      newValue: String(result.newPoints),
      metadata: extractRequestMetadata(req),
      details: `Adjusted ${deltaPoints > 0 ? '+' : ''}${deltaPoints} Pts (${reason}) · Tx ${result.txId}`,
    });

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const code = err instanceof Error ? err.message : 'ADJUST_POINTS_FAILED';
    await logFailedTransaction({
      userId: targetUserId,
      operation: 'adjustUserPoints',
      errorCode: code,
      details: reason,
    });
    res.status(409).json({ ok: false, error: code });
  }
});

export const manageAdvertisements = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requiredAdminRole: 'admin' });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const operation = String(body.operation || 'upsert').toLowerCase();
  const adId = sanitizeId(String(body.adId || ''));
  if (!adId || adId.length < 2) {
    res.status(400).json({ ok: false, error: 'Valid adId required' });
    return;
  }

  const adRef = db.collection('advertisements').doc(adId);

  try {
    if (operation === 'delete') {
      await adRef.delete();
      await writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        action: 'ad_deleted',
        targetId: adId,
        details: `Deleted advertisement ${adId}`,
      });
      res.status(200).json({ ok: true, adId, operation: 'delete' });
      return;
    }

    const adType = String(body.adType || 'rewarded');
    const rewardVerificationMethod = String(body.rewardVerificationMethod || 's2s_postback');
    const incentivizedTrafficAllowed = Boolean(body.incentivizedTrafficAllowed);
    const status = body.status === 'active' ? 'active' : 'inactive';

    if (status === 'active') {
      if (rewardVerificationMethod === 'none') {
        res.status(400).json({
          ok: false,
          error: 'Ads without server-side verification cannot be activated',
        });
        return;
      }
      if (adType === 'direct_link' && !incentivizedTrafficAllowed) {
        res.status(400).json({
          ok: false,
          error: 'Direct Link ads require explicit incentivized traffic approval',
        });
        return;
      }
    }

    const existing = await adRef.get();
    const nowServer = FieldValue.serverTimestamp();
    await adRef.set(
      {
        adId,
        adName: String(body.adName || 'Sponsored Ad').trim().slice(0, 100),
        adNetwork: String(body.adNetwork || 'Monetag').trim().slice(0, 60),
        adType: adType === 'direct_link' || adType === 'other' ? adType : 'rewarded',
        placementOrUrl: String(body.placementOrUrl || '').trim().slice(0, 500),
        rewardPoints: Math.max(0, Number(body.rewardPoints || 0)),
        dailyLimit: Math.max(1, Math.floor(Number(body.dailyLimit || 1))),
        estimatedDuration: normalizeAdDurationSeconds(body.estimatedDuration),
        startDate: String(body.startDate || '').trim().slice(0, 20),
        endDate: String(body.endDate || '').trim().slice(0, 20),
        status,
        allowedCountries: String(body.allowedCountries || 'ALL').trim().slice(0, 200),
        rewardVerificationMethod:
          rewardVerificationMethod === 'sdk_callback' || rewardVerificationMethod === 'none'
            ? rewardVerificationMethod
            : 's2s_postback',
        incentivizedTrafficAllowed,
        description: String(body.description || '').trim().slice(0, 300),
        createdAt: existing.exists ? existing.data()!.createdAt : nowServer,
        updatedAt: nowServer,
      },
      { merge: true },
    );

    await writeAdminAuditLog({
      adminUid: check.auth.uid,
      adminEmail: check.auth.email,
      action: existing.exists ? 'ad_updated' : 'ad_created',
      targetId: adId,
      details: `status=${status}, rewardPoints=${Number(body.rewardPoints || 0)}`,
    });

    res.status(200).json({ ok: true, adId, status });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'MANAGE_AD_FAILED',
    });
  }
});

export const exportDatabaseBackupSnapshot = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'super_admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const backupCollections = [
    'appSettings',
    'appConfig',
    'withdrawalSettings',
    'referralSettings',
    'paymentMethods',
    'advertisements',
    'users',
    'wallets',
    'walletLedger',
    'transactions',
    'withdrawalRequests',
    'referrals',
    'referralRewards',
    'admins',
  ];

  try {
    const snapshots = await Promise.all(
      backupCollections.map(async (colName) => {
        const snap = await db.collection(colName).limit(1000).get();
        return {
          collection: colName,
          count: snap.size,
          documents: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        };
      }),
    );

    const exportedAt = new Date().toISOString();
    await writeAdminAuditLog({
      adminUid: check.auth.uid,
      adminEmail: check.auth.email,
      action: 'database_backup_exported',
      targetId: exportedAt,
      details: `Exported ${backupCollections.length} collections snapshot.`,
    });

    res.status(200).json({
      ok: true,
      exportedAt,
      collections: snapshots,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'BACKUP_EXPORT_FAILED',
    });
  }
});

// ============================================================================
// 11. PHASE 10: ADVANCED AD NETWORK MANAGEMENT CLOUD FUNCTIONS
// ============================================================================

export const saveAdNetworkConfig = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const networkId = sanitizeId(String(body.networkId || '').trim().toLowerCase());
  const networkName = String(body.networkName || '').trim().slice(0, 80);
  if (!networkId || networkName.length < 2) {
    res.status(400).json({ ok: false, error: 'Valid networkId and networkName are required.' });
    return;
  }

  const incentivizedTrafficAllowed = Boolean(body.incentivizedTrafficAllowed);
  const rewardVerificationSupported = Boolean(body.rewardVerificationSupported);
  const requestedRewardEnabled = Boolean(body.rewardEnabled);

  if (requestedRewardEnabled && (!incentivizedTrafficAllowed || !rewardVerificationSupported)) {
    res.status(400).json({
      ok: false,
      error:
        'REWARD_POLICY_VIOLATION: Networks lacking incentivized traffic approval or reward verification support cannot enable rewards.',
    });
    return;
  }

  const enabled = Boolean(body.enabled);
  const integrationTypeRaw = String(body.integrationType || 's2s_postback');
  const integrationType =
    integrationTypeRaw === 'sdk_callback' ||
    integrationTypeRaw === 'direct_link' ||
    integrationTypeRaw === 'hybrid'
      ? integrationTypeRaw
      : 's2s_postback';

  const logoKeyRaw = String(body.logoKey || 'custom');
  const logoKey =
    logoKeyRaw === 'monetag' || logoKeyRaw === 'applixir' || logoKeyRaw === 'adsterra'
      ? logoKeyRaw
      : 'custom';

  const publisherId = String(body.publisherId || '').trim().slice(0, 120);
  const websiteId = String(body.websiteId || '').trim().slice(0, 120);
  const placementId = String(body.placementId || '').trim().slice(0, 120);
  const directLinkUrl = String(body.directLinkUrl || '').trim().slice(0, 500);
  const apiBaseUrl = String(body.apiBaseUrl || '').trim().slice(0, 300);
  const callbackUrl = String(body.callbackUrl || '').trim().slice(0, 500);
  const postbackParamsTemplate = String(body.postbackParamsTemplate || '').trim().slice(0, 400);

  const callbackSecretInput = String(body.callbackSecret || '').trim().slice(0, 256);
  const apiKeyInput = String(body.apiKey || '').trim().slice(0, 256);
  const webhookTokenInput = String(body.webhookToken || '').trim().slice(0, 256);

  try {
    const existingSecSnap = await db.collection('adNetworkSecrets').doc(networkId).get();
    const existingSec = existingSecSnap.exists ? existingSecSnap.data()! : {};

    const nextCallbackSecret = callbackSecretInput || String(existingSec.callbackSecret || '');
    const nextApiKey = apiKeyInput || String(existingSec.apiKey || '');
    const nextWebhookToken = webhookTokenInput || String(existingSec.webhookToken || '');

    if (callbackSecretInput || apiKeyInput || webhookTokenInput) {
      await db.collection('adNetworkSecrets').doc(networkId).set(
        {
          networkId,
          callbackSecret: nextCallbackSecret,
          apiKey: nextApiKey,
          webhookToken: nextWebhookToken,
          rotatedByUid: check.auth.uid,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    const appLixirEnv = networkId === 'applixir' ? getAppLixirBackendEnvStatus() : null;
    const hasSecretKey = Boolean(nextCallbackSecret || appLixirEnv?.secretKeyConfigured);
    const hasApiKey = Boolean(nextApiKey || appLixirEnv?.apiKeyConfigured);
    const secretConfigured =
      networkId === 'applixir'
        ? Boolean(hasSecretKey && hasApiKey)
        : Boolean(nextCallbackSecret || nextApiKey);
    const secretHint = nextCallbackSecret
      ? `••••${nextCallbackSecret.slice(-4)}`
      : nextApiKey
        ? `••••${nextApiKey.slice(-4)}`
        : appLixirEnv?.secretKeyConfigured && appLixirEnv?.apiKeyConfigured
          ? 'BACKEND_ENV'
          : '';

    const effectiveWebsiteId =
      websiteId || (networkId === 'applixir' ? (process.env.APPLIXIR_SITE_ID || '').trim() : '');

    const health = resolveNetworkHealthStatus({
      enabled,
      publisherId,
      websiteId: effectiveWebsiteId,
      placementId,
      integrationType,
      rewardVerificationSupported,
      secretConfigured,
    });

    const nowServer = FieldValue.serverTimestamp();
    await db.collection('adNetworks').doc(networkId).set(
      {
        networkId,
        networkName,
        logoKey,
        integrationType,
        publisherId,
        websiteId,
        placementId,
        directLinkUrl,
        apiBaseUrl,
        callbackUrl,
        postbackParamsTemplate,
        incentivizedTrafficAllowed,
        rewardVerificationSupported,
        rewardEnabled: requestedRewardEnabled,
        clicksSupported: Boolean(body.clicksSupported),
        apiHealthSupported: Boolean(body.apiHealthSupported),
        secretConfigured,
        secretHint,
        healthStatus: health.status,
        healthMessage: health.message.slice(0, 300),
        enabled,
        lastTestedAt: new Date().toISOString(),
        updatedAt: nowServer,
      },
      { merge: true },
    );

    await Promise.all([
      writeAdNetworkLog({
        networkId,
        actorUid: check.auth.uid,
        actorEmail: check.auth.email,
        eventType: 'network_config_saved',
        severity: 'info',
        status: health.status,
        details: `Saved config for ${networkName} (enabled=${enabled}, rewardEnabled=${requestedRewardEnabled}, secretConfigured=${secretConfigured})`,
      }),
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        action: 'ad_network_config_updated',
        targetId: networkId,
        newValue: `enabled=${enabled}, health=${health.status}`,
        details: `Updated Ad Network ${networkName} (${networkId})`,
      }),
    ]);

    res.status(200).json({
      ok: true,
      networkId,
      secretConfigured,
      healthStatus: health.status,
      healthMessage: health.message,
      ...(appLixirEnv ? { envCredentials: appLixirEnv } : {}),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'SAVE_AD_NETWORK_FAILED',
    });
  }
});

export const testAdNetworkConnection = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const networkId = sanitizeId(String(body.networkId || '').trim().toLowerCase());
  if (!networkId) {
    res.status(400).json({ ok: false, error: 'networkId is required' });
    return;
  }

  try {
    const [netSnap, secSnap, cbSnap] = await Promise.all([
      db.collection('adNetworks').doc(networkId).get(),
      db.collection('adNetworkSecrets').doc(networkId).get(),
      db
        .collection('adCallbacks')
        .where('networkId', '==', networkId)
        .where('status', '==', 'processed')
        .limit(1)
        .get(),
    ]);

    if (!netSnap.exists) {
      res.status(404).json({ ok: false, error: 'AD_NETWORK_NOT_FOUND' });
      return;
    }

    const net = netSnap.data()!;
    const sec = secSnap.exists ? secSnap.data()! : {};
    const appLixirEnv = networkId === 'applixir' ? getAppLixirBackendEnvStatus() : null;
    const secretConfigured =
      networkId === 'applixir'
        ? Boolean(
            (sec.callbackSecret || appLixirEnv?.secretKeyConfigured) &&
              (sec.apiKey || appLixirEnv?.apiKeyConfigured),
          )
        : Boolean(sec.callbackSecret || sec.apiKey || net.secretConfigured);
    const hasVerifiedCallbacks = !cbSnap.empty;

    let apiCheckOk: boolean | null = null;
    let apiCheckError = '';

    const apiBaseUrl = String(net.apiBaseUrl || '').trim();
    const apiKey = String(
      sec.apiKey || (networkId === 'applixir' ? process.env.APPLIXIR_API_KEY || '' : ''),
    ).trim();
    if (apiBaseUrl && /^https:\/\/[a-zA-Z0-9.-]+/.test(apiBaseUrl) && apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(apiBaseUrl, {
          method: 'HEAD',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (resp.ok || resp.status === 405) {
          apiCheckOk = true;
        } else {
          apiCheckOk = false;
          apiCheckError = `Provider endpoint returned HTTP ${resp.status}`;
        }
      } catch (fetchErr) {
        apiCheckOk = false;
        apiCheckError =
          fetchErr instanceof Error ? fetchErr.message : 'Provider API endpoint unreachable';
      }
    }

    const effectiveWebsiteId =
      String(net.websiteId || '') ||
      (networkId === 'applixir' ? (process.env.APPLIXIR_SITE_ID || '').trim() : '');

    const resolved = resolveNetworkHealthStatus({
      enabled: Boolean(net.enabled),
      publisherId: String(net.publisherId || ''),
      websiteId: effectiveWebsiteId,
      placementId: String(net.placementId || ''),
      integrationType: String(net.integrationType || 's2s_postback'),
      rewardVerificationSupported: Boolean(net.rewardVerificationSupported),
      secretConfigured,
      apiCheckOk,
      apiCheckError,
      hasVerifiedCallbacks,
    });

    const testedAt = new Date().toISOString();
    await Promise.all([
      db.collection('adNetworks').doc(networkId).update({
        healthStatus: resolved.status,
        healthMessage: resolved.message.slice(0, 300),
        secretConfigured,
        ...(appLixirEnv &&
        appLixirEnv.secretKeyConfigured &&
        appLixirEnv.apiKeyConfigured &&
        !net.secretHint
          ? { secretHint: 'BACKEND_ENV' }
          : {}),
        lastTestedAt: testedAt,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      writeAdNetworkLog({
        networkId,
        actorUid: check.auth.uid,
        actorEmail: check.auth.email,
        eventType: 'network_health_checked',
        severity: resolved.status === 'error' ? 'error' : resolved.status === 'connected' ? 'info' : 'warning',
        status: resolved.status,
        details: resolved.message,
      }),
    ]);

    res.status(200).json({
      ok: true,
      networkId,
      healthStatus: resolved.status,
      healthMessage: resolved.message,
      testedAt,
      ...(appLixirEnv ? { envCredentials: appLixirEnv } : {}),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'CONNECTION_TEST_FAILED',
    });
  }
});

export const manageAdCampaign = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const operation = String(body.operation || 'upsert');
  const campaignId = sanitizeId(String(body.campaignId || '').trim());
  if (!campaignId) {
    res.status(400).json({ ok: false, error: 'Valid campaignId is required.' });
    return;
  }

  const campRef = db.collection('adCampaigns').doc(campaignId);

  try {
    if (operation === 'delete') {
      await campRef.delete();
      await writeAdNetworkLog({
        networkId: sanitizeId(String(body.networkId || 'unknown')),
        actorUid: check.auth.uid,
        actorEmail: check.auth.email,
        eventType: 'campaign_deleted',
        severity: 'warning',
        details: `Deleted campaign ${campaignId}`,
      });
      res.status(200).json({ ok: true, campaignId, operation: 'delete' });
      return;
    }

    const campaignTypeRaw = String(body.campaignType || 'rewarded');
    const campaignType =
      campaignTypeRaw === 'direct_link' || campaignTypeRaw === 'other' ? campaignTypeRaw : 'rewarded';
    const rewardMethodRaw = String(body.rewardVerificationMethod || 's2s_postback');
    const rewardVerificationMethod =
      rewardMethodRaw === 'sdk_callback' || rewardMethodRaw === 'none'
        ? rewardMethodRaw
        : 's2s_postback';
    const incentivizedTrafficAllowed = Boolean(body.incentivizedTrafficAllowed);
    const rewardEligible =
      Boolean(body.rewardEligible) &&
      incentivizedTrafficAllowed &&
      rewardVerificationMethod !== 'none' &&
      (campaignType !== 'direct_link' || incentivizedTrafficAllowed);

    const requestedPoints = Math.max(0, Math.floor(Number(body.rewardPoints || 0)));
    if (requestedPoints > 0 && !rewardEligible) {
      res.status(400).json({
        ok: false,
        error:
          'CAMPAIGN_POLICY_VIOLATION: Reward points cannot be enabled without incentivized traffic approval and server verification.',
      });
      return;
    }

    const networkId = sanitizeId(String(body.networkId || 'monetag'));
    const networkName = String(body.networkName || 'Monetag').trim().slice(0, 80);
    const status = body.status === 'active' ? 'active' : 'inactive';

    await campRef.set(
      {
        campaignId,
        campaignName: String(body.campaignName || 'Sponsored Campaign').trim().slice(0, 100),
        networkId,
        networkName,
        placementId: String(body.placementId || '').trim().slice(0, 80),
        campaignType,
        rewardPoints: rewardEligible ? requestedPoints : 0,
        dailyUserLimit: Math.max(1, Math.floor(Number(body.dailyUserLimit || 1))),
        globalDailyLimit: Math.max(1, Math.floor(Number(body.globalDailyLimit || 100))),
        estimatedDuration: normalizeAdDurationSeconds(body.estimatedDuration),
        startDate: String(body.startDate || '').trim().slice(0, 20),
        endDate: String(body.endDate || '').trim().slice(0, 20),
        targetCountries: String(body.targetCountries || 'ALL').trim().slice(0, 120),
        rewardVerificationMethod,
        incentivizedTrafficAllowed,
        rewardEligible,
        status,
        linkedAdId: String(body.linkedAdId || '').trim().slice(0, 80),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    await writeAdNetworkLog({
      networkId,
      actorUid: check.auth.uid,
      actorEmail: check.auth.email,
      eventType: 'campaign_saved',
      severity: 'info',
      status,
      details: `Saved campaign ${campaignId} (rewardEligible=${rewardEligible}, rewardPoints=${rewardEligible ? requestedPoints : 0})`,
    });

    res.status(200).json({ ok: true, campaignId, status, rewardEligible });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'MANAGE_CAMPAIGN_FAILED',
    });
  }
});

export const getAdNetworkAnalyticsSummary = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'support_admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  try {
    const [networksSnap, analyticsSnap, callbacksSnap] = await Promise.all([
      db.collection('adNetworks').get(),
      db.collection('adAnalytics').get(),
      db.collection('adCallbacks').orderBy('createdAt', 'desc').limit(100).get(),
    ]);

    res.status(200).json({
      ok: true,
      networksCount: networksSnap.size,
      analytics: analyticsSnap.docs.map((d) => d.data()),
      recentCallbacksCount: callbacksSnap.size,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'ANALYTICS_SUMMARY_FAILED',
    });
  }
});

// ============================================================================
// 8. PHASE 11: AUTH SECURITY TELEMETRY, RATE LIMITING & FRAUD REVIEW ACTIONS
// ============================================================================

export const recordAuthSecurityEvent = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawEventType = String(body.eventType || '').trim();
  const validEvents = [
    'login_success',
    'login_failed',
    'registration_completed',
    'password_reset_requested',
  ] as const;
  if (!validEvents.includes(rawEventType as (typeof validEvents)[number])) {
    res.status(400).json({ ok: false, error: 'Invalid auth security eventType' });
    return;
  }

  const ipHash = hashNetworkIdentifier(req);
  const authHeader = String(req.headers.authorization || '');
  let verifiedUid = '';
  let verifiedEmail = '';

  if (authHeader.startsWith('Bearer ')) {
    const check = await verifyAuthAndRole(req);
    if (check.auth) {
      verifiedUid = check.auth.uid;
      verifiedEmail = check.auth.email;
    }
  }

  const rate = await enforceRateLimit({
    bucketKey: `auth_${rawEventType}_${verifiedUid || ipHash}`,
    actionName: `auth:${rawEventType}`,
    actorId: verifiedUid || ipHash,
    maxRequests: rawEventType === 'login_failed' ? 12 : 25,
    windowSeconds: 600,
  });

  if (!rate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: rate.retryAfterSec,
    });
    return;
  }

  const emailHint = String(verifiedEmail || body.emailHint || '').trim().slice(0, 120);
  const maskedEmail = emailHint.includes('@')
    ? `${emailHint.slice(0, 2)}***@${emailHint.split('@')[1]}`
    : 'anonymous';

  try {
    await writeSecurityAuditLog({
      userId: verifiedUid || `ip_${ipHash}`,
      eventType: rawEventType,
      category: 'auth',
      severity: rawEventType === 'login_failed' ? 'low' : 'info',
      details: `${rawEventType} for ${maskedEmail}`,
      metadata: `ipHash=${ipHash}`,
    });

    if (verifiedUid) {
      const userSnap = await db.collection('users').doc(verifiedUid).get();
      const userData = userSnap.exists ? userSnap.data()! : {};
      await evaluateAuthSecuritySignals({
        userId: verifiedUid,
        email: verifiedEmail || String(userData.email || ''),
        fullName: String(userData.fullName || ''),
        phoneNumber: String(userData.phoneNumber || ''),
        eventType: rawEventType as (typeof validEvents)[number],
        ipHash,
        burstCount: rate.count,
      });
    }

    res.status(200).json({ ok: true, remaining: rate.remaining });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'AUTH_EVENT_LOG_FAILED',
    });
  }
});

export const reviewFraudReport = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reportId = sanitizeId(String(body.reportId || ''));
  const action = String(body.action || '').toLowerCase();
  const resolutionNote = String(body.resolutionNote || '').trim().slice(0, 400);

  const validActions = [
    'mark_reviewed',
    'request_verification',
    'temporarily_restrict',
    'suspend',
    'restore',
  ];
  if (!reportId || !validActions.includes(action)) {
    res.status(400).json({ ok: false, error: 'Valid reportId and action are required' });
    return;
  }

  const reportRef = db.collection('fraudReports').doc(reportId);
  const nowServer = FieldValue.serverTimestamp();

  try {
    const snap = await reportRef.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, error: 'FRAUD_REPORT_NOT_FOUND' });
      return;
    }

    const report = snap.data()!;
    const targetUid = sanitizeId(String(report.userId || ''));

    let nextReviewStatus: FraudReviewStatus = 'reviewed';
    let nextAccountStatus: 'active' | 'restricted' | 'suspended' | null = null;
    let actionLabel = 'Marked as Reviewed';
    let notifTitle = '';
    let notifMessage = '';

    if (action === 'request_verification') {
      nextReviewStatus = 'verification_requested';
      actionLabel = 'Verification Requested';
      notifTitle = 'Account Security Verification Notice';
      notifMessage =
        resolutionNote ||
        'Our security team flagged unusual account activity for review. Please contact Support from your Profile to confirm your account details.';
    } else if (action === 'temporarily_restrict') {
      nextReviewStatus = 'restricted';
      nextAccountStatus = 'restricted';
      actionLabel = 'Temporarily Restricted';
      notifTitle = 'Account Temporarily Restricted';
      notifMessage =
        resolutionNote ||
        'Your account has been placed under temporary security review. Contact Support to verify and restore access.';
    } else if (action === 'suspend') {
      nextReviewStatus = 'suspended';
      nextAccountStatus = 'suspended';
      actionLabel = 'Account Suspended';
    } else if (action === 'restore') {
      nextReviewStatus = 'restored';
      nextAccountStatus = 'active';
      actionLabel = 'Account Restored';
      notifTitle = 'Account Access Restored';
      notifMessage =
        resolutionNote ||
        'Security review completed. Your AdView Earn account has been restored to active status.';
    }

    await reportRef.update({
      reviewStatus: nextReviewStatus,
      actionTaken: actionLabel,
      reviewedBy: check.auth.uid,
      reviewedEmail: check.auth.email,
      resolutionNote,
      updatedAt: nowServer,
    });

    if (targetUid && nextAccountStatus) {
      const userRef = db.collection('users').doc(targetUid);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        await userRef.update({ accountStatus: nextAccountStatus });
        if (nextAccountStatus !== 'active') {
          await adminAuth.revokeRefreshTokens(targetUid).catch(() => {});
        }
      }
    }

    if (targetUid && notifTitle) {
      const notifId = sanitizeId(`notif_fr_${reportId}_${Date.now()}`);
      await db
        .collection('notifications')
        .doc(notifId)
        .set({
          userId: targetUid,
          title: notifTitle,
          message: notifMessage.slice(0, 300),
          read: false,
          createdAt: nowServer,
        })
        .catch(() => {});
    }

    await Promise.all([
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        adminRole: check.auth.adminRole,
        action: `fraud_report_${action}`,
        targetId: reportId,
        previousValue: String(report.reviewStatus || 'pending_review'),
        newValue: nextReviewStatus,
        metadata: extractRequestMetadata(req),
        details: `${actionLabel} on ${reportId} (user=${targetUid || 'n/a'}). ${resolutionNote}`,
      }),
      writeSecurityAuditLog({
        userId: targetUid || check.auth.uid,
        eventType: `fraud_${action}`,
        category: nextAccountStatus ? 'account_restriction' : 'security',
        severity:
          action === 'suspend' || action === 'temporarily_restrict' ? 'high' : 'info',
        riskScore: Number(report.riskScore || 0),
        details: `Admin ${check.auth.email} executed ${actionLabel} on report ${reportId}. ${resolutionNote}`,
      }),
    ]);

    res.status(200).json({
      ok: true,
      reportId,
      reviewStatus: nextReviewStatus,
      accountStatus: nextAccountStatus,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'FRAUD_REVIEW_FAILED',
    });
  }
});

// ============================================================================
// 9. DAILY CHECK-IN BONUS MONETAG DIRECT LINK SESSION & ADMIN SETTINGS
// ============================================================================

function buildServerDailyBonusLaunchUrl(
  rawUrl: string,
  sessionId: string,
  userId: string,
): string | null {
  const trimmed = rawUrl.trim();
  if (!/^https:\/\/.+/i.test(trimmed)) return null;
  try {
    const resolved = trimmed
      .replace(/\{sessionId\}|\{session_id\}|\{ymid\}/gi, encodeURIComponent(sessionId))
      .replace(/\{userId\}|\{user_id\}|\{subid\}/gi, encodeURIComponent(userId))
      .replace(/\{adId\}|\{ad_id\}/gi, encodeURIComponent(DAILY_CHECKIN_BONUS_AD_ID));
    const url = new URL(resolved);
    if (url.protocol !== 'https:') return null;
    if (!url.searchParams.has('session_id')) url.searchParams.set('session_id', sessionId);
    if (!url.searchParams.has('ymid')) url.searchParams.set('ymid', sessionId);
    if (!url.searchParams.has('subid')) url.searchParams.set('subid', userId);
    return url.toString();
  } catch {
    return null;
  }
}

export const startDailyBonusSession = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, { requireVerifiedEmail: true });
  if (!check.auth) {
    res.status(check.status || 401).json({ ok: false, error: check.error });
    return;
  }

  const uid = check.auth.uid;
  const bonusRate = await enforceRateLimit({
    bucketKey: `daily_bonus_sess_${uid}`,
    actionName: 'startDailyBonusSession',
    actorId: uid,
    maxRequests: 10,
    windowSeconds: 60,
  });
  if (!bonusRate.allowed) {
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfterSec: bonusRate.retryAfterSec,
    });
    return;
  }

  const dhakaToday = getDhakaDateKey();
  const randomToken = crypto.randomBytes(6).toString('hex');
  const sessionId = sanitizeId(`bonus_${Date.now()}_${uid.slice(0, 6)}_${randomToken}`);

  try {
    const [settings, userSnap, dailyBonusSnap, bonusCfgSnap, monetagNetSnap] = await Promise.all([
      readActiveAppSettings(),
      db.collection('users').doc(uid).get(),
      db.collection('dailyBonuses').doc(uid).get(),
      db.collection('appSettings').doc('dailyBonus').get(),
      db.collection('adNetworks').doc('monetag').get(),
    ]);

    if (!settings.earningEnabled) {
      res.status(403).json({ ok: false, error: 'EARNING_DISABLED' });
      return;
    }
    if (!userSnap.exists || userSnap.data()!.accountStatus !== 'active') {
      res.status(403).json({ ok: false, error: 'USER_NOT_ACTIVE' });
      return;
    }

    const lastClaimDate = dailyBonusSnap.exists
      ? String(dailyBonusSnap.data()!.lastClaimDate || '')
      : '';
    if (lastClaimDate === dhakaToday) {
      res.status(409).json({ ok: false, error: 'DAILY_BONUS_ALREADY_CLAIMED' });
      return;
    }

    if (!bonusCfgSnap.exists) {
      res.status(412).json({ ok: false, error: 'DAILY_BONUS_NOT_CONFIGURED' });
      return;
    }
    const cfg = bonusCfgSnap.data()!;
    if (cfg.enabled !== true) {
      res.status(403).json({ ok: false, error: 'DAILY_BONUS_DISABLED' });
      return;
    }
    if (cfg.incentivizedTrafficAllowed !== true) {
      res.status(403).json({ ok: false, error: 'INCENTIVIZED_TRAFFIC_DISALLOWED' });
      return;
    }

    const rawUrl = String(cfg.monetagDirectLinkUrl || '').trim();
    const launchUrl = buildServerDailyBonusLaunchUrl(rawUrl, sessionId, uid);
    if (!launchUrl) {
      res.status(412).json({ ok: false, error: 'DAILY_BONUS_NOT_CONFIGURED' });
      return;
    }

    const rewardPoints = Math.max(
      0,
      Math.floor(Number(cfg.rewardPoints || settings.dailyBonusPoints || 0)),
    );
    if (rewardPoints <= 0) {
      res.status(412).json({ ok: false, error: 'DAILY_BONUS_NOT_CONFIGURED' });
      return;
    }

    if (monetagNetSnap.exists) {
      const mNet = monetagNetSnap.data()!;
      if (mNet.enabled === false) {
        res.status(403).json({ ok: false, error: 'NETWORK_DISABLED' });
        return;
      }
      if (mNet.rewardEnabled === false || mNet.incentivizedTrafficAllowed !== true) {
        res.status(403).json({ ok: false, error: 'NETWORK_REWARD_NOT_ELIGIBLE' });
        return;
      }
    }

    const durationSeconds = normalizeAdDurationSeconds(cfg.durationSeconds);

    await db.collection('adSessions').doc(sessionId).create({
      sessionId,
      userId: uid,
      adId: DAILY_CHECKIN_BONUS_AD_ID,
      adName: 'Daily Check-in Bonus',
      adNetwork: 'Monetag',
      expectedRewardPoints: rewardPoints,
      dhakaDate: dhakaToday,
      status: 'pending',
      transactionId: '',
      rejectionReason: '',
      createdAt: FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      ok: true,
      sessionId,
      adId: DAILY_CHECKIN_BONUS_AD_ID,
      dhakaDate: dhakaToday,
      rewardPoints,
      durationSeconds,
      launchUrl,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'START_DAILY_BONUS_SESSION_FAILED',
    });
  }
});

export const updateDailyBonusAdSettings = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const check = await verifyAuthAndRole(req, {
    requireVerifiedEmail: true,
    requiredAdminRole: 'admin',
  });
  if (!check.auth) {
    res.status(check.status || 403).json({ ok: false, error: check.error });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const enabled = body.enabled === true;
  const incentivizedTrafficAllowed = body.incentivizedTrafficAllowed === true;
  const monetagDirectLinkUrl = String(body.monetagDirectLinkUrl || '').trim().slice(0, 500);
  const rawReward = Number(body.rewardPoints ?? 0);
  const rewardPoints =
    Number.isFinite(rawReward) && rawReward >= 1 ? Math.floor(rawReward) : 0;
  const durationSeconds = normalizeAdDurationSeconds(body.durationSeconds);

  if (monetagDirectLinkUrl && !/^https:\/\/.+/i.test(monetagDirectLinkUrl)) {
    res.status(400).json({
      ok: false,
      error: 'Monetag Direct Link URL must start with https://',
    });
    return;
  }

  if (enabled) {
    if (!/^https:\/\/.+/i.test(monetagDirectLinkUrl)) {
      res.status(400).json({
        ok: false,
        error: 'Enter a valid HTTPS Monetag Direct Link URL before enabling.',
      });
      return;
    }
    if (rewardPoints < 1) {
      res.status(400).json({
        ok: false,
        error: 'Daily Bonus Reward Points must be at least 1.',
      });
      return;
    }
    if (!incentivizedTrafficAllowed) {
      res.status(400).json({
        ok: false,
        error: 'Monetag Incentivized Traffic approval confirmation is required when enabled.',
      });
      return;
    }
  }

  const nowServer = FieldValue.serverTimestamp();
  const dailyBonusRef = db.collection('appSettings').doc('dailyBonus');

  try {
    const prevSnap = await dailyBonusRef.get();
    const prev = prevSnap.exists ? prevSnap.data()! : {};

    const payload = {
      enabled,
      monetagDirectLinkUrl,
      rewardPoints,
      durationSeconds,
      incentivizedTrafficAllowed,
      updatedAt: nowServer,
    };

    const ops: Array<Promise<unknown>> = [
      dailyBonusRef.set(payload, { merge: true }),
      writeAdminAuditLog({
        adminUid: check.auth.uid,
        adminEmail: check.auth.email,
        adminRole: check.auth.adminRole,
        action: 'daily_bonus_settings_updated',
        targetId: 'dailyBonus',
        previousValue: `enabled=${Boolean(prev.enabled)}, pts=${Number(prev.rewardPoints || 0)}, sec=${Number(prev.durationSeconds || 30)}`,
        newValue: `enabled=${enabled}, pts=${rewardPoints}, sec=${durationSeconds}`,
        metadata: extractRequestMetadata(req),
        details: `Updated Daily Check-in Bonus Monetag Direct Link config (enabled=${enabled}, reward=${rewardPoints} Pts, duration=${durationSeconds}s)`,
      }),
    ];

    if (rewardPoints >= 1) {
      ops.push(
        db
          .collection('appSettings')
          .doc('wallet')
          .set({ dailyBonusPoints: rewardPoints, updatedAt: nowServer }, { merge: true }),
        db
          .collection('appConfig')
          .doc('economy')
          .set({ dailyBonusPoints: rewardPoints, updatedAt: nowServer }, { merge: true }),
      );
    }

    await Promise.all(ops);
    res.status(200).json({
      ok: true,
      config: {
        enabled,
        monetagDirectLinkUrl,
        rewardPoints,
        durationSeconds,
        incentivizedTrafficAllowed,
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'DAILY_BONUS_SETTINGS_UPDATE_FAILED',
    });
  }
});
