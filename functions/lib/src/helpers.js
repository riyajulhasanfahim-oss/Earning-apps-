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
exports.VALID_ACCOUNT_TYPES = exports.PAYMENT_FEES = exports.MAX_AD_VIEW_DURATION_SEC = exports.MIN_AD_VIEW_DURATION_SEC = exports.MIN_SECONDS_BETWEEN_COMPLETIONS = exports.DEFAULT_GLOBAL_DAILY_AD_LIMIT = exports.DAILY_CHECKIN_BONUS_AD_ID = exports.BOOTSTRAP_SUPER_ADMIN_EMAIL = exports.FieldValue = exports.adminAuth = exports.db = exports.FIRESTORE_DATABASE_ID = void 0;
exports.normalizeAdDurationSeconds = normalizeAdDurationSeconds;
exports.hasMinimumRole = hasMinimumRole;
exports.getDhakaDateKey = getDhakaDateKey;
exports.getDhakaYesterdayDateKey = getDhakaYesterdayDateKey;
exports.getDhakaMonthKey = getDhakaMonthKey;
exports.maskAccountNumber = maskAccountNumber;
exports.validateMethodAccount = validateMethodAccount;
exports.sanitizeId = sanitizeId;
exports.calcBdtSnapshot = calcBdtSnapshot;
exports.maskPublicUsername = maskPublicUsername;
exports.timingSafeEqualString = timingSafeEqualString;
exports.verifyCallbackSecretOrHmac = verifyCallbackSecretOrHmac;
exports.verifyAppLixirMd5Signature = verifyAppLixirMd5Signature;
exports.isValidAppLixirSiteOrKey = isValidAppLixirSiteOrKey;
exports.getAppLixirBackendEnvStatus = getAppLixirBackendEnvStatus;
exports.verifyAppCheckIfEnforced = verifyAppCheckIfEnforced;
exports.verifyAuthAndRole = verifyAuthAndRole;
exports.readActiveAppSettings = readActiveAppSettings;
exports.logFraudAttempt = logFraudAttempt;
exports.logFailedTransaction = logFailedTransaction;
exports.logSystemError = logSystemError;
exports.extractRequestMetadata = extractRequestMetadata;
exports.writeAdminAuditLog = writeAdminAuditLog;
exports.writeReferralSecurityLog = writeReferralSecurityLog;
const crypto = __importStar(require("crypto"));
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length) {
    admin.initializeApp();
}
exports.FIRESTORE_DATABASE_ID = 'ai-studio-adviewearn-4a6d84ce-fab0-48b4-8d32-4f450c4d1278';
exports.db = admin.firestore();
exports.db.settings({ databaseId: exports.FIRESTORE_DATABASE_ID, ignoreUndefinedProperties: true });
exports.adminAuth = admin.auth();
exports.FieldValue = admin.firestore.FieldValue;
exports.BOOTSTRAP_SUPER_ADMIN_EMAIL = 'riyajulhasanfahim@gmail.com';
exports.DAILY_CHECKIN_BONUS_AD_ID = 'daily_checkin_bonus';
exports.DEFAULT_GLOBAL_DAILY_AD_LIMIT = 20;
exports.MIN_SECONDS_BETWEEN_COMPLETIONS = 30;
exports.MIN_AD_VIEW_DURATION_SEC = 30;
exports.MAX_AD_VIEW_DURATION_SEC = 180;
/**
 * Normalizes ad viewing duration in seconds.
 * Prevents accidental millisecond/oversized values (e.g. 3000s) or <30s values, defaulting to 30s.
 */
function normalizeAdDurationSeconds(raw) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < exports.MIN_AD_VIEW_DURATION_SEC || n > exports.MAX_AD_VIEW_DURATION_SEC) {
        return exports.MIN_AD_VIEW_DURATION_SEC;
    }
    return n;
}
exports.PAYMENT_FEES = {
    bkash: 2,
    nagad: 1.5,
    rocket: 1.8,
    bank: 3,
};
exports.VALID_ACCOUNT_TYPES = ['personal', 'agent', 'merchant', 'bank_account'];
const ROLE_WEIGHT = {
    support_admin: 1,
    admin: 2,
    super_admin: 3,
};
function hasMinimumRole(actual, required) {
    if (!actual)
        return false;
    return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[required];
}
function getDhakaDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}
function getDhakaYesterdayDateKey(todayDhakaKey = getDhakaDateKey()) {
    const parts = todayDhakaKey.split('-').map((n) => Number(n));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        return getDhakaDateKey(new Date(Date.now() - 86_400_000));
    }
    const utcMidnight = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    const prev = new Date(utcMidnight - 86_400_000);
    const yyyy = prev.getUTCFullYear();
    const mm = String(prev.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(prev.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
function getDhakaMonthKey(date = new Date()) {
    return getDhakaDateKey(date).slice(0, 7);
}
function maskAccountNumber(accountNumber, methodId) {
    const clean = accountNumber.trim();
    if (!clean)
        return '****';
    if (methodId !== 'bank' && clean.length >= 11) {
        return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
    }
    if (clean.length <= 6) {
        return `${clean.slice(0, 2)}****`;
    }
    return `${clean.slice(0, 2)}****${clean.slice(-4)}`;
}
function validateMethodAccount(methodId, rawAccount) {
    const trimmed = rawAccount.trim();
    if (methodId === 'bkash' || methodId === 'nagad' || methodId === 'rocket') {
        const digits = trimmed.replace(/[\s-]/g, '');
        return { valid: /^01[3-9]\d{8}$/.test(digits), normalized: digits };
    }
    return { valid: trimmed.length >= 8 && trimmed.length <= 80, normalized: trimmed };
}
function sanitizeId(raw) {
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
    return cleaned || `id_${Date.now()}`;
}
function calcBdtSnapshot(points, pointsPerBdt) {
    if (!pointsPerBdt || pointsPerBdt <= 0)
        return 0;
    return Number((points / pointsPerBdt).toFixed(2));
}
function maskPublicUsername(username) {
    const clean = username.trim().replace(/^@+/, '');
    if (!clean)
        return 'mem***';
    if (clean.length <= 3)
        return `${clean.slice(0, 1)}***`;
    if (clean.length <= 5)
        return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
    return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}
function timingSafeEqualString(aStr, bStr) {
    if (!aStr || !bStr)
        return false;
    const a = Buffer.from(aStr);
    const b = Buffer.from(bStr);
    if (a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(a, b);
}
function verifyCallbackSecretOrHmac(providedSecret, providedSignature, payloadString, expectedSecret) {
    if (!expectedSecret) {
        return false;
    }
    if (providedSecret && timingSafeEqualString(providedSecret, expectedSecret)) {
        return true;
    }
    if (providedSignature) {
        const expectedHmac = crypto
            .createHmac('sha256', expectedSecret)
            .update(payloadString)
            .digest('hex');
        if (timingSafeEqualString(providedSignature.toLowerCase(), expectedHmac.toLowerCase())) {
            return true;
        }
    }
    return false;
}
/**
 * Verifies AppLixir's official S2S Web Callback MD5 signature:
 * - MD5 + TID mode: md5(gameApiKey + gameId + userId + tid + secret)
 * - MD5 Only mode:  md5(gameApiKey + gameId + userId + secret)
 */
function verifyAppLixirMd5Signature(params) {
    const sig = params.signature.trim().toLowerCase();
    const secret = params.secret.trim();
    if (!sig || !secret)
        return false;
    const base = `${params.gameApiKey}${params.gameId}${params.userId}`;
    const candidates = [];
    if (params.tid) {
        candidates.push(crypto.createHash('md5').update(`${base}${params.tid}${secret}`).digest('hex'));
    }
    candidates.push(crypto.createHash('md5').update(`${base}${secret}`).digest('hex'));
    return candidates.some((expected) => timingSafeEqualString(sig, expected.toLowerCase()));
}
function isValidAppLixirSiteOrKey(rawValue) {
    const clean = rawValue.replace(/^applixir:\/\//i, '').replace(/^applixir:/i, '').trim();
    if (!clean || /^(demo|test|placeholder|0+|none|null|undefined)$/i.test(clean)) {
        return false;
    }
    const isNumericSiteId = /^\d{3,12}$/.test(clean);
    const isUuidOrKey = /^[a-zA-Z0-9-]{8,64}$/.test(clean);
    return isNumericSiteId || isUuidOrKey;
}
function getAppLixirBackendEnvStatus() {
    return {
        siteIdConfigured: isValidAppLixirSiteOrKey((process.env.APPLIXIR_SITE_ID || '').trim()),
        apiKeyConfigured: Boolean((process.env.APPLIXIR_API_KEY || '').trim()),
        secretKeyConfigured: Boolean((process.env.APPLIXIR_SECRET_KEY || '').trim()),
    };
}
async function verifyAppCheckIfEnforced(req) {
    const enforced = process.env.ENFORCE_APP_CHECK === 'true';
    const rawToken = req.headers['x-firebase-appcheck'];
    const token = Array.isArray(rawToken) ? rawToken[0] : String(rawToken || '').trim();
    if (!token) {
        if (enforced) {
            await logSystemError('anonymous', 'app_check', 'verifyAppCheck', 'Missing X-Firebase-AppCheck header', 'high');
            return { ok: false, error: 'Missing Firebase App Check token' };
        }
        return { ok: true };
    }
    try {
        await admin.appCheck().verifyToken(token);
        return { ok: true };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid App Check token';
        if (enforced) {
            await logSystemError('anonymous', 'app_check', 'verifyAppCheck', msg, 'high');
            return { ok: false, error: 'Invalid Firebase App Check token' };
        }
        return { ok: true };
    }
}
async function verifyAuthAndRole(req, options = {}) {
    const appCheckResult = await verifyAppCheckIfEnforced(req);
    if (!appCheckResult.ok) {
        return { status: 401, error: appCheckResult.error || 'App Check verification failed' };
    }
    const authHeader = String(req.headers.authorization || '');
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return { status: 401, error: 'Missing Authorization Bearer token' };
    }
    let decoded;
    try {
        decoded = await exports.adminAuth.verifyIdToken(match[1], true);
    }
    catch {
        return { status: 401, error: 'Invalid or expired auth token' };
    }
    const email = String(decoded.email || '');
    const emailVerified = Boolean(decoded.email_verified);
    if (options.requireVerifiedEmail && !emailVerified) {
        return { status: 403, error: 'Verified email required' };
    }
    let resolvedRole = null;
    if (email.toLowerCase() === exports.BOOTSTRAP_SUPER_ADMIN_EMAIL && emailVerified) {
        resolvedRole = 'super_admin';
    }
    const claimRole = decoded.adminRole;
    if (!resolvedRole &&
        emailVerified &&
        (claimRole === 'super_admin' || claimRole === 'admin' || claimRole === 'support_admin')) {
        resolvedRole = claimRole;
    }
    if (!resolvedRole) {
        const marker = await exports.db.collection('admins').doc(decoded.uid).get();
        if (marker.exists) {
            const data = marker.data();
            const docRole = data.role;
            if (docRole === 'super_admin' || docRole === 'admin' || docRole === 'support_admin') {
                resolvedRole = docRole;
            }
            else {
                resolvedRole = 'admin';
            }
        }
    }
    if (options.requiredAdminRole && !hasMinimumRole(resolvedRole, options.requiredAdminRole)) {
        return {
            status: 403,
            error: `Requires ${options.requiredAdminRole} privileges`,
        };
    }
    return {
        auth: {
            uid: decoded.uid,
            email,
            emailVerified,
            adminRole: resolvedRole,
        },
    };
}
async function readActiveAppSettings(txn) {
    const walletSettingsRef = exports.db.collection('appSettings').doc('wallet');
    const economyRef = exports.db.collection('appConfig').doc('economy');
    const [settingsSnap, economySnap] = txn
        ? await Promise.all([txn.get(walletSettingsRef), txn.get(economyRef)])
        : await Promise.all([walletSettingsRef.get(), economyRef.get()]);
    const s = settingsSnap.exists ? settingsSnap.data() : {};
    const e = economySnap.exists ? economySnap.data() : {};
    const rawRate = s.pointsPerBdt ?? e.pointsPerBdt;
    const rawBonus = s.dailyBonusPoints ?? e.dailyBonusPoints;
    const rawMinWd = s.minimumWithdrawPoints ?? e.minimumWithdrawPoints;
    const rawMaxWd = s.maximumWithdrawAmountBdt;
    const rawDailyLimit = s.dailyAdLimit ?? e.dailyAdLimit;
    return {
        pointsPerBdt: typeof rawRate === 'number' && rawRate > 0 ? rawRate : null,
        dailyBonusPoints: typeof rawBonus === 'number' && rawBonus >= 1 ? Math.floor(rawBonus) : null,
        minimumWithdrawPoints: typeof rawMinWd === 'number' && rawMinWd >= 1 ? Math.floor(rawMinWd) : null,
        maximumWithdrawAmountBdt: typeof rawMaxWd === 'number' && rawMaxWd >= 1 ? Number(rawMaxWd) : null,
        dailyAdLimit: typeof rawDailyLimit === 'number' && rawDailyLimit >= 1
            ? Math.floor(rawDailyLimit)
            : exports.DEFAULT_GLOBAL_DAILY_AD_LIMIT,
        walletEnabled: typeof s.walletEnabled === 'boolean' ? s.walletEnabled : true,
        earningEnabled: typeof s.earningEnabled === 'boolean' ? s.earningEnabled : true,
    };
}
async function logFraudAttempt(userId, reason, details, severity) {
    await exports.db
        .collection('fraudLogs')
        .add({
        userId: (userId || 'unknown').slice(0, 128),
        reason: reason.slice(0, 200),
        details: details.slice(0, 500),
        severity,
        createdAt: exports.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
}
async function logFailedTransaction(params) {
    const logId = sanitizeId(`ftx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await exports.db
        .collection('failedTransactionLogs')
        .doc(logId)
        .set({
        logId,
        userId: (params.userId || 'unknown').slice(0, 128),
        operation: params.operation.slice(0, 80),
        errorCode: params.errorCode.slice(0, 100),
        transactionId: (params.transactionId || '').slice(0, 128),
        details: params.details.slice(0, 500),
        createdAt: exports.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
}
async function logSystemError(userId, source, operation, message, severity) {
    const errorId = sanitizeId(`err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await exports.db
        .collection('systemErrors')
        .doc(errorId)
        .set({
        errorId,
        userId: (userId || 'system').slice(0, 128),
        source,
        operation: operation.slice(0, 100),
        message: message.slice(0, 500),
        severity,
        createdAt: exports.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
}
function extractRequestMetadata(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.ip || 'unknown';
    const ua = String(req.headers['user-agent'] || 'unknown').slice(0, 180);
    return `ip=${ip}; ua=${ua}`.slice(0, 500);
}
async function writeAdminAuditLog(params) {
    const logId = sanitizeId(`adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await exports.db
        .collection('adminLogs')
        .doc(logId)
        .set({
        logId,
        adminUid: params.adminUid.slice(0, 128),
        adminEmail: (params.adminEmail || 'admin@adviewearn.com').slice(0, 120),
        ...(params.adminRole ? { adminRole: params.adminRole } : {}),
        action: params.action.slice(0, 80),
        targetId: params.targetId.slice(0, 128),
        ...(params.previousValue !== undefined
            ? { previousValue: params.previousValue.slice(0, 500) }
            : {}),
        ...(params.newValue !== undefined
            ? { newValue: params.newValue.slice(0, 500) }
            : {}),
        ...(params.metadata !== undefined
            ? { metadata: params.metadata.slice(0, 500) }
            : {}),
        details: params.details.slice(0, 500),
        createdAt: exports.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
}
async function writeReferralSecurityLog(params) {
    const logId = sanitizeId(`reflog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    await exports.db
        .collection('referralLogs')
        .doc(logId)
        .set({
        logId,
        referrerUid: (params.referrerUid || '').slice(0, 128),
        referredUid: (params.referredUid || '').slice(0, 128),
        eventType: params.eventType.slice(0, 80),
        severity: params.severity,
        details: params.details.slice(0, 500),
        createdAt: exports.FieldValue.serverTimestamp(),
    })
        .catch(() => { });
}
//# sourceMappingURL=helpers.js.map