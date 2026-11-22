import * as crypto from 'crypto';
import type { Request } from 'firebase-functions/v2/https';
import { db, FieldValue, sanitizeId } from './helpers';

export type FraudCategory =
  | 'multi_account'
  | 'ad_reward'
  | 'referral'
  | 'withdrawal'
  | 'auth_security';

export type FraudRiskLevel = 'low' | 'medium' | 'high';

export type FraudReviewStatus =
  | 'pending_review'
  | 'reviewed'
  | 'verification_requested'
  | 'restricted'
  | 'suspended'
  | 'restored';

export type SecurityAuditCategory =
  | 'auth'
  | 'wallet'
  | 'ad_reward'
  | 'withdrawal'
  | 'referral'
  | 'admin'
  | 'account_restriction'
  | 'security';

export type SecuritySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskFactor {
  signal: string;
  weight: number;
}

export interface RiskAssessmentResult {
  riskScore: number;
  riskLevel: FraudRiskLevel;
  signals: string[];
  requiresAdminReview: boolean;
  falsePositiveProtected: true;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  count: number;
}

export function hashNetworkIdentifier(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const rawIp = forwarded || String(req.ip || 'unknown');
  if (!rawIp || rawIp === 'unknown') return 'anon';
  return crypto.createHash('sha256').update(`adview_rl_${rawIp}`).digest('hex').slice(0, 16);
}

/**
 * Cumulative Risk Scoring Engine with False-Positive Protection:
 * - Never triggers permanent ban from a single signal or same IP alone.
 * - High risk (>= 70) flags for Admin Review (`requiresAdminReview = true`)
 *   rather than silently deleting/confiscating legitimate user points.
 */
export function evaluateRiskFactors(factors: RiskFactor[]): RiskAssessmentResult {
  let rawScore = 0;
  const signals: string[] = [];

  for (const factor of factors) {
    if (factor.weight > 0) {
      rawScore += factor.weight;
      signals.push(factor.signal.slice(0, 140));
    }
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const riskLevel: FraudRiskLevel =
    riskScore >= 70 ? 'high' : riskScore >= 35 ? 'medium' : 'low';

  return {
    riskScore,
    riskLevel,
    signals,
    requiresAdminReview: riskScore >= 35,
    falsePositiveProtected: true,
  };
}

/**
 * Atomic Firestore-backed rate limiter (`rateLimits/{bucketKey}`).
 * Clients have zero read/write access to `rateLimits` in firestore.rules.
 */
export async function enforceRateLimit(params: {
  bucketKey: string;
  actionName: string;
  actorId: string;
  maxRequests: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const safeKey = sanitizeId(params.bucketKey).slice(0, 120);
  const ref = db.collection('rateLimits').doc(safeKey);
  const nowMs = Date.now();
  const windowMs = Math.max(1, params.windowSeconds) * 1000;

  const outcome = await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (!snap.exists) {
      txn.set(ref, {
        bucketKey: safeKey,
        actionName: params.actionName.slice(0, 80),
        actorId: String(params.actorId || 'anonymous').slice(0, 128),
        windowStartedAtMs: nowMs,
        count: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        allowed: true,
        remaining: Math.max(0, params.maxRequests - 1),
        retryAfterSec: params.windowSeconds,
        count: 1,
      };
    }

    const data = snap.data()!;
    const windowStart = Number(data.windowStartedAtMs || 0);
    const elapsed = nowMs - windowStart;

    if (elapsed >= windowMs) {
      txn.set(ref, {
        bucketKey: safeKey,
        actionName: params.actionName.slice(0, 80),
        actorId: String(params.actorId || 'anonymous').slice(0, 128),
        windowStartedAtMs: nowMs,
        count: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        allowed: true,
        remaining: Math.max(0, params.maxRequests - 1),
        retryAfterSec: params.windowSeconds,
        count: 1,
      };
    }

    const nextCount = Number(data.count || 0) + 1;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));

    txn.update(ref, {
      count: nextCount,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      allowed: nextCount <= params.maxRequests,
      remaining: Math.max(0, params.maxRequests - nextCount),
      retryAfterSec,
      count: nextCount,
    };
  });

  if (!outcome.allowed && outcome.count === params.maxRequests + 1) {
    await writeSecurityAuditLog({
      userId: params.actorId || 'anonymous',
      eventType: 'rate_limit_exceeded',
      category: 'security',
      severity: 'medium',
      riskScore: 45,
      details: `Rate limit hit for ${params.actionName} (${outcome.count}/${params.maxRequests} in ${params.windowSeconds}s)`,
    });
  }

  return outcome;
}

/**
 * Appends an immutable audit entry to `securityAuditLogs/{logId}`.
 */
export async function writeSecurityAuditLog(params: {
  userId: string;
  eventType: string;
  category: SecurityAuditCategory;
  severity: SecuritySeverity;
  transactionId?: string;
  riskScore?: number | null;
  details: string;
  metadata?: string;
}): Promise<string> {
  const logId = sanitizeId(
    `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  await db
    .collection('securityAuditLogs')
    .doc(logId)
    .set({
      logId,
      userId: String(params.userId || 'system').slice(0, 128),
      eventType: String(params.eventType || 'security_event').slice(0, 80),
      category: params.category,
      severity: params.severity,
      ...(params.transactionId
        ? { transactionId: String(params.transactionId).slice(0, 128) }
        : {}),
      ...(typeof params.riskScore === 'number'
        ? { riskScore: Math.max(0, Math.min(100, Math.round(params.riskScore))) }
        : {}),
      details: String(params.details || '').slice(0, 500),
      ...(params.metadata
        ? { metadata: String(params.metadata).slice(0, 400) }
        : {}),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => {});

  return logId;
}

/**
 * Queues a structured, false-positive-protected fraud alert for Admin Review.
 */
export async function createFraudReport(params: {
  category: FraudCategory;
  assessment: RiskAssessmentResult;
  userId: string;
  userEmail?: string;
  userName?: string;
  title: string;
  details: string;
  relatedTxId?: string;
  actionTaken?: string;
}): Promise<string> {
  const reportId = sanitizeId(
    `fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const nowServer = FieldValue.serverTimestamp();

  await db
    .collection('fraudReports')
    .doc(reportId)
    .set({
      reportId,
      category: params.category,
      riskLevel: params.assessment.riskLevel,
      riskScore: params.assessment.riskScore,
      reviewStatus: 'pending_review',
      userId: String(params.userId || 'unknown').slice(0, 128),
      userEmail: String(params.userEmail || '').slice(0, 120),
      userName: String(params.userName || '').slice(0, 80),
      title: String(params.title || 'Suspicious Activity Alert').slice(0, 140),
      details: String(params.details || '').slice(0, 600),
      signals: params.assessment.signals.slice(0, 20),
      relatedTxId: String(params.relatedTxId || '').slice(0, 128),
      actionTaken: String(params.actionTaken || 'Flagged for Admin Review').slice(0, 120),
      reviewedBy: '',
      reviewedEmail: '',
      resolutionNote: '',
      falsePositiveProtected: true,
      createdAt: nowServer,
      updatedAt: nowServer,
    })
    .catch(() => {});

  return reportId;
}

/**
 * Checks whether a withdrawal payout `accountNumber` has been used across multiple
 * distinct user accounts, combined with behavioral signals (rapid bursts, new account spikes).
 * Never auto-bans — flags to `fraudReports` with Risk Score for Admin Review.
 */
export async function evaluateWithdrawalFraudSignals(params: {
  userId: string;
  userEmail: string;
  userName: string;
  accountNumber: string;
  methodId: string;
  amountBdt: number;
  requestId: string;
  transactionId: string;
  userCreatedAtMs?: number;
  todayCount: number;
}): Promise<RiskAssessmentResult> {
  const factors: RiskFactor[] = [];

  try {
    const sharedSnap = await db
      .collection('withdrawalRequests')
      .where('accountNumber', '==', params.accountNumber)
      .limit(20)
      .get();

    const distinctOtherUsers = new Set<string>();
    sharedSnap.forEach((d) => {
      const uid = String(d.data().userId || '');
      if (uid && uid !== params.userId) {
        distinctOtherUsers.add(uid);
      }
    });

    if (distinctOtherUsers.size >= 1) {
      const extraCount = distinctOtherUsers.size;
      factors.push({
        signal: `Shared ${params.methodId.toUpperCase()} payout account across ${extraCount + 1} accounts`,
        weight: extraCount >= 2 ? 70 : 45,
      });
    }
  } catch {
    // Non-blocking lookup
  }

  if (params.userCreatedAtMs && params.userCreatedAtMs > 0) {
    const accountAgeHours = (Date.now() - params.userCreatedAtMs) / 3_600_000;
    if (accountAgeHours < 24 && params.amountBdt >= 200) {
      factors.push({
        signal: `New account (${accountAgeHours.toFixed(1)}h old) requested ৳${params.amountBdt.toFixed(0)} payout`,
        weight: 30,
      });
    }
  }

  if (params.todayCount >= 2) {
    factors.push({
      signal: `Multiple withdrawal attempts in same Dhaka day (${params.todayCount + 1})`,
      weight: 20,
    });
  }

  const assessment = evaluateRiskFactors(factors);
  if (assessment.requiresAdminReview) {
    await Promise.all([
      createFraudReport({
        category: factors.some((f) => f.signal.includes('Shared'))
          ? 'multi_account'
          : 'withdrawal',
        assessment,
        userId: params.userId,
        userEmail: params.userEmail,
        userName: params.userName,
        title: `Withdrawal Review Required (${params.methodId.toUpperCase()} ৳${params.amountBdt})`,
        details: `Withdrawal ${params.requestId} queued for review. Signals: ${assessment.signals.join('; ')}`,
        relatedTxId: params.transactionId,
        actionTaken: 'Queued for Admin Review (funds reserved safely)',
      }),
      writeSecurityAuditLog({
        userId: params.userId,
        eventType: 'suspicious_withdrawal_flagged',
        category: 'withdrawal',
        severity: assessment.riskLevel === 'high' ? 'high' : 'medium',
        transactionId: params.transactionId,
        riskScore: assessment.riskScore,
        details: `Withdrawal ${params.requestId} flagged (${assessment.riskScore}/100): ${assessment.signals.join('; ')}`,
      }),
    ]);
  }

  return assessment;
}

/**
 * Evaluates multi-account signals during auth registration/login without
 * collecting invasive device fingerprints or auto-banning solely by IP.
 */
export async function evaluateAuthSecuritySignals(params: {
  userId: string;
  email: string;
  fullName: string;
  phoneNumber?: string;
  eventType: 'login_success' | 'login_failed' | 'registration_completed' | 'password_reset_requested';
  ipHash: string;
  burstCount: number;
}): Promise<RiskAssessmentResult> {
  const factors: RiskFactor[] = [];

  if (params.burstCount >= 6) {
    factors.push({
      signal: `Unusual auth request velocity (${params.burstCount} events in 10m window)`,
      weight: params.eventType === 'registration_completed' ? 45 : 30,
    });
  }

  if (
    params.eventType === 'registration_completed' &&
    params.phoneNumber &&
    params.phoneNumber.trim().length >= 6
  ) {
    try {
      const phoneSnap = await db
        .collection('users')
        .where('phoneNumber', '==', params.phoneNumber.trim())
        .limit(10)
        .get();
      const otherUsers = phoneSnap.docs.filter((d) => d.id !== params.userId);
      if (otherUsers.length >= 1) {
        factors.push({
          signal: `Phone number associated with ${otherUsers.length + 1} accounts`,
          weight: otherUsers.length >= 2 ? 65 : 40,
        });
      }
    } catch {
      // Non-blocking lookup
    }
  }

  const assessment = evaluateRiskFactors(factors);
  if (assessment.requiresAdminReview) {
    await createFraudReport({
      category: factors.some((f) => f.signal.includes('Phone'))
        ? 'multi_account'
        : 'auth_security',
      assessment,
      userId: params.userId,
      userEmail: params.email,
      userName: params.fullName,
      title:
        params.eventType === 'registration_completed'
          ? 'Multi-Account / Registration Burst Signal'
          : 'Unusual Authentication Velocity Signal',
      details: `Auth event ${params.eventType} triggered signals: ${assessment.signals.join('; ')}`,
      actionTaken: 'Queued for Admin Review (No automatic ban applied)',
    });
  }

  return assessment;
}

/**
 * Evaluates referral rings (shared phone number between referrer & referred or rapid referral spikes).
 */
export async function evaluateReferralFraudSignals(params: {
  referrerUid: string;
  referredUid: string;
  referrerPhone?: string;
  referredPhone?: string;
  referrerRecent24hCount: number;
}): Promise<RiskAssessmentResult> {
  const factors: RiskFactor[] = [];

  if (params.referrerUid === params.referredUid) {
    factors.push({ signal: 'Self-referral attempt blocked', weight: 85 });
  }

  if (
    params.referrerPhone &&
    params.referredPhone &&
    params.referrerPhone.trim().length >= 6 &&
    params.referrerPhone.trim() === params.referredPhone.trim()
  ) {
    factors.push({
      signal: 'Referrer and referred account share identical phone number',
      weight: 60,
    });
  }

  if (params.referrerRecent24hCount >= 12) {
    factors.push({
      signal: `High 24h referral velocity (${params.referrerRecent24hCount} referrals)`,
      weight: 35,
    });
  }

  const assessment = evaluateRiskFactors(factors);
  if (assessment.requiresAdminReview) {
    await createFraudReport({
      category: 'referral',
      assessment,
      userId: params.referrerUid,
      title: 'Suspicious Referral Ring / Bonus Velocity',
      details: `Referral between ${params.referrerUid} and ${params.referredUid} triggered signals: ${assessment.signals.join('; ')}`,
      actionTaken: 'Flagged for Admin Review',
    });
  }

  return assessment;
}
