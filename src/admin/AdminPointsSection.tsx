import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Loader2,
  Search,
  Wallet,
} from 'lucide-react';
import {
  AdminLogRecord,
  AdminRole,
  EconomyConfig,
  TransactionRecord,
  UserProfile,
  WalletDocRecord,
} from '../types';
import { formatBdt, formatPoints, pointsToBdt } from '../services/appService';
import { adminAdjustUserPoints, hasAdminPermission } from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminPointsSectionProps {
  users: UserProfile[];
  wallets: WalletDocRecord[];
  transactions: TransactionRecord[];
  adminLogs: AdminLogRecord[];
  economy: EconomyConfig;
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
  preselectedUid?: string | null;
}

export const AdminPointsSection: React.FC<AdminPointsSectionProps> = ({
  users,
  wallets,
  transactions,
  adminLogs,
  economy,
  adminRole,
  adminUser,
  preselectedUid,
}) => {
  const { showToast } = useToast();
  const [userSearch, setUserSearch] = useState('');
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [mode, setMode] = useState<'credit' | 'debit'>('credit');
  const [amountInput, setAmountInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canAdjust = hasAdminPermission(adminRole, 'adjust_points');

  useEffect(() => {
    if (preselectedUid) {
      setSelectedUid(preselectedUid);
    } else if (!selectedUid && users.length > 0) {
      setSelectedUid(users[0].uid);
    }
  }, [preselectedUid, users, selectedUid]);

  const walletMap = useMemo(() => {
    const m = new Map<string, WalletDocRecord>();
    wallets.forEach((w) => m.set(w.userId, w));
    return m;
  }, [wallets]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 25);
    return users
      .filter(
        (u) =>
          u.fullName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [users, userSearch]);

  const selectedUser = useMemo(
    () => users.find((u) => u.uid === selectedUid) ?? null,
    [users, selectedUid],
  );

  const selectedWallet = selectedUser ? walletMap.get(selectedUser.uid) : undefined;
  const totalPts = selectedWallet?.totalPoints ?? selectedUser?.points ?? 0;
  const availPts = selectedWallet?.availablePoints ?? selectedUser?.points ?? 0;
  const reservedPts = selectedWallet?.reservedPoints ?? 0;
  const lifetimePts = selectedWallet?.totalEarnedPoints ?? selectedUser?.totalEarnings ?? 0;
  const availBdt = pointsToBdt(availPts, economy.pointsPerBdt);

  const parsedAmount = Math.trunc(Number(amountInput || 0));
  const previewBdt =
    parsedAmount > 0 ? pointsToBdt(parsedAmount, economy.pointsPerBdt) : null;

  const userRecentTxs = useMemo(() => {
    if (!selectedUser) return [];
    return transactions.filter((t) => t.userId === selectedUser.uid).slice(0, 8);
  }, [transactions, selectedUser]);

  const recentPointAuditLogs = useMemo(
    () =>
      adminLogs
        .filter((l) => l.action === 'admin_adjust_points')
        .slice(0, 15),
    [adminLogs],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjust) {
      showToast('Support Admin is read-only and cannot adjust user points.', 'error');
      return;
    }
    if (!selectedUser) {
      showToast('Select a target user first.', 'error');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast('Enter a positive integer points amount.', 'error');
      return;
    }
    if (reasonInput.trim().length < 3) {
      showToast('Enter a clear audit reason (minimum 3 characters).', 'error');
      return;
    }
    if (mode === 'debit' && availPts < parsedAmount) {
      showToast(
        `Cannot debit ${formatPoints(parsedAmount)} Pts: user only has ${formatPoints(availPts)} Pts available.`,
        'error',
      );
      return;
    }

    setSubmitting(true);
    try {
      const delta = mode === 'credit' ? parsedAmount : -parsedAmount;
      const res = await adminAdjustUserPoints({
        userId: selectedUser.uid,
        pointsDelta: delta,
        reason: reasonInput.trim(),
        pointsPerBdt: economy.pointsPerBdt,
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
      });
      showToast(
        `${mode === 'credit' ? 'Credited' : 'Deducted'} ${formatPoints(parsedAmount)} Pts (${formatPoints(res.previousPoints)} → ${formatPoints(res.newPoints)} Pts).`,
        'success',
      );
      setAmountInput('');
      setReasonInput('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Points adjustment failed.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: User Selector & Adjustment Form */}
        <div className="xl:col-span-6 rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-5">
          <div>
            <h2 className="text-base font-bold font-display text-white">
              Atomic Points Credit / Deduction
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Every adjustment updates <span className="font-mono-num">wallets</span>,{' '}
              <span className="font-mono-num">walletLedger</span>,{' '}
              <span className="font-mono-num">transactions</span>, user notifications &amp;{' '}
              <span className="font-mono-num">adminLogs</span> atomically.
            </p>
          </div>

          {!canAdjust && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 p-3 flex items-start gap-2.5 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Your current role (<strong>Support Admin</strong>) has read-only wallet inspection
                access. Credit and debit actions require Admin or Super Admin privileges.
              </span>
            </div>
          )}

          {/* User Search & Select */}
          <div className="space-y-2">
            <label htmlFor="pts-user-search" className="block text-xs font-semibold text-slate-300">
              1. Lookup &amp; Select User
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="pts-user-search"
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Filter by name, @username, email or UID..."
                className="w-full h-10 pl-10 pr-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
            </div>

            <select
              aria-label="Target user account"
              value={selectedUid}
              onChange={(e) => setSelectedUid(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white focus:outline-none focus:border-violet-400"
            >
              {filteredUsers.length === 0 ? (
                <option value="">No matching users found</option>
              ) : (
                filteredUsers.map((u) => {
                  const w = walletMap.get(u.uid);
                  const av = w?.availablePoints ?? u.points;
                  return (
                    <option key={u.uid} value={u.uid}>
                      {u.fullName} (@{u.username}) · {u.email} · {formatPoints(av)} Pts
                    </option>
                  );
                })
              )}
            </select>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setMode('credit')}
                disabled={!canAdjust}
                className={`min-h-[44px] rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                  mode === 'credit'
                    ? 'bg-emerald-500/20 border-emerald-400/45 text-emerald-200'
                    : 'bg-[#070B22] border-white/12 text-slate-300 hover:bg-white/5'
                } disabled:opacity-50`}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>Credit (+ Add Points)</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('debit')}
                disabled={!canAdjust}
                className={`min-h-[44px] rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-colors ${
                  mode === 'debit'
                    ? 'bg-rose-500/20 border-rose-400/45 text-rose-200'
                    : 'bg-[#070B22] border-white/12 text-slate-300 hover:bg-white/5'
                } disabled:opacity-50`}
              >
                <ArrowDownRight className="w-4 h-4" />
                <span>Debit (− Deduct Points)</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="pts-amount" className="font-semibold text-slate-300">
                  2. Points Amount
                </label>
                {previewBdt !== null && (
                  <span className="font-mono-num text-violet-300">≈ {formatBdt(previewBdt)}</span>
                )}
              </div>
              <input
                id="pts-amount"
                type="number"
                min={1}
                step={1}
                disabled={!canAdjust || submitting}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="e.g. 500"
                className="w-full h-11 px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm font-mono-num text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 disabled:opacity-50"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="pts-reason" className="block text-xs font-semibold text-slate-300">
                3. Mandatory Audit Reason
              </label>
              <textarea
                id="pts-reason"
                rows={2}
                disabled={!canAdjust || submitting}
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="e.g. Verified missing monetag reward / Reversing duplicate credit"
                className="w-full p-3 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={!canAdjust || !selectedUser || submitting}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Executing Atomic Ledger Update...</span>
                </>
              ) : (
                <>
                  <Coins className="w-4 h-4" />
                  <span>
                    Confirm {mode === 'credit' ? 'Points Credit' : 'Points Deduction'}
                  </span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right: Selected User Live Wallet Snapshot */}
        <div className="xl:col-span-6 rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-5">
          {!selectedUser ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Select a user to inspect live wallet balance and transaction ledger.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-white/10">
                <div>
                  <h3 className="text-base font-bold font-display text-white">
                    {selectedUser.fullName}
                  </h3>
                  <p className="text-xs text-slate-400">
                    @{selectedUser.username} · {selectedUser.email}
                  </p>
                  <p className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                    UID: {selectedUser.uid}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border capitalize ${
                    selectedUser.accountStatus === 'active'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                      : 'bg-rose-500/15 text-rose-300 border-rose-400/30'
                  }`}
                >
                  {selectedUser.accountStatus}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-[11px] text-slate-400">Total Points</p>
                  <p className="text-base font-extrabold font-mono-num text-white mt-0.5">
                    {formatPoints(totalPts)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-[11px] text-slate-400">Available</p>
                  <p className="text-base font-extrabold font-mono-num text-emerald-300 mt-0.5">
                    {formatPoints(availPts)}
                  </p>
                  <p className="text-[10px] font-mono-num text-slate-400">
                    {availBdt !== null ? formatBdt(availBdt) : 'Rate unset'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-[11px] text-slate-400">Reserved</p>
                  <p className="text-base font-extrabold font-mono-num text-amber-300 mt-0.5">
                    {formatPoints(reservedPts)}
                  </p>
                </div>
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-[11px] text-slate-400">Lifetime Earned</p>
                  <p className="text-base font-extrabold font-mono-num text-violet-300 mt-0.5">
                    {formatPoints(lifetimePts)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-violet-400" />
                    <span>Latest User Transactions</span>
                  </p>
                  <span className="text-[11px] text-slate-400">
                    Last {userRecentTxs.length} records
                  </span>
                </div>
                {userRecentTxs.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center bg-[#070B22] rounded-xl border border-white/10">
                    No transactions recorded for this user yet.
                  </p>
                ) : (
                  <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#070B22]">
                    {userRecentTxs.map((tx) => (
                      <div
                        key={tx.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{tx.title}</p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {tx.subtitle || tx.type} · {tx.timestamp}
                          </p>
                        </div>
                        <span
                          className={`font-mono-num font-bold shrink-0 ${
                            tx.pointsDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {tx.pointsDelta >= 0 ? '+' : ''}
                          {formatPoints(tx.pointsDelta)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Points Adjustment Audit Trail */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold font-display text-white">
              Recent Admin Points Adjustment History
            </h3>
            <p className="text-xs text-slate-400">
              Immutable ledger of admin credits and deductions from <span className="font-mono-num">adminLogs</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Audited</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3 px-4">Target User</th>
                <th className="py-3 px-4">Admin</th>
                <th className="py-3 px-4">Balance Change</th>
                <th className="py-3 px-4">Details &amp; Reason</th>
                <th className="py-3 px-4 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {recentPointAuditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    No manual admin points adjustments recorded yet.
                  </td>
                </tr>
              ) : (
                recentPointAuditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-mono-num text-slate-200">{log.targetId}</td>
                    <td className="py-3 px-4 text-slate-300">{log.adminEmail}</td>
                    <td className="py-3 px-4 font-mono-num text-violet-300">
                      {log.previousValue && log.newValue
                        ? `${log.previousValue} → ${log.newValue} Pts`
                        : '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-md truncate">{log.details}</td>
                    <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                      {log.createdAtLabel}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
