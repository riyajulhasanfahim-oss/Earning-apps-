import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  XCircle,
} from 'lucide-react';
import {
  AdminLogRecord,
  PaymentMethodConfig,
  PaymentMethodId,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
  WithdrawalStatus,
} from '../../types';
import { formatBdt, formatPoints } from '../../services/appService';
import {
  adminUpdateWithdrawalStatus,
  savePaymentMethodConfig,
  saveWithdrawalSettingsConfig,
} from '../../services/dashboardService';
import { ModalDrawer } from '../ui/ModalDrawer';
import { useToast } from '../ui/ToastProvider';

interface AdminWithdrawalManagerModalProps {
  open: boolean;
  onClose: () => void;
  requests: WithdrawalRequestRecord[];
  paymentMethods: PaymentMethodConfig[];
  withdrawalSettings: WithdrawalSettingsConfig;
  adminLogs: AdminLogRecord[];
  adminUser: { uid: string; email: string };
}

type ManagerTab = 'requests' | 'methods' | 'rules' | 'logs';

export const AdminWithdrawalManagerModal: React.FC<AdminWithdrawalManagerModalProps> = ({
  open,
  onClose,
  requests,
  paymentMethods,
  withdrawalSettings,
  adminLogs,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<ManagerTab>('requests');
  const [statusFilter, setStatusFilter] = useState<'all' | WithdrawalStatus>('pending');
  const [selectedReq, setSelectedReq] = useState<WithdrawalRequestRecord | null>(null);
  const [payoutTxId, setPayoutTxId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [busyReqId, setBusyReqId] = useState<string | null>(null);

  // Payment methods local editable state
  const [editableMethods, setEditableMethods] = useState<PaymentMethodConfig[]>(paymentMethods);
  const [savingMethodId, setSavingMethodId] = useState<PaymentMethodId | null>(null);

  // Rules local editable state
  const [wdEnabled, setWdEnabled] = useState(withdrawalSettings.withdrawalEnabled);
  const [minPts, setMinPts] = useState(
    withdrawalSettings.minimumWithdrawPoints ? String(withdrawalSettings.minimumWithdrawPoints) : '',
  );
  const [maxBdt, setMaxBdt] = useState(
    withdrawalSettings.maximumWithdrawBdt ? String(withdrawalSettings.maximumWithdrawBdt) : '',
  );
  const [dailyBdt, setDailyBdt] = useState(
    withdrawalSettings.dailyLimitBdt ? String(withdrawalSettings.dailyLimitBdt) : '',
  );
  const [dailyCount, setDailyCount] = useState(String(withdrawalSettings.dailyLimitCount || 3));
  const [monthlyBdt, setMonthlyBdt] = useState(
    withdrawalSettings.monthlyLimitBdt ? String(withdrawalSettings.monthlyLimitBdt) : '',
  );
  const [procLabel, setProcLabel] = useState(withdrawalSettings.processingTimeLabel);
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => {
    setEditableMethods(paymentMethods);
  }, [paymentMethods]);

  useEffect(() => {
    setWdEnabled(withdrawalSettings.withdrawalEnabled);
    setMinPts(
      withdrawalSettings.minimumWithdrawPoints ? String(withdrawalSettings.minimumWithdrawPoints) : '',
    );
    setMaxBdt(
      withdrawalSettings.maximumWithdrawBdt ? String(withdrawalSettings.maximumWithdrawBdt) : '',
    );
    setDailyBdt(withdrawalSettings.dailyLimitBdt ? String(withdrawalSettings.dailyLimitBdt) : '');
    setDailyCount(String(withdrawalSettings.dailyLimitCount || 3));
    setMonthlyBdt(
      withdrawalSettings.monthlyLimitBdt ? String(withdrawalSettings.monthlyLimitBdt) : '',
    );
    setProcLabel(withdrawalSettings.processingTimeLabel);
  }, [withdrawalSettings]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleAdminAction = async (
    req: WithdrawalRequestRecord,
    action: 'processing' | 'approved' | 'paid' | 'rejected',
  ) => {
    setBusyReqId(req.requestId);
    try {
      await adminUpdateWithdrawalStatus({
        requestId: req.requestId,
        action,
        payoutTransactionId: payoutTxId,
        rejectionReason: rejectReason,
        adminUser,
      });
      showToast(`Withdrawal ${req.requestId} marked as ${action.toUpperCase()}.`, 'success');
      setSelectedReq(null);
      setPayoutTxId('');
      setRejectReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Admin update failed.', 'error');
    } finally {
      setBusyReqId(null);
    }
  };

  const handleSaveMethod = async (method: PaymentMethodConfig) => {
    setSavingMethodId(method.id);
    try {
      await savePaymentMethodConfig(method, adminUser);
      showToast(`${method.name} payment channel updated.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update payment method.', 'error');
    } finally {
      setSavingMethodId(null);
    }
  };

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRules(true);
    try {
      await saveWithdrawalSettingsConfig(
        {
          withdrawalEnabled: wdEnabled,
          minimumWithdrawPoints: minPts ? Number(minPts) : null,
          maximumWithdrawBdt: maxBdt ? Number(maxBdt) : null,
          defaultFeePercent: withdrawalSettings.defaultFeePercent,
          dailyLimitBdt: dailyBdt ? Number(dailyBdt) : null,
          dailyLimitCount: Math.max(1, Number(dailyCount) || 3),
          monthlyLimitBdt: monthlyBdt ? Number(monthlyBdt) : null,
          processingTimeLabel: procLabel.trim() || 'Within 24 hours',
          allowedMethods: editableMethods.filter((m) => m.enabled).map((m) => m.id),
        },
        adminUser,
      );
      showToast('Withdrawal rules & limits updated cleanly.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save rules.', 'error');
    } finally {
      setSavingRules(false);
    }
  };

  return (
    <ModalDrawer
      open={open}
      onClose={onClose}
      title="Admin Withdrawal Management"
      subtitle="Manual payout verification, channel toggles, daily/monthly caps & audit logs"
    >
      <div className="space-y-4">
        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#070C24] border border-white/10 overflow-x-auto">
          {[
            { id: 'requests' as ManagerTab, label: `Requests (${requests.length})`, icon: CreditCard },
            { id: 'methods' as ManagerTab, label: 'Methods', icon: RefreshCw },
            { id: 'rules' as ManagerTab, label: 'Rules & Limits', icon: Sliders },
            { id: 'logs' as ManagerTab, label: `Audit Logs (${adminLogs.length})`, icon: ClipboardList },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all ${
                  active ? 'brand-gradient text-white shadow' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* 1. REQUESTS TAB */}
        {tab === 'requests' && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {(['pending', 'processing', 'approved', 'paid', 'rejected', 'all'] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`min-h-[32px] px-3 py-1 rounded-lg text-[11px] font-bold capitalize whitespace-nowrap border transition-colors ${
                      statusFilter === st
                        ? 'bg-violet-600/30 border-violet-400 text-white'
                        : 'bg-white/[0.04] border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    {st}
                  </button>
                ),
              )}
            </div>

            {filteredRequests.length === 0 ? (
              <div className="p-6 rounded-2xl bg-white/[0.03] border border-white/10 text-center text-xs text-slate-400">
                No {statusFilter === 'all' ? '' : statusFilter} withdrawal requests found.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1">
                {filteredRequests.map((req) => {
                  const isFinal = ['paid', 'rejected', 'cancelled'].includes(req.status);
                  const expanded = selectedReq?.requestId === req.requestId;

                  return (
                    <div
                      key={req.requestId}
                      className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-2.5 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-white uppercase">
                              {req.methodId}
                            </span>
                            <span className="text-violet-300 capitalize">
                              ({req.accountType.replace('_', ' ')})
                            </span>
                            <span className="px-2 py-0.5 rounded bg-white/10 text-amber-300 text-[10px] font-bold uppercase">
                              {req.status}
                            </span>
                          </div>
                          <p className="font-mono-num text-slate-200">{req.accountNumber}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            UID: {req.userId} · {req.requestDateLabel}
                          </p>
                        </div>

                        <div className="text-right shrink-0 tabular-nums">
                          <p className="text-sm font-extrabold text-amber-300">
                            {formatBdt(req.netBdt)} Net
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Gross {formatBdt(req.grossBdt)} · {formatPoints(req.pointsReserved)} Pts
                          </p>
                        </div>
                      </div>

                      {req.optionalNote && (
                        <p className="text-[11px] text-slate-300 bg-black/25 rounded-lg px-2.5 py-1.5">
                          User Note: {req.optionalNote}
                        </p>
                      )}

                      {!isFinal && (
                        <div className="pt-2 border-t border-white/10 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            {req.status === 'pending' && (
                              <button
                                type="button"
                                disabled={busyReqId === req.requestId}
                                onClick={() => handleAdminAction(req, 'processing')}
                                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 font-bold"
                              >
                                Set Processing
                              </button>
                            )}
                            {(req.status === 'pending' || req.status === 'processing') && (
                              <button
                                type="button"
                                disabled={busyReqId === req.requestId}
                                onClick={() => handleAdminAction(req, 'approved')}
                                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 font-bold"
                              >
                                Approve
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedReq(expanded ? null : req);
                                setPayoutTxId('');
                                setRejectReason('');
                              }}
                              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-bold"
                            >
                              {expanded ? 'Hide Payout / Reject' : 'Mark Paid / Reject'}
                            </button>
                          </div>

                          {expanded && (
                            <div className="p-3 rounded-xl bg-[#070C24] border border-white/10 space-y-3">
                              <div className="space-y-1.5">
                                <label className="block text-[11px] font-semibold text-emerald-300">
                                  Real Payout Transaction ID (only enter after sending funds)
                                </label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={payoutTxId}
                                    onChange={(e) => setPayoutTxId(e.target.value)}
                                    placeholder="e.g. BKX92840128"
                                    className="flex-1 h-9 px-3 rounded-lg bg-white/[0.06] border border-white/15 text-xs text-white font-mono-num"
                                  />
                                  <button
                                    type="button"
                                    disabled={busyReqId === req.requestId}
                                    onClick={() => handleAdminAction(req, 'paid')}
                                    className="min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                                  >
                                    {busyReqId === req.requestId ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    <span>Mark Paid</span>
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-1.5 pt-2 border-t border-white/10">
                                <label className="block text-[11px] font-semibold text-rose-300">
                                  Reject &amp; Refund Reserved Points (Reason Required)
                                </label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    placeholder="e.g. Invalid/inactive account number"
                                    className="flex-1 h-9 px-3 rounded-lg bg-white/[0.06] border border-white/15 text-xs text-white"
                                  />
                                  <button
                                    type="button"
                                    disabled={busyReqId === req.requestId}
                                    onClick={() => handleAdminAction(req, 'rejected')}
                                    className="min-h-[36px] px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    <span>Reject</span>
                                  </button>
                                </div>
                              </div>
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

        {/* 2. PAYMENT METHODS TAB */}
        {tab === 'methods' && (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {editableMethods.map((method, idx) => (
              <div
                key={method.id}
                className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">
                      {method.name} {method.bengaliName ? `(${method.bengaliName})` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400">Channel ID: {method.id}</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className={method.enabled ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                      {method.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <input
                      type="checkbox"
                      checked={method.enabled}
                      onChange={(e) => {
                        const next = [...editableMethods];
                        next[idx] = { ...method, enabled: e.target.checked };
                        setEditableMethods(next);
                      }}
                      className="w-4 h-4 accent-violet-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Fee (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={50}
                      value={method.feePercent}
                      onChange={(e) => {
                        const next = [...editableMethods];
                        next[idx] = { ...method, feePercent: Number(e.target.value) };
                        setEditableMethods(next);
                      }}
                      className="w-full h-9 px-2.5 rounded-lg bg-[#070C24] border border-white/15 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Min Points (Optional)
                    </label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Global default"
                      value={method.minPoints ?? ''}
                      onChange={(e) => {
                        const next = [...editableMethods];
                        next[idx] = {
                          ...method,
                          minPoints: e.target.value ? Number(e.target.value) : null,
                        };
                        setEditableMethods(next);
                      }}
                      className="w-full h-9 px-2.5 rounded-lg bg-[#070C24] border border-white/15 text-xs text-white"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={savingMethodId === method.id}
                  onClick={() => handleSaveMethod(method)}
                  className="w-full min-h-[36px] rounded-lg bg-violet-600/30 hover:bg-violet-600/45 border border-violet-400/30 text-white font-bold inline-flex items-center justify-center gap-1.5"
                >
                  {savingMethodId === method.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>Save {method.name}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 3. RULES & LIMITS TAB */}
        {tab === 'rules' && (
          <form onSubmit={handleSaveRules} className="space-y-3.5 text-xs">
            <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10 text-white cursor-pointer">
              <span className="font-bold">Global Withdrawals Enabled</span>
              <input
                type="checkbox"
                checked={wdEnabled}
                onChange={(e) => setWdEnabled(e.target.checked)}
                className="w-4 h-4 accent-violet-500"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Minimum Withdraw (Points)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 1000"
                  value={minPts}
                  onChange={(e) => setMinPts(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Maximum Single Withdraw (BDT)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 5000"
                  value={maxBdt}
                  onChange={(e) => setMaxBdt(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Daily Limit (BDT / Day)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="Optional daily cap"
                  value={dailyBdt}
                  onChange={(e) => setDailyBdt(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Daily Request Count Cap
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={dailyCount}
                  onChange={(e) => setDailyCount(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Monthly Limit (BDT / Month)
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="Optional monthly cap"
                  value={monthlyBdt}
                  onChange={(e) => setMonthlyBdt(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Processing Time Info
                </label>
                <input
                  type="text"
                  required
                  value={procLabel}
                  onChange={(e) => setProcLabel(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingRules}
              className="w-full min-h-[44px] rounded-xl brand-button text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {savingRules ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>Save Withdrawal Rules</span>
            </button>
          </form>
        )}

        {/* 4. AUDIT LOGS TAB */}
        {tab === 'logs' && (
          <div className="space-y-2.5 max-h-[55vh] overflow-y-auto pr-1 text-xs">
            {adminLogs.length === 0 ? (
              <div className="p-6 rounded-xl bg-white/[0.03] border border-white/10 text-center text-slate-400">
                No admin withdrawal audit logs recorded yet.
              </div>
            ) : (
              adminLogs.map((log) => (
                <div
                  key={log.logId}
                  className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-violet-300 uppercase">{log.action}</span>
                    <span className="text-[11px] text-slate-400">{log.createdAtLabel}</span>
                  </div>
                  <p className="text-slate-200">{log.details}</p>
                  <p className="text-[10px] font-mono-num text-slate-400">
                    Target: {log.targetId} · By: {log.adminEmail}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/20 flex items-center gap-2 text-[11px] text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Paid status requires verifying real disbursement externally and entering the authentic
            payout Transaction ID.
          </span>
        </div>
      </div>
    </ModalDrawer>
  );
};
