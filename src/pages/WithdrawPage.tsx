import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  History,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  AppPage,
  EconomyConfig,
  MfsAccountType,
  PaymentMethodConfig,
  PaymentMethodId,
  UserProfile,
  WalletMetrics,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
} from '../types';
import {
  appRepository,
  formatBdt,
  formatPoints,
  getDhakaDateKey,
  getDhakaMonthKey,
  maskAccountNumber,
  pointsToBdt,
} from '../services/appService';
import { submitSecureWithdrawalRequest } from '../services/dashboardService';
import { GlassCard } from '../components/ui/GlassCard';
import {
  BankTransferMark,
  BkashMark,
  CoinsStackIcon,
  NagadMark,
  RocketMark,
} from '../components/icons/BrandAssets';
import { ModalDrawer } from '../components/ui/ModalDrawer';
import { useToast } from '../components/ui/ToastProvider';

interface WithdrawPageProps {
  accountStatus: UserProfile['accountStatus'];
  wallet: WalletMetrics;
  economy: EconomyConfig;
  withdrawalSettings: WithdrawalSettingsConfig;
  defaultPhone: string;
  paymentMethods: PaymentMethodConfig[];
  initialMethod: PaymentMethodId;
  userWithdrawals: WithdrawalRequestRecord[];
  onNavigate: (page: AppPage) => void;
}

const ACCOUNT_TYPE_LABELS: Record<MfsAccountType, string> = {
  personal: 'Personal',
  agent: 'Agent',
  merchant: 'Merchant',
  bank_account: 'Bank Account',
};

const METHOD_ACCENTS: Record<PaymentMethodId, string> = {
  bkash: 'border-pink-400/50 bg-pink-500/10',
  nagad: 'border-orange-400/50 bg-orange-500/10',
  rocket: 'border-purple-400/50 bg-purple-500/10',
  bank: 'border-blue-400/50 bg-blue-500/10',
};

export const WithdrawPage: React.FC<WithdrawPageProps> = ({
  accountStatus,
  wallet,
  economy,
  withdrawalSettings,
  defaultPhone,
  paymentMethods,
  initialMethod,
  userWithdrawals,
  onNavigate,
}) => {
  const { showToast } = useToast();

  const firstEnabledMethod = useMemo(
    () =>
      paymentMethods.find(
        (m) => m.id === initialMethod && m.enabled && withdrawalSettings.allowedMethods.includes(m.id),
      )?.id ??
      paymentMethods.find((m) => m.enabled && withdrawalSettings.allowedMethods.includes(m.id))?.id ??
      initialMethod,
    [paymentMethods, initialMethod, withdrawalSettings.allowedMethods],
  );

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodId>(firstEnabledMethod);
  const [accountType, setAccountType] = useState<MfsAccountType>('personal');
  const [accountNumber, setAccountNumber] = useState(defaultPhone);
  const [amountInput, setAmountInput] = useState('');
  const [optionalNote, setOptionalNote] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedResult, setConfirmedResult] = useState<{
    requestId: string;
    transactionId: string;
  } | null>(null);

  const activeMethod = useMemo(
    () => paymentMethods.find((m) => m.id === selectedMethod) ?? paymentMethods[0],
    [paymentMethods, selectedMethod],
  );

  useEffect(() => {
    setSelectedMethod((prev) => {
      const stillValid = paymentMethods.some(
        (m) => m.id === prev && m.enabled && withdrawalSettings.allowedMethods.includes(m.id),
      );
      return stillValid ? prev : firstEnabledMethod;
    });
  }, [paymentMethods, withdrawalSettings.allowedMethods, firstEnabledMethod]);

  useEffect(() => {
    setSelectedMethod(firstEnabledMethod);
  }, [initialMethod, firstEnabledMethod]);

  useEffect(() => {
    if (!activeMethod.allowedAccountTypes.includes(accountType)) {
      setAccountType(activeMethod.allowedAccountTypes[0] ?? 'personal');
    }
  }, [activeMethod, accountType]);

  const parsedAmount = Number(amountInput);
  const preview = useMemo(
    () =>
      appRepository.validateWithdrawInput(
        selectedMethod,
        parsedAmount,
        accountNumber,
        accountType,
        wallet,
        economy,
        accountStatus,
        paymentMethods,
        withdrawalSettings,
        userWithdrawals,
      ),
    [
      selectedMethod,
      parsedAmount,
      accountNumber,
      accountType,
      wallet,
      economy,
      accountStatus,
      paymentMethods,
      withdrawalSettings,
      userWithdrawals,
    ],
  );

  const maxAvailableBdt = pointsToBdt(wallet.availablePoints, economy.pointsPerBdt);
  const maxRuleBdt = withdrawalSettings.maximumWithdrawBdt ?? economy.maximumWithdrawAmountBdt;
  const effectiveMaxBdt =
    maxAvailableBdt !== null && maxRuleBdt !== null
      ? Math.min(maxAvailableBdt, maxRuleBdt)
      : maxAvailableBdt;

  const globalMinPts =
    withdrawalSettings.minimumWithdrawPoints ?? economy.minimumWithdrawPoints;
  const effectiveMinPts = activeMethod.minPoints ?? globalMinPts;
  const minBdt =
    effectiveMinPts !== null ? pointsToBdt(effectiveMinPts, economy.pointsPerBdt) : null;

  const globalMinBdt =
    globalMinPts !== null ? pointsToBdt(globalMinPts, economy.pointsPerBdt) : null;

  const todayKey = getDhakaDateKey();
  const monthKey = getDhakaMonthKey();
  const countableWithdrawals = userWithdrawals.filter(
    (r) => r.status !== 'rejected' && r.status !== 'cancelled',
  );
  const todayUsedCount = countableWithdrawals.filter((r) => r.dhakaDate === todayKey).length;
  const todayUsedBdt = countableWithdrawals
    .filter((r) => r.dhakaDate === todayKey)
    .reduce((sum, r) => sum + r.grossBdt, 0);
  const monthUsedBdt = countableWithdrawals
    .filter((r) => r.dhakaMonth === monthKey)
    .reduce((sum, r) => sum + r.grossBdt, 0);

  const wdGloballyEnabled = economy.walletEnabled && withdrawalSettings.withdrawalEnabled;

  const renderMark = (id: PaymentMethodId) => {
    if (id === 'bkash') return <BkashMark className="w-10 h-10" />;
    if (id === 'nagad') return <NagadMark className="w-10 h-10" />;
    if (id === 'rocket') return <RocketMark className="w-10 h-10" />;
    return <BankTransferMark className="w-10 h-10" />;
  };

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview.valid) {
      setSubmitError(preview.error ?? 'Invalid withdrawal input.');
      return;
    }
    setSubmitError('');
    setConfirmOpen(true);
  };

  const handleConfirmSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await submitSecureWithdrawalRequest({
        methodId: selectedMethod,
        accountType,
        amountBdt: parsedAmount,
        accountNumber,
        optionalNote,
      });
      setConfirmOpen(false);
      setConfirmedResult(res);
      setAmountInput('');
      setOptionalNote('');
      showToast('Withdrawal request submitted & balance safely reserved!', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to submit withdrawal request.';
      setConfirmOpen(false);
      setSubmitError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      {/* 1. Withdraw Header & Limits Overview */}
      <GlassCard className="p-5 space-y-4 bg-gradient-to-br from-[#1B1D4E] via-[#131842] to-[#0C1232]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <CoinsStackIcon className="w-14 h-14 shrink-0" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-semibold text-violet-300">Secure Payout Request</p>
              <p className="text-2xl sm:text-3xl font-extrabold font-display text-white tabular-nums">
                {formatPoints(wallet.availablePoints)}{' '}
                <span className="text-base font-bold text-slate-200">Points</span>
              </p>
              <p className="text-sm font-bold text-amber-300 tabular-nums">
                Available Balance:{' '}
                {maxAvailableBdt !== null ? formatBdt(maxAvailableBdt) : 'Rate Pending'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('withdrawal-history')}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors"
            >
              <History className="w-4 h-4 text-violet-300" />
              <span>Withdrawal History ({userWithdrawals.length})</span>
            </button>
          </div>
        </div>

        {/* Min / Max / Info Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-white/10 text-xs tabular-nums">
          <div className="p-3 rounded-xl bg-black/25 border border-white/10 space-y-0.5">
            <p className="text-slate-400">Minimum Withdraw</p>
            <p className="text-sm font-extrabold text-white">
              {globalMinBdt !== null
                ? formatBdt(globalMinBdt)
                : globalMinPts !== null
                  ? `${formatPoints(globalMinPts)} Pts`
                  : 'Pending'}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-white/10 space-y-0.5">
            <p className="text-slate-400">Maximum Withdraw</p>
            <p className="text-sm font-extrabold text-white">
              {maxRuleBdt !== null ? formatBdt(maxRuleBdt) : 'No Single Cap'}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-white/10 space-y-0.5">
            <p className="text-slate-400">Daily Limit Used</p>
            <p className="text-sm font-extrabold text-sky-300">
              {todayUsedCount}/{withdrawalSettings.dailyLimitCount} req
              {withdrawalSettings.dailyLimitBdt !== null
                ? ` · ${formatBdt(todayUsedBdt)} / ${formatBdt(withdrawalSettings.dailyLimitBdt)}`
                : ''}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-white/10 space-y-0.5">
            <p className="text-slate-400">Processing &amp; Monthly</p>
            <p className="text-xs font-bold text-emerald-300 truncate">
              {withdrawalSettings.monthlyLimitBdt !== null
                ? `${formatBdt(monthUsedBdt)} / ${formatBdt(withdrawalSettings.monthlyLimitBdt)} mo`
                : withdrawalSettings.processingTimeLabel}
            </p>
          </div>
        </div>

        {wallet.reservedPoints > 0 && (
          <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10 tabular-nums">
            <span className="text-slate-300 inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-300" />
              Reserved in Pending/Processing Payouts
            </span>
            <span className="font-bold text-amber-300">
              {formatPoints(wallet.reservedPoints)} Pts
            </span>
          </div>
        )}
      </GlassCard>

      {!wdGloballyEnabled && (
        <GlassCard className="p-4 border-amber-400/35 bg-amber-500/10 flex items-center gap-3 text-xs text-amber-200">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
          <span>
            Withdrawals are currently paused. Existing balances and pending
            requests remain safely recorded in your Wallet Ledger.
          </span>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 2. Payment Method Selection */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold font-display text-white">Select Payment Method</h2>
            <span className="text-[11px] text-slate-400">Supported Payout Channels</span>
          </div>

          <div className="space-y-2.5" role="radiogroup" aria-label="Payment method">
            {paymentMethods.map((method) => {
              const isSelected = selectedMethod === method.id;
              const isMethodActive =
                method.enabled && withdrawalSettings.allowedMethods.includes(method.id);
              const mMinBdt =
                method.minPoints !== null
                  ? pointsToBdt(method.minPoints, economy.pointsPerBdt)
                  : null;

              return (
                <button
                  key={method.id}
                  type="button"
                  role="radio"
                  disabled={!isMethodActive}
                  aria-checked={isSelected}
                  onClick={() => {
                    if (!isMethodActive) return;
                    setSelectedMethod(method.id);
                    setSubmitError('');
                  }}
                  className={`w-full min-h-[68px] px-4 py-3 rounded-2xl flex items-center justify-between gap-3 border transition-all text-left ${
                    !isMethodActive
                      ? 'opacity-45 cursor-not-allowed bg-white/[0.02] border-white/10'
                      : isSelected
                        ? `${METHOD_ACCENTS[method.id]} shadow-lg`
                        : 'glass-card hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {renderMark(method.id)}
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-white truncate">
                          {method.name}
                          {method.bengaliName ? ` (${method.bengaliName})` : ''}
                        </p>
                        {!isMethodActive && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/20 text-rose-300">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300 tabular-nums">
                        {mMinBdt !== null ? `Min. ${formatBdt(mMinBdt)} · ` : ''}Fee{' '}
                        {method.feePercent}%
                      </p>
                    </div>
                  </div>

                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      isSelected && isMethodActive
                        ? 'border-violet-400 bg-violet-500'
                        : 'border-slate-500'
                    }`}
                  >
                    {isSelected && isMethodActive && (
                      <span className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Withdraw Request Form */}
        <GlassCard className="lg:col-span-7 p-5 sm:p-6">
          <form onSubmit={handleOpenConfirm} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="wd-account" className="block text-xs font-semibold text-slate-300">
                  {activeMethod.name} Account / Wallet Number
                </label>
                <input
                  id="wd-account"
                  type="text"
                  value={accountNumber}
                  onChange={(e) => {
                    setAccountNumber(e.target.value);
                    setSubmitError('');
                  }}
                  placeholder={activeMethod.accountHint}
                  className="w-full h-12 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono-num"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="wd-acct-type" className="block text-xs font-semibold text-slate-300">
                  Account Type
                </label>
                <select
                  id="wd-acct-type"
                  value={accountType}
                  onChange={(e) => {
                    setAccountType(e.target.value as MfsAccountType);
                    setSubmitError('');
                  }}
                  className="w-full h-12 px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
                >
                  {activeMethod.allowedAccountTypes.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label htmlFor="wd-amount" className="text-xs font-semibold text-slate-300">
                  Withdrawal Amount (BDT)
                </label>
                <span className="text-xs text-slate-400 tabular-nums">
                  {minBdt !== null ? `Min. ${formatBdt(minBdt)}` : 'Min. pending'}
                  {maxRuleBdt !== null ? ` · Max ${formatBdt(maxRuleBdt)}` : ''}
                </span>
              </div>

              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-amber-300 pointer-events-none">
                  ৳
                </span>
                <input
                  id="wd-amount"
                  type="number"
                  step="0.5"
                  min={minBdt ?? undefined}
                  max={effectiveMaxBdt !== null && effectiveMaxBdt > 0 ? effectiveMaxBdt : undefined}
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    setSubmitError('');
                  }}
                  placeholder={minBdt !== null ? `Enter amount (Min. ৳${minBdt})` : 'Enter amount'}
                  className="w-full h-12 pl-9 pr-4 rounded-xl bg-[#070B22] border border-white/15 text-sm font-bold text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono-num"
                />
              </div>

              {effectiveMaxBdt !== null && minBdt !== null && effectiveMaxBdt >= minBdt && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {[minBdt, effectiveMaxBdt]
                    .filter((val, idx, arr) => arr.indexOf(val) === idx)
                    .map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setAmountInput(preset.toFixed(2));
                          setSubmitError('');
                        }}
                        className="min-h-[36px] px-3 py-1 rounded-lg bg-white/[0.06] hover:bg-violet-500/25 border border-white/10 text-xs font-semibold text-slate-200 tabular-nums transition-colors"
                      >
                        {preset === effectiveMaxBdt
                          ? `Max (${formatBdt(effectiveMaxBdt)})`
                          : `Min (${formatBdt(minBdt)})`}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Auto-calculated Points & Payout Summary */}
            <div className="p-4 rounded-2xl bg-[#070B22]/90 border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="text-slate-400">Points Required</span>
                <span className="font-extrabold text-violet-300">
                  {parsedAmount > 0 && economy.pointsPerBdt
                    ? `${formatPoints(Math.round(parsedAmount * economy.pointsPerBdt))} Pts`
                    : '0 Pts'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="text-slate-400">
                  Processing Fee ({activeMethod.feePercent}%)
                </span>
                <span className="font-semibold text-slate-200">
                  {parsedAmount > 0
                    ? formatBdt(Number(((parsedAmount * activeMethod.feePercent) / 100).toFixed(2)))
                    : '৳ 0.00'}
                </span>
              </div>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between tabular-nums">
                <span className="text-xs font-semibold text-slate-300">Net Payable Amount</span>
                <span className="text-xl font-extrabold font-display text-amber-300">
                  {preview.valid
                    ? formatBdt(preview.netBdt)
                    : parsedAmount > 0
                      ? formatBdt(
                          Number(
                            Math.max(
                              0,
                              parsedAmount - (parsedAmount * activeMethod.feePercent) / 100,
                            ).toFixed(2),
                          ),
                        )
                      : '৳ 0.00'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="wd-note" className="block text-xs font-semibold text-slate-300">
                Optional Note
              </label>
              <input
                id="wd-note"
                type="text"
                maxLength={200}
                value={optionalNote}
                onChange={(e) => setOptionalNote(e.target.value)}
                placeholder="Any verification note (optional)"
                className="w-full h-11 px-4 rounded-xl bg-[#070B22] border border-white/15 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
            </div>

            {submitError && (
              <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3.5 py-2.5">
                {submitError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !wdGloballyEnabled || accountStatus !== 'active'}
              className="w-full min-h-[50px] px-6 py-3 rounded-full brand-button text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>Review &amp; Request Withdraw</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-2 text-xs text-slate-400 pt-1">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <span>
                {activeMethod.processingWindow}. Required points are atomically reserved on the
                backend so duplicate or over-limit requests are rejected server-side.
              </span>
            </div>
          </form>
        </GlassCard>
      </div>

      {/* Confirmation Dialog Before Final Submit */}
      <ModalDrawer
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Confirm Withdrawal Request"
        subtitle="Please verify account details and net payout amount"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-[#070C24] border border-white/10 space-y-2.5 text-xs tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Payment Method</span>
              <span className="font-bold text-white">{activeMethod.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Account Number</span>
              <span className="font-bold text-white font-mono-num">
                {maskAccountNumber(accountNumber, selectedMethod)} ({accountNumber.trim()})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Account Type</span>
              <span className="font-semibold text-violet-300">
                {ACCOUNT_TYPE_LABELS[accountType]}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Requested Amount</span>
              <span className="font-bold text-white">{formatBdt(preview.grossBdt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Processing Fee</span>
              <span className="font-semibold text-rose-300">-{formatBdt(preview.feeBdt)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <span className="text-slate-300 font-semibold">Net Payable</span>
              <span className="text-base font-extrabold text-amber-300">
                {formatBdt(preview.netBdt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Points to Reserve</span>
              <span className="font-bold text-emerald-300">
                {formatPoints(preview.pointsRequired)} Pts
              </span>
            </div>
            {optionalNote.trim() && (
              <div className="pt-2 border-t border-white/10">
                <p className="text-slate-400 mb-0.5">Note</p>
                <p className="text-slate-200">{optionalNote.trim()}</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirmOpen(false)}
              className="flex-1 min-h-[44px] rounded-xl bg-white/[0.08] hover:bg-white/15 border border-white/15 text-xs font-bold text-white"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmSubmit}
              className="flex-1 min-h-[44px] rounded-xl brand-button text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Reserving...</span>
                </>
              ) : (
                <span>Confirm Withdraw</span>
              )}
            </button>
          </div>
        </div>
      </ModalDrawer>

      {/* Submitted Confirmation Modal */}
      <ModalDrawer
        open={Boolean(confirmedResult)}
        onClose={() => setConfirmedResult(null)}
        title="Withdrawal Request Submitted"
        subtitle="Balance safely reserved in atomic Wallet Ledger"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/25 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-slate-200 leading-relaxed">
              <p className="font-bold text-white text-sm">Points Reserved Successfully</p>
              <p>
                Withdrawal ID:{' '}
                <span className="font-mono-num text-emerald-300">
                  {confirmedResult?.requestId}
                </span>
              </p>
              <p>
                Transaction ID:{' '}
                <span className="font-mono-num text-sky-300">
                  {confirmedResult?.transactionId}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
            <span>
              Your reserved balance is marked Pending until reviewed and paid out by our
              verification team. You can track or cancel pending requests in Withdrawal History.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setConfirmedResult(null);
                onNavigate('withdrawal-history');
              }}
              className="flex-1 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white"
            >
              View History
            </button>
            <button
              type="button"
              onClick={() => setConfirmedResult(null)}
              className="flex-1 min-h-[44px] rounded-xl brand-button text-white text-xs font-bold"
            >
              Done
            </button>
          </div>
        </div>
      </ModalDrawer>
    </div>
  );
};
