import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  Clock,
  Eye,
  Gift,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';
import {
  AppPage,
  DirectLinkAdRecord,
  EconomyConfig,
  PaymentMethodConfig,
  PaymentMethodId,
  TransactionRecord,
  UserProfile,
  WalletLedgerEntry,
  WalletMetrics,
} from '../types';
import { DirectLinkAdsPlacement } from '../components/ads/DirectLinkAdsPlacement';
import { formatBdt, formatPoints, pointsToBdt } from '../services/appService';
import { GlassCard } from '../components/ui/GlassCard';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { TransactionHistorySection } from '../components/wallet/TransactionHistorySection';
import { useToast } from '../components/ui/ToastProvider';
import {
  BankTransferMark,
  BkashMark,
  CoinsStackIcon,
  NagadMark,
  RocketMark,
  UserAvatarGraphic,
  Wallet3DIcon,
} from '../components/icons/BrandAssets';

interface WalletPageProps {
  user: UserProfile;
  wallet: WalletMetrics;
  economy: EconomyConfig;
  paymentMethods: PaymentMethodConfig[];
  transactions: TransactionRecord[];
  walletLedger: WalletLedgerEntry[];
  directLinkAds?: DirectLinkAdRecord[];
  initiatingAdId?: string | null;
  loading: boolean;
  onNavigate: (page: AppPage) => void;
  onSelectWithdrawMethod: (methodId: PaymentMethodId) => void;
  onStartRewardedDirectLink?: (link: DirectLinkAdRecord) => void;
}

export const WalletPage: React.FC<WalletPageProps> = ({
  user,
  wallet,
  economy,
  paymentMethods,
  transactions,
  walletLedger,
  directLinkAds = [],
  initiatingAdId = null,
  loading,
  onNavigate,
  onSelectWithdrawMethod,
  onStartRewardedDirectLink,
}) => {
  const { showToast } = useToast();
  const [calcPoints, setCalcPoints] = useState('1000');

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse" aria-label="Loading wallet">
        <GlassCard className="p-5 h-24 bg-white/[0.04]">
          <div className="h-5 w-48 rounded bg-white/10" />
        </GlassCard>
        <GlassCard className="p-6 h-52 bg-white/[0.06]">
          <div className="space-y-3">
            <div className="h-4 w-32 rounded bg-white/10" />
            <div className="h-8 w-44 rounded bg-white/15" />
          </div>
        </GlassCard>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <GlassCard key={i} className="p-4 h-28 bg-white/[0.04]">
              <div className="h-4 w-24 rounded bg-white/10" />
            </GlassCard>
          ))}
        </div>
        <GlassCard className="p-6 h-64 bg-white/[0.04]">
          <div className="h-5 w-40 rounded bg-white/10" />
        </GlassCard>
      </div>
    );
  }

  const availableBdt = pointsToBdt(wallet.availablePoints, economy.pointsPerBdt);
  const pendingTotalPoints = wallet.pendingPoints + wallet.reservedPoints;
  const pendingBdt = pointsToBdt(pendingTotalPoints, economy.pointsPerBdt);
  const withdrawableBdt = pointsToBdt(wallet.withdrawablePoints, economy.pointsPerBdt);
  const lifetimeBdt = pointsToBdt(wallet.totalEarnedPoints, economy.pointsPerBdt);
  const minWithdrawBdt =
    wallet.minimumWithdrawPoints !== null
      ? pointsToBdt(wallet.minimumWithdrawPoints, economy.pointsPerBdt)
      : null;

  const parsedCalcPoints = Math.max(0, Number(calcPoints) || 0);
  const calcBdt = pointsToBdt(parsedCalcPoints, economy.pointsPerBdt);

  const handleWithdrawClick = () => {
    if (user.accountStatus !== 'active') {
      showToast('Your account is restricted from making withdrawals.', 'error');
      return;
    }
    if (!economy.walletEnabled) {
      showToast('Withdrawals are temporarily paused.', 'info');
      return;
    }
    onNavigate('withdraw');
  };

  const renderMethodMark = (id: PaymentMethodId) => {
    if (id === 'bkash') return <BkashMark className="w-11 h-11" />;
    if (id === 'nagad') return <NagadMark className="w-11 h-11" />;
    if (id === 'rocket') return <RocketMark className="w-11 h-11" />;
    return <BankTransferMark className="w-11 h-11" />;
  };

  const getMethodCardStyle = (id: PaymentMethodId) => {
    if (id === 'bkash') {
      return 'bg-gradient-to-b from-[#3B154A]/90 to-[#140E38]/95 border-pink-400/45 shadow-[0_12px_28px_-12px_rgba(226,19,110,0.45)] hover:border-pink-300/75';
    }
    if (id === 'nagad') {
      return 'bg-gradient-to-b from-[#3E1D34]/90 to-[#161036]/95 border-orange-400/45 shadow-[0_12px_28px_-12px_rgba(249,115,22,0.45)] hover:border-orange-300/75';
    }
    if (id === 'rocket') {
      return 'bg-gradient-to-b from-[#2B1761]/90 to-[#111240]/95 border-violet-400/45 shadow-[0_12px_28px_-12px_rgba(139,92,246,0.45)] hover:border-violet-300/75';
    }
    return 'bg-gradient-to-b from-[#0E2E72]/90 to-[#091642]/95 border-cyan-400/45 shadow-[0_12px_28px_-12px_rgba(37,99,235,0.45)] hover:border-cyan-300/75';
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      {/* 1. My Wallet Header + Quick Shortcuts */}
      <div className="home-glow-card rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <div
              aria-hidden="true"
              className="absolute -inset-1.5 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(56, 189, 248, 0.5) 0%, transparent 70%)',
              }}
            />
            <UserAvatarGraphic className="relative w-12 h-12 sm:w-14 sm:h-14" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-extrabold font-display text-white truncate">
                {user.fullName}&apos;s Wallet
              </h2>
              {user.verified && (
                <CheckCircle2
                  className="w-4 h-4 text-cyan-300 shrink-0 drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                  aria-label="Verified"
                />
              )}
            </div>
            <p className="text-xs text-slate-300 truncate">
              @{user.username} ·{' '}
              <span
                className={
                  economy.walletEnabled
                    ? 'text-emerald-300 font-semibold'
                    : 'text-amber-300 font-semibold'
                }
              >
                {economy.walletEnabled ? 'Wallet Active' : 'Withdrawals Paused'}
              </span>{' '}
              ·{' '}
              <span className={economy.earningEnabled ? 'text-cyan-300' : 'text-rose-300'}>
                {economy.earningEnabled ? 'Earning Active' : 'Earning Paused'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('transactions')}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-300/45 text-xs font-bold text-violet-100 inline-flex items-center gap-1.5 transition-colors"
          >
            <Receipt className="w-4 h-4 text-violet-300" />
            <span>History</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('withdrawal-history')}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-300/45 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors"
          >
            <span>Withdrawals</span>
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      {/* 2. Hero Multi-Color Illuminated Wallet Card + Converter & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="home-balance-card rounded-3xl lg:col-span-7 p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div aria-hidden="true" className="home-light-sweep" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-14 -right-12 w-52 h-52 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(103, 232, 249, 0.25) 0%, transparent 70%)',
            }}
          />

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative shrink-0 flex items-center">
                <div
                  aria-hidden="true"
                  className="absolute -inset-3 rounded-full"
                  style={{
                    background: 'radial-gradient(circle, rgba(251, 191, 36, 0.35) 0%, transparent 72%)',
                  }}
                />
                <Wallet3DIcon className="relative w-14 h-14 sm:w-16 sm:h-16" />
                <CoinsStackIcon className="hidden sm:block relative -ml-3 mt-3 w-11 h-11" />
              </div>

              <div className="min-w-0 space-y-1">
                <p className="text-xs sm:text-sm font-semibold text-cyan-100/90">Total Balance</p>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <AnimatedNumber
                    value={wallet.totalPoints}
                    className="text-3xl sm:text-4xl font-extrabold font-display text-white drop-shadow-[0_4px_20px_rgba(56,189,248,0.7)]"
                  />
                  <span className="text-base font-bold text-cyan-100">Points</span>
                </div>
                <p className="text-sm font-extrabold text-amber-300 tabular-nums inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {availableBdt !== null
                      ? `Available Value: ${formatBdt(availableBdt)}`
                      : 'Conversion Rate Active'}
                  </span>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleWithdrawClick}
              className="gold-cta-button min-h-[46px] px-5 py-2.5 rounded-full font-extrabold text-xs sm:text-sm whitespace-nowrap shrink-0"
            >
              <span aria-hidden="true" className="cta-btn-shine" />
              <span className="relative z-10">Withdraw Money</span>
            </button>
          </div>

          <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-4 border-t border-cyan-200/25 text-xs tabular-nums">
            <div className="p-3 rounded-xl bg-[#061445]/65 border border-cyan-300/30 space-y-0.5">
              <p className="text-cyan-100/80">Available</p>
              <p className="text-sm font-extrabold text-white truncate">
                {availableBdt !== null
                  ? formatBdt(availableBdt)
                  : `${formatPoints(wallet.availablePoints)} Pts`}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[#061445]/65 border border-amber-300/30 space-y-0.5">
              <p className="text-amber-100/85">Pending</p>
              <p className="text-sm font-extrabold text-amber-300 truncate">
                {formatPoints(pendingTotalPoints)} Pts
                {pendingBdt !== null && pendingTotalPoints > 0 ? ` (${formatBdt(pendingBdt)})` : ''}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[#061445]/65 border border-emerald-300/30 space-y-0.5">
              <p className="text-emerald-100/85">Withdrawable</p>
              <p className="text-sm font-extrabold text-emerald-300 truncate">
                {withdrawableBdt !== null && wallet.withdrawablePoints > 0
                  ? formatBdt(withdrawableBdt)
                  : `${formatPoints(wallet.withdrawablePoints)} Pts`}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-[#061445]/65 border border-violet-300/30 space-y-0.5">
              <p className="text-violet-100/85">Lifetime</p>
              <p className="text-sm font-extrabold text-violet-200 truncate">
                {formatPoints(wallet.totalEarnedPoints)} Pts
                {lifetimeBdt !== null && wallet.totalEarnedPoints > 0
                  ? ` (${formatBdt(lifetimeBdt)})`
                  : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Points Conversion Calculator & Breakdown */}
        <div className="home-glow-card rounded-3xl lg:col-span-5 p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-500/25 border border-violet-300/45 flex items-center justify-center text-violet-200">
                  <Calculator className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold font-display text-white">
                  Points to BDT Converter
                </h3>
              </div>
              <span className="text-xs font-bold text-amber-300 tabular-nums">
                {economy.pointsPerBdt !== null
                  ? `${economy.pointsPerBdt} Pts = ৳ 1.00`
                  : 'Rate Pending'}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-[#070E2E]/90 border border-cyan-300/20 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="wallet-calc-pts" className="text-xs text-slate-300">
                  Simulate Points
                </label>
                <input
                  id="wallet-calc-pts"
                  type="number"
                  min={0}
                  value={calcPoints}
                  onChange={(e) => setCalcPoints(e.target.value)}
                  className="w-28 h-9 px-2.5 rounded-lg bg-white/[0.08] border border-cyan-300/30 text-right text-xs font-bold text-white font-mono-num focus:outline-none focus:border-cyan-300"
                />
              </div>
              <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10 tabular-nums">
                <span className="text-slate-300">Estimated Value</span>
                <span className="text-sm font-extrabold text-emerald-300">
                  {calcBdt !== null ? formatBdt(calcBdt) : 'Rate Pending'}
                </span>
              </div>
            </div>
          </div>

          <div className="divide-y divide-white/10 text-xs">
            <div className="py-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-slate-200">
                <Eye className="w-3.5 h-3.5 text-cyan-300" />
                Ad Views Earned
              </span>
              <span className="font-bold text-emerald-300 tabular-nums">
                +{formatPoints(wallet.adViewsEarnedPoints)} Pts
              </span>
            </div>
            <div className="py-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-slate-200">
                <Users className="w-3.5 h-3.5 text-violet-300" />
                Referral Bonus
              </span>
              <span className="font-bold text-emerald-300 tabular-nums">
                +{formatPoints(wallet.referralBonusPoints)} Pts
              </span>
            </div>
            <div className="py-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-slate-200">
                <Gift className="w-3.5 h-3.5 text-amber-300" />
                Daily Bonus
              </span>
              <span className="font-bold text-emerald-300 tabular-nums">
                +{formatPoints(wallet.dailyBonusEarnedPoints)} Pts
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Four Colorful Wallet Statistics Cards */}
      <section aria-label="Wallet Statistics" className="perf-section grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl p-4 flex flex-col gap-2 bg-gradient-to-b from-[#094257]/92 via-[#072B49]/95 to-[#061336]/98 border border-emerald-400/55 shadow-[0_14px_30px_-12px_rgba(16,185,129,0.58)]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 border border-emerald-200/50 flex items-center justify-center text-white shadow-[0_0_16px_rgba(16,185,129,0.55)]">
            <Trophy className="w-5 h-5" />
          </div>
          <p className="text-xs text-emerald-100/90">Total Earned</p>
          <p className="text-lg sm:text-xl font-extrabold font-display text-white tabular-nums">
            <AnimatedNumber value={wallet.totalEarnedPoints} suffix=" Pts" />
          </p>
        </div>

        <div className="rounded-2xl p-4 flex flex-col gap-2 bg-gradient-to-b from-[#2A1B6E]/92 via-[#1A1657]/95 to-[#09103A]/98 border border-violet-400/55 shadow-[0_14px_30px_-12px_rgba(139,92,246,0.58)]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 border border-violet-200/50 flex items-center justify-center text-white shadow-[0_0_16px_rgba(139,92,246,0.55)]">
            <ArrowUpRight className="w-5 h-5" />
          </div>
          <p className="text-xs text-violet-100/90">Total Withdrawn</p>
          <p className="text-lg sm:text-xl font-extrabold font-display text-white tabular-nums">
            {wallet.totalWithdrawnBdt > 0
              ? formatBdt(wallet.totalWithdrawnBdt)
              : `${formatPoints(wallet.totalWithdrawnPoints)} Pts`}
          </p>
        </div>

        <div className="rounded-2xl p-4 flex flex-col gap-2 bg-gradient-to-b from-[#3B2654]/92 via-[#23194B]/95 to-[#0C103A]/98 border border-amber-400/55 shadow-[0_14px_30px_-12px_rgba(245,158,11,0.52)]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 border border-amber-100/50 flex items-center justify-center text-[#091234] shadow-[0_0_16px_rgba(251,191,36,0.55)]">
            <Clock className="w-5 h-5" />
          </div>
          <p className="text-xs text-amber-100/90">Pending Balance</p>
          <p className="text-lg sm:text-xl font-extrabold font-display text-amber-200 tabular-nums">
            <AnimatedNumber value={pendingTotalPoints} suffix=" Pts" />
          </p>
        </div>

        <div className="rounded-2xl p-4 flex flex-col gap-2 bg-gradient-to-b from-[#0E3184]/92 via-[#091E5A]/95 to-[#061138]/98 border border-cyan-400/55 shadow-[0_14px_30px_-12px_rgba(34,211,238,0.58)]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 border border-cyan-200/50 flex items-center justify-center text-white shadow-[0_0_16px_rgba(34,211,238,0.55)]">
            <Wallet className="w-5 h-5" />
          </div>
          <p className="text-xs text-cyan-100/90">Available Balance</p>
          <p className="text-lg sm:text-xl font-extrabold font-display text-white tabular-nums">
            <AnimatedNumber value={wallet.availablePoints} suffix=" Pts" />
          </p>
        </div>
      </section>

      {/* 4. Payment Methods & Withdrawal Policy */}
      <section className="perf-section space-y-3" aria-labelledby="wallet-payment-methods">
        <h2 id="wallet-payment-methods" className="text-base font-bold font-display text-white">
          Payment Methods
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {paymentMethods.map((method) => (
            <button
              key={method.id}
              type="button"
              disabled={!method.enabled}
              onClick={method.enabled ? () => onSelectWithdrawMethod(method.id) : undefined}
              className={`home-action-card rounded-2xl p-4 border flex flex-col items-center justify-center text-center gap-2.5 min-h-[120px] ${getMethodCardStyle(method.id)} ${
                method.enabled ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
              }`}
            >
              {renderMethodMark(method.id)}
              <div className="space-y-0.5">
                <p className="text-xs sm:text-sm font-bold text-white">
                  {method.bengaliName ? `${method.bengaliName} (${method.name})` : method.name}
                </p>
                <p className="text-[11px] text-slate-300 tabular-nums">
                  {!method.enabled
                    ? 'Temporarily Paused'
                    : method.minPoints !== null
                      ? `Min. ${formatPoints(method.minPoints)} Pts`
                      : 'Min. Pending'}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="home-glow-card rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 border-emerald-400/35">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-400/35 flex items-center justify-center text-amber-300 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-white">
              Minimum Withdraw:{' '}
              <span className="text-amber-300 tabular-nums">
                {wallet.minimumWithdrawPoints !== null
                  ? `${formatPoints(wallet.minimumWithdrawPoints)} Points${
                      minWithdrawBdt !== null ? ` (${formatBdt(minWithdrawBdt)})` : ''
                    }`
                  : 'Pending Configuration'}
              </span>
              {wallet.maximumWithdrawAmountBdt !== null && (
                <span className="text-xs font-normal text-slate-300">
                  {' '}
                  · Max {formatBdt(wallet.maximumWithdrawAmountBdt)}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>
                All balance &amp; withdrawal records are verified inside atomic server transactions.
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-300 font-semibold shrink-0">
          <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
          <span>Verified Ledger Active</span>
        </div>
      </div>

      {/* 5. Recent Wallet Activity & Ledger Section */}
      <TransactionHistorySection
        transactions={transactions}
        walletLedger={walletLedger}
        pageSize={8}
        title="Recent Wallet Activity"
      />

      {/* 6. Featured Partner Spotlight Direct Links */}
      {directLinkAds.some((l) => l.status === 'active' && l.placement === 'featured_section') && (
        <DirectLinkAdsPlacement
          links={directLinkAds}
          placement="featured_section"
          heading="Featured Partner Spotlight"
          subtitle="Additional Monetag & advertising offers curated for members"
          initiatingAdId={initiatingAdId}
          onStartRewardedDirectLink={(link) => onStartRewardedDirectLink?.(link)}
        />
      )}
    </div>
  );
};

function ChevronRightIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
    </svg>
  );
}
