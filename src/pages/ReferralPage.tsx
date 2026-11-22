import React, { useMemo, useState } from 'react';
import {
  Award,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  Gift,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  DirectLinkAdRecord,
  ReferralLeaderboardEntry,
  ReferralQualificationStatus,
  ReferralSettingsConfig,
  ReferredUser,
  UserProfile,
} from '../types';
import { formatPoints } from '../services/appService';
import { requestReferralQualificationCheck } from '../services/dashboardService';
import { GlassCard } from '../components/ui/GlassCard';
import { GiftBox3DIcon } from '../components/icons/BrandAssets';
import { useToast } from '../components/ui/ToastProvider';
import { DirectLinkAdsPlacement } from '../components/ads/DirectLinkAdsPlacement';

interface ReferralPageProps {
  user: UserProfile;
  referralSettings: ReferralSettingsConfig;
  referredUsers: ReferredUser[];
  leaderboard: ReferralLeaderboardEntry[];
  directLinkAds?: DirectLinkAdRecord[];
  initiatingAdId?: string | null;
  onStartRewardedDirectLink?: (link: DirectLinkAdRecord) => void;
}

type HistoryFilter = 'all' | ReferralQualificationStatus;

const FILTER_TABS: Array<{ id: HistoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'registered', label: 'Registered' },
  { id: 'pending', label: 'Pending' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'rewarded', label: 'Rewarded' },
  { id: 'rejected', label: 'Rejected' },
];

export const ReferralPage: React.FC<ReferralPageProps> = ({
  user,
  referralSettings,
  referredUsers,
  leaderboard,
  directLinkAds = [],
  initiatingAdId = null,
  onStartRewardedDirectLink,
}) => {
  const { showToast } = useToast();
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HistoryFilter>('all');
  const [verifying, setVerifying] = useState(false);

  const summary = useMemo(() => {
    const total = referredUsers.length;
    const successful = referredUsers.filter(
      (r) => r.qualificationStatus === 'qualified' || r.qualificationStatus === 'rewarded',
    ).length;
    const pending = referredUsers.filter(
      (r) => r.qualificationStatus === 'registered' || r.qualificationStatus === 'pending',
    ).length;
    const totalEarnings = referredUsers.reduce(
      (sum, r) => sum + (r.rewardStatus === 'credited' ? r.rewardPoints || r.bonusEarnedPoints : 0),
      0,
    );
    return { total, successful, pending, totalEarnings };
  }, [referredUsers]);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return referredUsers.filter((item) => {
      if (statusFilter !== 'all' && item.qualificationStatus !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.maskedUsername.toLowerCase().includes(q) ||
        item.joinedDate.toLowerCase().includes(q) ||
        item.qualificationStatus.toLowerCase().includes(q)
      );
    });
  }, [referredUsers, searchQuery, statusFilter]);

  const shareText = useMemo(() => {
    const bonusPart =
      referralSettings.newUserBonusPoints && referralSettings.newUserBonusPoints > 0
        ? ` and earn a ${formatPoints(referralSettings.newUserBonusPoints)} Points welcome bonus`
        : '';
    return `Join AdView Earn with my referral code ${user.referralCode}${bonusPart}! Register here: ${user.referralLink}`;
  }, [referralSettings.newUserBonusPoints, user.referralCode, user.referralLink]);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
    user.referralLink,
  )}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    user.referralLink,
  )}&text=${encodeURIComponent(shareText)}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(user.referralLink);
    } catch {
      // Fallback handled silently
    }
    setCopiedLink(true);
    showToast('Referral link copied to clipboard!', 'success');
    window.setTimeout(() => setCopiedLink(false), 2200);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(user.referralCode);
    } catch {
      // Fallback handled silently
    }
    setCopiedCode(true);
    showToast(`Referral code ${user.referralCode} copied!`, 'success');
    window.setTimeout(() => setCopiedCode(false), 2200);
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Join AdView Earn',
          text: shareText,
          url: user.referralLink,
        });
        showToast('Invite shared successfully!', 'success');
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
      }
    }
    await handleCopyLink();
  };

  const handleVerifyPending = async () => {
    setVerifying(true);
    try {
      const result = await requestReferralQualificationCheck();
      if (result.creditedCount > 0) {
        showToast(
          `${result.creditedCount} referral(s) qualified & rewarded cleanly!`,
          'success',
        );
      } else {
        showToast(
          'Qualification check complete. Friends must verify email & complete required ads first.',
          'info',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to verify referrals right now.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const getQualificationBadge = (status: ReferralQualificationStatus) => {
    switch (status) {
      case 'rewarded':
        return {
          label: 'Rewarded',
          cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
          icon: CheckCircle2,
        };
      case 'qualified':
        return {
          label: 'Qualified',
          cls: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
          icon: Award,
        };
      case 'rejected':
        return {
          label: 'Rejected',
          cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
          icon: XCircle,
        };
      case 'pending':
        return {
          label: 'Pending',
          cls: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
          icon: Clock,
        };
      default:
        return {
          label: 'Registered',
          cls: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
          icon: UserCheck,
        };
    }
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      {/* 1. Invite Friends Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold font-display text-white">
            Invite Friends
          </h1>
          <p className="text-xs sm:text-sm text-slate-400">
            Share your unique ADV referral code &amp; earn verified bonus rewards
          </p>
        </div>

        <div className="flex items-center gap-2">
          {summary.pending > 0 && (
            <button
              type="button"
              disabled={verifying}
              onClick={handleVerifyPending}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-60"
            >
              {verifying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-300" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-violet-300" />
              )}
              <span>Verify Pending</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Attractive Referral Banner (100% Admin-Controlled Bonus Display) */}
      <GlassCard
        variant="gradient"
        className="p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-5"
      >
        <div className="flex items-center gap-4">
          <GiftBox3DIcon className="w-16 h-16 shrink-0" />
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-violet-200">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Referral Program</span>
            </div>

            {!referralSettings.referralEnabled ? (
              <>
                <h2 className="text-lg sm:text-xl font-extrabold font-display text-amber-300">
                  Program Temporarily Paused
                </h2>
                <p className="text-xs sm:text-sm text-violet-100/85">
                  Referral rewards are currently paused.
                </p>
              </>
            ) : referralSettings.referrerBonusPoints !== null &&
              referralSettings.referrerBonusPoints > 0 ? (
              <>
                <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white">
                  Earn{' '}
                  <span className="text-amber-300 tabular-nums">
                    +{formatPoints(referralSettings.referrerBonusPoints)} Points
                  </span>
                </h2>
                <p className="text-xs sm:text-sm text-violet-100/90">
                  for every qualified friend
                  {referralSettings.newUserBonusPoints && referralSettings.newUserBonusPoints > 0
                    ? ` · Friend also gets +${formatPoints(referralSettings.newUserBonusPoints)} Pts!`
                    : ' after verified activity!'}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg sm:text-xl font-extrabold font-display text-white">
                  Referral Rewards Program
                </h2>
                <p className="text-xs sm:text-sm text-violet-100/85">
                  Bonus amount is being configured. Share your invite code below.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Unique Referral Code Card */}
        <div className="p-3.5 rounded-2xl bg-[#070B22]/65 border border-white/15 flex items-center justify-between sm:justify-end gap-3 shrink-0">
          <div>
            <p className="text-[11px] text-violet-200">Your Referral Code</p>
            <p className="text-lg font-extrabold font-mono-num text-amber-300 tracking-wide">
              {user.referralCode}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopyCode}
            aria-label="Copy referral code"
            className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white transition-colors"
          >
            {copiedCode ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      </GlassCard>

      {/* 3. Four Summary Stats Cards */}
      <section aria-label="Referral summary statistics">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <GlassCard className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center text-sky-400 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 truncate">Total Referrals</p>
              <p className="text-lg sm:text-xl font-extrabold font-display text-white tabular-nums">
                {summary.total}
              </p>
            </div>
          </GlassCard>

          <GlassCard className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 truncate">Successful</p>
              <p className="text-lg sm:text-xl font-extrabold font-display text-emerald-400 tabular-nums">
                {summary.successful}
              </p>
            </div>
          </GlassCard>

          <GlassCard className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/25 flex items-center justify-center text-amber-400 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 truncate">Pending</p>
              <p className="text-lg sm:text-xl font-extrabold font-display text-amber-300 tabular-nums">
                {summary.pending}
              </p>
            </div>
          </GlassCard>

          <GlassCard className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-400/25 flex items-center justify-center text-violet-400 shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-400 truncate">Total Earnings</p>
              <p className="text-lg sm:text-xl font-extrabold font-display text-violet-300 tabular-nums">
                {formatPoints(summary.totalEarnings)} Pts
              </p>
            </div>
          </GlassCard>
        </div>
      </section>

      {/* Main 2-Column Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Share Link & Qualification Rules */}
        <div className="lg:col-span-5 space-y-5">
          <GlassCard className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold font-display text-white">Share Referral Link</h3>
              <span className="text-[11px] text-slate-400 font-mono-num">
                {user.referralCode}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={user.referralLink}
                aria-label="Your referral link"
                className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-xs text-slate-200 font-mono-num focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                aria-label="Copy referral link"
                className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 flex items-center justify-center text-white transition-colors shrink-0"
              >
                {copiedLink ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="col-span-2 min-h-[44px] px-4 py-2.5 rounded-xl brand-button text-white font-bold text-sm flex items-center justify-center gap-2"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? 'Referral Link Copied!' : 'Copy Referral Link'}</span>
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[42px] px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>WhatsApp</span>
              </a>

              <a
                href={telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[42px] px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-300 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>Telegram</span>
              </a>

              <a
                href={facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[42px] px-3 py-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 text-blue-300 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Users className="w-4 h-4" />
                <span>Facebook</span>
              </a>

              <button
                type="button"
                onClick={handleNativeShare}
                className="min-h-[42px] px-3 py-2 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30 text-violet-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span>More / Share</span>
              </button>
            </div>
          </GlassCard>

          <GlassCard className="p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold font-display text-white">
                Qualification &amp; Fair-Use Rules
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {referralSettings.referralRulesText}
            </p>

            <ul className="space-y-2 text-xs text-slate-300">
              <li className="flex items-center justify-between p-2.5 rounded-xl bg-[#070B22]/80 border border-white/10">
                <span className="text-slate-400">Email Verification</span>
                <span className="font-semibold text-white">
                  {referralSettings.requireEmailVerified ? 'Required' : 'Optional'}
                </span>
              </li>
              <li className="flex items-center justify-between p-2.5 rounded-xl bg-[#070B22]/80 border border-white/10">
                <span className="text-slate-400">Required Verified Ad Views</span>
                <span className="font-semibold text-amber-300 tabular-nums">
                  {referralSettings.minimumQualificationAds} Ad(s)
                </span>
              </li>
              <li className="flex items-center justify-between p-2.5 rounded-xl bg-[#070B22]/80 border border-white/10">
                <span className="text-slate-400">Daily Referral Cap</span>
                <span className="font-semibold text-white tabular-nums">
                  {referralSettings.dailyReferralCap} / day
                </span>
              </li>
            </ul>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Note: Registration alone keeps status as <span className="text-violet-300">Registered</span>.
              Self-referrals and duplicate bonus claims are automatically blocked by server validation.
            </p>
          </GlassCard>
        </div>

        {/* Right Column: Referral History & Privacy-Safe Leaderboard */}
        <div className="lg:col-span-7 space-y-5">
          {/* Referral History Section */}
          <GlassCard className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold font-display text-white">Referral History</h3>
              <span className="text-xs text-slate-400 tabular-nums">
                {filteredHistory.length} of {referredUsers.length} shown
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search referred username or date..."
                  className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {FILTER_TABS.map((tabItem) => {
                  const active = statusFilter === tabItem.id;
                  return (
                    <button
                      key={tabItem.id}
                      type="button"
                      onClick={() => setStatusFilter(tabItem.id)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                        active
                          ? 'brand-gradient text-white border-transparent'
                          : 'bg-[#070B22] text-slate-300 border-white/10 hover:text-white'
                      }`}
                    >
                      {tabItem.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <Users className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-sm font-semibold text-white">
                  {referredUsers.length === 0
                    ? 'No referred friends yet'
                    : 'No referrals match this filter'}
                </p>
                <p className="text-xs text-slate-400">
                  Share your link or code{' '}
                  <span className="font-mono-num text-amber-300 font-semibold">
                    {user.referralCode}
                  </span>{' '}
                  to invite friends!
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filteredHistory.map((refUser) => {
                  const badge = getQualificationBadge(refUser.qualificationStatus);
                  const BadgeIcon = badge.icon;
                  return (
                    <div
                      key={refUser.id}
                      className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-400/25 flex items-center justify-center text-violet-300 shrink-0">
                          <BadgeIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-white truncate">
                              {refUser.maskedUsername}
                            </p>
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Joined {refUser.joinedDate}
                          </p>
                          {refUser.rejectionReason && (
                            <p className="text-[11px] text-rose-300 mt-0.5">
                              {refUser.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0 pl-12 sm:pl-0">
                        <span
                          className={`text-sm font-extrabold tabular-nums ${
                            refUser.rewardStatus === 'credited'
                              ? 'text-emerald-400'
                              : 'text-slate-300'
                          }`}
                        >
                          +{formatPoints(refUser.rewardPoints)} Pts
                        </span>
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                          Reward: {refUser.rewardStatus}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>

          {/* Referral Leaderboard Section (Strictly Privacy-Safe) */}
          <GlassCard className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-300" />
                <h3 className="text-sm font-bold font-display text-white">
                  Top Referrers Leaderboard
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">Privacy Protected</span>
            </div>

            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                Top qualified referrers will appear here once referrals qualify.
              </p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry, index) => {
                  const rank = index + 1;
                  const isOwn = entry.uid === user.uid;
                  return (
                    <div
                      key={entry.uid}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
                        isOwn
                          ? 'bg-violet-500/15 border-violet-400/35'
                          : 'bg-[#070B22]/85 border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0 ${
                            rank === 1
                              ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                              : rank === 2
                                ? 'bg-slate-300/20 text-slate-200 border border-slate-300/35'
                                : rank === 3
                                  ? 'bg-orange-400/20 text-orange-300 border border-orange-400/35'
                                  : 'bg-white/5 text-slate-400 border border-white/10'
                          }`}
                        >
                          {rank === 1 ? <Crown className="w-4 h-4" /> : `#${rank}`}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-white truncate">
                            {entry.publicUsername}{' '}
                            {isOwn && (
                              <span className="text-[10px] text-violet-300 font-semibold">(You)</span>
                            )}
                          </p>
                          <p className="text-[11px] text-slate-400 tabular-nums">
                            {entry.totalQualifiedReferrals} Qualified Referral
                            {entry.totalQualifiedReferrals === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <p className="text-xs sm:text-sm font-extrabold text-emerald-400 tabular-nums">
                          {formatPoints(entry.totalReferralRewards)} Pts
                        </p>
                        <p className="text-[10px] text-slate-400">Total Rewards</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      {directLinkAds.some((l) => l.status === 'active' && l.placement === 'featured_section') && (
        <DirectLinkAdsPlacement
          links={directLinkAds}
          placement="featured_section"
          heading="Featured Partner Spotlight"
          subtitle="Explore sponsored partner offers while inviting friends"
          initiatingAdId={initiatingAdId}
          onStartRewardedDirectLink={(link) => onStartRewardedDirectLink?.(link)}
        />
      )}
    </div>
  );
};
