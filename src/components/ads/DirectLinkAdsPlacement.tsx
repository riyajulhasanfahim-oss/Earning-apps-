import React from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Link2,
  Loader2,
  Play,
  Sparkles,
} from 'lucide-react';
import { DirectLinkAdRecord, DirectLinkPlacement } from '../../types';
import { formatPoints } from '../../services/appService';
import {
  isVerifiedRewardedDirectLink,
  PLACEMENT_LABEL_MAP,
} from '../../services/multiDirectLinkService';

interface DirectLinkAdsPlacementProps {
  links: DirectLinkAdRecord[];
  placement: DirectLinkPlacement;
  heading?: string;
  subtitle?: string;
  initiatingAdId?: string | null;
  compact?: boolean;
  onStartRewardedDirectLink: (link: DirectLinkAdRecord) => void;
}

export const DirectLinkAdsPlacement: React.FC<DirectLinkAdsPlacementProps> = ({
  links,
  placement,
  heading,
  subtitle,
  initiatingAdId,
  compact = false,
  onStartRewardedDirectLink,
}) => {
  const slotLinks = links.filter(
    (item) => item.status === 'active' && item.placement === placement && /^https:\/\/.+/i.test(item.url),
  );

  if (slotLinks.length === 0) {
    return null;
  }

  return (
    <section
      aria-label={heading || PLACEMENT_LABEL_MAP[placement]}
      className={compact ? 'space-y-2.5' : 'space-y-3'}
    >
      {heading && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 border border-cyan-200/50 flex items-center justify-center text-white shadow-[0_0_14px_rgba(34,211,238,0.5)] shrink-0">
              <Link2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold font-display text-white truncate">
                {heading}
              </h3>
              {subtitle && (
                <p className="text-[11px] text-cyan-100/75 truncate">{subtitle}</p>
              )}
            </div>
          </div>
          <span className="text-[11px] font-semibold text-cyan-200/80 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-400/30">
            {slotLinks.length} Active {slotLinks.length === 1 ? 'Offer' : 'Offers'}
          </span>
        </div>
      )}

      <div
        className={
          compact
            ? 'grid grid-cols-1 sm:grid-cols-2 gap-2.5'
            : 'grid grid-cols-1 md:grid-cols-2 gap-3'
        }
      >
        {slotLinks.map((link) => {
          const isRewarded = isVerifiedRewardedDirectLink(link);
          const isBusy = initiatingAdId === link.linkId;

          return (
            <div
              key={link.linkId}
              className={`rounded-2xl p-3.5 sm:p-4 border flex items-center justify-between gap-3 transition-all ${
                isRewarded
                  ? 'bg-gradient-to-br from-[#17255A]/92 via-[#151D58]/95 to-[#0D2B59]/95 border-emerald-400/45 shadow-[0_10px_24px_-12px_rgba(16,185,129,0.4)] hover:border-emerald-300/75'
                  : 'bg-gradient-to-br from-[#11245A]/92 via-[#131B4B]/95 to-[#0B173D]/95 border-cyan-400/35 shadow-[0_10px_24px_-12px_rgba(34,211,238,0.35)] hover:border-cyan-300/65'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={`w-11 h-11 rounded-2xl border flex items-center justify-center text-white shrink-0 ${
                    isRewarded
                      ? 'bg-gradient-to-br from-emerald-500 to-cyan-600 border-emerald-300/60 shadow-[0_0_16px_rgba(52,211,153,0.45)]'
                      : 'bg-gradient-to-br from-cyan-500 to-blue-600 border-cyan-300/55 shadow-[0_0_14px_rgba(34,211,238,0.4)]'
                  }`}
                >
                  {isRewarded ? (
                    <Sparkles className="w-5 h-5" />
                  ) : (
                    <Link2 className="w-5 h-5" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                      {link.title}
                    </h4>
                  </div>

                  <p className="text-[11px] text-cyan-100/80 truncate">
                    {link.adNetwork} · Direct Link Offer
                  </p>

                  {isRewarded ? (
                    <p className="text-[11px] sm:text-xs text-slate-200 tabular-nums flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-emerald-300 font-extrabold">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />+
                        {formatPoints(link.rewardPoints)} Pts
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="inline-flex items-center gap-1 text-cyan-200/90">
                        <Clock className="w-3 h-3 shrink-0" />
                        {link.estimatedDuration}s
                      </span>
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-200/85 font-medium truncate">
                      Sponsored Partner Link
                    </p>
                  )}
                </div>
              </div>

              {isRewarded ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onStartRewardedDirectLink(link)}
                  className="min-h-[40px] px-3.5 sm:px-4 py-2 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-[#041826] text-xs font-extrabold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 shadow-[0_6px_18px_rgba(16,185,129,0.45)] transition-all active:scale-[0.97] disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{isBusy ? 'Starting...' : 'Watch & Earn'}</span>
                </button>
              ) : (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] px-3.5 sm:px-4 py-2 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-extrabold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 shadow-[0_6px_18px_rgba(14,165,233,0.4)] transition-all active:scale-[0.97]"
                >
                  <span>Visit Offer</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
