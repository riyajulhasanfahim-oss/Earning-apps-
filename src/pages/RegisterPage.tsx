import React, { useState } from 'react';
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
} from 'lucide-react';
import { AdViewLogoMark, BrandWordmark } from '../components/icons/BrandAssets';
import { GlassCard } from '../components/ui/GlassCard';
import {
  mapAuthError,
  registerUserWithEmail,
  signInWithGoogle,
} from '../services/authService';
import { GoogleAuthButton } from '../components/auth/GoogleAuthButton';
import { useToast } from '../components/ui/ToastProvider';
import { useSiteBranding } from '../contexts/SiteBrandingContext';

interface RegisterPageProps {
  initialReferralCode?: string;
  registrationEnabled?: boolean;
  siteName?: string;
  onBackToSplash: () => void;
  onGoLogin: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  initialReferralCode = '',
  registrationEnabled = true,
  siteName = 'AdView Earn',
  onBackToSplash,
  onGoLogin,
}) => {
  const { showToast } = useToast();
  const branding = useSiteBranding();
  const effectiveSiteName = siteName || branding.websiteName || 'AdView Earn';
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registrationEnabled) {
      setError(`New user registrations on ${siteName} are temporarily unavailable.`);
      return;
    }
    const cleanName = fullName.trim();
    const cleanUser = username.trim().toLowerCase();
    const cleanEmail = email.trim();
    const cleanPhone = phoneNumber.trim();
    const cleanRef = referralCode.trim().toUpperCase();

    if (cleanName.length < 2 || cleanName.length > 80) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(cleanUser)) {
      setError(
        'Username must be 3–30 characters using only letters, numbers, and underscores.',
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (cleanPhone.length < 6 || cleanPhone.length > 25) {
      setError('Please enter a valid mobile number.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must include at least one letter and one number.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (cleanRef && cleanRef === cleanUser.toUpperCase()) {
      setError('You cannot use your own referral code.');
      return;
    }
    if (!acceptedTerms) {
      setError('Please accept the Terms & Conditions and Rewarded Advertising Policy.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await registerUserWithEmail({
        fullName: cleanName,
        username: cleanUser,
        email: cleanEmail,
        phoneNumber: cleanPhone,
        password,
        referralCode: cleanRef || undefined,
      });
      showToast(
        'Account created! Please check your email for the verification link.',
        'success',
      );
    } catch (err) {
      const msg = mapAuthError(err);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (!registrationEnabled) {
      setError(`New user registrations on ${siteName} are temporarily unavailable.`);
      return;
    }
    setError('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle({
        referralCode: referralCode.trim() || initialReferralCode || undefined,
      });
      showToast('Signed up with Google successfully!', 'success');
    } catch (err) {
      const msg = mapAuthError(err);
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setGoogleLoading(false);
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
              name={branding.headerBrandText || effectiveSiteName}
              className="text-base font-extrabold font-display text-white"
            />
          </div>
        </div>

        <GlassCard className="p-6 sm:p-8 space-y-5">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-extrabold font-display text-white">Create Account</h1>
            <p className="text-sm text-slate-400">
              Register with {effectiveSiteName} to start securely
            </p>
          </div>

          {!registrationEnabled && (
            <div
              role="status"
              className="rounded-xl bg-amber-500/10 border border-amber-400/35 px-3.5 py-3 text-xs text-amber-200 leading-relaxed text-center"
            >
              New account registrations are temporarily unavailable. Please check back later or sign
              in to an existing account.
            </div>
          )}

          <GoogleAuthButton
            label="Sign up with Google"
            loading={googleLoading}
            disabled={loading || !registrationEnabled}
            onClick={handleGoogleSignUp}
          />

          <div className="relative flex items-center justify-center">
            <span className="h-px flex-1 bg-white/10" />
            <span className="px-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              or continue with email
            </span>
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
            <div className="space-y-1">
              <label htmlFor="reg-name" className="block text-xs font-semibold text-slate-300">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="reg-name"
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setError('');
                  }}
                  placeholder="RJ Fahim"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="reg-username" className="text-xs font-semibold text-slate-300">
                  Username
                </label>
                <span className="text-[11px] text-slate-400">
                  Unique ADV code auto-assigned
                </span>
              </div>
              <div className="relative">
                <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="reg-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''));
                    setError('');
                  }}
                  placeholder="rj_fahim"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono-num"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="you@email.com"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-1">
                <label htmlFor="reg-phone" className="block text-xs font-semibold text-slate-300">
                  Mobile Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="reg-phone"
                    type="tel"
                    autoComplete="tel"
                    value={phoneNumber}
                    onChange={(e) => {
                      setPhoneNumber(e.target.value);
                      setError('');
                    }}
                    placeholder="+880 17XX-XXXXXX"
                    className="w-full h-11 pl-10 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="reg-ref" className="block text-xs font-semibold text-slate-300">
                  Referral Code (Optional)
                </label>
                <div className="relative">
                  <Gift className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="reg-ref"
                    type="text"
                    value={referralCode}
                    onChange={(e) => {
                      setReferralCode(e.target.value.toUpperCase());
                      setError('');
                    }}
                    placeholder="Optional code"
                    className="w-full h-11 pl-10 pr-3 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400 font-mono-num"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="reg-password" className="block text-xs font-semibold text-slate-300">
                Password (letters + numbers, min 6)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Create a strong password"
                  className="w-full h-11 pl-10 pr-12 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
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

            <div className="space-y-1">
              <label htmlFor="reg-confirm" className="block text-xs font-semibold text-slate-300">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="reg-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Re-enter password"
                  className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#070B22]/90 border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => {
                  setAcceptedTerms(e.target.checked);
                  setError('');
                }}
                className="w-4 h-4 mt-0.5 rounded accent-violet-600 shrink-0"
              />
              <span className="leading-relaxed">
                I agree to the Terms &amp; Conditions and authorized Rewarded Advertising Policy.
              </span>
            </label>

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
              disabled={loading || !registrationEnabled}
              className="w-full min-h-[48px] px-6 py-3 rounded-xl brand-button text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
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

          <div className="pt-3 border-t border-white/10 text-center text-xs text-slate-400">
            Already have an account?{' '}
            <button
              type="button"
              onClick={onGoLogin}
              className="text-violet-300 hover:text-violet-200 font-semibold py-2 px-1"
            >
              Login
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
