import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { Activity, Coins, Eye, Megaphone, Sparkles, TrendingUp, Users } from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { formatBdt, formatPoints, getDhakaDateKey, pointsToBdt } from '../services/appService';

interface RealtimeStatsState {
  totalUsers: number;
  activeUsers: number;
  todayRegistrations: number;
  totalPointsEarned: number;
  totalEarningsBdt: number | null;
  pointsPerBdt: number | null;
  activeAdsCount: number;
  totalAdViews: number;
  todayAdViews: number;
}

const INITIAL_STATS: RealtimeStatsState = {
  totalUsers: 0,
  activeUsers: 0,
  todayRegistrations: 0,
  totalPointsEarned: 0,
  totalEarningsBdt: null,
  pointsPerBdt: null,
  activeAdsCount: 0,
  totalAdViews: 0,
  todayAdViews: 0,
};

export const DashboardStats: React.FC = () => {
  const [stats, setStats] = useState<RealtimeStatsState>(INITIAL_STATS);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let unsubs: Array<() => void> = [];

    const clearListeners = () => {
      unsubs.forEach((fn) => fn());
      unsubs = [];
    };

    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      clearListeners();

      if (!currentUser) {
        setStats(INITIAL_STATS);
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg('');

      let userTotalCount = 0;
      let userActiveCount = 0;
      let userTodayCount = 0;
      let userEarnedSum = 0;
      let userViewsSum = 0;
      let txEarnedSum = 0;
      let completionsTotalCount = 0;
      let completionsTodayCount = 0;
      let dailyLimitsTodayCount = 0;
      let activeAdsCount = 0;
      let pointsPerBdt: number | null = null;
      let settledCollections = 0;

      const recompute = () => {
        const totalPointsEarned = Math.max(txEarnedSum, userEarnedSum);
        const totalAdViews = Math.max(userViewsSum, completionsTotalCount);
        const todayAdViews = Math.max(completionsTodayCount, dailyLimitsTodayCount);
        const totalEarningsBdt = pointsToBdt(totalPointsEarned, pointsPerBdt);

        setStats({
          totalUsers: userTotalCount,
          activeUsers: userActiveCount,
          todayRegistrations: userTodayCount,
          totalPointsEarned,
          totalEarningsBdt,
          pointsPerBdt,
          activeAdsCount,
          totalAdViews,
          todayAdViews,
        });

        if (settledCollections >= 2) {
          setLoading(false);
        }
      };

      const onSnapError = (path: string, err: unknown) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          setErrorMsg(wrapped instanceof Error ? wrapped.message : 'Unable to sync stats.');
          setLoading(false);
        }
      };

      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            const todayDhaka = getDhakaDateKey();
            let total = 0;
            let active = 0;
            let todayNew = 0;
            let earned = 0;
            let views = 0;

            snap.docs.forEach((d) => {
              const data = d.data();
              total += 1;
              if ((data.accountStatus ?? 'active') === 'active') active += 1;
              if (data.createdAt instanceof Timestamp) {
                if (getDhakaDateKey(data.createdAt.toDate()) === todayDhaka) {
                  todayNew += 1;
                }
              }
              earned += Math.max(0, Number(data.totalEarnings || 0));
              views += Math.max(0, Number(data.totalAdViews || 0));
            });

            userTotalCount = total;
            userActiveCount = active;
            userTodayCount = todayNew;
            userEarnedSum = earned;
            userViewsSum = views;
            settledCollections += 1;
            recompute();
          },
          (err) => onSnapError('users', err),
        ),
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'transactions'),
          (snap) => {
            let sum = 0;
            snap.docs.forEach((d) => {
              const data = d.data();
              const status = String(data.status || 'completed');
              const delta = Number(data.pointsDelta || 0);
              if (status === 'completed' && delta > 0) {
                sum += delta;
              }
            });
            txEarnedSum = sum;
            settledCollections += 1;
            recompute();
          },
          (err) => onSnapError('transactions', err),
        ),
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'adCompletions'),
          (snap) => {
            const todayDhaka = getDhakaDateKey();
            let total = 0;
            let today = 0;
            snap.docs.forEach((d) => {
              const data = d.data();
              if (data.status === 'completed') {
                total += 1;
                if (String(data.dhakaDate || '') === todayDhaka) {
                  today += 1;
                }
              }
            });
            completionsTotalCount = total;
            completionsTodayCount = today;
            recompute();
          },
          (err) => onSnapError('adCompletions', err),
        ),
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'dailyAdLimits'),
          (snap) => {
            const todayDhaka = getDhakaDateKey();
            let today = 0;
            snap.docs.forEach((d) => {
              const data = d.data();
              if (String(data.dhakaDate || '') === todayDhaka) {
                today += Math.max(0, Number(data.completedCount || 0));
              }
            });
            dailyLimitsTodayCount = today;
            recompute();
          },
          (err) => onSnapError('dailyAdLimits', err),
        ),
      );

      unsubs.push(
        onSnapshot(
          collection(db, 'advertisements'),
          (snap) => {
            let active = 0;
            snap.docs.forEach((d) => {
              if (d.data()?.status === 'active') active += 1;
            });
            activeAdsCount = active;
            recompute();
          },
          (err) => onSnapError('advertisements', err),
        ),
      );

      unsubs.push(
        onSnapshot(
          doc(db, 'appSettings', 'wallet'),
          (snap) => {
            if (snap.exists()) {
              const rate = Number(snap.data()?.pointsPerBdt || 0);
              pointsPerBdt = rate > 0 ? rate : null;
            } else {
              pointsPerBdt = null;
            }
            recompute();
          },
          () => {
            // Non-blocking if settings not created yet
          },
        ),
      );
    });

    return () => {
      unsubAuth();
      clearListeners();
    };
  }, []);

  if (errorMsg) {
    return (
      <div className="rounded-2xl bg-rose-500/10 border border-rose-400/30 p-4 text-xs text-rose-200">
        {errorMsg}
      </div>
    );
  }

  return (
    <section aria-label="Real-time Admin Highlights" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" />
          <h2 className="text-sm font-bold font-display text-white tracking-tight">
            Live Platform Metrics
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Real-time Firestore Sync</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Total Users */}
        <div className="relative overflow-hidden rounded-2xl border border-violet-400/25 bg-gradient-to-br from-violet-600/25 via-[#0E1536] to-[#080D23] p-5">
          <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-violet-500/20 blur-2xl pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-200/80">
                Total Users
              </p>
              <p className="text-3xl font-extrabold font-mono-num text-white mt-2">
                {loading ? '—' : formatPoints(stats.totalUsers)}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-600/25 shrink-0">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="relative mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300">
            <span>
              Active: <strong className="font-mono-num text-white">{stats.activeUsers}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
              <TrendingUp className="w-3.5 h-3.5" />
              +{stats.todayRegistrations} today
            </span>
          </div>
        </div>

        {/* Card 2: Total Earnings */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-600/20 via-[#0E1536] to-[#080D23] p-5">
          <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-emerald-500/20 blur-2xl pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200/80">
                Total Platform Earnings
              </p>
              <p className="text-3xl font-extrabold font-mono-num text-white mt-2">
                {loading
                  ? '—'
                  : stats.totalEarningsBdt !== null
                    ? formatBdt(stats.totalEarningsBdt)
                    : `${formatPoints(stats.totalPointsEarned)} Pts`}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/25 shrink-0">
              <Coins className="w-5 h-5" />
            </div>
          </div>
          <div className="relative mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300">
            <span>
              Distributed:{' '}
              <strong className="font-mono-num text-emerald-200">
                {formatPoints(stats.totalPointsEarned)} Pts
              </strong>
            </span>
            <span className="font-mono-num text-slate-400">
              {stats.pointsPerBdt ? `${stats.pointsPerBdt} Pts = ৳1` : 'Rate unset'}
            </span>
          </div>
        </div>

        {/* Card 3: Active Ad Views */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-400/25 bg-gradient-to-br from-blue-600/25 via-[#0E1536] to-[#080D23] p-5">
          <div className="absolute -right-8 -top-8 w-28 h-28 rounded-full bg-blue-500/20 blur-2xl pointer-events-none" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-200/80">
                Active Ad Views
              </p>
              <p className="text-3xl font-extrabold font-mono-num text-white mt-2">
                {loading ? '—' : formatPoints(stats.totalAdViews)}
              </p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white shadow-lg shadow-blue-600/25 shrink-0">
              <Eye className="w-5 h-5" />
            </div>
          </div>
          <div className="relative mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1">
              <Megaphone className="w-3.5 h-3.5 text-blue-300" />
              Active Campaigns:{' '}
              <strong className="font-mono-num text-white">{stats.activeAdsCount}</strong>
            </span>
            <span className="inline-flex items-center gap-1 text-blue-300 font-semibold">
              <Activity className="w-3.5 h-3.5" />
              {formatPoints(stats.todayAdViews)} today
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
