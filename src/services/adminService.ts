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
  AccountStatus,
  AdCompletionRecord,
  AdminLogRecord,
  AdminMarkerRecord,
  AdminNotificationItem,
  AdminRole,
  AdSessionRecord,
  Advertisement,
  AnalyticsRangeKey,
  DailyAdLimitRecord,
  FailedTransactionLogRecord,
  FraudLogRecord,
  FraudReportRecord,
  ReconciliationReportRecord,
  ReferralRewardRecord,
  ReferredUser,
  SiteSettingsConfig,
  SystemErrorRecord,
  TransactionDirection,
  TransactionRecord,
  TransactionStatus,
  TransactionType,
  UserProfile,
  WalletDocRecord,
  WithdrawalRequestRecord,
} from '../types';
import { formatDhakaDateTime, getDhakaDateKey, getDhakaMonthKey, pointsToBdt } from './appService';
import { toUserProfile } from './authService';

export type AdminPermission =
  | 'view_analytics'
  | 'view_audit_logs'
  | 'manage_users'
  | 'delete_users'
  | 'adjust_points'
  | 'manage_withdrawals'
  | 'manage_ads'
  | 'manage_referrals'
  | 'manage_economy_settings'
  | 'manage_site_settings'
  | 'manage_admin_roles'
  | 'export_backup';

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  super_admin: [
    'view_analytics',
    'view_audit_logs',
    'manage_users',
    'delete_users',
    'adjust_points',
    'manage_withdrawals',
    'manage_ads',
    'manage_referrals',
    'manage_economy_settings',
    'manage_site_settings',
    'manage_admin_roles',
    'export_backup',
  ],
  admin: [
    'view_analytics',
    'view_audit_logs',
    'manage_users',
    'adjust_points',
    'manage_withdrawals',
    'manage_ads',
    'manage_referrals',
    'manage_economy_settings',
  ],
  support_admin: ['view_analytics', 'view_audit_logs'],
};

export function hasAdminPermission(
  role: AdminRole | null,
  permission: AdminPermission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export interface VerifiedAdminSession {
  authorized: boolean;
  role: AdminRole | null;
  claimRole: AdminRole | null;
  claimsVerified: boolean;
  emailVerified: boolean;
  verificationSource: 'custom_claims' | 'admins_doc' | 'bootstrap_super_admin' | 'unauthorized';
  reason?: string;
}

export async function verifyAdminAccessSession(): Promise<VerifiedAdminSession> {
  const user = auth.currentUser;
  if (!user) {
    return {
      authorized: false,
      role: null,
      claimRole: null,
      claimsVerified: false,
      emailVerified: false,
      verificationSource: 'unauthorized',
      reason: 'No authenticated session.',
    };
  }

  try {
    await user.reload();
  } catch {
    // Non-fatal if offline
  }

  const emailVerified = Boolean(user.emailVerified);
  if (!emailVerified) {
    return {
      authorized: false,
      role: null,
      claimRole: null,
      claimsVerified: false,
      emailVerified: false,
      verificationSource: 'unauthorized',
      reason: 'Email verification is mandatory for Admin Panel access.',
    };
  }

  let claimRole: AdminRole | null = null;
  try {
    const tokenResult = await user.getIdTokenResult(true);
    const raw = tokenResult.claims?.adminRole;
    if (raw === 'super_admin' || raw === 'admin' || raw === 'support_admin') {
      claimRole = raw;
    }
  } catch {
    claimRole = null;
  }

  // Server-enforced Firestore Rules verification (never rely on client-side email string alone)
  try {
    await getDocsFromServer(query(collection(db, 'admins'), limit(1)));
    return {
      authorized: true,
      role: claimRole ?? 'super_admin',
      claimRole,
      claimsVerified: Boolean(claimRole),
      emailVerified: true,
      verificationSource: claimRole ? 'custom_claims' : 'bootstrap_super_admin',
    };
  } catch {
    // Not a super_admin according to Firestore backend rules; check admin/support tier
  }

  try {
    const adminSnap = await getDocFromServer(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      await getDocsFromServer(query(collection(db, 'adminLogs'), limit(1)));
      const r = String(adminSnap.data()?.role || 'admin');
      const docRole: AdminRole =
        r === 'super_admin' || r === 'admin' || r === 'support_admin' ? r : 'admin';
      return {
        authorized: true,
        role: claimRole ?? docRole,
        claimRole,
        claimsVerified: Boolean(claimRole),
        emailVerified: true,
        verificationSource: claimRole ? 'custom_claims' : 'admins_doc',
      };
    }
  } catch {
    // Denied by Firestore rules -> regular user
  }

  if (claimRole) {
    try {
      await getDocsFromServer(query(collection(db, 'adminLogs'), limit(1)));
      return {
        authorized: true,
        role: claimRole,
        claimRole,
        claimsVerified: true,
        emailVerified: true,
        verificationSource: 'custom_claims',
      };
    } catch {
      // Custom claim not accepted by Firestore backend rules
    }
  }

  return {
    authorized: false,
    role: null,
    claimRole: null,
    claimsVerified: false,
    emailVerified,
    verificationSource: 'unauthorized',
    reason: 'Unauthorized: This account does not hold verified Admin privileges.',
  };
}

export function getDefaultSiteSettings(): SiteSettingsConfig {
  return {
    websiteName: 'AdView Earn',
    websiteTitle: 'AdView Earn — Watch Ads, Earn Points & Withdraw',
    websiteLogoUrl: '',
    websiteFaviconUrl: '',
    loadingLogoUrl: '',
    websiteDescription:
      'Watch verified advertisements, earn reward points, invite friends, and withdraw securely via bKash, Nagad, Rocket & Bank Transfer.',
    primaryColor: '#7c3aed',
    secondaryColor: '#2563eb',
    loginBrandingTitle: 'Welcome Back',
    loginBrandingSubtitle: 'Sign in cleanly with Email or Google',
    headerBrandText: 'AdView Earn',
    footerText: 'AdView Earn · Rewarded Advertising & Wallet Platform',
    supportEmail: 'support@adviewearn.com',
    supportContact: '',
    maintenanceMode: false,
    registrationEnabled: true,
  };
}

function formatTs(ts: unknown): { label: string; millis: number } {
  if (ts instanceof Timestamp) {
    const ms = ts.toDate().getTime();
    return { millis: ms, label: formatDhakaDateTime(ms) };
  }
  return { millis: 0, label: 'Recent' };
}

function buildClientMetadata(source = 'admin_web'): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  return `source=${source}; ua=${ua}`.slice(0, 500);
}

export async function recordAdminAuditLogClient(params: {
  adminUser: { uid: string; email: string; role: AdminRole | null };
  action: string;
  targetId: string;
  previousValue?: string;
  newValue?: string;
  details: string;
}): Promise<void> {
  const logId = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'adminLogs', logId), {
      logId,
      adminUid: params.adminUser.uid,
      adminEmail: params.adminUser.email || 'admin@adviewearn.com',
      ...(params.adminUser.role ? { adminRole: params.adminUser.role } : {}),
      action: params.action.slice(0, 80),
      targetId: params.targetId.slice(0, 128),
      ...(params.previousValue !== undefined
        ? { previousValue: params.previousValue.slice(0, 500) }
        : {}),
      ...(params.newValue !== undefined
        ? { newValue: params.newValue.slice(0, 500) }
        : {}),
      metadata: buildClientMetadata(),
      details: params.details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log attempt
  }
}

export function subscribeToSiteSettings(
  onData: (config: SiteSettingsConfig) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, 'appSettings', 'site'),
    (snap) => {
      const def = getDefaultSiteSettings();
      if (!snap.exists()) {
        onData(def);
        return;
      }
      const d = snap.data();
      const siteName = String(d.websiteName || def.websiteName);
      const rawPrimary = String(d.primaryColor || '').trim();
      const rawSecondary = String(d.secondaryColor || '').trim();
      onData({
        websiteName: siteName,
        websiteTitle: String(d.websiteTitle || `${siteName} — Watch Ads, Earn Points & Withdraw`),
        websiteLogoUrl: String(d.websiteLogoUrl || ''),
        websiteFaviconUrl: String(d.websiteFaviconUrl || ''),
        loadingLogoUrl: String(d.loadingLogoUrl || ''),
        websiteDescription: String(d.websiteDescription || def.websiteDescription),
        primaryColor: /^#[0-9a-fA-F]{6}$/.test(rawPrimary) ? rawPrimary.toLowerCase() : def.primaryColor,
        secondaryColor: /^#[0-9a-fA-F]{6}$/.test(rawSecondary)
          ? rawSecondary.toLowerCase()
          : def.secondaryColor,
        loginBrandingTitle: String(d.loginBrandingTitle || def.loginBrandingTitle),
        loginBrandingSubtitle: String(d.loginBrandingSubtitle || def.loginBrandingSubtitle),
        headerBrandText: String(d.headerBrandText || siteName),
        footerText: String(d.footerText || `${siteName} · Rewarded Advertising & Wallet Platform`),
        supportEmail: String(d.supportEmail || def.supportEmail),
        supportContact: String(d.supportContact || ''),
        maintenanceMode: Boolean(d.maintenanceMode),
        registrationEnabled:
          typeof d.registrationEnabled === 'boolean' ? d.registrationEnabled : true,
      });
    },
    (error) => {
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
  );
}

export function subscribeToAllUsers(
  onData: (users: UserProfile[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const items = snap.docs.map((d) => {
        const raw = d.data();
        const profile = toUserProfile({
          uid: String(raw.uid || d.id),
          fullName: String(raw.fullName || 'Member'),
          username: String(raw.username || 'member'),
          email: String(raw.email || ''),
          phoneNumber: String(raw.phoneNumber || ''),
          profileImage: String(raw.profileImage || ''),
          referralCode: String(raw.referralCode || ''),
          referredBy: String(raw.referredBy || ''),
          points: Number(raw.points || 0),
          totalEarnings: Number(raw.totalEarnings || 0),
          totalAdViews: Number(raw.totalAdViews || 0),
          accountStatus:
            raw.accountStatus === 'restricted' ||
            raw.accountStatus === 'suspended' ||
            raw.accountStatus === 'banned'
              ? raw.accountStatus
              : 'active',
          emailVerified: Boolean(raw.emailVerified),
          createdAt: raw.createdAt,
        });
        return profile;
      });
      items.sort((a, b) => {
        const aMs = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0;
        const bMs = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0;
        return bMs - aMs;
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllWallets(
  onData: (wallets: WalletDocRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'wallets'),
    (snap) => {
      const items: WalletDocRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { millis } = formatTs(data.updatedAt);
        return {
          userId: String(data.userId || d.id),
          totalPoints: Number(data.totalPoints || 0),
          availablePoints: Number(data.availablePoints ?? data.totalPoints ?? 0),
          pendingPoints: Number(data.pendingPoints || 0),
          reservedPoints: Number(data.reservedPoints || 0),
          totalEarnedPoints: Number(data.totalEarnedPoints || 0),
          totalWithdrawnPoints: Number(data.totalWithdrawnPoints || 0),
          totalWithdrawnBdt: Number(data.totalWithdrawnBdt || 0),
          updatedAtMillis: millis,
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'wallets');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllTransactions(
  onData: (txs: TransactionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'transactions'),
    (snap) => {
      const items: TransactionRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
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
          userId: String(data.userId || ''),
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
        handleFirestoreError(error, OperationType.LIST, 'transactions');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllAdSessions(
  onData: (sessions: AdSessionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adSessions'),
    (snap) => {
      const items: AdSessionRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        const rawStatus = String(data.status || 'pending');
        const status =
          rawStatus === 'completed' || rawStatus === 'rejected' ? rawStatus : 'pending';
        return {
          id: d.id,
          sessionId: String(data.sessionId || d.id),
          userId: String(data.userId || ''),
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
        handleFirestoreError(error, OperationType.LIST, 'adSessions');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllAdCompletions(
  onData: (completions: AdCompletionRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'adCompletions'),
    (snap) => {
      const items: AdCompletionRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        return {
          id: d.id,
          completionId: String(data.completionId || d.id),
          providerTxId: String(data.providerTxId || ''),
          sessionId: String(data.sessionId || ''),
          userId: String(data.userId || ''),
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
        handleFirestoreError(error, OperationType.LIST, 'adCompletions');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllDailyAdLimits(
  onData: (records: DailyAdLimitRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'dailyAdLimits'),
    (snap) => {
      const items: DailyAdLimitRecord[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          userId: String(data.userId || ''),
          dhakaDate: String(data.dhakaDate || ''),
          completedCount: Number(data.completedCount || 0),
          earnedPoints: Number(data.earnedPoints || 0),
          completedAdIds: Array.isArray(data.completedAdIds)
            ? data.completedAdIds.map((x) => String(x))
            : [],
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'dailyAdLimits');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllReferralRewards(
  onData: (rewards: ReferralRewardRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'referralRewards'),
    (snap) => {
      const items: ReferralRewardRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        return {
          id: d.id,
          rewardId: String(data.rewardId || d.id),
          referralId: String(data.referralId || ''),
          referrerUid: String(data.referrerUid || ''),
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
        handleFirestoreError(error, OperationType.LIST, 'referralRewards');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToFailedTransactionLogs(
  onData: (logs: FailedTransactionLogRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'failedTransactionLogs'),
    (snap) => {
      const items: FailedTransactionLogRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        return {
          id: d.id,
          logId: String(data.logId || d.id),
          userId: String(data.userId || ''),
          operation: String(data.operation || ''),
          errorCode: String(data.errorCode || ''),
          transactionId: String(data.transactionId || ''),
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
        handleFirestoreError(error, OperationType.LIST, 'failedTransactionLogs');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToReconciliationReports(
  onData: (reports: ReconciliationReportRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'reconciliationReports'),
    (snap) => {
      const items: ReconciliationReportRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        const st = String(data.status || 'matched');
        return {
          id: d.id,
          reportId: String(data.reportId || d.id),
          userId: String(data.userId || ''),
          walletTotalPoints: Number(data.walletTotalPoints || 0),
          walletReservedPoints: Number(data.walletReservedPoints || 0),
          ledgerNetPoints: Number(data.ledgerNetPoints || 0),
          ledgerReservedPoints: Number(data.ledgerReservedPoints || 0),
          discrepancyPoints: Number(data.discrepancyPoints || 0),
          status:
            st === 'mismatch_detected' || st === 'resolved' ? st : 'matched',
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
        handleFirestoreError(error, OperationType.LIST, 'reconciliationReports');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToSystemErrors(
  onData: (errors: SystemErrorRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'systemErrors'),
    (snap) => {
      const items: SystemErrorRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        const rawSrc = String(data.source || 'client');
        const source =
          rawSrc === 'cloud_function' || rawSrc === 'app_check' || rawSrc === 'firestore'
            ? rawSrc
            : 'client';
        const rawSev = String(data.severity || 'medium');
        const severity =
          rawSev === 'low' || rawSev === 'high' || rawSev === 'critical' ? rawSev : 'medium';
        return {
          id: d.id,
          errorId: String(data.errorId || d.id),
          userId: String(data.userId || ''),
          source,
          operation: String(data.operation || ''),
          message: String(data.message || ''),
          severity,
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'systemErrors');
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAdminsList(
  onData: (admins: AdminMarkerRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, 'admins'),
    (snap) => {
      const items: AdminMarkerRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const rawRole = String(data.role || 'admin');
        const role: AdminRole =
          rawRole === 'super_admin' || rawRole === 'admin' || rawRole === 'support_admin'
            ? rawRole
            : 'admin';
        const granted = formatTs(data.grantedAt);
        const updated = formatTs(data.updatedAt);
        return {
          uid: String(data.uid || d.id),
          role,
          email: String(data.email || ''),
          assignedBy: String(data.assignedBy || ''),
          grantedAtLabel: granted.label,
          updatedAtLabel: updated.millis > 0 ? updated.label : granted.label,
        };
      });
      onData(items);
    },
    (error) => {
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
  );
}

export function subscribeToAdminNotificationReads(
  adminUid: string,
  onData: (readIds: string[]) => void,
): () => void {
  return onSnapshot(
    doc(db, 'adminNotificationReads', adminUid),
    (snap) => {
      if (!snap.exists()) {
        onData([]);
        return;
      }
      const raw = snap.data()?.readIds;
      onData(Array.isArray(raw) ? raw.map((x) => String(x)) : []);
    },
    () => {
      onData([]);
    },
  );
}

export async function markAdminNotificationsRead(
  adminUid: string,
  ids: string[],
): Promise<void> {
  if (!adminUid || ids.length === 0) return;
  try {
    await setDoc(doc(db, 'adminNotificationReads', adminUid), {
      adminUid,
      readIds: ids.slice(-250),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking
  }
}

async function callAdminCloudFunction<T = Record<string, unknown>>(
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
      return { reached: false, ok: false, error: 'Function not deployed' };
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
    return { reached: false, ok: false, error: 'Cloud Function unreachable' };
  }
}

export async function updateUserAccountStatus(params: {
  userId: string;
  previousStatus: AccountStatus;
  accountStatus: AccountStatus;
  reason: string;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  const { userId, previousStatus, accountStatus, reason, adminUser } = params;
  const cleanReason = reason.trim() || 'Admin account status review';

  const fnRes = await callAdminCloudFunction('updateUserStatus', {
    userId,
    accountStatus,
    reason: cleanReason,
  });

  if (fnRes.reached) {
    if (!fnRes.ok) {
      throw new Error(fnRes.error || 'Failed to update user status.');
    }
    return;
  }

  try {
    await updateDoc(doc(db, 'users', userId), { accountStatus });
    await recordAdminAuditLogClient({
      adminUser,
      action: 'user_status_updated',
      targetId: userId,
      previousValue: previousStatus,
      newValue: accountStatus,
      details: `Set accountStatus=${accountStatus}. Reason: ${cleanReason}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function deleteUserAccountDocBySuperAdmin(params: {
  userId: string;
  userEmail: string;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  const { userId, userEmail, adminUser } = params;
  if (adminUser.role !== 'super_admin') {
    throw new Error('Only Super Admin can delete user accounts.');
  }
  try {
    await deleteDoc(doc(db, 'users', userId));
    await recordAdminAuditLogClient({
      adminUser,
      action: 'user_deleted',
      targetId: userId,
      previousValue: userEmail,
      newValue: 'deleted',
      details: `Super Admin deleted user profile ${userEmail || userId}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
  }
}

export async function adminAdjustUserPoints(params: {
  userId: string;
  pointsDelta: number;
  reason: string;
  pointsPerBdt: number | null;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<{ previousPoints: number; newPoints: number; txId: string }> {
  const { userId, pointsDelta, reason, pointsPerBdt, adminUser } = params;
  const delta = Math.trunc(pointsDelta);
  const cleanReason = reason.trim();
  if (!delta || cleanReason.length < 3) {
    throw new Error('Provide a non-zero integer points amount and a clear reason (min 3 chars).');
  }

  const idempotencyKey = `adj_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const fnRes = await callAdminCloudFunction<{
    previousPoints: number;
    newPoints: number;
    txId: string;
  }>('adjustUserPoints', {
    userId,
    pointsDelta: delta,
    reason: cleanReason,
    idempotencyKey,
  });

  if (fnRes.reached) {
    if (!fnRes.ok || !fnRes.data) {
      throw new Error(fnRes.error || 'Points adjustment rejected by server.');
    }
    return {
      previousPoints: Number(fnRes.data.previousPoints ?? 0),
      newPoints: Number(fnRes.data.newPoints ?? 0),
      txId: String(fnRes.data.txId || idempotencyKey),
    };
  }

  // Admin-authorized atomic Firestore transaction fallback (guarded by isAdmin() in firestore.rules)
  const userRef = doc(db, 'users', userId);
  const walletRef = doc(db, 'wallets', userId);
  const txId = `tx_${idempotencyKey}`;
  const ledgerId = `led_${txId}`;
  const logId = `adm_${Date.now()}_${userId.slice(0, 6)}`;

  try {
    const result = await runTransaction(db, async (txn) => {
      const [userSnap, walletSnap] = await Promise.all([txn.get(userRef), txn.get(walletRef)]);
      if (!userSnap.exists()) {
        throw new Error('Target user profile not found.');
      }
      const u = userSnap.data();
      const w = walletSnap.exists() ? walletSnap.data() : {};
      const prevTotal = Number(w.totalPoints ?? u.points ?? 0);
      const prevReserved = Number(w.reservedPoints ?? 0);
      const prevAvailable = Number(w.availablePoints ?? Math.max(0, prevTotal - prevReserved));
      const prevEarned = Number(w.totalEarnedPoints ?? u.totalEarnings ?? 0);

      if (delta < 0 && prevAvailable < Math.abs(delta)) {
        throw new Error(
          `Insufficient available balance (${prevAvailable.toLocaleString()} Pts available) to deduct ${Math.abs(delta).toLocaleString()} Pts.`,
        );
      }

      const newTotal = prevTotal + delta;
      const newAvailable = prevAvailable + delta;
      const newEarned = delta > 0 ? prevEarned + delta : prevEarned;
      const absPts = Math.abs(delta);
      const bdtVal = pointsPerBdt && pointsPerBdt > 0 ? Number((absPts / pointsPerBdt).toFixed(2)) : null;
      const nowServer = serverTimestamp();

      txn.set(doc(db, 'transactions', txId), {
        transactionId: txId,
        userId,
        title: delta > 0 ? 'Admin Points Credit' : 'Admin Points Deduction',
        subtitle: cleanReason,
        description: cleanReason,
        type: delta > 0 ? 'admin_credit' : 'admin_debit',
        direction: delta > 0 ? 'credit' : 'debit',
        pointsDelta: delta,
        points: absPts,
        bdtAmount: bdtVal,
        conversionRateUsed: pointsPerBdt ?? null,
        status: 'completed',
        createdAt: nowServer,
      });

      txn.set(doc(db, 'walletLedger', ledgerId), {
        entryId: ledgerId,
        transactionId: txId,
        userId,
        entryType: delta > 0 ? 'credit' : 'debit',
        transactionType: delta > 0 ? 'admin_credit' : 'admin_debit',
        pointsDelta: delta,
        bdtAmount: bdtVal ?? 0,
        conversionRateUsed: pointsPerBdt ?? 0,
        previousPoints: prevTotal,
        newPoints: newTotal,
        previousReservedPoints: prevReserved,
        newReservedPoints: prevReserved,
        status: 'completed',
        description: cleanReason,
        createdAt: nowServer,
      });

      txn.set(walletRef, {
        userId,
        totalPoints: newTotal,
        availablePoints: newAvailable,
        pendingPoints: Number(w.pendingPoints ?? 0),
        reservedPoints: prevReserved,
        totalEarnedPoints: newEarned,
        totalWithdrawnPoints: Number(w.totalWithdrawnPoints ?? 0),
        totalWithdrawnBdt: Number(w.totalWithdrawnBdt ?? 0),
        updatedAt: nowServer,
      });

      txn.update(userRef, {
        points: newAvailable,
        totalEarnings: newEarned,
      });

      txn.set(doc(db, 'notifications', `notif_${txId}`), {
        userId,
        title: delta > 0 ? 'Points Credited by Admin' : 'Points Adjusted by Admin',
        message: `${delta > 0 ? '+' : ''}${delta.toLocaleString()} Points (${cleanReason})`,
        read: false,
        createdAt: nowServer,
      });

      txn.set(doc(db, 'adminLogs', logId), {
        logId,
        adminUid: adminUser.uid,
        adminEmail: adminUser.email || 'admin@adviewearn.com',
        ...(adminUser.role ? { adminRole: adminUser.role } : {}),
        action: 'admin_adjust_points',
        targetId: userId,
        previousValue: String(prevTotal),
        newValue: String(newTotal),
        metadata: buildClientMetadata(),
        details: `Adjusted ${delta > 0 ? '+' : ''}${delta} Pts (${cleanReason}) · Tx ${txId}`,
        createdAt: nowServer,
      });

      return { previousPoints: prevTotal, newPoints: newTotal, txId };
    });

    return result;
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Insufficient') || error.message.includes('not found'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `wallets/${userId}`);
  }
}

export async function saveSiteSettingsConfig(params: {
  next: SiteSettingsConfig;
  previous: SiteSettingsConfig;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<void> {
  const { next, previous, adminUser } = params;
  const cleanName = next.websiteName.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new Error('Website Name must be at least 2 characters.');
  }

  const primaryHex = /^#[0-9a-fA-F]{6}$/.test(next.primaryColor.trim())
    ? next.primaryColor.trim().toLowerCase()
    : '#7c3aed';
  const secondaryHex = /^#[0-9a-fA-F]{6}$/.test(next.secondaryColor.trim())
    ? next.secondaryColor.trim().toLowerCase()
    : '#2563eb';

  const payload = {
    websiteName: cleanName,
    websiteTitle: next.websiteTitle.trim().slice(0, 120),
    websiteLogoUrl: next.websiteLogoUrl.trim().slice(0, 500),
    websiteFaviconUrl: next.websiteFaviconUrl.trim().slice(0, 500),
    loadingLogoUrl: next.loadingLogoUrl.trim().slice(0, 500),
    websiteDescription: next.websiteDescription.trim().slice(0, 400),
    primaryColor: primaryHex,
    secondaryColor: secondaryHex,
    loginBrandingTitle: next.loginBrandingTitle.trim().slice(0, 100),
    loginBrandingSubtitle: next.loginBrandingSubtitle.trim().slice(0, 240),
    headerBrandText: next.headerBrandText.trim().slice(0, 80),
    footerText: next.footerText.trim().slice(0, 200),
    supportEmail: next.supportEmail.trim().slice(0, 120),
    supportContact: next.supportContact.trim().slice(0, 120),
    maintenanceMode: Boolean(next.maintenanceMode),
    registrationEnabled: Boolean(next.registrationEnabled),
  };

  // Write directly to Firestore when branding fields are present so rules-validated fields persist
  // even if deployed Cloud Function runs an older schema subset; call Cloud Function only for toggle audit if no extended fields changed
  const fnRes = await callAdminCloudFunction('updateSiteSettings', payload);
  try {
    await setDoc(doc(db, 'appSettings', 'site'), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
    if (!fnRes.reached || !fnRes.ok) {
      await recordAdminAuditLogClient({
        adminUser,
        action: 'site_settings_updated',
        targetId: 'site',
        previousValue: `name=${previous.websiteName}, primary=${previous.primaryColor}, maint=${previous.maintenanceMode}`,
        newValue: `name=${cleanName}, primary=${primaryHex}, maint=${next.maintenanceMode}`,
        details: `Updated website branding & configuration (${cleanName})`,
      });
    }
  } catch (error) {
    if (fnRes.reached && fnRes.ok) {
      return;
    }
    handleFirestoreError(error, OperationType.WRITE, 'appSettings/site');
  }
}

export async function assignAdminRoleViaCloudFunction(params: {
  targetIdentifier: string;
  role: AdminRole | null;
}): Promise<{ targetUid: string; email: string; role: AdminRole | null }> {
  const clean = params.targetIdentifier.trim();
  if (!clean) {
    throw new Error('Enter a valid User Email or Firebase UID.');
  }
  const isEmail = clean.includes('@');
  const fnRes = await callAdminCloudFunction<{
    targetUid: string;
    email?: string;
    role: AdminRole | null;
  }>('setAdminRoleClaim', {
    ...(isEmail ? { targetEmail: clean.toLowerCase() } : { targetUid: clean }),
    role: params.role,
  });

  if (!fnRes.reached) {
    throw new Error(
      'Firebase Custom Claims require Admin SDK privileges (`setAdminRoleClaim` Cloud Function). Deploy `functions/` on a Firebase Blaze project (`firebase deploy --only functions`) to assign or revoke Admin Custom Claims securely.',
    );
  }
  if (!fnRes.ok || !fnRes.data) {
    throw new Error(fnRes.error || 'Could not update Custom Claims role.');
  }
  return {
    targetUid: fnRes.data.targetUid,
    email: fnRes.data.email || clean,
    role: fnRes.data.role,
  };
}

export async function exportDatabaseBackupWithFallback(params: {
  adminUser: { uid: string; email: string; role: AdminRole | null };
  snapshotFallback: Record<string, unknown>;
}): Promise<{ source: 'cloud_function' | 'client_snapshot'; json: string }> {
  const fnRes = await callAdminCloudFunction<{
    exportedAt: string;
    collections: unknown[];
  }>('exportDatabaseBackupSnapshot', {});

  if (fnRes.reached && fnRes.ok && fnRes.data) {
    return {
      source: 'cloud_function',
      json: JSON.stringify(fnRes.data, null, 2),
    };
  }
  if (fnRes.reached && !fnRes.ok) {
    throw new Error(fnRes.error || 'Backup export rejected.');
  }

  await recordAdminAuditLogClient({
    adminUser: params.adminUser,
    action: 'database_backup_exported',
    targetId: new Date().toISOString(),
    details: 'Exported Admin Panel live Firestore collections JSON snapshot.',
  });

  return {
    source: 'client_snapshot',
    json: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        exportedBy: params.adminUser.email,
        collections: params.snapshotFallback,
      },
      null,
      2,
    ),
  };
}

export function buildAdminNotifications(params: {
  users: UserProfile[];
  withdrawals: WithdrawalRequestRecord[];
  fraudLogs: FraudLogRecord[];
  fraudReports?: FraudReportRecord[];
  systemErrors: SystemErrorRecord[];
  failedTxLogs: FailedTransactionLogRecord[];
  readIds: string[];
}): AdminNotificationItem[] {
  const items: AdminNotificationItem[] = [];
  const readSet = new Set(params.readIds);

  // Pending Withdrawals
  params.withdrawals
    .filter((w) => w.status === 'pending' || w.status === 'processing')
    .slice(0, 12)
    .forEach((w) => {
      const id = `notif_wd_${w.requestId}`;
      items.push({
        id,
        category: 'pending_withdrawal',
        title: `Withdrawal ${w.status === 'pending' ? 'Pending' : 'Processing'}`,
        message: `${w.methodId.toUpperCase()} · ৳${w.grossBdt.toFixed(2)} (${w.pointsReserved.toLocaleString()} Pts) · ${w.maskedAccountNumber}`,
        severity: 'warning',
        timeLabel: w.requestDateLabel,
        createdAtMillis: w.createdAtMillis,
        read: readSet.has(id),
        targetSection: 'withdrawals',
      });
    });

  // Risk-Scored Fraud Reports Pending Review
  (params.fraudReports ?? [])
    .filter((r) => r.reviewStatus === 'pending_review')
    .slice(0, 12)
    .forEach((r) => {
      const id = `notif_fr_${r.reportId}`;
      items.push({
        id,
        category: 'fraud_alert',
        title: `Fraud Review (${r.riskLevel.toUpperCase()} · ${r.riskScore}/100)`,
        message: `${r.title} — ${r.userEmail || r.userId}`,
        severity: r.riskLevel === 'high' ? 'critical' : 'warning',
        timeLabel: r.createdAtLabel,
        createdAtMillis: r.createdAtMillis,
        read: readSet.has(id),
        targetSection: 'security-fraud',
      });
    });

  // Legacy Fraud Alerts
  params.fraudLogs.slice(0, 10).forEach((f) => {
    const id = `notif_fraud_${f.id}`;
    items.push({
      id,
      category: 'fraud_alert',
      title: `Fraud Alert (${f.severity.toUpperCase()})`,
      message: `${f.reason} — ${f.details || f.userId}`,
      severity: f.severity === 'high' ? 'critical' : 'warning',
      timeLabel: f.createdAtLabel,
      createdAtMillis: f.createdAtMillis,
      read: readSet.has(id),
      targetSection: 'security-fraud',
    });
  });

  // System Errors
  params.systemErrors.slice(0, 10).forEach((e) => {
    const id = `notif_err_${e.id}`;
    items.push({
      id,
      category: 'system_error',
      title: `System Error (${e.source})`,
      message: `${e.operation}: ${e.message}`,
      severity: e.severity === 'critical' || e.severity === 'high' ? 'critical' : 'warning',
      timeLabel: e.createdAtLabel,
      createdAtMillis: e.createdAtMillis,
      read: readSet.has(id),
      targetSection: 'audit-logs',
    });
  });

  // Failed Transaction Logs
  params.failedTxLogs.slice(0, 8).forEach((ft) => {
    const id = `notif_ftx_${ft.id}`;
    items.push({
      id,
      category: 'failed_tx',
      title: `Failed Operation: ${ft.operation}`,
      message: `${ft.errorCode} — ${ft.details}`,
      severity: 'critical',
      timeLabel: ft.createdAtLabel,
      createdAtMillis: ft.createdAtMillis,
      read: readSet.has(id),
      targetSection: 'audit-logs',
    });
  });

  // Recent User Registrations (last 48h or latest 8)
  params.users.slice(0, 8).forEach((u) => {
    const ms = u.createdAt instanceof Timestamp ? u.createdAt.toMillis() : 0;
    const id = `notif_usr_${u.uid}`;
    items.push({
      id,
      category: 'new_user',
      title: 'User Registration',
      message: `${u.fullName} (@${u.username}) · ${u.email}`,
      severity: 'info',
      timeLabel: ms > 0 ? formatDhakaDateTime(ms) : u.joinedAt,
      createdAtMillis: ms,
      read: readSet.has(id),
      targetSection: 'users',
    });
  });

  items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  return items.slice(0, 40);
}

export interface AdminKpiSummary {
  totalUsers: number;
  activeUsers: number;
  todayNewUsers: number;
  totalAdViews: number;
  todayAdViews: number;
  totalPointsDistributed: number;
  totalEarningsBdt: number | null;
  pendingWithdrawalsCount: number;
  pendingWithdrawalsBdt: number;
  paidWithdrawalsCount: number;
  paidWithdrawalsBdt: number;
  pendingReferralsCount: number;
  pendingReferralRewardsEstimatedPts: number;
}

export function computeAdminKpis(params: {
  users: UserProfile[];
  transactions: TransactionRecord[];
  adCompletions: AdCompletionRecord[];
  dailyAdLimits: DailyAdLimitRecord[];
  withdrawals: WithdrawalRequestRecord[];
  referrals: ReferredUser[];
  pointsPerBdt: number | null;
  referrerBonusPoints: number | null;
}): AdminKpiSummary {
  const todayDhaka = getDhakaDateKey();

  const totalUsers = params.users.length;
  const activeUsers = params.users.filter((u) => u.accountStatus === 'active').length;
  const todayNewUsers = params.users.filter((u) => {
    if (!(u.createdAt instanceof Timestamp)) return false;
    return getDhakaDateKey(u.createdAt.toDate()) === todayDhaka;
  }).length;

  const userViewsSum = params.users.reduce((s, u) => s + Math.max(0, u.totalAdViews || 0), 0);
  const completionViews = params.adCompletions.filter((c) => c.status === 'completed').length;
  const totalAdViews = Math.max(userViewsSum, completionViews);

  const todayCompletionViews = params.adCompletions.filter(
    (c) => c.status === 'completed' && c.dhakaDate === todayDhaka,
  ).length;
  const todayLimitViews = params.dailyAdLimits
    .filter((d) => d.dhakaDate === todayDhaka)
    .reduce((s, d) => s + Math.max(0, d.completedCount || 0), 0);
  const todayAdViews = Math.max(todayCompletionViews, todayLimitViews);

  const txDistributedPts = params.transactions
    .filter((t) => t.status === 'completed' && t.pointsDelta > 0)
    .reduce((s, t) => s + t.pointsDelta, 0);
  const userEarnedSum = params.users.reduce((s, u) => s + Math.max(0, u.totalEarnings || 0), 0);
  const totalPointsDistributed = Math.max(txDistributedPts, userEarnedSum);

  const totalEarningsBdt = pointsToBdt(totalPointsDistributed, params.pointsPerBdt);

  const pendingWd = params.withdrawals.filter(
    (w) => w.status === 'pending' || w.status === 'processing' || w.status === 'approved',
  );
  const paidWd = params.withdrawals.filter((w) => w.status === 'paid');

  const pendingReferrals = params.referrals.filter(
    (r) => r.rewardStatus === 'pending' && r.qualificationStatus !== 'rejected',
  );

  return {
    totalUsers,
    activeUsers,
    todayNewUsers,
    totalAdViews,
    todayAdViews,
    totalPointsDistributed,
    totalEarningsBdt,
    pendingWithdrawalsCount: pendingWd.length,
    pendingWithdrawalsBdt: pendingWd.reduce((s, w) => s + w.grossBdt, 0),
    paidWithdrawalsCount: paidWd.length,
    paidWithdrawalsBdt: paidWd.reduce((s, w) => s + w.netBdt, 0),
    pendingReferralsCount: pendingReferrals.length,
    pendingReferralRewardsEstimatedPts:
      params.referrerBonusPoints !== null
        ? pendingReferrals.length * params.referrerBonusPoints
        : 0,
  };
}

export interface AnalyticsBucketPoint {
  key: string;
  label: string;
  registrations: number;
  adViews: number;
  pointsEarned: number;
  bdtEarned: number;
  withdrawalsBdt: number;
}

export interface AnalyticsSeriesResult {
  buckets: AnalyticsBucketPoint[];
  weeklyEarnings: Array<{ label: string; points: number; bdt: number }>;
  monthlyEarnings: Array<{ label: string; points: number; bdt: number }>;
  withdrawalBreakdown: {
    pending: number;
    processing: number;
    approved: number;
    paid: number;
    rejected: number;
    cancelled: number;
  };
  rangeStartDhaka: string;
  rangeEndDhaka: string;
}

function addDaysDhaka(dhakaDateStr: string, deltaDays: number): string {
  const [y, m, d] = dhakaDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 6, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function buildAnalyticsSeries(params: {
  range: AnalyticsRangeKey;
  customStart: string;
  customEnd: string;
  users: UserProfile[];
  transactions: TransactionRecord[];
  adCompletions: AdCompletionRecord[];
  withdrawals: WithdrawalRequestRecord[];
  pointsPerBdt: number | null;
}): AnalyticsSeriesResult {
  const today = getDhakaDateKey();
  let start = today;
  let end = today;

  if (params.range === 'today') {
    start = today;
    end = today;
  } else if (params.range === '7d') {
    start = addDaysDhaka(today, -6);
    end = today;
  } else if (params.range === '30d') {
    start = addDaysDhaka(today, -29);
    end = today;
  } else if (params.range === 'month') {
    start = `${getDhakaMonthKey()}-01`;
    end = today;
  } else if (params.range === 'custom' && params.customStart && params.customEnd) {
    start = params.customStart <= params.customEnd ? params.customStart : params.customEnd;
    end = params.customStart <= params.customEnd ? params.customEnd : params.customStart;
  }

  // Generate up to 60 daily buckets across [start..end]
  const dateKeys: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 62) {
    dateKeys.push(cursor);
    cursor = addDaysDhaka(cursor, 1);
    guard += 1;
  }
  if (dateKeys.length === 0) dateKeys.push(today);

  const bucketMap = new Map<string, AnalyticsBucketPoint>();
  for (const key of dateKeys) {
    const [, mm, dd] = key.split('-');
    bucketMap.set(key, {
      key,
      label: `${dd}/${mm}`,
      registrations: 0,
      adViews: 0,
      pointsEarned: 0,
      bdtEarned: 0,
      withdrawalsBdt: 0,
    });
  }

  for (const u of params.users) {
    if (!(u.createdAt instanceof Timestamp)) continue;
    const dk = getDhakaDateKey(u.createdAt.toDate());
    const b = bucketMap.get(dk);
    if (b) b.registrations += 1;
  }

  for (const c of params.adCompletions) {
    if (c.status !== 'completed') continue;
    const dk = c.dhakaDate || (c.createdAtMillis > 0 ? getDhakaDateKey(new Date(c.createdAtMillis)) : '');
    const b = bucketMap.get(dk);
    if (b) b.adViews += 1;
  }

  const weeklyMap = new Map<string, { label: string; points: number; bdt: number }>();
  const monthlyMap = new Map<string, { label: string; points: number; bdt: number }>();

  for (const tx of params.transactions) {
    if (tx.status !== 'completed' || tx.pointsDelta <= 0) continue;
    const dk = tx.dhakaDate || (tx.createdAtMillis > 0 ? getDhakaDateKey(new Date(tx.createdAtMillis)) : '');
    if (dk) {
      const b = bucketMap.get(dk);
      if (b) {
        b.pointsEarned += tx.pointsDelta;
        const rate = tx.conversionRateUsed ?? params.pointsPerBdt;
        b.bdtEarned += rate && rate > 0 ? Number((tx.pointsDelta / rate).toFixed(2)) : 0;
        if (params.adCompletions.length === 0 && tx.type === 'ad_reward') {
          b.adViews += 1;
        }
      }
      if (dk >= start && dk <= end) {
        const monthKey = dk.slice(0, 7);
        const prevM = monthlyMap.get(monthKey) ?? { label: monthKey, points: 0, bdt: 0 };
        const rate = tx.conversionRateUsed ?? params.pointsPerBdt;
        prevM.points += tx.pointsDelta;
        prevM.bdt += rate && rate > 0 ? Number((tx.pointsDelta / rate).toFixed(2)) : 0;
        monthlyMap.set(monthKey, prevM);

        // Week bucket (ISO-like Monday start or 7-day chunk label)
        const dayNum = Number(dk.slice(8, 10));
        const weekIdx = Math.ceil(dayNum / 7);
        const weekKey = `${monthKey}-W${weekIdx}`;
        const prevW = weeklyMap.get(weekKey) ?? {
          label: `${dk.slice(5, 7)} W${weekIdx}`,
          points: 0,
          bdt: 0,
        };
        prevW.points += tx.pointsDelta;
        prevW.bdt += rate && rate > 0 ? Number((tx.pointsDelta / rate).toFixed(2)) : 0;
        weeklyMap.set(weekKey, prevW);
      }
    }
  }

  const withdrawalBreakdown = {
    pending: 0,
    processing: 0,
    approved: 0,
    paid: 0,
    rejected: 0,
    cancelled: 0,
  };

  for (const w of params.withdrawals) {
    const dk = w.dhakaDate || (w.createdAtMillis > 0 ? getDhakaDateKey(new Date(w.createdAtMillis)) : '');
    if (!dk || (dk >= start && dk <= end)) {
      withdrawalBreakdown[w.status] += 1;
      const b = dk ? bucketMap.get(dk) : undefined;
      if (b && w.status !== 'rejected' && w.status !== 'cancelled') {
        b.withdrawalsBdt += w.grossBdt;
      }
    }
  }

  return {
    buckets: Array.from(bucketMap.values()),
    weeklyEarnings: Array.from(weeklyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v),
    monthlyEarnings: Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v),
    withdrawalBreakdown,
    rangeStartDhaka: start,
    rangeEndDhaka: end,
  };
}

export interface AdPerformanceMetric {
  adId: string;
  impressions: number;
  completions: number;
  rejected: number;
  rewardsDistributed: number;
}

export function computePerAdPerformance(
  ads: Advertisement[],
  sessions: AdSessionRecord[],
  completions: AdCompletionRecord[],
): Map<string, AdPerformanceMetric> {
  const map = new Map<string, AdPerformanceMetric>();
  for (const ad of ads) {
    map.set(ad.adId, {
      adId: ad.adId,
      impressions: 0,
      completions: 0,
      rejected: 0,
      rewardsDistributed: 0,
    });
  }
  for (const s of sessions) {
    const entry = map.get(s.adId) ?? {
      adId: s.adId,
      impressions: 0,
      completions: 0,
      rejected: 0,
      rewardsDistributed: 0,
    };
    entry.impressions += 1;
    if (s.status === 'rejected') entry.rejected += 1;
    map.set(s.adId, entry);
  }
  for (const c of completions) {
    const entry = map.get(c.adId) ?? {
      adId: c.adId,
      impressions: 0,
      completions: 0,
      rejected: 0,
      rewardsDistributed: 0,
    };
    if (c.status === 'completed') {
      entry.completions += 1;
      entry.rewardsDistributed += c.rewardPoints;
    } else {
      entry.rejected += 1;
    }
    if (entry.impressions < entry.completions) {
      entry.impressions = entry.completions;
    }
    map.set(c.adId, entry);
  }
  return map;
}
