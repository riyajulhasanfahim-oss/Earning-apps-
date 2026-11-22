import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Search,
  ShieldAlert,
  Sliders,
  Users,
  XCircle,
} from 'lucide-react';
import {
  ReferralLogRecord,
  ReferralSettingsConfig,
  ReferredUser,
} from '../../types';
import { formatPoints } from '../../services/appService';
import {
  adminManageReferral,
  saveReferralSettingsConfig,
} from '../../services/dashboardService';
import { ModalDrawer } from '../ui/ModalDrawer';
import { useToast } from '../ui/ToastProvider';

interface AdminReferralSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: ReferralSettingsConfig;
  allReferrals: ReferredUser[];
  referralLogs: ReferralLogRecord[];
  adminUser: { uid: string; email: string };
}

type ModalTab = 'settings' | 'review' | 'logs';

export const AdminReferralSettingsModal: React.FC<AdminReferralSettingsModalProps> = ({
  open,
  onClose,
  settings,
  allReferrals,
  referralLogs,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<ModalTab>('settings');

  // Settings form state
  const [referralEnabled, setReferralEnabled] = useState(true);
  const [referrerBonusPoints, setReferrerBonusPoints] = useState('');
  const [newUserBonusPoints, setNewUserBonusPoints] = useState('');
  const [minimumQualificationAds, setMinimumQualificationAds] = useState('1');
  const [requireEmailVerified, setRequireEmailVerified] = useState(true);
  const [requireActiveAccount, setRequireActiveAccount] = useState(true);
  const [maxReferralsPerUser, setMaxReferralsPerUser] = useState('');
  const [dailyReferralCap, setDailyReferralCap] = useState('25');
  const [referralRulesText, setReferralRulesText] = useState('');
  const [saving, setSaving] = useState(false);

  // Review state
  const [searchQuery, setSearchQuery] = useState('');
  const [actingUid, setActingUid] = useState<string | null>(null);
  const [rejectingUid, setRejectingUid] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    setReferralEnabled(settings.referralEnabled);
    setReferrerBonusPoints(
      settings.referrerBonusPoints !== null ? String(settings.referrerBonusPoints) : '',
    );
    setNewUserBonusPoints(
      settings.newUserBonusPoints !== null ? String(settings.newUserBonusPoints) : '',
    );
    setMinimumQualificationAds(String(settings.minimumQualificationAds));
    setRequireEmailVerified(settings.requireEmailVerified);
    setRequireActiveAccount(settings.requireActiveAccount);
    setMaxReferralsPerUser(
      settings.maxReferralsPerUser !== null ? String(settings.maxReferralsPerUser) : '',
    );
    setDailyReferralCap(String(settings.dailyReferralCap));
    setReferralRulesText(settings.referralRulesText);
  }, [settings]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveReferralSettingsConfig(
        {
          referralEnabled,
          referrerBonusPoints:
            referrerBonusPoints.trim() !== '' ? Number(referrerBonusPoints) : null,
          newUserBonusPoints:
            newUserBonusPoints.trim() !== '' ? Number(newUserBonusPoints) : null,
          minimumQualificationAds: Math.max(0, Number(minimumQualificationAds || 0)),
          requireEmailVerified,
          requireActiveAccount,
          maxReferralsPerUser:
            maxReferralsPerUser.trim() !== '' ? Number(maxReferralsPerUser) : null,
          dailyReferralCap: Math.max(1, Number(dailyReferralCap || 25)),
          referralRulesText,
        },
        adminUser,
      );
      showToast('Referral bonus & qualification settings updated!', 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save referral settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCreditReferral = async (referredUid: string) => {
    setActingUid(referredUid);
    try {
      await adminManageReferral({
        referredUid,
        action: 'qualify_credit',
        adminUser,
      });
      showToast('Referral qualified and bonus credited cleanly!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not credit referral.', 'error');
    } finally {
      setActingUid(null);
    }
  };

  const handleRejectReferral = async (referredUid: string) => {
    if (rejectionReason.trim().length < 3) {
      showToast('Please enter a rejection reason (min 3 chars).', 'error');
      return;
    }
    setActingUid(referredUid);
    try {
      await adminManageReferral({
        referredUid,
        action: 'reject',
        rejectionReason: rejectionReason.trim(),
        adminUser,
      });
      showToast('Referral marked as rejected and logged.', 'info');
      setRejectingUid(null);
      setRejectionReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reject referral.', 'error');
    } finally {
      setActingUid(null);
    }
  };

  const filteredReferrals = allReferrals.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.maskedUsername.toLowerCase().includes(q) ||
      r.referralCodeUsed.toLowerCase().includes(q) ||
      r.qualificationStatus.toLowerCase().includes(q)
    );
  });

  return (
    <ModalDrawer
      open={open}
      onClose={onClose}
      title="Admin Referral Control Center"
      subtitle="Configure dynamic referral bonuses, qualification thresholds & audit anti-abuse logs"
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#070C24] border border-white/10">
          {(
            [
              { id: 'settings', label: 'Bonus & Rules', icon: Sliders },
              { id: 'review', label: `Referrals (${allReferrals.length})`, icon: Users },
              { id: 'logs', label: `Logs (${referralLogs.length})`, icon: ShieldAlert },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`min-h-[38px] px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                  active
                    ? 'brand-gradient text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'settings' && (
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Referrer Bonus Points (Admin Set)
                </label>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 200 (leave blank if unset)"
                  value={referrerBonusPoints}
                  onChange={(e) => setReferrerBonusPoints(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  New User Welcome Bonus (Optional)
                </label>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 50 (0 or blank = none)"
                  value={newUserBonusPoints}
                  onChange={(e) => setNewUserBonusPoints(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Min Ad Views for Qualification
                </label>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={minimumQualificationAds}
                  onChange={(e) => setMinimumQualificationAds(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Daily Credited Referrals Cap / User
                </label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={dailyReferralCap}
                  onChange={(e) => setDailyReferralCap(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Max Total Referrals Per User (Optional)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="Unlimited if blank"
                  value={maxReferralsPerUser}
                  onChange={(e) => setMaxReferralsPerUser(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between p-3 rounded-xl bg-[#070C24] border border-white/10 cursor-pointer">
                <span className="text-xs font-semibold text-white">Enable Referral Program</span>
                <input
                  type="checkbox"
                  checked={referralEnabled}
                  onChange={(e) => setReferralEnabled(e.target.checked)}
                  className="w-4 h-4 accent-violet-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#070C24] border border-white/10 cursor-pointer">
                <span className="text-xs font-semibold text-white">
                  Require Verified Email to Qualify
                </span>
                <input
                  type="checkbox"
                  checked={requireEmailVerified}
                  onChange={(e) => setRequireEmailVerified(e.target.checked)}
                  className="w-4 h-4 accent-violet-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#070C24] border border-white/10 cursor-pointer">
                <span className="text-xs font-semibold text-white">
                  Require Active Account Status
                </span>
                <input
                  type="checkbox"
                  checked={requireActiveAccount}
                  onChange={(e) => setRequireActiveAccount(e.target.checked)}
                  className="w-4 h-4 accent-violet-500"
                />
              </label>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Referral Qualification Rules Summary
              </label>
              <textarea
                rows={3}
                maxLength={600}
                value={referralRulesText}
                onChange={(e) => setReferralRulesText(e.target.value)}
                className="w-full p-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Configuration...</span>
                </>
              ) : (
                <span>Save Referral Settings</span>
              )}
            </button>
          </form>
        )}

        {tab === 'review' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by username, code, or status..."
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white placeholder:text-slate-500"
              />
            </div>

            {filteredReferrals.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">
                No referral records match your search.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {filteredReferrals.map((refItem) => {
                  const canManage =
                    refItem.rewardStatus !== 'credited' &&
                    refItem.qualificationStatus !== 'rejected';
                  const isBusy = actingUid === refItem.referredUid;
                  return (
                    <div
                      key={refItem.id}
                      className="p-3 rounded-xl bg-[#070C24] border border-white/10 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {refItem.maskedUsername}{' '}
                            <span className="text-[11px] font-mono-num text-amber-300">
                              ({refItem.referralCodeUsed})
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-400">{refItem.joinedDate}</p>
                        </div>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md border ${
                            refItem.qualificationStatus === 'rewarded'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/25'
                              : refItem.qualificationStatus === 'rejected'
                                ? 'bg-rose-500/15 text-rose-300 border-rose-400/25'
                                : 'bg-amber-500/15 text-amber-300 border-amber-400/25'
                          }`}
                        >
                          {refItem.qualificationStatus} · {formatPoints(refItem.rewardPoints)} Pts
                        </span>
                      </div>

                      {refItem.rejectionReason && (
                        <p className="text-[11px] text-rose-300">
                          Reason: {refItem.rejectionReason}
                        </p>
                      )}

                      {canManage && (
                        <div className="space-y-2 pt-1">
                          {rejectingUid === refItem.referredUid ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                placeholder="Reason for rejection..."
                                className="flex-1 h-8 px-2.5 rounded-lg bg-[#0D1433] border border-white/15 text-[11px] text-white"
                              />
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleRejectReferral(refItem.referredUid)}
                                className="h-8 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingUid(null);
                                  setRejectionReason('');
                                }}
                                className="h-8 px-2 rounded-lg bg-white/10 text-slate-300 text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleCreditReferral(refItem.referredUid)}
                                className="flex-1 min-h-[34px] px-2.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                              >
                                {isBusy ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                )}
                                <span>Approve &amp; Credit</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setRejectingUid(refItem.referredUid);
                                  setRejectionReason('');
                                }}
                                className="min-h-[34px] px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-300 text-[11px] font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-400/25 text-[11px] text-sky-200">
              Anti-abuse protection logs self-referrals, duplicate claims &amp; rate-limit events.
              Shared IP addresses are never auto-banned on their own.
            </div>
            {referralLogs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No referral security logs yet.</p>
            ) : (
              referralLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-xl bg-[#070C24] border border-white/10 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">{log.eventType}</span>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        log.severity === 'high'
                          ? 'bg-rose-500/20 text-rose-300'
                          : log.severity === 'medium'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {log.severity}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{log.details}</p>
                  <p className="text-[10px] text-slate-500">{log.createdAtLabel}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </ModalDrawer>
  );
};
