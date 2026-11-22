/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, LogOut, ShieldAlert, Wrench } from 'lucide-react';
import {
  AdCompletionRecord,
  AdSessionRecord,
  Advertisement,
  AppPage,
  DailyAdLimitRecord,
  DailyBonusState,
  DirectLinkAdRecord,
  EconomyConfig,
  NotificationItem,
  PaymentMethodConfig,
  PaymentMethodId,
  ReferralLeaderboardEntry,
  ReferralSettingsConfig,
  ReferredUser,
  SiteSettingsConfig,
  TransactionRecord,
  UserProfile,
  WalletDocRecord,
  WalletLedgerEntry,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
} from './types';
import { auth } from './lib/firebase';
import {
  logoutUser,
  mapAuthError,
  subscribeToUserProfile,
  subscribeToUserReferrals,
} from './services/authService';
import {
  appRepository,
  computeDashboardMetrics,
  DEFAULT_DAILY_AD_LIMIT,
  getDefaultDailyBonusState,
  getDefaultReferralSettings,
  getDefaultWithdrawalSettings,
} from './services/appService';
import {
  initiateAdSession,
  initiateDailyBonusAdSession,
  markFirestoreNotificationRead,
  subscribeToActiveAdvertisements,
  subscribeToAdCompletions,
  subscribeToAdSessions,
  subscribeToDailyAdLimit,
  subscribeToDailyBonusState,
  subscribeToPaymentMethods,
  subscribeToReferralLeaderboard,
  subscribeToReferralSettings,
  subscribeToUserNotifications,
  subscribeToUserTransactions,
  subscribeToUserWallet,
  subscribeToUserWalletLedger,
  subscribeToUserWithdrawalRequests,
  subscribeToWalletAndEconomySettings,
  subscribeToWithdrawalSettings,
} from './services/dashboardService';
import { AppShell } from './components/layout/AppShell';
import type { AuthModalMode } from './components/auth/AuthModal';
import {
  getDefaultSiteSettings,
  subscribeToSiteSettings,
  VerifiedAdminSession,
  verifyAdminAccessSession,
} from './services/adminService';
import { GlassCard } from './components/ui/GlassCard';
import { useToast } from './components/ui/ToastProvider';
import { HomePage } from './pages/HomePage';
import { InstallAppBanner } from './components/pwa/InstallAppBanner';
import { AdWatchSessionModal } from './components/ads/AdWatchSessionModal';
import { buildPlacementLaunchUrl, resolveAdLaunchKind } from './services/adNetworkPolicy';
import { getDhakaDateKey } from './services/appService';
import {
  extractMonetagZoneId,
  isTelegramMiniAppContext,
  preloadMonetagSdk,
} from './services/monetagSdk';
import { applyDocumentBranding, SiteBrandingProvider } from './contexts/SiteBrandingContext';
import {
  subscribeToActiveDirectLinkAds,
  toPlayableAdvertisement,
} from './services/multiDirectLinkService';
import { AdViewLogoMark } from './components/icons/BrandAssets';

const AuthModal = lazy(() =>
  import('./components/auth/AuthModal').then((m) => ({ default: m.AuthModal })),
);
const VerifyEmailPage = lazy(() =>
  import('./pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })),
);
const WatchAdsPage = lazy(() =>
  import('./pages/WatchAdsPage').then((m) => ({ default: m.WatchAdsPage })),
);
const AdWatchSessionPage = lazy(() =>
  import('./pages/AdWatchSessionPage').then((m) => ({ default: m.AdWatchSessionPage })),
);
const AdHistoryPage = lazy(() =>
  import('./pages/AdHistoryPage').then((m) => ({ default: m.AdHistoryPage })),
);
const WalletPage = lazy(() =>
  import('./pages/WalletPage').then((m) => ({ default: m.WalletPage })),
);
const WithdrawPage = lazy(() =>
  import('./pages/WithdrawPage').then((m) => ({ default: m.WithdrawPage })),
);
const WithdrawalHistoryPage = lazy(() =>
  import('./pages/WithdrawalHistoryPage').then((m) => ({ default: m.WithdrawalHistoryPage })),
);
const ReferralPage = lazy(() =>
  import('./pages/ReferralPage').then((m) => ({ default: m.ReferralPage })),
);
const TransactionsPage = lazy(() =>
  import('./pages/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const AdminApp = lazy(() =>
  import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })),
);

const RouteLoadingFallback: React.FC<{ fullScreen?: boolean }> = ({ fullScreen = false }) => (
  <div
    className={`${
      fullScreen ? 'min-h-dvh bg-[#06091B]' : 'min-h-[45dvh]'
    } flex flex-col items-center justify-center p-6 text-slate-300 gap-3`}
  >
    {fullScreen && <AdViewLogoMark size="md" useLoadingLogo />}
    <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
    <span className="text-xs font-medium text-slate-400">Loading view...</span>
  </div>
);

const PUBLIC_BROWSE_PAGES: AppPage[] = ['home', 'earn'];

type PendingAuthAction =
  | { type: 'navigate'; page: AppPage }
  | { type: 'watch_ad'; ad: Advertisement }
  | { type: 'daily_bonus' }
  | { type: 'withdraw_method'; methodId: PaymentMethodId };

const ACTION_AUTH_REASONS: Partial<Record<AppPage, string>> = {
  wallet: 'Sign in to view your Wallet balance & earnings.',
  withdraw: 'Sign in to submit a withdrawal request.',
  'withdrawal-history': 'Sign in to view your withdrawal history.',
  referral: 'Sign in to access your Referral code & invite friends.',
  transactions: 'Sign in to view your transaction history.',
  profile: 'Sign in to manage your profile & settings.',
  'ad-history': 'Sign in to view your ad completion history.',
  'watch-ad': 'Sign in to watch verified ads and earn points.',
};

const INITIAL_ECONOMY: EconomyConfig = {
  pointsPerBdt: null,
  dailyBonusPoints: null,
  minimumWithdrawPoints: null,
  maximumWithdrawAmountBdt: null,
  dailyAdLimit: DEFAULT_DAILY_AD_LIMIT,
  walletEnabled: true,
  earningEnabled: true,
};

export default function App() {
  const { showToast } = useToast();

  const initialRefFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return (params.get('ref') ?? '').trim().toUpperCase();
  }, []);

  const isRegisterPath = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.toLowerCase().startsWith('/register');
  }, []);

  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.toLowerCase().startsWith('/admin');
  });
  const [siteSettings, setSiteSettings] = useState<SiteSettingsConfig>(() =>
    getDefaultSiteSettings(),
  );

  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(() =>
    Boolean(initialRefFromUrl || isRegisterPath),
  );
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>(() =>
    initialRefFromUrl || isRegisterPath ? 'register' : 'login',
  );
  const [authModalReason, setAuthModalReason] = useState<string>(() =>
    initialRefFromUrl ? `Invited with code ${initialRefFromUrl} — create your account to join!` : '',
  );
  const [pendingAction, setPendingAction] = useState<PendingAuthAction | null>(null);
  const [autoOpenBonusModal, setAutoOpenBonusModal] = useState(false);

  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [emailVerifiedFlag, setEmailVerifiedFlag] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [adminSession, setAdminSession] = useState<VerifiedAdminSession | null>(null);
  const [adminVerifyStatus, setAdminVerifyStatus] = useState<'idle' | 'checking' | 'done'>('idle');
  const adminManuallyExitedRef = useRef(false);
  const isAdminAuthorizedRef = useRef(false);

  // Real-time Firestore dashboard, ads, wallet, withdrawals & referral streams
  const [economy, setEconomy] = useState<EconomyConfig>(INITIAL_ECONOMY);
  const [firestoreMethods, setFirestoreMethods] = useState<PaymentMethodConfig[]>([]);
  const [withdrawalSettings, setWithdrawalSettings] = useState<WithdrawalSettingsConfig>(() =>
    getDefaultWithdrawalSettings(INITIAL_ECONOMY),
  );
  const [userWithdrawals, setUserWithdrawals] = useState<WithdrawalRequestRecord[]>([]);

  const [walletDoc, setWalletDoc] = useState<WalletDocRecord | null>(null);
  const [walletLedger, setWalletLedger] = useState<WalletLedgerEntry[]>([]);
  const [activeAds, setActiveAds] = useState<Advertisement[]>([]);
  const [directLinkAds, setDirectLinkAds] = useState<DirectLinkAdRecord[]>([]);
  const [adSessions, setAdSessions] = useState<AdSessionRecord[]>([]);
  const [adCompletions, setAdCompletions] = useState<AdCompletionRecord[]>([]);
  const [dailyAdLimit, setDailyAdLimit] = useState<DailyAdLimitRecord | null>(null);

  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [referredUsers, setReferredUsers] = useState<ReferredUser[]>([]);
  const [referralSettings, setReferralSettings] = useState<ReferralSettingsConfig>(() =>
    getDefaultReferralSettings(),
  );
  const [referralLeaderboard, setReferralLeaderboard] = useState<ReferralLeaderboardEntry[]>([]);

  const [dailyBonus, setDailyBonus] = useState<DailyBonusState>(() =>
    getDefaultDailyBonusState(),
  );
  const [firestoreNotifications, setFirestoreNotifications] = useState<NotificationItem[]>([]);
  const [dashboardDataLoaded, setDashboardDataLoaded] = useState(false);

  const [readSysNotifIds, setReadSysNotifIds] = useState<string[]>([]);
  const [preferredWithdrawMethod, setPreferredWithdrawMethod] =
    useState<PaymentMethodId>('bkash');

  // Active ad watching state
  const [activeWatchAd, setActiveWatchAd] = useState<Advertisement | null>(null);
  const [activeWatchSessionId, setActiveWatchSessionId] = useState<string | null>(null);
  const [activeWatchStartedAtMs, setActiveWatchStartedAtMs] = useState<number>(0);
  const [watchOverlayOpen, setWatchOverlayOpen] = useState(false);
  const [watchPopupBlocked, setWatchPopupBlocked] = useState(false);
  const [initiatingAdId, setInitiatingAdId] = useState<string | null>(null);
  const [initiatingDailyBonus, setInitiatingDailyBonus] = useState(false);

  // Preload Monetag TMA SDK ONLY when running inside a genuine Telegram Mini App WebView
  useEffect(() => {
    if (!isTelegramMiniAppContext()) return;
    for (const ad of activeAds) {
      if (ad.status !== 'active') continue;
      const zoneId = extractMonetagZoneId(ad.placementOrUrl);
      if (zoneId) {
        void preloadMonetagSdk(zoneId);
      }
    }
  }, [activeAds]);

  useEffect(() => {
    isAdminAuthorizedRef.current = Boolean(adminSession?.authorized);
  }, [adminSession?.authorized]);

  // Guard /admin URL changes and subscribe to live appSettings/site
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePop = () => {
      const wantsAdmin = window.location.pathname.toLowerCase().startsWith('/admin');
      if (wantsAdmin && !isAdminAuthorizedRef.current) {
        window.history.replaceState(null, '', '/');
        setIsAdminRoute(false);
        return;
      }
      if (wantsAdmin && isAdminAuthorizedRef.current) {
        adminManuallyExitedRef.current = false;
      }
      setIsAdminRoute(wantsAdmin);
    };
    window.addEventListener('popstate', handlePop);
    const unsubSite = subscribeToSiteSettings(
      (cfg) => setSiteSettings(cfg),
      () => {},
    );
    const unsubDirectLinks = subscribeToActiveDirectLinkAds(
      (links) => setDirectLinkAds(links),
      () => {},
    );
    return () => {
      window.removeEventListener('popstate', handlePop);
      unsubSite();
      unsubDirectLinks();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentPage, isAdminRoute]);

  useEffect(() => {
    applyDocumentBranding(siteSettings, {
      isAdmin: isAdminRoute && Boolean(adminSession?.authorized),
    });
  }, [siteSettings, isAdminRoute, adminSession?.authorized]);

  // Subscribe to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setEmailVerifiedFlag(Boolean(user?.emailVerified));
      setAuthReady(true);

      if (!user) {
        adminManuallyExitedRef.current = false;
        setAdminSession(null);
        setAdminVerifyStatus('done');
        setIsAdminRoute(false);
        if (
          typeof window !== 'undefined' &&
          window.location.pathname.toLowerCase().startsWith('/admin')
        ) {
          window.history.replaceState(null, '', '/');
        }
        setUserProfile(null);
        setFirestoreMethods([]);
        setUserWithdrawals([]);
        setWalletDoc(null);
        setWalletLedger([]);
        setReferredUsers([]);
        setReferralSettings(getDefaultReferralSettings());
        setReferralLeaderboard([]);
        setTransactions([]);
        setActiveAds([]);
        setAdSessions([]);
        setAdCompletions([]);
        setDailyAdLimit(null);
        setFirestoreNotifications([]);
        setDailyBonus(getDefaultDailyBonusState());
        setProfileLoading(false);
        setDashboardDataLoaded(false);
        setActiveWatchAd(null);
        setActiveWatchSessionId(null);
        setCurrentPage((prev) => (PUBLIC_BROWSE_PAGES.includes(prev) ? prev : 'home'));
      } else {
        setAuthModalOpen(false);
        if (user.emailVerified) {
          setAdminVerifyStatus('checking');
        } else {
          setAdminSession(null);
          setAdminVerifyStatus('done');
          setIsAdminRoute(false);
          if (
            typeof window !== 'undefined' &&
            window.location.pathname.toLowerCase().startsWith('/admin')
          ) {
            window.history.replaceState(null, '', '/');
          }
        }
        setProfileLoading(true);
      }
    });
    return () => unsubscribe();
  }, []);

  // Server-enforced Admin Role verification & automatic role-based routing
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    if (!emailVerifiedFlag) {
      setAdminSession(null);
      setAdminVerifyStatus('done');
      setIsAdminRoute(false);
      if (
        typeof window !== 'undefined' &&
        window.location.pathname.toLowerCase().startsWith('/admin')
      ) {
        window.history.replaceState(null, '', '/');
      }
      return;
    }

    let cancelled = false;
    setAdminVerifyStatus('checking');

    void verifyAdminAccessSession()
      .then((verified) => {
        if (cancelled) return;
        setAdminSession(verified);
        setAdminVerifyStatus('done');

        if (verified.authorized) {
          if (!adminManuallyExitedRef.current) {
            setPendingAction(null);
            setAuthModalOpen(false);
            setAuthModalReason('');
            setIsAdminRoute(true);
            if (
              typeof window !== 'undefined' &&
              !window.location.pathname.toLowerCase().startsWith('/admin')
            ) {
              window.history.replaceState(null, '', '/admin');
            }
          }
        } else {
          setIsAdminRoute(false);
          if (
            typeof window !== 'undefined' &&
            window.location.pathname.toLowerCase().startsWith('/admin')
          ) {
            window.history.replaceState(null, '', '/');
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAdminSession(null);
        setAdminVerifyStatus('done');
        setIsAdminRoute(false);
        if (
          typeof window !== 'undefined' &&
          window.location.pathname.toLowerCase().startsWith('/admin')
        ) {
          window.history.replaceState(null, '', '/');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, firebaseUser, emailVerifiedFlag]);

  // Subscribe to User Portal Firestore collections ONLY when authenticated on User Portal
  useEffect(() => {
    if (!authReady || !firebaseUser || isAdminRoute) return;

    let initialSettled = 0;
    const markSettled = () => {
      initialSettled += 1;
      if (initialSettled >= 2) {
        setDashboardDataLoaded(true);
      }
    };

    const unsubProfile = subscribeToUserProfile(
      firebaseUser.uid,
      (profile) => {
        setUserProfile(profile);
        setProfileLoading(false);
        markSettled();
      },
      (err) => {
        setProfileLoading(false);
        setDashboardDataLoaded(true);
        showToast(err.message || 'Unable to load profile.', 'error');
      },
    );

    const unsubSettings = subscribeToWalletAndEconomySettings(
      (cfg) => {
        setEconomy(cfg);
      },
      () => {},
    );

    const unsubWallet = subscribeToUserWallet(
      firebaseUser.uid,
      (docRec) => {
        setWalletDoc(docRec);
      },
      () => {},
    );

    const unsubLedger = subscribeToUserWalletLedger(
      firebaseUser.uid,
      (entries) => {
        setWalletLedger(entries);
      },
      () => {},
    );

    const unsubReferrals = subscribeToUserReferrals(
      firebaseUser.uid,
      (refs) => {
        setReferredUsers(refs);
      },
      () => {},
    );

    const unsubTransactions = subscribeToUserTransactions(
      firebaseUser.uid,
      (txs) => {
        setTransactions(txs);
        markSettled();
      },
      () => {
        markSettled();
      },
    );

    const unsubDailyBonus = subscribeToDailyBonusState(
      firebaseUser.uid,
      (state) => {
        setDailyBonus(state);
      },
      () => {},
    );

    const unsubNotifications = subscribeToUserNotifications(
      firebaseUser.uid,
      (items) => {
        setFirestoreNotifications(items);
      },
      () => {},
    );

    const unsubActiveAds = emailVerifiedFlag
      ? subscribeToActiveAdvertisements(
          (adsList) => {
            setActiveAds(adsList);
          },
          () => {},
        )
      : () => {};

    const unsubDailyAdLimit = subscribeToDailyAdLimit(
      firebaseUser.uid,
      (limitDoc) => {
        setDailyAdLimit(limitDoc);
      },
      () => {},
    );

    const unsubAdSessions = subscribeToAdSessions(
      firebaseUser.uid,
      (sessions) => {
        setAdSessions(sessions);
      },
      () => {},
    );

    const unsubAdCompletions = subscribeToAdCompletions(
      firebaseUser.uid,
      (completions) => {
        setAdCompletions(completions);
      },
      () => {},
    );

    const unsubPaymentMethods = subscribeToPaymentMethods(
      (methods) => {
        setFirestoreMethods(methods);
      },
      () => {},
    );

    const unsubWithdrawSettings = subscribeToWithdrawalSettings(
      INITIAL_ECONOMY,
      (settings) => {
        setWithdrawalSettings(settings);
      },
      () => {},
    );

    const unsubUserWithdrawals = subscribeToUserWithdrawalRequests(
      firebaseUser.uid,
      (reqs) => {
        setUserWithdrawals(reqs);
      },
      () => {},
    );

    const unsubReferralSettings = subscribeToReferralSettings(
      (cfg) => {
        setReferralSettings(cfg);
      },
      () => {},
    );

    const unsubLeaderboard = subscribeToReferralLeaderboard(
      (entries) => {
        setReferralLeaderboard(entries);
      },
      () => {},
    );

    return () => {
      unsubProfile();
      unsubSettings();
      unsubWallet();
      unsubLedger();
      unsubReferrals();
      unsubTransactions();
      unsubDailyBonus();
      unsubNotifications();
      unsubActiveAds();
      unsubDailyAdLimit();
      unsubAdSessions();
      unsubAdCompletions();
      unsubPaymentMethods();
      unsubWithdrawSettings();
      unsubUserWithdrawals();
      unsubReferralSettings();
      unsubLeaderboard();
    };
  }, [authReady, firebaseUser, emailVerifiedFlag, isAdminRoute, showToast]);

  const openAuthModal = (
    mode: AuthModalMode = 'login',
    reason = '',
    action: PendingAuthAction | null = null,
  ) => {
    setAuthModalMode(mode);
    setAuthModalReason(reason);
    if (action !== undefined) {
      setPendingAction(action);
    }
    setAuthModalOpen(true);
  };

  // Enforce Protected Routes & Authenticated Redirects
  useEffect(() => {
    if (!authReady) return;

    if (!firebaseUser) {
      if (!PUBLIC_BROWSE_PAGES.includes(currentPage)) {
        setCurrentPage('home');
      }
      return;
    }

    setAuthModalOpen(false);

    if (!firebaseUser.emailVerified) {
      if (currentPage !== 'verify-email') {
        setCurrentPage('verify-email');
      }
      return;
    }

    if (currentPage === 'verify-email' || currentPage === 'splash' || currentPage === 'login' || currentPage === 'register') {
      setCurrentPage('home');
    }
  }, [authReady, firebaseUser, firebaseUser?.emailVerified, currentPage]);

  const handleNavigate = (target: AppPage) => {
    if (!firebaseUser && !PUBLIC_BROWSE_PAGES.includes(target)) {
      const reason =
        ACTION_AUTH_REASONS[target] || 'Sign in or create an account to continue.';
      openAuthModal('login', reason, { type: 'navigate', page: target });
      return;
    }
    if (firebaseUser && !firebaseUser.emailVerified && target !== 'verify-email') {
      setCurrentPage('verify-email');
      return;
    }
    setCurrentPage(target);
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      setPendingAction(null);
      setAutoOpenBonusModal(false);
      setCurrentPage('home');
      showToast('Signed out successfully.', 'info');
    } catch (err) {
      showToast(mapAuthError(err), 'error');
    }
  };

  const paymentMethods = appRepository.getPaymentMethods(economy, firestoreMethods);

  const activeUser: UserProfile = userProfile ?? {
    uid: firebaseUser?.uid ?? '',
    fullName: firebaseUser?.displayName || 'AdView Member',
    username: 'member',
    email: firebaseUser?.email || '',
    phoneNumber: '',
    profileImage: '',
    referralCode: 'MEMBER',
    referredBy: '',
    points: 0,
    totalEarnings: 0,
    totalAdViews: 0,
    accountStatus: 'active',
    emailVerified: Boolean(firebaseUser?.emailVerified),
    level: 'Bronze Member',
    verified: Boolean(firebaseUser?.emailVerified),
    referralLink: typeof window !== 'undefined' ? window.location.origin : 'https://adviewearn.com',
    joinedAt: 'Just now',
  };

  const wallet = computeDashboardMetrics(
    activeUser,
    transactions,
    referredUsers,
    economy,
    dailyAdLimit,
    walletDoc,
  );

  const systemNotifications = appRepository
    .getSystemNotifications(Boolean(firebaseUser?.emailVerified))
    .map((n) => ({
      ...n,
      read: n.read || readSysNotifIds.includes(n.id),
    }));

  const notifications: NotificationItem[] = [...firestoreNotifications, ...systemNotifications];

  const handleMarkNotificationsRead = () => {
    setReadSysNotifIds((prev) =>
      Array.from(new Set([...prev, ...systemNotifications.map((n) => n.id)])),
    );
    firestoreNotifications
      .filter((n) => !n.read && n.fromFirestore)
      .forEach((n) => {
        void markFirestoreNotificationRead(n.id).catch(() => {});
      });
  };

  const handleSelectWithdrawMethod = (methodId: PaymentMethodId) => {
    if (!firebaseUser) {
      openAuthModal('login', 'Sign in to submit a withdrawal request.', {
        type: 'withdraw_method',
        methodId,
      });
      return;
    }
    setPreferredWithdrawMethod(methodId);
    handleNavigate('withdraw');
  };

  const handleRequireDailyBonus = () => {
    openAuthModal('login', 'Sign in to claim your Daily Check-in Bonus.', {
      type: 'daily_bonus',
    });
  };

  const handleStartDailyBonus = async () => {
    if (!firebaseUser) {
      handleRequireDailyBonus();
      return;
    }
    if (dailyBonus.claimedToday) {
      showToast('You have already claimed today’s Daily Check-in Bonus.', 'info');
      return;
    }
    if (initiatingDailyBonus || initiatingAdId) return;

    // Open blank tab synchronously inside click gesture so Monetag Direct Link launches smoothly
    let preOpenedWindow: Window | null = null;
    if (typeof window !== 'undefined') {
      try {
        preOpenedWindow = window.open('about:blank', '_blank');
        if (preOpenedWindow) {
          preOpenedWindow.opener = null;
        }
      } catch {
        preOpenedWindow = null;
      }
    }

    setInitiatingDailyBonus(true);
    try {
      const { session, ad, launchUrl } = await initiateDailyBonusAdSession(activeUser);
      let blocked = false;
      if (launchUrl && preOpenedWindow && !preOpenedWindow.closed) {
        preOpenedWindow.location.replace(launchUrl);
      } else {
        if (preOpenedWindow && !preOpenedWindow.closed) {
          preOpenedWindow.close();
        }
        if (launchUrl) {
          blocked = true;
        }
      }

      setActiveWatchAd(ad);
      setActiveWatchSessionId(session.sessionId);
      setActiveWatchStartedAtMs(Date.now());
      setWatchPopupBlocked(blocked);
      setWatchOverlayOpen(true);
    } catch (err) {
      if (preOpenedWindow && !preOpenedWindow.closed) {
        preOpenedWindow.close();
      }
      showToast(
        err instanceof Error ? err.message : 'Could not start Daily Check-in Bonus session.',
        'error',
      );
    } finally {
      setInitiatingDailyBonus(false);
    }
  };

  const handleStartWatchAd = async (ad: Advertisement) => {
    if (!firebaseUser) {
      openAuthModal(
        'login',
        'Sign in to watch verified ads and earn real points.',
        ad.adId.startsWith('demo-')
          ? { type: 'navigate', page: 'earn' }
          : { type: 'watch_ad', ad },
      );
      return;
    }
    if (initiatingAdId) return;

    // Synchronous pre-checks before opening any popup window
    const globalLimit = economy.dailyAdLimit || DEFAULT_DAILY_AD_LIMIT;
    const todayDhaka = getDhakaDateKey();
    const todayCompletedList = adCompletions.filter(
      (c) => c.dhakaDate === todayDhaka && c.status === 'completed',
    );
    const completedGlobal =
      dailyAdLimit && dailyAdLimit.dhakaDate === todayDhaka
        ? dailyAdLimit.completedCount
        : todayCompletedList.length;
    const completedForAd = todayCompletedList.filter((c) => c.adId === ad.adId).length;

    const launchKind = resolveAdLaunchKind(ad.placementOrUrl);
    const canPreOpenWindow =
      launchKind === 'external_url' &&
      economy.earningEnabled &&
      activeUser.accountStatus === 'active' &&
      ad.status === 'active' &&
      completedGlobal < globalLimit &&
      completedForAd < ad.dailyLimit;

    // Open blank tab synchronously inside user click gesture to prevent mobile/desktop popup blocking
    let preOpenedWindow: Window | null = null;
    if (canPreOpenWindow && typeof window !== 'undefined') {
      try {
        preOpenedWindow = window.open('about:blank', '_blank');
        if (preOpenedWindow) {
          preOpenedWindow.opener = null;
        }
      } catch {
        preOpenedWindow = null;
      }
    }

    setInitiatingAdId(ad.adId);
    try {
      const session = await initiateAdSession(
        activeUser,
        ad,
        adCompletions,
        dailyAdLimit,
        globalLimit,
        economy.earningEnabled,
      );

      let blocked = false;
      if (launchKind === 'external_url') {
        const launchUrl = buildPlacementLaunchUrl(ad.placementOrUrl, {
          sessionId: session.sessionId,
          userId: session.userId,
          adId: ad.adId,
          adNetwork: ad.adNetwork,
        });
        if (launchUrl && preOpenedWindow && !preOpenedWindow.closed) {
          preOpenedWindow.location.replace(launchUrl);
        } else {
          if (preOpenedWindow && !preOpenedWindow.closed) {
            preOpenedWindow.close();
          }
          if (launchUrl) {
            blocked = true;
          }
        }
      } else if (preOpenedWindow && !preOpenedWindow.closed) {
        preOpenedWindow.close();
      }

      setActiveWatchAd(ad);
      setActiveWatchSessionId(session.sessionId);
      setActiveWatchStartedAtMs(Date.now());
      setWatchPopupBlocked(blocked);
      setWatchOverlayOpen(true);
    } catch (err) {
      if (preOpenedWindow && !preOpenedWindow.closed) {
        preOpenedWindow.close();
      }
      showToast(err instanceof Error ? err.message : 'Could not start ad session.', 'error');
    } finally {
      setInitiatingAdId(null);
    }
  };

  const handleStartRewardedDirectLink = (link: DirectLinkAdRecord) => {
    void handleStartWatchAd(toPlayableAdvertisement(link));
  };

  // Automatically continue pending action right after login/signup/verification completes
  useEffect(() => {
    if (
      !authReady ||
      !firebaseUser ||
      !firebaseUser.emailVerified ||
      profileLoading ||
      !pendingAction ||
      activeUser.accountStatus !== 'active'
    ) {
      return;
    }

    const action = pendingAction;
    setPendingAction(null);
    setAuthModalOpen(false);
    setAuthModalReason('');

    if (action.type === 'navigate') {
      setCurrentPage(action.page);
    } else if (action.type === 'withdraw_method') {
      setPreferredWithdrawMethod(action.methodId);
      setCurrentPage('withdraw');
    } else if (action.type === 'daily_bonus') {
      setCurrentPage('home');
      setAutoOpenBonusModal(true);
    } else if (action.type === 'watch_ad') {
      void handleStartWatchAd(action.ad);
    }
  }, [
    authReady,
    firebaseUser,
    firebaseUser?.emailVerified,
    profileLoading,
    pendingAction,
    activeUser.accountStatus,
  ]);

  const currentWatchSession: AdSessionRecord | null = useMemo(() => {
    if (!activeWatchSessionId || !activeWatchAd) return null;
    const live = adSessions.find((s) => s.sessionId === activeWatchSessionId);
    if (live) return live;
    return {
      id: activeWatchSessionId,
      sessionId: activeWatchSessionId,
      userId: activeUser.uid,
      adId: activeWatchAd.adId,
      adName: activeWatchAd.adName,
      adNetwork: activeWatchAd.adNetwork,
      expectedRewardPoints: activeWatchAd.rewardPoints,
      dhakaDate: dailyAdLimit?.dhakaDate || '',
      status: 'pending',
      transactionId: '',
      rejectionReason: '',
      createdAtLabel: 'Just now',
      createdAtMillis: Date.now(),
    };
  }, [activeWatchSessionId, activeWatchAd, adSessions, activeUser.uid, dailyAdLimit?.dhakaDate]);

  // Strictly server-verified Admin Panel at /admin (never exposes Admin login or controls to non-admins)
  if (isAdminRoute) {
    if (!authReady || (firebaseUser && emailVerifiedFlag && adminVerifyStatus !== 'done')) {
      return (
        <SiteBrandingProvider value={siteSettings}>
          <RouteLoadingFallback fullScreen />
        </SiteBrandingProvider>
      );
    }
    if (firebaseUser && emailVerifiedFlag && adminSession?.authorized) {
      return (
        <SiteBrandingProvider value={siteSettings}>
          <Suspense fallback={<RouteLoadingFallback fullScreen />}>
            <AdminApp
              onExitToUserSite={() => {
                adminManuallyExitedRef.current = true;
                if (typeof window !== 'undefined') {
                  window.history.pushState(null, '', '/');
                }
                setIsAdminRoute(false);
              }}
            />
          </Suspense>
        </SiteBrandingProvider>
      );
    }
  }

  // Hold briefly while verifying a newly logged-in verified user so an authorized Admin transitions directly to Admin Panel
  if (firebaseUser && emailVerifiedFlag && adminVerifyStatus === 'checking') {
    return (
      <SiteBrandingProvider value={siteSettings}>
        <RouteLoadingFallback fullScreen />
      </SiteBrandingProvider>
    );
  }

  // Maintenance Mode Gate for User Portal
  if (siteSettings.maintenanceMode) {
    return (
      <SiteBrandingProvider value={siteSettings}>
        <div className="min-h-dvh flex items-center justify-center p-4 bg-[#06091B] text-slate-100">
          <GlassCard className="max-w-md w-full p-6 sm:p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300 mx-auto">
              <Wrench className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-extrabold font-display text-white">
              {siteSettings.websiteName} is Under Maintenance
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              We are performing scheduled platform upgrades to keep rewards and payouts fast and
              secure. Please check back shortly.
            </p>
            {(siteSettings.supportEmail || siteSettings.supportContact) && (
              <p className="text-xs text-violet-300">
                Support: {siteSettings.supportEmail}
                {siteSettings.supportContact ? ` · ${siteSettings.supportContact}` : ''}
              </p>
            )}
          </GlassCard>
        </div>
      </SiteBrandingProvider>
    );
  }

  // Email Verification Gate (only when signed in with unverified email/password)
  if (firebaseUser && !emailVerifiedFlag) {
    return (
      <SiteBrandingProvider value={siteSettings}>
        <Suspense fallback={<RouteLoadingFallback fullScreen />}>
          <VerifyEmailPage
            email={firebaseUser.email ?? activeUser.email}
            onVerified={async () => {
              await firebaseUser.reload();
              await firebaseUser.getIdToken(true);
              setEmailVerifiedFlag(Boolean(auth.currentUser?.emailVerified));
              setFirebaseUser(auth.currentUser);
              setCurrentPage('home');
            }}
            onLogout={handleLogout}
          />
        </Suspense>
      </SiteBrandingProvider>
    );
  }

  // Restricted / Suspended / Banned Account Guard (authenticated active check)
  if (firebaseUser && activeUser.accountStatus !== 'active') {
    const isRestricted = activeUser.accountStatus === 'restricted';
    const isBanned = activeUser.accountStatus === 'banned';
    return (
      <SiteBrandingProvider value={siteSettings}>
        <div className="min-h-dvh flex items-center justify-center p-4 bg-[#06091B]">
          <GlassCard className="max-w-md w-full p-6 text-center space-y-4">
            <div
              className={`w-12 h-12 rounded-2xl border flex items-center justify-center mx-auto ${
                isRestricted
                  ? 'bg-amber-500/15 border-amber-400/30 text-amber-400'
                  : 'bg-rose-500/15 border-rose-400/30 text-rose-400'
              }`}
            >
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-extrabold font-display text-white">
              Account{' '}
              {isBanned ? 'Banned' : isRestricted ? 'Temporarily Restricted' : 'Suspended'}
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isRestricted ? (
                <>
                  Your account has been placed under temporary security review. Please contact{' '}
                  <span className="text-violet-300">
                    {siteSettings.supportEmail || 'support@adviewearn.com'}
                  </span>{' '}
                  to verify your account and restore full access.
                </>
              ) : (
                <>
                  Your account status is currently marked as{' '}
                  <span className="font-semibold text-rose-300">{activeUser.accountStatus}</span>.
                  Please contact{' '}
                  <span className="text-violet-300">
                    {siteSettings.supportEmail || 'support@adviewearn.com'}
                  </span>{' '}
                  for assistance.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </GlassCard>
        </div>
      </SiteBrandingProvider>
    );
  }

  const renderProtectedPage = () => {
    switch (currentPage) {
      case 'watch-ad':
        if (activeWatchAd && currentWatchSession) {
          return (
            <AdWatchSessionPage
              ad={activeWatchAd}
              session={currentWatchSession}
              onBackToAds={() => setCurrentPage('earn')}
            />
          );
        }
        return (
          <WatchAdsPage
            ads={activeAds}
            directLinkAds={directLinkAds}
            economy={economy}
            dailyAdLimit={dailyAdLimit}
            adCompletions={adCompletions}
            initiatingAdId={initiatingAdId}
            onStartWatchAd={handleStartWatchAd}
            onStartRewardedDirectLink={handleStartRewardedDirectLink}
            onNavigate={handleNavigate}
          />
        );
      case 'ad-history':
        return (
          <AdHistoryPage
            adCompletions={adCompletions}
            adSessions={adSessions}
            onNavigate={handleNavigate}
          />
        );
      case 'earn':
        return (
          <WatchAdsPage
            ads={activeAds}
            directLinkAds={directLinkAds}
            economy={economy}
            dailyAdLimit={dailyAdLimit}
            adCompletions={adCompletions}
            isAuthenticated={Boolean(firebaseUser)}
            initiatingAdId={initiatingAdId}
            onStartWatchAd={handleStartWatchAd}
            onStartRewardedDirectLink={handleStartRewardedDirectLink}
            onNavigate={handleNavigate}
            onOpenAuth={(mode) => openAuthModal(mode ?? 'login')}
          />
        );
      case 'wallet':
        return (
          <WalletPage
            user={activeUser}
            wallet={wallet}
            economy={economy}
            paymentMethods={paymentMethods}
            transactions={transactions}
            walletLedger={walletLedger}
            directLinkAds={directLinkAds}
            initiatingAdId={initiatingAdId}
            loading={!dashboardDataLoaded && profileLoading}
            onNavigate={handleNavigate}
            onSelectWithdrawMethod={handleSelectWithdrawMethod}
            onStartRewardedDirectLink={handleStartRewardedDirectLink}
          />
        );
      case 'withdraw':
        return (
          <WithdrawPage
            accountStatus={activeUser.accountStatus}
            wallet={wallet}
            economy={economy}
            withdrawalSettings={withdrawalSettings}
            defaultPhone={activeUser.phoneNumber}
            paymentMethods={paymentMethods}
            initialMethod={preferredWithdrawMethod}
            userWithdrawals={userWithdrawals}
            onNavigate={handleNavigate}
          />
        );
      case 'withdrawal-history':
        return (
          <WithdrawalHistoryPage
            requests={userWithdrawals}
            loading={!dashboardDataLoaded && profileLoading}
            onNavigate={handleNavigate}
          />
        );
      case 'referral':
        return (
          <ReferralPage
            user={activeUser}
            referralSettings={referralSettings}
            referredUsers={referredUsers}
            leaderboard={referralLeaderboard}
            directLinkAds={directLinkAds}
            initiatingAdId={initiatingAdId}
            onStartRewardedDirectLink={handleStartRewardedDirectLink}
          />
        );
      case 'transactions':
        return (
          <TransactionsPage
            transactions={transactions}
            walletLedger={walletLedger}
            loading={!dashboardDataLoaded && profileLoading}
          />
        );
      case 'profile':
        return (
          <ProfilePage
            user={activeUser}
            paymentMethods={paymentMethods}
            supportEmail={siteSettings.supportEmail}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
          />
        );
      case 'home':
      default:
        return (
          <HomePage
            user={activeUser}
            wallet={wallet}
            economy={economy}
            dailyBonus={dailyBonus}
            ads={activeAds}
            directLinkAds={directLinkAds}
            transactions={transactions}
            loading={Boolean(firebaseUser) && !dashboardDataLoaded && profileLoading}
            isAuthenticated={Boolean(firebaseUser)}
            initiatingAdId={initiatingAdId}
            initiatingDailyBonus={initiatingDailyBonus}
            autoOpenBonusModal={autoOpenBonusModal}
            onAutoBonusHandled={() => setAutoOpenBonusModal(false)}
            onOpenAuth={(mode) => openAuthModal(mode ?? 'login')}
            onRequireDailyBonus={handleRequireDailyBonus}
            onStartDailyBonus={() => {
              void handleStartDailyBonus();
            }}
            onNavigate={handleNavigate}
            onStartWatchAd={handleStartWatchAd}
            onStartRewardedDirectLink={handleStartRewardedDirectLink}
          />
        );
    }
  };

  return (
    <SiteBrandingProvider value={siteSettings}>
      <AppShell
        currentPage={currentPage}
        user={activeUser}
        wallet={wallet}
        notifications={notifications}
        isAuthenticated={Boolean(firebaseUser)}
        onNavigate={handleNavigate}
        onMarkNotificationsRead={handleMarkNotificationsRead}
        onOpenAuth={(mode) => openAuthModal(mode ?? 'login')}
        onLogout={handleLogout}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPage}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <Suspense fallback={<RouteLoadingFallback />}>{renderProtectedPage()}</Suspense>
          </motion.div>
        </AnimatePresence>
      </AppShell>

      {watchOverlayOpen && activeWatchAd && currentWatchSession && (
        <AdWatchSessionModal
          key={currentWatchSession.sessionId}
          ad={activeWatchAd}
          session={currentWatchSession}
          startedAtMs={activeWatchStartedAtMs || currentWatchSession.createdAtMillis || Date.now()}
          popupBlocked={watchPopupBlocked}
          onClose={() => {
            setWatchOverlayOpen(false);
            setWatchPopupBlocked(false);
            setActiveWatchAd(null);
            setActiveWatchSessionId(null);
          }}
          onSuccessToast={(msg) => showToast(msg, 'success')}
          onInfoToast={(msg) => showToast(msg, 'info')}
        />
      )}

      {!firebaseUser && authModalOpen && (
        <Suspense fallback={null}>
          <AuthModal
            open={authModalOpen}
            mode={authModalMode}
            reasonPrompt={authModalReason}
            initialReferralCode={initialRefFromUrl}
            registrationEnabled={siteSettings.registrationEnabled}
            siteName={siteSettings.websiteName}
            onModeChange={(nextMode) => setAuthModalMode(nextMode)}
            onClose={() => {
              setAuthModalOpen(false);
              setAuthModalReason('');
              setPendingAction(null);
            }}
            onAuthSuccess={() => {
              setAuthModalOpen(false);
            }}
          />
        </Suspense>
      )}

      {!authModalOpen && !watchOverlayOpen && currentPage !== 'watch-ad' && (
        <InstallAppBanner siteName={siteSettings.websiteName} />
      )}
    </SiteBrandingProvider>
  );
}
