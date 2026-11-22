import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, History, ShieldAlert } from 'lucide-react';
import {
  AdCompletionRecord,
  AdHistoryFilter,
  AdHistoryItem,
  AdSessionRecord,
  AppPage,
} from '../types';
import { formatPoints } from '../services/appService';
import { GlassCard } from '../components/ui/GlassCard';

interface AdHistoryPageProps {
  adCompletions: AdCompletionRecord[];
  adSessions: AdSessionRecord[];
  onNavigate: (page: AppPage) => void;
}

const FILTER_TABS: Array<{ id: AdHistoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'pending', label: 'Pending' },
  { id: 'rejected', label: 'Rejected' },
];

export const AdHistoryPage: React.FC<AdHistoryPageProps> = ({
  adCompletions,
  adSessions,
  onNavigate,
}) => {
  const [filter, setFilter] = useState<AdHistoryFilter>('all');

  const historyItems = useMemo<AdHistoryItem[]>(() => {
    const bySessionId = new Map<string, AdHistoryItem>();

    for (const comp of adCompletions) {
      bySessionId.set(comp.sessionId || comp.completionId, {
        id: comp.completionId,
        adId: comp.adId,
        adName: comp.adName,
        adNetwork: comp.adNetwork,
        watchedDate: comp.createdAtLabel,
        dhakaDate: comp.dhakaDate,
        rewardPoints: comp.rewardPoints,
        status: comp.status,
        transactionId: comp.transactionId || comp.providerTxId,
        createdAtMillis: comp.createdAtMillis,
      });
    }

    for (const sess of adSessions) {
      if (bySessionId.has(sess.sessionId)) continue;
      bySessionId.set(sess.sessionId, {
        id: sess.sessionId,
        adId: sess.adId,
        adName: sess.adName,
        adNetwork: sess.adNetwork,
        watchedDate: sess.createdAtLabel,
        dhakaDate: sess.dhakaDate,
        rewardPoints: sess.expectedRewardPoints,
        status: sess.status,
        transactionId: sess.transactionId || 'Awaiting Verification',
        rejectionReason: sess.rejectionReason,
        createdAtMillis: sess.createdAtMillis,
      });
    }

    const list = Array.from(bySessionId.values());
    list.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
    return list;
  }, [adCompletions, adSessions]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return historyItems;
    return historyItems.filter((item) => item.status === filter);
  }, [historyItems, filter]);

  const renderStatusBadge = (status: AdHistoryItem['status']) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Completed</span>
        </span>
      );
    }
    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-400">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Rejected</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-300">
        <Clock className="w-3.5 h-3.5" />
        <span>Pending</span>
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <GlassCard variant="gradient" className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center text-white shrink-0">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold font-display text-white">
              Ad Watching History
            </h2>
            <p className="text-xs text-violet-100/90">
              Verified partner callbacks, pending sessions, and unique transaction IDs
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('earn')}
          className="min-h-[40px] px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 text-xs font-bold text-white inline-flex items-center gap-1.5 self-start sm:self-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Watch Ads</span>
        </button>
      </GlassCard>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {FILTER_TABS.map((t) => {
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                active
                  ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                  : 'glass-card text-slate-300 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* History Table / List */}
      <GlassCard className="divide-y divide-white/10">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center space-y-1.5">
            <p className="text-sm font-bold text-white">No ad sessions recorded for this filter</p>
            <p className="text-xs text-slate-400">
              Start watching an active advertisement to track verification status and rewards here.
            </p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-white truncate">
                    {item.adName}
                  </h3>
                  {renderStatusBadge(item.status)}
                </div>
                <p className="text-xs text-slate-300">
                  {item.adNetwork} · Watched: {item.watchedDate}
                </p>
                <p className="text-[11px] font-mono-num text-slate-400 truncate">
                  Tx ID: {item.transactionId}
                </p>
                {item.rejectionReason && (
                  <p className="text-xs text-rose-300">{item.rejectionReason}</p>
                )}
              </div>

              <div className="text-left sm:text-right shrink-0 tabular-nums">
                <p
                  className={`text-base font-extrabold font-display ${
                    item.status === 'completed'
                      ? 'text-emerald-400'
                      : item.status === 'rejected'
                        ? 'text-rose-400'
                        : 'text-amber-300'
                  }`}
                >
                  {item.status === 'completed' ? '+' : ''}
                  {formatPoints(item.rewardPoints)} Pts
                </p>
                <p className="text-[11px] text-slate-400">{item.dhakaDate}</p>
              </div>
            </div>
          ))
        )}
      </GlassCard>
    </div>
  );
};
