import React, { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  AppPage,
  PaymentMethodId,
  WithdrawalRequestRecord,
  WithdrawalStatus,
} from '../types';
import { formatBdt, formatPoints } from '../services/appService';
import { cancelPendingWithdrawalRequest } from '../services/dashboardService';
import { GlassCard } from '../components/ui/GlassCard';
import {
  BankTransferMark,
  BkashMark,
  NagadMark,
  RocketMark,
} from '../components/icons/BrandAssets';
import { ModalDrawer } from '../components/ui/ModalDrawer';
import { useToast } from '../components/ui/ToastProvider';

interface WithdrawalHistoryPageProps {
  requests: WithdrawalRequestRecord[];
  loading: boolean;
  onNavigate: (page: AppPage) => void;
}

type StatusFilter = 'all' | WithdrawalStatus;

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'processing', label: 'Processing' },
  { id: 'approved', label: 'Approved' },
  { id: 'paid', label: 'Paid' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'cancelled', label: 'Cancelled' },
];

const METHOD_NAMES: Record<PaymentMethodId, string> = {
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  bank: 'Bank Transfer',
};

export const WithdrawalHistoryPage: React.FC<WithdrawalHistoryPageProps> = ({
  requests,
  loading,
  onNavigate,
}) => {
  const { showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [cancelTarget, setCancelTarget] = useState<WithdrawalRequestRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const renderMethodMark = (id: PaymentMethodId) => {
    if (id === 'bkash') return <BkashMark className="w-10 h-10" />;
    if (id === 'nagad') return <NagadMark className="w-10 h-10" />;
    if (id === 'rocket') return <RocketMark className="w-10 h-10" />;
    return <BankTransferMark className="w-10 h-10" />;
  };

  const renderStatus = (status: WithdrawalStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Paid</span>
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-400/25 text-sky-300 text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Approved</span>
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/15 border border-violet-400/25 text-violet-300 text-xs font-bold">
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>Processing</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-400/25 text-rose-300 text-xs font-bold">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Rejected</span>
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-500/15 border border-slate-400/25 text-slate-300 text-xs font-bold">
            <Ban className="w-3.5 h-3.5 shrink-0" />
            <span>Cancelled</span>
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/25 text-amber-300 text-xs font-bold">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Pending</span>
          </span>
        );
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelPendingWithdrawalRequest(cancelTarget.requestId);
      showToast(
        `Request cancelled and ${formatPoints(cancelTarget.pointsReserved)} Pts refunded.`,
        'success',
      );
      setCancelTarget(null);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Unable to cancel pending request.',
        'error',
      );
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse" aria-label="Loading withdrawal history">
        <GlassCard className="p-5 h-24 bg-white/[0.04]">
          <div className="h-5 w-44 rounded bg-white/10" />
        </GlassCard>
        <GlassCard className="p-5 h-44 bg-white/[0.04]">
          <div className="h-5 w-56 rounded bg-white/10" />
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <GlassCard className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-0.5">
          <h2 className="text-base sm:text-lg font-extrabold font-display text-white">
            Withdrawal History
          </h2>
          <p className="text-xs text-slate-400">
            Track status from Pending to Paid, inspect payout IDs, or cancel pending requests.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => onNavigate('withdraw')}
            className="min-h-[42px] px-4 py-2 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>New Withdrawal</span>
          </button>
        </div>
      </GlassCard>

      {/* Filter Tabs */}
      <div
        className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0D1436] border border-white/10 overflow-x-auto"
        role="tablist"
        aria-label="Filter withdrawal history by status"
      >
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                active ? 'brand-gradient text-white shadow' : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Request Cards */}
      {filtered.length === 0 ? (
        <GlassCard className="p-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-400/25 flex items-center justify-center text-violet-300 mx-auto">
            <CreditCard className="w-6 h-6" />
          </div>
          <p className="text-base font-bold text-white">No withdrawal requests found</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {statusFilter === 'all'
              ? 'Once you submit a payout request, its complete audit trail and masked destination appear here.'
              : `You have no withdrawal requests marked as "${statusFilter}".`}
          </p>
          {statusFilter === 'all' && (
            <button
              type="button"
              onClick={() => onNavigate('withdraw')}
              className="min-h-[44px] px-5 py-2 rounded-full brand-button text-white text-xs font-bold"
            >
              Request Withdraw
            </button>
          )}
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => (
            <GlassCard key={req.requestId} className="p-4 sm:p-5 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {renderMethodMark(req.methodId)}
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-extrabold text-white">
                        {METHOD_NAMES[req.methodId]}
                      </h3>
                      <span className="text-xs text-violet-300 capitalize">
                        · {req.accountType.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs font-mono-num text-slate-300">
                      Account: {req.maskedAccountNumber}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  {renderStatus(req.status)}
                  {req.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => setCancelTarget(req)}
                      className="min-h-[34px] px-3 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/30 text-rose-300 text-xs font-bold transition-colors"
                    >
                      Cancel Request
                    </button>
                  )}
                </div>
              </div>

              {/* Financial Breakdown Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-white/10 text-xs tabular-nums">
                <div>
                  <p className="text-slate-400">Requested Amount</p>
                  <p className="font-bold text-white">{formatBdt(req.grossBdt)}</p>
                  <p className="text-[11px] text-slate-400">
                    ({formatPoints(req.pointsReserved)} Pts)
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Fee</p>
                  <p className="font-semibold text-rose-300">-{formatBdt(req.feeBdt)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Net Payable</p>
                  <p className="font-extrabold text-amber-300">{formatBdt(req.netBdt)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Transaction ID</p>
                  <p className="font-mono-num text-sky-300 truncate">
                    {req.payoutTransactionId || req.transactionId}
                  </p>
                </div>
              </div>

              {/* Dates & IDs */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-[11px] text-slate-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono-num">Withdrawal ID: {req.requestId}</span>
                  <span aria-hidden="true">·</span>
                  <span>Requested: {req.requestDateLabel}</span>
                  {req.processingDateLabel && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Processed: {req.processingDateLabel}</span>
                    </>
                  )}
                </div>
                {req.optionalNote && (
                  <span className="text-slate-300 italic truncate max-w-xs">
                    Note: {req.optionalNote}
                  </span>
                )}
              </div>

              {req.status === 'rejected' && req.rejectionReason && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2 text-xs text-rose-200">
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-white">Rejection Reason:</strong> {req.rejectionReason}{' '}
                    ({formatPoints(req.pointsReserved)} Pts refunded to your available balance).
                  </span>
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      <ModalDrawer
        open={Boolean(cancelTarget)}
        onClose={() => !cancelling && setCancelTarget(null)}
        title="Cancel Pending Withdrawal"
        subtitle="Reserved points will return immediately to your Available Balance"
      >
        {cancelTarget && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 text-xs space-y-1.5 tabular-nums">
              <p className="text-slate-300">
                Withdrawal ID:{' '}
                <span className="font-mono-num text-white">{cancelTarget.requestId}</span>
              </p>
              <p className="text-slate-300">
                Refund Amount:{' '}
                <span className="font-bold text-emerald-300">
                  {formatPoints(cancelTarget.pointsReserved)} Points ({formatBdt(cancelTarget.grossBdt)})
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={cancelling}
                onClick={() => setCancelTarget(null)}
                className="flex-1 min-h-[44px] rounded-xl bg-white/[0.08] border border-white/15 text-xs font-bold text-white"
              >
                Keep Request
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleConfirmCancel}
                className="flex-1 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Ban className="w-4 h-4" />
                )}
                <span>Confirm Cancel</span>
              </button>
            </div>
          </div>
        )}
      </ModalDrawer>
    </div>
  );
};
