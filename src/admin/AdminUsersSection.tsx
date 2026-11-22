import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Eye,
  PauseCircle,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  AccountStatus,
  AdCompletionRecord,
  AdminRole,
  AdSessionRecord,
  EconomyConfig,
  ReferredUser,
  TransactionRecord,
  UserProfile,
  WalletDocRecord,
  WithdrawalRequestRecord,
} from '../types';
import { formatBdt, formatPoints, pointsToBdt } from '../services/appService';
import {
  deleteUserAccountDocBySuperAdmin,
  hasAdminPermission,
  updateUserAccountStatus,
} from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminUsersSectionProps {
  loading: boolean;
  users: UserProfile[];
  wallets: WalletDocRecord[];
  transactions: TransactionRecord[];
  withdrawals: WithdrawalRequestRecord[];
  referrals: ReferredUser[];
  adSessions?: AdSessionRecord[];
  adCompletions?: AdCompletionRecord[];
  economy: EconomyConfig;
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
  onJumpToPoints: (uid: string) => void;
}

const PAGE_SIZE = 12;

export const AdminUsersSection: React.FC<AdminUsersSectionProps> = ({
  loading,
  users,
  wallets,
  transactions,
  withdrawals,
  referrals,
  adSessions = [],
  adCompletions = [],
  economy,
  adminRole,
  adminUser,
  onJumpToPoints,
}) => {
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all');
  const [page, setPage] = useState(1);

  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [detailTab, setDetailTab] = useState<
    'overview' | 'earnings' | 'ad_history' | 'withdrawals' | 'referrals'
  >('overview');

  const [statusModal, setStatusModal] = useState<{
    user: UserProfile;
    targetStatus: AccountStatus;
  } | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);

  const canManageUsers = hasAdminPermission(adminRole, 'manage_users');
  const canDeleteUsers = hasAdminPermission(adminRole, 'delete_users');
  const canAdjustPoints = hasAdminPermission(adminRole, 'adjust_points');

  const walletByUid = useMemo(() => {
    const map = new Map<string, WalletDocRecord>();
    wallets.forEach((w) => map.set(w.userId, w));
    return map;
  }, [wallets]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== 'all' && u.accountStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q) ||
        u.referralCode.toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = filteredUsers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleConfirmStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModal) return;
    setSavingAction(true);
    try {
      await updateUserAccountStatus({
        userId: statusModal.user.uid,
        previousStatus: statusModal.user.accountStatus,
        accountStatus: statusModal.targetStatus,
        reason: statusReason || `Changed status to ${statusModal.targetStatus}`,
        adminUser: { ...adminUser, role: adminRole },
      });
      showToast(
        `${statusModal.user.fullName} updated to ${statusModal.targetStatus}.`,
        'success',
      );
      setStatusModal(null);
      setStatusReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Status update failed.', 'error');
    } finally {
      setSavingAction(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSavingAction(true);
    try {
      await deleteUserAccountDocBySuperAdmin({
        userId: deleteTarget.uid,
        userEmail: deleteTarget.email,
        adminUser: { ...adminUser, role: adminRole },
      });
      showToast(`Deleted user profile ${deleteTarget.email}.`, 'success');
      if (selectedUser?.uid === deleteTarget.uid) {
        setSelectedUser(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'User deletion failed.', 'error');
    } finally {
      setSavingAction(false);
    }
  };

  const selectedWallet = selectedUser ? walletByUid.get(selectedUser.uid) : undefined;
  const selectedUserTx = useMemo(
    () => (selectedUser ? transactions.filter((t) => t.userId === selectedUser.uid) : []),
    [selectedUser, transactions],
  );
  const selectedUserWd = useMemo(
    () => (selectedUser ? withdrawals.filter((w) => w.userId === selectedUser.uid) : []),
    [selectedUser, withdrawals],
  );
  const selectedUserRefs = useMemo(
    () => (selectedUser ? referrals.filter((r) => r.referrerUid === selectedUser.uid) : []),
    [selectedUser, referrals],
  );
  const selectedUserAdHistory = useMemo(() => {
    if (!selectedUser) return [];
    const sessions = adSessions.filter((s) => s.userId === selectedUser.uid);
    const completions = adCompletions.filter((c) => c.userId === selectedUser.uid);
    const merged = [
      ...completions.map((c) => ({
        id: `comp_${c.id}`,
        adName: c.adName,
        adNetwork: c.adNetwork,
        status: c.status,
        points: c.rewardPoints,
        txId: c.transactionId || c.sessionId,
        dateLabel: c.createdAtLabel || c.dhakaDate,
        millis: c.createdAtMillis,
      })),
      ...sessions
        .filter((s) => s.status !== 'completed')
        .map((s) => ({
          id: `sess_${s.id}`,
          adName: s.adName,
          adNetwork: s.adNetwork,
          status: s.status,
          points: 0,
          txId: s.sessionId,
          dateLabel: s.createdAtLabel || s.dhakaDate,
          millis: s.createdAtMillis,
        })),
    ];
    merged.sort((a, b) => b.millis - a.millis);
    return merged;
  }, [selectedUser, adSessions, adCompletions]);

  return (
    <div className="space-y-4">
      {/* Search & Status Filter Bar */}
      <div className="rounded-2xl border border-white/10 bg-[#0B1026]/85 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by Name, Email, Username, UID, Referral Code..."
            className="w-full min-h-[42px] pl-10 pr-4 rounded-xl bg-[#06091B] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'active', 'restricted', 'suspended', 'banned'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setStatusFilter(st);
                setPage(1);
              }}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold capitalize border transition-colors ${
                statusFilter === st
                  ? 'bg-violet-600/25 border-violet-400/45 text-white'
                  : 'bg-[#06091B]/70 border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-2xl border border-white/10 bg-[#0B1026]/85 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Email / Phone</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Available Pts</th>
                <th className="py-3 px-4 text-right">Ad Views</th>
                <th className="py-3 px-4 text-right">Joined</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-xs">
              {loading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={7} className="p-4">
                      <div className="h-8 rounded-lg bg-white/5 animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : pagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No registered users match your current filter.
                  </td>
                </tr>
              ) : (
                pagedUsers.map((u) => {
                  const w = walletByUid.get(u.uid);
                  const pts = w ? w.availablePoints : u.points;
                  return (
                    <tr key={u.uid} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{u.fullName}</div>
                        <div className="text-[11px] font-mono text-slate-400">
                          @{u.username} · {u.uid.slice(0, 8)}...
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-200">{u.email}</div>
                        <div className="text-[11px] font-mono-num text-slate-400">
                          {u.phoneNumber || '—'} ·{' '}
                          <span className={u.emailVerified ? 'text-emerald-400' : 'text-amber-400'}>
                            {u.emailVerified ? 'Verified' : 'Unverified'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize border ${
                            u.accountStatus === 'active'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                              : u.accountStatus === 'restricted'
                                ? 'bg-blue-500/15 text-blue-300 border-blue-400/30'
                                : u.accountStatus === 'suspended'
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-400/30'
                                  : 'bg-rose-500/15 text-rose-300 border-rose-400/30'
                          }`}
                        >
                          {u.accountStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-white">
                        {formatPoints(pts)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-300">
                        {formatPoints(u.totalAdViews)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {u.joinedAt}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(u);
                              setDetailTab('overview');
                            }}
                            title="View Details"
                            className="p-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-slate-200"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          {canAdjustPoints && (
                            <button
                              type="button"
                              onClick={() => onJumpToPoints(u.uid)}
                              title="Adjust Points"
                              className="p-2 rounded-lg border border-violet-400/25 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200"
                            >
                              <Coins className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canManageUsers && u.accountStatus !== 'active' && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusModal({ user: u, targetStatus: 'active' });
                                setStatusReason('');
                              }}
                              title="Activate / Unblock"
                              className="p-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canManageUsers && u.accountStatus === 'active' && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusModal({ user: u, targetStatus: 'suspended' });
                                setStatusReason('');
                              }}
                              title="Suspend User"
                              className="p-2 rounded-lg border border-amber-400/25 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200"
                            >
                              <PauseCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canManageUsers && u.accountStatus !== 'banned' && (
                            <button
                              type="button"
                              onClick={() => {
                                setStatusModal({ user: u, targetStatus: 'banned' });
                                setStatusReason('');
                              }}
                              title="Block / Ban User"
                              className="p-2 rounded-lg border border-rose-400/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canDeleteUsers && u.uid !== adminUser.uid && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(u)}
                              title="Delete User Profile (Super Admin)"
                              className="p-2 rounded-lg border border-rose-500/35 bg-rose-500/15 hover:bg-rose-500/25 text-rose-200"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono-num">
            Showing {pagedUsers.length} of {filteredUsers.length} users
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/[0.03] disabled:opacity-40 inline-flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="font-mono-num text-white">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-[34px] px-2.5 rounded-lg border border-white/10 bg-white/[0.03] disabled:opacity-40 inline-flex items-center gap-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* User Details Modal */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="User Details"
        >
          <div className="w-full max-w-3xl max-h-[90dvh] rounded-2xl border border-white/15 bg-[#0B1026] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-extrabold font-display text-white">
                  {selectedUser.fullName} (@{selectedUser.username})
                </h2>
                <p className="text-xs font-mono text-slate-400">
                  UID: {selectedUser.uid} · Code: {selectedUser.referralCode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 pt-3 border-b border-white/10 flex gap-2 overflow-x-auto">
              {(
                [
                  { id: 'overview', label: 'Overview & Wallet' },
                  { id: 'earnings', label: `Earning History (${selectedUserTx.length})` },
                  { id: 'ad_history', label: `Ad History (${selectedUserAdHistory.length})` },
                  { id: 'withdrawals', label: `Withdrawals (${selectedUserWd.length})` },
                  { id: 'referrals', label: `Referrals (${selectedUserRefs.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setDetailTab(tab.id)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                    detailTab === tab.id
                      ? 'border-violet-400 text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {detailTab === 'overview' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-white/10 bg-[#06091B]/75 p-3.5 space-y-1.5">
                    <p className="text-slate-400">Email</p>
                    <p className="text-white font-semibold">{selectedUser.email}</p>
                    <p className="text-slate-400 pt-1">Phone</p>
                    <p className="text-white font-mono-num">{selectedUser.phoneNumber || '—'}</p>
                    <p className="text-slate-400 pt-1">Status & Verification</p>
                    <p className="text-white capitalize">
                      {selectedUser.accountStatus} ·{' '}
                      {selectedUser.emailVerified ? 'Email Verified' : 'Unverified'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#06091B]/75 p-3.5 space-y-1.5">
                    <p className="text-slate-400">Available Wallet Points</p>
                    <p className="text-lg font-extrabold font-mono-num text-white">
                      {formatPoints(selectedWallet ? selectedWallet.availablePoints : selectedUser.points)}{' '}
                      Pts
                    </p>
                    <p className="text-violet-300 font-mono-num">
                      {formatBdt(
                        pointsToBdt(
                          selectedWallet ? selectedWallet.availablePoints : selectedUser.points,
                          economy.pointsPerBdt,
                        ),
                      )}
                    </p>
                    <div className="pt-1 grid grid-cols-2 gap-2 text-[11px] font-mono-num text-slate-300">
                      <span>Reserved: {formatPoints(selectedWallet?.reservedPoints ?? 0)}</span>
                      <span>
                        Lifetime: {formatPoints(selectedWallet?.totalEarnedPoints ?? selectedUser.totalEarnings)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {detailTab === 'earnings' && (
                <div className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
                  {selectedUserTx.length === 0 ? (
                    <p className="p-6 text-center text-slate-400">No transactions recorded.</p>
                  ) : (
                    selectedUserTx.slice(0, 40).map((t) => (
                      <div key={t.id} className="p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">{t.title}</p>
                          <p className="text-[11px] text-slate-400">
                            {t.description || t.subtitle} · {t.timestamp}
                          </p>
                        </div>
                        <span
                          className={`font-mono-num font-bold ${
                            t.pointsDelta >= 0 ? 'text-emerald-300' : 'text-rose-300'
                          }`}
                        >
                          {t.pointsDelta >= 0 ? '+' : ''}
                          {formatPoints(t.pointsDelta)} Pts
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'ad_history' && (
                <div className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
                  {selectedUserAdHistory.length === 0 ? (
                    <p className="p-6 text-center text-slate-400">No ad views or sessions recorded.</p>
                  ) : (
                    selectedUserAdHistory.slice(0, 50).map((item) => (
                      <div key={item.id} className="p-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">
                            {item.adName} · {item.adNetwork}
                          </p>
                          <p className="text-[11px] font-mono-num text-slate-400 truncate">
                            {item.txId} · {item.dateLabel}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`font-mono-num font-bold ${
                              item.status === 'completed'
                                ? 'text-emerald-300'
                                : item.status === 'rejected'
                                  ? 'text-rose-300'
                                  : 'text-amber-300'
                            }`}
                          >
                            {item.status === 'completed'
                              ? `+${formatPoints(item.points)} Pts`
                              : item.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'withdrawals' && (
                <div className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
                  {selectedUserWd.length === 0 ? (
                    <p className="p-6 text-center text-slate-400">No withdrawals submitted.</p>
                  ) : (
                    selectedUserWd.map((w) => (
                      <div key={w.id} className="p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">
                            {w.methodId.toUpperCase()} · {w.maskedAccountNumber}
                          </p>
                          <p className="text-[11px] font-mono-num text-slate-400">
                            {w.requestId} · {w.requestDateLabel}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono-num font-bold text-white">
                            ৳{w.netBdt.toFixed(2)} ({w.status})
                          </p>
                          <p className="text-[11px] font-mono-num text-slate-400">
                            {formatPoints(w.pointsReserved)} Pts
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'referrals' && (
                <div className="divide-y divide-white/10 border border-white/10 rounded-xl overflow-hidden">
                  {selectedUserRefs.length === 0 ? (
                    <p className="p-6 text-center text-slate-400">No referred users yet.</p>
                  ) : (
                    selectedUserRefs.map((r) => (
                      <div key={r.id} className="p-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">
                            {r.name} (@{r.referredUsername})
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Joined {r.joinedDate} · Status: {r.qualificationStatus}
                          </p>
                        </div>
                        <span className="font-mono-num font-bold text-violet-300">
                          +{formatPoints(r.rewardPoints)} Pts ({r.rewardStatus})
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Status Change Modal */}
      {statusModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmStatusChange}
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4"
          >
            <h3 className="text-base font-bold font-display text-white capitalize">
              Confirm {statusModal.targetStatus} Status
            </h3>
            <p className="text-xs text-slate-300">
              Change <span className="font-semibold text-white">{statusModal.user.fullName}</span> (
              {statusModal.user.email}) from{' '}
              <span className="font-mono">{statusModal.user.accountStatus}</span> to{' '}
              <span className="font-mono text-violet-300">{statusModal.targetStatus}</span>.
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Audit Reason
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Reason recorded in immutable adminLogs..."
                className="w-full min-h-[42px] px-3 rounded-xl bg-[#06091B] border border-white/15 text-xs text-white"
              />
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setStatusModal(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-white/15 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAction}
                className="flex-1 min-h-[42px] rounded-xl brand-button text-xs font-bold text-white disabled:opacity-60"
              >
                {savingAction ? 'Updating...' : 'Confirm Change'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Super Admin Delete User Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-rose-500/35 bg-[#0B1026] p-6 space-y-4">
            <h3 className="text-base font-bold font-display text-rose-300">
              Delete User Profile
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              This removes <span className="font-semibold text-white">{deleteTarget.email}</span>{' '}
              from Firestore `users`. This action is restricted to Super Admin and logged permanently.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 min-h-[42px] rounded-xl border border-white/15 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingAction}
                onClick={handleConfirmDelete}
                className="flex-1 min-h-[42px] rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white disabled:opacity-60"
              >
                {savingAction ? 'Deleting...' : 'Delete Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
