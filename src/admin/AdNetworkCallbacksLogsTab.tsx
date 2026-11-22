import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import {
  AdAnalyticsRecord,
  AdCallbackRecord,
  AdCompletionRecord,
  AdNetworkConfig,
  AdNetworkLogRecord,
  AdSessionRecord,
} from '../types';
import { formatPoints } from '../services/appService';

interface AdNetworkCallbacksLogsTabProps {
  networks: AdNetworkConfig[];
  analytics: AdAnalyticsRecord[];
  callbacks: AdCallbackRecord[];
  networkLogs: AdNetworkLogRecord[];
  adSessions: AdSessionRecord[];
  adCompletions: AdCompletionRecord[];
}

export const AdNetworkCallbacksLogsTab: React.FC<AdNetworkCallbacksLogsTabProps> = ({
  networks,
  analytics,
  callbacks,
  networkLogs,
  adSessions,
  adCompletions,
}) => {
  const [subView, setSubView] = useState<'analytics' | 'callbacks' | 'logs'>('analytics');

  // Combine persisted adAnalytics docs + verified completion/session counts by network (ZERO fabricated numbers)
  const networkPerfRows = useMemo(() => {
    const map = new Map<
      string,
      {
        networkId: string;
        networkName: string;
        impressions: number;
        clicks: number | null;
        clicksSupported: boolean;
        verifiedCompletions: number;
        rejectedCompletions: number;
        totalRewardsDistributed: number;
      }
    >();

    for (const n of networks) {
      map.set(n.networkId, {
        networkId: n.networkId,
        networkName: n.networkName,
        impressions: 0,
        clicks: null,
        clicksSupported: n.clicksSupported,
        verifiedCompletions: 0,
        rejectedCompletions: 0,
        totalRewardsDistributed: 0,
      });
    }

    for (const row of analytics) {
      const key = row.networkId.toLowerCase();
      const existing = map.get(key) ?? {
        networkId: key,
        networkName: row.networkName || row.networkId,
        impressions: 0,
        clicks: null,
        clicksSupported: row.clicksSupported,
        verifiedCompletions: 0,
        rejectedCompletions: 0,
        totalRewardsDistributed: 0,
      };
      existing.impressions += row.impressions;
      existing.verifiedCompletions += row.verifiedCompletions;
      existing.rejectedCompletions += row.rejectedCompletions;
      existing.totalRewardsDistributed += row.totalRewardsDistributed;
      if (row.clicksSupported && typeof row.clicks === 'number') {
        existing.clicksSupported = true;
        existing.clicks = (existing.clicks ?? 0) + row.clicks;
      }
      map.set(key, existing);
    }

    // If analytics collection is empty so far, derive real verified counts from adSessions & adCompletions
    if (analytics.length === 0) {
      for (const s of adSessions) {
        const matchedNet = networks.find(
          (n) =>
            s.adNetwork.toLowerCase().includes(n.networkName.toLowerCase()) ||
            n.networkId === s.adNetwork.toLowerCase(),
        );
        const key = matchedNet?.networkId || s.adNetwork.toLowerCase() || 'other';
        const existing = map.get(key) ?? {
          networkId: key,
          networkName: s.adNetwork || 'Partner Network',
          impressions: 0,
          clicks: null,
          clicksSupported: matchedNet?.clicksSupported ?? false,
          verifiedCompletions: 0,
          rejectedCompletions: 0,
          totalRewardsDistributed: 0,
        };
        existing.impressions += 1;
        if (s.status === 'rejected') existing.rejectedCompletions += 1;
        map.set(key, existing);
      }
      for (const c of adCompletions) {
        const matchedNet = networks.find(
          (n) =>
            c.adNetwork.toLowerCase().includes(n.networkName.toLowerCase()) ||
            n.networkId === c.adNetwork.toLowerCase(),
        );
        const key = matchedNet?.networkId || c.adNetwork.toLowerCase() || 'other';
        const existing = map.get(key) ?? {
          networkId: key,
          networkName: c.adNetwork || 'Partner Network',
          impressions: 0,
          clicks: null,
          clicksSupported: matchedNet?.clicksSupported ?? false,
          verifiedCompletions: 0,
          rejectedCompletions: 0,
          totalRewardsDistributed: 0,
        };
        if (c.status === 'completed') {
          existing.verifiedCompletions += 1;
          existing.totalRewardsDistributed += c.rewardPoints;
        } else {
          existing.rejectedCompletions += 1;
        }
        map.set(key, existing);
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.verifiedCompletions - a.verifiedCompletions || b.impressions - a.impressions,
    );
  }, [networks, analytics, adSessions, adCompletions]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSubView('analytics')}
          className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 ${
            subView === 'analytics'
              ? 'bg-violet-600/25 border-violet-400/40 text-white'
              : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Network Performance Analytics</span>
        </button>

        <button
          type="button"
          onClick={() => setSubView('callbacks')}
          className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 ${
            subView === 'callbacks'
              ? 'bg-violet-600/25 border-violet-400/40 text-white'
              : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
          }`}
        >
          <Webhook className="w-3.5 h-3.5" />
          <span>S2S Callbacks ({callbacks.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubView('logs')}
          className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-2 ${
            subView === 'logs'
              ? 'bg-violet-600/25 border-violet-400/40 text-white'
              : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Ad Network Audit Logs ({networkLogs.length})</span>
        </button>
      </div>

      {subView === 'analytics' && (
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-white">Verified Network Performance</span>
            <span className="text-[11px] text-slate-400">
              Clicks show &quot;Not Available from Provider&quot; unless reported by network API.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Ad Network</th>
                  <th className="py-3.5 px-4 text-right">Total Impressions</th>
                  <th className="py-3.5 px-4 text-right">Total Clicks</th>
                  <th className="py-3.5 px-4 text-right">Verified Completions</th>
                  <th className="py-3.5 px-4 text-right">Rejected Completions</th>
                  <th className="py-3.5 px-4 text-right">Rewards Distributed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {networkPerfRows.map((row) => (
                  <tr key={row.networkId} className="hover:bg-white/[0.025]">
                    <td className="py-3 px-4 font-bold text-white">{row.networkName}</td>
                    <td className="py-3 px-4 text-right font-mono-num text-slate-200">
                      {formatPoints(row.impressions)}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">
                      {row.clicksSupported && row.clicks !== null
                        ? formatPoints(row.clicks)
                        : 'Not Available from Provider'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold text-emerald-300">
                      {formatPoints(row.verifiedCompletions)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num text-rose-300">
                      {formatPoints(row.rejectedCompletions)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold text-violet-300">
                      {formatPoints(row.totalRewardsDistributed)} Pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subView === 'callbacks' && (
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Event / Callback ID</th>
                  <th className="py-3.5 px-4">Network &amp; Session</th>
                  <th className="py-3.5 px-4">Security Checks</th>
                  <th className="py-3.5 px-4 text-right">Reward</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {callbacks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      No S2S postbacks received yet in `adCallbacks`.
                    </td>
                  </tr>
                ) : (
                  callbacks.slice(0, 60).map((cb) => (
                    <tr key={cb.id} className="hover:bg-white/[0.025]">
                      <td className="py-3 px-4 font-mono-num">
                        <p className="text-white font-semibold">{cb.eventId || cb.callbackId}</p>
                        <p className="text-[10px] text-slate-400">User: {cb.userId || '—'}</p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-slate-200">{cb.networkId}</p>
                        <p className="text-[10px] font-mono-num text-slate-400">
                          Sess: {cb.sessionId || '—'}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
                          <span
                            className={`px-1.5 py-0.5 rounded border ${
                              cb.signatureValid
                                ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                                : 'bg-rose-500/15 border-rose-400/30 text-rose-300'
                            }`}
                          >
                            {cb.signatureValid ? 'Sig OK' : 'Bad Sig'}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border ${
                              cb.timestampValid
                                ? 'bg-blue-500/15 border-blue-400/30 text-blue-300'
                                : 'bg-amber-500/15 border-amber-400/30 text-amber-200'
                            }`}
                          >
                            {cb.timestampValid ? 'Time OK' : 'Expired'}
                          </span>
                          {cb.replayDetected && (
                            <span className="px-1.5 py-0.5 rounded border bg-rose-500/15 border-rose-400/30 text-rose-200">
                              Replay Blocked
                            </span>
                          )}
                        </div>
                        {cb.rejectionReason && (
                          <p className="text-[10px] text-rose-300 mt-1">{cb.rejectionReason}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-emerald-300">
                        +{cb.rewardPoints} Pts
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border capitalize ${
                            cb.status === 'processed'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35'
                              : cb.status === 'expired' || cb.status === 'awaiting_duration'
                                ? 'bg-amber-500/15 text-amber-200 border-amber-400/35'
                                : 'bg-rose-500/15 text-rose-300 border-rose-400/35'
                          }`}
                        >
                          {cb.status === 'processed' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : cb.status === 'expired' || cb.status === 'awaiting_duration' ? (
                            <Clock className="w-3 h-3" />
                          ) : (
                            <ShieldAlert className="w-3 h-3" />
                          )}
                          {cb.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono-num text-[11px] text-slate-400">
                        {cb.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subView === 'logs' && (
        <div className="rounded-2xl bg-[#0D1330] border border-white/10 divide-y divide-white/10">
          {networkLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No Ad Network operational logs recorded yet.
            </div>
          ) : (
            networkLogs.slice(0, 60).map((log) => (
              <div key={log.id} className="p-3.5 flex items-start justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5 min-w-0">
                  {log.severity === 'error' ? (
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  ) : log.severity === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className="font-bold text-white">
                      {log.networkId} · <span className="text-violet-300">{log.eventType}</span>
                    </p>
                    <p className="text-slate-300 mt-0.5 break-words">{log.details}</p>
                    {log.actorEmail && (
                      <p className="text-[10px] text-slate-500 mt-0.5">Actor: {log.actorEmail}</p>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-mono-num text-slate-400 shrink-0">
                  {log.createdAtLabel}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
