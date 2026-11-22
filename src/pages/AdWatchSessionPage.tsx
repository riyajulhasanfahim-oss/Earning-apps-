import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { AdSessionRecord, Advertisement } from '../types';
import { buildPlacementLaunchUrl } from '../services/adNetworkPolicy';
import { formatPoints } from '../services/appService';
import {
  cancelPendingAdSession,
  confirmSdkAdSessionReward,
  normalizeAdDurationSeconds,
  verifyAdSessionRewardStatus,
} from '../services/dashboardService';
import {
  extractMonetagZoneId,
  isTelegramMiniAppContext,
  showMonetagRewardedAd,
} from '../services/monetagSdk';
import {
  extractAppLixirSiteId,
  extractGamRewardedUnitPath,
  showAppLixirRewardedAd,
  showGoogleRewardedAd,
} from '../services/webRewardedSdk';
import { GlassCard } from '../components/ui/GlassCard';

const S2S_VERIFY_TIMEOUT_MS = 25_000;
const S2S_POLL_INTERVAL_MS = 2_500;

interface AdWatchSessionPageProps {
  ad: Advertisement;
  session: AdSessionRecord;
  onBackToAds: () => void;
}

export const AdWatchSessionPage: React.FC<AdWatchSessionPageProps> = ({
  ad,
  session,
  onBackToAds,
}) => {
  const requiredDuration = normalizeAdDurationSeconds(ad.estimatedDuration);
  const initialMountMsRef = useRef<number>(Date.now());
  const startedAtMs =
    session.createdAtMillis > 0 ? session.createdAtMillis : initialMountMsRef.current;

  const [elapsedSec, setElapsedSec] = useState<number>(() =>
    Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
  );
  const [sdkStatus, setSdkStatus] = useState<'idle' | 'launching' | 'verified' | 'failed'>('idle');
  const [sdkError, setSdkError] = useState('');
  const [verifyPhase, setVerifyPhase] = useState<
    'idle' | 'verifying' | 'success' | 'timeout' | 'failed'
  >('idle');
  const [verifyError, setVerifyError] = useState('');
  const [lastCallbackError, setLastCallbackError] = useState('');
  const [verifyRetryable, setVerifyRetryable] = useState(true);
  const [verifyRemainingSec, setVerifyRemainingSec] = useState<number>(
    Math.ceil(S2S_VERIFY_TIMEOUT_MS / 1000),
  );
  const [verifyAttempt, setVerifyAttempt] = useState(0);
  const [verifiedTxId, setVerifiedTxId] = useState('');
  const [creditedPoints, setCreditedPoints] = useState<number>(session.expectedRewardPoints);
  const sdkVerifyAttemptKeyRef = useRef('');
  const sdkAutoLaunchedRef = useRef('');
  const onBackRef = useRef(onBackToAds);
  onBackRef.current = onBackToAds;

  const isTmaContext = useMemo(() => isTelegramMiniAppContext(), []);
  const monetagZoneId = extractMonetagZoneId(ad.placementOrUrl);
  const gamUnitPath = extractGamRewardedUnitPath(ad.placementOrUrl);
  const applixirSiteId = extractAppLixirSiteId(ad.placementOrUrl, ad.adNetwork);
  const monetagBlockedOutsideTma = Boolean(monetagZoneId && !isTmaContext);
  const activeSdkRef = gamUnitPath || (isTmaContext ? monetagZoneId : null);
  const isSdkDirectReward = Boolean(
    activeSdkRef &&
      ad.rewardVerificationMethod === 'sdk_callback' &&
      ad.adType !== 'direct_link',
  );

  const launchUrl = buildPlacementLaunchUrl(ad.placementOrUrl, {
    sessionId: session.sessionId,
    userId: session.userId,
    adId: ad.adId,
    adNetwork: ad.adNetwork,
  });

  useEffect(() => {
    const sync = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    sync();
    const timer = window.setInterval(sync, 250);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [startedAtMs]);

  const remainingSec = Math.max(0, requiredDuration - elapsedSec);
  const timerDone = remainingSec === 0;
  const progressPct = Math.min(100, Math.round((elapsedSec / requiredDuration) * 100));

  useEffect(() => {
    if (
      !timerDone ||
      !isSdkDirectReward ||
      !activeSdkRef ||
      sdkStatus !== 'verified' ||
      session.status !== 'pending' ||
      verifiedTxId
    ) {
      return;
    }
    const attemptKey = `${session.sessionId}:${verifyAttempt}`;
    if (sdkVerifyAttemptKeyRef.current === attemptKey) return;
    sdkVerifyAttemptKeyRef.current = attemptKey;

    let cancelled = false;
    setVerifyPhase('verifying');
    setVerifyError('');

    void confirmSdkAdSessionReward({
      sessionId: session.sessionId,
      adId: ad.adId,
      sdkZoneId: activeSdkRef,
      watchedSeconds: elapsedSec,
      sdkVerified: true,
      platformContext: gamUnitPath ? 'web_gpt' : 'telegram_mini_app',
    }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setCreditedPoints(res.rewardPoints ?? session.expectedRewardPoints);
        setVerifiedTxId(res.txId || session.sessionId);
        setVerifyPhase('success');
      } else {
        setVerifyPhase('failed');
        setVerifyRetryable(true);
        setVerifyError(res.error || 'Verification did not complete.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    timerDone,
    isSdkDirectReward,
    activeSdkRef,
    gamUnitPath,
    sdkStatus,
    ad.adId,
    session.status,
    session.sessionId,
    session.expectedRewardPoints,
    elapsedSec,
    verifiedTxId,
    verifyAttempt,
  ]);

  useEffect(() => {
    if (
      !timerDone ||
      isSdkDirectReward ||
      session.status !== 'pending' ||
      verifiedTxId ||
      sdkStatus === 'failed'
    ) {
      return;
    }
    if (applixirSiteId && sdkStatus === 'launching') {
      return;
    }

    let cancelled = false;
    const deadlineMs = Date.now() + S2S_VERIFY_TIMEOUT_MS;
    let consecutiveNetworkErrors = 0;
    let pollTimeout: number | undefined;

    setVerifyPhase('verifying');
    setVerifyError('');
    setLastCallbackError('');
    setVerifyRetryable(true);
    setVerifyRemainingSec(Math.ceil(S2S_VERIFY_TIMEOUT_MS / 1000));

    const countdownInterval = window.setInterval(() => {
      if (cancelled) return;
      setVerifyRemainingSec(Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000)));
    }, 250);

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      pollTimeout = window.setTimeout(() => {
        void pollOnce();
      }, delayMs);
    };

    const pollOnce = async () => {
      if (cancelled) return;
      const res = await verifyAdSessionRewardStatus(session.sessionId);
      if (cancelled) return;

      if (res.status === 'completed') {
        setCreditedPoints(res.rewardPoints ?? session.expectedRewardPoints);
        setVerifiedTxId(res.txId || session.sessionId);
        setVerifyPhase('success');
        return;
      }

      if (res.status === 'rejected' || res.status === 'backend_unavailable') {
        setVerifyPhase('failed');
        setVerifyRetryable(Boolean(res.retryable));
        setVerifyError(res.error || 'Verification rejected this ad session.');
        return;
      }

      if (res.status === 'error') {
        consecutiveNetworkErrors += 1;
        if (!res.retryable || consecutiveNetworkErrors >= 2 || Date.now() >= deadlineMs) {
          setVerifyPhase('failed');
          setVerifyRetryable(Boolean(res.retryable));
          setVerifyError(res.error || 'Unable to reach verification server.');
          return;
        }
        scheduleNext(S2S_POLL_INTERVAL_MS);
        return;
      }

      consecutiveNetworkErrors = 0;
      if (res.lastCallbackError) {
        setLastCallbackError(res.lastCallbackError);
      }

      if (Date.now() >= deadlineMs) {
        setVerifyPhase('timeout');
        setVerifyRetryable(true);
        return;
      }

      const nextDelay =
        res.status === 'awaiting_timer' && res.remainingSec
          ? Math.min(S2S_POLL_INTERVAL_MS, Math.max(800, res.remainingSec * 1000))
          : S2S_POLL_INTERVAL_MS;
      scheduleNext(nextDelay);
    };

    void pollOnce();

    return () => {
      cancelled = true;
      window.clearInterval(countdownInterval);
      if (pollTimeout !== undefined) {
        window.clearTimeout(pollTimeout);
      }
    };
  }, [
    timerDone,
    isSdkDirectReward,
    applixirSiteId,
    sdkStatus,
    session.status,
    session.sessionId,
    session.expectedRewardPoints,
    verifiedTxId,
    verifyAttempt,
  ]);

  const handleLaunchSdkAd = async () => {
    if (gamUnitPath) {
      setSdkStatus('launching');
      setSdkError('');
      const outcome = await showGoogleRewardedAd(gamUnitPath);
      if (outcome.verified) {
        setSdkStatus('verified');
      } else {
        setSdkStatus('failed');
        setSdkError(outcome.error || 'Advertisement could not be completed.');
      }
      return;
    }

    if (applixirSiteId) {
      setSdkStatus('launching');
      setSdkError('');
      const outcome = await showAppLixirRewardedAd(
        applixirSiteId,
        session.userId,
        session.sessionId,
        ad.adId,
      );
      if (outcome.verified) {
        setSdkStatus('verified');
      } else {
        setSdkStatus('failed');
        setSdkError(outcome.error || 'Video advertisement did not complete.');
      }
      return;
    }

    if (!monetagZoneId) return;
    if (!isTmaContext) {
      setSdkStatus('failed');
      setSdkError('This advertisement requires an authorized web link placement.');
      return;
    }
    setSdkStatus('launching');
    setSdkError('');
    const outcome = await showMonetagRewardedAd(monetagZoneId, session.sessionId);
    if (outcome.verified) {
      setSdkStatus('verified');
    } else {
      setSdkStatus('failed');
      setSdkError(outcome.error || 'Advertisement closed early. 0 points credited.');
    }
  };

  useEffect(() => {
    if (session.status !== 'pending') return;
    if (!applixirSiteId && !gamUnitPath && !(monetagZoneId && isTmaContext)) return;
    if (sdkAutoLaunchedRef.current === session.sessionId) return;
    sdkAutoLaunchedRef.current = session.sessionId;
    void handleLaunchSdkAd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applixirSiteId, gamUnitPath, monetagZoneId, isTmaContext, session.sessionId, session.status]);

  const isCompleted = session.status === 'completed' || Boolean(verifiedTxId);
  const displayPoints = creditedPoints > 0 ? creditedPoints : session.expectedRewardPoints;

  useEffect(() => {
    if (!isCompleted) return;
    const timer = window.setTimeout(() => {
      onBackRef.current();
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [isCompleted]);

  const handleRetryVerification = () => {
    setVerifyError('');
    setLastCallbackError('');
    setVerifyPhase('idle');
    setVerifyAttempt((prev) => prev + 1);
  };

  const handleBack = async () => {
    if (
      session.status === 'pending' &&
      !verifiedTxId &&
      !timerDone &&
      verifyPhase !== 'timeout' &&
      verifyPhase !== 'failed'
    ) {
      await cancelPendingAdSession(session.sessionId, 'CLOSED_BEFORE_30_SECONDS');
    }
    onBackToAds();
  };

  const isFailedState =
    session.status === 'rejected' ||
    sdkStatus === 'failed' ||
    verifyPhase === 'failed' ||
    Boolean(verifyError) ||
    Boolean(sdkError);
  const isTimeoutState = verifyPhase === 'timeout' && !isCompleted && session.status !== 'rejected';

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <GlassCard variant="gradient" className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-200 truncate">
              {ad.adNetwork}
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold font-display text-white truncate">
              {ad.adName}
            </h2>
          </div>
          <div className="text-right shrink-0 tabular-nums">
            <p className="text-xs text-violet-100/80">Reward</p>
            <p className="text-2xl font-extrabold font-display text-amber-300">
              +{formatPoints(ad.rewardPoints)} Pts
            </p>
          </div>
        </div>

        <div className="space-y-2 pt-3 border-t border-white/20">
          <div className="flex items-center justify-between text-xs text-violet-100 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {isCompleted ? 'Completed' : `${remainingSec}s remaining`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="relative h-2.5 rounded-full bg-black/35 border border-white/15 overflow-hidden">
            <div
              className="relative h-full rounded-full bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-400 transition-all duration-300"
              style={{ width: `${isCompleted ? 100 : Math.max(3, progressPct)}%` }}
            />
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5 space-y-4">
        {isCompleted ? (
          <div className="ad-success-pop p-5 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 flex items-center gap-3.5">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
            <div className="space-y-0.5">
              <p className="text-sm sm:text-base font-extrabold text-emerald-300">
                Congratulations! +{formatPoints(displayPoints)} Points Added Successfully.
              </p>
              <p className="text-xs text-slate-200">
                আপনার Wallet-এ Points যোগ হয়েছে।
              </p>
            </div>
          </div>
        ) : isFailedState ? (
          <div className="p-4 rounded-2xl bg-rose-500/15 border border-rose-400/35 space-y-3">
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-extrabold text-rose-300">
                  Verification Failed — 0 Points Credited
                </p>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {session.rejectionReason ||
                    verifyError ||
                    sdkError ||
                    'Advertisement was not completed.'}
                </p>
              </div>
            </div>
            {session.status !== 'rejected' && timerDone && verifyRetryable && sdkStatus !== 'failed' && (
              <button
                type="button"
                onClick={handleRetryVerification}
                className="w-full min-h-[40px] px-4 rounded-xl bg-rose-500/25 hover:bg-rose-500/35 border border-rose-300/40 text-xs font-bold text-white inline-flex items-center justify-center gap-2 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Verification</span>
              </button>
            )}
          </div>
        ) : isTimeoutState ? (
          <div className="p-4 rounded-2xl bg-amber-500/15 border border-amber-400/40 space-y-3">
            <div className="flex items-start gap-3">
              <Clock className="w-6 h-6 text-amber-300 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-extrabold text-amber-200">
                  Verification Pending from Ad Network
                </p>
                <p className="text-xs text-slate-200 leading-relaxed">
                  {lastCallbackError
                    ? lastCallbackError
                    : `${ad.adNetwork} S2S postback has not arrived yet. Please keep the ad tab open briefly, then tap Retry Verification.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRetryVerification}
              className="w-full min-h-[40px] px-4 rounded-xl bg-amber-500/25 hover:bg-amber-500/35 border border-amber-300/40 text-xs font-bold text-white inline-flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Verification</span>
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-indigo-500/15 border border-indigo-400/30 flex items-center gap-3">
            {timerDone && verifyPhase === 'verifying' ? (
              <Loader2 className="w-5 h-5 text-cyan-300 animate-spin shrink-0" />
            ) : (
              <Sparkles className="w-5 h-5 text-violet-300 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-white">
                {!timerDone
                  ? `Keep watching for ${remainingSec}s to earn your reward.`
                  : isSdkDirectReward || (applixirSiteId && sdkStatus === 'launching')
                    ? sdkStatus === 'launching'
                      ? 'Complete viewing the video ad to trigger reward confirmation.'
                      : 'Finalizing verified reward with server...'
                    : `Verifying reward with ${ad.adNetwork}... (${verifyRemainingSec}s)`}
              </p>
              {timerDone && lastCallbackError && (
                <p className="text-[11px] text-amber-200 mt-1">{lastCallbackError}</p>
              )}
            </div>
          </div>
        )}

        {!isCompleted && session.status !== 'rejected' && (
          <div className="space-y-2.5">
            {launchUrl && (
              <a
                href={launchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[46px] px-5 py-3 rounded-full brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2"
              >
                <span>Open Advertisement</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            {(gamUnitPath || applixirSiteId || (monetagZoneId && !monetagBlockedOutsideTma)) && (
              <button
                type="button"
                onClick={() => void handleLaunchSdkAd()}
                disabled={sdkStatus === 'launching'}
                className="w-full min-h-[46px] px-5 py-3 rounded-full brand-button text-white text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>
                  {sdkStatus === 'launching' ? 'Showing Advertisement...' : 'Open Advertisement'}
                </span>
              </button>
            )}
          </div>
        )}
      </GlassCard>

      <button
        type="button"
        onClick={() => void handleBack()}
        className="w-full min-h-[46px] px-5 py-3 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Close</span>
      </button>
    </div>
  );
};

