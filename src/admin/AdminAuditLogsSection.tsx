import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Lock,
  Scale,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  AdminLogRecord,
  FailedTransactionLogRecord,
  FraudLogRecord,
  ReconciliationReportRecord,
  SystemErrorRecord,
} from '../types';

interface AdminAuditLogsSectionProps {
  adminLogs: AdminLogRecord[];
  fraudLogs: FraudLogRecord[];
  systemErrors: SystemErrorRecord[];
  failedTxLogs: FailedTransactionLogRecord[];
  reconciliationReports: ReconciliationReportRecord[];
}

type AuditTab = 'admin' | 'fraud' | 'errors' | 'failed_tx' | 'reconciliation';

const PAGE_SIZE = 15;

export const AdminAuditLogsSection: React.FC<AdminAuditLogsSectionProps> = ({
  adminLogs,
  fraudLogs,
  systemErrors,
  failedTxLogs,
  reconciliationReports,
}) => {
  const [tab, setTab] = useState<AuditTab>('admin');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = search.trim().toLowerCase();

  const filteredAdmin = useMemo(
    () =>
      adminLogs.filter(
        (l) =>
          !q ||
          l.action.toLowerCase().includes(q) ||
          l.adminEmail.toLowerCase().includes(q) ||
          l.targetId.toLowerCase().includes(q) ||
          l.details.toLowerCase().includes(q),
      ),
    [adminLogs, q],
  );

  const filteredFraud = useMemo(
    () =>
      fraudLogs.filter(
        (f) =>
          !q ||
          f.reason.toLowerCase().includes(q) ||
          f.userId.toLowerCase().includes(q) ||
          f.details.toLowerCase().includes(q),
      ),
    [fraudLogs, q],
  );

  const filteredErrors = useMemo(
    () =>
      systemErrors.filter(
        (e) =>
          !q ||
          e.operation.toLowerCase().includes(q) ||
          e.message.toLowerCase().includes(q) ||
          e.source.toLowerCase().includes(q),
      ),
    [systemErrors, q],
  );

  const filteredFailedTx = useMemo(
    () =>
      failedTxLogs.filter(
        (ft) =>
          !q ||
          ft.operation.toLowerCase().includes(q) ||
          ft.errorCode.toLowerCase().includes(q) ||
          ft.details.toLowerCase().includes(q) ||
          ft.userId.toLowerCase().includes(q),
      ),
    [failedTxLogs, q],
  );

  const filteredReconcile = useMemo(
    () =>
      reconciliationReports.filter(
        (r) =>
          !q ||
          r.userId.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q) ||
          r.details.toLowerCase().includes(q),
      ),
    [reconciliationReports, q],
  );

  const activeCount =
    tab === 'admin'
      ? filteredAdmin.length
      : tab === 'fraud'
        ? filteredFraud.length
        : tab === 'errors'
          ? filteredErrors.length
          : tab === 'failed_tx'
            ? filteredFailedTx.length
            : filteredReconcile.length;

  const totalPages = Math.max(1, Math.ceil(activeCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-violet-500/10 border border-violet-400/25 p-3.5 flex items-center gap-2.5 text-xs text-violet-200">
        <Lock className="w-4 h-4 shrink-0 text-violet-300" />
        <span>
          <strong>Immutable Audit Protection:</strong> Updates and deletions are permanently
          blocked in <span className="font-mono-num">firestore.rules</span> for{' '}
          <span className="font-mono-num">adminLogs</span>,{' '}
          <span className="font-mono-num">failedTransactionLogs</span>,{' '}
          <span className="font-mono-num">reconciliationReports</span>, and{' '}
          <span className="font-mono-num">systemErrors</span> — even for Super Admin.
        </span>
      </div>

      {/* Tabs & Search */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'admin' as AuditTab, label: `Admin Audit Logs (${adminLogs.length})`, icon: Activity },
            { key: 'fraud' as AuditTab, label: `Fraud Alerts (${fraudLogs.length})`, icon: ShieldAlert },
            { key: 'errors' as AuditTab, label: `System Errors (${systemErrors.length})`, icon: AlertOctagon },
            { key: 'failed_tx' as AuditTab, label: `Failed Transactions (${failedTxLogs.length})`, icon: FileWarning },
            { key: 'reconciliation' as AuditTab, label: `Wallet Reconciliation (${reconciliationReports.length})`, icon: Scale },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
                className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors ${
                  tab === t.key
                    ? 'bg-gradient-to-r from-violet-600/30 to-blue-600/25 border-violet-400/45 text-white'
                    : 'bg-[#070B22] border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
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
            placeholder="Filter logs by admin email, user ID, action, or details..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
          />
        </div>
      </div>

      {/* Log Tables */}
      <div className="rounded-2xl bg-[#0D1330] border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'admin' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Admin &amp; Role</th>
                  <th className="py-3.5 px-4">Action</th>
                  <th className="py-3.5 px-4">Target ID</th>
                  <th className="py-3.5 px-4">Previous → New</th>
                  <th className="py-3.5 px-4">Details &amp; Metadata</th>
                  <th className="py-3.5 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredAdmin.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No admin audit logs recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredAdmin.slice(startIdx, startIdx + PAGE_SIZE).map((l) => (
                    <tr key={l.id} className="hover:bg-white/[0.02]">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-white">{l.adminEmail}</p>
                        {l.adminRole && (
                          <span className="text-[10px] font-mono-num text-violet-300">
                            {l.adminRole}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-blue-300">{l.action}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-300">{l.targetId}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-300">
                        {l.previousValue || l.newValue
                          ? `${l.previousValue ?? '—'} → ${l.newValue ?? '—'}`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 max-w-sm">
                        <p className="text-slate-200 truncate">{l.details}</p>
                        {l.metadata && (
                          <p className="text-[10px] font-mono-num text-slate-500 truncate">
                            {l.metadata}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {l.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'fraud' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">User ID</th>
                  <th className="py-3.5 px-4">Reason</th>
                  <th className="py-3.5 px-4">Severity</th>
                  <th className="py-3.5 px-4">Details</th>
                  <th className="py-3.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredFraud.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No fraud alerts recorded.
                    </td>
                  </tr>
                ) : (
                  filteredFraud.slice(startIdx, startIdx + PAGE_SIZE).map((f) => (
                    <tr key={f.id}>
                      <td className="py-3 px-4 font-mono-num text-white">{f.userId}</td>
                      <td className="py-3 px-4 font-semibold text-rose-200">{f.reason}</td>
                      <td className="py-3 px-4 uppercase font-bold text-amber-300">{f.severity}</td>
                      <td className="py-3 px-4 text-slate-300">{f.details}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {f.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'errors' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Source / Operation</th>
                  <th className="py-3.5 px-4">Severity</th>
                  <th className="py-3.5 px-4">Message</th>
                  <th className="py-3.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredErrors.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-400">
                      No system errors logged.
                    </td>
                  </tr>
                ) : (
                  filteredErrors.slice(startIdx, startIdx + PAGE_SIZE).map((e) => (
                    <tr key={e.id}>
                      <td className="py-3 px-4">
                        <p className="font-bold text-white">{e.operation}</p>
                        <p className="text-[11px] font-mono-num text-slate-400">{e.source}</p>
                      </td>
                      <td className="py-3 px-4 uppercase font-bold text-rose-300">{e.severity}</td>
                      <td className="py-3 px-4 text-slate-300">{e.message}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {e.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'failed_tx' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">Operation</th>
                  <th className="py-3.5 px-4">User ID</th>
                  <th className="py-3.5 px-4">Error Code</th>
                  <th className="py-3.5 px-4">Details</th>
                  <th className="py-3.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredFailedTx.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No failed transaction logs recorded.
                    </td>
                  </tr>
                ) : (
                  filteredFailedTx.slice(startIdx, startIdx + PAGE_SIZE).map((ft) => (
                    <tr key={ft.id}>
                      <td className="py-3 px-4 font-semibold text-white">{ft.operation}</td>
                      <td className="py-3 px-4 font-mono-num text-slate-300">{ft.userId}</td>
                      <td className="py-3 px-4 font-mono-num text-rose-300">{ft.errorCode}</td>
                      <td className="py-3 px-4 text-slate-300">{ft.details}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {ft.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'reconciliation' && (
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-3.5 px-4">User ID</th>
                  <th className="py-3.5 px-4 text-right">Wallet Total</th>
                  <th className="py-3.5 px-4 text-right">Ledger Net</th>
                  <th className="py-3.5 px-4 text-right">Discrepancy</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredReconcile.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      No wallet reconciliation reports logged yet.
                    </td>
                  </tr>
                ) : (
                  filteredReconcile.slice(startIdx, startIdx + PAGE_SIZE).map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 px-4 font-mono-num text-white">{r.userId}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-200">
                        {r.walletTotalPoints}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-200">
                        {r.ledgerNetPoints}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-rose-300">
                        {r.discrepancyPoints}
                      </td>
                      <td className="py-3 px-4 uppercase font-bold text-amber-300">{r.status}</td>
                      <td className="py-3 px-4 text-right font-mono-num text-slate-400">
                        {r.createdAtLabel}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing <strong className="text-slate-200">{Math.min(PAGE_SIZE, activeCount - startIdx)}</strong>{' '}
            of <strong className="text-slate-200">{activeCount}</strong> entries
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
    </div>
  );
};
