import React from 'react';
import { ArrowRight, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import { AdViewLogoMark, BrandWordmark, SplashHeroIllustration } from '../components/icons/BrandAssets';
import { useSiteBranding } from '../contexts/SiteBrandingContext';

interface SplashPageProps {
  onGetStarted: () => void;
  onGoLogin: () => void;
  onGoRegister: () => void;
}

export const SplashPage: React.FC<SplashPageProps> = ({
  onGetStarted,
  onGoLogin,
  onGoRegister,
}) => {
  const branding = useSiteBranding();
  return (
    <div className="min-h-dvh flex flex-col justify-between px-5 py-8 sm:px-8 lg:px-12 max-w-6xl mx-auto">
      {/* Minimal Header */}
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <AdViewLogoMark size="sm" />
          <BrandWordmark
            name={branding.headerBrandText || branding.websiteName}
            className="text-lg font-extrabold font-display tracking-tight text-white whitespace-nowrap"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onGoLogin}
            className="min-h-[44px] px-4 text-sm font-medium text-slate-200 hover:text-white transition-colors whitespace-nowrap"
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={onGoRegister}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm font-semibold text-white transition-colors whitespace-nowrap"
          >
            Register
          </button>
        </div>
      </header>

      {/* Main Content: 2-Column on Desktop, Vertical Hero on Mobile matching Reference Mockup */}
      <main className="my-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <div className="lg:col-span-6 flex flex-col items-center lg:items-start text-center lg:text-left space-y-6">
          <div className="flex flex-col items-center lg:items-start gap-3">
            <AdViewLogoMark size="lg" />
            <h1 className="text-4xl sm:text-5xl font-extrabold font-display tracking-tight text-white">
              <BrandWordmark name={branding.websiteName} />
            </h1>
            <p className="text-sm sm:text-base text-slate-300 font-medium">
              Watch Ads <span aria-hidden="true">·</span> Earn Points{' '}
              <span aria-hidden="true">·</span> Withdraw
            </p>
          </div>

          <div className="lg:hidden w-full py-2">
            <SplashHeroIllustration />
          </div>

          <div className="space-y-3 max-w-md">
            <h2 className="text-2xl sm:text-3xl font-bold font-display text-white leading-snug text-balance">
              Start Watching Ads &amp; Earn{' '}
              <span className="text-amber-400">Real Rewards!</span>
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Explore partner ad placements, track daily views and referral bonuses in real time,
              and manage payouts cleanly through bKash, Nagad, or Bank Transfer.
            </p>
          </div>

          <div className="w-full max-w-sm space-y-3 pt-1">
            <button
              type="button"
              onClick={onGetStarted}
              className="w-full min-h-[52px] px-6 py-3.5 rounded-full brand-button text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <span>Get Started</span>
              <ArrowRight className="w-5 h-5" />
            </button>

            <div className="flex items-center justify-center lg:justify-start gap-4 text-xs text-slate-400 pt-1">
              <button
                type="button"
                onClick={onGoLogin}
                className="min-h-[40px] px-2 hover:text-white transition-colors"
              >
                Already have an account? <span className="text-violet-300 font-semibold">Login</span>
              </button>
            </div>
          </div>
        </div>

        {/* Desktop Showcase Visual + Highlights */}
        <div className="hidden lg:flex lg:col-span-6 flex-col items-center justify-center">
          <div className="w-full max-w-md glass-card rounded-3xl p-8 space-y-6">
            <SplashHeroIllustration />

            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/10 text-center">
              <div className="space-y-1">
                <Smartphone className="w-5 h-5 text-violet-400 mx-auto" />
                <p className="text-xs font-semibold text-white">Mobile First</p>
                <p className="text-[11px] text-slate-400">Thumb friendly</p>
              </div>
              <div className="space-y-1">
                <ShieldCheck className="w-5 h-5 text-emerald-400 mx-auto" />
                <p className="text-xs font-semibold text-white">Policy Verified</p>
                <p className="text-[11px] text-slate-400">S2S Ad Ready</p>
              </div>
              <div className="space-y-1">
                <Wallet className="w-5 h-5 text-amber-400 mx-auto" />
                <p className="text-xs font-semibold text-white">Fast Payouts</p>
                <p className="text-[11px] text-slate-400">Min. 1,000 Pts</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 pt-4">
        {branding.footerText || `${branding.websiteName || 'AdView Earn'} · Rewarded Advertising & Wallet Platform`}
      </footer>
    </div>
  );
};
