import React, { useState } from 'react';
import { sanitizeBrandUrl, useSiteBranding } from '../../contexts/SiteBrandingContext';

export const BrandWordmark: React.FC<{ name?: string; className?: string }> = ({
  name,
  className = '',
}) => {
  const branding = useSiteBranding();
  const rawName = (name ?? branding.headerBrandText ?? branding.websiteName ?? 'AdView Earn').trim() || 'AdView Earn';
  const parts = rawName.split(/\s+/);
  if (parts.length <= 1) {
    return <span className={className}>{rawName}</span>;
  }
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(' ');
  return (
    <span className={className}>
      {rest} <span className="text-amber-400">{last}</span>
    </span>
  );
};

export const AdViewLogoMark: React.FC<{ size?: 'sm' | 'md' | 'lg'; useLoadingLogo?: boolean }> = ({
  size = 'md',
  useLoadingLogo = false,
}) => {
  const branding = useSiteBranding();
  const [imgFailed, setImgFailed] = useState(false);

  const dims =
    size === 'lg' ? 'w-20 h-20' : size === 'md' ? 'w-10 h-10' : 'w-8 h-8';

  const candidateUrl = useLoadingLogo
    ? sanitizeBrandUrl(branding.loadingLogoUrl) || sanitizeBrandUrl(branding.websiteLogoUrl)
    : sanitizeBrandUrl(branding.websiteLogoUrl);

  if (candidateUrl && !imgFailed) {
    return (
      <img
        src={candidateUrl}
        alt={branding.websiteName || 'Website Logo'}
        onError={() => setImgFailed(true)}
        className={`${dims} shrink-0 rounded-xl object-contain drop-shadow-[0_6px_18px_rgba(124,58,237,0.35)]`}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${dims} shrink-0 drop-shadow-[0_6px_18px_rgba(124,58,237,0.45)]`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="avPlayGrad" x1="12" y1="22" x2="68" y2="74" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="48%" stopColor="#6D28D9" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id="avCrownGrad" x1="22" y1="6" x2="58" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="55%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      {/* Golden Crown */}
      <path
        d="M24 23L27 11L35.5 17.5L40 8L44.5 17.5L53 11L56 23H24Z"
        fill="url(#avCrownGrad)"
        stroke="#FEF3C7"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="10" r="2" fill="#FEF3C7" />
      <circle cx="40" cy="7" r="2.3" fill="#FEF3C7" />
      <circle cx="53" cy="10" r="2" fill="#FEF3C7" />
      {/* Play Container */}
      <rect
        x="14"
        y="23"
        width="52"
        height="48"
        rx="15"
        fill="url(#avPlayGrad)"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1.5"
      />
      {/* Glossy highlight */}
      <path
        d="M20 27H60C62.5 27 64 28.5 64 31V35C52 39 28 39 16 35V31C16 28.5 17.5 27 20 27Z"
        fill="rgba(255,255,255,0.16)"
      />
      {/* Play Triangle */}
      <path
        d="M34 37.5C34 35.8 35.9 34.8 37.3 35.7L51.5 45.2C52.7 46 52.7 47.8 51.5 48.6L37.3 58.1C35.9 59 34 58 34 56.3V37.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
};

export const UserAvatarGraphic: React.FC<{ className?: string }> = ({
  className = 'w-14 h-14',
}) => (
  <svg
    viewBox="0 0 96 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="User Profile Avatar"
  >
    <defs>
      <linearGradient id="avatarBg" x1="0" y1="0" x2="96" y2="96" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#60A5FA" />
        <stop offset="100%" stopColor="#6D28D9" />
      </linearGradient>
    </defs>
    <circle cx="48" cy="48" r="46" fill="url(#avatarBg)" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" />
    {/* Shoulders / Hoodie */}
    <path
      d="M20 84C22 69 33 62 48 62C63 62 74 69 76 84C68.5 90 58.7 94 48 94C37.3 94 27.5 90 20 84Z"
      fill="#3B82F6"
    />
    <path d="M35 66L48 76L61 66" stroke="#1E3A8A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {/* Neck & Face */}
    <rect x="42" y="53" width="12" height="14" rx="5" fill="#FDBA74" />
    <circle cx="48" cy="41" r="16" fill="#FED7AA" />
    {/* Hair */}
    <path
      d="M31 39C31 27 39 21 49 21C58 21 65 27 65 37C62 32 56 30 49 30C41 30 35 33 31 39Z"
      fill="#1E1B4B"
    />
    {/* Eyes & Smile */}
    <circle cx="42" cy="41" r="2" fill="#1E1B4B" />
    <circle cx="54" cy="41" r="2" fill="#1E1B4B" />
    <path d="M43 48C45.5 51 50.5 51 53 48" stroke="#9A3412" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const Wallet3DIcon: React.FC<{ className?: string }> = ({ className = 'w-14 h-14' }) => (
  <svg viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="walletBody" x1="8" y1="20" x2="62" y2="60" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FDE047" />
        <stop offset="55%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#B45309" />
      </linearGradient>
    </defs>
    {/* Banknotes peeking out */}
    <rect x="18" y="13" width="34" height="18" rx="4" transform="rotate(-8 18 13)" fill="#34D399" />
    <rect x="24" y="16" width="32" height="16" rx="4" transform="rotate(-3 24 16)" fill="#10B981" />
    {/* Wallet Main */}
    <rect x="10" y="23" width="50" height="36" rx="9" fill="url(#walletBody)" stroke="#FEF08A" strokeWidth="1.4" />
    {/* Flap */}
    <rect x="40" y="34" width="23" height="14" rx="5" fill="#EA580C" stroke="#FDE68A" strokeWidth="1.2" />
    <circle cx="48" cy="41" r="2.8" fill="#FEF3C7" />
  </svg>
);

export const GiftBox3DIcon: React.FC<{ className?: string }> = ({ className = 'w-12 h-12' }) => (
  <svg viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="giftBoxGrad" x1="12" y1="26" x2="58" y2="62" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FB7185" />
        <stop offset="100%" stopColor="#9F1239" />
      </linearGradient>
      <linearGradient id="giftRibbon" x1="32" y1="12" x2="40" y2="62" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="100%" stopColor="#F59E0B" />
      </linearGradient>
    </defs>
    {/* Bow */}
    <path d="M36 22C29 12 18 14 21 22C23 26 32 24 36 22Z" fill="#FBBF24" />
    <path d="M36 22C43 12 54 14 51 22C49 26 40 24 36 22Z" fill="#F59E0B" />
    {/* Lid */}
    <rect x="11" y="22" width="50" height="12" rx="4" fill="#F43F5E" stroke="#FDA4AF" strokeWidth="1.2" />
    {/* Base */}
    <rect x="15" y="33" width="42" height="28" rx="6" fill="url(#giftBoxGrad)" />
    {/* Vertical Ribbon */}
    <rect x="32" y="22" width="8" height="39" rx="2" fill="url(#giftRibbon)" />
  </svg>
);

export const CoinsStackIcon: React.FC<{ className?: string }> = ({ className = 'w-14 h-14' }) => (
  <svg viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="coinGold" x1="14" y1="14" x2="56" y2="60" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FEF08A" />
        <stop offset="50%" stopColor="#FBBF24" />
        <stop offset="100%" stopColor="#D97706" />
      </linearGradient>
    </defs>
    {/* Stack 1 */}
    <ellipse cx="26" cy="52" rx="14" ry="5.5" fill="#B45309" />
    <ellipse cx="26" cy="46" rx="14" ry="5.5" fill="url(#coinGold)" />
    <ellipse cx="26" cy="40" rx="14" ry="5.5" fill="#B45309" />
    <ellipse cx="26" cy="34" rx="14" ry="5.5" fill="url(#coinGold)" />
    <ellipse cx="26" cy="28" rx="14" ry="5.5" fill="#FEF08A" />
    {/* Stack 2 */}
    <ellipse cx="46" cy="54" rx="13" ry="5" fill="#92400E" />
    <ellipse cx="46" cy="48" rx="13" ry="5" fill="url(#coinGold)" />
    <ellipse cx="46" cy="42" rx="13" ry="5" fill="#FEF08A" />
    {/* Floating Coin */}
    <circle cx="48" cy="24" r="10" fill="url(#coinGold)" stroke="#FEF3C7" strokeWidth="1.5" />
    <text x="48" y="28" textAnchor="middle" fill="#78350F" fontSize="12" fontWeight="bold">
      ৳
    </text>
  </svg>
);

export const SplashHeroIllustration: React.FC = () => (
  <svg
    viewBox="0 0 320 230"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-full max-w-[290px] mx-auto drop-shadow-[0_20px_40px_rgba(109,40,217,0.35)]"
    aria-hidden="true"
  >
    <defs>
      <radialGradient id="splashAura" cx="50%" cy="55%" r="50%">
        <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.48" />
        <stop offset="100%" stopColor="#06091B" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="hoodieGrad" x1="80" y1="120" x2="210" y2="225" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#8B5CF6" />
        <stop offset="100%" stopColor="#4C1D95" />
      </linearGradient>
      <linearGradient id="arrowGrad" x1="190" y1="145" x2="285" y2="45" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#FEF08A" />
      </linearGradient>
    </defs>

    {/* Ambient Aura */}
    <ellipse cx="160" cy="128" rx="140" ry="92" fill="url(#splashAura)" />

    {/* Rising Gold Growth Arrow */}
    <path
      d="M196 146L258 84M258 84H232M258 84V110"
      stroke="url(#arrowGrad)"
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Floating Coins */}
    <g>
      <circle cx="56" cy="96" r="18" fill="#FBBF24" stroke="#FEF08A" strokeWidth="2.5" />
      <text x="56" y="102" textAnchor="middle" fill="#78350F" fontSize="16" fontWeight="800">৳</text>
    </g>
    <g>
      <circle cx="268" cy="136" r="16" fill="#F59E0B" stroke="#FEF08A" strokeWidth="2" />
      <text x="268" y="142" textAnchor="middle" fill="#78350F" fontSize="14" fontWeight="800">৳</text>
    </g>
    <g>
      <circle cx="242" cy="186" r="13" fill="#FBBF24" stroke="#FEF3C7" strokeWidth="1.8" />
      <text x="242" y="191" textAnchor="middle" fill="#78350F" fontSize="11" fontWeight="800">★</text>
    </g>

    {/* Character Body / Purple Hoodie */}
    <path
      d="M78 224C84 176 112 152 152 152C192 152 216 176 224 224H78Z"
      fill="url(#hoodieGrad)"
    />
    {/* Hoodie Collar & Strings */}
    <path d="M126 154C135 168 168 168 176 154" stroke="#C4B5FD" strokeWidth="4" strokeLinecap="round" />
    <path d="M140 166V195M164 166V190" stroke="#DDD6FE" strokeWidth="3" strokeLinecap="round" />

    {/* Neck & Head */}
    <rect x="139" y="124" width="24" height="32" rx="10" fill="#FDBA74" />
    <circle cx="151" cy="96" r="35" fill="#FED7AA" />
    {/* Hair */}
    <path
      d="M115 92C115 66 132 52 154 52C175 52 188 67 188 89C182 77 169 72 152 72C136 72 123 79 115 92Z"
      fill="#1E1B4B"
    />
    {/* Happy Eyes & Big Smile */}
    <circle cx="139" cy="95" r="3.5" fill="#1E1B4B" />
    <circle cx="163" cy="95" r="3.5" fill="#1E1B4B" />
    <path d="M139 109C145 117 157 117 163 109" stroke="#9A3412" strokeWidth="3.5" strokeLinecap="round" />

    {/* Smartphone Held in Hand */}
    <rect x="174" y="132" width="44" height="72" rx="8" transform="rotate(-10 174 132)" fill="#0F172A" stroke="#60A5FA" strokeWidth="2.5" />
    <rect x="180" y="140" width="32" height="48" rx="4" transform="rotate(-10 180 140)" fill="#4F46E5" />
    <path d="M196 154L208 162L196 170V154Z" fill="#FEF08A" />
  </svg>
);

export const BkashMark: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => (
  <div
    className={`${className} rounded-xl bg-gradient-to-br from-[#E2136E] to-[#B00C53] flex items-center justify-center shadow-md shadow-pink-900/30 shrink-0`}
  >
    <svg viewBox="0 0 32 32" className="w-5 h-5" fill="none" aria-hidden="true">
      <path d="M8 9L19 15L14 23L8 9Z" fill="#FFFFFF" />
      <path d="M19 15L25 11L21 21L14 23L19 15Z" fill="#FBCFE8" />
    </svg>
  </div>
);

export const NagadMark: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => (
  <div
    className={`${className} rounded-xl bg-gradient-to-br from-[#F97316] to-[#DC2626] flex items-center justify-center shadow-md shadow-orange-900/30 shrink-0`}
  >
    <svg viewBox="0 0 32 32" className="w-5 h-5" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="8" stroke="#FFFFFF" strokeWidth="2.4" />
      <path d="M12 16C12 13 15 11 19 12C17 15 17 18 20 20C16 21 12 19 12 16Z" fill="#FEF08A" />
    </svg>
  </div>
);

export const RocketMark: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => (
  <div
    className={`${className} rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#6B21A8] flex items-center justify-center shadow-md shadow-purple-900/35 shrink-0`}
  >
    <svg viewBox="0 0 32 32" className="w-5 h-5" fill="none" aria-hidden="true">
      <path
        d="M16 6C20 9 22 14 21 19L16 24L11 19C10 14 12 9 16 6Z"
        fill="#FFFFFF"
      />
      <circle cx="16" cy="14" r="2.4" fill="#7C3AED" />
      <path d="M11 18L7 21L11 22M21 18L25 21L21 22" stroke="#DDD6FE" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 24L16 27L18 24" stroke="#FDE047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

export const BankTransferMark: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => (
  <div
    className={`${className} rounded-xl bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center shadow-md shadow-blue-900/30 shrink-0`}
  >
    <svg viewBox="0 0 32 32" className="w-5 h-5" fill="none" aria-hidden="true">
      <path d="M6 12L16 6L26 12H6Z" fill="#FFFFFF" />
      <path d="M9 14V22M14 14V22M18 14V22M23 14V22M6 24H26" stroke="#DBEAFE" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </div>
);
