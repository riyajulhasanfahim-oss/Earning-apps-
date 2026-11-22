import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Edit3,
  ExternalLink,
  Link2,
  Loader2,
  Plus,
  Power,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  AdminRole,
  AdNetworkConfig,
  AdPlacementRecord,
  AdType,
} from '../types';
import { hasAdminPermission } from '../services/adminService';
import {
  deleteAdPlacementRecord,
  saveAdPlacementOrDirectLink,
} from '../services/adNetworkService';
import { syncLinkedAdvertisementFields } from '../services/dashboardService';
import { useToast } from '../components/ui/ToastProvider';

interface AdNetworkDirectLinksTabProps {
  networks: AdNetworkConfig[];
  placements: AdPlacementRecord[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

interface PlacementForm {
  isNew: boolean;
  placementId: string;
  networkId: string;
  placementName: string;
  placementCategory: string;
  adType: AdType;
  destinationUrl: string;
  zoneOrPlacementCode: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'inactive';
  incentivizedTrafficApproved: boolean;
  rewardEligible: boolean;
  linkedAdId: string;
}

function emptyPlacementForm(networks: AdNetworkConfig[]): PlacementForm {
  const first = networks[0];
  return {
    isNew: true,
    placementId: `dl_${Date.now().toString().slice(-6)}`,
    networkId: first?.networkId || 'adsterra',
    placementName: '',
    placementCategory: 'Direct Link',
    adType: 'direct_link',
    destinationUrl: '',
    zoneOrPlacementCode: '',
    startDate: '',
    endDate: '',
    status: 'active',
    incentivizedTrafficApproved: false,
    rewardEligible: false,
    linkedAdId: '',
  };
}

export const AdNetworkDirectLinksTab: React.FC<AdNetworkDirectLinksTabProps> = ({
  networks,
  placements,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const canManage = hasAdminPermission(adminRole, 'manage_ads');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PlacementForm>(() => emptyPlacementForm(networks));
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | 'direct_link' | 'rewarded' | 'other'>('all');

  const networkMap = useMemo(() => {
    const m = new Map<string, AdNetworkConfig>();
    for (const n of networks) m.set(n.networkId, n);
    return m;
  }, [networks]);

  const filtered = useMemo(() => {
    return placements.filter((p) => (typeFilter === 'all' ? true : p.adType === typeFilter));
  }, [placements, typeFilter]);

  const openCreate = () => {
    setForm(emptyPlacementForm(networks));
    setModalOpen(true);
  };

  const openEdit = (p: AdPlacementRecord) => {
    setForm({
      isNew: false,
      placementId: p.placementId,
      networkId: p.networkId,
      placementName: p.placementName,
      placementCategory: p.placementCategory,
      adType: p.adType,
      destinationUrl: p.destinationUrl,
      zoneOrPlacementCode: p.zoneOrPlacementCode,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      incentivizedTrafficApproved: p.incentivizedTrafficApproved,
      rewardEligible: p.rewardEligible,
      linkedAdId: p.linkedAdId,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (form.placementName.trim().length < 2) {
      showToast('Link / Placement name is required.', 'error');
      return;
    }
    if (form.adType === 'direct_link' && form.rewardEligible && !form.incentivizedTrafficApproved) {
      showToast(
        'Direct Links without Incentivized Traffic approval cannot be marked Reward Eligible.',
        'error',
      );
      return;
    }

    const net = networkMap.get(form.networkId);
    setSaving(true);
    try {
      await saveAdPlacementOrDirectLink({
        placementId: form.placementId,
        networkId: form.networkId,
        networkName: net?.networkName || form.networkId,
        placementName: form.placementName,
        placementCategory: form.placementCategory,
        adType: form.adType,
        destinationUrl: form.destinationUrl,
        zoneOrPlacementCode: form.zoneOrPlacementCode,
        startDate: form.startDate,
        endDate: form.endDate,
        status: form.status,
        incentivizedTrafficApproved: form.incentivizedTrafficApproved,
        rewardEligible: form.incentivizedTrafficApproved ? form.rewardEligible : false,
        linkedAdId: form.linkedAdId,
        adminUser: { ...adminUser, role: adminRole },
      });
      if (form.linkedAdId.trim()) {
        await syncLinkedAdvertisementFields(form.linkedAdId.trim(), {
          placementOrUrl: form.destinationUrl.trim() || form.zoneOrPlacementCode.trim(),
          status: form.status,
        });
      }
      showToast(`Placement "${form.placementName}" saved.`, 'success');
      setModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save placement.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (p: AdPlacementRecord) => {
    if (!canManage) return;
    setBusyId(p.placementId);
    const nextStatus = p.status === 'active' ? 'inactive' : 'active';
    try {
      await saveAdPlacementOrDirectLink({
        placementId: p.placementId,
        networkId: p.networkId,
        networkName: p.networkName,
        placementName: p.placementName,
        placementCategory: p.placementCategory,
        adType: p.adType,
        destinationUrl: p.destinationUrl,
        zoneOrPlacementCode: p.zoneOrPlacementCode,
        startDate: p.startDate,
        endDate: p.endDate,
        status: nextStatus,
        incentivizedTrafficApproved: p.incentivizedTrafficApproved,
        rewardEligible: p.rewardEligible,
        linkedAdId: p.linkedAdId,
        adminUser: { ...adminUser, role: adminRole },
      });
      if (p.linkedAdId) {
        await syncLinkedAdvertisementFields(p.linkedAdId, { status: nextStatus });
      }
      showToast(
        `"${p.placementName}" is now ${nextStatus}.`,
        'info',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Status update failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (p: AdPlacementRecord) => {
    if (!canManage) return;
    setBusyId(p.placementId);
    try {
      await deleteAdPlacementRecord({
        placement: p,
        adminUser: { ...adminUser, role: adminRole },
      });
      showToast(`Deleted "${p.placementName}".`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-blue-500/10 border border-blue-400/25 p-3.5 flex items-start gap-2.5 text-xs text-blue-100">
        <ShieldAlert className="w-4 h-4 text-blue-300 shrink-0 mt-0.5" />
        <span>
          <strong>Direct Link Policy Guard:</strong> Standard Direct Link visits do NOT award reward
          points. Rewards are unlocked only when a network explicitly approves Incentivized Traffic
          AND provides verified S2S postback / SDK completion tracking.
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {(['all', 'direct_link', 'rewarded', 'other'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold border transition-colors ${
                typeFilter === t
                  ? 'bg-violet-600/25 border-violet-400/40 text-white'
                  : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              {t === 'all'
                ? 'All Placements'
                : t === 'direct_link'
                  ? 'Direct Links'
                  : t === 'rewarded'
                    ? 'Rewarded Zones'
                    : 'Other'}
            </button>
          ))}
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="min-h-[40px] px-4 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Direct Link / Placement</span>
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3.5 px-4">Placement / Link Name</th>
                <th className="py-3.5 px-4">Network &amp; Category</th>
                <th className="py-3.5 px-4">Schedule</th>
                <th className="py-3.5 px-4">Network Policy &amp; Reward Status</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    No Direct Links or Ad Placements configured yet.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const busy = busyId === p.placementId;
                  return (
                    <tr key={p.id} className="hover:bg-white/[0.025]">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Link2 className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                          <span className="font-bold text-white">{p.placementName}</span>
                        </div>
                        {p.destinationUrl ? (
                          <a
                            href={p.destinationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-300 hover:underline mt-0.5 max-w-[260px] truncate"
                          >
                            <span className="truncate">{p.destinationUrl}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <p className="text-[11px] font-mono-num text-slate-400 mt-0.5">
                            Zone: {p.zoneOrPlacementCode || '—'}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-200">{p.networkName}</p>
                        <p className="text-[11px] text-slate-400">
                          {p.adType === 'direct_link'
                            ? 'Direct Link'
                            : p.adType === 'rewarded'
                              ? 'Rewarded Ad'
                              : 'Other'}{' '}
                          · {p.placementCategory}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono-num text-[11px] text-slate-300">
                        {p.startDate || p.endDate
                          ? `${p.startDate || 'Now'} → ${p.endDate || 'Open'}`
                          : 'Always Active'}
                      </td>
                      <td className="py-3 px-4">
                        {p.rewardEligible && p.incentivizedTrafficApproved ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 font-semibold text-[11px]">
                            <ShieldCheck className="w-3 h-3" />
                            Approved + Reward Eligible
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-400/30 text-amber-200 font-semibold text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            Non-Incentivized (0 Reward)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border capitalize ${
                            p.status === 'active'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35'
                              : 'bg-slate-500/15 text-slate-300 border-slate-400/35'
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => openEdit(p)}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 disabled:opacity-40"
                            title="Edit Placement"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void handleToggleStatus(p)}
                            className={`p-2 rounded-lg border disabled:opacity-40 ${
                              p.status === 'active'
                                ? 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                                : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
                            }`}
                            title="Toggle Status"
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!canManage || busy}
                            onClick={() => void handleDelete(p)}
                            className="p-2 rounded-lg bg-rose-500/15 border border-rose-400/30 text-rose-200 disabled:opacity-40"
                            title="Delete Placement"
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
          <div className="w-full max-w-xl rounded-2xl bg-[#0B1026] border border-white/15 overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-base font-bold font-display text-white">
                {form.isNew ? 'Add Direct Link / Placement' : `Edit ${form.placementName}`}
              </h3>
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
                  <label className="font-semibold text-slate-300">Placement ID</label>
                  <input
                    type="text"
                    disabled={!form.isNew}
                    value={form.placementId}
                    onChange={(e) => setForm({ ...form, placementId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                  />
                </div>
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Link / Placement Name</label>
                  <input
                    type="text"
                    value={form.placementName}
                    onChange={(e) => setForm({ ...form, placementName: e.target.value })}
                    placeholder="e.g. Monetag Rewarded Zone #1"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Category</label>
                  <input
                    type="text"
                    value={form.placementCategory}
                    onChange={(e) => setForm({ ...form, placementCategory: e.target.value })}
                    placeholder="Direct Link / Rewarded Video / Banner"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Placement Type</label>
                  <select
                    value={form.adType}
                    onChange={(e) => setForm({ ...form, adType: e.target.value as AdType })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="direct_link">Direct Link</option>
                    <option value="rewarded">Rewarded Ad</option>
                    <option value="other">Other Placement</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Zone / Placement Code</label>
                  <input
                    type="text"
                    value={form.zoneOrPlacementCode}
                    onChange={(e) => setForm({ ...form, zoneOrPlacementCode: e.target.value })}
                    placeholder="Optional SDK zone ID"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Destination URL</label>
                <input
                  type="url"
                  value={form.destinationUrl}
                  onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })}
                  placeholder="https://..."
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              </div>

              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2">
                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.incentivizedTrafficApproved}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        incentivizedTrafficApproved: e.target.checked,
                        rewardEligible: e.target.checked ? form.rewardEligible : false,
                      })
                    }
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span>Network Policy: Incentivized Traffic explicitly approved</span>
                </label>

                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!form.incentivizedTrafficApproved}
                    checked={form.rewardEligible && form.incentivizedTrafficApproved}
                    onChange={(e) => setForm({ ...form, rewardEligible: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600 disabled:opacity-40"
                  />
                  <span>
                    Reward Eligible (requires Incentivized approval + S2S verification)
                  </span>
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
                  <span>Save Placement</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
