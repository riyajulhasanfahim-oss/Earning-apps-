import { useEffect, useState } from 'react';
import {
  Advertisement,
  DailyBonusState,
  EconomyConfig,
  TransactionRecord,
  WalletMetrics,
} from '../types';

export interface GuestDemoSnapshot {
  wallet: WalletMetrics;
  economy: EconomyConfig;
  dailyBonus: DailyBonusState;
  ads: Advertisement[];
  transactions: TransactionRecord[];
}

const DEMO_ADS: Advertisement[] = [
  {
    id: 'demo-ad-monetag-1',
    adId: 'demo-ad-monetag-1',
    adName: 'Monetag Premium Rewarded Video',
    adNetwork: 'Monetag',
    adType: 'rewarded',
    placementOrUrl: '',
    rewardPoints: 120,
    dailyLimit: 8,
    estimatedDuration: 30,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    allowedCountries: 'ALL',
    rewardVerificationMethod: 's2s_postback',
    incentivizedTrafficAllowed: true,
    description: 'Featured video reward campaign',
    createdAtMillis: 0,
    updatedAtMillis: 0,
  },
  {
    id: 'demo-ad-adsterra-2',
    adId: 'demo-ad-adsterra-2',
    adName: 'Adsterra High-Yield Direct Offer',
    adNetwork: 'Adsterra',
    adType: 'direct_link',
    placementOrUrl: '',
    rewardPoints: 95,
    dailyLimit: 6,
    estimatedDuration: 30,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    allowedCountries: 'ALL',
    rewardVerificationMethod: 's2s_postback',
    incentivizedTrafficAllowed: true,
    description: 'Featured direct link campaign',
    createdAtMillis: 0,
    updatedAtMillis: 0,
  },
  {
    id: 'demo-ad-monetag-3',
    adId: 'demo-ad-monetag-3',
    adName: 'VIP Interactive Video Campaign',
    adNetwork: 'Monetag',
    adType: 'rewarded',
    placementOrUrl: '',
    rewardPoints: 150,
    dailyLimit: 5,
    estimatedDuration: 30,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    status: 'active',
    allowedCountries: 'ALL',
    rewardVerificationMethod: 'sdk_callback',
    incentivizedTrafficAllowed: true,
    description: 'Featured interactive video campaign',
    createdAtMillis: 0,
    updatedAtMillis: 0,
  },
];

function makePreviewTx(
  id: string,
  type: TransactionRecord['type'],
  title: string,
  pointsDelta: number,
  timestamp: string,
): TransactionRecord {
  const isCredit = pointsDelta >= 0;
  return {
    id,
    transactionId: id,
    userId: 'guest-preview',
    title,
    subtitle: '',
    description: title,
    type,
    direction: isCredit ? 'credit' : 'debit',
    pointsDelta,
    points: Math.abs(pointsDelta),
    bdtAmount: Number((Math.abs(pointsDelta) / 100).toFixed(2)),
    conversionRateUsed: 100,
    timestamp,
    dhakaDate: '',
    createdAtMillis: 0,
    status: 'completed',
  };
}

const INITIAL_DEMO_TRANSACTIONS: TransactionRecord[] = [
  makePreviewTx('guest-tx-1', 'ad_reward', 'Monetag Rewarded Video', 120, '2 minutes ago'),
  makePreviewTx('guest-tx-2', 'daily_bonus', '7-Day Streak Check-In Bonus', 150, '18 minutes ago'),
  makePreviewTx('guest-tx-3', 'referral_bonus', 'Friend Joined via Invite Code', 500, '1 hour ago'),
  makePreviewTx('guest-tx-4', 'ad_reward', 'Adsterra High-Yield Offer', 95, '2 hours ago'),
  makePreviewTx('guest-tx-5', 'withdrawal', 'bKash Instant Payout', -5000, 'Yesterday'),
];

const DEMO_ECONOMY: EconomyConfig = {
  pointsPerBdt: 100,
  dailyBonusPoints: 150,
  minimumWithdrawPoints: 1000,
  maximumWithdrawAmountBdt: 2000,
  dailyAdLimit: 20,
  walletEnabled: true,
  earningEnabled: true,
};

const DEMO_DAILY_BONUS: DailyBonusState = {
  claimedToday: false,
  streakDays: 7,
  lastClaimDate: '',
  lastClaimPoints: 150,
};

const DEMO_ROTATING_INCREMENTS = [
  { points: 120, views: 1, title: 'Monetag Rewarded Video' },
  { points: 95, views: 1, title: 'Adsterra High-Yield Offer' },
  { points: 150, views: 1, title: 'VIP Interactive Video' },
  { points: 250, views: 0, title: 'Referral Activity Bonus' },
];

export function useGuestDemoEarnings(enabled: boolean): GuestDemoSnapshot {
  const [tickIndex, setTickIndex] = useState(0);
  const [state, setState] = useState<{
    balancePoints: number;
    withdrawablePoints: number;
    todayViews: number;
    todayEarningsPoints: number;
    totalReferrals: number;
    totalEarnedPoints: number;
    transactions: TransactionRecord[];
  }>({
    balancePoints: 14850,
    withdrawablePoints: 12500,
    todayViews: 14,
    todayEarningsPoints: 1680,
    totalReferrals: 18,
    totalEarnedPoints: 86420,
    transactions: INITIAL_DEMO_TRANSACTIONS,
  });

  useEffect(() => {
    if (!enabled) return;

    let lastInteractionAt = 0;
    const markScrolling = () => {
      lastInteractionAt = Date.now();
    };

    window.addEventListener('scroll', markScrolling, { passive: true });
    window.addEventListener('touchmove', markScrolling, { passive: true });

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (Date.now() - lastInteractionAt < 1000) return;

      setTickIndex((prevTick) => {
        const nextTick = prevTick + 1;
        const step = DEMO_ROTATING_INCREMENTS[nextTick % DEMO_ROTATING_INCREMENTS.length];

        setState((prev) => {
          const nextViews =
            prev.todayViews >= 19 && step.views > 0
              ? 12
              : Math.min(20, prev.todayViews + step.views);
          const nextTodayEarn =
            prev.todayViews >= 19 && step.views > 0
              ? 1440
              : prev.todayEarningsPoints + step.points;
          const nextBalance =
            prev.balancePoints > 24000 ? 14850 : prev.balancePoints + step.points;
          const nextWithdrawable = Math.max(10000, nextBalance - 2350);
          const nextLifetime = prev.totalEarnedPoints + step.points;
          const nextReferrals =
            nextTick % 4 === 0 ? Math.min(28, prev.totalReferrals + 1) : prev.totalReferrals;

          const nextTx = makePreviewTx(
            `guest-tx-live-${nextTick}`,
            step.views === 0 ? 'referral_bonus' : 'ad_reward',
            step.title,
            step.points,
            'Just now',
          );

          return {
            balancePoints: nextBalance,
            withdrawablePoints: nextWithdrawable,
            todayViews: nextViews,
            todayEarningsPoints: nextTodayEarn,
            totalReferrals: nextReferrals,
            totalEarnedPoints: nextLifetime,
            transactions: [nextTx, ...prev.transactions].slice(0, 5),
          };
        });

        return nextTick;
      });
    }, 5500);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', markScrolling);
      window.removeEventListener('touchmove', markScrolling);
    };
  }, [enabled]);

  void tickIndex;

  return {
    wallet: {
      totalPoints: state.balancePoints,
      balancePoints: state.balancePoints,
      availablePoints: state.balancePoints,
      pendingPoints: 0,
      reservedPoints: 0,
      withdrawablePoints: state.withdrawablePoints,
      pointsPerBdt: 100,
      todayViews: state.todayViews,
      todayEarningsPoints: state.todayEarningsPoints,
      totalReferrals: state.totalReferrals,
      totalEarnedPoints: state.totalEarnedPoints,
      totalWithdrawnPoints: 71570,
      totalWithdrawnBdt: 715.7,
      adViewsEarnedPoints: 64200,
      referralBonusPoints: 14500,
      dailyBonusEarnedPoints: 7720,
      minimumWithdrawPoints: 1000,
      maximumWithdrawAmountBdt: 2000,
    },
    economy: DEMO_ECONOMY,
    dailyBonus: DEMO_DAILY_BONUS,
    ads: DEMO_ADS,
    transactions: state.transactions,
  };
}
