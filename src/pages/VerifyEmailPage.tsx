import React, { useState } from 'react';
import { CheckCircle2, Loader2, LogOut, MailCheck, RefreshCw, Send } from 'lucide-react';
import { AdViewLogoMark, BrandWordmark } from '../components/icons/BrandAssets';
import { GlassCard } from '../components/ui/GlassCard';
import { useSiteBranding } from '../contexts/SiteBrandingContext';
import {
  mapAuthError,
  refreshEmailVerification,
  resendVerificationEmail,
} from '../services/authService';
import { useToast } from '../components/ui/ToastProvider';

interface VerifyEmailPageProps {
  email: string;
  onVerified: () => void;
  onLogout: () => void;
}

export const VerifyEmailPage: React.FC<VerifyEmailPageProps> = ({
  email,
  onVerified,
  onLogout,
}) => {
  const { showToast } = useToast();
  const branding = useSiteBranding();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const handleCheckStatus = async () => {
    setChecking(true);
    try {
      const verified = await refreshEmailVerification();
      if (verified) {
        showToast('Email verified successfully! Entering dashboard.', 'success');
        onVerified();
      } else {
        showToast(
          'Email is not verified yet. Please open the verification link in your inbox (or spam folder).',
          'info',
        );
      }
    } catch (error) {
      showToast(mapAuthError(error), 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    try {
      await resendVerificationEmail();
      showToast('Verification email sent! Please check your inbox.', 'success');
      setCooldown(30);
      const timer = window.setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            window.clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error) {
      showToast(mapAuthError(error), 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-md mx-auto space-y-6">
        <div className="flex items-center justify-center gap-2.5">
          <AdViewLogoMark size="md" />
          <BrandWordmark
            name={branding.headerBrandText || branding.websiteName}
            className="text-xl font-extrabold font-display text-white"
          />
        </div>

        <GlassCard className="p-6 sm:p-8 space-y-6 text-center">
          <div className="w-16 h-16 rounded-2xl brand-gradient flex items-center justify-center text-white mx-auto shadow-xl shadow-violet-950/50">
            <MailCheck className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold font-display text-white">
              Verify Your Email
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              We sent a Firebase verification link to{' '}
              <span className="font-semibold text-amber-300 break-all">{email}</span>. Click the
              link in your inbox to activate your account and access your dashboard.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <button
              type="button"
              disabled={checking}
              onClick={handleCheckStatus}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl brand-button text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {checking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Checking Verification...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>I&apos;ve Verified — Continue</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={resending || cooldown > 0}
              onClick={handleResend}
              className="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/15 text-slate-200 font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
            >
              {resending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : cooldown > 0 ? (
                <>
                  <RefreshCw className="w-4 h-4" />
                  <span>Resend available in {cooldown}s</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Resend Verification Email</span>
                </>
              )}
            </button>
          </div>

          <div className="pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onLogout}
              className="min-h-[44px] px-4 text-xs font-semibold text-rose-300 hover:text-rose-200 inline-flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out &amp; use another account</span>
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
