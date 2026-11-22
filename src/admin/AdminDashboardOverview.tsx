import React, { useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  Coins,
  CreditCard,
  Eye,
  Gift,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import {
  AdCompletionRecord,
  AdminSectionKey,
  AnalyticsRangeKey,
  DailyAdLimitRecord,
  EconomyConfig,
  ReferralSettingsConfig,
  ReferredUser,
  TransactionRecord,
  UserProfile,
  WithdrawalRequestRecord,
} from '../types';
import { formatBdt, formatPoints, getDhakaDateKey } from '../services/appService';
import { buildAnalyticsSeries, computeAdminKpis } from '../services/adminService';
import { DashboardStats } from './DashboardStats';

interface AdminDashboardOverviewProps {
  loading: boolean;
  users: UserProfile[];
  transactions: TransactionRecord[];
  adCompletions: AdCompletionRecord[];
  dailyAdLimits: DailyAdLimitRecord[];
  withdrawals: WithdrawalRequestRecord[];
  referrals: ReferredUser[];
  economy: EconomyConfig;
  referralSettings: ReferralSettingsConfig;
  onNavigateSection: (section: AdminSectionKey) => void;
}

const RANGE_OPTIONS: Array<{ key: AnalyticsRangeKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom Range' },
];

export const AdminDashboardOverview: React.FC<AdminDashboardOverviewProps> = ({
  loading,
  users,
  transactions,
  adCompletions,
  dailyAdLimits,
  withdrawals,
  referrals,
  economy,
  referralSettings,
  onNavigateSection,
}) => {
  const todayKey = useMemo(() => getDhakaDateKey(), []);
  const [range, setRange] = useState<AnalyticsRangeKey>('7d');
  const [customStart, setCustomStart] = useState(todayKey);
  const [customEnd, setCustomEnd] = useState(todayKey);
  const [earningsPeriod, setEarningsPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const kpis = useMemo(
    () =>
      computeAdminKpis({
        users,
        transactions,
        adCompletions,
        dailyAdLimits,
        withdrawals,
        referrals,
        pointsPerBdt: economy.pointsPerBdt,
        referrerBonusPoints: referralSettings.referrerBonusPoints,
      }),
    [
      users,
      transactions,
      adCompletions,
      dailyAdLimits,
      withdrawals,
      referrals,
      economy.pointsPerBdt,
      referralSettings.referrerBonusPoints,
    ],
  );

  const analytics = useMemo(
    () =>
      buildAnalyticsSeries({
        range,
        customStart,
        customEnd,
        users,
        transactions,
        adCompletions,
        withdrawals,
        pointsPerBdt: economy.pointsPerBdt,
      }),
    [range, customStart, customEnd, users, transactions, adCompletions, withdrawals, economy.pointsPerBdt],
  );

  const kpiCards: Array<{
    title: string;
    value: string;
    subtext: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    section?: AdminSectionKey;
  }> = [
    {
      title: 'Total Registered Users',
      value: formatPoints(kpis.totalUsers),
      subtext: 'Live Firestore accounts',
      icon: Users,
      accent: 'from-violet-600/20 to-blue-600/10 border-violet-400/25 text-violet-300',
      section: 'users',
    },
    {
      title: 'Active Users',
      value: formatPoints(kpis.activeUsers),
      subtext: `${kpis.totalUsers > 0 ? Math.round((kpis.activeUsers / kpis.totalUsers) * 100) : 0}% of total`,
      icon: UserCheck,
      accent: 'from-emerald-600/20 to-teal-600/10 border-emerald-400/25 text-emerald-300',
      section: 'users',
    },
    {
      title: "Today's New Users",
      value: formatPoints(kpis.todayNewUsers),
      subtext: `Dhaka ${todayKey}`,
      icon: UserPlus,
      accent: 'from-blue-600/20 to-indigo-600/10 border-blue-400/25 text-blue-300',
      section: 'users',
    },
    {
      title: 'Total Ad Views',
      value: formatPoints(kpis.totalAdViews),
      subtext: 'Verified completions',
      icon: Eye,
      accent: 'from-violet-600/20 to-purple-600/10 border-violet-400/25 text-violet-300',
      section: 'ads',
    },
    {
      title: "Today's Ad Views",
      value: formatPoints(kpis.todayAdViews),
      subtext: `Asia/Dhaka ${todayKey}`,
      icon: Activity,
      accent: 'from-sky-600/20 to-blue-600/10 border-sky-400/25 text-sky-300',
      section: 'ads',
    },
    {
      title: 'Total Points Distributed',
      value: formatPoints(kpis.totalPointsDistributed),
      subtext: 'Completed rewards & credits',
      icon: Coins,
      accent: 'from-amber-600/20 to-orange-600/10 border-amber-400/25 text-amber-300',
      section: 'points',
    },
    {
      title: 'Total Earnings (BDT)',
      value: formatBdt(kpis.totalEarningsBdt),
      subtext: economy.pointsPerBdt ? `${economy.pointsPerBdt} Pts = ৳1` : 'Set conversion rate',
      icon: TrendingUp,
      accent: 'from-emerald-600/20 to-blue-600/10 border-emerald-400/25 text-emerald-300',
      section: 'settings',
    },
    {
      title: 'Pending Withdrawals',
      value: formatPoints(kpis.pendingWithdrawalsCount),
      subtext: `৳ ${kpis.pendingWithdrawalsBdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: Wallet,
      accent: 'from-amber-600/20 to-rose-600/10 border-amber-400/25 text-amber-300',
      section: 'withdrawals',
    },
    {
      title: 'Total Paid Withdrawals',
      value: formatPoints(kpis.paidWithdrawalsCount),
      subtext: `৳ ${kpis.paidWithdrawalsBdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} paid`,
      icon: CreditCard,
      accent: 'from-blue-600/20 to-violet-600/10 border-blue-400/25 text-blue-300',
      section: 'withdrawals',
    },
    {
      title: 'Pending Referral Rewards',
      value: formatPoints(kpis.pendingReferralsCount),
      subtext:
        referralSettings.referrerBonusPoints !== null
          ? `~${formatPoints(kpis.pendingReferralRewardsEstimatedPts)} Pts est.`
          : 'Bonus rate unset',
      icon: Gift,
      accent: 'from-violet-600/20 to-fuchsia-600/10 border-violet-400/25 text-violet-300',
      section: 'referrals',
    },
  ];

  // Chart 1: Daily Registrations & Ad Views SVG data
  const activityMax = useMemo(() => {
    let maxVal = 1;
    analytics.buckets.forEach((b) => {
      if (b.adViews > maxVal) maxVal = b.adViews;
      if (b.registrations > maxVal) maxVal = b.registrations;
    });
    return maxVal;
  }, [analytics.buckets]);

  // Chart 2: Earnings Series (Daily / Weekly / Monthly)
  const earningsSeries = useMemo(() => {
    if (earningsPeriod === 'weekly') {
      return analytics.weeklyEarnings;
    }
    if (earningsPeriod === 'monthly') {
      return analytics.monthlyEarnings;
    }
    return analytics.buckets.map((b) => ({
      label: b.label,
      points: b.pointsEarned,
      bdt: b.bdtEarned,
    }));
  }, [earningsPeriod, analytics]);

  const maxEarnedPoints = useMemo(() => {
    let maxVal = 1;
    earningsSeries.forEach((p) => {
      if (p.points > maxVal) maxVal = p.points;
    });
    return maxVal;
  }, [earningsSeries]);

  // Chart 3: Withdrawal Breakdown
  const wdItems = [
    { key: 'pending', label: 'Pending', count: analytics.withdrawalBreakdown.pending, color: 'bg-amber-400' },
    { key: 'processing', label: 'Processing', count: analytics.withdrawalBreakdown.processing, color: 'bg-sky-400' },
    { key: 'approved', label: 'Approved', count: analytics.withdrawalBreakdown.approved, color: 'bg-indigo-400' },
    { key: 'paid', label: 'Paid', count: analytics.withdrawalBreakdown.paid, color: 'bg-emerald-400' },
    { key: 'rejected', label: 'Rejected', count: analytics.withdrawalBreakdown.rejected, color: 'bg-rose-400' },
    { key: 'cancelled', label: 'Cancelled', count: analytics.withdrawalBreakdown.cancelled, color: 'bg-slate-400' },
  ];
  const wdTotal = Math.max(
    1,
    wdItems.reduce((s, i) => s + i.count, 0),
  );

  return (
    <div className="space-y-6">
      <DashboardStats />

      {/* 10 Real-Firestore KPI Cards */}
      <section aria-label="Key Performance Metrics">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {Array.from({ length: 10 }).map((_, idx) => (
              <div
                key={idx}
                className="h-28 rounded-2xl border border-white/10 bg-[#0B1026]/80 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
            {kpiCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => card.section && onNavigateSection(card.section)}
                  className="text-left rounded-2xl border border-white/10 bg-[#0B1026]/85 hover:border-violet-400/40 p-4 transition-colors flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-slate-400 leading-snug">
                      {card.title}
                    </span>
                    <div
                      className={`w-8 h-8 rounded-lg bg-gradient-to-br border flex items-center justify-center shrink-0 ${card.accent}`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xl font-extrabold font-mono-num text-white tracking-tight">
                      {card.value}
                    </p>
                    <p className="text-[11px] font-mono-num text-slate-400 mt-0.5 truncate">
                      {card.subtext}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Date Filter Bar */}
      <section className="rounded-2xl border border-white/10 bg-[#0B1026]/85 p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-violet-400 shrink-0" />
          <div>
            <h2 className="text-sm font-bold font-display text-white">
              Live Analytics & Reporting
            </h2>
            <p className="text-[11px] font-mono-num text-slate-400">
              Range: {analytics.rangeStartDhaka} to {analytics.rangeEndDhaka} (Asia/Dhaka)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRange(opt.key)}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold border transition-colors ${
                range === opt.key
                  ? 'bg-violet-600/25 border-violet-400/45 text-white'
                  : 'bg-[#06091B]/70 border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                max={todayKey}
                onChange={(e) => setCustomStart(e.target.value)}
                aria-label="Start date"
                className="min-h-[38px] px-2.5 rounded-xl bg-[#06091B] border border-white/15 text-xs font-mono-num text-white"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customEnd}
                max={todayKey}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="End date"
                className="min-h-[38px] px-2.5 rounded-xl bg-[#06091B] border border-white/15 text-xs font-mono-num text-white"
              />
            </div>
          )}
        </div>
      </section>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Chart 1: Daily User Registrations & Ad Views */}
        <section className="rounded-2xl border border-white/10 bg-[#0B1026]/85 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold font-display text-white">
                User Registrations & Ad Views
              </h3>
              <p className="text-xs text-slate-400">
                Daily signups vs verified ad completions
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-violet-300">
                <span className="w-2.5 h-2.5 rounded-sm bg-violet-500" />
                Ad Views
              </span>
              <span className="inline-flex items-center gap-1.5 text-sky-300">
                <span className="w-2.5 h-2.5 rounded-sm bg-sky-400" />
                Registrations
              </span>
            </div>
          </div>

          {analytics.buckets.every((b) => b.adViews === 0 && b.registrations === 0) ? (
            <div className="h-52 flex items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-slate-400">
              No registrations or verified ad completions recorded in this date window.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox="0 0 640 220"
                className="w-full min-w-[440px] h-52"
                role="img"
                aria-label="Daily user registrations and ad views chart"
              >
                {[0.25, 0.5, 0.75, 1].map((t) => (
                  <line
                    key={t}
                    x1="36"
                    x2="628"
                    y1={180 - t * 150}
                    y2={180 - t * 150}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="3 3"
                  />
                ))}
                <line x1="36" x2="628" y1="180" y2="180" stroke="rgba(255,255,255,0.2)" />
                {analytics.buckets.map((b, i) => {
                  const slotW = (628 - 44) / Math.max(1, analytics.buckets.length);
                  const barW = Math.max(4, Math.min(18, slotW * 0.34));
                  const cx = 44 + i * slotW + slotW / 2;
                  const adH = (b.adViews / activityMax) * 148;
                  const regH = (b.registrations / activityMax) * 148;
                  const showLabel =
                    analytics.buckets.length <= 12 ||
                    i % Math.ceil(analytics.buckets.length / 8) === 0 ||
                    i === analytics.buckets.length - 1;
                  return (
                    <g key={b.key}>
                      <rect
                        x={cx - barW - 1}
                        y={180 - adH}
                        width={barW}
                        height={Math.max(0, adH)}
                        rx="3"
                        fill="#7C3AED"
                      >
                        <title>{`${b.key}: ${b.adViews} Ad Views`}</title>
                      </rect>
                      <rect
                        x={cx + 1}
                        y={180 - regH}
                        width={barW}
                        height={Math.max(0, regH)}
                        rx="3"
                        fill="#38BDF8"
                      >
                        <title>{`${b.key}: ${b.registrations} Registrations`}</title>
                      </rect>
                      {showLabel && (
                        <text
                          x={cx}
                          y="198"
                          textAnchor="middle"
                          fontSize="10"
                          fill="#94A3B8"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {b.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                <text x="4" y="34" fontSize="10" fill="#94A3B8" fontFamily="JetBrains Mono, monospace">
                  {activityMax}
                </text>
                <text x="4" y="182" fontSize="10" fill="#94A3B8" fontFamily="JetBrains Mono, monospace">
                  0
                </text>
              </svg>
            </div>
          )}
        </section>

        {/* Chart 2: Daily / Weekly / Monthly Earnings */}
        <section className="rounded-2xl border border-white/10 bg-[#0B1026]/85 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold font-display text-white">
                Earnings Distribution
              </h3>
              <p className="text-xs text-slate-400">
                Points & BDT equivalent from completed transactions
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#06091B]/80 p-1">
              {(['daily', 'weekly', 'monthly'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setEarningsPeriod(tab)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-colors ${
                    earningsPeriod === tab
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {earningsSeries.length === 0 || earningsSeries.every((p) => p.points === 0) ? (
            <div className="h-52 flex items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-slate-400">
              No completed earnings transactions recorded for this period.
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <svg
                viewBox="0 0 640 220"
                className="w-full min-w-[440px] h-52"
                role="img"
                aria-label="Earnings trend chart"
              >
                <defs>
                  <linearGradient id="earnAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75, 1].map((t) => (
                  <line
                    key={t}
                    x1="44"
                    x2="628"
                    y1={180 - t * 150}
                    y2={180 - t * 150}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="3 3"
                  />
                ))}
                <line x1="44" x2="628" y1="180" y2="180" stroke="rgba(255,255,255,0.2)" />
                {(() => {
                  const pts = earningsSeries.map((p, idx) => {
                    const x =
                      earningsSeries.length === 1
                        ? 336
                        : 54 + (idx * (620 - 54)) / Math.max(1, earningsSeries.length - 1);
                    const y = 180 - (p.points / maxEarnedPoints) * 148;
                    return { x, y, ...p };
                  });
                  const polyline = pts.map((p) => `${p.x},${p.y}`).join(' ');
                  const areaPath =
                    pts.length > 1
                      ? `M ${pts[0].x} 180 L ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} L ${pts[pts.length - 1].x} 180 Z`
                      : '';
                  return (
                    <>
                      {areaPath && <path d={areaPath} fill="url(#earnAreaGrad)" />}
                      {pts.length > 1 && (
                        <polyline
                          fill="none"
                          stroke="#60A5FA"
                          strokeWidth="2.5"
                          points={polyline}
                        />
                      )}
                      {pts.map((p, idx) => {
                        const showLabel =
                          pts.length <= 10 ||
                          idx % Math.ceil(pts.length / 7) === 0 ||
                          idx === pts.length - 1;
                        return (
                          <g key={`${p.label}_${idx}`}>
                            <circle cx={p.x} cy={p.y} r="4" fill="#A78BFA" stroke="#06091B" strokeWidth="1.5">
                              <title>{`${p.label}: ${formatPoints(p.points)} Pts (৳${p.bdt.toFixed(2)})`}</title>
                            </circle>
                            {showLabel && (
                              <text
                                x={p.x}
                                y="198"
                                textAnchor="middle"
                                fontSize="10"
                                fill="#94A3B8"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {p.label}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
                <text x="4" y="34" fontSize="10" fill="#94A3B8" fontFamily="JetBrains Mono, monospace">
                  {formatPoints(maxEarnedPoints)}
                </text>
                <text x="4" y="182" fontSize="10" fill="#94A3B8" fontFamily="JetBrains Mono, monospace">
                  0
                </text>
              </svg>
            </div>
          )}
        </section>
      </div>

      {/* Chart 3: Withdrawal Statistics & Daily Payout Volume */}
      <section className="rounded-2xl border border-white/10 bg-[#0B1026]/85 p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold font-display text-white">
              Withdrawal Lifecycle Statistics
            </h3>
            <p className="text-xs text-slate-400">
              Distribution of withdrawal requests inside selected date range
            </p>
          </div>

          <div className="space-y-2.5">
            {wdItems.map((item) => {
              const pct = Math.round((item.count / wdTotal) * 100);
              return (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">{item.label}</span>
                    <span className="font-mono-num text-white font-semibold">
                      {item.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${item.color} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold font-display text-white">
              Summary for Selected Range
            </h3>
            <p className="text-xs text-slate-400">
              Aggregated strictly from Firestore documents
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-[#06091B]/70 p-3.5">
              <p className="text-[11px] text-slate-400">Signups in Range</p>
              <p className="text-lg font-bold font-mono-num text-white mt-1">
                {formatPoints(analytics.buckets.reduce((s, b) => s + b.registrations, 0))}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#06091B]/70 p-3.5">
              <p className="text-[11px] text-slate-400">Ad Views in Range</p>
              <p className="text-lg font-bold font-mono-num text-white mt-1">
                {formatPoints(analytics.buckets.reduce((s, b) => s + b.adViews, 0))}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#06091B]/70 p-3.5">
              <p className="text-[11px] text-slate-400">Points Earned in Range</p>
              <p className="text-lg font-bold font-mono-num text-violet-300 mt-1">
                {formatPoints(analytics.buckets.reduce((s, b) => s + b.pointsEarned, 0))}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#06091B]/70 p-3.5">
              <p className="text-[11px] text-slate-400">Withdrawal Volume</p>
              <p className="text-lg font-bold font-mono-num text-emerald-300 mt-1">
                ৳ {analytics.buckets.reduce((s, b) => s + b.withdrawalsBdt, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
