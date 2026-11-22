import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  Search,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  AdminRole,
  UserProfile,
  WithdrawalRequestRecord,
  WithdrawalStatus,
} from '../types';
import { formatBdt, formatPoints } from '../services/appService';
import { adminUpdateWithdrawalStatus } from '../services/dashboardService';
import { hasAdminPermission } from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminWithdrawalsSectionProps {
  withdrawals: WithdrawalRequestRecord[];
  users: UserProfile[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

const STATUS_TABS: Array<{ key: 'all' | WithdrawalStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'processing', label: 'Processing' },
  { key: 'approved', label: 'Approved' },
  { key: 'paid', label: 'Paid' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
];

const STATUS_BADGE: Record<WithdrawalStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-400/35',
  processing: 'bg-blue-500/15 text-blue-300 border-blue-400/35',
  approved: 'bg-violet-500/15 text-violet-300 border-violet-400/35',
  paid: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-400/35',
  cancelled: 'bg-slate-500/15 text-slate-300 border-slate-400/35',
};

const PAGE_SIZE = 12;

export const AdminWithdrawalsSection: React.FC<AdminWithdrawalsSectionProps> = ({
  withdrawals,
  users,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const [statusTab, setStatusTab] = useState<'all' | WithdrawalStatus>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [selectedReq, setSelectedReq] = useState<WithdrawalRequestRecord | null>(null);
  const [actionMode, setActionMode] = useState<'paid' | 'rejected' | null>(null);
  const [payoutTxId, setPayoutTxId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const canManage = hasAdminPermission(adminRole, 'manage_withdrawals');

  const userMap = useMemo(() => {
    const m = new Map<string, UserProfile>();
    users.forEach((u) => m.set(u.uid, u));
    return m;
  }, [users]);

  const countsByStatus = useMemo(() => {
    const counts: Record<'all' | WithdrawalStatus, number> = {
      all: withdrawals.length,
      pending: 0,
      processing: 0,
      approved: 0,
      paid: 0,
      rejected: 0,
      cancelled: 0,
    };
    withdrawals.forEach((w) => {
      counts[w.status] += 1;
    });
    return counts;
  }, [withdrawals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withdrawals.filter((w) => {
      if (statusTab !== 'all' && w.status !== statusTab) return false;
      if (!q) return true;
      const u = userMap.get(w.userId);
      return (
        w.requestId.toLowerCase().includes(q) ||
        w.methodId.toLowerCase().includes(q) ||
        w.accountNumber.toLowerCase().includes(q) ||
        w.payoutTransactionId.toLowerCase().includes(q) ||
        (u?.fullName.toLowerCase().includes(q) ?? false) ||
        (u?.email.toLowerCase().includes(q) ?? false) ||
        w.userId.toLowerCase().includes(q)
      );
    });
  }, [withdrawals, statusTab, search, userMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const runAction = async (
    req: WithdrawalRequestRecord,
    action: 'processing' | 'approved' | 'paid' | 'rejected',
  ) => {
    if (!canManage) {
      showToast('Support Admin is read-only and cannot modify withdrawal statuses.', 'error');
      return;
    }
    if (action === 'paid' && payoutTxId.trim().length < 4) {
      showToast('Enter a valid Payout Transaction ID (min 4 characters).', 'error');
      return;
    }
    if (action === 'rejected' && rejectionReason.trim().length < 3) {
      showToast('Enter a clear rejection reason (min 3 characters).', 'error');
      return;
    }

    setBusyId(req.requestId);
    try {
      await adminUpdateWithdrawalStatus({
        requestId: req.requestId,
        action,
        payoutTransactionId: action === 'paid' ? payoutTxId.trim() : '',
        rejectionReason: action === 'rejected' ? rejectionReason.trim() : '',
        adminUser,
      });
      showToast(
        action === 'paid'
          ? `Withdrawal ${req.requestId} marked Paid.`
          : action === 'rejected'
            ? `Withdrawal ${req.requestId} rejected & ${formatPoints(req.pointsReserved)} Pts refunded.`
            : `Withdrawal ${req.requestId} updated to ${action}.`,
        'success',
      );
      setActionMode(null);
      setPayoutTxId('');
      setRejectionReason('');
      setSelectedReq(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Withdrawal update failed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      {!canManage && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-400/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Support Admin can view withdrawal requests and payout details, while Processing,
            Approval, Paid, and Rejection actions require Admin or Super Admin privileges.
          </span>
        </div>
      )}

      {/* Status Tabs & Search */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setStatusTab(t.key);
                setPage(1);
              }}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 ${
                statusTab === t.key
                  ? 'bg-gradient-to-r from-violet-600/30 to-blue-600/25 border-violet-400/45 text-white'
                  : 'bg-[#070B22] border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              <span>{t.label}</span>
              <span className="px-1.5 py-0.5 rounded bg-white/10 font-mono-num text-[10px]">
                {countsByStatus[t.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by Request ID, user name, email, account number, or Payout Tx ID..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
          />
        </div>
      </div>

      {/* Withdrawals Table */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-3.5 px-4">Request / Date</th>
                <th className="py-3.5 px-4">User</th>
                <th className="py-3.5 px-4">Method &amp; Account</th>
                <th className="py-3.5 px-4 text-right">Points</th>
                <th className="py-3.5 px-4 text-right">Net Payable</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No withdrawal requests match the selected filter.
                  </td>
                </tr>
              ) : (
                paginated.map((req) => {
                  const u = userMap.get(req.userId);
                  const isFinalized = ['paid', 'rejected', 'cancelled'].includes(req.status);
                  const isBusy = busyId === req.requestId;
                  return (
                    <tr key={req.id} className="hover:bg-white/[0.025] transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-mono-num font-bold text-white">{req.requestId}</p>
                        <p className="text-[11px] text-slate-400">{req.requestDateLabel}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-white">{u?.fullName || 'User'}</p>
                        <p className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {u?.email || req.userId}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-200 uppercase">
                          {req.methodId} · <span className="capitalize">{req.accountType}</span>
                        </p>
                        <p className="text-[11px] font-mono-num text-slate-400">
                          {req.accountNumber || req.maskedAccountNumber}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-200">
                        {formatPoints(req.pointsReserved)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <p className="font-mono-num font-bold text-emerald-300">
                          {formatBdt(req.netBdt)}
                        </p>
                        <p className="text-[10px] font-mono-num text-slate-400">
                          Gross {formatBdt(req.grossBdt)} · Fee {formatBdt(req.feeBdt)}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border capitalize ${
                            STATUS_BADGE[req.status]
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedReq(req);
                              setActionMode(null);
                              setPayoutTxId('');
                              setRejectionReason('');
                            }}
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10"
                            title="View Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {!isFinalized && canManage && (
                            <>
                              {req.status === 'pending' && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void runAction(req, 'processing')}
                                  className="px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 text-[11px] font-semibold text-blue-200 disabled:opacity-50"
                                >
                                  Processing
                                </button>
                              )}
                              {(req.status === 'pending' || req.status === 'processing') && (
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => void runAction(req, 'approved')}
                                  className="px-2.5 py-1.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30 text-[11px] font-semibold text-violet-200 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setSelectedReq(req);
                                  setActionMode('paid');
                                  setPayoutTxId('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/30 text-[11px] font-semibold text-emerald-200 disabled:opacity-50"
                              >
                                Paid
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setSelectedReq(req);
                                  setActionMode('rejected');
                                  setRejectionReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-[11px] font-semibold text-rose-200 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing <strong className="text-slate-200">{paginated.length}</strong> of{' '}
            <strong className="text-slate-200">{filtered.length}</strong> requests
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 font-mono-num text-slate-200">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Details & Action Modal */}
      {selectedReq && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#0B1026] border border-white/15 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Wallet className="w-5 h-5 text-violet-400" />
                <div>
                  <h3 className="text-base font-bold font-display text-white">
                    Withdrawal {selectedReq.requestId}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {userMap.get(selectedReq.userId)?.fullName || selectedReq.userId} ·{' '}
                    {userMap.get(selectedReq.userId)?.email || ''}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedReq(null);
                  setActionMode(null);
                }}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-slate-400">Method &amp; Account Type</p>
                  <p className="font-bold text-white uppercase mt-0.5">
                    {selectedReq.methodId} ({selectedReq.accountType})
                  </p>
                </div>
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-slate-400">Account Number</p>
                  <p className="font-mono-num font-bold text-violet-200 mt-0.5 break-all">
                    {selectedReq.accountNumber || selectedReq.maskedAccountNumber}
                  </p>
                </div>
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-slate-400">Points Reserved</p>
                  <p className="font-mono-num font-bold text-white mt-0.5">
                    {formatPoints(selectedReq.pointsReserved)} Pts
                  </p>
                </div>
                <div className="rounded-xl bg-[#070B22] border border-white/10 p-3">
                  <p className="text-slate-400">Net Payable / Fee</p>
                  <p className="font-mono-num font-bold text-emerald-300 mt-0.5">
                    {formatBdt(selectedReq.netBdt)}{' '}
                    <span className="text-slate-400 font-normal">
                      (Gross {formatBdt(selectedReq.grossBdt)} · Fee {formatBdt(selectedReq.feeBdt)})
                    </span>
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-[#070B22] border border-white/10 p-3 space-y-1">
                <p className="text-slate-400">Timeline &amp; References</p>
                <p className="text-slate-200">Requested: {selectedReq.requestDateLabel}</p>
                {selectedReq.processingDateLabel && (
                  <p className="text-slate-300">Updated: {selectedReq.processingDateLabel}</p>
                )}
                {selectedReq.paidAtLabel && (
                  <p className="text-emerald-300">Paid At: {selectedReq.paidAtLabel}</p>
                )}
                {selectedReq.payoutTransactionId && (
                  <p className="font-mono-num text-emerald-300">
                    Payout Tx ID: {selectedReq.payoutTransactionId}
                  </p>
                )}
                {selectedReq.rejectionReason && (
                  <p className="text-rose-300">Rejection Reason: {selectedReq.rejectionReason}</p>
                )}
                {selectedReq.optionalNote && (
                  <p className="text-slate-400">User Note: {selectedReq.optionalNote}</p>
                )}
              </div>

              {!['paid', 'rejected', 'cancelled'].includes(selectedReq.status) && canManage && (
                <div className="space-y-3 pt-2 border-t border-white/10">
                  {actionMode === 'paid' && (
                    <div className="space-y-2 rounded-xl bg-emerald-500/10 border border-emerald-400/30 p-3.5">
                      <label className="block font-semibold text-emerald-200">
                        Enter Verified Payout Transaction ID
                      </label>
                      <input
                        type="text"
                        value={payoutTxId}
                        onChange={(e) => setPayoutTxId(e.target.value)}
                        placeholder="e.g. BKASH9X82K10A"
                        className="w-full h-10 px-3 rounded-lg bg-[#070B22] border border-emerald-400/35 text-xs font-mono-num text-white focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setActionMode(null)}
                          className="px-3 py-1.5 rounded-lg border border-white/15 text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busyId === selectedReq.requestId}
                          onClick={() => void runAction(selectedReq, 'paid')}
                          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {busyId === selectedReq.requestId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>Confirm Mark Paid</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {actionMode === 'rejected' && (
                    <div className="space-y-2 rounded-xl bg-rose-500/10 border border-rose-400/30 p-3.5">
                      <label className="block font-semibold text-rose-200">
                        Rejection Reason (Refunds {formatPoints(selectedReq.pointsReserved)} Pts automatically)
                      </label>
                      <input
                        type="text"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        placeholder="e.g. Invalid bKash Personal number"
                        className="w-full h-10 px-3 rounded-lg bg-[#070B22] border border-rose-400/35 text-xs text-white focus:outline-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setActionMode(null)}
                          className="px-3 py-1.5 rounded-lg border border-white/15 text-slate-300"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busyId === selectedReq.requestId}
                          onClick={() => void runAction(selectedReq, 'rejected')}
                          className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {busyId === selectedReq.requestId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          <span>Confirm Reject &amp; Refund</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {!actionMode && (
                    <div className="flex flex-wrap gap-2">
                      {selectedReq.status === 'pending' && (
                        <button
                          type="button"
                          disabled={busyId === selectedReq.requestId}
                          onClick={() => void runAction(selectedReq, 'processing')}
                          className="min-h-[38px] px-3 rounded-xl bg-blue-500/15 border border-blue-400/30 text-blue-200 font-semibold inline-flex items-center gap-1.5"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Mark Processing</span>
                        </button>
                      )}
                      {(selectedReq.status === 'pending' || selectedReq.status === 'processing') && (
                        <button
                          type="button"
                          disabled={busyId === selectedReq.requestId}
                          onClick={() => void runAction(selectedReq, 'approved')}
                          className="min-h-[38px] px-3 rounded-xl bg-violet-500/15 border border-violet-400/30 text-violet-200 font-semibold"
                        >
                          Approve Request
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setActionMode('paid')}
                        className="min-h-[38px] px-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 font-semibold"
                      >
                        Mark as Paid
                      </button>
                      <button
                        type="button"
                        onClick={() => setActionMode('rejected')}
                        className="min-h-[38px] px-3 rounded-xl bg-rose-500/15 border border-rose-400/30 text-rose-200 font-semibold"
                      >
                        Reject &amp; Refund
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
