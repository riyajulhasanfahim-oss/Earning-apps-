import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  AdCompletionRecord,
  AdminRole,
  AdSessionRecord,
  DirectLinkAdRecord,
  DirectLinkPlacement,
  RewardVerificationMethod,
} from '../types';
import { formatPoints } from '../services/appService';
import { MAX_AD_VIEW_SECONDS, MIN_AD_VIEW_SECONDS } from '../services/dashboardService';
import { hasAdminPermission } from '../services/adminService';

const DEFAULT_AD_VIEW_SECONDS = MIN_AD_VIEW_SECONDS;
import {
  DEFAULT_MONETAG_DIRECT_LINKS,
  deleteDirectLinkAd,
  DIRECT_LINK_PLACEMENT_OPTIONS,
  isVerifiedRewardedDirectLink,
  PLACEMENT_LABEL_MAP,
  saveDirectLinkAd,
  seedDefaultMonetagDirectLinks,
  toggleDirectLinkAdStatus,
} from '../services/multiDirectLinkService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminMultiDirectLinksSectionProps {
  directLinkAds: DirectLinkAdRecord[];
  adSessions: AdSessionRecord[];
  adCompletions: AdCompletionRecord[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

interface DirectLinkFormState {
  isNew: boolean;
  linkId: string;
  title: string;
  url: string;
  adNetwork: string;
  placement: DirectLinkPlacement;
  rewardMode: 'standard' | 'verified_rewarded';
  rewardPoints: string;
  estimatedDuration: string;
  dailyLimit: string;
  status: 'active' | 'inactive';
  incentivizedTrafficAllowed: boolean;
  rewardVerificationMethod: RewardVerificationMethod;
  sortOrder: string;
  notes: string;
}

function emptyDirectLinkForm(nextOrder: number): DirectLinkFormState {
  return {
    isNew: true,
    linkId: `dl_${Date.now().toString().slice(-6)}`,
    title: '',
    url: 'https://',
    adNetwork: 'Monetag',
    placement: 'available_ads',
    rewardMode: 'verified_rewarded',
    rewardPoints: '150',
    estimatedDuration: String(DEFAULT_AD_VIEW_SECONDS),
    dailyLimit: '1',
    status: 'active',
    incentivizedTrafficAllowed: true,
    rewardVerificationMethod: 's2s_postback',
    sortOrder: String(nextOrder),
    notes: '',
  };
}

export const AdminMultiDirectLinksSection: React.FC<AdminMultiDirectLinksSectionProps> = ({
  directLinkAds,
  adSessions,
  adCompletions,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [placementFilter, setPlacementFilter] = useState<'all' | DirectLinkPlacement>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<DirectLinkFormState>(() => emptyDirectLinkForm(1));
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canManage = hasAdminPermission(adminRole, 'manage_ads');

  const perfByLinkId = useMemo(() => {
    const map = new Map<
      string,
      { sessions: number; verifiedCompletions: number; totalRewards: number }
    >();
    for (const s of adSessions) {
      const prev = map.get(s.adId) || { sessions: 0, verifiedCompletions: 0, totalRewards: 0 };
      prev.sessions += 1;
      map.set(s.adId, prev);
    }
    for (const c of adCompletions) {
      if (c.status !== 'completed') continue;
      const prev = map.get(c.adId) || { sessions: 0, verifiedCompletions: 0, totalRewards: 0 };
      prev.verifiedCompletions += 1;
      prev.totalRewards += Number(c.rewardPoints || 0);
      map.set(c.adId, prev);
    }
    return map;
  }, [adSessions, adCompletions]);

  const missingSeedCount = useMemo(() => {
    const existingUrls = new Set(directLinkAds.map((l) => l.url.trim().toLowerCase()));
    const existingIds = new Set(directLinkAds.map((l) => l.linkId));
    return DEFAULT_MONETAG_DIRECT_LINKS.filter(
      (item) => !existingIds.has(item.linkId) && !existingUrls.has(item.url.trim().toLowerCase()),
    ).length;
  }, [directLinkAds]);

  const summaryStats = useMemo(() => {
    let activeCount = 0;
    let rewardedCount = 0;
    let totalSessions = 0;
    let totalRewards = 0;

    for (const link of directLinkAds) {
      if (link.status === 'active') activeCount += 1;
      if (isVerifiedRewardedDirectLink(link)) rewardedCount += 1;
      const perf = perfByLinkId.get(link.linkId);
      if (perf) {
        totalSessions += perf.sessions;
        totalRewards += perf.totalRewards;
      }
    }

    return {
      totalCount: directLinkAds.length,
      activeCount,
      rewardedCount,
      totalSessions,
      totalRewards,
    };
  }, [directLinkAds, perfByLinkId]);

  const filteredLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return directLinkAds.filter((item) => {
      if (placementFilter !== 'all' && item.placement !== placementFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        item.linkId.toLowerCase().includes(q) ||
        PLACEMENT_LABEL_MAP[item.placement].toLowerCase().includes(q)
      );
    });
  }, [directLinkAds, placementFilter, statusFilter, search]);

  const openAddModal = () => {
    setForm(emptyDirectLinkForm(directLinkAds.length + 1));
    setModalOpen(true);
  };

  const openEditModal = (link: DirectLinkAdRecord) => {
    const isRewardedMode = link.incentivizedTrafficAllowed && link.rewardVerificationMethod !== 'none';
    setForm({
      isNew: false,
      linkId: link.linkId,
      title: link.title,
      url: link.url,
      adNetwork: link.adNetwork,
      placement: link.placement,
      rewardMode: isRewardedMode ? 'verified_rewarded' : 'standard',
      rewardPoints: String(isRewardedMode ? link.rewardPoints || 150 : 0),
      estimatedDuration: String(link.estimatedDuration || DEFAULT_AD_VIEW_SECONDS),
      dailyLimit: String(link.dailyLimit || 1),
      status: link.status,
      incentivizedTrafficAllowed: link.incentivizedTrafficAllowed,
      rewardVerificationMethod: link.rewardVerificationMethod,
      sortOrder: String(link.sortOrder ?? 1),
      notes: link.notes || '',
    });
    setModalOpen(true);
  };

  const handleSeed10Links = async (enableVerified150Preset: boolean) => {
    if (!canManage) {
      showToast('Admin or Super Admin role required.', 'error');
      return;
    }
    setSeeding(true);
    try {
      const res = await seedDefaultMonetagDirectLinks(adminUser, {
        enableVerified150Preset,
      });
      if (res.createdCount === 0) {
        showToast('All 10 Monetag Direct Links are already present.', 'info');
      } else {
        showToast(
          `Seeded ${res.createdCount} Monetag Direct Link${res.createdCount > 1 ? 's' : ''} (${
            enableVerified150Preset ? '150 Pts S2S Verified' : 'Standard 0 Pts Safe Mode'
          }).`,
          'success',
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to seed Direct Links.', 'error');
    } finally {
      setSeeding(false);
    }
  };

  const handleToggleStatus = async (link: DirectLinkAdRecord) => {
    if (!canManage) {
      showToast('Admin or Super Admin role required.', 'error');
      return;
    }
    setBusyId(link.linkId);
    try {
      await toggleDirectLinkAdStatus(link, adminUser);
      showToast(
        `${link.title} is now ${link.status === 'active' ? 'Inactive' : 'Active'}.`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not toggle status.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (link: DirectLinkAdRecord) => {
    if (!canManage) {
      showToast('Admin or Super Admin role required.', 'error');
      return;
    }
    setBusyId(link.linkId);
    try {
      await deleteDirectLinkAd(link, adminUser);
      setConfirmDeleteId(null);
      showToast(`Deleted "${link.title}".`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete Direct Link.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      showToast('Admin or Super Admin role required.', 'error');
      return;
    }

    const isRewarded = form.rewardMode === 'verified_rewarded';
    const parsedPoints = isRewarded ? Math.max(0, Math.floor(Number(form.rewardPoints || 0))) : 0;

    if (isRewarded && parsedPoints < 1) {
      showToast('Enter at least 1 Reward Point (or click 150 Pts Preset).', 'error');
      return;
    }
    if (isRewarded && (!form.incentivizedTrafficAllowed || form.rewardVerificationMethod === 'none')) {
      showToast(
        'Incentivized Traffic Approval and S2S Postback / SDK Callback verification are required for points rewards.',
        'error',
      );
      return;
    }

    setSaving(true);
    try {
      await saveDirectLinkAd(
        {
          linkId: form.linkId,
          title: form.title,
          url: form.url,
          adNetwork: form.adNetwork,
          placement: form.placement,
          rewardPoints: parsedPoints,
          estimatedDuration: Number(form.estimatedDuration || DEFAULT_AD_VIEW_SECONDS),
          dailyLimit: Number(form.dailyLimit || 1),
          status: form.status,
          incentivizedTrafficAllowed: isRewarded ? form.incentivizedTrafficAllowed : false,
          rewardVerificationMethod: isRewarded ? form.rewardVerificationMethod : 'none',
          sortOrder: Number(form.sortOrder || 0),
          notes: form.notes,
          isNew: form.isNew,
        },
        adminUser,
      );
      showToast(
        form.isNew ? 'Direct Link ad added successfully.' : 'Direct Link ad updated successfully.',
        'success',
      );
      setModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save Direct Link ad.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Card */}
      <div className="rounded-2xl p-5 sm:p-6 bg-slate-900/75 border border-white/10 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-500/25 border border-violet-400/35 flex items-center justify-center text-cyan-300 shrink-0">
                <Link2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold font-display text-white">
                  Multi Direct Link Ads Management
                </h2>
                <p className="text-xs text-slate-400">
                  Manage Monetag Direct Links across Home Page, Available Ads, Watch Ads, Daily Check-in Bonus &amp; Featured slots
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {missingSeedCount > 0 && canManage && (
              <>
                <button
                  type="button"
                  disabled={seeding}
                  onClick={() => void handleSeed10Links(false)}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-bold text-slate-200 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Seed {missingSeedCount} Links (0 Pts Safe)</span>
                </button>
                <button
                  type="button"
                  disabled={seeding}
                  onClick={() => void handleSeed10Links(true)}
                  className="min-h-[42px] px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-xs font-bold text-emerald-200 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>Seed {missingSeedCount} Links (150 Pts S2S)</span>
                </button>
              </>
            )}

            {canManage && (
              <button
                type="button"
                onClick={openAddModal}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-xs font-extrabold text-white inline-flex items-center gap-1.5 shadow-lg shadow-violet-950/50 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Add New Link</span>
              </button>
            )}
          </div>
        </div>

        {/* Compliance & Policy Reminder */}
        <div className="rounded-xl p-3.5 bg-slate-950/60 border border-cyan-400/20 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-cyan-300 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 space-y-1 leading-relaxed">
            <p className="font-bold text-white">
              Genuine Click &amp; S2S Reward Verification Policy
            </p>
            <p>
              All Direct Links open exclusively via genuine user clicks (zero popunders or forced redirects).
              <span className="text-amber-300 font-semibold"> Standard Direct Links (0 Pts)</span> open safely as sponsored links without fake timers.
              <span className="text-emerald-300 font-semibold"> Rewarded Direct Links (150 Pts)</span> enforce a {MIN_AD_VIEW_SECONDS}s+ session and backend S2S Postback / SDK callback verification before crediting the user&apos;s Wallet.
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl p-4 bg-slate-900/75 border border-white/10">
          <p className="text-xs text-slate-400 font-medium">Total Direct Links</p>
          <p className="text-2xl font-extrabold font-display text-white tabular-nums mt-1">
            {summaryStats.totalCount}
            <span className="text-xs font-semibold text-slate-400 ml-1.5">/ 10 preset</span>
          </p>
        </div>
        <div className="rounded-2xl p-4 bg-slate-900/75 border border-white/10">
          <p className="text-xs text-slate-400 font-medium">Active Placements</p>
          <p className="text-2xl font-extrabold font-display text-emerald-300 tabular-nums mt-1">
            {summaryStats.activeCount}
          </p>
        </div>
        <div className="rounded-2xl p-4 bg-slate-900/75 border border-white/10">
          <p className="text-xs text-slate-400 font-medium">150 Pts S2S Rewarded</p>
          <p className="text-2xl font-extrabold font-display text-cyan-300 tabular-nums mt-1">
            {summaryStats.rewardedCount}
          </p>
        </div>
        <div className="rounded-2xl p-4 bg-slate-900/75 border border-white/10">
          <p className="text-xs text-slate-400 font-medium">Tracked Sessions / Rewards</p>
          <p className="text-xl font-extrabold font-display text-amber-300 tabular-nums mt-1">
            {formatPoints(summaryStats.totalSessions)} <span className="text-slate-500 text-xs">/</span>{' '}
            {formatPoints(summaryStats.totalRewards)} Pts
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl p-4 bg-slate-900/75 border border-white/10 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, URL (uplcm.com/...), or placement..."
            className="w-full min-h-[42px] pl-10 pr-3 rounded-xl bg-slate-950/70 border border-white/10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400/60"
          />
        </div>

        <select
          value={placementFilter}
          onChange={(e) => setPlacementFilter(e.target.value as 'all' | DirectLinkPlacement)}
          aria-label="Filter by placement"
          className="min-h-[42px] px-3.5 rounded-xl bg-slate-950/70 border border-white/10 text-xs sm:text-sm text-white focus:outline-none focus:border-violet-400/60"
        >
          <option value="all">All Placements</option>
          {DIRECT_LINK_PLACEMENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          aria-label="Filter by status"
          className="min-h-[42px] px-3.5 rounded-xl bg-slate-950/70 border border-white/10 text-xs sm:text-sm text-white focus:outline-none focus:border-violet-400/60"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>
      </div>

      {/* Links List */}
      {filteredLinks.length === 0 ? (
        <div className="rounded-2xl p-8 bg-slate-900/75 border border-white/10 text-center space-y-3">
          <Link2 className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-white">
              {directLinkAds.length === 0
                ? 'No Direct Link Ads configured yet'
                : 'No Direct Links match your filters'}
            </p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {directLinkAds.length === 0
                ? 'Click one of the Seed buttons above to populate all 10 Monetag uplcm.com Direct Links automatically across website placements.'
                : 'Clear your search query or select a different placement filter.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLinks.map((link) => {
            const rewarded = isVerifiedRewardedDirectLink(link);
            const perf = perfByLinkId.get(link.linkId) || {
              sessions: 0,
              verifiedCompletions: 0,
              totalRewards: 0,
            };
            const isBusy = busyId === link.linkId;

            return (
              <div
                key={link.linkId}
                className={`rounded-2xl p-4 border transition-all ${
                  link.status === 'active'
                    ? 'bg-slate-900/80 border-white/10 hover:border-violet-400/35'
                    : 'bg-slate-950/60 border-white/5 opacity-75'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Info & URL */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-bold text-slate-200 tabular-nums">
                        #{link.sortOrder}
                      </span>
                      <h3 className="text-sm sm:text-base font-bold text-white truncate">
                        {link.title}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          link.status === 'active'
                            ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300'
                            : 'bg-slate-500/15 border-slate-400/30 text-slate-400'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            link.status === 'active' ? 'bg-emerald-400' : 'bg-slate-400'
                          }`}
                        />
                        {link.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-400/30 text-[11px] font-semibold text-violet-200">
                        {PLACEMENT_LABEL_MAP[link.placement]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 underline underline-offset-2 truncate max-w-full"
                      >
                        <span className="truncate">{link.url}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap text-xs text-slate-300 tabular-nums">
                      {rewarded ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          +{formatPoints(link.rewardPoints)} Pts · {link.rewardVerificationMethod === 'sdk_callback' ? 'SDK' : 'S2S'} Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-400/30 text-amber-200 font-semibold">
                          Standard Direct Link · 0 Pts
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {link.estimatedDuration}s duration · Limit {link.dailyLimit}/day
                      </span>
                      <span className="text-slate-400">
                        Sessions: <strong className="text-white">{perf.sessions}</strong> · Verified:{' '}
                        <strong className="text-emerald-300">{perf.verifiedCompletions}</strong> ({formatPoints(perf.totalRewards)} Pts)
                      </span>
                    </div>
                  </div>

                  {/* Right: Controls */}
                  {canManage && (
                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleToggleStatus(link)}
                        className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                          link.status === 'active'
                            ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-200 hover:bg-emerald-500/25'
                            : 'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{link.status === 'active' ? 'Active' : 'Paused'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openEditModal(link)}
                        className="min-h-[38px] px-3 py-1.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-xs font-bold text-violet-100 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      {confirmDeleteId === link.linkId ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleDelete(link)}
                            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-slate-300"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(link.linkId)}
                          className="min-h-[38px] px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-xs font-bold text-rose-200 inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                          aria-label={`Delete ${link.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="direct-link-modal-title"
        >
          <div className="w-full max-w-xl rounded-2xl bg-[#0D1330] border border-white/15 shadow-2xl overflow-hidden my-auto">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Link2 className="w-5 h-5 text-cyan-300" />
                <h3 id="direct-link-modal-title" className="text-base font-extrabold text-white">
                  {form.isNew ? 'Add New Direct Link Ad' : 'Edit Direct Link Ad'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="p-5 space-y-4 max-h-[82dvh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Advertisement Title
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Monetag Direct Partner #1"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Display Order #
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={form.sortOrder}
                    onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Direct Link URL (HTTPS)
                </label>
                <input
                  type="url"
                  required
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://uplcm.com/4/12321305"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Advertisement Placement
                  </label>
                  <select
                    value={form.placement}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, placement: e.target.value as DirectLinkPlacement }))
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  >
                    {DIRECT_LINK_PLACEMENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Ad Network
                  </label>
                  <input
                    type="text"
                    required
                    value={form.adNetwork}
                    onChange={(e) => setForm((f) => ({ ...f, adNetwork: e.target.value }))}
                    placeholder="Monetag"
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              {/* Reward Mode Selection */}
              <div className="rounded-xl p-3.5 bg-slate-950/60 border border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-bold text-white">Reward &amp; Verification Mode</span>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        rewardMode: 'verified_rewarded',
                        rewardPoints: '150',
                        incentivizedTrafficAllowed: true,
                        rewardVerificationMethod: 's2s_postback',
                      }))
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-[11px] font-bold text-emerald-200 transition-colors"
                  >
                    Apply 150 Pts Reward Preset
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        rewardMode: 'standard',
                        rewardPoints: '0',
                        incentivizedTrafficAllowed: false,
                        rewardVerificationMethod: 'none',
                      }))
                    }
                    className={`p-3 rounded-xl border text-left transition-all ${
                      form.rewardMode === 'standard'
                        ? 'bg-amber-500/15 border-amber-400/60 text-white'
                        : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <p className="text-xs font-bold">Standard Direct Link (0 Pts)</p>
                    <p className="text-[11px] text-slate-300/80 mt-0.5">
                      Opens external link cleanly on click. No reward timer or points.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        rewardMode: 'verified_rewarded',
                        rewardPoints: f.rewardPoints === '0' ? '150' : f.rewardPoints,
                        incentivizedTrafficAllowed: true,
                        rewardVerificationMethod:
                          f.rewardVerificationMethod === 'none'
                            ? 's2s_postback'
                            : f.rewardVerificationMethod,
                      }))
                    }
                    className={`p-3 rounded-xl border text-left transition-all ${
                      form.rewardMode === 'verified_rewarded'
                        ? 'bg-emerald-500/15 border-emerald-400/60 text-white'
                        : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    <p className="text-xs font-bold">Rewarded S2S Verified (150 Pts)</p>
                    <p className="text-[11px] text-slate-300/80 mt-0.5">
                      Runs {form.estimatedDuration}s session + server S2S Postback verification.
                    </p>
                  </button>
                </div>

                {form.rewardMode === 'verified_rewarded' && (
                  <div className="space-y-3 pt-2 border-t border-white/10">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          Reward Points
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={10000}
                          value={form.rewardPoints}
                          onChange={(e) => setForm((f) => ({ ...f, rewardPoints: e.target.value }))}
                          className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-white/15 text-sm text-emerald-300 font-bold focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          Verification Method
                        </label>
                        <select
                          value={form.rewardVerificationMethod}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              rewardVerificationMethod: e.target.value as RewardVerificationMethod,
                            }))
                          }
                          className="w-full min-h-[40px] px-3 rounded-xl bg-slate-900 border border-white/15 text-sm text-white focus:outline-none focus:border-emerald-400"
                        >
                          <option value="s2s_postback">S2S Postback (Recommended)</option>
                          <option value="sdk_callback">SDK Callback</option>
                        </select>
                      </div>
                    </div>

                    <label className="flex items-start gap-2.5 text-xs text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.incentivizedTrafficAllowed}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            incentivizedTrafficAllowed: e.target.checked,
                          }))
                        }
                        className="mt-0.5 rounded border-white/25 bg-slate-900 text-emerald-500 focus:ring-emerald-400"
                      />
                      <span>
                        Confirm Incentivized Traffic &amp; Monetag S2S Callback (
                        <code className="text-cyan-300">session_id=&#123;ymid&#125;</code>) are configured on this zone.
                      </span>
                    </label>

                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-400/25 flex items-start gap-2 text-[11px] text-amber-200">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        Wallet points are credited ONLY after backend S2S/SDK verification confirms completion.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Duration, Daily Limit & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Ad Duration (sec)
                  </label>
                  <input
                    type="number"
                    min={MIN_AD_VIEW_SECONDS}
                    max={MAX_AD_VIEW_SECONDS}
                    value={form.estimatedDuration}
                    onChange={(e) => setForm((f) => ({ ...f, estimatedDuration: e.target.value }))}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Daily Limit / User
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={form.dailyLimit}
                    onChange={(e) => setForm((f) => ({ ...f, dailyLimit: e.target.value }))}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as 'active' | 'inactive' }))
                    }
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Admin Notes (Optional)
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional placement or campaign reference"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-950/75 border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[42px] px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-xs font-extrabold text-white inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Save &amp; Update</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
