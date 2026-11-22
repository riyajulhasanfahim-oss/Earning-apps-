import React, { useEffect, useState } from 'react';
import { MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useToast } from '../ui/ToastProvider';

interface InstallAppBannerProps {
  siteName?: string;
}

export const InstallAppBanner: React.FC<InstallAppBannerProps> = ({
  siteName = 'AdView Earn',
}) => {
  const { showToast } = useToast();
  const {
    isInstallable,
    isInstalled,
    isDismissed,
    isIOS,
    isMobile,
    install,
    dismiss,
  } = usePWAInstall();

  const [readyToShow, setReadyToShow] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  // Brief settle window so native beforeinstallprompt attaches before showing fallback on mobile
  useEffect(() => {
    if (isInstallable) {
      setReadyToShow(true);
      return;
    }
    if (!isMobile || isInstalled || isDismissed) return;
    const timer = window.setTimeout(() => {
      setReadyToShow(true);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [isInstallable, isMobile, isInstalled, isDismissed]);

  if (isInstalled || isDismissed) {
    return null;
  }

  // Show on mobile (native prompt or honest install guide) or on desktop when native prompt is available
  const shouldRenderBanner = isInstallable || (isMobile && readyToShow);

  const handleInstallClick = async () => {
    if (installing) return;
    if (isInstallable) {
      setInstalling(true);
      try {
        const result = await install();
        if (result === 'accepted') {
          showToast(`${siteName} is being added to your Home Screen.`, 'success');
        } else if (result === 'unavailable') {
          setShowGuideModal(true);
        }
      } catch {
        setShowGuideModal(true);
      } finally {
        setInstalling(false);
      }
      return;
    }

    // Native prompt is unavailable (e.g., iOS Safari or browser without beforeinstallprompt)
    setShowGuideModal(true);
  };

  return (
    <>
      {shouldRenderBanner && (
        <aside
          aria-label="Install application banner"
          className="fixed z-40 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 right-3 max-w-md mx-auto lg:left-auto lg:right-6 lg:bottom-6 lg:w-[360px]"
        >
          <div className="rounded-2xl px-3 py-2.5 flex items-center gap-2.5 bg-[#0E1740]/96 backdrop-blur-md border border-cyan-300/35 shadow-[0_12px_28px_rgba(3,6,24,0.85),0_0_20px_rgba(56,189,248,0.2)]">
            <img
              src="/pwa-192x192.png"
              alt={`${siteName} logo`}
              width={44}
              height={44}
              className="w-11 h-11 rounded-xl object-cover shrink-0 border border-white/15 shadow-md"
            />

            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold font-display text-white leading-tight truncate">
                Install App
              </p>
              <p className="text-[11px] text-cyan-100/80 leading-snug truncate mt-0.5">
                Install {siteName} for a better experience
              </p>
            </div>

            <button
              type="button"
              onClick={handleInstallClick}
              disabled={installing}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl brand-button text-white text-xs font-extrabold whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {installing ? 'Opening...' : 'Install'}
            </button>

            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss install banner"
              className="min-h-[36px] min-w-[36px] -mr-1 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </aside>
      )}

      {/* Honest Browser-Specific Install Instructions Modal (when native prompt is unavailable) */}
      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div
            className="fixed inset-0"
            onClick={() => setShowGuideModal(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-sm rounded-3xl bg-gradient-to-b from-[#12183E] to-[#0A0F28] border border-cyan-300/35 p-5 shadow-2xl shadow-black/80 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/pwa-192x192.png"
                  alt=""
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-xl border border-white/15 shrink-0"
                />
                <div className="min-w-0">
                  <h2
                    id="pwa-install-guide-title"
                    className="text-base font-extrabold font-display text-white truncate"
                  >
                    Install {siteName}
                  </h2>
                  <p className="text-xs text-cyan-100/80">Add app to your Home Screen</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                aria-label="Close install instructions"
                className="min-h-[40px] min-w-[40px] -mr-1.5 -mt-1 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-xs text-slate-200 leading-relaxed bg-white/[0.04] border border-white/10 rounded-2xl p-3.5">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-violet-500/25 border border-violet-300/40 text-violet-200 font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    Tap the{' '}
                    <strong className="text-white inline-flex items-center gap-1">
                      <Share className="w-3.5 h-3.5 text-cyan-300" /> Share
                    </strong>{' '}
                    button in your Safari toolbar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-violet-500/25 border border-violet-300/40 text-violet-200 font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    Scroll down and select <strong className="text-white">Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-violet-500/25 border border-violet-300/40 text-violet-200 font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span>
                    Tap <strong className="text-white">Add</strong> in the top-right corner to install.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-xs text-slate-200 leading-relaxed bg-white/[0.04] border border-white/10 rounded-2xl p-3.5">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/25 border border-cyan-300/40 text-cyan-200 font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <span>
                    Open your browser menu{' '}
                    <strong className="text-white inline-flex items-center">
                      (<MoreVertical className="w-3.5 h-3.5 text-cyan-300" />)
                    </strong>{' '}
                    in Chrome or Edge.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/25 border border-cyan-300/40 text-cyan-200 font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <span>
                    Tap <strong className="text-white">Install app</strong> or{' '}
                    <strong className="text-white">Add to Home screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/25 border border-cyan-300/40 text-cyan-200 font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <span className="inline-flex items-center gap-1">
                    Confirm <strong className="text-white">Install</strong> to launch{' '}
                    <Smartphone className="w-3.5 h-3.5 text-emerald-300 shrink-0" /> from your
                    home screen.
                  </span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full min-h-[42px] rounded-xl brand-button text-white text-xs font-extrabold"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
