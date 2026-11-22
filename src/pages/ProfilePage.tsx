import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  HelpCircle,
  Info,
  Loader2,
  Lock,
  LogOut,
  Pencil,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { AppPage, PaymentMethodConfig, UserProfile } from '../types';
import { GlassCard } from '../components/ui/GlassCard';
import {
  BankTransferMark,
  BkashMark,
  NagadMark,
  RocketMark,
  UserAvatarGraphic,
} from '../components/icons/BrandAssets';
import { ModalDrawer } from '../components/ui/ModalDrawer';
import { changeOwnPassword, mapAuthError, updateOwnProfile } from '../services/authService';
import { useToast } from '../components/ui/ToastProvider';

interface ProfilePageProps {
  user: UserProfile;
  paymentMethods: PaymentMethodConfig[];
  supportEmail?: string;
  onNavigate: (page: AppPage) => void;
  onLogout: () => void;
}

type ProfileModalType =
  | null
  | 'edit_profile'
  | 'change_password'
  | 'payment_methods'
  | 'help'
  | 'about';

export const ProfilePage: React.FC<ProfilePageProps> = ({
  user,
  paymentMethods,
  supportEmail,
  onNavigate,
  onLogout,
}) => {
  const { showToast } = useToast();
  const [activeModal, setActiveModal] = useState<ProfileModalType>(null);

  // Edit profile form state
  const [editName, setEditName] = useState(user.fullName);
  const [editPhone, setEditPhone] = useState(user.phoneNumber);
  const [savingProfile, setSavingProfile] = useState(false);

  // Change password form state
  const [currPass, setCurrPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passMessage, setPassMessage] = useState('');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editName.trim().length < 2) {
      showToast('Full name must be at least 2 characters.', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      await updateOwnProfile(user.uid, {
        fullName: editName,
        phoneNumber: editPhone,
      });
      showToast('Profile updated in Firestore!', 'success');
      setActiveModal(null);
    } catch (err) {
      showToast(mapAuthError(err), 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currPass) {
      setPassMessage('Please enter your current password.');
      return;
    }
    if (newPass.length < 6) {
      setPassMessage('New password must be at least 6 characters.');
      return;
    }
    if (newPass !== confirmPass) {
      setPassMessage('Passwords do not match.');
      return;
    }

    setSavingPassword(true);
    setPassMessage('');
    try {
      await changeOwnPassword(currPass, newPass);
      showToast('Password updated successfully!', 'success');
      setCurrPass('');
      setNewPass('');
      setConfirmPass('');
      setActiveModal(null);
    } catch (err) {
      const msg = mapAuthError(err);
      setPassMessage(msg);
      showToast(msg, 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const menuItems: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    tone?: 'default' | 'danger';
  }> = [
    {
      id: 'edit',
      label: 'Edit Profile',
      icon: Pencil,
      onClick: () => {
        setEditName(user.fullName);
        setEditPhone(user.phoneNumber);
        setActiveModal('edit_profile');
      },
    },
    {
      id: 'password',
      label: 'Change Password',
      icon: Lock,
      onClick: () => {
        setPassMessage('');
        setActiveModal('change_password');
      },
    },
    {
      id: 'payments',
      label: 'Payment Methods',
      icon: CreditCard,
      onClick: () => setActiveModal('payment_methods'),
    },
    {
      id: 'withdrawals',
      label: 'Withdrawal History',
      icon: Clock,
      onClick: () => onNavigate('withdrawal-history'),
    },
    {
      id: 'transactions',
      label: 'Transaction History',
      icon: Clock,
      onClick: () => onNavigate('transactions'),
    },
    {
      id: 'help',
      label: 'Help & Support',
      icon: HelpCircle,
      onClick: () => setActiveModal('help'),
    },
    {
      id: 'about',
      label: 'About Us',
      icon: Info,
      onClick: () => setActiveModal('about'),
    },
    {
      id: 'logout',
      label: 'Logout',
      icon: LogOut,
      tone: 'danger',
      onClick: onLogout,
    },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Profile Header Card */}
      <GlassCard className="p-6 flex flex-col items-center text-center space-y-3">
        <UserAvatarGraphic className="w-24 h-24" />
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-1.5">
            <h2 className="text-xl font-extrabold font-display text-white">{user.fullName}</h2>
            {user.verified && (
              <CheckCircle2 className="w-5 h-5 text-sky-400" aria-label="Verified account" />
            )}
          </div>
          <p className="text-xs font-mono-num text-violet-300">@{user.username}</p>
          <p className="text-xs sm:text-sm text-slate-300">{user.email}</p>
          {user.phoneNumber && (
            <p className="text-xs text-slate-400 font-mono-num">{user.phoneNumber}</p>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-bold">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>{user.level}</span>
          </div>
          <span className="text-xs text-emerald-400 font-semibold">
            Status: {user.accountStatus === 'active' ? 'Active' : user.accountStatus}
          </span>
        </div>
      </GlassCard>

      {/* Menu List matching Reference Mockup */}
      <GlassCard className="divide-y divide-white/10 overflow-hidden">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isDanger = item.tone === 'danger';
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className={`w-full min-h-[56px] px-5 py-3.5 flex items-center justify-between gap-4 text-left transition-colors ${
                isDanger
                  ? 'text-rose-400 hover:bg-rose-500/10'
                  : 'text-slate-100 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <Icon className={`w-5 h-5 ${isDanger ? 'text-rose-400' : 'text-slate-300'}`} />
                <span className="text-sm font-semibold">{item.label}</span>
              </div>
              {!isDanger && <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
            </button>
          );
        })}
      </GlassCard>

      {/* Edit Profile Modal */}
      <ModalDrawer
        open={activeModal === 'edit_profile'}
        onClose={() => setActiveModal(null)}
        title="Edit Profile"
        subtitle="Only permitted profile fields are editable"
      >
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="edit-fullname" className="block text-xs font-semibold text-slate-300">
              Full Name
            </label>
            <input
              id="edit-fullname"
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full h-11 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-phone" className="block text-xs font-semibold text-slate-300">
              Mobile Number
            </label>
            <input
              id="edit-phone"
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="Optional mobile number"
              className="w-full h-11 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white font-mono-num focus:outline-none focus:border-violet-400"
            />
          </div>
          <button
            type="submit"
            disabled={savingProfile}
            className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {savingProfile ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </form>
      </ModalDrawer>

      {/* Change Password Modal */}
      <ModalDrawer
        open={activeModal === 'change_password'}
        onClose={() => setActiveModal(null)}
        title="Change Password"
        subtitle="Update your Firebase Authentication password"
      >
        <form onSubmit={handlePasswordSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label htmlFor="curr-pass" className="block text-xs font-semibold text-slate-300">
              Current Password
            </label>
            <input
              id="curr-pass"
              type="password"
              value={currPass}
              onChange={(e) => setCurrPass(e.target.value)}
              placeholder="Enter current password"
              className="w-full h-11 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="new-pass" className="block text-xs font-semibold text-slate-300">
              New Password
            </label>
            <input
              id="new-pass"
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="Min. 6 characters"
              className="w-full h-11 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="conf-pass" className="block text-xs font-semibold text-slate-300">
              Confirm New Password
            </label>
            <input
              id="conf-pass"
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              placeholder="Re-enter password"
              className="w-full h-11 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>
          {passMessage && (
            <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
              {passMessage}
            </p>
          )}
          <button
            type="submit"
            disabled={savingPassword}
            className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {savingPassword ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Updating...</span>
              </>
            ) : (
              <span>Update Password</span>
            )}
          </button>
        </form>
      </ModalDrawer>

      {/* Payment Methods Modal */}
      <ModalDrawer
        open={activeModal === 'payment_methods'}
        onClose={() => setActiveModal(null)}
        title="Payment Methods"
        subtitle="Supported payout channels"
      >
        <div className="space-y-3">
          {paymentMethods.map((m) => (
            <div
              key={m.id}
              className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                {m.id === 'bkash' ? (
                  <BkashMark />
                ) : m.id === 'nagad' ? (
                  <NagadMark />
                ) : m.id === 'rocket' ? (
                  <RocketMark />
                ) : (
                  <BankTransferMark />
                )}
                <div>
                  <p className="text-sm font-bold text-white">
                    {m.name} {m.bengaliName ? `(${m.bengaliName})` : ''}
                  </p>
                  <p className="text-xs text-slate-400">
                    {!m.enabled
                      ? 'Currently unavailable'
                      : `${m.minPoints !== null ? `Min. ${m.minPoints.toLocaleString()} Pts · ` : ''}Fee ${m.feePercent}%`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={!m.enabled}
                onClick={() => {
                  setActiveModal(null);
                  onNavigate('withdraw');
                }}
                className="min-h-[36px] px-3 rounded-lg bg-violet-500/20 text-violet-200 text-xs font-semibold hover:bg-violet-500/30 disabled:opacity-40"
              >
                {m.enabled ? 'Use' : 'Paused'}
              </button>
            </div>
          ))}
        </div>
      </ModalDrawer>

      {/* Help & Support Modal */}
      <ModalDrawer
        open={activeModal === 'help'}
        onClose={() => setActiveModal(null)}
        title="Help & Support"
        subtitle="Frequently asked questions"
      >
        <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
            <p className="font-bold text-white">How are ad points verified?</p>
            <p>
              Points are credited exclusively after receiving a verified S2S callback from the
              authorized Ad Network SDK or partner server.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
            <p className="font-bold text-white">What is the minimum withdrawal?</p>
            <p>
              Minimum withdrawal starts at 1,000 Points (৳ 10.00) for bKash and Nagad, and 2,000
              Points (৳ 20.00) for Bank Transfer.
            </p>
          </div>
          <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
            <p className="font-bold text-white">Support Contact</p>
            <p className="text-violet-300 font-mono-num">
              {supportEmail || 'support@adviewearn.com'}
            </p>
          </div>
        </div>
      </ModalDrawer>

      {/* About Us Modal */}
      <ModalDrawer
        open={activeModal === 'about'}
        onClose={() => setActiveModal(null)}
        title="About AdView Earn"
        subtitle="Platform architecture & policy"
      >
        <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-400/20 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <p>
              AdView Earn uses Firebase Authentication, hardened Firestore Security Rules, and
              compliant Rewarded Advertising SDK workflows to keep accounts and balances secure.
            </p>
          </div>
        </div>
      </ModalDrawer>
    </div>
  );
};
