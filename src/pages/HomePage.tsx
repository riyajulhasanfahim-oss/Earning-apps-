import React, { useEffect } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Crown,
  Eye,
  Flame,
  Gift,
  History,
  Link2,
  Play,
  PlaySquare,
  Receipt,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import {
  Advertisement,
  AppPage,
  DailyBonusState,
  DirectLinkAdRecord,
  EconomyConfig,
  TransactionRecord,
  TransactionType,
  UserProfile,
  WalletMetrics,
} from '../types';
import { formatAdTypeLabel } from '../services/adNetworkPolicy';
import {
  DEFAULT_DAILY_AD_LIMIT,
  formatBdt,
  formatPoints,
  pointsToBdt,
} from '../services/appService';
import { useGuestDemoEarnings } from '../services/demoPreview';
import {
  CoinsStackIcon,
  GiftBox3DIcon,
  UserAvatarGraphic,
  Wallet3DIcon,
} from '../components/icons/BrandAssets';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { DashboardSkeleton } from '../components/ui/DashboardSkeleton';
import { useToast } from '../components/ui/ToastProvider';
import { DirectLinkAdsPlacement } from '../components/ads/DirectLinkAdsPlacement';

interface HomePageProps {
  user: UserProfile;
  wallet: WalletMetrics;
  economy: EconomyConfig;
  dailyBonus: DailyBonusState;
  ads: Advertisement[];
  directLinkAds?: DirectLinkAdRecord[];
  transactions: TransactionRecord[];
  loading: boolean;
  isAuthenticated?: boolean;
  initiatingAdId?: string | null;
  initiatingDailyBonus?: boolean;
  autoOpenBonusModal?: boolean;
  onAutoBonusHandled?: () => void;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
  onRequireDailyBonus?: () => void;
  onStartDailyBonus?: () => void;
  onNavigate: (page: AppPage) => void;
  onStartWatchAd: (ad: Advertisement) => void;
  onStartRewardedDirectLink?: (link: DirectLinkAdRecord) => void;
}

const TX_TYPE_LABELS: Record<TransactionType, string> = {
  ad_reward: 'Ad Reward',
  daily_bonus: 'Daily Bonus',
  referral_bonus: 'Referral Bonus',
  withdrawal: 'Withdrawal',
  admin_credit: 'Bonus Credit',
  admin_debit: 'Balance Debit',
  refund: 'Refund',
  admin_adjustment: 'Balance Adjustment',
};

const AMBIENT_PARTICLES = [
  { top: '6%', left: '9%', size: 'w-1.5 h-1.5', color: 'bg-cyan-300', delay: '0s' },
  { top: '14%', left: '84%', size: 'w-2 h-2', color: 'bg-amber-300', delay: '1.1s' },
  { top: '28%', left: '49%', size: 'w-1.5 h-1.5', color: 'bg-violet-300', delay: '2.2s' },
  { top: '44%', left: '8%', size: 'w-2 h-2', color: 'bg-emerald-300', delay: '0.7s' },
  { top: '57%', left: '90%', size: 'w-1.5 h-1.5', color: 'bg-sky-400', delay: '1.8s' },
  { top: '72%', left: '24%', size: 'w-1.5 h-1.5', color: 'bg-amber-200', delay: '2.9s' },
  { top: '84%', left: '70%', size: 'w-2 h-2', color: 'bg-fuchsia-300', delay: '1.4s' },
];

const MiniCornerBars: React.FC<{ barClass: string }> = ({ barClass }) => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute bottom-2 right-2.5 flex items-end gap-1 opacity-55"
  >
    <span className={`w-1.5 h-2.5 rounded-t-sm ${barClass}`} />
    <span className={`w-1.5 h-4 rounded-t-sm ${barClass}`} />
    <span className={`w-1.5 h-6 rounded-t-sm ${barClass}`} />
    <span className={`w-1.5 h-8 rounded-t-sm ${barClass}`} />
  </div>
);

export const HomePage: React.FC<HomePageProps> = React.memo(({
  user,
  wallet,
  economy,
  dailyBonus,
  ads,
  directLinkAds = [],
  transactions,
  loading,
  isAuthenticated = true,
  initiatingAdId = null,
  initiatingDailyBonus = false,
  autoOpenBonusModal = false,
  onAutoBonusHandled,
  onOpenAuth,
  onRequireDailyBonus,
  onStartDailyBonus,
  onNavigate,
  onStartWatchAd,
  onStartRewardedDirectLink,
}) => {
  const { showToast } = useToast();

  // Client-only animated preview for signed-out visitors; disabled immediately once authenticated
  const previewSnapshot = useGuestDemoEarnings(!isAuthenticated);

  useEffect(() => {
    if (isAuthenticated && autoOpenBonusModal) {
      if (!dailyBonus.claimedToday) {
        onStartDailyBonus?.();
      } else {
        showToast('You have already claimed today’s daily bonus.', 'info');
      }
      onAutoBonusHandled?.();
    }
  }, [
    isAuthenticated,
    autoOpenBonusModal,
    dailyBonus.claimedToday,
    onAutoBonusHandled,
    onStartDailyBonus,
    showToast,
  ]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  const displayWallet = isAuthenticated ? wallet : previewSnapshot.wallet;
  const displayEconomy = isAuthenticated ? economy : previewSnapshot.economy;
  const displayDailyBonus = isAuthenticated ? dailyBonus : previewSnapshot.dailyBonus;
  const displayAds = isAuthenticated ? ads : previewSnapshot.ads;
  const displayTransactions = isAuthenticated ? transactions : previewSnapshot.transactions;

  const managedDirectLinkIds = new Set(directLinkAds.map((l) => l.linkId));
  const featuredAds = displayAds
    .filter((ad) => !managedDirectLinkIds.has(ad.adId))
    .slice(0, 3);
  const recentTx = displayTransactions.slice(0, 5);
  const pendingTotalPoints = displayWallet.pendingPoints + displayWallet.reservedPoints;
  const bdtEquivalent = pointsToBdt(displayWallet.balancePoints, displayEconomy.pointsPerBdt);
  const withdrawableBdt = pointsToBdt(
    displayWallet.withdrawablePoints,
    displayEconomy.pointsPerBdt,
  );

  // Progress ring math for Today's Ad Views card
  const dailyCap = Math.max(1, displayEconomy.dailyAdLimit || DEFAULT_DAILY_AD_LIMIT);
  const viewProgress = Math.min(1, Math.max(0, displayWallet.todayViews / dailyCap));
  const viewProgressPct = Math.round(viewProgress * 100);
  const ringRadius = 18;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - viewProgress);

  const getAdAccentTheme = (networkName: string) => {
    const key = networkName.toLowerCase();
    if (key.includes('monetag')) {
      return {
        card: 'bg-gradient-to-r from-[#132268]/95 via-[#0E1E5A]/95 to-[#1E1B5E]/95 border-cyan-400/50 shadow-[0_12px_30px_-12px_rgba(34,211,238,0.5)] hover:border-cyan-300/80',
        badge:
          'bg-gradient-to-br from-cyan-400 via-blue-500 to-violet-600 border-cyan-200/50 shadow-[0_0_20px_rgba(56,189,248,0.6)]',
        btn: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-[0_6px_18px_rgba(14,165,233,0.55)]',
        label: 'm',
      };
    }
    if (key.includes('adsterra')) {
      return {
        card: 'bg-gradient-to-r from-[#2A1563]/95 via-[#1C1658]/95 to-[#101C52]/95 border-fuchsia-400/50 shadow-[0_12px_30px_-12px_rgba(217,70,239,0.5)] hover:border-fuchsia-300/80',
        badge:
          'bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 border-fuchsia-200/50 shadow-[0_0_20px_rgba(217,70,239,0.6)]',
        btn: 'bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 shadow-[0_6px_18px_rgba(192,38,211,0.55)]',
        label: 'A',
      };
    }
    if (key.includes('direct')) {
      return {
        card: 'bg-gradient-to-r from-[#0B2E6B]/95 via-[#0C215A]/95 to-[#091848]/95 border-sky-400/50 shadow-[0_12px_30px_-12px_rgba(56,189,248,0.5)] hover:border-sky-300/80',
        badge:
          'bg-gradient-to-br from-sky-400 to-blue-600 border-sky-200/50 shadow-[0_0_20px_rgba(14,165,233,0.6)]',
        btn: 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 shadow-[0_6px_18px_rgba(37,99,235,0.55)]',
        icon: Link2,
      };
    }
    if (key.includes('cpm')) {
      return {
        card: 'bg-gradient-to-r from-[#1A206E]/95 via-[#111D58]/95 to-[#091746]/95 border-amber-400/45 shadow-[0_12px_30px_-12px_rgba(245,158,11,0.45)] hover:border-amber-300/80',
        badge:
          'bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 border-amber-200/50 shadow-[0_0_20px_rgba(251,191,36,0.55)]',
        btn: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-[0_6px_18px_rgba(245,158,11,0.5)]',
        icon: BarChart3,
      };
    }
    return {
      card: 'bg-gradient-to-r from-[#09365E]/95 via-[#092352]/95 to-[#081744]/95 border-emerald-400/50 shadow-[0_12px_30px_-12px_rgba(16,185,129,0.5)] hover:border-emerald-300/80',
      badge:
        'bg-gradient-to-br from-emerald-400 to-teal-600 border-emerald-200/50 shadow-[0_0_20px_rgba(16,185,129,0.6)]',
      btn: 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 shadow-[0_6px_18px_rgba(16,185,129,0.55)]',
      icon: Play,
    };
  };

  const renderTxBadge = (type: TransactionType, isCredit: boolean) => {
    if (type === 'daily_bonus') {
      return (
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 border border-violet-300/50 text-amber-200 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(139,92,246,0.55)]">
          <Gift className="w-4 h-4" />
        </div>
      );
    }
    if (type === 'referral_bonus') {
      return (
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 border border-cyan-300/50 text-white flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(34,211,238,0.55)]">
          <Users className="w-4 h-4" />
        </div>
      );
    }
    if (type === 'withdrawal') {
      return (
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 border border-amber-300/50 text-white flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(245,158,11,0.5)]">
          <ArrowUpRight className="w-4 h-4" />
        </div>
      );
    }
    if (type === 'admin_adjustment') {
      return (
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-blue-700 border border-indigo-300/50 text-white flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(99,102,241,0.5)]">
          <SlidersHorizontal className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div
        className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${
          isCredit
            ? 'bg-gradient-to-br from-emerald-500 to-teal-600 border-emerald-300/50 text-white shadow-[0_0_16px_rgba(16,185,129,0.55)]'
            : 'bg-gradient-to-br from-rose-500 to-red-600 border-rose-300/50 text-white shadow-[0_0_16px_rgba(244,63,94,0.45)]'
        }`}
      >
        {isCredit ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
      </div>
    );
  };

  const handleDailyBonusAction = () => {
    if (!isAuthenticated) {
      onRequireDailyBonus?.();
      return;
    }
    if (displayDailyBonus.claimedToday) {
      showToast('You have already claimed today’s daily bonus.', 'info');
      return;
    }
    if (initiatingDailyBonus) return;
    onStartDailyBonus?.();
  };

  // 8 vibrant shortcuts strictly mapped to genuine existing features in App.tsx
  const quickShortcuts: Array<{
    key: string;
    label: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    cardClass: string;
    iconBoxClass: string;
    onClick: () => void;
  }> = [
    {
      key: 'rewarded-ads',
      label: 'Rewarded Ads',
      sub: 'Earn Now',
      icon: PlaySquare,
      cardClass:
        'bg-gradient-to-b from-[#2A1B6E]/95 to-[#121649]/95 border-violet-400/50 shadow-[0_10px_24px_-10px_rgba(139,92,246,0.65)] hover:border-violet-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-violet-500 to-fuchsia-600 border-violet-200/50 text-white shadow-[0_0_16px_rgba(168,85,247,0.65)]',
      onClick: () => onNavigate('earn'),
    },
    {
      key: 'direct-ads',
      label: 'Direct Ads',
      sub: 'Fast Claim',
      icon: Link2,
      cardClass:
        'bg-gradient-to-b from-[#0E3175]/95 to-[#0A184A]/95 border-cyan-400/50 shadow-[0_10px_24px_-10px_rgba(34,211,238,0.6)] hover:border-cyan-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-cyan-400 to-blue-600 border-cyan-200/50 text-white shadow-[0_0_16px_rgba(34,211,238,0.65)]',
      onClick: () => onNavigate('earn'),
    },
    {
      key: 'daily-bonus',
      label: 'Daily Bonus',
      sub: 'Get Gift',
      icon: Gift,
      cardClass:
        'bg-gradient-to-b from-[#3B2654]/95 to-[#1B1344]/95 border-amber-400/55 shadow-[0_10px_24px_-10px_rgba(251,191,36,0.55)] hover:border-amber-300/85',
      iconBoxClass:
        'bg-gradient-to-br from-amber-400 to-orange-500 border-amber-100/60 text-[#0B1234] shadow-[0_0_16px_rgba(251,191,36,0.7)]',
      onClick: handleDailyBonusAction,
    },
    {
      key: 'referral',
      label: 'Invite Friends',
      sub: 'Referral Bonus',
      icon: UserPlus,
      cardClass:
        'bg-gradient-to-b from-[#093A5C]/95 to-[#081A45]/95 border-emerald-400/50 shadow-[0_10px_24px_-10px_rgba(16,185,129,0.58)] hover:border-emerald-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-emerald-400 to-teal-600 border-emerald-200/50 text-white shadow-[0_0_16px_rgba(52,211,153,0.65)]',
      onClick: () => onNavigate('referral'),
    },
    {
      key: 'wallet',
      label: 'My Wallet',
      sub: 'View Balance',
      icon: Wallet,
      cardClass:
        'bg-gradient-to-b from-[#112E7A]/95 to-[#09184B]/95 border-blue-400/55 shadow-[0_10px_24px_-10px_rgba(59,130,246,0.6)] hover:border-blue-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-blue-400 to-indigo-600 border-blue-200/50 text-white shadow-[0_0_16px_rgba(59,130,246,0.65)]',
      onClick: () => onNavigate('wallet'),
    },
    {
      key: 'leaderboard',
      label: 'Leaderboard',
      sub: 'Top Ranks',
      icon: Trophy,
      cardClass:
        'bg-gradient-to-b from-[#36225B]/95 to-[#181345]/95 border-yellow-400/50 shadow-[0_10px_24px_-10px_rgba(234,179,8,0.5)] hover:border-yellow-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-yellow-300 to-amber-600 border-yellow-100/60 text-[#0B1234] shadow-[0_0_16px_rgba(250,204,21,0.65)]',
      onClick: () => onNavigate('referral'),
    },
    {
      key: 'ad-history',
      label: 'Ad History',
      sub: 'Completed',
      icon: History,
      cardClass:
        'bg-gradient-to-b from-[#1F216E]/95 to-[#0D1444]/95 border-indigo-400/50 shadow-[0_10px_24px_-10px_rgba(99,102,241,0.58)] hover:border-indigo-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-indigo-400 to-purple-600 border-indigo-200/50 text-white shadow-[0_0_16px_rgba(129,140,248,0.65)]',
      onClick: () => onNavigate('ad-history'),
    },
    {
      key: 'transactions',
      label: 'Transactions',
      sub: 'Full Ledger',
      icon: Receipt,
      cardClass:
        'bg-gradient-to-b from-[#3A1959]/95 to-[#161142]/95 border-rose-400/50 shadow-[0_10px_24px_-10px_rgba(244,63,94,0.52)] hover:border-rose-300/80',
      iconBoxClass:
        'bg-gradient-to-br from-rose-400 to-pink-600 border-rose-200/50 text-white shadow-[0_0_16px_rgba(244,63,94,0.6)]',
      onClick: () => onNavigate('transactions'),
    },
  ];

  return (
    <div className="relative space-y-3 sm:space-y-4">
      {/* Lightweight Zero-Blur Radial Ambient Glows (GPU Composited, 0ms Blur Cost) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden z-0 transform-gpu"
      >
        <div
          className="absolute -top-28 -left-24 w-80 h-80 sm:w-[460px] sm:h-[460px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(37, 99, 235, 0.24) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute top-16 -right-24 w-80 h-80 sm:w-[440px] sm:h-[440px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(124, 58, 237, 0.22) 0%, transparent 70%)',
          }}
        />
        <div
          className="hidden sm:block absolute bottom-8 left-1/3 w-96 h-96 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(16, 185, 129, 0.14) 0%, transparent 70%)',
          }}
        />
        {AMBIENT_PARTICLES.map((p, idx) => (
          <span
            key={idx}
            className={`absolute rounded-full opacity-45 ${p.size} ${p.color}`}
            style={{ top: p.top, left: p.left }}
          />
        ))}
      </div>

      {/* Foreground Content Layer */}
      <div className="relative z-10 space-y-3 sm:space-y-4">
        {/* Compact User Header Strip */}
        <div className="rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 flex items-center justify-between gap-2.5 bg-gradient-to-r from-[#0F246E]/92 via-[#152878]/92 to-[#1E1E6B]/92 border border-cyan-300/35 shadow-[0_8px_22px_-12px_rgba(14,165,233,0.5),inset_0_1px_0_rgba(255,255,255,0.18)]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative shrink-0">
              <div
                aria-hidden="true"
                className="absolute -inset-1 rounded-full opacity-75"
                style={{
                  background:
                    'radial-gradient(circle, rgba(56, 189, 248, 0.55) 0%, transparent 70%)',
                }}
              />
              <UserAvatarGraphic className="relative w-9 h-9 sm:w-11 sm:h-11" />
              <span
                aria-hidden="true"
                className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#0B1C54]"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h2 className="text-sm sm:text-base font-extrabold font-display text-white truncate">
                  {isAuthenticated ? user.fullName : 'AdView Member'}
                </h2>
                {isAuthenticated && user.verified && (
                  <CheckCircle2
                    className="w-3.5 h-3.5 text-cyan-300 shrink-0"
                    aria-label="Verified account"
                  />
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-cyan-100/85 truncate flex items-center gap-1">
                <Crown className="w-3 h-3 text-amber-300 shrink-0" />
                <span className="text-amber-300 font-semibold">
                  {isAuthenticated ? user.level : 'Premium Rewards'}
                </span>
                {isAuthenticated && (
                  <span className="text-slate-300/80 hidden sm:inline">· @{user.username}</span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => (isAuthenticated ? onNavigate('profile') : onOpenAuth?.('login'))}
            className={`min-h-[36px] sm:min-h-[40px] px-3.5 py-1.5 rounded-full text-xs font-extrabold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-transform ${
              isAuthenticated
                ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/25 hover:from-cyan-500/35 hover:to-violet-500/35 border border-cyan-300/50 text-white active:scale-[0.97]'
                : 'gold-cta-button'
            }`}
          >
            <span>{isAuthenticated ? 'Profile' : 'Sign In'}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Compact Hero Multi-Color Glowing Balance Card */}
        <section
          aria-label="Wallet Balance Overview"
          className="home-balance-card rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 flex flex-col justify-between gap-2.5 sm:gap-3.5"
        >
          <div aria-hidden="true" className="home-light-sweep" />
          {/* Ambient Cyan & Gold Aura Reflections (Zero-Blur Radial Gradients) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-14 -right-10 w-52 h-52 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(103, 232, 249, 0.25) 0%, transparent 70%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-14 -left-10 w-48 h-48 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.25) 0%, transparent 70%)',
            }}
          />

          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              {/* Compact Golden Crown Tier Chip */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#071544]/80 border border-amber-300/55">
                <Crown className="w-3 h-3 text-amber-300 shrink-0" />
                <span className="text-[11px] font-bold text-amber-200 tracking-wide">
                  {isAuthenticated ? `${user.level} Wallet` : 'AdView Reward Wallet'}
                </span>
              </div>

              <div>
                <p className="text-[11px] sm:text-xs font-semibold text-cyan-100/90 leading-tight">
                  Total Balance
                </p>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <AnimatedNumber
                    value={displayWallet.balancePoints}
                    className="text-2xl sm:text-4xl font-extrabold font-display text-white leading-tight drop-shadow-[0_2px_14px_rgba(56,189,248,0.6)]"
                  />
                  <span className="text-sm sm:text-lg font-bold text-cyan-100">Points</span>
                </div>
              </div>

              {/* Green Today Pill + Gold BDT Equivalent on one compact row */}
              <div className="flex items-center gap-2 flex-wrap tabular-nums">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/25 border border-emerald-300/55 text-[11px] sm:text-xs font-extrabold text-emerald-200">
                  <TrendingUp className="w-3 h-3 text-emerald-300 shrink-0" />
                  +{formatPoints(displayWallet.todayEarningsPoints)} Pts Today
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-extrabold text-amber-300">
                  <Sparkles className="w-3 h-3 shrink-0" />
                  {bdtEquivalent !== null
                    ? `≈ ${formatBdt(bdtEquivalent)}`
                    : 'Live Rate Synced'}
                </span>
              </div>
            </div>

            {/* Right-side Compact 3D Wallet Visual + Open Wallet CTA */}
            <div className="relative shrink-0 flex flex-col items-end gap-1.5">
              <div className="relative flex items-center justify-center">
                <div
                  aria-hidden="true"
                  className="absolute -inset-4 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle, rgba(251, 191, 36, 0.36) 0%, rgba(56, 189, 248, 0.2) 45%, transparent 72%)',
                  }}
                />
                <Wallet3DIcon className="relative w-12 h-12 sm:w-16 sm:h-16" />
                <CoinsStackIcon className="hidden sm:block relative -ml-3 mt-3 w-12 h-12" />
              </div>
              <button
                type="button"
                onClick={() => onNavigate('wallet')}
                className="inline-flex min-h-[30px] sm:min-h-[36px] px-2.5 sm:px-3.5 py-1 rounded-full bg-white/15 hover:bg-white/25 border border-cyan-200/50 text-[11px] sm:text-xs font-bold text-white items-center gap-1 transition-all shadow-[0_4px_14px_rgba(14,165,233,0.35)] active:scale-[0.97]"
              >
                <span>Wallet</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Compact 3-Column Multi-Accent Balance Breakdown Strip */}
          <div className="relative z-10 grid grid-cols-3 gap-1.5 sm:gap-2.5 pt-2.5 border-t border-cyan-200/25 text-xs tabular-nums">
            <div className="rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 bg-[#061445]/60 border border-cyan-300/25">
              <p className="text-[10px] sm:text-[11px] text-cyan-100/80 leading-tight">Available</p>
              <p className="text-[11px] sm:text-sm font-extrabold text-white mt-0.5 whitespace-nowrap">
                {formatPoints(displayWallet.availablePoints)} Pts
              </p>
            </div>
            <div className="rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 bg-[#061445]/60 border border-amber-300/25">
              <p className="text-[10px] sm:text-[11px] text-amber-100/85 leading-tight">Pending</p>
              <p className="text-[11px] sm:text-sm font-extrabold text-amber-300 mt-0.5 whitespace-nowrap">
                {formatPoints(pendingTotalPoints)} Pts
              </p>
            </div>
            <div className="rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 bg-[#061445]/60 border border-emerald-300/30">
              <p className="text-[10px] sm:text-[11px] text-emerald-100/85 leading-tight">Withdrawable</p>
              <p className="text-[11px] sm:text-sm font-extrabold text-emerald-300 mt-0.5 whitespace-nowrap">
                {withdrawableBdt !== null && displayWallet.withdrawablePoints > 0
                  ? formatBdt(withdrawableBdt)
                  : `${formatPoints(displayWallet.withdrawablePoints)} Pts`}
              </p>
            </div>
          </div>
        </section>

        {/* Dual Primary Hero Action Cards: Watch Ads (Purple/Violet) & Withdraw (Emerald Green) */}
        <section aria-label="Primary Actions" className="grid grid-cols-2 gap-2.5 sm:gap-4">
          <button
            type="button"
            onClick={() => onNavigate('earn')}
            className="home-action-card rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-2 text-left bg-gradient-to-r from-[#7C3AED] via-[#6D28D9] to-[#2563EB] border border-violet-300/65 shadow-[0_12px_26px_-8px_rgba(124,58,237,0.75),0_0_20px_-4px_rgba(167,139,250,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]"
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-white/20 border border-white/35 flex items-center justify-center shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <Play className="w-4 h-4 sm:w-5 sm:h-5 text-white fill-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] sm:text-base font-extrabold font-display text-white leading-tight whitespace-nowrap">
                  Watch Ads
                </p>
                <p className="text-[10.5px] sm:text-xs text-violet-100/90 leading-tight mt-0.5 whitespace-nowrap">
                  Earn Points
                </p>
              </div>
            </div>
            <span className="hidden min-[390px]:flex w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-white/20 border border-white/35 items-center justify-center text-white shrink-0">
              <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('withdraw')}
            className="home-action-card rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-2 text-left bg-gradient-to-r from-[#059669] via-[#10B981] to-[#0D9488] border border-emerald-200/65 shadow-[0_12px_26px_-8px_rgba(16,185,129,0.72),0_0_20px_-4px_rgba(52,211,153,0.45),inset_0_1px_0_rgba(255,255,255,0.35)]"
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-white/20 border border-white/35 flex items-center justify-center shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.2)]">
                <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] sm:text-base font-extrabold font-display text-white leading-tight whitespace-nowrap">
                  Withdraw
                </p>
                <p className="text-[10.5px] sm:text-xs text-emerald-50/95 leading-tight mt-0.5 whitespace-nowrap">
                  Fast Payouts
                </p>
              </div>
            </div>
            <span className="hidden min-[390px]:flex w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-white/20 border border-white/35 items-center justify-center text-white shrink-0">
              <ChevronRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
          </button>
        </section>

        {/* Responsive 2-Column Mobile / 4-Column Desktop Quick Shortcuts Grid */}
        <section
          aria-label="Quick Shortcuts"
          className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3"
        >
          {quickShortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className={`home-action-card rounded-2xl px-3 py-2.5 sm:p-3.5 flex flex-row sm:flex-col items-center sm:text-center gap-2.5 sm:gap-2 text-left border ${item.cardClass}`}
              >
                <div
                  className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl border flex items-center justify-center shrink-0 ${item.iconBoxClass}`}
                >
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0 flex-1 sm:flex-none sm:w-full">
                  <p className="text-xs sm:text-xs font-extrabold text-white leading-tight">
                    {item.label}
                  </p>
                  <p className="text-[10px] text-slate-300/85 leading-tight mt-0.5">
                    {item.sub}
                  </p>
                </div>
              </button>
            );
          })}
        </section>

        {/* 4 Multi-Color Earning Statistics Cards */}
        <section
          aria-label="Earning Statistics"
          className="perf-section grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4"
        >
          {/* 1. Today's Ad Views — Electric Blue & Cyan Glow + Progress Ring */}
          <div className="perf-card relative overflow-hidden rounded-2xl p-3.5 sm:p-4 flex flex-col items-center text-center gap-2 bg-gradient-to-b from-[#0E3184]/92 via-[#091E5A]/95 to-[#061138]/98 border border-sky-400/55 shadow-[0_10px_24px_-12px_rgba(14,165,233,0.55),inset_0_1px_0_rgba(186,230,253,0.22)]">
            <MiniCornerBars barClass="bg-gradient-to-t from-blue-600 to-cyan-300" />
            <div className="relative z-10 w-12 h-12 flex items-center justify-center">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle
                  cx="22"
                  cy="22"
                  r={ringRadius}
                  fill="none"
                  stroke="rgba(56, 189, 248, 0.22)"
                  strokeWidth="3.5"
                />
                <circle
                  cx="22"
                  cy="22"
                  r={ringRadius}
                  fill="none"
                  stroke="url(#adViewRingGrad)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                />
                <defs>
                  <linearGradient id="adViewRingGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#22D3EE" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
              <Eye className="w-4 h-4 text-cyan-300 absolute" />
            </div>
            <p className="relative z-10 text-xs font-semibold text-cyan-100/90">
              Today&apos;s Ad Views
            </p>
            <div className="relative z-10 flex items-baseline gap-1 tabular-nums">
              <AnimatedNumber
                value={displayWallet.todayViews}
                className="text-xl sm:text-2xl font-extrabold font-display text-white"
              />
              <span className="text-xs font-bold text-cyan-300/90">/ {dailyCap}</span>
            </div>
          </div>

          {/* 2. Today's Earnings — Emerald Green Glow + Animated Gold Coin */}
          <div className="perf-card relative overflow-hidden rounded-2xl p-3.5 sm:p-4 flex flex-col items-center text-center gap-2 bg-gradient-to-b from-[#094257]/92 via-[#072B49]/95 to-[#061336]/98 border border-emerald-400/55 shadow-[0_10px_24px_-12px_rgba(16,185,129,0.55),inset_0_1px_0_rgba(167,243,208,0.22)]">
            <MiniCornerBars barClass="bg-gradient-to-t from-emerald-600 to-lime-300" />
            <div className="relative z-10 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400/30 via-teal-400/25 to-amber-400/25 border border-emerald-300/60 flex items-center justify-center">
              <svg viewBox="0 0 32 32" className="w-7 h-7 coin-glow-animate" aria-hidden="true">
                <defs>
                  <linearGradient
                    id="homeGlowCoinGrad"
                    x1="4"
                    y1="4"
                    x2="28"
                    y2="28"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="#FEF08A" />
                    <stop offset="55%" stopColor="#FBBF24" />
                    <stop offset="100%" stopColor="#D97706" />
                  </linearGradient>
                </defs>
                <circle
                  cx="16"
                  cy="16"
                  r="12"
                  fill="url(#homeGlowCoinGrad)"
                  stroke="#FEF3C7"
                  strokeWidth="1.5"
                />
                <text
                  x="16"
                  y="20.5"
                  textAnchor="middle"
                  fill="#78350F"
                  fontSize="13"
                  fontWeight="800"
                >
                  ৳
                </text>
              </svg>
            </div>
            <p className="relative z-10 text-xs font-semibold text-emerald-100/90">
              Today&apos;s Earnings
            </p>
            <AnimatedNumber
              value={displayWallet.todayEarningsPoints}
              prefix="+"
              suffix=" Pts"
              className="relative z-10 text-xl sm:text-2xl font-extrabold font-display text-emerald-300"
            />
          </div>

          {/* 3. Total Referrals — Turquoise & Teal Neon Glow */}
          <div className="perf-card relative overflow-hidden rounded-2xl p-3.5 sm:p-4 flex flex-col items-center text-center gap-2 bg-gradient-to-b from-[#0B3A69]/92 via-[#092556]/95 to-[#061138]/98 border border-teal-400/55 shadow-[0_10px_24px_-12px_rgba(20,184,166,0.55),inset_0_1px_0_rgba(153,246,228,0.22)]">
            <MiniCornerBars barClass="bg-gradient-to-t from-teal-600 to-cyan-300" />
            <div className="relative z-10 w-12 h-12 rounded-full bg-gradient-to-br from-teal-400/35 to-cyan-500/35 border border-teal-300/60 flex items-center justify-center text-teal-200">
              <Users className="w-5 h-5" />
            </div>
            <p className="relative z-10 text-xs font-semibold text-teal-100/90">Total Referrals</p>
            <AnimatedNumber
              value={displayWallet.totalReferrals}
              className="relative z-10 text-xl sm:text-2xl font-extrabold font-display text-white"
            />
          </div>

          {/* 4. Lifetime Earnings — Royal Purple + Gold Trophy Glow */}
          <div className="perf-card relative overflow-hidden rounded-2xl p-3.5 sm:p-4 flex flex-col items-center text-center gap-2 bg-gradient-to-b from-[#2A1B6E]/92 via-[#1A1657]/95 to-[#09103A]/98 border border-violet-400/55 shadow-[0_10px_24px_-12px_rgba(168,85,247,0.55),inset_0_1px_0_rgba(221,214,254,0.22)]">
            <MiniCornerBars barClass="bg-gradient-to-t from-violet-600 to-amber-300" />
            <div className="relative z-10 w-12 h-12 rounded-full bg-gradient-to-br from-amber-400/35 via-purple-500/35 to-violet-600/35 border border-amber-300/60 flex items-center justify-center text-amber-300">
              <Trophy className="w-5 h-5" />
            </div>
            <p className="relative z-10 text-xs font-semibold text-violet-100/90">
              Lifetime Earnings
            </p>
            <AnimatedNumber
              value={displayWallet.totalEarnedPoints}
              suffix=" Pts"
              className="relative z-10 text-xl sm:text-2xl font-extrabold font-display text-amber-200"
            />
          </div>
        </section>

        {/* Radiant Daily Bonus & Goal Progress Card with Golden Illuminated CTA */}
        <div className="perf-section perf-card relative overflow-hidden rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-[#1E1B70]/95 via-[#282B8E]/95 to-[#0D4FA3]/95 border-[1.5px] border-cyan-300/60 shadow-[0_14px_34px_-10px_rgba(124,58,237,0.5),inset_0_1px_0_rgba(255,255,255,0.28)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-10 -bottom-10 w-44 h-44 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(251, 191, 36, 0.2) 0%, transparent 70%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-10 -top-12 w-52 h-52 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(103, 232, 249, 0.22) 0%, transparent 70%)',
            }}
          />
          <div className="relative z-10 flex items-center gap-3.5 min-w-0 flex-1">
            <div className="relative shrink-0">
              <div
                aria-hidden="true"
                className="absolute -inset-3 rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgba(251, 191, 36, 0.35) 0%, transparent 70%)',
                }}
              />
              <GiftBox3DIcon className="relative w-12 h-12 sm:w-14 sm:h-14" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-extrabold font-display text-white">
                  Daily Check-in Bonus
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/40 text-xs font-bold text-amber-300">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span className="tabular-nums">{displayDailyBonus.streakDays} Day Streak</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-cyan-50/95">
                {displayDailyBonus.claimedToday ? (
                  <span className="text-emerald-300 font-semibold">
                    Already Claimed Today (+{formatPoints(displayDailyBonus.lastClaimPoints)} Pts)
                  </span>
                ) : displayEconomy.dailyBonusPoints !== null ? (
                  <>
                    Today&apos;s Reward:{' '}
                    <span className="text-amber-300 font-extrabold tabular-nums drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]">
                      +{formatPoints(displayEconomy.dailyBonusPoints)} Points
                    </span>
                  </>
                ) : (
                  <span>Daily bonus rate synced from Economy Config</span>
                )}
              </p>
              {/* Daily Ad Goal Progress Bar */}
              <div className="space-y-1 max-w-md">
                <div className="flex items-center justify-between text-[11px] text-cyan-100/80 tabular-nums">
                  <span>Daily Ad Goal</span>
                  <span className="font-bold text-cyan-200">{viewProgressPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-[#07113A]/80 border border-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-amber-300 transition-all duration-500"
                    style={{ width: `${Math.max(4, viewProgressPct)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDailyBonusAction}
            disabled={(isAuthenticated && displayDailyBonus.claimedToday) || initiatingDailyBonus}
            className={`relative z-10 overflow-hidden min-h-[46px] px-6 py-2.5 rounded-full text-xs sm:text-sm font-extrabold whitespace-nowrap shrink-0 transition-all ${
              isAuthenticated && displayDailyBonus.claimedToday
                ? 'bg-emerald-500/20 border border-emerald-400/45 text-emerald-300 cursor-default'
                : 'gold-cta-button disabled:opacity-60'
            }`}
          >
            {!(isAuthenticated && displayDailyBonus.claimedToday) && (
              <span aria-hidden="true" className="cta-btn-shine" />
            )}
            <span className="relative z-10">
              {isAuthenticated && displayDailyBonus.claimedToday
                ? 'Already Claimed'
                : 'Claim Bonus'}
            </span>
          </button>
        </div>

        {/* Daily Check-in Bonus Partner Direct Links (if configured) */}
        {directLinkAds.some((l) => l.status === 'active' && l.placement === 'daily_bonus') && (
          <DirectLinkAdsPlacement
            links={directLinkAds}
            placement="daily_bonus"
            heading="Daily Check-in Partner Offers"
            subtitle="Sponsored partner campaigns featured with Daily Bonus"
            initiatingAdId={initiatingAdId}
            compact
            onStartRewardedDirectLink={(link) => onStartRewardedDirectLink?.(link)}
          />
        )}

        {/* Home Page Advertisement Direct Links */}
        {directLinkAds.some((l) => l.status === 'active' && l.placement === 'home_page') && (
          <DirectLinkAdsPlacement
            links={directLinkAds}
            placement="home_page"
            heading="Home Page Featured Partner Ads"
            subtitle="Genuine-click partner offers verified for your dashboard"
            initiatingAdId={initiatingAdId}
            onStartRewardedDirectLink={(link) => onStartRewardedDirectLink?.(link)}
          />
        )}

        {/* Bottom Split: Available Ads + Recent Activity */}
        <div className="perf-section grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
          {/* Colorful Available Ads */}
          <section className="lg:col-span-6 space-y-3" aria-labelledby="home-available-ads">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 border border-violet-300/50 flex items-center justify-center text-white shadow-[0_0_14px_rgba(168,85,247,0.55)] shrink-0">
                  <PlaySquare className="w-4 h-4" />
                </div>
                <h3 id="home-available-ads" className="text-base font-bold font-display text-white">
                  Available Ads
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('earn')}
                className="min-h-[38px] px-3.5 py-1 rounded-full bg-violet-500/20 hover:bg-violet-500/30 border border-violet-300/45 text-xs font-bold text-violet-100 hover:text-white inline-flex items-center gap-1 transition-all"
              >
                <span>See All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {featuredAds.length === 0 &&
            !directLinkAds.some((l) => l.status === 'active' && l.placement === 'available_ads') ? (
              <div className="home-glow-card rounded-2xl p-6 text-center space-y-1.5">
                <p className="text-sm font-semibold text-white">No active ads right now</p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  New advertising campaigns will appear here as soon as they go live.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {featuredAds.map((ad) => {
                  const isActive = ad.status === 'active';
                  const theme = getAdAccentTheme(ad.adNetwork);
                  const BadgeIcon = theme.icon;

                  return (
                    <div
                      key={ad.adId}
                      className={`rounded-2xl p-4 border flex items-center justify-between gap-3 transition-all ${theme.card}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-white font-extrabold text-lg shrink-0 ${theme.badge}`}
                        >
                          {theme.label ? (
                            theme.label
                          ) : BadgeIcon ? (
                            <BadgeIcon className="w-5 h-5" />
                          ) : null}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-white truncate">{ad.adName}</h4>
                            <span
                              className={`text-[11px] font-bold shrink-0 ${
                                isActive
                                  ? 'text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.75)]'
                                  : 'text-slate-400'
                              }`}
                            >
                              · {isActive ? 'Active' : 'Paused'}
                            </span>
                          </div>
                          <p className="text-xs text-cyan-100/80 truncate">
                            {ad.adNetwork} · {formatAdTypeLabel(ad.adType)}
                          </p>
                          <p className="text-xs text-slate-300 tabular-nums">
                            <span className="text-emerald-300 font-bold">
                              +{ad.rewardPoints} Pts
                            </span>{' '}
                            · ~{ad.estimatedDuration}s
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!isActive || initiatingAdId === ad.adId}
                        onClick={() => onStartWatchAd(ad)}
                        className={`min-h-[42px] px-4 py-2 rounded-full text-white text-xs font-extrabold whitespace-nowrap shrink-0 transition-all active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none ${theme.btn}`}
                      >
                        Watch Ad
                      </button>
                    </div>
                  );
                })}

                <DirectLinkAdsPlacement
                  links={directLinkAds}
                  placement="available_ads"
                  initiatingAdId={initiatingAdId}
                  compact
                  onStartRewardedDirectLink={(link) => onStartRewardedDirectLink?.(link)}
                />
              </div>
            )}
          </section>

          {/* Recent Activity (Latest 5) */}
          <section className="lg:col-span-6 space-y-3" aria-labelledby="home-recent-tx">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 border border-amber-200/50 flex items-center justify-center text-[#091234] shadow-[0_0_14px_rgba(251,191,36,0.55)] shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <h3 id="home-recent-tx" className="text-base font-bold font-display text-white">
                  Recent Activity
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('transactions')}
                className="min-h-[38px] px-3.5 py-1 rounded-full bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-300/45 text-xs font-bold text-cyan-100 hover:text-white inline-flex items-center gap-1 transition-all"
              >
                <span>See All</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="home-glow-card rounded-2xl divide-y divide-cyan-300/12">
              {recentTx.length === 0 ? (
                <div className="p-6 text-center space-y-1.5">
                  <p className="text-sm font-semibold text-white">No activity yet</p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Your ad rewards, daily check-ins, referral bonuses, and withdrawals will appear
                    here.
                  </p>
                </div>
              ) : (
                recentTx.map((tx) => {
                  const isCredit = tx.pointsDelta >= 0;
                  const statusLabel =
                    tx.status === 'completed'
                      ? 'Completed'
                      : tx.status === 'pending'
                        ? 'Pending'
                        : 'Rejected';
                  const statusColor =
                    tx.status === 'completed'
                      ? 'text-emerald-300'
                      : tx.status === 'pending'
                        ? 'text-amber-300'
                        : 'text-rose-400';

                  return (
                    <div key={tx.id} className="p-3.5 sm:p-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {renderTxBadge(tx.type, isCredit)}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">
                            {TX_TYPE_LABELS[tx.type]} · {tx.title}
                          </p>
                          <p className="text-xs text-slate-300/80 truncate">
                            {tx.timestamp} ·{' '}
                            <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-extrabold ${
                            isCredit
                              ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                              : 'bg-rose-500/20 border border-rose-400/40 text-rose-300'
                          }`}
                        >
                          {isCredit && tx.pointsDelta > 0 ? '+' : ''}
                          {formatPoints(tx.pointsDelta)} Pts
                        </span>
                        {tx.bdtAmount !== null && (
                          <p className="text-[11px] text-cyan-200/75 mt-0.5">
                            {formatBdt(tx.bdtAmount)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});
