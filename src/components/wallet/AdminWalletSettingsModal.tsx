import React, { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Sliders } from 'lucide-react';
import { EconomyConfig } from '../../types';
import { saveEconomyConfig } from '../../services/dashboardService';
import { ModalDrawer } from '../ui/ModalDrawer';
import { useToast } from '../ui/ToastProvider';

interface AdminWalletSettingsModalProps {
  open: boolean;
  onClose: () => void;
  economy: EconomyConfig;
}

export const AdminWalletSettingsModal: React.FC<AdminWalletSettingsModalProps> = ({
  open,
  onClose,
  economy,
}) => {
  const { showToast } = useToast();
  const [pointsPerBdt, setPointsPerBdt] = useState('');
  const [minWithdrawPoints, setMinWithdrawPoints] = useState('');
  const [maxWithdrawAmountBdt, setMaxWithdrawAmountBdt] = useState('');
  const [dailyBonusPoints, setDailyBonusPoints] = useState('');
  const [dailyAdLimit, setDailyAdLimit] = useState('20');
  const [walletEnabled, setWalletEnabled] = useState(true);
  const [earningEnabled, setEarningEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPointsPerBdt(economy.pointsPerBdt ? String(economy.pointsPerBdt) : '');
    setMinWithdrawPoints(
      economy.minimumWithdrawPoints ? String(economy.minimumWithdrawPoints) : '',
    );
    setMaxWithdrawAmountBdt(
      economy.maximumWithdrawAmountBdt ? String(economy.maximumWithdrawAmountBdt) : '',
    );
    setDailyBonusPoints(economy.dailyBonusPoints ? String(economy.dailyBonusPoints) : '');
    setDailyAdLimit(String(economy.dailyAdLimit || 20));
    setWalletEnabled(economy.walletEnabled);
    setEarningEnabled(economy.earningEnabled);
  }, [economy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveEconomyConfig({
        pointsPerBdt: pointsPerBdt ? Number(pointsPerBdt) : null,
        minimumWithdrawPoints: minWithdrawPoints ? Number(minWithdrawPoints) : null,
        maximumWithdrawAmountBdt: maxWithdrawAmountBdt ? Number(maxWithdrawAmountBdt) : null,
        dailyBonusPoints: dailyBonusPoints ? Number(dailyBonusPoints) : null,
        dailyAdLimit: Math.max(1, Number(dailyAdLimit) || 20),
        walletEnabled,
        earningEnabled,
      });
      showToast('Wallet & Points Settings saved to Firestore.', 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDrawer
      open={open}
      onClose={onClose}
      title="Admin Wallet & Points Settings"
      subtitle="Stored in appSettings/wallet · Does not modify historical transaction rates"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-400/25 flex items-start gap-2.5 text-xs text-slate-300">
          <Sliders className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
          <span>
            Updating the conversion rate applies only to future earnings and conversions—every
            past transaction permanently keeps the rate recorded at its creation time.
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Points per 1 BDT (Conversion Rate)
            </label>
            <input
              type="number"
              min={1}
              placeholder="e.g. 100 (100 Pts = 1 BDT)"
              value={pointsPerBdt}
              onChange={(e) => setPointsPerBdt(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Minimum Withdraw Points
            </label>
            <input
              type="number"
              min={1}
              placeholder="e.g. 1000"
              value={minWithdrawPoints}
              onChange={(e) => setMinWithdrawPoints(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Maximum Withdraw Amount (BDT)
            </label>
            <input
              type="number"
              min={1}
              placeholder="e.g. 5000"
              value={maxWithdrawAmountBdt}
              onChange={(e) => setMaxWithdrawAmountBdt(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Daily Ad Limit (Ads / Day)
            </label>
            <input
              type="number"
              min={1}
              required
              value={dailyAdLimit}
              onChange={(e) => setDailyAdLimit(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Daily Check-in Bonus Points
            </label>
            <input
              type="number"
              min={1}
              placeholder="e.g. 50"
              value={dailyBonusPoints}
              onChange={(e) => setDailyBonusPoints(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-[#070C24] border border-white/15 text-xs text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white cursor-pointer">
            <span className="font-semibold">Wallet Withdrawals Enabled</span>
            <input
              type="checkbox"
              checked={walletEnabled}
              onChange={(e) => setWalletEnabled(e.target.checked)}
              className="w-4 h-4 accent-violet-500"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white cursor-pointer">
            <span className="font-semibold">Ad Earning Enabled</span>
            <input
              type="checkbox"
              checked={earningEnabled}
              onChange={(e) => setEarningEnabled(e.target.checked)}
              className="w-4 h-4 accent-violet-500"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full min-h-[44px] rounded-xl brand-button text-white text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          <span>Save Wallet Settings</span>
        </button>
      </form>
    </ModalDrawer>
  );
};
