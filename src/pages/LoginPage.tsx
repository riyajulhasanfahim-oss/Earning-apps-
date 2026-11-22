import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import { AdViewLogoMark, BrandWordmark } from '../components/icons/BrandAssets';
import { GlassCard } from '../components/ui/GlassCard';
import { ModalDrawer } from '../components/ui/ModalDrawer';
import {
  loginUserWithEmail,
  mapAuthError,
  sendForgotPasswordEmail,
  signInWithGoogle,
} from '../services/authService';
import { GoogleAuthButton } from '../components/auth/GoogleAuthButton';
import { useToast } from '../components/ui/ToastProvider';
import { useSiteBranding } from '../contexts/SiteBrandingContext';

interface LoginPageProps {
  onBackToSplash: () => void;
  onGoRegister: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onBackToSplash,
  onGoRegister,
}) => {
  const { showToast } = useToast();
  const branding = useSiteBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  // Forgot password state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await loginUserWithEmail(email, password, rememberMe);
      showToast('Signed in successfully!', 'success');
    } catch (err) {
      const msg = mapAuthError(err);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      showToast('Signed in with Google successfully!', 'success');
    } catch (err) {
      const msg = mapAuthError(err);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.trim())) {
      setResetError('Please enter a valid registered email address.');
      return;
    }

    setResetError('');
    setResetLoading(true);
    try {
      await sendForgotPasswordEmail(resetEmail);
      setResetSent(true);
      showToast('Password reset email sent! Check your inbox.', 'success');
    } catch (err) {
      const msg = mapAuthError(err);
      setResetError(msg);
      showToast(msg, 'error');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToSplash}
            className="min-h-[44px] inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div className="flex items-center gap-2">
            <AdViewLogoMark size="sm" />
            <BrandWordmark
              name={branding.headerBrandText || branding.websiteName}
              className="text-base font-extrabold font-display text-white"
            />
          </div>
        </div>

        <GlassCard className="p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-2xl font-extrabold font-display text-white">
              {branding.loginBrandingTitle || 'Welcome Back'}
            </h1>
            <p className="text-sm text-slate-400">
              {branding.loginBrandingSubtitle ||
                `Sign in with Google or your ${branding.websiteName || 'AdView Earn'} email`}
            </p>
          </div>

          <GoogleAuthButton
            label="Continue with Google"
            loading={googleLoading}
            disabled={loading}
            onClick={handleGoogleSignIn}
          />

          <div className="relative flex items-center justify-center">
            <span className="h-px flex-1 bg-white/10" />
            <span className="px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              or continue with email
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="you@example.com"
                  className="w-full h-12 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-300">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter your password"
                  className="w-full h-12 pl-10 pr-12 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="min-h-[44px] min-w-[44px] absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer min-h-[44px]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded accent-violet-600"
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setResetSent(false);
                  setResetError('');
                  setResetEmail(email);
                  setForgotOpen(true);
                }}
                className="min-h-[44px] px-1 text-violet-300 hover:text-violet-200 font-medium"
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <p
                role="alert"
                className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5 leading-relaxed"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] px-6 py-3 rounded-xl brand-button text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <span>Login</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="pt-4 border-t border-white/10 text-center text-xs text-slate-400">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={onGoRegister}
              className="text-amber-400 hover:text-amber-300 font-semibold py-2 px-1"
            >
              Create New Account
            </button>
          </div>
        </GlassCard>
      </div>

      <ModalDrawer
        open={forgotOpen}
        onClose={() => setForgotOpen(false)}
        title="Reset Password"
        subtitle="Receive a Firebase password reset email"
      >
        {resetSent ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-300 leading-relaxed">
              We sent a password reset link to{' '}
              <span className="font-semibold text-white">{resetEmail}</span>. Check your inbox and
              spam folder to set a new password.
            </p>
            <button
              type="button"
              onClick={() => setForgotOpen(false)}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-semibold"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleResetSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-300">
                Registered Email Address
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={resetEmail}
                onChange={(e) => {
                  setResetEmail(e.target.value);
                  setResetError('');
                }}
                placeholder="you@example.com"
                className="w-full h-12 px-4 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white focus:outline-none focus:border-violet-400"
              />
            </div>
            {resetError && (
              <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5">
                {resetError}
              </p>
            )}
            <button
              type="submit"
              disabled={resetLoading}
              className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {resetLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending Reset Email...</span>
                </>
              ) : (
                <span>Send Reset Email</span>
              )}
            </button>
          </form>
        )}
      </ModalDrawer>
    </div>
  );
};
