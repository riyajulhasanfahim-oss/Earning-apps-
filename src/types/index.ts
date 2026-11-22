export type AppPage =
  | 'splash'
  | 'login'
  | 'register'
  | 'verify-email'
  | 'home'
  | 'earn'
  | 'watch-ad'
  | 'ad-history'
  | 'referral'
  | 'wallet'
  | 'withdraw'
  | 'withdrawal-history'
  | 'transactions'
  | 'profile';

export type NavTab = 'home' | 'earn' | 'referral' | 'wallet' | 'profile';

export type PaymentMethodId = 'bkash' | 'nagad' | 'rocket' | 'bank';

export type MfsAccountType = 'personal' | 'agent' | 'merchant' | 'bank_account';

export type WithdrawalStatus =
  | 'pending'
  | 'processing'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'cancelled';

export type TransactionType =
  | 'ad_reward'
  | 'daily_bonus'
  | 'referral_bonus'
  | 'withdrawal'
  | 'admin_credit'
  | 'admin_debit'
  | 'refund'
  | 'admin_adjustment';

export type TransactionDirection = 'credit' | 'debit';

export type TransactionStatus = 'completed' | 'pending' | 'rejected' | 'reversed';

export type AccountStatus = 'active' | 'restricted' | 'suspended' | 'banned';

export type AdType = 'rewarded' | 'direct_link' | 'other';

export type AdCategoryFilter = 'all' | AdType;

export type RewardVerificationMethod = 's2s_postback' | 'sdk_callback' | 'none';

export type AdSessionStatus = 'pending' | 'completed' | 'rejected';

export type AdHistoryFilter = 'all' | 'completed' | 'pending' | 'rejected';

export type AdminRole = 'super_admin' | 'admin' | 'support_admin';

export interface AppCheckState {
  enabled: boolean;
  provider: 'recaptcha_v3' | 'none';
  siteKeyConfigured: boolean;
  debugMode: boolean;
}

export interface FirestoreUserDoc {
  uid: string;
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  profileImage: string;
  referralCode: string;
  referredBy: string;
  points: number;
  totalEarnings: number;
  totalAdViews: number;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  createdAt?: unknown;
}

export interface UserProfile extends FirestoreUserDoc {
  level: 'Bronze Member' | 'Silver Member' | 'Gold Member' | 'Platinum Member';
  verified: boolean;
  referralLink: string;
  joinedAt: string;
}

export interface EconomyConfig {
  pointsPerBdt: number | null;
  dailyBonusPoints: number | null;
  minimumWithdrawPoints: number | null;
  maximumWithdrawAmountBdt: number | null;
  dailyAdLimit: number;
  walletEnabled: boolean;
  earningEnabled: boolean;
}

export interface WalletDocRecord {
  userId: string;
  totalPoints: number;
  availablePoints: number;
  pendingPoints: number;
  reservedPoints: number;
  totalEarnedPoints: number;
  totalWithdrawnPoints: number;
  totalWithdrawnBdt: number;
  updatedAtMillis: number;
}

export interface WalletLedgerEntry {
  id: string;
  entryId: string;
  transactionId: string;
  userId: string;
  entryType: 'credit' | 'debit' | 'reserve' | 'release';
  transactionType: TransactionType;
  pointsDelta: number;
  bdtAmount: number;
  conversionRateUsed: number | null;
  previousPoints: number;
  newPoints: number;
  previousReservedPoints: number;
  newReservedPoints: number;
  status: TransactionStatus;
  description: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface DailyBonusState {
  streakDays: number;
  lastClaimDate: string;
  lastClaimPoints: number;
  claimedToday: boolean;
}

export interface DailyBonusAdConfig {
  enabled: boolean;
  monetagDirectLinkUrl: string;
  rewardPoints: number | null;
  durationSeconds: number;
  incentivizedTrafficAllowed: boolean;
}

export interface WalletMetrics {
  totalPoints: number;
  balancePoints: number;
  availablePoints: number;
  pendingPoints: number;
  reservedPoints: number;
  withdrawablePoints: number;
  pointsPerBdt: number | null;
  todayViews: number;
  todayEarningsPoints: number;
  totalReferrals: number;
  totalEarnedPoints: number;
  totalWithdrawnPoints: number;
  totalWithdrawnBdt: number;
  adViewsEarnedPoints: number;
  referralBonusPoints: number;
  dailyBonusEarnedPoints: number;
  minimumWithdrawPoints: number | null;
  maximumWithdrawAmountBdt: number | null;
}

export interface Advertisement {
  id: string;
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
  createdAtMillis: number;
  updatedAtMillis: number;
}

export interface AdSessionRecord {
  id: string;
  sessionId: string;
  userId: string;
  adId: string;
  adName: string;
  adNetwork: string;
  expectedRewardPoints: number;
  dhakaDate: string;
  status: AdSessionStatus;
  transactionId: string;
  rejectionReason: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface AdCompletionRecord {
  id: string;
  completionId: string;
  providerTxId: string;
  sessionId: string;
  userId: string;
  adId: string;
  adName: string;
  adNetwork: string;
  rewardPoints: number;
  transactionId: string;
  dhakaDate: string;
  status: 'completed' | 'rejected';
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface DailyAdLimitRecord {
  userId: string;
  dhakaDate: string;
  completedCount: number;
  earnedPoints: number;
  completedAdIds: string[];
}

export interface AdHistoryItem {
  id: string;
  adId: string;
  adName: string;
  adNetwork: string;
  watchedDate: string;
  dhakaDate: string;
  rewardPoints: number;
  status: AdSessionStatus;
  transactionId: string;
  rejectionReason?: string;
  createdAtMillis: number;
}

export interface FraudLogRecord {
  id: string;
  userId: string;
  reason: string;
  details: string;
  severity: 'low' | 'medium' | 'high';
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface TransactionRecord {
  id: string;
  transactionId: string;
  userId: string;
  title: string;
  subtitle: string;
  description: string;
  type: TransactionType;
  direction: TransactionDirection;
  pointsDelta: number;
  points: number;
  bdtAmount: number | null;
  conversionRateUsed: number | null;
  timestamp: string;
  dhakaDate: string;
  createdAtMillis: number;
  status: TransactionStatus;
}

export interface PaymentMethodConfig {
  id: PaymentMethodId;
  name: string;
  bengaliName?: string;
  enabled: boolean;
  minPoints: number | null;
  feePercent: number;
  processingWindow: string;
  allowedAccountTypes: MfsAccountType[];
  accountHint: string;
}

export interface WithdrawalSettingsConfig {
  withdrawalEnabled: boolean;
  minimumWithdrawPoints: number | null;
  maximumWithdrawBdt: number | null;
  defaultFeePercent: number;
  dailyLimitBdt: number | null;
  dailyLimitCount: number;
  monthlyLimitBdt: number | null;
  processingTimeLabel: string;
  allowedMethods: PaymentMethodId[];
}

export interface WithdrawalRequestRecord {
  id: string;
  requestId: string;
  transactionId: string;
  userId: string;
  methodId: PaymentMethodId;
  accountNumber: string;
  maskedAccountNumber: string;
  accountType: MfsAccountType;
  optionalNote: string;
  pointsReserved: number;
  grossBdt: number;
  feeBdt: number;
  netBdt: number;
  conversionRateUsed: number;
  dhakaDate: string;
  dhakaMonth: string;
  status: WithdrawalStatus;
  payoutTransactionId: string;
  rejectionReason: string;
  requestDateLabel: string;
  processingDateLabel: string;
  paidAtLabel: string;
  createdAtMillis: number;
}

export interface AdminLogRecord {
  id: string;
  logId: string;
  adminUid: string;
  adminEmail: string;
  adminRole?: AdminRole;
  action: string;
  targetId: string;
  previousValue?: string;
  newValue?: string;
  metadata?: string;
  details: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface SiteSettingsConfig {
  websiteName: string;
  websiteTitle: string;
  websiteLogoUrl: string;
  websiteFaviconUrl: string;
  loadingLogoUrl: string;
  websiteDescription: string;
  primaryColor: string;
  secondaryColor: string;
  loginBrandingTitle: string;
  loginBrandingSubtitle: string;
  headerBrandText: string;
  footerText: string;
  supportEmail: string;
  supportContact: string;
  maintenanceMode: boolean;
  registrationEnabled: boolean;
}

export interface FirebaseProjectConfig {
  projectId: string;
  projectName: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
  firestoreDatabaseId: string;
}

export interface FirebaseProjectBackupEntry {
  id: string;
  label: string;
  backedUpAtIso: string;
  backedUpByEmail: string;
  isBundledDefault?: boolean;
  config: FirebaseProjectConfig;
}

export type FirebaseWizardStepKey =
  | 'connection'
  | 'auth'
  | 'firestore'
  | 'collections'
  | 'storage'
  | 'security_rules'
  | 'activation';

export type FirebaseWizardStepStatus = 'idle' | 'running' | 'success' | 'warning' | 'error';

export interface FirebaseWizardStepResult {
  status: FirebaseWizardStepStatus;
  summary: string;
  details: string[];
  checkedAtIso?: string;
}

export interface FirebaseCollectionSetupResult {
  collection: string;
  category: 'core' | 'config' | 'ads' | 'finance' | 'security' | 'admin';
  status: 'created' | 'existing' | 'verified' | 'permission_denied' | 'error';
  seededDocs: string[];
  detail: string;
}

export interface AdminMarkerRecord {
  uid: string;
  role: AdminRole;
  email: string;
  assignedBy: string;
  grantedAtLabel: string;
  updatedAtLabel: string;
}

export interface FailedTransactionLogRecord {
  id: string;
  logId: string;
  userId: string;
  operation: string;
  errorCode: string;
  transactionId: string;
  details: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface ReconciliationReportRecord {
  id: string;
  reportId: string;
  userId: string;
  walletTotalPoints: number;
  walletReservedPoints: number;
  ledgerNetPoints: number;
  ledgerReservedPoints: number;
  discrepancyPoints: number;
  status: 'matched' | 'mismatch_detected' | 'resolved';
  details: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface SystemErrorRecord {
  id: string;
  errorId: string;
  userId: string;
  source: 'client' | 'cloud_function' | 'app_check' | 'firestore';
  operation: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  createdAtLabel: string;
  createdAtMillis: number;
}

export type AdminSectionKey =
  | 'overview'
  | 'users'
  | 'points'
  | 'withdrawals'
  | 'ads'
  | 'multi-direct-links'
  | 'ad-networks'
  | 'referrals'
  | 'security-fraud'
  | 'branding'
  | 'firebase-project'
  | 'settings'
  | 'audit-logs';

export type AnalyticsRangeKey = 'today' | '7d' | '30d' | 'month' | 'custom';

export interface AdminNotificationItem {
  id: string;
  category: 'new_user' | 'pending_withdrawal' | 'fraud_alert' | 'system_error' | 'failed_tx';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timeLabel: string;
  createdAtMillis: number;
  read: boolean;
  targetSection: AdminSectionKey;
}

export type ReferralQualificationStatus =
  | 'registered'
  | 'pending'
  | 'qualified'
  | 'rewarded'
  | 'rejected';

export type ReferralRewardStatus = 'pending' | 'credited' | 'rejected';

export interface ReferredUser {
  id: string;
  referralId: string;
  referrerUid: string;
  referredUid: string;
  name: string;
  referredUsername: string;
  maskedUsername: string;
  referralCodeUsed: string;
  joinedDate: string;
  createdAtMillis: number;
  qualificationStatus: ReferralQualificationStatus;
  rewardStatus: ReferralRewardStatus;
  rewardPoints: number;
  bonusEarnedPoints: number;
  newUserBonusPoints: number;
  rejectionReason: string;
  tierLabel: string;
}

export interface ReferralSettingsConfig {
  referralEnabled: boolean;
  referrerBonusPoints: number | null;
  newUserBonusPoints: number | null;
  minimumQualificationAds: number;
  requireEmailVerified: boolean;
  requireActiveAccount: boolean;
  maxReferralsPerUser: number | null;
  dailyReferralCap: number;
  referralRulesText: string;
}

export interface ReferralRewardRecord {
  id: string;
  rewardId: string;
  referralId: string;
  referrerUid: string;
  referredUid: string;
  referrerBonusPoints: number;
  newUserBonusPoints: number;
  transactionId: string;
  newUserTransactionId: string;
  status: 'credited' | 'reversed';
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface ReferralLogRecord {
  id: string;
  logId: string;
  referrerUid: string;
  referredUid: string;
  eventType: string;
  severity: 'low' | 'medium' | 'high';
  details: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface ReferralLeaderboardEntry {
  uid: string;
  publicUsername: string;
  totalQualifiedReferrals: number;
  totalReferralRewards: number;
  updatedAtMillis: number;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timeLabel: string;
  read: boolean;
  fromFirestore?: boolean;
}

export interface WithdrawValidationResult {
  valid: boolean;
  error?: string;
  grossBdt: number;
  feeBdt: number;
  netBdt: number;
  pointsRequired: number;
}

export interface RegisterPayload {
  fullName: string;
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
  referralCode?: string;
}

export type AdNetworkLogoKey = 'monetag' | 'applixir' | 'adsterra' | 'custom';

export interface AppLixirEnvCredentialsStatus {
  siteIdConfigured: boolean;
  apiKeyConfigured: boolean;
  secretKeyConfigured: boolean;
}

export type AdNetworkIntegrationType =
  | 's2s_postback'
  | 'sdk_callback'
  | 'direct_link'
  | 'hybrid';

export type AdNetworkHealthStatus =
  | 'connected'
  | 'configuration_required'
  | 'verification_pending'
  | 'error'
  | 'disabled';

export interface AdNetworkConfig {
  id: string;
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
  secretConfigured: boolean;
  secretHint: string;
  healthStatus: AdNetworkHealthStatus;
  healthMessage: string;
  enabled: boolean;
  lastTestedAt: string;
  updatedAtLabel: string;
  updatedAtMillis: number;
}

export interface AdPlacementRecord {
  id: string;
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
  updatedAtLabel: string;
  updatedAtMillis: number;
}

export interface AdCampaignRecord {
  id: string;
  campaignId: string;
  campaignName: string;
  networkId: string;
  networkName: string;
  placementId: string;
  campaignType: AdType;
  rewardPoints: number;
  dailyUserLimit: number;
  globalDailyLimit: number;
  globalCompletedToday: number;
  globalCompletedDhakaDate: string;
  estimatedDuration: number;
  startDate: string;
  endDate: string;
  targetCountries: string;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
  rewardEligible: boolean;
  status: 'active' | 'inactive';
  linkedAdId: string;
  updatedAtLabel: string;
  updatedAtMillis: number;
}

export type AdCallbackStatus =
  | 'processed'
  | 'awaiting_duration'
  | 'rejected'
  | 'duplicate'
  | 'expired'
  | 'invalid_signature';

export interface AdCallbackRecord {
  id: string;
  callbackId: string;
  eventId: string;
  networkId: string;
  campaignId: string;
  sessionId: string;
  userId: string;
  status: AdCallbackStatus;
  signatureValid: boolean;
  timestampValid: boolean;
  replayDetected: boolean;
  rewardPoints: number;
  rejectionReason: string;
  callbackTimestampSec: number;
  createdAtLabel: string;
  createdAtMillis: number;
}

export interface AdAnalyticsRecord {
  id: string;
  analyticsId: string;
  networkId: string;
  networkName: string;
  dhakaDate: string;
  impressions: number;
  clicks: number | null;
  clicksSupported: boolean;
  verifiedCompletions: number;
  rejectedCompletions: number;
  totalRewardsDistributed: number;
  updatedAtLabel: string;
  updatedAtMillis: number;
}

export interface AdNetworkLogRecord {
  id: string;
  logId: string;
  networkId: string;
  actorUid: string;
  actorEmail: string;
  eventType: string;
  severity: 'info' | 'warning' | 'error';
  status: string;
  details: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export type FraudReportCategory =
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

export interface FraudReportRecord {
  id: string;
  reportId: string;
  category: FraudReportCategory;
  riskLevel: FraudRiskLevel;
  riskScore: number;
  reviewStatus: FraudReviewStatus;
  userId: string;
  userEmail: string;
  userName: string;
  title: string;
  details: string;
  signals: string[];
  relatedTxId: string;
  actionTaken: string;
  reviewedBy: string;
  reviewedEmail: string;
  resolutionNote: string;
  falsePositiveProtected: boolean;
  createdAtLabel: string;
  createdAtMillis: number;
  updatedAtLabel: string;
  updatedAtMillis: number;
}

export type SecurityAuditCategory =
  | 'auth'
  | 'wallet'
  | 'ad_reward'
  | 'withdrawal'
  | 'referral'
  | 'admin'
  | 'account_restriction'
  | 'security';

export interface SecurityAuditLogRecord {
  id: string;
  logId: string;
  userId: string;
  eventType: string;
  category: SecurityAuditCategory;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  transactionId: string;
  riskScore: number | null;
  details: string;
  metadata: string;
  createdAtLabel: string;
  createdAtMillis: number;
}

export type DirectLinkPlacement =
  | 'home_page'
  | 'available_ads'
  | 'watch_ads'
  | 'daily_bonus'
  | 'featured_section';

export interface DirectLinkAdRecord {
  id: string;
  linkId: string;
  title: string;
  url: string;
  adNetwork: string;
  placement: DirectLinkPlacement;
  rewardPoints: number;
  estimatedDuration: number;
  dailyLimit: number;
  status: 'active' | 'inactive';
  incentivizedTrafficAllowed: boolean;
  rewardVerificationMethod: RewardVerificationMethod;
  sortOrder: number;
  notes: string;
  createdAtMillis: number;
  updatedAtMillis: number;
}



