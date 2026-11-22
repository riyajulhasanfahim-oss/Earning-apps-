import React, { createContext, useContext } from 'react';
import type { SiteSettingsConfig } from '../types';

export const DEFAULT_PRIMARY_COLOR = '#7c3aed';
export const DEFAULT_SECONDARY_COLOR = '#2563eb';

export function sanitizeBrandUrl(rawUrl: string | undefined | null): string {
  const val = String(rawUrl || '').trim();
  if (!val) return '';
  if (val.startsWith('/') && !val.startsWith('//')) {
    return val;
  }
  try {
    const parsed = new URL(val);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // Reject malformed or dangerous schemes like javascript: or data:text/html
  }
  return '';
}

export function sanitizeHexColor(raw: string | undefined | null, fallback: string): string {
  const clean = String(raw || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean.toLowerCase() : fallback;
}

export function getDefaultBrandingConfig(): SiteSettingsConfig {
  return {
    websiteName: 'AdView Earn',
    websiteTitle: 'AdView Earn — Watch Ads, Earn Points & Withdraw',
    websiteLogoUrl: '',
    websiteFaviconUrl: '',
    loadingLogoUrl: '',
    websiteDescription:
      'Watch verified advertisements, earn reward points, invite friends, and withdraw securely via bKash, Nagad, Rocket & Bank Transfer.',
    primaryColor: DEFAULT_PRIMARY_COLOR,
    secondaryColor: DEFAULT_SECONDARY_COLOR,
    loginBrandingTitle: 'Welcome Back',
    loginBrandingSubtitle: 'Sign in cleanly with Email or Google',
    headerBrandText: 'AdView Earn',
    footerText: 'AdView Earn · Rewarded Advertising & Wallet Platform',
    supportEmail: 'support@adviewearn.com',
    supportContact: '',
    maintenanceMode: false,
    registrationEnabled: true,
  };
}

const SiteBrandingContext = createContext<SiteSettingsConfig>(getDefaultBrandingConfig());

export const SiteBrandingProvider: React.FC<{
  value: SiteSettingsConfig;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <SiteBrandingContext.Provider value={value}>{children}</SiteBrandingContext.Provider>
);

export function useSiteBranding(): SiteSettingsConfig {
  return useContext(SiteBrandingContext);
}

export function applyDocumentBranding(
  settings: SiteSettingsConfig,
  options?: { isAdmin?: boolean },
): void {
  if (typeof document === 'undefined') return;

  const siteName = settings.websiteName.trim() || 'AdView Earn';
  const baseTitle =
    settings.websiteTitle.trim() || `${siteName} — Watch Ads, Earn Points & Withdraw`;
  const finalTitle = options?.isAdmin ? `${siteName} — Admin Console` : baseTitle;
  document.title = finalTitle;

  const desc = settings.websiteDescription.trim();
  if (desc) {
    const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (metaDesc) metaDesc.content = desc;
    const ogDesc = document.querySelector<HTMLMetaElement>('meta[property="og:description"]');
    if (ogDesc) ogDesc.content = desc;
  }

  const ogTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = finalTitle;

  const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.content = siteName;

  const safeFavicon = sanitizeBrandUrl(settings.websiteFaviconUrl);
  if (safeFavicon) {
    let iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.head.appendChild(iconLink);
    }
    iconLink.href = safeFavicon;

    const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (appleIcon) {
      appleIcon.href = safeFavicon;
    }
  }

  const root = document.documentElement;
  const primary = sanitizeHexColor(settings.primaryColor, DEFAULT_PRIMARY_COLOR);
  const secondary = sanitizeHexColor(settings.secondaryColor, DEFAULT_SECONDARY_COLOR);
  root.style.setProperty('--accent-purple', primary);
  root.style.setProperty('--accent-blue', secondary);
}
