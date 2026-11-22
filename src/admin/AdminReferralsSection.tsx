import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Gift,
  Loader2,
  Save,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import {
  AdminRole,
  ReferralLogRecord,
  ReferralRewardRecord,
  ReferralSettingsConfig,
  ReferredUser,
  UserProfile,
} from '../types';
import { formatPoints } from '../services/appService';
import { adminManageReferral, saveReferralSettingsConfig } from '../services/dashboardService';
import { hasAdminPermission } from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminReferralsSectionProps {
  referrals: ReferredUser[];
  referralRewards: ReferralRewardRecord[];
  referralLogs: ReferralLogRecord[];
  referralSettings: ReferralSettingsConfig;
  users: UserProfile[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

type RefSubTab = 'list' | 'rewards' | 'logs' | 'settings';

export const AdminReferralsSection: React.FC<AdminReferralsSectionProps> = ({
  referrals,
  referralRewards,
  referralLogs,
  referralSettings,
  users,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<RefSubTab>('list');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rejectModalUid, setRejectModalUid] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Settings form state
  const [enabled, setEnabled] = useState(referralSettings.referralEnabled);
  const [referrerBonus, setReferrerBonus] = useState(
    referralSettings.referrerBonusPoints !== null
      ? String(referralSettings.referrerBonusPoints)
      : '',
  );
  const [newUserBonus, setNewUserBonus] = useState(
    referralSettings.newUserBonusPoints !== null
      ? String(referralSettings.newUserBonusPoints)
      : '',
  );
  const [minAds, setMinAds] = useState(String(referralSettings.minimumQualificationAds));
  const [requireVerified, setRequireVerified] = useState(referralSettings.requireEmailVerified);
  const [requireActive, setRequireActive] = useState(referralSettings.requireActiveAccount);
  const [maxReferrals, setMaxReferrals] = useState(
    referralSettings.maxReferralsPerUser !== null
      ? String(referralSettings.maxReferralsPerUser)
      : '',
  );
  const [dailyCap, setDailyCap] = useState(String(referralSettings.dailyReferralCap));
  const [rulesText, setRulesText] = useState(referralSettings.referralRulesText);
  const [savingSettings, setSavingSettings] = useState(false);

  const canManage = hasAdminPermission(adminRole, 'manage_referrals');

  const userMap = useMemo(() => {
    const m = new Map<string, UserProfile>();
    users.forEach((u) => m.set(u.uid, u));
    return m;
  }, [users]);

  const kpis = useMemo(() => {
    const qualified = referrals.filter(
      (r) => r.qualificationStatus === 'qualified' || r.qualificationStatus === 'rewarded',
    ).length;
    const pending = referrals.filter(
      (r) => r.rewardStatus === 'pending' && r.qualificationStatus !== 'rejected',
    ).length;
    const fromRewards = referralRewards
      .filter((rw) => rw.status === 'credited')
      .reduce((s, rw) => s + rw.referrerBonusPoints + rw.newUserBonusPoints, 0);
    const fromReferrals = referrals
      .filter((r) => r.rewardStatus === 'credited')
      .reduce((s, r) => s + r.bonusEarnedPoints + r.newUserBonusPoints, 0);
    return {
      total: referrals.length,
      qualified,
      pending,
      distributedPts: Math.max(fromRewards, fromReferrals),
    };
  }, [referrals, referralRewards]);

  const handleCreditReferral = async (referredUid: string) => {
    if (!canManage) return;
    setBusyUid(referredUid);
    try {
      await adminManageReferral({
        referredUid,
        action: 'qualify_credit',
        adminUser,
      });
      showToast('Referral approved & bonus credited atomically.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Approval failed.', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const handleRejectReferral = async () => {
    if (!canManage || !rejectModalUid) return;
    if (rejectReason.trim().length < 3) {
      showToast('Enter a clear rejection reason.', 'error');
      return;
    }
    setBusyUid(rejectModalUid);
    try {
      await adminManageReferral({
        referredUid: rejectModalUid,
        action: 'reject',
        rejectionReason: rejectReason.trim(),
        adminUser,
      });
      showToast('Referral rejected & logged.', 'info');
      setRejectModalUid(null);
      setRejectReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rejection failed.', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSavingSettings(true);
    try {
      await saveReferralSettingsConfig(
        {
          referralEnabled: enabled,
          referrerBonusPoints: referrerBonus.trim() ? Number(referrerBonus) : null,
          newUserBonusPoints: newUserBonus.trim() ? Number(newUserBonus) : null,
          minimumQualificationAds: Math.max(0, Math.floor(Number(minAds || 0))),
          requireEmailVerified: requireVerified,
          requireActiveAccount: requireActive,
          maxReferralsPerUser: maxReferrals.trim() ? Number(maxReferrals) : null,
          dailyReferralCap: Math.max(1, Math.floor(Number(dailyCap || 25))),
          referralRulesText: rulesText,
        },
        adminUser,
      );
      showToast(
        'Referral bonus settings saved. Changes apply only to future qualifications; past rewards remain preserved.',
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save referral settings.', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-5">
      {!canManage && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-400/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Support Admin can audit referral records and security logs in read-only mode.
          </span>
        </div>
      )}

      {/* 4 Real KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              Total Referrals
            </span>
            <Users className="w-4 h-4 text-violet-400" />
          </div>
          <p className="text-xl font-extrabold font-mono-num text-white mt-2">
            {formatPoints(kpis.total)}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              Qualified &amp; Rewarded
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-xl font-extrabold font-mono-num text-emerald-300 mt-2">
            {formatPoints(kpis.qualified)}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              Pending Referrals
            </span>
            <Gift className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-xl font-extrabold font-mono-num text-amber-300 mt-2">
            {formatPoints(kpis.pending)}
          </p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              Total Bonus Distributed
            </span>
            <Coins className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl font-extrabold font-mono-num text-violet-300 mt-2">
            {formatPoints(kpis.distributedPts)} Pts
          </p>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'list' as RefSubTab, label: `Referrals List (${referrals.length})` },
          { key: 'rewards' as RefSubTab, label: `Reward History (${referralRewards.length})` },
          { key: 'logs' as RefSubTab, label: `Suspicious & Logs (${referralLogs.length})` },
          { key: 'settings' as RefSubTab, label: 'Bonus & Rules Settings' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubTab(t.key)}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border transition-colors ${
              subTab === t.key
                ? 'bg-gradient-to-r from-violet-600/30 to-blue-600/25 border-violet-400/45 text-white'
                : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'list' && (
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Referred User</th>
                  <th className="py-3.5 px-4">Referrer</th>
                  <th className="py-3.5 px-4">Code Used</th>
                  <th className="py-3.5 px-4">Qualification</th>
                  <th className="py-3.5 px-4">Reward Status</th>
                  <th className="py-3.5 px-4 text-right">Bonus</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {referrals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No referral records in Firestore yet.
                    </td>
                  </tr>
                ) : (
                  referrals.map((r) => {
                    const referrer = userMap.get(r.referrerUid);
                    const referred = userMap.get(r.referredUid);
                    const busy = busyUid === r.referredUid;
                    return (
                      <tr key={r.id} className="hover:bg-white/[0.025]">
                        <td className="py-3 px-4">
                          <p className="font-bold text-white">{referred?.fullName || r.name}</p>
                          <p className="text-[11px] text-slate-400">
                            @{r.referredUsername} · {r.joinedDate}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-200">
                            {referrer?.fullName || r.referrerUid}
                          </p>
                          <p className="text-[11px] text-slate-400">{referrer?.email || ''}</p>
                        </td>
                        <td className="py-3 px-4 font-mono-num text-violet-300">
                          {r.referralCodeUsed}
                        </td>
                        <td className="py-3 px-4 capitalize text-slate-200">
                          {r.qualificationStatus}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border capitalize ${
                              r.rewardStatus === 'credited'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35'
                                : r.rewardStatus === 'rejected'
                                  ? 'bg-rose-500/15 text-rose-300 border-rose-400/35'
                                  : 'bg-amber-500/15 text-amber-300 border-amber-400/35'
                            }`}
                          >
                            {r.rewardStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num font-bold text-emerald-300">
                          {r.bonusEarnedPoints > 0 ? `+${r.bonusEarnedPoints} Pts` : '—'}
                        </td>
                        <td className="py-3 px-4">
                          {r.rewardStatus === 'pending' && canManage ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleCreditReferral(r.referredUid)}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
                              >
                                Approve &amp; Credit
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setRejectModalUid(r.referredUid);
                                  setRejectReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-400/30 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <p className="text-right text-[11px] text-slate-500">
                              {r.rejectionReason || 'Processed'}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'rewards' && (
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Reward ID</th>
                  <th className="py-3.5 px-4">Referrer</th>
                  <th className="py-3.5 px-4">Referred User</th>
                  <th className="py-3.5 px-4 text-right">Referrer Bonus</th>
                  <th className="py-3.5 px-4 text-right">New User Bonus</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {referralRewards.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      No referral rewards credited yet.
                    </td>
                  </tr>
                ) : (
                  referralRewards.map((rw) => (
                    <tr key={rw.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4 font-mono-num text-slate-200">{rw.rewardId}</td>
                      <td className="py-3 px-4 text-slate-200">
                        {userMap.get(rw.referrerUid)?.email || rw.referrerUid}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {userMap.get(rw.referredUid)?.email || rw.referredUid}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-emerald-300">
                        +{formatPoints(rw.referrerBonusPoints)} Pts
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-violet-300">
                        +{formatPoints(rw.newUserBonusPoints)} Pts
                      </td>
                      <td className="py-3 px-4 capitalize text-emerald-300 font-semibold">
                        {rw.status}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {rw.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'logs' && (
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Event</th>
                  <th className="py-3.5 px-4">Severity</th>
                  <th className="py-3.5 px-4">Details</th>
                  <th className="py-3.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {referralLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">
                      No referral security or qualification logs recorded yet.
                    </td>
                  </tr>
                ) : (
                  referralLogs.map((l) => (
                    <tr key={l.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4 font-semibold text-white flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>{l.eventType}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-bold border uppercase ${
                            l.severity === 'high'
                              ? 'bg-rose-500/15 text-rose-300 border-rose-400/35'
                              : l.severity === 'medium'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-400/35'
                                : 'bg-blue-500/15 text-blue-300 border-blue-400/35'
                          }`}
                        >
                          {l.severity}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{l.details}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {l.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'settings' && (
        <form
          onSubmit={handleSaveSettings}
          className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-4 text-xs"
        >
          <div className="rounded-xl bg-blue-500/10 border border-blue-400/25 p-3 text-blue-200">
            Updated bonus amounts apply strictly to <strong>future</strong> referral qualifications.
            Historical <span className="font-mono-num">referralRewards</span> documents remain
            immutable with the bonus value credited at time of qualification.
          </div>

          <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer font-semibold">
            <input
              type="checkbox"
              disabled={!canManage}
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 rounded accent-violet-600"
            />
            <span>Enable Referral Program</span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Referrer Bonus (Points)</label>
              <input
                type="number"
                min={0}
                disabled={!canManage}
                value={referrerBonus}
                onChange={(e) => setReferrerBonus(e.target.value)}
                placeholder="e.g. 200"
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">New User Welcome Bonus (Pts)</label>
              <input
                type="number"
                min={0}
                disabled={!canManage}
                value={newUserBonus}
                onChange={(e) => setNewUserBonus(e.target.value)}
                placeholder="e.g. 50"
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Min Qualifying Ads</label>
              <input
                type="number"
                min={0}
                disabled={!canManage}
                value={minAds}
                onChange={(e) => setMinAds(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">
                Max Referrals Per User (Blank = Unlimited)
              </label>
              <input
                type="number"
                min={1}
                disabled={!canManage}
                value={maxReferrals}
                onChange={(e) => setMaxReferrals(e.target.value)}
                placeholder="Unlimited"
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Daily Referral Cap</label>
              <input
                type="number"
                min={1}
                disabled={!canManage}
                value={dailyCap}
                onChange={(e) => setDailyCap(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={requireVerified}
                onChange={(e) => setRequireVerified(e.target.checked)}
                className="w-4 h-4 rounded accent-violet-600"
              />
              <span>Require Email Verification</span>
            </label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={requireActive}
                onChange={(e) => setRequireActive(e.target.checked)}
                className="w-4 h-4 rounded accent-violet-600"
              />
              <span>Require Active Account Status</span>
            </label>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-300">Referral Policy Summary</label>
            <textarea
              rows={2}
              disabled={!canManage}
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              className="w-full p-3 rounded-xl bg-[#070B22] border border-white/15 text-white disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={!canManage || savingSettings}
            className="min-h-[42px] px-5 rounded-xl brand-button text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {savingSettings ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>Save Referral Settings</span>
          </button>
        </form>
      )}

      {/* Reject Referral Modal */}
      {rejectModalUid && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#0B1026] border border-white/15 p-5 space-y-4 text-xs">
            <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
              <XCircle className="w-5 h-5" />
              <span>Reject Referral Qualification</span>
            </div>
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Suspected duplicate device / self-referral"
              className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectModalUid(null)}
                className="px-4 py-2 rounded-xl border border-white/15 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyUid === rejectModalUid}
                onClick={() => void handleRejectReferral()}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
