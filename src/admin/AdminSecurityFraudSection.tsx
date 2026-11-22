import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Eye,
  Gift,
  Lock,
  PauseCircle,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  AdminRole,
  FraudLogRecord,
  FraudReportCategory,
  FraudReportRecord,
  FraudReviewStatus,
  FraudRiskLevel,
  SecurityAuditCategory,
  SecurityAuditLogRecord,
  UserProfile,
} from '../types';
import { hasAdminPermission } from '../services/adminService';
import {
  executeFraudReviewAction,
  FraudReviewActionType,
} from '../services/fraudMonitoringService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminSecurityFraudSectionProps {
  fraudReports: FraudReportRecord[];
  securityAuditLogs: SecurityAuditLogRecord[];
  fraudLogs: FraudLogRecord[];
  users: UserProfile[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

type SecuritySubTab = 'queue' | 'audit' | 'checklist';

const CATEGORY_LABELS: Record<FraudReportCategory, string> = {
  multi_account: 'Suspicious Account',
  ad_reward: 'Ad Reward',
  referral: 'Referral',
  withdrawal: 'Withdrawal',
  auth_security: 'Auth Security',
};

const AUDIT_CATEGORY_LABELS: Record<SecurityAuditCategory, string> = {
  auth: 'Login & Registration',
  wallet: 'Balance & Points',
  ad_reward: 'Ad Rewards',
  withdrawal: 'Withdrawals',
  referral: 'Referrals',
  admin: 'Admin Actions',
  account_restriction: 'Account Restrictions',
  security: 'Security Events',
};

function riskBadgeClass(level: FraudRiskLevel): string {
  if (level === 'high') return 'bg-rose-500/15 text-rose-300 border-rose-400/35';
  if (level === 'medium') return 'bg-amber-500/15 text-amber-300 border-amber-400/35';
  return 'bg-blue-500/15 text-blue-300 border-blue-400/35';
}

function reviewStatusBadgeClass(status: FraudReviewStatus): string {
  switch (status) {
    case 'pending_review':
      return 'bg-amber-500/15 text-amber-200 border-amber-400/35';
    case 'verification_requested':
      return 'bg-violet-500/15 text-violet-200 border-violet-400/35';
    case 'restricted':
      return 'bg-blue-500/15 text-blue-200 border-blue-400/35';
    case 'suspended':
      return 'bg-rose-500/15 text-rose-200 border-rose-400/35';
    case 'restored':
    case 'reviewed':
    default:
      return 'bg-emerald-500/15 text-emerald-200 border-emerald-400/35';
  }
}

export const AdminSecurityFraudSection: React.FC<AdminSecurityFraudSectionProps> = ({
  fraudReports,
  securityAuditLogs,
  fraudLogs,
  users,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const canTakeAction = hasAdminPermission(adminRole, 'manage_users');

  const [tab, setTab] = useState<SecuritySubTab>('queue');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FraudReportCategory>('all');
  const [riskFilter, setRiskFilter] = useState<'all' | FraudRiskLevel>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FraudReviewStatus>('all');
  const [auditCatFilter, setAuditCatFilter] = useState<'all' | SecurityAuditCategory>('all');

  const [selectedReport, setSelectedReport] = useState<FraudReportRecord | null>(null);
  const [confirmActionModal, setConfirmActionModal] = useState<{
    report: FraudReportRecord;
    action: FraudReviewActionType;
    label: string;
    destructive: boolean;
  } | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userMap = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const metrics = useMemo(() => {
    const suspiciousAccounts = fraudReports.filter(
      (r) => r.category === 'multi_account' || r.category === 'auth_security',
    ).length;
    const suspiciousAdRewards = fraudReports.filter((r) => r.category === 'ad_reward').length;
    const suspiciousReferrals = fraudReports.filter((r) => r.category === 'referral').length;
    const suspiciousWithdrawals = fraudReports.filter((r) => r.category === 'withdrawal').length;
    return {
      totalSuspicious: fraudReports.length + fraudLogs.length,
      pendingReview: fraudReports.filter((r) => r.reviewStatus === 'pending_review').length,
      suspiciousAccounts,
      suspiciousAdRewards,
      suspiciousReferrals,
      suspiciousWithdrawals,
      securityEvents: securityAuditLogs.length,
    };
  }, [fraudReports, fraudLogs, securityAuditLogs]);

  const filteredReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fraudReports.filter((r) => {
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (riskFilter !== 'all' && r.riskLevel !== riskFilter) return false;
      if (statusFilter !== 'all' && r.reviewStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        r.reportId.toLowerCase().includes(q) ||
        r.userId.toLowerCase().includes(q) ||
        r.userEmail.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.details.toLowerCase().includes(q) ||
        r.relatedTxId.toLowerCase().includes(q)
      );
    });
  }, [fraudReports, categoryFilter, riskFilter, statusFilter, search]);

  const filteredAuditLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return securityAuditLogs.filter((l) => {
      if (auditCatFilter !== 'all' && l.category !== auditCatFilter) return false;
      if (!q) return true;
      return (
        l.userId.toLowerCase().includes(q) ||
        l.eventType.toLowerCase().includes(q) ||
        l.transactionId.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    });
  }, [securityAuditLogs, auditCatFilter, search]);

  const handleOpenAction = (
    report: FraudReportRecord,
    action: FraudReviewActionType,
    label: string,
    destructive: boolean,
  ) => {
    setConfirmActionModal({ report, action, label, destructive });
    setResolutionNote('');
  };

  const handleExecuteAction = async () => {
    if (!confirmActionModal || !canTakeAction) return;
    setSubmitting(true);
    try {
      await executeFraudReviewAction({
        reportId: confirmActionModal.report.reportId,
        action: confirmActionModal.action,
        resolutionNote,
        adminUser,
      });
      showToast(`${confirmActionModal.label} completed cleanly.`, 'success');
      setConfirmActionModal(null);
      setSelectedReport(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update fraud report.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#0F1733] via-[#0B1026] to-[#080D23] p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-violet-300">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>Phase 11 · Fraud Monitoring & Security Audit</span>
          </div>
          <h2 className="text-xl font-extrabold font-display text-white">
            Risk Scoring, Abuse Prevention & Immutable Security Audit
          </h2>
          <p className="text-xs text-slate-300 max-w-2xl">
            Cumulative Risk Score triage with False-Positive Protection: matching IPs or a single
            signal never auto-ban accounts or deduct verified points without Admin review.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/35 text-xs font-semibold text-amber-200 font-mono-num">
            {metrics.pendingReview} Pending Review
          </span>
        </div>
      </div>

      {/* 6 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {[
          {
            label: 'Total Suspicious Activities',
            value: metrics.totalSuspicious,
            accent: 'from-rose-500/20 to-amber-500/10 border-rose-400/25 text-rose-300',
            icon: ShieldAlert,
          },
          {
            label: 'Suspicious Accounts',
            value: metrics.suspiciousAccounts,
            accent: 'from-violet-500/20 to-indigo-500/10 border-violet-400/25 text-violet-300',
            icon: Users,
          },
          {
            label: 'Suspicious Ad Rewards',
            value: metrics.suspiciousAdRewards,
            accent: 'from-blue-500/20 to-cyan-500/10 border-blue-400/25 text-blue-300',
            icon: Coins,
          },
          {
            label: 'Suspicious Referrals',
            value: metrics.suspiciousReferrals,
            accent: 'from-fuchsia-500/20 to-violet-500/10 border-fuchsia-400/25 text-fuchsia-300',
            icon: Gift,
          },
          {
            label: 'Suspicious Withdrawals',
            value: metrics.suspiciousWithdrawals,
            accent: 'from-amber-500/20 to-orange-500/10 border-amber-400/25 text-amber-300',
            icon: Wallet,
          },
          {
            label: 'Security Events',
            value: metrics.securityEvents,
            accent: 'from-emerald-500/20 to-teal-500/10 border-emerald-400/25 text-emerald-300',
            icon: Activity,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className={`rounded-2xl border bg-gradient-to-br p-4 space-y-2 ${card.accent}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-300 leading-tight">
                  {card.label}
                </span>
                <Icon className="w-4 h-4 shrink-0 opacity-85" />
              </div>
              <p className="text-2xl font-extrabold font-mono-num text-white">{card.value}</p>
            </div>
          );
        })}
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'queue' as const, label: `Fraud Monitoring (${fraudReports.length})` },
            { key: 'audit' as const, label: `Security Audit Log (${securityAuditLogs.length})` },
            { key: 'checklist' as const, label: 'Security Architecture Audit' },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold border transition-colors ${
                tab === item.key
                  ? 'bg-gradient-to-r from-violet-600/30 to-blue-600/25 border-violet-400/45 text-white'
                  : 'bg-[#0B1026]/80 border-white/10 text-slate-300 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab !== 'checklist' && (
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search UID, email, txId, or event..."
              className="w-full min-h-[40px] pl-10 pr-3 rounded-xl bg-[#0B1026] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
            />
          </div>
        )}
      </div>

      {/* TAB 1: FRAUD MONITORING QUEUE */}
      {tab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0B1026]/80 p-3">
            <select
              aria-label="Filter category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | FraudReportCategory)}
              className="min-h-[38px] px-3 rounded-xl bg-[#06091B] border border-white/15 text-xs text-slate-200 focus:outline-none focus:border-violet-400"
            >
              <option value="all">All Categories</option>
              <option value="multi_account">Suspicious Accounts</option>
              <option value="ad_reward">Ad Rewards</option>
              <option value="referral">Referrals</option>
              <option value="withdrawal">Withdrawals</option>
              <option value="auth_security">Auth Security</option>
            </select>

            <select
              aria-label="Filter risk level"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value as 'all' | FraudRiskLevel)}
              className="min-h-[38px] px-3 rounded-xl bg-[#06091B] border border-white/15 text-xs text-slate-200 focus:outline-none focus:border-violet-400"
            >
              <option value="all">All Risk Levels</option>
              <option value="high">High Risk (70–100)</option>
              <option value="medium">Medium Risk (35–69)</option>
              <option value="low">Low Risk (&lt; 35)</option>
            </select>

            <select
              aria-label="Filter review status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | FraudReviewStatus)}
              className="min-h-[38px] px-3 rounded-xl bg-[#06091B] border border-white/15 text-xs text-slate-200 focus:outline-none focus:border-violet-400"
            >
              <option value="all">All Review Statuses</option>
              <option value="pending_review">Pending Review</option>
              <option value="verification_requested">Verification Requested</option>
              <option value="restricted">Temporarily Restricted</option>
              <option value="suspended">Suspended</option>
              <option value="reviewed">Reviewed</option>
              <option value="restored">Restored</option>
            </select>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0B1026]/85 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[920px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4">Risk & Score</th>
                    <th className="py-3 px-4">Category & Activity</th>
                    <th className="py-3 px-4">User Details</th>
                    <th className="py-3 px-4">Review Status</th>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-xs">
                  {filteredReports.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        No fraud alerts match the selected filter. System is healthy.
                      </td>
                    </tr>
                  ) : (
                    filteredReports.map((report) => {
                      const matchedUser = userMap.get(report.userId);
                      const displayEmail = report.userEmail || matchedUser?.email || '—';
                      const displayName = report.userName || matchedUser?.fullName || 'Member';
                      return (
                        <tr key={report.id} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase border ${riskBadgeClass(
                                report.riskLevel,
                              )}`}
                            >
                              {report.riskLevel} · {report.riskScore}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <p className="text-[11px] font-semibold text-violet-300">
                              {CATEGORY_LABELS[report.category]}
                            </p>
                            <p className="font-semibold text-white truncate">{report.title}</p>
                            <p className="text-[11px] text-slate-400 truncate">{report.details}</p>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-200">{displayName}</p>
                            <p className="text-[11px] text-slate-400 truncate">{displayEmail}</p>
                            <p className="text-[10px] font-mono text-slate-500">
                              UID: {report.userId}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize border ${reviewStatusBadgeClass(
                                report.reviewStatus,
                              )}`}
                            >
                              {report.reviewStatus.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono-num text-[11px] text-slate-400">
                            {report.createdAtLabel}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedReport(report)}
                                title="Inspect Alert Details"
                                className="p-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-slate-200"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {canTakeAction && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenAction(
                                        report,
                                        'mark_reviewed',
                                        'Mark as Reviewed',
                                        false,
                                      )
                                    }
                                    title="Mark as Reviewed"
                                    className="p-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenAction(
                                        report,
                                        'request_verification',
                                        'Request Verification',
                                        false,
                                      )
                                    }
                                    title="Request Verification"
                                    className="p-2 rounded-lg border border-violet-400/25 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300"
                                  >
                                    <UserCheck className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenAction(
                                        report,
                                        'temporarily_restrict',
                                        'Temporarily Restrict Account',
                                        true,
                                      )
                                    }
                                    title="Temporarily Restrict Account"
                                    className="p-2 rounded-lg border border-blue-400/25 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300"
                                  >
                                    <Lock className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenAction(
                                        report,
                                        'suspend',
                                        'Suspend Account',
                                        true,
                                      )
                                    }
                                    title="Suspend Account"
                                    className="p-2 rounded-lg border border-rose-400/25 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300"
                                  >
                                    <PauseCircle className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenAction(report, 'restore', 'Restore Account', false)
                                    }
                                    title="Restore Account"
                                    className="p-2 rounded-lg border border-teal-400/25 bg-teal-500/10 hover:bg-teal-500/20 text-teal-300"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
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
          </div>
        </div>
      )}

      {/* TAB 2: IMMUTABLE SECURITY AUDIT LOG */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#0B1026]/80 p-3">
            <select
              aria-label="Filter audit category"
              value={auditCatFilter}
              onChange={(e) => setAuditCatFilter(e.target.value as 'all' | SecurityAuditCategory)}
              className="min-h-[38px] px-3 rounded-xl bg-[#06091B] border border-white/15 text-xs text-slate-200 focus:outline-none focus:border-violet-400"
            >
              <option value="all">All Event Categories</option>
              {Object.entries(AUDIT_CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-slate-400">
              Immutable ledger: Firestore rules forbid client updates and deletions (`allow update,
              delete: if false`).
            </span>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0B1026]/85 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[880px]">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Event Type</th>
                    <th className="py-3 px-4">User ID</th>
                    <th className="py-3 px-4">Transaction ID</th>
                    <th className="py-3 px-4">Severity</th>
                    <th className="py-3 px-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-xs">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        No security audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.slice(0, 120).map((log) => (
                      <tr key={log.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4 font-mono-num text-[11px] text-slate-400">
                          {log.createdAtLabel}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-semibold text-white">
                            {log.eventType}
                          </span>
                          <p className="text-[10px] text-violet-300">
                            {AUDIT_CATEGORY_LABELS[log.category]}
                          </p>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-300">
                          {log.userId}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                          {log.transactionId || '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${
                              log.severity === 'critical' || log.severity === 'high'
                                ? 'bg-rose-500/15 text-rose-300 border-rose-400/35'
                                : log.severity === 'medium'
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-400/35'
                                  : 'bg-slate-500/15 text-slate-300 border-white/15'
                            }`}
                          >
                            {log.severity}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300 max-w-md">{log.details}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: FIREBASE SECURITY AUDIT CHECKLIST */}
      {tab === 'checklist' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            {
              title: 'Firestore Security Rules & Zero-Trust Secrets',
              detail:
                'Default-deny catch-all, strictly server-only wallets/walletLedger/adNetworkSecrets/rateLimits, and immutable audit logs.',
              badge: 'Enforced in Rules',
            },
            {
              title: 'Server-Verified Ad Rewards & Fast-Completion Guard',
              detail:
                'Rewards process exclusively via Cloud Functions S2S/SDK callback with HMAC/secret verification, replay expiry, and <2s completion block.',
              badge: 'Backend Protected',
            },
            {
              title: 'Withdrawal Concurrency Lock & Shared Payout Detection',
              detail:
                'Transactional single active pending withdrawal lock prevents parallel drains; shared payout accounts across UIDs queue for Admin review.',
              badge: 'Atomic Transaction',
            },
            {
              title: 'Rate Limiting & App Check Enforcement Hooks',
              detail:
                'Firestore-backed sliding window rateLimits protect Auth telemetry, Ad Sessions/Callbacks, Referrals, and Withdrawals + verifyIdToken revocation check.',
              badge: 'Active Guard',
            },
            {
              title: 'False Positive Protection Guarantee',
              detail:
                'Shared IP addresses or isolated signals never auto-ban accounts or deduct verified user balances. High risk scores route safely to Admin Review.',
              badge: 'Fairness Policy',
            },
            {
              title: '3-Tier Admin Custom Claims RBAC',
              detail:
                'Super Admin, Admin, and Support Admin roles enforced in both Firebase Auth Custom Claims (`verifyIdToken(..., true)`) and Firestore Security Rules.',
              badge: 'RBAC Verified',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/10 bg-[#0B1026]/85 p-5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold font-display text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{item.title}</span>
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-400/30 text-[10px] font-semibold text-emerald-300 shrink-0">
                  {item.badge}
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* Detail Inspector Modal */}
      {selectedReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-violet-300">
                  {CATEGORY_LABELS[selectedReport.category]} · {selectedReport.reportId}
                </p>
                <h3 className="text-base font-extrabold font-display text-white mt-0.5">
                  {selectedReport.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReport(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-[#06091B]/80 border border-white/10 rounded-xl p-3.5">
              <div>
                <span className="text-slate-400">Risk Score:</span>{' '}
                <strong className="text-white font-mono-num">
                  {selectedReport.riskScore}/100 ({selectedReport.riskLevel.toUpperCase()})
                </strong>
              </div>
              <div>
                <span className="text-slate-400">Status:</span>{' '}
                <strong className="text-white capitalize">
                  {selectedReport.reviewStatus.replace(/_/g, ' ')}
                </strong>
              </div>
              <div>
                <span className="text-slate-400">User ID:</span>{' '}
                <strong className="text-slate-200 font-mono">{selectedReport.userId}</strong>
              </div>
              <div>
                <span className="text-slate-400">Related Tx:</span>{' '}
                <strong className="text-slate-200 font-mono">
                  {selectedReport.relatedTxId || '—'}
                </strong>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Detected Signals
              </p>
              <ul className="space-y-1 text-xs text-slate-200 bg-[#06091B]/60 border border-white/10 rounded-xl p-3">
                {selectedReport.signals.map((sig, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>{sig}</span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{selectedReport.details}</p>

            {canTakeAction && (
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() =>
                    handleOpenAction(selectedReport, 'mark_reviewed', 'Mark as Reviewed', false)
                  }
                  className="min-h-[38px] px-3 rounded-xl border border-emerald-400/30 bg-emerald-500/15 text-xs font-semibold text-emerald-200"
                >
                  Mark Reviewed
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenAction(
                      selectedReport,
                      'request_verification',
                      'Request Verification',
                      false,
                    )
                  }
                  className="min-h-[38px] px-3 rounded-xl border border-violet-400/30 bg-violet-500/15 text-xs font-semibold text-violet-200"
                >
                  Request Verification
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenAction(
                      selectedReport,
                      'temporarily_restrict',
                      'Temporarily Restrict Account',
                      true,
                    )
                  }
                  className="min-h-[38px] px-3 rounded-xl border border-blue-400/30 bg-blue-500/15 text-xs font-semibold text-blue-200"
                >
                  Temporarily Restrict
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenAction(selectedReport, 'suspend', 'Suspend Account', true)
                  }
                  className="min-h-[38px] px-3 rounded-xl border border-rose-400/35 bg-rose-500/20 text-xs font-semibold text-rose-200"
                >
                  Suspend Account
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenAction(selectedReport, 'restore', 'Restore Account', false)
                  }
                  className="min-h-[38px] px-3 rounded-xl border border-teal-400/30 bg-teal-500/15 text-xs font-semibold text-teal-200"
                >
                  Restore Account
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mandatory Confirmation Dialog before Restrict / Suspend / Action */}
      {confirmActionModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmActionModal.destructive
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-400/35'
                    : 'bg-violet-500/20 text-violet-300 border border-violet-400/35'
                }`}
              >
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold font-display text-white">
                  Confirm: {confirmActionModal.label}
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  Target User:{' '}
                  <span className="font-mono text-white">{confirmActionModal.report.userId}</span>{' '}
                  · Risk Score {confirmActionModal.report.riskScore}/100
                </p>
              </div>
            </div>

            {confirmActionModal.destructive && (
              <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                Admin Confirmation Required: This action alters the user&apos;s access status and
                revokes active sessions. Verified wallet points are NOT deducted without proof.
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                Resolution / Audit Note (optional)
              </label>
              <textarea
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Reason or verification instructions recorded in Security Audit Log..."
                className="w-full rounded-xl bg-[#06091B] border border-white/15 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmActionModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleExecuteAction}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-bold text-white ${
                  confirmActionModal.destructive
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'brand-button'
                }`}
              >
                {submitting ? 'Processing...' : `Confirm ${confirmActionModal.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
