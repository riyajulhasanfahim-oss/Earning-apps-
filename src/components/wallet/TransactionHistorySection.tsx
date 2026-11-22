import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gift,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { TransactionRecord, TransactionStatus, TransactionType, WalletLedgerEntry } from '../../types';
import { formatBdt, formatPoints } from '../../services/appService';
import { GlassCard } from '../ui/GlassCard';

interface TransactionHistorySectionProps {
  transactions: TransactionRecord[];
  walletLedger?: WalletLedgerEntry[];
  loading?: boolean;
  pageSize?: number;
  title?: string;
}

type FilterOption =
  | 'all'
  | 'credits'
  | 'debits'
  | 'pending'
  | 'completed'
  | 'rejected';

const FILTER_TABS: Array<{ id: FilterOption; label: string }> = [
  { id: 'all', label: 'All Transactions' },
  { id: 'credits', label: 'Credits' },
  { id: 'debits', label: 'Debits' },
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Completed' },
  { id: 'rejected', label: 'Rejected' },
];

const TYPE_LABELS: Record<TransactionType, string> = {
  ad_reward: 'Ad Reward',
  daily_bonus: 'Daily Bonus',
  referral_bonus: 'Referral Bonus',
  withdrawal: 'Withdrawal',
  admin_credit: 'Bonus Credit',
  admin_debit: 'Balance Debit',
  refund: 'Refund',
  admin_adjustment: 'Balance Adjustment',
};

export const TransactionHistorySection: React.FC<TransactionHistorySectionProps> = ({
  transactions,
  walletLedger = [],
  loading = false,
  pageSize = 10,
  title = 'Transaction History',
}) => {
  const [viewMode, setViewMode] = useState<'transactions' | 'ledger'>('transactions');
  const [filter, setFilter] = useState<FilterOption>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | TransactionType>('all');
  const [dateFilter, setDateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (filter === 'credits' && tx.direction !== 'credit') return false;
      if (filter === 'debits' && tx.direction !== 'debit') return false;
      if (filter === 'pending' && tx.status !== 'pending') return false;
      if (filter === 'completed' && tx.status !== 'completed') return false;
      if (filter === 'rejected' && tx.status !== 'rejected' && tx.status !== 'reversed')
        return false;

      if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
      if (dateFilter && tx.dhakaDate !== dateFilter) return false;

      if (q) {
        const hay = [
          tx.transactionId,
          tx.title,
          tx.description,
          tx.subtitle,
          TYPE_LABELS[tx.type],
          tx.status,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [transactions, filter, typeFilter, dateFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedTx = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase();
    return walletLedger.filter((entry) => {
      if (filter === 'credits' && entry.pointsDelta < 0) return false;
      if (filter === 'debits' && entry.pointsDelta >= 0) return false;
      if (filter === 'pending' && entry.status !== 'pending') return false;
      if (filter === 'completed' && entry.status !== 'completed') return false;
      if (filter === 'rejected' && entry.status !== 'rejected' && entry.status !== 'reversed')
        return false;
      if (q) {
        const hay = `${entry.transactionId} ${entry.entryId} ${entry.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [walletLedger, filter, search]);

  const ledgerTotalPages = Math.max(1, Math.ceil(filteredLedger.length / pageSize));
  const safeLedgerPage = Math.min(page, ledgerTotalPages);
  const paginatedLedger = filteredLedger.slice(
    (safeLedgerPage - 1) * pageSize,
    safeLedgerPage * pageSize,
  );

  const handleFilterChange = (next: FilterOption) => {
    setFilter(next);
    setPage(1);
  };

  const renderIcon = (type: TransactionType, isCredit: boolean) => {
    if (type === 'admin_adjustment' || type === 'admin_credit' || type === 'admin_debit') {
      return <SlidersHorizontal className="w-4 h-4" />;
    }
    if (type === 'refund') return <RotateCcw className="w-4 h-4" />;
    if (type === 'daily_bonus') return <Gift className="w-4 h-4" />;
    if (type === 'referral_bonus') return <Users className="w-4 h-4" />;
    return isCredit ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />;
  };

  const renderStatus = (status: TransactionStatus) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Completed</span>
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>Pending</span>
        </span>
      );
    }
    if (status === 'reversed') {
      return (
        <span className="inline-flex items-center gap-1 text-sky-300 font-semibold">
          <RotateCcw className="w-3.5 h-3.5 shrink-0" />
          <span>Reversed</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-rose-400 font-semibold">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        <span>Rejected</span>
      </span>
    );
  };

  const resetFilters = () => {
    setFilter('all');
    setTypeFilter('all');
    setDateFilter('');
    setSearch('');
    setPage(1);
  };

  if (loading) {
    return (
      <GlassCard className="p-5 space-y-3 animate-pulse" aria-label="Loading transactions">
        <div className="h-5 w-44 rounded bg-white/15" />
        <div className="h-14 rounded-xl bg-white/10" />
        <div className="h-14 rounded-xl bg-white/10" />
        <div className="h-14 rounded-xl bg-white/10" />
      </GlassCard>
    );
  }

  return (
    <section className="space-y-4" aria-label={title}>
      {/* Header & Ledger Mode Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold font-display text-white">{title}</h2>
          <p className="text-xs text-slate-400">
            Historical conversion rate and BDT value are permanently locked per transaction.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#0D1436] border border-white/10 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setViewMode('transactions');
              setPage(1);
            }}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
              viewMode === 'transactions'
                ? 'brand-gradient text-white shadow'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Transactions ({transactions.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('ledger');
              setPage(1);
            }}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
              viewMode === 'ledger'
                ? 'brand-gradient text-white shadow'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Wallet Ledger ({walletLedger.length})
          </button>
        </div>
      </div>

      {/* Search, Type & Date Controls */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="relative md:col-span-5">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search ID, description, type..."
            aria-label="Search transactions"
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#0D1436] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
          />
        </div>

        <div className="md:col-span-3">
          <select
            aria-label="Filter by transaction type"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value as 'all' | TransactionType);
              setPage(1);
            }}
            className="w-full h-11 px-3 rounded-xl bg-[#0D1436] border border-white/15 text-xs sm:text-sm text-white focus:outline-none focus:border-violet-400"
          >
            <option value="all">All Types</option>
            <option value="ad_reward">Ad Reward</option>
            <option value="daily_bonus">Daily Bonus</option>
            <option value="referral_bonus">Referral Bonus</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="admin_credit">Bonus Credit</option>
            <option value="admin_debit">Balance Debit</option>
            <option value="refund">Refund</option>
          </select>
        </div>

        <div className="relative md:col-span-4 flex items-center gap-2">
          <div className="relative flex-1">
            <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="date"
              aria-label="Filter by date"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-11 pl-10 pr-3 rounded-xl bg-[#0D1436] border border-white/15 text-xs sm:text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>
          {dateFilter && (
            <button
              type="button"
              onClick={() => {
                setDateFilter('');
                setPage(1);
              }}
              aria-label="Clear date filter"
              className="min-h-[44px] min-w-[44px] rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 flex items-center justify-center text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category & Status Filter Bar */}
      <div
        className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0D1436] border border-white/10 overflow-x-auto"
        role="tablist"
        aria-label="Filter transactions by status and direction"
      >
        {FILTER_TABS.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleFilterChange(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                active
                  ? 'brand-gradient text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TRANSACTIONS VIEW */}
      {viewMode === 'transactions' ? (
        transactions.length === 0 ? (
          <GlassCard className="p-8 text-center space-y-2">
            <p className="text-base font-bold text-white">No transactions yet</p>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Verified Ad Rewards, Daily Bonuses, Referral Bonuses, Withdrawals, Account Adjustments,
              and Refunds will be permanently recorded here.
            </p>
          </GlassCard>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-8 text-center space-y-3">
            <p className="text-base font-bold text-white">No matching transactions</p>
            <p className="text-xs text-slate-400">
              Try clearing your search, date filter, or switching back to All Transactions.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="min-h-[44px] px-5 py-2 rounded-full brand-button text-white text-xs font-bold"
            >
              Reset Filters
            </button>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            <GlassCard className="divide-y divide-white/10">
              {paginatedTx.map((tx) => {
                const isCredit = tx.direction === 'credit' || tx.pointsDelta >= 0;
                return (
                  <div
                    key={tx.id}
                    className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          isCredit
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/20'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-400/20'
                        }`}
                      >
                        {renderIcon(tx.type, isCredit)}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap text-sm font-bold text-white">
                          <span className="truncate">{tx.title}</span>
                          <span className="text-xs font-medium text-violet-300">
                            · {TYPE_LABELS[tx.type]}
                          </span>
                        </div>
                        {(tx.description || tx.subtitle) && (
                          <p className="text-xs text-slate-300 truncate">
                            {tx.description || tx.subtitle}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">
                          <span className="font-mono-num">ID: {tx.transactionId}</span>
                          <span aria-hidden="true">·</span>
                          <span>{tx.timestamp}</span>
                          <span aria-hidden="true">·</span>
                          {renderStatus(tx.status)}
                        </div>
                      </div>
                    </div>

                    <div className="text-left sm:text-right shrink-0 tabular-nums space-y-0.5 pl-13 sm:pl-0">
                      <p
                        className={`text-sm sm:text-base font-extrabold ${
                          isCredit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isCredit ? '+' : '-'}
                        {formatPoints(Math.abs(tx.pointsDelta))} Pts
                      </p>
                      <p className="text-xs font-semibold text-amber-300">
                        {tx.bdtAmount !== null ? formatBdt(Math.abs(tx.bdtAmount)) : 'Rate Unset'}
                      </p>
                      {tx.conversionRateUsed !== null && (
                        <p className="text-[10px] text-slate-400">
                          Rate: {tx.conversionRateUsed} Pts/৳
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </GlassCard>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-400 tabular-nums">
                  Page {safePage} of {totalPages} · {filtered.length} total
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="min-h-[38px] px-3 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="min-h-[38px] px-3 rounded-xl bg-white/[0.06] hover:bg-white/10 border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      ) : filteredLedger.length === 0 ? (
        <GlassCard className="p-8 text-center space-y-2">
          <p className="text-base font-bold text-white">No wallet ledger entries yet</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Every server-verified credit, debit, and withdrawal reservation logs exact previous and
            new balance snapshots here.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          <GlassCard className="divide-y divide-white/10">
            {paginatedLedger.map((entry) => {
              const isPositive = entry.pointsDelta >= 0;
              return (
                <div
                  key={entry.entryId}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-xs sm:text-sm font-bold text-white">
                      <span className="capitalize">{entry.entryType}</span>
                      <span className="text-slate-400">·</span>
                      <span className="text-violet-300">{TYPE_LABELS[entry.transactionType]}</span>
                      <span className="text-slate-400">·</span>
                      {renderStatus(entry.status)}
                    </div>
                    <p className="text-xs text-slate-300 truncate">{entry.description}</p>
                    <p className="text-[11px] font-mono-num text-slate-400">
                      Tx: {entry.transactionId} · Balance: {formatPoints(entry.previousPoints)} →{' '}
                      <span className="text-white font-semibold">
                        {formatPoints(entry.newPoints)} Pts
                      </span>
                      {entry.newReservedPoints !== entry.previousReservedPoints && (
                        <span>
                          {' '}
                          · Reserved: {formatPoints(entry.previousReservedPoints)} →{' '}
                          {formatPoints(entry.newReservedPoints)}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0 tabular-nums">
                    <p
                      className={`text-sm font-extrabold ${
                        isPositive ? 'text-emerald-400' : 'text-amber-300'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {formatPoints(entry.pointsDelta)} Pts
                    </p>
                    <p className="text-[11px] text-slate-400">{entry.createdAtLabel}</p>
                  </div>
                </div>
              );
            })}
          </GlassCard>

          {ledgerTotalPages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-400 tabular-nums">
                Page {safeLedgerPage} of {ledgerTotalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeLedgerPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="min-h-[38px] px-3 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-1 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Prev</span>
                </button>
                <button
                  type="button"
                  disabled={safeLedgerPage >= ledgerTotalPages}
                  onClick={() => setPage((p) => Math.min(ledgerTotalPages, p + 1))}
                  className="min-h-[38px] px-3 rounded-xl bg-white/[0.06] border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-1 disabled:opacity-40"
                >
                  <span>Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
