import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Edit3,
  Loader2,
  Plus,
  Power,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Trash2,
} from 'lucide-react';
import {
  AdType,
  Advertisement,
  EconomyConfig,
  FraudLogRecord,
  RewardVerificationMethod,
} from '../../types';
import {
  checkAdPolicyCompliance,
  formatAdTypeLabel,
  formatVerificationMethodLabel,
} from '../../services/adNetworkPolicy';
import { activeFirebaseConfig } from '../../lib/firebase';
import { getDhakaDateKey } from '../../services/appService';
import {
  deleteAdvertisement,
  normalizeAdDurationSeconds,
  saveAdvertisement,
  saveEconomyConfig,
  toggleAdvertisementStatus,
} from '../../services/dashboardService';
import { ModalDrawer } from '../ui/ModalDrawer';
import { useToast } from '../ui/ToastProvider';

interface AdminAdManagerModalProps {
  open: boolean;
  onClose: () => void;
  ads: Advertisement[];
  economy: EconomyConfig;
  fraudLogs: FraudLogRecord[];
}

type AdminTab = 'ads' | 'economy' | 'fraud';

interface AdFormState {
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
  isNew: boolean;
}

function makeDefaultForm(): AdFormState {
  const today = getDhakaDateKey();
  const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  return {
    adId: `ad_${Date.now().toString(36)}`,
    adName: '',
    adNetwork: 'Monetag',
    adType: 'rewarded',
    placementOrUrl: '',
    rewardPoints: '50',
    dailyLimit: '1',
    estimatedDuration: '30',
    startDate: today,
    endDate: nextYear,
    status: 'active',
    allowedCountries: 'BD, GLOBAL',
    rewardVerificationMethod: 's2s_postback',
    incentivizedTrafficAllowed: true,
    description: '',
    isNew: true,
  };
}

export const AdminAdManagerModal: React.FC<AdminAdManagerModalProps> = ({
  open,
  onClose,
  ads,
  economy,
  fraudLogs,
}) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<AdminTab>('ads');
  const [editing, setEditing] = useState<boolean>(false);
  const [form, setForm] = useState<AdFormState>(makeDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  // Economy & Daily Ad Limit form state
  const [pointsPerBdtInput, setPointsPerBdtInput] = useState('');
  const [dailyBonusInput, setDailyBonusInput] = useState('');
  const [minWithdrawInput, setMinWithdrawInput] = useState('');
  const [dailyAdLimitInput, setDailyAdLimitInput] = useState('20');

  useEffect(() => {
    setPointsPerBdtInput(economy.pointsPerBdt ? String(economy.pointsPerBdt) : '');
    setDailyBonusInput(economy.dailyBonusPoints ? String(economy.dailyBonusPoints) : '');
    setMinWithdrawInput(
      economy.minimumWithdrawPoints ? String(economy.minimumWithdrawPoints) : '',
    );
    setDailyAdLimitInput(String(economy.dailyAdLimit || 20));
  }, [economy]);

  const policyCheck = checkAdPolicyCompliance({
    adType: form.adType,
    rewardVerificationMethod: form.rewardVerificationMethod,
    incentivizedTrafficAllowed: form.incentivizedTrafficAllowed,
  });

  const handleNewAd = () => {
    setForm(makeDefaultForm());
    setEditing(true);
  };

  const handleEditAd = (ad: Advertisement) => {
    setForm({
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
      isNew: false,
    });
    setEditing(true);
  };

  const handleSaveAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.adName.trim() || !form.placementOrUrl.trim()) {
      showToast('Ad Name and Placement ID / URL are required.', 'error');
      return;
    }
    if (form.status === 'active' && !policyCheck.compliant) {
      showToast(policyCheck.reason || 'Policy violation prevents activating this ad.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await saveAdvertisement({
        adId: form.adId,
        adName: form.adName,
        adNetwork: form.adNetwork,
        adType: form.adType,
        placementOrUrl: form.placementOrUrl,
        rewardPoints: Math.max(0, Number(form.rewardPoints) || 0),
        dailyLimit: Math.max(1, Number(form.dailyLimit) || 1),
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
      showToast(
        form.isNew ? 'Advertisement created successfully.' : 'Advertisement updated successfully.',
        'success',
      );
      setEditing(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save advertisement.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (ad: Advertisement) => {
    try {
      await toggleAdvertisementStatus(ad);
      showToast(
        `${ad.adName} marked ${ad.status === 'active' ? 'Inactive' : 'Active'}.`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to change status.', 'error');
    }
  };

  const handleDeleteAd = async (ad: Advertisement) => {
    try {
      await deleteAdvertisement(ad.adId);
      showToast(`${ad.adName} deleted.`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete advertisement.', 'error');
    }
  };

  const handleSaveEconomy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await saveEconomyConfig({
        pointsPerBdt: pointsPerBdtInput ? Number(pointsPerBdtInput) : null,
        dailyBonusPoints: dailyBonusInput ? Number(dailyBonusInput) : null,
        minimumWithdrawPoints: minWithdrawInput ? Number(minWithdrawInput) : null,
        maximumWithdrawAmountBdt: economy.maximumWithdrawAmountBdt,
        dailyAdLimit: Math.max(1, Number(dailyAdLimitInput) || 20),
        walletEnabled: economy.walletEnabled,
        earningEnabled: economy.earningEnabled,
      });
      showToast('Economy & Daily Ad Limit updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save config.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const postbackTemplate = `https://us-central1-${activeFirebaseConfig.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=monetag&session_id={ymid}&user_id={subid}&provider_tx_id={click_id}&reward_event_type={reward_event_type}&secret=YOUR_MONETAG_CALLBACK_SECRET`;

  const copyPostback = async () => {
    try {
      await navigator.clipboard.writeText(postbackTemplate);
      showToast('S2S Postback URL template copied.', 'success');
    } catch {
      showToast('Copy failed. Please select and copy manually.', 'error');
    }
  };

  return (
    <ModalDrawer
      open={open}
      onClose={onClose}
      title="Admin Ad & Policy Control"
      subtitle="Manage advertisements, daily ad limits, conversion rates & fraud logs"
    >
      <div className="space-y-4">
        {/* Admin Sub-tabs */}
        <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/10">
          {[
            { id: 'ads' as AdminTab, label: `Ads (${ads.length})` },
            { id: 'economy' as AdminTab, label: 'Limits & Rates' },
            { id: 'fraud' as AdminTab, label: `Fraud (${fraudLogs.length})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setEditing(false);
              }}
              className={`min-h-[38px] px-2 rounded-lg text-xs font-bold transition-all ${
                tab === item.id
                  ? 'brand-gradient text-white shadow'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* TAB 1: ADVERTISEMENT MANAGEMENT */}
        {tab === 'ads' && !editing && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-300">
                Inactive ads stay completely hidden from regular users.
              </p>
              <button
                type="button"
                onClick={handleNewAd}
                className="min-h-[40px] px-3.5 py-2 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center gap-1.5 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Create Ad</span>
              </button>
            </div>

            {/* S2S Postback URL Reference */}
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-400/25 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-indigo-300">
                  Cloud Function S2S Postback Endpoint
                </span>
                <button
                  type="button"
                  onClick={copyPostback}
                  className="text-[11px] font-semibold text-white inline-flex items-center gap-1 hover:text-amber-300"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
              <p className="text-[11px] font-mono-num text-slate-300 break-all">
                {postbackTemplate}
              </p>
            </div>

            {ads.length === 0 ? (
              <div className="p-6 rounded-xl bg-white/[0.03] border border-white/10 text-center space-y-1">
                <p className="text-sm font-bold text-white">No advertisements configured yet</p>
                <p className="text-xs text-slate-400">
                  Click &quot;Create Ad&quot; to publish a verified Monetag, Adsterra, or Partner
                  campaign.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {ads.map((ad) => (
                  <div
                    key={ad.adId}
                    className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-white truncate">{ad.adName}</h4>
                          <span
                            className={`text-[11px] font-semibold ${
                              ad.status === 'active' ? 'text-emerald-400' : 'text-slate-400'
                            }`}
                          >
                            · {ad.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {ad.adNetwork} · {formatAdTypeLabel(ad.adType)} ·{' '}
                          {formatVerificationMethodLabel(ad.rewardVerificationMethod)}
                        </p>
                        <p className="text-xs text-emerald-400 font-semibold tabular-nums mt-0.5">
                          +{ad.rewardPoints} Pts · Limit {ad.dailyLimit}/day · ~
                          {ad.estimatedDuration}s
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => handleEditAd(ad)}
                        className="min-h-[34px] px-3 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(ad)}
                        className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 ${
                          ad.status === 'active'
                            ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                            : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{ad.status === 'active' ? 'Deactivate' : 'Activate'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAd(ad)}
                        className="min-h-[34px] px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-xs font-semibold text-rose-300 inline-flex items-center gap-1.5 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 1B: CREATE / EDIT ADVERTISEMENT FORM */}
        {tab === 'ads' && editing && (
          <form onSubmit={handleSaveAd} className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-white">
                {form.isNew ? 'Create Advertisement' : `Edit ${form.adName}`}
              </h4>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
            </div>

            {!policyCheck.compliant && (
              <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/35 flex items-start gap-2.5 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{policyCheck.reason}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Ad ID
                </label>
                <input
                  type="text"
                  required
                  disabled={!form.isNew}
                  value={form.adId}
                  onChange={(e) => setForm({ ...form, adId: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Ad Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Monetag Rewarded Interstitial"
                  value={form.adName}
                  onChange={(e) => setForm({ ...form, adName: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Ad Network
                </label>
                <select
                  value={form.adNetwork}
                  onChange={(e) => setForm({ ...form, adNetwork: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                >
                  <option value="Monetag">Monetag</option>
                  <option value="Adsterra">Adsterra</option>
                  <option value="Authorized Rewarded Partner">Authorized Rewarded Partner</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Ad Type
                </label>
                <select
                  value={form.adType}
                  onChange={(e) => setForm({ ...form, adType: e.target.value as AdType })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                >
                  <option value="rewarded">Rewarded Ad</option>
                  <option value="direct_link">Direct Link Ad</option>
                  <option value="other">Other Ad</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Ad URL or Approved Placement ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="https://... or placement_zone_id"
                  value={form.placementOrUrl}
                  onChange={(e) => setForm({ ...form, placementOrUrl: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Reward Points
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.rewardPoints}
                  onChange={(e) => setForm({ ...form, rewardPoints: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Daily Limit (Per User/Day)
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={form.dailyLimit}
                  onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Estimated Duration (30–180 Seconds)
                </label>
                <input
                  type="number"
                  min={30}
                  max={180}
                  required
                  value={form.estimatedDuration}
                  onChange={(e) => setForm({ ...form, estimatedDuration: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Allowed Countries
                </label>
                <input
                  type="text"
                  placeholder="BD, IN, US or ALL"
                  value={form.allowedCountries}
                  onChange={(e) => setForm({ ...form, allowedCountries: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  required
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Reward Verification Method
                </label>
                <select
                  value={form.rewardVerificationMethod}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rewardVerificationMethod: e.target.value as RewardVerificationMethod,
                    })
                  }
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                >
                  <option value="s2s_postback">S2S Postback (Recommended)</option>
                  <option value="sdk_callback">Authorized SDK Callback</option>
                  <option value="none">None (Not Reward Eligible)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as 'active' | 'inactive' })
                  }
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.incentivizedTrafficAllowed}
                onChange={(e) =>
                  setForm({ ...form, incentivizedTrafficAllowed: e.target.checked })
                }
                className="w-4 h-4 accent-violet-500"
              />
              <span>
                Ad Network explicitly approves <strong>Incentivized Traffic</strong> for this
                placement
              </span>
            </label>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Instructions / Description
              </label>
              <textarea
                rows={2}
                placeholder="User instructions shown inside the Ad Watching interface..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full p-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || (form.status === 'active' && !policyCheck.compliant)}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              <span>{form.isNew ? 'Publish Advertisement' : 'Save Changes'}</span>
            </button>
          </form>
        )}

        {/* TAB 2: ECONOMY & DAILY AD LIMIT */}
        {tab === 'economy' && (
          <form onSubmit={handleSaveEconomy} className="space-y-3.5">
            <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 flex items-start gap-2.5 text-xs text-slate-300">
              <Sliders className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
              <span>
                Controls global Daily Ad Limit (Asia/Dhaka reset) and BDT conversion rates stored
                in <code className="font-mono-num text-violet-300">appConfig/economy</code>.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Global Daily Ad Limit (Ads / Day)
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={dailyAdLimitInput}
                  onChange={(e) => setDailyAdLimitInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Points per 1 BDT (Optional / Admin Rate)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="Leave blank until set"
                  value={pointsPerBdtInput}
                  onChange={(e) => setPointsPerBdtInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Daily Check-in Bonus Points
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 50"
                  value={dailyBonusInput}
                  onChange={(e) => setDailyBonusInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Minimum Withdraw Points
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 1000"
                  value={minWithdrawInput}
                  onChange={(e) => setMinWithdrawInput(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>Save Economy &amp; Ad Limits</span>
            </button>
          </form>
        )}

        {/* TAB 3: FRAUD LOGS */}
        {tab === 'fraud' && (
          <div className="space-y-2.5">
            {fraudLogs.length === 0 ? (
              <div className="p-6 rounded-xl bg-white/[0.03] border border-white/10 text-center space-y-1">
                <p className="text-sm font-bold text-white">No suspicious callback events logged</p>
                <p className="text-xs text-slate-400">
                  Invalid postbacks, duplicate transactions, and rate-limit violations will appear
                  here automatically.
                </p>
              </div>
            ) : (
              fraudLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/25 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-300">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      {log.reason}
                    </span>
                    <span className="text-[11px] text-slate-400">{log.createdAtLabel}</span>
                  </div>
                  <p className="text-xs text-slate-300">{log.details}</p>
                  <p className="text-[11px] font-mono-num text-slate-400">
                    UID: {log.userId} · Severity: {log.severity}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </ModalDrawer>
  );
};
