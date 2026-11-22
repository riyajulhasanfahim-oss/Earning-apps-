import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  AdAnalyticsRecord,
  AdCallbackRecord,
  AdCampaignRecord,
  AdCompletionRecord,
  AdminLogRecord,
  AdminMarkerRecord,
  AdminSectionKey,
  AdNetworkConfig,
  AdNetworkLogRecord,
  AdPlacementRecord,
  AdSessionRecord,
  Advertisement,
  DailyAdLimitRecord,
  DirectLinkAdRecord,
  EconomyConfig,
  FailedTransactionLogRecord,
  FraudLogRecord,
  FraudReportRecord,
  PaymentMethodConfig,
  ReconciliationReportRecord,
  ReferralLogRecord,
  ReferralRewardRecord,
  ReferralSettingsConfig,
  ReferredUser,
  SecurityAuditLogRecord,
  SiteSettingsConfig,
  SystemErrorRecord,
  TransactionRecord,
  UserProfile,
  WalletDocRecord,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
} from '../types';
import { auth } from '../lib/firebase';
import { logoutUser, mapAuthError } from '../services/authService';
import {
  appRepository,
  DEFAULT_DAILY_AD_LIMIT,
  getDefaultReferralSettings,
  getDefaultWithdrawalSettings,
} from '../services/appService';
import {
  subscribeToAdminLogs,
  subscribeToAllAdvertisements,
  subscribeToAllReferrals,
  subscribeToAllWithdrawalRequests,
  subscribeToFraudLogs,
  subscribeToPaymentMethods,
  subscribeToReferralLogs,
  subscribeToReferralSettings,
  subscribeToWalletAndEconomySettings,
  subscribeToWithdrawalSettings,
} from '../services/dashboardService';
import {
  buildAdminNotifications,
  getDefaultSiteSettings,
  markAdminNotificationsRead,
  subscribeToAdminNotificationReads,
  subscribeToAdminsList,
  subscribeToAllAdCompletions,
  subscribeToAllAdSessions,
  subscribeToAllDailyAdLimits,
  subscribeToAllReferralRewards,
  subscribeToAllTransactions,
  subscribeToAllUsers,
  subscribeToAllWallets,
  subscribeToFailedTransactionLogs,
  subscribeToReconciliationReports,
  subscribeToSiteSettings,
  subscribeToSystemErrors,
  VerifiedAdminSession,
  verifyAdminAccessSession,
} from '../services/adminService';
import {
  subscribeToAdAnalytics,
  subscribeToAdCallbacks,
  subscribeToAdCampaigns,
  subscribeToAdNetworkLogs,
  subscribeToAdNetworks,
  subscribeToAdPlacements,
} from '../services/adNetworkService';
import { AdminLayout } from './AdminLayout';
import {
  subscribeToFraudReports,
  subscribeToSecurityAuditLogs,
} from '../services/fraudMonitoringService';
import { subscribeToAllDirectLinkAds } from '../services/multiDirectLinkService';
import { useToast } from '../components/ui/ToastProvider';
import { applyDocumentBranding, SiteBrandingProvider } from '../contexts/SiteBrandingContext';

const AdminDashboardOverview = lazy(() =>
  import('./AdminDashboardOverview').then((m) => ({ default: m.AdminDashboardOverview })),
);
const AdminUsersSection = lazy(() =>
  import('./AdminUsersSection').then((m) => ({ default: m.AdminUsersSection })),
);
const AdminPointsSection = lazy(() =>
  import('./AdminPointsSection').then((m) => ({ default: m.AdminPointsSection })),
);
const AdminWithdrawalsSection = lazy(() =>
  import('./AdminWithdrawalsSection').then((m) => ({ default: m.AdminWithdrawalsSection })),
);
const AdminAdsSection = lazy(() =>
  import('./AdminAdsSection').then((m) => ({ default: m.AdminAdsSection })),
);
const AdminMultiDirectLinksSection = lazy(() =>
  import('./AdminMultiDirectLinksSection').then((m) => ({
    default: m.AdminMultiDirectLinksSection,
  })),
);
const AdminAdNetworksSection = lazy(() =>
  import('./AdminAdNetworksSection').then((m) => ({ default: m.AdminAdNetworksSection })),
);
const AdminReferralsSection = lazy(() =>
  import('./AdminReferralsSection').then((m) => ({ default: m.AdminReferralsSection })),
);
const AdminSecurityFraudSection = lazy(() =>
  import('./AdminSecurityFraudSection').then((m) => ({ default: m.AdminSecurityFraudSection })),
);
const AdminSettingsSection = lazy(() =>
  import('./AdminSettingsSection').then((m) => ({ default: m.AdminSettingsSection })),
);
const AdminBrandingSection = lazy(() =>
  import('./AdminBrandingSection').then((m) => ({ default: m.AdminBrandingSection })),
);
const AdminFirebaseProjectSection = lazy(() =>
  import('./AdminFirebaseProjectSection').then((m) => ({ default: m.AdminFirebaseProjectSection })),
);
const AdminAuditLogsSection = lazy(() =>
  import('./AdminAuditLogsSection').then((m) => ({ default: m.AdminAuditLogsSection })),
);

const AdminSectionFallback: React.FC = () => (
  <div className="min-h-[40dvh] flex flex-col items-center justify-center p-6 text-slate-300 gap-2.5">
    <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
    <span className="text-xs font-medium text-slate-400">Loading admin section...</span>
  </div>
);

interface AdminAppProps {
  onExitToUserSite: () => void;
}

const INITIAL_ECONOMY: EconomyConfig = {
  pointsPerBdt: null,
  dailyBonusPoints: null,
  minimumWithdrawPoints: null,
  maximumWithdrawAmountBdt: null,
  dailyAdLimit: DEFAULT_DAILY_AD_LIMIT,
  walletEnabled: true,
  earningEnabled: true,
};

export const AdminApp: React.FC<AdminAppProps> = ({ onExitToUserSite }) => {
  const { showToast } = useToast();

  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [verifying, setVerifying] = useState(true);
  const [session, setSession] = useState<VerifiedAdminSession | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSectionKey>('overview');
  const [pointsTargetUid, setPointsTargetUid] = useState<string | null>(null);

  // Real-time Firestore admin collections
  const [siteSettings, setSiteSettings] = useState<SiteSettingsConfig>(() =>
    getDefaultSiteSettings(),
  );
  const [economy, setEconomy] = useState<EconomyConfig>(INITIAL_ECONOMY);
  const [firestoreMethods, setFirestoreMethods] = useState<PaymentMethodConfig[]>([]);
  const [withdrawalSettings, setWithdrawalSettings] = useState<WithdrawalSettingsConfig>(() =>
    getDefaultWithdrawalSettings(INITIAL_ECONOMY),
  );
  const [referralSettings, setReferralSettings] = useState<ReferralSettingsConfig>(() =>
    getDefaultReferralSettings(),
  );

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [wallets, setWallets] = useState<WalletDocRecord[]>([]);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [adSessions, setAdSessions] = useState<AdSessionRecord[]>([]);
  const [adCompletions, setAdCompletions] = useState<AdCompletionRecord[]>([]);
  const [dailyAdLimits, setDailyAdLimits] = useState<DailyAdLimitRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestRecord[]>([]);
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [directLinkAds, setDirectLinkAds] = useState<DirectLinkAdRecord[]>([]);
  const [referrals, setReferrals] = useState<ReferredUser[]>([]);
  const [referralRewards, setReferralRewards] = useState<ReferralRewardRecord[]>([]);
  const [referralLogs, setReferralLogs] = useState<ReferralLogRecord[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLogRecord[]>([]);
  const [fraudLogs, setFraudLogs] = useState<FraudLogRecord[]>([]);
  const [systemErrors, setSystemErrors] = useState<SystemErrorRecord[]>([]);
  const [failedTxLogs, setFailedTxLogs] = useState<FailedTransactionLogRecord[]>([]);
  const [reconciliationReports, setReconciliationReports] = useState<
    ReconciliationReportRecord[]
  >([]);
  const [adminsList, setAdminsList] = useState<AdminMarkerRecord[]>([]);
  const [adNetworks, setAdNetworks] = useState<AdNetworkConfig[]>([]);
  const [adPlacements, setAdPlacements] = useState<AdPlacementRecord[]>([]);
  const [adCampaigns, setAdCampaigns] = useState<AdCampaignRecord[]>([]);
  const [adCallbacks, setAdCallbacks] = useState<AdCallbackRecord[]>([]);
  const [adAnalytics, setAdAnalytics] = useState<AdAnalyticsRecord[]>([]);
  const [adNetworkLogs, setAdNetworkLogs] = useState<AdNetworkLogRecord[]>([]);
  const [fraudReports, setFraudReports] = useState<FraudReportRecord[]>([]);
  const [securityAuditLogs, setSecurityAuditLogs] = useState<SecurityAuditLogRecord[]>([]);
  const [readNotifIds, setReadNotifIds] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const refreshVerification = useCallback(async () => {
    setVerifying(true);
    try {
      const verified = await verifyAdminAccessSession();
      setSession(verified);
    } finally {
      setVerifying(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [activeSection]);

  useEffect(() => {
    const unsubSite = subscribeToSiteSettings((cfg) => setSiteSettings(cfg));
    return () => unsubSite();
  }, []);

  useEffect(() => {
    applyDocumentBranding(siteSettings, { isAdmin: true });
  }, [siteSettings]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setSession(null);
        setVerifying(false);
        setUsers([]);
        setWallets([]);
        setTransactions([]);
        setAdSessions([]);
        setAdCompletions([]);
        setDailyAdLimits([]);
        setWithdrawals([]);
        setAds([]);
        setDirectLinkAds([]);
        setReferrals([]);
        setReferralRewards([]);
        setReferralLogs([]);
        setAdminLogs([]);
        setFraudLogs([]);
        setSystemErrors([]);
        setFailedTxLogs([]);
        setReconciliationReports([]);
        setAdminsList([]);
        setAdNetworks([]);
        setAdPlacements([]);
        setAdCampaigns([]);
        setAdCallbacks([]);
        setAdAnalytics([]);
        setAdNetworkLogs([]);
        setFraudReports([]);
        setSecurityAuditLogs([]);
        setReadNotifIds([]);
      } else {
        void refreshVerification();
      }
    });
    return () => unsub();
  }, [refreshVerification]);

  // Attach Admin Firestore real-time streams strictly when authorized
  useEffect(() => {
    if (!authReady || !firebaseUser || !session?.authorized || !session.role) {
      return;
    }

    setDataLoading(true);
    let settled = 0;
    const markSettled = () => {
      settled += 1;
      if (settled >= 2) {
        setDataLoading(false);
      }
    };
    const onErr = (err: Error) => {
      setDataLoading(false);
      showToast(err.message || 'Firestore subscription error.', 'error');
    };

    const unsubs = [
      subscribeToWalletAndEconomySettings((cfg) => setEconomy(cfg), () => {}),
      subscribeToPaymentMethods((m) => setFirestoreMethods(m), () => {}),
      subscribeToWithdrawalSettings(INITIAL_ECONOMY, (s) => setWithdrawalSettings(s), () => {}),
      subscribeToReferralSettings((s) => setReferralSettings(s), () => {}),
      subscribeToAllUsers((list) => {
        setUsers(list);
        markSettled();
      }, onErr),
      subscribeToAllWallets((list) => {
        setWallets(list);
        markSettled();
      }, onErr),
      subscribeToAllTransactions((list) => setTransactions(list), onErr),
      subscribeToAllAdSessions((list) => setAdSessions(list), onErr),
      subscribeToAllAdCompletions((list) => setAdCompletions(list), onErr),
      subscribeToAllDailyAdLimits((list) => setDailyAdLimits(list), onErr),
      subscribeToAllWithdrawalRequests((list) => setWithdrawals(list), onErr),
      subscribeToAllAdvertisements((list) => setAds(list), onErr),
      subscribeToAllDirectLinkAds((list) => setDirectLinkAds(list), onErr),
      subscribeToAllReferrals((list) => setReferrals(list), onErr),
      subscribeToAllReferralRewards((list) => setReferralRewards(list), onErr),
      subscribeToReferralLogs((list) => setReferralLogs(list), onErr),
      subscribeToAdminLogs((list) => setAdminLogs(list), onErr),
      subscribeToFraudLogs((list) => setFraudLogs(list), onErr),
      subscribeToSystemErrors((list) => setSystemErrors(list), onErr),
      subscribeToFailedTransactionLogs((list) => setFailedTxLogs(list), onErr),
      subscribeToReconciliationReports((list) => setReconciliationReports(list), onErr),
      subscribeToAdNetworks((list) => setAdNetworks(list), onErr),
      subscribeToAdPlacements((list) => setAdPlacements(list), onErr),
      subscribeToAdCampaigns((list) => setAdCampaigns(list), onErr),
      subscribeToAdCallbacks((list) => setAdCallbacks(list), onErr),
      subscribeToAdAnalytics((list) => setAdAnalytics(list), onErr),
      subscribeToAdNetworkLogs((list) => setAdNetworkLogs(list), onErr),
      subscribeToFraudReports((list) => setFraudReports(list), onErr),
      subscribeToSecurityAuditLogs((list) => setSecurityAuditLogs(list), onErr),
      subscribeToAdminNotificationReads(firebaseUser.uid, (ids) => setReadNotifIds(ids)),
      session.role === 'super_admin'
        ? subscribeToAdminsList((list) => setAdminsList(list))
        : () => {},
    ];

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, firebaseUser, session?.authorized, session?.role, showToast]);

  const paymentMethods = useMemo(
    () => appRepository.getPaymentMethods(economy, firestoreMethods),
    [economy, firestoreMethods],
  );

  const notifications = useMemo(
    () =>
      buildAdminNotifications({
        users,
        withdrawals,
        fraudLogs,
        fraudReports,
        systemErrors,
        failedTxLogs,
        readIds: readNotifIds,
      }),
    [users, withdrawals, fraudLogs, fraudReports, systemErrors, failedTxLogs, readNotifIds],
  );

  const pendingWithdrawalsCount = useMemo(
    () => withdrawals.filter((w) => w.status === 'pending' || w.status === 'processing').length,
    [withdrawals],
  );

  const pendingFraudReportsCount = useMemo(
    () => fraudReports.filter((r) => r.reviewStatus === 'pending_review').length,
    [fraudReports],
  );

  const handleMarkAllRead = () => {
    if (!firebaseUser) return;
    const allIds = Array.from(new Set([...readNotifIds, ...notifications.map((n) => n.id)]));
    setReadNotifIds(allIds);
    void markAdminNotificationsRead(firebaseUser.uid, allIds);
  };

  const handleMarkSingleRead = (id: string) => {
    if (!firebaseUser || readNotifIds.includes(id)) return;
    const nextIds = [...readNotifIds, id];
    setReadNotifIds(nextIds);
    void markAdminNotificationsRead(firebaseUser.uid, nextIds);
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      showToast('Signed out from Admin Console.', 'info');
    } catch (err) {
      showToast(mapAuthError(err), 'error');
    }
  };

  useEffect(() => {
    if (!authReady || verifying) return;
    if (!firebaseUser || !session?.authorized || !session.role) {
      onExitToUserSite();
    }
  }, [authReady, verifying, firebaseUser, session?.authorized, session?.role, onExitToUserSite]);

  if (!authReady || verifying) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-[#06091B] text-slate-300 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="text-xs font-medium text-slate-400">Loading view...</span>
      </div>
    );
  }

  if (!firebaseUser || !session?.authorized || !session.role) {
    return null;
  }

  const adminUser = {
    uid: firebaseUser.uid,
    email: firebaseUser.email || 'admin@adviewearn.com',
  };

  const snapshotData = {
    siteSettings,
    economy,
    withdrawalSettings,
    referralSettings,
    paymentMethods,
    usersCount: users.length,
    walletsCount: wallets.length,
    withdrawalsCount: withdrawals.length,
    adsCount: ads.length,
    referralsCount: referrals.length,
    users,
    wallets,
    withdrawals,
    advertisements: ads,
    referrals,
    referralRewards,
    adminLogs,
  };

  return (
    <SiteBrandingProvider value={siteSettings}>
      <AdminLayout
        siteName={siteSettings.websiteName}
      adminEmail={adminUser.email}
      adminRole={session.role}
      sessionInfo={session}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      pendingWithdrawalsCount={pendingWithdrawalsCount}
      pendingFraudReportsCount={pendingFraudReportsCount}
      notifications={notifications}
      onMarkAllRead={handleMarkAllRead}
      onMarkSingleRead={handleMarkSingleRead}
      onExitToUserSite={onExitToUserSite}
      onLogout={handleLogout}
    >
      <Suspense fallback={<AdminSectionFallback />}>
        {activeSection === 'overview' && (
        <AdminDashboardOverview
          loading={dataLoading}
          users={users}
          transactions={transactions}
          adCompletions={adCompletions}
          dailyAdLimits={dailyAdLimits}
          withdrawals={withdrawals}
          referrals={referrals}
          economy={economy}
          referralSettings={referralSettings}
          onNavigateSection={setActiveSection}
        />
      )}

      {activeSection === 'users' && (
        <AdminUsersSection
          loading={dataLoading}
          users={users}
          wallets={wallets}
          transactions={transactions}
          withdrawals={withdrawals}
          referrals={referrals}
          adSessions={adSessions}
          adCompletions={adCompletions}
          economy={economy}
          adminRole={session.role}
          adminUser={adminUser}
          onJumpToPoints={(uid) => {
            setPointsTargetUid(uid);
            setActiveSection('points');
          }}
        />
      )}

      {activeSection === 'points' && (
        <AdminPointsSection
          users={users}
          wallets={wallets}
          transactions={transactions}
          adminLogs={adminLogs}
          economy={economy}
          adminRole={session.role}
          adminUser={adminUser}
          preselectedUid={pointsTargetUid}
        />
      )}

      {activeSection === 'withdrawals' && (
        <AdminWithdrawalsSection
          withdrawals={withdrawals}
          users={users}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'ads' && (
        <AdminAdsSection
          ads={ads}
          adSessions={adSessions}
          adCompletions={adCompletions}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'multi-direct-links' && (
        <AdminMultiDirectLinksSection
          directLinkAds={directLinkAds}
          adSessions={adSessions}
          adCompletions={adCompletions}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'ad-networks' && (
        <AdminAdNetworksSection
          networks={adNetworks}
          placements={adPlacements}
          campaigns={adCampaigns}
          callbacks={adCallbacks}
          analytics={adAnalytics}
          networkLogs={adNetworkLogs}
          ads={ads}
          adSessions={adSessions}
          adCompletions={adCompletions}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'referrals' && (
        <AdminReferralsSection
          referrals={referrals}
          referralRewards={referralRewards}
          referralLogs={referralLogs}
          referralSettings={referralSettings}
          users={users}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'security-fraud' && (
        <AdminSecurityFraudSection
          fraudReports={fraudReports}
          securityAuditLogs={securityAuditLogs}
          fraudLogs={fraudLogs}
          users={users}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'branding' && (
        <AdminBrandingSection
          siteSettings={siteSettings}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'firebase-project' && (
        <AdminFirebaseProjectSection
          siteSettings={siteSettings}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'settings' && (
        <AdminSettingsSection
          siteSettings={siteSettings}
          economy={economy}
          withdrawalSettings={withdrawalSettings}
          paymentMethods={paymentMethods}
          adminsList={adminsList}
          users={users}
          snapshotData={snapshotData}
          adminRole={session.role}
          adminUser={adminUser}
        />
      )}

      {activeSection === 'audit-logs' && (
        <AdminAuditLogsSection
          adminLogs={adminLogs}
          fraudLogs={fraudLogs}
          systemErrors={systemErrors}
          failedTxLogs={failedTxLogs}
          reconciliationReports={reconciliationReports}
        />
      )}
      </Suspense>
    </AdminLayout>
    </SiteBrandingProvider>
  );
};
