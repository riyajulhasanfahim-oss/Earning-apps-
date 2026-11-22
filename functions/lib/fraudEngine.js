"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashNetworkIdentifier = hashNetworkIdentifier;
exports.evaluateRiskFactors = evaluateRiskFactors;
exports.enforceRateLimit = enforceRateLimit;
exports.writeSecurityAuditLog = writeSecurityAuditLog;
exports.createFraudReport = createFraudReport;
exports.evaluateWithdrawalFraudSignals = evaluateWithdrawalFraudSignals;
exports.evaluateAuthSecuritySignals = evaluateAuthSecuritySignals;
exports.evaluateReferralFraudSignals = evaluateReferralFraudSignals;
const crypto = __importStar(require("crypto"));
const helpers_1 = require("./helpers");
function hashNetworkIdentifier(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const rawIp = forwarded || String(req.ip || 'unknown');
    if (!rawIp || rawIp === 'unknown')
        return 'anon';
    return crypto.createHash('sha256').update(`adview_rl_${rawIp}`).digest('hex').slice(0, 16);
}
/**
 * Cumulative Risk Scoring Engine with False-Positive Protection:
 * - Never triggers permanent ban from a single signal or same IP alone.
 * - High risk (>= 70) flags for Admin Review (`requiresAdminReview = true`)
 *   rather than silently deleting/confiscating legitimate user points.
 */
function evaluateRiskFactors(factors) {
    let rawScore = 0;
    const signals = [];
    for (const factor of factors) {
        if (factor.weight > 0) {
            rawScore += factor.weight;
            signals.push(factor.signal.slice(0, 140));
        }
    }
    const riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));
    const riskLevel = riskScore >= 70 ? 'high' : riskScore >= 35 ? 'medium' : 'low';
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
async function enforceRateLimit(params) {
    const safeKey = (0, helpers_1.sanitizeId)(params.bucketKey).slice(0, 120);
    const ref = helpers_1.db.collection('rateLimits').doc(safeKey);
    const nowMs = Date.now();
    const windowMs = Math.max(1, params.windowSeconds) * 1000;
    const outcome = await helpers_1.db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) {
            txn.set(ref, {
                bucketKey: safeKey,
                actionName: params.actionName.slice(0, 80),
                actorId: String(params.actorId || 'anonymous').slice(0, 128),
                windowStartedAtMs: nowMs,
                count: 1,
                updatedAt: helpers_1.FieldValue.serverTimestamp(),
            });
            return {
                allowed: true,
                remaining: Math.max(0, params.maxRequests - 1),
                retryAfterSec: params.windowSeconds,
                count: 1,
            };
        }
        const data = snap.data();
        const windowStart = Number(data.windowStartedAtMs || 0);
        const elapsed = nowMs - windowStart;
        if (elapsed >= windowMs) {
            txn.set(ref, {
                bucketKey: safeKey,
                actionName: params.actionName.slice(0, 80),
                actorId: String(params.actorId || 'anonymous').slice(0, 128),
                windowStartedAtMs: nowMs,
                count: 1,
                updatedAt: helpers_1.FieldValue.serverTimestamp(),
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
            updatedAt: helpers_1.FieldValue.serverTimestamp(),
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
async function writeSecurityAuditLog(params) {
    const logId = (0, helpers_1.sanitizeId)(`sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await helpers_1.db
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
        createdAt: helpers_1.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
    return logId;
}
/**
 * Queues a structured, false-positive-protected fraud alert for Admin Review.
 */
async function createFraudReport(params) {
    const reportId = (0, helpers_1.sanitizeId)(`fr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const nowServer = helpers_1.FieldValue.serverTimestamp();
    await helpers_1.db
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
        .catch(() => { });
    return reportId;
}
/**
 * Checks whether a withdrawal payout `accountNumber` has been used across multiple
 * distinct user accounts, combined with behavioral signals (rapid bursts, new account spikes).
 * Never auto-bans — flags to `fraudReports` with Risk Score for Admin Review.
 */
async function evaluateWithdrawalFraudSignals(params) {
    const factors = [];
    try {
        const sharedSnap = await helpers_1.db
            .collection('withdrawalRequests')
            .where('accountNumber', '==', params.accountNumber)
            .limit(20)
            .get();
        const distinctOtherUsers = new Set();
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
    }
    catch {
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
async function evaluateAuthSecuritySignals(params) {
    const factors = [];
    if (params.burstCount >= 6) {
        factors.push({
            signal: `Unusual auth request velocity (${params.burstCount} events in 10m window)`,
            weight: params.eventType === 'registration_completed' ? 45 : 30,
        });
    }
    if (params.eventType === 'registration_completed' &&
        params.phoneNumber &&
        params.phoneNumber.trim().length >= 6) {
        try {
            const phoneSnap = await helpers_1.db
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
        }
        catch {
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
            title: params.eventType === 'registration_completed'
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
async function evaluateReferralFraudSignals(params) {
    const factors = [];
    if (params.referrerUid === params.referredUid) {
        factors.push({ signal: 'Self-referral attempt blocked', weight: 85 });
    }
    if (params.referrerPhone &&
        params.referredPhone &&
        params.referrerPhone.trim().length >= 6 &&
        params.referrerPhone.trim() === params.referredPhone.trim()) {
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
//# sourceMappingURL=fraudEngine.js.map