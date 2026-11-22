import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Loader2,
  Megaphone,
  Plus,
  Power,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  AdCampaignRecord,
  AdminRole,
  AdNetworkConfig,
  AdPlacementRecord,
  AdType,
  RewardVerificationMethod,
} from '../types';
import { hasAdminPermission } from '../services/adminService';
import { deleteAdCampaignRecord, saveAdCampaignRecord } from '../services/adNetworkService';
import {
  deleteAdvertisement,
  normalizeAdDurationSeconds,
  saveAdvertisement,
  syncLinkedAdvertisementFields,
} from '../services/dashboardService';
import { formatPoints } from '../services/appService';
import { useToast } from '../components/ui/ToastProvider';

interface AdNetworkCampaignsTabProps {
  networks: AdNetworkConfig[];
  placements: AdPlacementRecord[];
  campaigns: AdCampaignRecord[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

interface CampaignForm {
  isNew: boolean;
  campaignId: string;
  campaignName: string;
  networkId: string;
  placementId: string;
  campaignType: AdType;
  rewardPoints: string;
  dailyUserLimit: string;
  globalDailyLimit: string;
  estimatedDuration: string;
  startDate: string;
  endDate: string;
  targetCountries: string;
  rewardVerificationMethod: RewardVerificationMethod;
  incentivizedTrafficAllowed: boolean;
  rewardEligible: boolean;
  status: 'active' | 'inactive';
  linkedAdId: string;
  syncToWatchAds: boolean;
}

function emptyCampaignForm(networks: AdNetworkConfig[]): CampaignForm {
  const first = networks[0];
  return {
    isNew: true,
    campaignId: `cmp_${Date.now().toString().slice(-6)}`,
    campaignName: '',
    networkId: first?.networkId || 'monetag',
    placementId: '',
    campaignType: 'rewarded',
    rewardPoints: '50',
    dailyUserLimit: '5',
    globalDailyLimit: '500',
    estimatedDuration: '30',
    startDate: '',
    endDate: '',
    targetCountries: 'ALL',
    rewardVerificationMethod: 's2s_postback',
    incentivizedTrafficAllowed: Boolean(first?.incentivizedTrafficAllowed),
    rewardEligible: Boolean(first?.incentivizedTrafficAllowed && first?.rewardVerificationSupported),
    status: 'active',
    linkedAdId: '',
    syncToWatchAds: false,
  };
}

export const AdNetworkCampaignsTab: React.FC<AdNetworkCampaignsTabProps> = ({
  networks,
  placements,
  campaigns,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const canManage = hasAdminPermission(adminRole, 'manage_ads');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CampaignForm>(() => emptyCampaignForm(networks));
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const networkMap = useMemo(() => {
    const m = new Map<string, AdNetworkConfig>();
    for (const n of networks) m.set(n.networkId, n);
    return m;
  }, [networks]);

  const placementMap = useMemo(() => {
    const m = new Map<string, AdPlacementRecord>();
    for (const p of placements) m.set(p.placementId, p);
    return m;
  }, [placements]);

  const openCreate = () => {
    setForm(emptyCampaignForm(networks));
    setModalOpen(true);
  };

  const openEdit = (c: AdCampaignRecord) => {
    setForm({
      isNew: false,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      networkId: c.networkId,
      placementId: c.placementId,
      campaignType: c.campaignType,
      rewardPoints: String(c.rewardPoints),
      dailyUserLimit: String(c.dailyUserLimit),
      globalDailyLimit: String(c.globalDailyLimit),
      estimatedDuration: String(normalizeAdDurationSeconds(c.estimatedDuration)),
      startDate: c.startDate,
      endDate: c.endDate,
      targetCountries: c.targetCountries,
      rewardVerificationMethod: c.rewardVerificationMethod,
      incentivizedTrafficAllowed: c.incentivizedTrafficAllowed,
      rewardEligible: c.rewardEligible,
      status: c.status,
      linkedAdId: c.linkedAdId,
      syncToWatchAds: Boolean(c.linkedAdId),
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (form.campaignName.trim().length < 2) {
      showToast('Campaign Name is required.', 'error');
      return;
    }

    const rewardPts = Math.max(0, Math.floor(Number(form.rewardPoints || 0)));
    const userLimit = Math.max(1, Math.floor(Number(form.dailyUserLimit || 1)));
    const globalLimit = Math.max(1, Math.floor(Number(form.globalDailyLimit || 100)));
    const net = networkMap.get(form.networkId);
    const placement = placementMap.get(form.placementId);

    const eligible =
      form.rewardEligible &&
      form.incentivizedTrafficAllowed &&
      form.rewardVerificationMethod !== 'none' &&
      (form.campaignType !== 'direct_link' || form.incentivizedTrafficAllowed);

    if (rewardPts > 0 && !eligible) {
      showToast(
        'Cannot assign Reward Points unless Incentivized Traffic & Server Verification are approved.',
        'error',
      );
      return;
    }

    const syncedAdId =
      form.syncToWatchAds && eligible
        ? form.linkedAdId.trim() || `ad_${form.campaignId}`
        : form.linkedAdId.trim();

    setSaving(true);
    try {
      await saveAdCampaignRecord({
        campaignId: form.campaignId,
        campaignName: form.campaignName,
        networkId: form.networkId,
        networkName: net?.networkName || form.networkId,
        placementId: form.placementId,
        campaignType: form.campaignType,
        rewardPoints: eligible ? rewardPts : 0,
        dailyUserLimit: userLimit,
        globalDailyLimit: globalLimit,
        estimatedDuration: normalizeAdDurationSeconds(form.estimatedDuration),
        startDate: form.startDate,
        endDate: form.endDate,
        targetCountries: form.targetCountries,
        rewardVerificationMethod: form.rewardVerificationMethod,
        incentivizedTrafficAllowed: form.incentivizedTrafficAllowed,
        rewardEligible: eligible,
        status: form.status,
        linkedAdId: syncedAdId,
        adminUser: { ...adminUser, role: adminRole },
      });

      if (form.syncToWatchAds && eligible && syncedAdId && rewardPts > 0) {
        await saveAdvertisement({
          adId: syncedAdId,
          adName: form.campaignName,
          adNetwork: net?.networkName || form.networkId,
          adType: form.campaignType,
          placementOrUrl: placement?.destinationUrl || placement?.zoneOrPlacementCode || net?.placementId || '',
          rewardPoints: rewardPts,
          dailyLimit: userLimit,
          estimatedDuration: normalizeAdDurationSeconds(form.estimatedDuration),
          startDate: form.startDate,
          endDate: form.endDate,
          status: form.status,
          allowedCountries: form.targetCountries || 'ALL',
          rewardVerificationMethod: form.rewardVerificationMethod,
          incentivizedTrafficAllowed: form.incentivizedTrafficAllowed,
          description: `Verified ${net?.networkName || form.networkId} campaign`,
          isNew: !form.linkedAdId,
        });
      }

      showToast(`Campaign "${form.campaignName}" saved.`, 'success');
      setModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save campaign.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (c: AdCampaignRecord) => {
    if (!canManage) return;
    setBusyId(c.campaignId);
    const nextStatus = c.status === 'active' ? 'inactive' : 'active';
    try {
      await saveAdCampaignRecord({
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        networkId: c.networkId,
        networkName: c.networkName,
        placementId: c.placementId,
        campaignType: c.campaignType,
        rewardPoints: c.rewardPoints,
        dailyUserLimit: c.dailyUserLimit,
        globalDailyLimit: c.globalDailyLimit,
        estimatedDuration: normalizeAdDurationSeconds(c.estimatedDuration),
        startDate: c.startDate,
        endDate: c.endDate,
        targetCountries: c.targetCountries,
        rewardVerificationMethod: c.rewardVerificationMethod,
        incentivizedTrafficAllowed: c.incentivizedTrafficAllowed,
        rewardEligible: c.rewardEligible,
        status: nextStatus,
        linkedAdId: c.linkedAdId,
        adminUser: { ...adminUser, role: adminRole },
      });
      if (c.linkedAdId) {
        await syncLinkedAdvertisementFields(c.linkedAdId, { status: nextStatus });
      }
      showToast(`Campaign "${c.campaignName}" toggled.`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Toggle failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (c: AdCampaignRecord) => {
    if (!canManage) return;
    setBusyId(c.campaignId);
    try {
      await deleteAdCampaignRecord({
        campaign: c,
        adminUser: { ...adminUser, role: adminRole },
      });
      if (c.linkedAdId) {
        await deleteAdvertisement(c.linkedAdId).catch(() => {});
      }
      showToast(`Deleted campaign "${c.campaignName}".`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-300">
          Configure verified reward campaigns with per-user daily caps, global daily caps, target
          countries, and server verification rules.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="min-h-[40px] px-4 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Campaign</span>
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3.5 px-4">Campaign</th>
                <th className="py-3.5 px-4">Network &amp; Countries</th>
                <th className="py-3.5 px-4 text-right">Reward &amp; Caps</th>
                <th className="py-3.5 px-4">Eligibility</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No network campaigns created yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => {
                  const busy = busyId === c.campaignId;
                  return (
                    <tr key={c.id} className="hover:bg-white/[0.025]">
                      <td className="py-3 px-4">
                        <p className="font-bold text-white">{c.campaignName}</p>
                        <p className="text-[11px] text-slate-400 font-mono-num">
                          {c.campaignId} · {c.campaignType}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-200">{c.networkName}</p>
                        <p className="text-[11px] text-slate-400">Countries: {c.targetCountries}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num">
                        <p className="font-bold text-emerald-300">+{formatPoints(c.rewardPoints)} Pts</p>
                        <p className="text-[11px] text-slate-400">
                          User: {c.dailyUserLimit}/d · Global: {c.globalCompletedToday}/
                          {c.globalDailyLimit}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        {c.rewardEligible ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 text-[11px] font-semibold">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified ({c.rewardVerificationMethod})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-200 text-[11px] font-semibold">
                            <ShieldAlert className="w-3 h-3" />
                            Unrewarded
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border capitalize ${
                            c.status === 'active'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35'
                              : 'bg-slate-500/15 text-slate-300 border-slate-400/35'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => openEdit(c)}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 disabled:opacity-40"
                            title="Edit Campaign"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void handleToggle(c)}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-amber-200 border border-white/10 disabled:opacity-40"
                            title="Toggle Status"
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void handleDelete(c)}
                            className="p-2 rounded-lg bg-rose-500/15 border border-rose-400/30 text-rose-200 disabled:opacity-40"
                            title="Delete Campaign"
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

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-[#0B1026] border border-white/15 overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-violet-400" />
                <h3 className="text-base font-bold font-display text-white">
                  {form.isNew ? 'Create Network Campaign' : `Edit ${form.campaignName}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Campaign ID</label>
                  <input
                    type="text"
                    disabled={!form.isNew}
                    value={form.campaignId}
                    onChange={(e) => setForm({ ...form, campaignId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Campaign Name</label>
                  <input
                    type="text"
                    value={form.campaignName}
                    onChange={(e) => setForm({ ...form, campaignName: e.target.value })}
                    placeholder="e.g. Monetag Daily Video Bonus"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Ad Network</label>
                  <select
                    value={form.networkId}
                    onChange={(e) => setForm({ ...form, networkId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    {networks.map((n) => (
                      <option key={n.networkId} value={n.networkId}>
                        {n.networkName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Placement</label>
                  <select
                    value={form.placementId}
                    onChange={(e) => setForm({ ...form, placementId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="">Default Network Placement</option>
                    {placements
                      .filter((p) => p.networkId === form.networkId)
                      .map((p) => (
                        <option key={p.placementId} value={p.placementId}>
                          {p.placementName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Campaign Type</label>
                  <select
                    value={form.campaignType}
                    onChange={(e) => setForm({ ...form, campaignType: e.target.value as AdType })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="rewarded">Rewarded Ad</option>
                    <option value="direct_link">Direct Link</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Reward Points</label>
                  <input
                    type="number"
                    min={0}
                    value={form.rewardPoints}
                    onChange={(e) => setForm({ ...form, rewardPoints: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Daily User Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={form.dailyUserLimit}
                    onChange={(e) => setForm({ ...form, dailyUserLimit: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Global Daily Limit</label>
                  <input
                    type="number"
                    min={1}
                    value={form.globalDailyLimit}
                    onChange={(e) => setForm({ ...form, globalDailyLimit: e.target.value })}
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
                  <label className="font-semibold text-slate-300">Verification</label>
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
                    <option value="none">None (0 Points)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Target Countries</label>
                  <input
                    type="text"
                    value={form.targetCountries}
                    onChange={(e) => setForm({ ...form, targetCountries: e.target.value })}
                    placeholder="ALL or BD,IN,US"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Campaign Status</label>
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Start Date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">End Date</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2">
                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.incentivizedTrafficAllowed}
                    onChange={(e) =>
                      setForm({ ...form, incentivizedTrafficAllowed: e.target.checked })
                    }
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span>Network allows Incentivized Traffic for this campaign</span>
                </label>

                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.rewardEligible}
                    onChange={(e) => setForm({ ...form, rewardEligible: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span>Reward Eligible (enables server-verified point payouts)</span>
                </label>

                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.syncToWatchAds}
                    onChange={(e) => setForm({ ...form, syncToWatchAds: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span>Publish to User Watch &amp; Earn (`advertisements` collection)</span>
                </label>
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
                  <span>Save Campaign</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
