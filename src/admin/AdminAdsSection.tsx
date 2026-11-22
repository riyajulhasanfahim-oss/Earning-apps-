import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Edit3,
  Loader2,
  Megaphone,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  AdCompletionRecord,
  AdminRole,
  AdSessionRecord,
  AdType,
  Advertisement,
  RewardVerificationMethod,
} from '../types';
import {
  checkAdPolicyCompliance,
  formatAdTypeLabel,
  formatVerificationMethodLabel,
  getSupportedNetworks,
} from '../services/adNetworkPolicy';
import { formatPoints } from '../services/appService';
import {
  deleteAdvertisement,
  normalizeAdDurationSeconds,
  saveAdvertisement,
  toggleAdvertisementStatus,
} from '../services/dashboardService';
import {
  computePerAdPerformance,
  hasAdminPermission,
  recordAdminAuditLogClient,
} from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminAdsSectionProps {
  ads: Advertisement[];
  adSessions: AdSessionRecord[];
  adCompletions: AdCompletionRecord[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

interface AdFormState {
  isNew: boolean;
  adId: string;
  adName: string;
  adNetwork: string;
  adType: AdType;
  placementOrUrl: string;
  rewardPoints: string;
  dailyLimit: string;
  estimatedDuration: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  allowedCountries: string;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
  description: string;
}

function emptyAdForm(): AdFormState {
  return {
    isNew: true,
    adId: `ad_${Date.now().toString().slice(-6)}`,
    adName: '',
    adNetwork: 'Monetag',
    adType: 'rewarded',
    placementOrUrl: '',
    rewardPoints: '50',
    dailyLimit: '5',
    estimatedDuration: '30',
    startDate: '',
    endDate: '',
    status: 'active',
    allowedCountries: 'ALL',
    rewardVerificationMethod: 's2s_postback',
    incentivizedTrafficAllowed: true,
    description: '',
  };
}

export const AdminAdsSection: React.FC<AdminAdsSectionProps> = ({
  ads,
  adSessions,
  adCompletions,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | AdType>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AdFormState>(emptyAdForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = hasAdminPermission(adminRole, 'manage_ads');

  const perfMap = useMemo(
    () => computePerAdPerformance(ads, adSessions, adCompletions),
    [ads, adSessions, adCompletions],
  );

  const filteredAds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (typeFilter !== 'all' && a.adType !== typeFilter) return false;
      if (!q) return true;
      return (
        a.adName.toLowerCase().includes(q) ||
        a.adId.toLowerCase().includes(q) ||
        a.adNetwork.toLowerCase().includes(q)
      );
    });
  }, [ads, search, statusFilter, typeFilter]);

  const openCreateModal = () => {
    setForm(emptyAdForm());
    setModalOpen(true);
  };

  const openEditModal = (ad: Advertisement) => {
    setForm({
      isNew: false,
      adId: ad.adId,
      adName: ad.adName,
      adNetwork: ad.adNetwork,
      adType: ad.adType,
      placementOrUrl: ad.placementOrUrl,
      rewardPoints: String(ad.rewardPoints),
      dailyLimit: String(ad.dailyLimit),
      estimatedDuration: String(normalizeAdDurationSeconds(ad.estimatedDuration)),
      startDate: ad.startDate,
      endDate: ad.endDate,
      status: ad.status,
      allowedCountries: ad.allowedCountries,
      rewardVerificationMethod: ad.rewardVerificationMethod,
      incentivizedTrafficAllowed: ad.incentivizedTrafficAllowed,
      description: ad.description,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (form.adName.trim().length < 2) {
      showToast('Advertisement name is required.', 'error');
      return;
    }
    const rewardPts = Number(form.rewardPoints);
    if (!Number.isFinite(rewardPts) || rewardPts <= 0) {
      showToast('Reward points must be a positive number.', 'error');
      return;
    }

    const policy = checkAdPolicyCompliance({
      adType: form.adType,
      rewardVerificationMethod: form.rewardVerificationMethod,
      incentivizedTrafficAllowed: form.incentivizedTrafficAllowed,
    });
    if (form.status === 'active' && !policy.compliant) {
      showToast(policy.reason || 'Policy violation.', 'error');
      return;
    }

    setSaving(true);
    try {
      await saveAdvertisement({
        adId: form.adId,
        adName: form.adName,
        adNetwork: form.adNetwork,
        adType: form.adType,
        placementOrUrl: form.placementOrUrl,
        rewardPoints: Math.floor(rewardPts),
        dailyLimit: Math.max(1, Math.floor(Number(form.dailyLimit || 5))),
        estimatedDuration: normalizeAdDurationSeconds(form.estimatedDuration),
        startDate: form.startDate,
        endDate: form.endDate,
        status: form.status,
        allowedCountries: form.allowedCountries,
        rewardVerificationMethod: form.rewardVerificationMethod,
        incentivizedTrafficAllowed: form.incentivizedTrafficAllowed,
        description: form.description,
        isNew: form.isNew,
      });

      await recordAdminAuditLogClient({
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
        action: form.isNew ? 'ad_created' : 'ad_updated',
        targetId: form.adId,
        newValue: `${form.adName} (${form.rewardPoints} Pts, ${form.status})`,
        details: `${form.isNew ? 'Created' : 'Updated'} ad "${form.adName}" (${form.adNetwork}, ${form.adType}, ${form.rewardPoints} Pts)`,
      });

      showToast(`Advertisement "${form.adName}" saved.`, 'success');
      setModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save advertisement.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (ad: Advertisement) => {
    if (!canManage) return;
    setBusyId(ad.adId);
    try {
      await toggleAdvertisementStatus(ad);
      const next = ad.status === 'active' ? 'inactive' : 'active';
      await recordAdminAuditLogClient({
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
        action: 'ad_status_toggled',
        targetId: ad.adId,
        previousValue: ad.status,
        newValue: next,
        details: `Set advertisement "${ad.adName}" status to ${next}`,
      });
      showToast(`"${ad.adName}" marked ${next}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Status toggle failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (ad: Advertisement) => {
    if (!canManage) return;
    setBusyId(ad.adId);
    try {
      await deleteAdvertisement(ad.adId);
      await recordAdminAuditLogClient({
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
        action: 'ad_deleted',
        targetId: ad.adId,
        previousValue: ad.adName,
        newValue: 'deleted',
        details: `Deleted advertisement "${ad.adName}" (${ad.adId})`,
      });
      showToast(`Deleted "${ad.adName}".`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const supportedNetworks = getSupportedNetworks();

  return (
    <div className="space-y-5">
      {!canManage && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-400/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Support Admin has read-only access to advertisement inventory and live performance
            metrics. Creating, editing, toggling, or deleting ads requires Admin or Super Admin.
          </span>
        </div>
      )}

      {/* Header & Filters */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row gap-2.5 flex-1">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by ad name, ID, or network..."
              className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
            />
          </div>
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white focus:outline-none focus:border-violet-400"
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
          <select
            aria-label="Filter by ad type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | AdType)}
            className="h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white focus:outline-none focus:border-violet-400"
          >
            <option value="all">All Types</option>
            <option value="rewarded">Rewarded Ad</option>
            <option value="direct_link">Direct Link Ad</option>
            <option value="other">Other Ad</option>
          </select>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreateModal}
            className="min-h-[40px] px-4 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Advertisement</span>
          </button>
        )}
      </div>

      {/* Ads Table with Live Performance Metrics */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3.5 px-4">Advertisement</th>
                <th className="py-3.5 px-4">Network &amp; Verification</th>
                <th className="py-3.5 px-4 text-right">Reward / Limit</th>
                <th className="py-3.5 px-4 text-right">Impressions</th>
                <th className="py-3.5 px-4 text-right">Completions</th>
                <th className="py-3.5 px-4 text-right">Pts Distributed</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filteredAds.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No advertisements found in Firestore.
                  </td>
                </tr>
              ) : (
                filteredAds.map((ad) => {
                  const perf = perfMap.get(ad.adId) ?? {
                    impressions: 0,
                    completions: 0,
                    rejected: 0,
                    rewardsDistributed: 0,
                  };
                  const busy = busyId === ad.adId;
                  return (
                    <tr key={ad.id} className="hover:bg-white/[0.025] transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-bold text-white">{ad.adName}</p>
                        <p className="text-[11px] text-slate-400">
                          {formatAdTypeLabel(ad.adType)} ·{' '}
                          <span className="font-mono-num">{ad.adId}</span>
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-200">{ad.adNetwork}</p>
                        <p className="text-[11px] text-violet-300">
                          {formatVerificationMethodLabel(ad.rewardVerificationMethod)}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num">
                        <p className="font-bold text-emerald-300">+{ad.rewardPoints} Pts</p>
                        <p className="text-[11px] text-slate-400">
                          {ad.dailyLimit}/day · {ad.estimatedDuration}s
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-200">
                        {formatPoints(perf.impressions)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num">
                        <span className="text-emerald-300 font-bold">
                          {formatPoints(perf.completions)}
                        </span>
                        {perf.rejected > 0 && (
                          <span className="text-rose-300 block text-[10px]">
                            {perf.rejected} rejected
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-violet-300">
                        {formatPoints(perf.rewardsDistributed)} Pts
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border capitalize ${
                            ad.status === 'active'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35'
                              : 'bg-slate-500/15 text-slate-300 border-slate-400/35'
                          }`}
                        >
                          {ad.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => openEditModal(ad)}
                            title="Edit Ad"
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 disabled:opacity-40"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void handleToggle(ad)}
                            title={ad.status === 'active' ? 'Deactivate Ad' : 'Activate Ad'}
                            className={`p-2 rounded-lg border disabled:opacity-40 ${
                              ad.status === 'active'
                                ? 'bg-amber-500/15 border-amber-400/30 text-amber-200 hover:bg-amber-500/25'
                                : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/25'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void handleDelete(ad)}
                            title="Delete Ad"
                            className="p-2 rounded-lg bg-rose-500/15 border border-rose-400/30 text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Ad Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-[#0B1026] border border-white/15 overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Megaphone className="w-5 h-5 text-violet-400" />
                <h3 className="text-base font-bold font-display text-white">
                  {form.isNew ? 'Create New Advertisement' : `Edit ${form.adName}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="rounded-xl bg-violet-500/10 border border-violet-400/25 p-3 flex items-start gap-2 text-violet-200">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Policy Enforcement: Active ads require server-side verification (S2S Postback or
                  SDK Callback), and Direct Link ads require Incentivized Traffic approval.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Ad ID</label>
                  <input
                    type="text"
                    disabled={!form.isNew}
                    value={form.adId}
                    onChange={(e) => setForm({ ...form, adId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Advertisement Name</label>
                  <input
                    type="text"
                    value={form.adName}
                    onChange={(e) => setForm({ ...form, adName: e.target.value })}
                    placeholder="e.g. Monetag Video Bonus"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Ad Network</label>
                  <input
                    list="admin-ad-networks"
                    value={form.adNetwork}
                    onChange={(e) => {
                      const nextNet = e.target.value;
                      const isAppLixir = nextNet.toLowerCase().includes('applixir');
                      setForm({
                        ...form,
                        adNetwork: nextNet,
                        ...(isAppLixir
                          ? {
                              adType: 'rewarded',
                              rewardVerificationMethod: 's2s_postback',
                              incentivizedTrafficAllowed: true,
                            }
                          : {}),
                      });
                    }}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                  <datalist id="admin-ad-networks">
                    {supportedNetworks.map((n) => (
                      <option key={n.key} value={n.displayName} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Ad Type</label>
                  <select
                    value={form.adType}
                    onChange={(e) => setForm({ ...form, adType: e.target.value as AdType })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="rewarded">Rewarded Ad</option>
                    <option value="direct_link">Direct Link Ad</option>
                    <option value="other">Other Ad</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">
                  {form.adNetwork.toLowerCase().includes('applixir')
                    ? 'AppLixir Site ID / Player Key (use applixir:<SiteID>)'
                    : 'Placement Zone ID or URL'}
                </label>
                <input
                  type="text"
                  value={form.placementOrUrl}
                  onChange={(e) => setForm({ ...form, placementOrUrl: e.target.value })}
                  placeholder={
                    form.adNetwork.toLowerCase().includes('applixir')
                      ? 'applixir:12345 or applixir:xxxx-xxxx-xxxx-xxxx'
                      : 'https://... or zone_id'
                  }
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Reward Points</label>
                  <input
                    type="number"
                    min={1}
                    value={form.rewardPoints}
                    onChange={(e) => setForm({ ...form, rewardPoints: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Daily Limit / User</label>
                  <input
                    type="number"
                    min={1}
                    value={form.dailyLimit}
                    onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Duration (30–180s)</label>
                  <input
                    type="number"
                    min={30}
                    max={180}
                    value={form.estimatedDuration}
                    onChange={(e) => setForm({ ...form, estimatedDuration: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Verification Method</label>
                  <select
                    value={form.rewardVerificationMethod}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        rewardVerificationMethod: e.target.value as RewardVerificationMethod,
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="s2s_postback">S2S Postback</option>
                    <option value="sdk_callback">SDK Callback</option>
                    <option value="none">None (Inactive Only)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value as 'active' | 'inactive' })
                    }
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Allowed Countries</label>
                  <input
                    type="text"
                    value={form.allowedCountries}
                    onChange={(e) => setForm({ ...form, allowedCountries: e.target.value })}
                    placeholder="ALL or BD,US"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Start Date (Optional)</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">End Date (Optional)</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.incentivizedTrafficAllowed}
                  onChange={(e) =>
                    setForm({ ...form, incentivizedTrafficAllowed: e.target.checked })
                  }
                  className="w-4 h-4 rounded accent-violet-600"
                />
                <span>Ad Network explicitly allows Incentivized Traffic for this placement</span>
              </label>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Instructions or campaign notes shown to users..."
                  className="w-full p-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/15 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-5 rounded-xl brand-button text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Advertisement</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
