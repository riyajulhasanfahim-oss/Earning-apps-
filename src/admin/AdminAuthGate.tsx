import React, { useState } from 'react';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { RotateCcw } from 'lucide-react';
import { AdViewLogoMark, BrandWordmark } from '../components/icons/BrandAssets';
import {
  loginUserWithEmail,
  logoutUser,
  mapAuthError,
  sendForgotPasswordEmail,
} from '../services/authService';
import { VerifiedAdminSession } from '../services/adminService';
import { useToast } from '../components/ui/ToastProvider';
import { useSiteBranding } from '../contexts/SiteBrandingContext';
import {
  isCustomFirebaseProjectActive,
  resetToBundledFirebaseConfig,
} from '../lib/firebaseConfigStore';

interface AdminAuthGateProps {
  firebaseUser: User | null;
  verifying: boolean;
  session: VerifiedAdminSession | null;
  siteName: string;
  onExitToUserSite: () => void;
  onRefreshVerification: () => Promise<void>;
}

export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({
  firebaseUser,
  verifying,
  session,
  siteName,
  onExitToUserSite,
  onRefreshVerification,
}) => {
  const { showToast } = useToast();
  const branding = useSiteBranding();
  const effectiveSiteName = siteName || branding.websiteName || 'AdView Earn';
  const customFirebaseActive = isCustomFirebaseProjectActive();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  const handleEmergencyRestore = () => {
    resetToBundledFirebaseConfig('admin_gate_recovery');
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid administrator email address.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await loginUserWithEmail(cleanEmail, password, true);
      await onRefreshVerification();
    } catch (err) {
      const msg = mapAuthError(err);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = resetEmail.trim();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setResetMessage('Please enter a valid admin email address.');
      return;
    }
    setResetLoading(true);
    setResetMessage('');
    try {
      await sendForgotPasswordEmail(clean);
      setResetMessage('Password reset instructions sent to your email.');
      showToast('Admin password reset email sent.', 'success');
    } catch (err) {
      const msg = mapAuthError(err);
      setResetMessage(msg);
    } finally {
      setResetLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logoutUser();
      setEmail('');
      setPassword('');
      setError('');
      showToast('Signed out of session.', 'info');
    } catch (err) {
      showToast(mapAuthError(err), 'error');
    }
  };

  if (verifying) {
    return (
      <div className="min-h-dvh bg-[#06091B] text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0B1026]/90 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-400/30 flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
          </div>
          <h1 className="text-lg font-bold font-display text-white">
            Verifying Admin Security Claims
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Checking Firebase Authentication token, Custom Claims (`adminRole`), and server-governed
            role privileges...
          </p>
        </div>
      </div>
    );
  }

  // Signed in, but rejected by Custom Claims & Firestore admin check -> Unauthorized Access Protection
  if (firebaseUser && session && !session.authorized) {
    return (
      <div className="min-h-dvh bg-[#06091B] text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg rounded-2xl border border-rose-500/30 bg-[#0B1026]/95 p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">
                403 · Unauthorized Access Blocked
              </p>
              <h1 className="text-xl font-extrabold font-display text-white">
                Admin Privileges Required
              </h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                Signed in as{' '}
                <span className="font-mono text-white">{firebaseUser.email || firebaseUser.uid}</span>
                , which does not hold verified Firebase Custom Claims (`adminRole`) or server-assigned
                admin access.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#06091B]/70 p-4 text-xs text-slate-300 space-y-1.5">
            <p className="font-semibold text-slate-200">Security Verification Details:</p>
            <p className="text-slate-400">
              {session.reason || 'Access denied by Firebase backend security policy.'}
            </p>
            <p className="text-[11px] text-slate-500 pt-1">
              Frontend UI routes never grant privileges on their own; Firestore Security Rules &
              Cloud Functions enforce Custom Claims and server roles independently.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out & Use Admin Account</span>
            </button>
            <button
              type="button"
              onClick={onExitToUserSite}
              className="flex-1 min-h-[44px] px-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-slate-200 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to {effectiveSiteName}</span>
            </button>
          </div>
          {customFirebaseActive && (
            <button
              type="button"
              onClick={handleEmergencyRestore}
              className="w-full min-h-[40px] px-4 rounded-xl border border-amber-400/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore Default Firebase Configuration</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Standalone Admin Login Page
  return (
    <div className="min-h-dvh bg-[#06091B] text-slate-100 flex flex-col justify-center px-4 py-8 sm:px-6 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden opacity-60"
      >
        <div className="absolute -top-40 -left-32 w-96 h-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-32 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onExitToUserSite}
            className="min-h-[44px] inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>User Portal</span>
          </button>

          <div className="flex items-center gap-2.5">
            <AdViewLogoMark size="sm" />
            <div className="text-right">
              <p className="text-sm font-extrabold font-display text-white leading-none">
                <BrandWordmark name={branding.headerBrandText || effectiveSiteName} />
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-300 mt-0.5">
                Admin Console
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/12 bg-[#0B1026]/90 backdrop-blur-xl p-6 sm:p-8 space-y-6 shadow-2xl shadow-black/50">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 rounded-2xl brand-gradient flex items-center justify-center mx-auto shadow-lg shadow-violet-600/25">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-extrabold font-display text-white">
              Administrator Sign In
            </h1>
            <p className="text-xs text-slate-400">
              Restricted control plane protected by Firebase Custom Claims (`super_admin`, `admin`,
              `support_admin`)
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="admin-email" className="block text-xs font-semibold text-slate-300">
                Admin Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@adviewearn.com"
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-[#06091B]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/25"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="admin-password"
                  className="block text-xs font-semibold text-slate-300"
                >
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email);
                    setResetMessage('');
                    setForgotOpen(true);
                  }}
                  className="text-xs font-semibold text-violet-300 hover:text-violet-200 transition-colors"
                >
                  Forgot Password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full min-h-[46px] pl-10 pr-11 rounded-xl bg-[#06091B]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/25"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Claims & Signing In...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Secure Admin Login</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 text-[11px] text-slate-400 text-center leading-relaxed space-y-2">
            <p>
              Every administrative mutation is verified on Firebase Rules / Cloud Functions and
              recorded in immutable `adminLogs`.
            </p>
            {customFirebaseActive && (
              <button
                type="button"
                onClick={handleEmergencyRestore}
                className="inline-flex items-center gap-1.5 text-amber-300 hover:text-amber-200 font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore Default Firebase Configuration</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Forgot Password Dialog */}
      {forgotOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Admin Password Reset"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold font-display text-white">
                Reset Admin Password
              </h2>
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="text-xs text-slate-400 hover:text-white px-2 py-1"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Enter your registered Admin email address to receive a Firebase password reset link.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="admin@adviewearn.com"
                className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#06091B] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
              {resetMessage && (
                <p className="text-xs text-violet-300 bg-violet-500/10 border border-violet-400/25 rounded-lg px-3 py-2">
                  {resetMessage}
                </p>
              )}
              <button
                type="submit"
                disabled={resetLoading}
                className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {resetLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Send Reset Link</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
