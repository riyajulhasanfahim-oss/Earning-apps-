import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  Eye,
  EyeOff,
  Gift,
  Loader2,
  Lock,
  Mail,
  Phone,
  User,
  X,
} from 'lucide-react';
import { AdViewLogoMark } from '../icons/BrandAssets';
import { GoogleAuthButton } from './GoogleAuthButton';
import {
  loginUserWithEmail,
  mapAuthError,
  registerUserWithEmail,
  sendForgotPasswordEmail,
  signInWithGoogle,
} from '../../services/authService';
import { useToast } from '../ui/ToastProvider';
import { useSiteBranding } from '../../contexts/SiteBrandingContext';

export type AuthModalMode = 'login' | 'register' | 'forgot';

interface AuthModalProps {
  open: boolean;
  mode: AuthModalMode;
  reasonPrompt?: string;
  initialReferralCode?: string;
  registrationEnabled?: boolean;
  siteName?: string;
  onModeChange: (mode: AuthModalMode) => void;
  onClose: () => void;
  onAuthSuccess: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  mode,
  reasonPrompt,
  initialReferralCode = '',
  registrationEnabled = true,
  siteName = 'AdView Earn',
  onModeChange,
  onClose,
  onAuthSuccess,
}) => {
  const { showToast } = useToast();
  const branding = useSiteBranding();
  const effectiveSiteName = siteName || branding.websiteName || 'AdView Earn';

  // Shared state
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Login state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Register state
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState('');

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (initialReferralCode) {
      setReferralCode(initialReferralCode);
    }
  }, [initialReferralCode]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loginLoading && !regLoading && !googleLoading && !resetLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, loginLoading, regLoading, googleLoading, resetLoading, onClose]);

  if (!open) return null;

  const anyBusy = loginLoading || regLoading || googleLoading || resetLoading;

  const handleGoogleAuth = async () => {
    if (mode === 'register' && !registrationEnabled) {
      setRegError(`New user registrations on ${siteName} are temporarily unavailable.`);
      return;
    }
    setLoginError('');
    setRegError('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle({
        referralCode: referralCode.trim() || initialReferralCode || undefined,
      });
      showToast('Signed in with Google successfully!', 'success');
      onAuthSuccess();
    } catch (err) {
      const msg = mapAuthError(err);
      if (mode === 'register') {
        setRegError(msg);
      } else {
        setLoginError(msg);
      }
      showToast(msg, 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim())) {
      setLoginError('Please enter a valid email address.');
      return;
    }
    if (!loginPassword || loginPassword.length < 6) {
      setLoginError('Password must be at least 6 characters.');
      return;
    }
    setLoginError('');
    setLoginLoading(true);
    try {
      await loginUserWithEmail(loginEmail, loginPassword, rememberMe);
      showToast('Signed in successfully!', 'success');
      onAuthSuccess();
    } catch (err) {
      const msg = mapAuthError(err);
      setLoginError(msg);
      showToast(msg, 'error');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registrationEnabled) {
      setRegError(`New user registrations on ${siteName} are temporarily unavailable.`);
      return;
    }
    const cleanName = fullName.trim();
    const cleanUser = username.trim().toLowerCase();
    const cleanEmail = regEmail.trim();
    const cleanPhone = phoneNumber.trim();
    const cleanRef = referralCode.trim().toUpperCase();

    if (cleanName.length < 2 || cleanName.length > 80) {
      setRegError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUser)) {
      setRegError('Username must be 3–30 characters using only letters, numbers, and underscores.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setRegError('Please enter a valid email address.');
      return;
    }
    if (cleanPhone.length < 6 || cleanPhone.length > 25) {
      setRegError('Please enter a valid mobile number.');
      return;
    }
    if (regPassword.length < 6) {
      setRegError('Password must be at least 6 characters long.');
      return;
    }
    if (!/[A-Za-z]/.test(regPassword) || !/[0-9]/.test(regPassword)) {
      setRegError('Password must include at least one letter and one number.');
      return;
    }
    if (regPassword !== confirmPassword) {
      setRegError('Passwords do not match.');
      return;
    }
    if (cleanRef && cleanRef === cleanUser.toUpperCase()) {
      setRegError('You cannot use your own referral code.');
      return;
    }
    if (!acceptedTerms) {
      setRegError('Please accept the Terms & Conditions and Rewarded Advertising Policy.');
      return;
    }

    setRegError('');
    setRegLoading(true);
    try {
      await registerUserWithEmail({
        fullName: cleanName,
        username: cleanUser,
        email: cleanEmail,
        phoneNumber: cleanPhone,
        password: regPassword,
        referralCode: cleanRef || undefined,
      });
      showToast('Account created! Please verify your email link to continue.', 'success');
      onAuthSuccess();
    } catch (err) {
      const msg = mapAuthError(err);
      setRegError(msg);
      showToast(msg, 'error');
    } finally {
      setRegLoading(false);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3.5 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        className="fixed inset-0"
        onClick={() => !anyBusy && onClose()}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-[26rem] sm:max-w-md mx-auto my-auto rounded-3xl bg-gradient-to-b from-[#12183E] to-[#0A0F28] border border-violet-400/30 shadow-2xl shadow-black/80 overflow-hidden max-h-[88dvh] flex flex-col">
        {/* Top ambient glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-40 rounded-full bg-violet-600/25 blur-3xl"
        />

        {/* Header */}
        <div className="relative z-10 flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <AdViewLogoMark size="sm" />
            <div className="min-w-0">
              <h2
                id="auth-modal-title"
                className="text-base sm:text-lg font-extrabold font-display text-white truncate"
              >
                {mode === 'forgot'
                  ? 'Reset Password'
                  : mode === 'register'
                    ? `Join ${effectiveSiteName}`
                    : branding.loginBrandingTitle && branding.loginBrandingTitle !== 'Welcome Back'
                      ? branding.loginBrandingTitle
                      : `Sign In to ${effectiveSiteName}`}
              </h2>
              <p className="text-xs text-violet-200/85 truncate">
                {reasonPrompt ||
                  (mode === 'register'
                    ? 'Create your account to earn & withdraw rewards'
                    : mode === 'forgot'
                      ? 'Receive a Firebase password reset email'
                      : branding.loginBrandingSubtitle || 'Sign in cleanly with Email or Google')}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={anyBusy}
            onClick={onClose}
            aria-label="Close authentication popup"
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Modal Body */}
        <div className="relative z-10 p-5 overflow-y-auto space-y-4">
          {/* Login / Register Mode Switcher */}
          {mode !== 'forgot' && (
            <div
              className="grid grid-cols-2 p-1 rounded-xl bg-[#06091B]/90 border border-white/10"
              role="tablist"
              aria-label="Authentication mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => {
                  setLoginError('');
                  setRegError('');
                  onModeChange('login');
                }}
                className={`min-h-[40px] rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  mode === 'login'
                    ? 'brand-gradient text-white shadow-md shadow-violet-900/40'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => {
                  setLoginError('');
                  setRegError('');
                  onModeChange('register');
                }}
                className={`min-h-[40px] rounded-lg text-xs sm:text-sm font-bold transition-all ${
                  mode === 'register'
                    ? 'brand-gradient text-white shadow-md shadow-violet-900/40'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          {/* LOGIN TAB */}
          {mode === 'login' && (
            <div className="space-y-4">
              <GoogleAuthButton
                label="Continue with Google"
                loading={googleLoading}
                disabled={loginLoading}
                onClick={handleGoogleAuth}
              />

              <div className="relative flex items-center justify-center">
                <span className="h-px flex-1 bg-white/10" />
                <span className="px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  or sign in with email
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-3.5" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="modal-login-email" className="block text-xs font-semibold text-slate-300">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="modal-login-email"
                      type="email"
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => {
                        setLoginEmail(e.target.value);
                        setLoginError('');
                      }}
                      placeholder="you@example.com"
                      className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="modal-login-pass" className="block text-xs font-semibold text-slate-300">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="modal-login-pass"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={loginPassword}
                      onChange={(e) => {
                        setLoginPassword(e.target.value);
                        setLoginError('');
                      }}
                      placeholder="Enter your password"
                      className="w-full h-11 pl-10 pr-12 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((p) => !p)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="min-h-[44px] min-w-[44px] absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <label className="inline-flex items-center gap-2 text-slate-300 cursor-pointer min-h-[38px]">
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
                      setResetEmail(loginEmail);
                      onModeChange('forgot');
                    }}
                    className="min-h-[38px] px-1 text-violet-300 hover:text-violet-200 font-medium"
                  >
                    Forgot password?
                  </button>
                </div>

                {loginError && (
                  <p
                    role="alert"
                    className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5 leading-relaxed"
                  >
                    {loginError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={anyBusy}
                  className="w-full min-h-[46px] px-5 py-2.5 rounded-xl brand-button text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loginLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Signing In...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* REGISTER TAB */}
          {mode === 'register' && (
            <div className="space-y-4">
              {!registrationEnabled && (
                <div
                  role="status"
                  className="rounded-xl bg-amber-500/10 border border-amber-400/35 px-3.5 py-2.5 text-xs text-amber-200 leading-relaxed text-center"
                >
                  New account registrations are temporarily unavailable. Please sign in instead.
                </div>
              )}

              <GoogleAuthButton
                label="Sign up with Google"
                loading={googleLoading}
                disabled={regLoading || !registrationEnabled}
                onClick={handleGoogleAuth}
              />

              <div className="relative flex items-center justify-center">
                <span className="h-px flex-1 bg-white/10" />
                <span className="px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  or register with email
                </span>
                <span className="h-px flex-1 bg-white/10" />
              </div>

              <form onSubmit={handleRegisterSubmit} className="space-y-3" noValidate>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="modal-reg-name" className="block text-xs font-semibold text-slate-300">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reg-name"
                        type="text"
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          setRegError('');
                        }}
                        placeholder="RJ Fahim"
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="modal-reg-user" className="block text-xs font-semibold text-slate-300">
                      Username
                    </label>
                    <div className="relative">
                      <AtSign className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reg-user"
                        type="text"
                        autoComplete="username"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''));
                          setRegError('');
                        }}
                        placeholder="rj_fahim"
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono-num"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="modal-reg-email" className="block text-xs font-semibold text-slate-300">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="modal-reg-email"
                      type="email"
                      autoComplete="email"
                      value={regEmail}
                      onChange={(e) => {
                        setRegEmail(e.target.value);
                        setRegError('');
                      }}
                      placeholder="you@email.com"
                      className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="modal-reg-phone" className="block text-xs font-semibold text-slate-300">
                      Mobile Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reg-phone"
                        type="tel"
                        autoComplete="tel"
                        value={phoneNumber}
                        onChange={(e) => {
                          setPhoneNumber(e.target.value);
                          setRegError('');
                        }}
                        placeholder="+880 17XX-XXXXXX"
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="modal-reg-ref" className="block text-xs font-semibold text-slate-300">
                      Referral Code (Optional)
                    </label>
                    <div className="relative">
                      <Gift className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reg-ref"
                        type="text"
                        value={referralCode}
                        onChange={(e) => {
                          setReferralCode(e.target.value.toUpperCase());
                          setRegError('');
                        }}
                        placeholder="ADV12345"
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono-num"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="modal-reg-pass" className="block text-xs font-semibold text-slate-300">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reg-pass"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={regPassword}
                        onChange={(e) => {
                          setRegPassword(e.target.value);
                          setRegError('');
                        }}
                        placeholder="Letters + numbers"
                        className="w-full h-11 pl-9 pr-10 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((p) => !p)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="min-h-[40px] min-w-[36px] absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="modal-reg-confirm" className="block text-xs font-semibold text-slate-300">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reg-confirm"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setRegError('');
                        }}
                        placeholder="Re-enter password"
                        className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                      />
                    </div>
                  </div>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => {
                      setAcceptedTerms(e.target.checked);
                      setRegError('');
                    }}
                    className="w-4 h-4 mt-0.5 rounded accent-violet-600 shrink-0"
                  />
                  <span className="leading-relaxed">
                    I agree to the Terms &amp; Conditions and authorized Rewarded Advertising Policy.
                  </span>
                </label>

                {regError && (
                  <p
                    role="alert"
                    className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5 leading-relaxed"
                  >
                    {regError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={anyBusy || !registrationEnabled}
                  className="w-full min-h-[46px] px-5 py-2.5 rounded-xl brand-button text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {regLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Account</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {/* FORGOT PASSWORD TAB */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              {resetSent ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-300 leading-relaxed">
                    We sent a password reset link to{' '}
                    <span className="font-semibold text-white">{resetEmail}</span>. Check your
                    inbox and spam folder to set a new password.
                  </p>
                  <button
                    type="button"
                    onClick={() => onModeChange('login')}
                    className="w-full min-h-[44px] rounded-xl brand-button text-white text-sm font-semibold"
                  >
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleResetSubmit} className="space-y-4" noValidate>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="modal-reset-email"
                      className="block text-xs font-semibold text-slate-300"
                    >
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="modal-reset-email"
                        type="email"
                        required
                        value={resetEmail}
                        onChange={(e) => {
                          setResetEmail(e.target.value);
                          setResetError('');
                        }}
                        placeholder="you@example.com"
                        className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                      />
                    </div>
                  </div>
                  {resetError && (
                    <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3.5 py-2.5">
                      {resetError}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={resetLoading}
                    className="w-full min-h-[46px] rounded-xl brand-button text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60"
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
                  <button
                    type="button"
                    onClick={() => onModeChange('login')}
                    className="w-full min-h-[40px] text-xs font-semibold text-slate-300 hover:text-white inline-flex items-center justify-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Sign In</span>
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
