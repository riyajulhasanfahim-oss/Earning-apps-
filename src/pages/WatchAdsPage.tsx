import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Clock,
  Clapperboard,
  History,
  Link2,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  AdCategoryFilter,
  AdCompletionRecord,
  Advertisement,
  AppPage,
  DailyAdLimitRecord,
  DirectLinkAdRecord,
  EconomyConfig,
} from '../types';
import { formatAdTypeLabel } from '../services/adNetworkPolicy';
import { formatPoints, getDhakaDateKey } from '../services/appService';
import { GlassCard } from '../components/ui/GlassCard';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { DirectLinkAdsPlacement } from '../components/ads/DirectLinkAdsPlacement';

interface WatchAdsPageProps {
  ads: Advertisement[];
  directLinkAds?: DirectLinkAdRecord[];
  economy: EconomyConfig;
  dailyAdLimit: DailyAdLimitRecord | null;
  adCompletions: AdCompletionRecord[];
  isAuthenticated?: boolean;
  initiatingAdId: string | null;
  onStartWatchAd: (ad: Advertisement) => void;
  onStartRewardedDirectLink?: (link: DirectLinkAdRecord) => void;
  onNavigate: (page: AppPage) => void;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
}

const CATEGORY_TABS: Array<{ id: AdCategoryFilter; label: string }> = [
  { id: 'all', label: 'All Ads' },
  { id: 'rewarded', label: 'Rewarded Ads' },
  { id: 'direct_link', label: 'Direct Link Ads' },
  { id: 'other', label: 'Other Ads' },
];

export const WatchAdsPage: React.FC<WatchAdsPageProps> = ({
  ads,
  directLinkAds = [],
  economy,
  dailyAdLimit,
  adCompletions,
  isAuthenticated = true,
  initiatingAdId,
  onStartWatchAd,
  onStartRewardedDirectLink,
  onNavigate,
  onOpenAuth,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<AdCategoryFilter>('all');

  const todayDhaka = getDhakaDateKey();
  const todayCompletedList = useMemo(
    () =>
      adCompletions.filter((c) => c.dhakaDate === todayDhaka && c.status === 'completed'),
    [adCompletions, todayDhaka],
  );

  const todayCompletedCount =
    dailyAdLimit && dailyAdLimit.dhakaDate === todayDhaka
      ? Math.max(dailyAdLimit.completedCount, todayCompletedList.length)
      : todayCompletedList.length;

  const todayEarnedPoints =
    dailyAdLimit && dailyAdLimit.dhakaDate === todayDhaka
      ? Math.max(
          dailyAdLimit.earnedPoints,
          todayCompletedList.reduce((sum, item) => sum + item.rewardPoints, 0),
        )
      : todayCompletedList.reduce((sum, item) => sum + item.rewardPoints, 0);

  const globalLimit = economy.dailyAdLimit || 20;
  const globalLimitReached = todayCompletedCount >= globalLimit;

  const managedDirectLinkIds = useMemo(
    () => new Set(directLinkAds.map((l) => l.linkId)),
    [directLinkAds],
  );

  const filteredAds = useMemo(() => {
    const baseAds = ads.filter((a) => !managedDirectLinkIds.has(a.adId));
    if (selectedCategory === 'all') return baseAds;
    return baseAds.filter((a) => a.adType === selectedCategory);
  }, [ads, selectedCategory, managedDirectLinkIds]);

  const activeWatchDirectLinks = useMemo(
    () => directLinkAds.filter((l) => l.status === 'active' && l.placement === 'watch_ads'),
    [directLinkAds],
  );
  const showDirectLinkSlot =
    activeWatchDirectLinks.length > 0 &&
    (selectedCategory === 'all' || selectedCategory === 'direct_link');

  const renderNetworkIcon = (ad: Advertisement) => {
    const key = ad.adNetwork.toLowerCase();
    if (key.includes('monetag')) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-extrabold text-xl shadow-md shadow-violet-900/40 shrink-0">
          m
        </div>
      );
    }
    if (key.includes('adsterra')) {
      return (
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-700 flex items-center justify-center text-white font-extrabold text-lg shadow-md shadow-purple-900/40 shrink-0">
          A
        </div>
      );
    }
    if (ad.adType === 'direct_link') {
      return (
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-sky-900/40 shrink-0">
          <Link2 className="w-6 h-6" />
        </div>
      );
    }
    if (ad.adType === 'other') {
      return (
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center text-white shadow-md shadow-blue-900/40 shrink-0">
          <BarChart3 className="w-6 h-6" />
        </div>
      );
    }
    return (
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-indigo-900/40 shrink-0">
        <Play className="w-6 h-6 fill-white" />
      </div>
    );
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      {/* Watch & Earn Header Banner */}
      <GlassCard variant="gradient" className="p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-white shrink-0 shadow-lg">
              <Clapperboard className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white leading-tight text-balance">
                Watch &amp; Earn
              </h2>
              <p className="text-xs sm:text-sm text-violet-100/90 max-w-lg leading-relaxed">
                Complete verified Partner Network advertisements below. Rewards are credited only
                after server-side callback verification.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('ad-history')}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors"
            >
              <History className="w-4 h-4" />
              <span>Ad History</span>
            </button>
          </div>
        </div>

        {/* 4 Key Watch Ads Summary Counters */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-4 border-t border-white/20">
          <div className="p-3 rounded-xl bg-black/20 border border-white/10">
            <p className="text-[11px] font-medium text-violet-100/80">Available Ads Count</p>
            <p className="text-xl font-extrabold font-display text-white tabular-nums mt-0.5">
              <AnimatedNumber value={ads.length} />
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/20 border border-white/10">
            <p className="text-[11px] font-medium text-violet-100/80">Today&apos;s Ads Limit</p>
            <p className="text-xl font-extrabold font-display text-amber-300 tabular-nums mt-0.5">
              {formatPoints(globalLimit)} Ads
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/20 border border-white/10">
            <p className="text-[11px] font-medium text-violet-100/80">Today&apos;s Completed Ads</p>
            <p className="text-xl font-extrabold font-display text-white tabular-nums mt-0.5">
              <AnimatedNumber value={todayCompletedCount} /> / {globalLimit}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-black/20 border border-white/10">
            <p className="text-[11px] font-medium text-violet-100/80">Today&apos;s Earned Points</p>
            <p className="text-xl font-extrabold font-display text-emerald-300 tabular-nums mt-0.5">
              +<AnimatedNumber value={todayEarnedPoints} /> Pts
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Category Filters */}
      <div
        role="tablist"
        aria-label="Advertisement Categories"
        className="flex items-center gap-2 overflow-x-auto pb-1"
      >
        {CATEGORY_TABS.map((tab) => {
          const active = selectedCategory === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedCategory(tab.id)}
              className={`min-h-[42px] px-4 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                active
                  ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                  : 'glass-card text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Watch Ads Direct Link Placement */}
      {showDirectLinkSlot && (
        <DirectLinkAdsPlacement
          links={directLinkAds}
          placement="watch_ads"
          heading="Watch Ads Direct Link Offers"
          subtitle="Click any partner offer directly to view or earn S2S-verified rewards"
          initiatingAdId={initiatingAdId}
          onStartRewardedDirectLink={(link) => onStartRewardedDirectLink?.(link)}
        />
      )}

      {/* Advertisement Cards Grid */}
      {filteredAds.length === 0 && !showDirectLinkSlot ? (
        <GlassCard className="p-8 text-center space-y-2.5">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-400/25 flex items-center justify-center text-violet-300 mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>
          <p className="text-base font-bold text-white">
            {!isAuthenticated && ads.length === 0
              ? 'Sign in to unlock active ad campaigns'
              : ads.length === 0
                ? 'No active advertisements available right now'
                : 'No advertisements match this category'}
          </p>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            {!isAuthenticated && ads.length === 0
              ? 'Verified Monetag and Adsterra advertisements load securely once you sign in with Email or Google.'
              : 'Active policy-compliant advertisements will appear here automatically.'}
          </p>
          {!isAuthenticated && ads.length === 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onOpenAuth?.('login')}
                className="min-h-[44px] px-6 py-2.5 rounded-full brand-button text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center"
              >
                Sign In / Create Account
              </button>
            </div>
          )}
        </GlassCard>
      ) : filteredAds.length === 0 ? null : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAds.map((ad) => {
            const completedThisAdToday = todayCompletedList.filter(
              (c) => c.adId === ad.adId,
            ).length;
            const adLimitReached = completedThisAdToday >= ad.dailyLimit;
            const disabled = globalLimitReached || adLimitReached || initiatingAdId === ad.adId;

            return (
              <GlassCard
                key={ad.adId}
                className="p-5 flex flex-col justify-between gap-4 bg-gradient-to-br from-[#161942]/90 via-[#12173A]/90 to-[#0E1E4A]/90 border-violet-400/20"
              >
                <div className="flex items-start gap-4">
                  {renderNetworkIcon(ad)}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base sm:text-lg font-bold font-display text-white truncate">
                        {ad.adName}
                      </h3>
                      <span className="text-xs font-extrabold text-amber-300 tabular-nums shrink-0">
                        +{formatPoints(ad.rewardPoints)} Pts
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 truncate">
                      {ad.adNetwork} <span aria-hidden="true">·</span> {formatAdTypeLabel(ad.adType)}
                    </p>

                    <div className="flex items-center justify-between gap-3 text-xs text-slate-300 tabular-nums pt-1">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />~{' '}
                        {ad.estimatedDuration} sec
                      </span>
                      <span
                        className={`font-semibold ${
                          adLimitReached ? 'text-amber-300' : 'text-emerald-400'
                        }`}
                      >
                        Daily Limit: {completedThisAdToday}/{ad.dailyLimit}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onStartWatchAd(ad)}
                  className="w-full min-h-[46px] px-5 py-3 rounded-full brand-button text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-45 disabled:pointer-events-none"
                >
                  {initiatingAdId === ad.adId ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Preparing Session...</span>
                    </>
                  ) : globalLimitReached ? (
                    <span>Daily Global Limit Reached</span>
                  ) : adLimitReached ? (
                    <span>Completed for Today</span>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>Watch Ad</span>
                    </>
                  )}
                </button>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Rewarded Advertising Policy Notice */}
      <GlassCard className="p-4 sm:p-5 flex items-start gap-3.5 border-emerald-400/20">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center text-emerald-400 shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white">Rewarded Advertising Policy</h3>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Daily limits reset at midnight (Asia/Dhaka). Points are credited solely after an
            authorized Ad Network SDK callback or S2S postback verifies your session—never via
            client-side timers, tab opens, or link clicks.
          </p>
        </div>
      </GlassCard>
    </div>
  );
};
