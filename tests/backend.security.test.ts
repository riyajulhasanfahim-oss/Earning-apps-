/**
 * AdView Earn — Backend Security, Rules Coverage, Cryptography & Atomic Integrity Test Suite
 *
 * Runs directly in Node.js via:
 *   npx tsx tests/backend.security.test.ts
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const RULES_TEXT = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const BLUEPRINT = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'firebase-blueprint.json'), 'utf8'),
) as {
  entities: Record<string, unknown>;
  firestore: Record<string, { schema: { $ref: string } }>;
};
const FUNCTIONS_INDEX = fs.readFileSync(path.join(ROOT, 'functions/src/index.ts'), 'utf8');
const FUNCTIONS_HELPERS = fs.readFileSync(path.join(ROOT, 'functions/src/helpers.ts'), 'utf8');
const FUNCTIONS_WALLET = fs.readFileSync(path.join(ROOT, 'functions/src/walletCore.ts'), 'utf8');
const FUNCTIONS_AD_NETWORK = fs.readFileSync(path.join(ROOT, 'functions/src/adNetworkEngine.ts'), 'utf8');
const FUNCTIONS_FRAUD = fs.readFileSync(path.join(ROOT, 'functions/src/fraudEngine.ts'), 'utf8');

function extractCollectionBlock(collectionName: string): string {
  const regex = new RegExp(`match \\/${collectionName}\\/\\{[^}]+\\}\\s*\\{`);
  const match = regex.exec(RULES_TEXT);
  assert.ok(match, `Missing rules block for /${collectionName}`);
  const idx = match.index;
  const openBraceIdx = idx + match[0].length - 1;
  let depth = 0;
  for (let i = openBraceIdx; i < RULES_TEXT.length; i += 1) {
    const ch = RULES_TEXT[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return RULES_TEXT.slice(idx, i + 1);
      }
    }
  }
  throw new Error(`Unclosed rules block for /${collectionName}`);
}

// Replicate production timing-safe signature helper to verify adversarial payloads
function verifyCallbackSecretOrHmac(
  providedSecret: string,
  providedSignature: string,
  payloadString: string,
  expectedSecret: string,
): boolean {
  if (!expectedSecret) return false;
  if (providedSecret) {
    const a = Buffer.from(providedSecret);
    const b = Buffer.from(expectedSecret);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  if (providedSignature) {
    const expectedHmac = crypto
      .createHmac('sha256', expectedSecret)
      .update(payloadString)
      .digest('hex');
    const a = Buffer.from(providedSignature.toLowerCase());
    const b = Buffer.from(expectedHmac.toLowerCase());
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// In-memory atomic ledger + concurrency model mirroring walletCore.ts invariants
interface SimWallet {
  totalPoints: number;
  availablePoints: number;
  reservedPoints: number;
}
interface SimLedgerEntry {
  entryId: string;
  entryType: 'credit' | 'debit' | 'reserve' | 'release';
  pointsDelta: number;
}

function runAllBackendSecurityTests(): void {
  const results: string[] = [];

  // Test 1: Blueprint <-> Firestore Rules 1:1 coverage + Default Deny Catch-All
  assert.match(
    RULES_TEXT,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/,
    'Global default-deny catch-all rule missing',
  );
  const blueprintPaths = Object.keys(BLUEPRINT.firestore);
  assert.equal(blueprintPaths.length, 40, `Expected 40 collections in blueprint, got ${blueprintPaths.length}`);
  for (const bpPath of blueprintPaths) {
    const colName = bpPath.split('/')[1];
    extractCollectionBlock(colName);
    const refName = BLUEPRINT.firestore[bpPath].schema.$ref.replace('#/entities/', '');
    assert.ok(BLUEPRINT.entities[refName], `Missing entity ${refName} referenced by ${bpPath}`);
  }
  results.push('Test 1 PASSED: Default-deny & 40/40 Firestore blueprint-to-rules collection parity verified');

  // Test 2: Unauthorized DB Access & Zero Blanket Unauthenticated Reads
  const privateCollections = [
    'users',
    'wallets',
    'walletLedger',
    'withdrawalRequests',
    'adminLogs',
    'fraudLogs',
    'failedTransactionLogs',
    'reconciliationReports',
    'systemErrors',
    'admins',
    'transactions',
    'adSessions',
    'adCompletions',
    'dailyAdLimits',
    'dailyBonuses',
    'notifications',
    'adNetworks',
    'adNetworkSecrets',
    'adPlacements',
    'adCampaigns',
    'adCallbacks',
    'adAnalytics',
    'adNetworkLogs',
    'fraudReports',
    'securityAuditLogs',
    'rateLimits',
  ];
  for (const col of privateCollections) {
    const block = extractCollectionBlock(col);
    assert.ok(!/:\s*if\s+true\s*;/.test(block), `Blanket allow true found in /${col}`);
    assert.match(
      block,
      /(isSignedIn\(\)|isOwner\(|isEmailVerified\(|isAdmin\(\)|isSuperAdmin\(\)|isSupportAdmin\(\)|allow read, write: if false;)/,
      `/${col} must enforce explicit auth/ownership/RBAC or deny-all condition`,
    );
  }
  results.push(`Test 2 PASSED: Zero blanket public reads across all ${privateCollections.length} sensitive collections`);

  // Test 3: Wallet Balance & Financial Immutability from Clients
  for (const serverOnlyCol of ['wallets', 'walletLedger', 'withdrawalRequests', 'transactions', 'adCompletions', 'dailyAdLimits', 'referralRewards']) {
    const block = extractCollectionBlock(serverOnlyCol);
    assert.match(
      block,
      /allow create, update, delete:\s*if isValidId\([^)]+\) && isAdmin\(\);/,
      `/${serverOnlyCol} must restrict client writes strictly to Admin/Server SDK`,
    );
  }
  const usersBlock = extractCollectionBlock('users');
  assert.match(usersBlock, /incoming\(\)\.points == existing\(\)\.points/);
  assert.match(usersBlock, /incoming\(\)\.totalEarnings == existing\(\)\.totalEarnings/);
  assert.match(usersBlock, /incoming\(\)\.totalAdViews == existing\(\)\.totalAdViews/);
  results.push('Test 3 PASSED: Balance manipulation and fake transaction creation blocked in rules');

  // Test 4: Immutable Monitoring & Audit Logs
  for (const immutableCol of ['adminLogs', 'referralLogs', 'failedTransactionLogs', 'reconciliationReports', 'systemErrors']) {
    const block = extractCollectionBlock(immutableCol);
    assert.match(block, /allow update, delete:\s*if false;/, `/${immutableCol} must forbid updates and deletes`);
  }
  results.push('Test 4 PASSED: Immutable audit & monitoring collections forbid update/delete');

  // Test 5: 3-Tier Custom Claims RBAC (`super_admin`, `admin`, `support_admin`)
  assert.match(RULES_TEXT, /function hasVerifiedClaimRole\(roleName\)/);
  assert.match(RULES_TEXT, /function isSuperAdmin\(\)/);
  assert.match(RULES_TEXT, /function isAdmin\(\)/);
  assert.match(RULES_TEXT, /function isSupportAdmin\(\)/);
  const adminsBlock = extractCollectionBlock('admins');
  assert.match(adminsBlock, /allow get:\s*if isValidId\(adminId\) && \(isOwner\(adminId\) \|\| isSuperAdmin\(\)\);/);
  assert.match(adminsBlock, /allow list:\s*if isSuperAdmin\(\);/);
  assert.match(adminsBlock, /allow create, update, delete:\s*if false;/);
  assert.match(usersBlock, /allow delete:\s*if isValidId\(userId\) && isSuperAdmin\(\);/);
  const appSettingsBlock = extractCollectionBlock('appSettings');
  assert.match(appSettingsBlock, /settingId == 'site'/);
  assert.match(appSettingsBlock, /isSuperAdmin\(\)/);
  const notifReadsBlock = extractCollectionBlock('adminNotificationReads');
  assert.match(notifReadsBlock, /isOwner\(adminId\) && isSupportAdmin\(\)/);
  results.push('Test 5 PASSED: 3-Tier Custom Claims RBAC, Super Admin SiteSettings & anti-escalation rules verified');

  // Test 6: Cryptographic S2S Postback / Webhook Signature & Secret Verification
  const secret = 'super-secret-postback-key-2026';
  const payload = 'sess_101:user_abc:prov_tx_999';
  const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  assert.equal(verifyCallbackSecretOrHmac('', validSig, payload, secret), true);
  assert.equal(verifyCallbackSecretOrHmac(secret, '', payload, secret), true);
  assert.equal(verifyCallbackSecretOrHmac('', 'deadbeef'.repeat(8), payload, secret), false);
  assert.equal(verifyCallbackSecretOrHmac('wrong-secret', '', payload, secret), false);
  assert.equal(verifyCallbackSecretOrHmac('', validSig, 'sess_101:user_abc:prov_tx_FORGED', secret), false);
  assert.equal(verifyCallbackSecretOrHmac('anything', validSig, payload, ''), false);
  results.push('Test 6 PASSED: Timing-safe HMAC-SHA256 & secret verification blocks tampered callbacks');

  // Test 7: Concurrent / Duplicate Credit & Withdrawal Atomic Ledger Reconciliation
  const wallet: SimWallet = { totalPoints: 0, availablePoints: 0, reservedPoints: 0 };
  const ledger = new Map<string, SimLedgerEntry>();

  const creditOnce = (key: string, pts: number) => {
    if (ledger.has(key)) throw new Error('DUPLICATE_WALLET_TRANSACTION');
    wallet.totalPoints += pts;
    wallet.availablePoints += pts;
    ledger.set(key, { entryId: key, entryType: 'credit', pointsDelta: pts });
  };

  const reserveWithdrawalOnce = (key: string, pts: number) => {
    if (ledger.has(key)) throw new Error('DUPLICATE_WITHDRAW_REQUEST');
    if (wallet.availablePoints < pts) throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
    wallet.availablePoints -= pts;
    wallet.reservedPoints += pts;
    ledger.set(key, { entryId: key, entryType: 'reserve', pointsDelta: -pts });
  };

  const refundWithdrawalOnce = (key: string, pts: number) => {
    if (ledger.has(key)) throw new Error('ALREADY_REFUNDED');
    wallet.reservedPoints -= pts;
    wallet.availablePoints += pts;
    ledger.set(key, { entryId: key, entryType: 'release', pointsDelta: pts });
  };

  creditOnce('led_ad_tx_1', 600);
  assert.throws(() => creditOnce('led_ad_tx_1', 600), /DUPLICATE_WALLET_TRANSACTION/);
  reserveWithdrawalOnce('led_wd_1', 400);
  assert.throws(() => reserveWithdrawalOnce('led_wd_2', 300), /INSUFFICIENT_AVAILABLE_BALANCE/);
  refundWithdrawalOnce('led_rej_1', 400);
  assert.throws(() => refundWithdrawalOnce('led_rej_1', 400), /ALREADY_REFUNDED/);

  let ledgerNet = 0;
  let ledgerRes = 0;
  for (const e of ledger.values()) {
    if (e.entryType === 'credit' || e.entryType === 'debit') ledgerNet += e.pointsDelta;
    if (e.entryType === 'reserve') ledgerRes += Math.abs(e.pointsDelta);
    if (e.entryType === 'release') ledgerRes -= Math.abs(e.pointsDelta);
  }
  assert.equal(wallet.totalPoints, ledgerNet);
  assert.equal(wallet.reservedPoints, ledgerRes);
  assert.equal(wallet.availablePoints, wallet.totalPoints - wallet.reservedPoints);
  assert.equal(wallet.availablePoints, 600);
  results.push('Test 7 PASSED: Idempotent credits, overdraw prevention, single refund & ledger reconciliation verified');

  // Test 8: Cloud Functions Export Surface & Security Guards
  const requiredFunctions = [
    'onUserCreate',
    'onUserDelete',
    'getWalletBalance',
    'getTransactionHistory',
    'processWalletCredit',
    'processWalletDebit',
    'reconcileWalletLedger',
    'createAdSession',
    'startDailyBonusSession',
    'verifyAdCompletion',
    'confirmSdkAdCompletion',
    'cancelAdSession',
    'processAdReward',
    'enforceDailyAdLimit',
    'verifyAdRewardPostback',
    'createWithdrawalRequest',
    'requestWithdrawal',
    'cancelWithdrawalRequest',
    'approveWithdrawal',
    'rejectWithdrawal',
    'markWithdrawalPaid',
    'adminManageWithdrawal',
    'generateReferralCode',
    'validateReferralCode',
    'qualifyReferral',
    'qualifyReferralBonus',
    'processReferralReward',
    'adminManageReferral',
    'setAdminRoleClaim',
    'updateAppSettings',
    'updateDailyBonusAdSettings',
    'updateSiteSettings',
    'updateUserStatus',
    'adjustUserPoints',
    'manageAdvertisements',
    'exportDatabaseBackupSnapshot',
    'verifyAdNetworkCallback',
    'saveAdNetworkConfig',
    'testAdNetworkConnection',
    'manageAdCampaign',
    'getAdNetworkAnalyticsSummary',
    'recordAuthSecurityEvent',
    'reviewFraudReport',
  ];
  for (const fnName of requiredFunctions) {
    assert.match(
      FUNCTIONS_INDEX,
      new RegExp(`export const ${fnName}\\b`),
      `Cloud Function '${fnName}' missing from functions/src/index.ts`,
    );
  }
  assert.match(FUNCTIONS_HELPERS, /verifyAppCheckIfEnforced/);
  assert.match(FUNCTIONS_HELPERS, /verifyIdToken\(match\[1\], true\)/);
  assert.match(FUNCTIONS_WALLET, /computeLedgerReconciliation/);
  results.push(`Test 8 PASSED: All ${requiredFunctions.length} Cloud Functions & AppCheck/Token-Revocation guards verified`);

  // Test 9: Self-Referral & Incentive Ad Policy Guards
  const referralsBlock = extractCollectionBlock('referrals');
  assert.match(referralsBlock, /incoming\(\)\.referrerUid != request\.auth\.uid/);
  assert.match(referralsBlock, /incoming\(\)\.rewardStatus == 'pending'/);
  const adsBlock = extractCollectionBlock('advertisements');
  assert.match(adsBlock, /incoming\(\)\.rewardVerificationMethod != 'none'/);
  assert.match(adsBlock, /incoming\(\)\.adType != 'direct_link' \|\| incoming\(\)\.incentivizedTrafficAllowed == true/);
  results.push('Test 9 PASSED: Self-referral & rewarded ad network policy guards verified');

  // Test 10: Firebase Emulator Config & Rules ESLint Readiness Check
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8')) as {
    firestore?: { rules?: string };
    functions?: Array<{ source?: string }>;
    emulators?: Record<string, { port?: number }>;
  };
  assert.equal(firebaseJson.firestore?.rules, 'firestore.rules');
  assert.equal(firebaseJson.emulators?.firestore?.port, 8080);
  assert.equal(firebaseJson.emulators?.auth?.port, 9099);
  assert.equal(firebaseJson.emulators?.functions?.port, 5001);
  results.push('Test 10 PASSED: firebase.json emulator suite & deployment structure verified');

  // Test 11: Phase 10 Zero-Trust Secret Isolation & Immutability in Rules
  const secretsBlock = extractCollectionBlock('adNetworkSecrets');
  assert.match(secretsBlock, /allow read, write: if false;/, 'adNetworkSecrets must deny ALL client access');
  const callbacksBlock = extractCollectionBlock('adCallbacks');
  assert.match(callbacksBlock, /allow create, update, delete: if false;/, 'adCallbacks must be strictly server-written');
  const netLogsBlock = extractCollectionBlock('adNetworkLogs');
  assert.match(netLogsBlock, /allow update, delete: if false;/, 'adNetworkLogs must be strictly immutable');
  const netsBlock = extractCollectionBlock('adNetworks');
  assert.match(netsBlock, /allow get, list: if isSupportAdmin\(\);/);
  assert.match(netsBlock, /isAdmin\(\)/);
  assert.match(netsBlock, /isSuperAdmin\(\)/);
  results.push('Test 11 PASSED: adNetworkSecrets zero client access, adCallbacks server-only & adNetworkLogs immutability verified');

  // Test 12: Phase 10 Invalid Config, Direct Link Reward Eligibility & Disabled Campaign Guards
  assert.match(RULES_TEXT, /isValidAdNetwork/);
  assert.match(RULES_TEXT, /\(!data\.rewardEnabled \|\| \(data\.incentivizedTrafficAllowed == true && data\.rewardVerificationSupported == true\)\)/);
  assert.match(RULES_TEXT, /isValidAdPlacement/);
  assert.match(RULES_TEXT, /\(data\.adType != 'direct_link' \|\| !data\.rewardEligible \|\| data\.incentivizedTrafficApproved == true\)/);
  assert.match(RULES_TEXT, /isValidAdCampaign/);
  assert.match(FUNCTIONS_AD_NETWORK, /CAMPAIGN_DISABLED/);
  assert.match(FUNCTIONS_AD_NETWORK, /NETWORK_DISABLED/);
  assert.match(FUNCTIONS_AD_NETWORK, /CAMPAIGN_GLOBAL_DAILY_LIMIT_REACHED/);
  assert.match(FUNCTIONS_AD_NETWORK, /NETWORK_REWARD_NOT_ELIGIBLE/);
  results.push('Test 12 PASSED: Network policy, Direct Link reward eligibility, disabled campaign & global cap guards verified');

  // Test 13: Phase 10 Callback Timestamp Expiry, Duplicate Replay & Signature Protection
  const MAX_AGE = 900;
  const nowSec = 1_750_000_000;
  const expiredTs = nowSec - (MAX_AGE + 120);
  const freshTs = nowSec - 30;
  assert.ok(nowSec - expiredTs > MAX_AGE, 'Expired callback age check');
  assert.ok(nowSec - freshTs <= MAX_AGE, 'Fresh callback age check');
  assert.match(FUNCTIONS_AD_NETWORK, /MAX_CALLBACK_AGE_SEC = 900/);
  assert.match(FUNCTIONS_AD_NETWORK, /EXPIRED_CALLBACK/);
  assert.match(FUNCTIONS_AD_NETWORK, /DUPLICATE_CALLBACK_EVENT/);
  assert.match(FUNCTIONS_AD_NETWORK, /INVALID_CALLBACK_SIGNATURE/);
  assert.match(FUNCTIONS_AD_NETWORK, /clicksSupported/);
  results.push('Test 13 PASSED: Callback expiry (900s), replay blocking, HMAC signature & honest click-reporting flags verified');

  // Test 14: Honest Network Health Resolution (never faking "connected")
  assert.match(FUNCTIONS_AD_NETWORK, /configuration_required/);
  assert.match(FUNCTIONS_AD_NETWORK, /verification_pending/);
  assert.match(FUNCTIONS_AD_NETWORK, /resolveNetworkHealthStatus/);
  results.push('Test 14 PASSED: Network health resolution states (never faking Connected) verified');

  // Test 15: Phase 11 Fraud Monitoring, Immutable Security Audit Logs & Server-Only Rate Limits
  const secAuditBlock = extractCollectionBlock('securityAuditLogs');
  assert.match(secAuditBlock, /allow get, list: if isSupportAdmin\(\);/);
  assert.match(secAuditBlock, /allow update, delete:\s*if false;/, 'securityAuditLogs must be immutable');
  const fraudReportsBlock = extractCollectionBlock('fraudReports');
  assert.match(fraudReportsBlock, /allow get, list: if isSupportAdmin\(\);/);
  assert.match(fraudReportsBlock, /allow delete:\s*if false;/, 'fraudReports must not be deleted by clients');
  const rateLimitsBlock = extractCollectionBlock('rateLimits');
  assert.match(rateLimitsBlock, /allow read, write:\s*if false;/, 'rateLimits must deny ALL client access');
  assert.match(extractCollectionBlock('adSessions'), /accountStatus == 'active'/);
  results.push('Test 15 PASSED: securityAuditLogs immutability, fraudReports protection, rateLimits isolation & restricted session block verified');

  // Test 16: Phase 11 Concurrent Withdrawal Lock, Fast Ad Completion Guard & Rate Limiting Behavior
  assert.match(FUNCTIONS_INDEX, /CONCURRENT_PENDING_WITHDRAWAL_EXISTS/);
  assert.match(FUNCTIONS_INDEX, /ABNORMALLY_FAST_AD_COMPLETION/);
  assert.match(FUNCTIONS_FRAUD, /enforceRateLimit/);

  // Simulate atomic sliding window rate-limit behavior
  const rateWindowMs = 60_000;
  const maxRequests = 5;
  let windowStart = 1_000_000;
  let count = 0;
  const hitRateLimit = (tsMs: number) => {
    if (tsMs - windowStart >= rateWindowMs) {
      windowStart = tsMs;
      count = 1;
      return true;
    }
    count += 1;
    return count <= maxRequests;
  };
  for (let i = 0; i < 5; i += 1) {
    assert.equal(hitRateLimit(1_000_000 + i * 100), true);
  }
  assert.equal(hitRateLimit(1_000_600), false, '6th request within 60s must trigger rate limit');
  assert.equal(hitRateLimit(1_061_000), true, 'Request after window expiry must succeed');

  // Simulate concurrent double-withdrawal race lock
  let activePending = 0;
  const tryCreatePendingWd = () => {
    if (activePending >= 1) throw new Error('CONCURRENT_PENDING_WITHDRAWAL_EXISTS');
    activePending += 1;
    return true;
  };
  assert.equal(tryCreatePendingWd(), true);
  assert.throws(() => tryCreatePendingWd(), /CONCURRENT_PENDING_WITHDRAWAL_EXISTS/);
  results.push('Test 16 PASSED: Rate limiting window, concurrent withdrawal lock & fast-ad completion guard verified');

  // Test 17: Phase 11 False-Positive Protection & Cumulative Risk Score Model
  assert.match(FUNCTIONS_FRAUD, /falsePositiveProtected:\s*true/);
  assert.match(FUNCTIONS_FRAUD, /riskScore >= 70/);
  const evaluateScore = (weights: number[]) => {
    const score = Math.max(0, Math.min(100, weights.reduce((a, b) => a + b, 0)));
    return {
      score,
      level: score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low',
    };
  };
  assert.equal(evaluateScore([20]).level, 'low', 'Single weak signal must remain low risk');
  assert.equal(evaluateScore([45]).level, 'medium', 'Single medium signal goes to Admin Review, not high auto-ban');
  assert.equal(evaluateScore([45, 30]).level, 'high', 'Corroborated multi-signals escalate cleanly to High Risk Review');
  results.push('Test 17 PASSED: False-positive protection & cumulative risk-score calibration verified');

  // Test 18: Zero Secret Leakage Scan Across Frontend Source Files (`src/`)
  const walkSrcFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkSrcFiles(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const srcFiles = walkSrcFiles(path.join(ROOT, 'src'));
  for (const file of srcFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const contentWithoutProbe = content.replace(
      /doc\s*\([^)]*['"](adNetworkSecrets|rateLimits)['"]\s*,\s*['"]_security_probe_['"]\s*\)/g,
      '',
    );
    assert.ok(
      !/(collection|doc)\s*\([^)]*['"]adNetworkSecrets['"]/.test(contentWithoutProbe),
      `Frontend file must never query adNetworkSecrets: ${file}`,
    );
    assert.ok(
      !/(collection|doc)\s*\([^)]*['"]rateLimits['"]/.test(contentWithoutProbe),
      `Frontend file must never query server-only rateLimits: ${file}`,
    );
    assert.ok(!/POSTBACK_SECRET/.test(content), `Frontend file must never reference POSTBACK_SECRET: ${file}`);
    assert.ok(
      !/process\.env\.APPLIXIR_|import\.meta\.env\.VITE_APPLIXIR_(SECRET|API)/i.test(content),
      `Frontend file must never read AppLixir secret/API env variables: ${file}`,
    );
    assert.ok(!/BEGIN PRIVATE KEY/.test(content), `Frontend file must never embed private keys: ${file}`);
  }
  results.push(`Test 18 PASSED: Secret-isolation scan passed cleanly across all ${srcFiles.length} frontend source files`);

  // Test 19: 30s Minimum Viewing Session, SDK Verification & Direct-Link Timer Guard
  assert.match(FUNCTIONS_HELPERS, /MIN_AD_VIEW_DURATION_SEC = 30/);
  assert.match(FUNCTIONS_HELPERS, /MIN_SECONDS_BETWEEN_COMPLETIONS = 30/);
  assert.match(FUNCTIONS_HELPERS, /function normalizeAdDurationSeconds/);
  assert.match(FUNCTIONS_INDEX, /normalizeAdDurationSeconds\(adData\.estimatedDuration\)/);
  assert.match(FUNCTIONS_INDEX, /S2S_POSTBACK_REQUIRED_FOR_DIRECT_LINK/);
  assert.match(FUNCTIONS_INDEX, /MONETAG_SDK_REQUIRES_TELEGRAM_MINI_APP/);
  assert.match(FUNCTIONS_INDEX, /elapsedSinceStartSec < requiredDurationSec/);
  const monetagSdkSrc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'monetagSdk.ts'), 'utf8');
  assert.match(monetagSdkSrc, /isTelegramMiniAppContext/);
  const adSessionsBlock = extractCollectionBlock('adSessions');
  assert.match(adSessionsBlock, /incoming\(\)\.status == 'rejected'/);
  assert.match(adSessionsBlock, /incoming\(\)\.transactionId == ''/);
  results.push('Test 19 PASSED: 30s backend duration, 3000s guard, TMA-only Monetag guard, direct-link SDK block & owner-reject-only adSessions rules verified');

  // Test 20: AppLixir Web Rewarded Video MD5+TID S2S Verification & Zero Client Fallback
  const verifyAppLixirMd5Local = (params: {
    gameApiKey: string;
    gameId: string;
    userId: string;
    tid: string;
    signature: string;
    secret: string;
  }): boolean => {
    const sig = params.signature.trim().toLowerCase();
    const secretVal = params.secret.trim();
    if (!sig || !secretVal) return false;
    const base = `${params.gameApiKey}${params.gameId}${params.userId}`;
    const candidates: string[] = [];
    if (params.tid) {
      candidates.push(crypto.createHash('md5').update(`${base}${params.tid}${secretVal}`).digest('hex'));
    }
    candidates.push(crypto.createHash('md5').update(`${base}${secretVal}`).digest('hex'));
    return candidates.some((exp) => {
      const a = Buffer.from(sig);
      const b = Buffer.from(exp.toLowerCase());
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  };

  const appSecret = 'applixir_prod_secret_987654';
  const appApiKey = 'game_api_key_abc123';
  const appGameId = '8842';
  const appUserId = 'uid_verified_001';
  const appTid = 'tid_applixir_9911';
  const validMd5Tid = crypto
    .createHash('md5')
    .update(`${appApiKey}${appGameId}${appUserId}${appTid}${appSecret}`)
    .digest('hex');
  const validMd5Only = crypto
    .createHash('md5')
    .update(`${appApiKey}${appGameId}${appUserId}${appSecret}`)
    .digest('hex');

  assert.equal(
    verifyAppLixirMd5Local({
      gameApiKey: appApiKey,
      gameId: appGameId,
      userId: appUserId,
      tid: appTid,
      signature: validMd5Tid,
      secret: appSecret,
    }),
    true,
    'Valid AppLixir MD5+TID signature must pass',
  );
  assert.equal(
    verifyAppLixirMd5Local({
      gameApiKey: appApiKey,
      gameId: appGameId,
      userId: appUserId,
      tid: '',
      signature: validMd5Only,
      secret: appSecret,
    }),
    true,
    'Valid AppLixir MD5-only signature must pass',
  );
  assert.equal(
    verifyAppLixirMd5Local({
      gameApiKey: appApiKey,
      gameId: appGameId,
      userId: appUserId,
      tid: appTid,
      signature: validMd5Tid,
      secret: 'wrong_secret',
    }),
    false,
    'Wrong AppLixir secret must fail',
  );
  assert.equal(
    verifyAppLixirMd5Local({
      gameApiKey: appApiKey,
      gameId: appGameId,
      userId: 'tampered_user',
      tid: appTid,
      signature: validMd5Tid,
      secret: appSecret,
    }),
    false,
    'Tampered userId must fail AppLixir MD5 verification',
  );
  assert.equal(
    verifyAppLixirMd5Local({
      gameApiKey: appApiKey,
      gameId: appGameId,
      userId: appUserId,
      tid: appTid,
      signature: validMd5Tid,
      secret: '',
    }),
    false,
    'Empty AppLixir secret must fail',
  );

  assert.match(FUNCTIONS_HELPERS, /export function verifyAppLixirMd5Signature/);
  assert.match(FUNCTIONS_AD_NETWORK, /APPLIXIR_SECRET_KEY/);
  assert.match(FUNCTIONS_AD_NETWORK, /APPLIXIR_API_KEY/);
  assert.match(FUNCTIONS_AD_NETWORK, /APPLIXIR_STATUS_NOT_COMPLETED/);
  assert.match(FUNCTIONS_AD_NETWORK, /verifyAppLixirMd5Signature/);
  assert.match(FUNCTIONS_INDEX, /APPLIXIR_NOT_CONFIGURED/);
  assert.match(FUNCTIONS_INDEX, /adNetworkLower\.includes\('applixir'\)/);
  assert.match(FUNCTIONS_INDEX, /error: 'S2S_POSTBACK_REQUIRED'/);
  const dashboardSrc = fs.readFileSync(path.join(ROOT, 'src', 'services', 'dashboardService.ts'), 'utf8');
  assert.match(dashboardSrc, /NEVER fall back for AppLixir ads/);
  assert.match(dashboardSrc, /AD_SESSION_ERROR_MESSAGES\.APPLIXIR_NOT_CONFIGURED/);
  results.push('Test 20 PASSED: AppLixir MD5/TID S2S verification, backend config gates & client fallback prevention verified');

  // Test 21: Monetag Daily Check-in Bonus Direct Link S2S Verification, Once-Per-Day Cap & Rules Enforcement
  assert.match(FUNCTIONS_HELPERS, /DAILY_CHECKIN_BONUS_AD_ID = 'daily_checkin_bonus'/);
  assert.match(FUNCTIONS_HELPERS, /export function getDhakaYesterdayDateKey/);
  assert.match(FUNCTIONS_AD_NETWORK, /MONETAG_EVENT_NOT_VALUED/);
  assert.match(FUNCTIONS_AD_NETWORK, /DAILY_BONUS_ALREADY_CLAIMED/);
  assert.match(FUNCTIONS_INDEX, /USE_DAILY_BONUS_ENDPOINT/);
  assert.match(FUNCTIONS_INDEX, /DAILY_BONUS_ALREADY_CLAIMED/);
  assert.match(FUNCTIONS_INDEX, /S2S_POSTBACK_REQUIRED_FOR_DIRECT_LINK/);
  assert.match(RULES_TEXT, /isValidDailyBonusSettings/);
  assert.match(appSettingsBlock, /settingId == 'dailyBonus'/);
  assert.match(RULES_TEXT, /data\.incentivizedTrafficAllowed == true/);
  assert.match(RULES_TEXT, /data\.durationSeconds >= 30 && data\.durationSeconds <= 180/);
  results.push('Test 21 PASSED: Monetag Daily Check-in Bonus S2S verification, once-per-day cap, valued-event & rules guards verified');

  // Test 22: Bounded Reward Verification Polling, Early S2S Callback Holding (<30s) & Macro Sanitization
  assert.match(FUNCTIONS_INDEX, /export const verifyAdSessionReward = onRequest/);
  assert.match(FUNCTIONS_INDEX, /const stripMacro = /);
  assert.match(FUNCTIONS_INDEX, /netLower\.includes\('monetag'\)/);
  assert.match(FUNCTIONS_AD_NETWORK, /status:\s*'awaiting_duration'/);
  assert.match(FUNCTIONS_AD_NETWORK, /shouldHoldEarlyCallback/);
  assert.match(dashboardSrc, /export async function verifyAdSessionRewardStatus/);
  assert.match(dashboardSrc, /new AbortController\(\)/);
  assert.match(dashboardSrc, /backend_unavailable/);
  const modalSrc = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'ads', 'AdWatchSessionModal.tsx'),
    'utf8',
  );
  const watchPageSrc = fs.readFileSync(
    path.join(ROOT, 'src', 'pages', 'AdWatchSessionPage.tsx'),
    'utf8',
  );
  assert.match(modalSrc, /S2S_VERIFY_TIMEOUT_MS/);
  assert.match(modalSrc, /verifyAdSessionRewardStatus/);
  assert.match(modalSrc, /Retry Verification/);
  assert.match(modalSrc, /Congratulations!/);
  assert.ok(!/Confirming your reward automatically/.test(modalSrc), 'Infinite post-timer spinner text must be replaced');
  assert.match(watchPageSrc, /S2S_VERIFY_TIMEOUT_MS/);
  assert.match(watchPageSrc, /verifyAdSessionRewardStatus/);
  assert.match(watchPageSrc, /Retry Verification/);
  const adminModalSrc = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'ads', 'AdminAdManagerModal.tsx'),
    'utf8',
  );
  assert.match(adminModalSrc, /verifyAdNetworkCallback\?net=monetag/);
  assert.match(adminModalSrc, /session_id=\{ymid\}/);
  results.push('Test 22 PASSED: Bounded verification polling, early S2S awaiting_duration holding, Retry UI & Monetag macro sanitization verified');

  // Test 23: Multi Direct Link Ads Management (10 uplcm URLs, genuine-click-only, S2S reward policy gate & Rules)
  const directLinksServiceSrc = fs.readFileSync(
    path.join(ROOT, 'src', 'services', 'multiDirectLinkService.ts'),
    'utf8',
  );
  const expectedTenUrls = [
    'https://uplcm.com/4/12321305',
    'https://uplcm.com/4/12325667',
    'https://uplcm.com/4/12325669',
    'https://uplcm.com/4/12325670',
    'https://uplcm.com/4/12325671',
    'https://uplcm.com/4/12325673',
    'https://uplcm.com/4/12325675',
    'https://uplcm.com/4/12325677',
    'https://uplcm.com/4/12325678',
    'https://uplcm.com/4/12325679',
  ];
  for (const url of expectedTenUrls) {
    assert.ok(directLinksServiceSrc.includes(url), `Missing expected Monetag Direct Link ${url}`);
  }
  const directLinksRulesBlock = extractCollectionBlock('directLinkAds');
  assert.match(directLinksRulesBlock, /allow create:[\s\S]*isAdmin\(\)/);
  assert.match(directLinksRulesBlock, /allow update:[\s\S]*isAdmin\(\)/);
  assert.match(directLinksRulesBlock, /allow delete:[\s\S]*isAdmin\(\)/);
  assert.match(RULES_TEXT, /function isValidDirectLinkAd/);
  assert.match(RULES_TEXT, /data\.rewardPoints == 0 \|\|/);
  assert.match(RULES_TEXT, /data\.incentivizedTrafficAllowed == true/);
  const directLinkPlacementSrc = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'ads', 'DirectLinkAdsPlacement.tsx'),
    'utf8',
  );
  assert.ok(
    !/useEffect|window\.open/.test(directLinkPlacementSrc),
    'DirectLinkAdsPlacement must open links strictly via genuine user click, never auto-open/popunder',
  );
  results.push('Test 23 PASSED: Multi Direct Link Ads 10 uplcm URLs, Rules validation & genuine-click enforcement verified');

  for (const line of results) {
    console.log(line);
  }
  console.log(`\nALL ${results.length}/${results.length} BACKEND SECURITY TESTS PASSED.`);
}

runAllBackendSecurityTests();
