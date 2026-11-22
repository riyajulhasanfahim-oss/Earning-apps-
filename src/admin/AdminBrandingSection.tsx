import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Globe,
  Image as ImageIcon,
  Loader2,
  Palette,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Type,
} from 'lucide-react';
import { AdminRole, SiteSettingsConfig } from '../types';
import { hasAdminPermission, saveSiteSettingsConfig } from '../services/adminService';
import {
  applyDocumentBranding,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  sanitizeBrandUrl,
  sanitizeHexColor,
} from '../contexts/SiteBrandingContext';
import { useToast } from '../components/ui/ToastProvider';

interface AdminBrandingSectionProps {
  siteSettings: SiteSettingsConfig;
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

export const AdminBrandingSection: React.FC<AdminBrandingSectionProps> = ({
  siteSettings,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const canEdit = hasAdminPermission(adminRole, 'manage_site_settings');

  const [form, setForm] = useState<SiteSettingsConfig>(siteSettings);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [logoImgErr, setLogoImgErr] = useState(false);
  const [loadingImgErr, setLoadingImgErr] = useState(false);
  const [faviconImgErr, setFaviconImgErr] = useState(false);

  useEffect(() => {
    if (!dirty) {
      setForm(siteSettings);
    }
  }, [siteSettings, dirty]);

  const updateField = <K extends keyof SiteSettingsConfig>(
    key: K,
    value: SiteSettingsConfig[K],
  ) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === 'websiteLogoUrl') setLogoImgErr(false);
    if (key === 'loadingLogoUrl') setLoadingImgErr(false);
    if (key === 'websiteFaviconUrl') setFaviconImgErr(false);
  };

  const previewPrimary = sanitizeHexColor(form.primaryColor, DEFAULT_PRIMARY_COLOR);
  const previewSecondary = sanitizeHexColor(form.secondaryColor, DEFAULT_SECONDARY_COLOR);
  const safeLogoUrl = sanitizeBrandUrl(form.websiteLogoUrl);
  const safeLoadingUrl = sanitizeBrandUrl(form.loadingLogoUrl);
  const safeFaviconUrl = sanitizeBrandUrl(form.websiteFaviconUrl);

  const handleResetColors = () => {
    setDirty(true);
    setForm((prev) => ({
      ...prev,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      secondaryColor: DEFAULT_SECONDARY_COLOR,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      showToast('Only Super Admin can update website branding settings.', 'error');
      return;
    }

    const cleanName = form.websiteName.trim();
    if (cleanName.length < 2) {
      showToast('Website Name must be at least 2 characters.', 'error');
      return;
    }

    const urlFields: Array<{ label: string; raw: string }> = [
      { label: 'Website Logo URL', raw: form.websiteLogoUrl },
      { label: 'Loading Logo URL', raw: form.loadingLogoUrl },
      { label: 'Favicon URL', raw: form.websiteFaviconUrl },
    ];
    for (const item of urlFields) {
      if (item.raw.trim() && !sanitizeBrandUrl(item.raw)) {
        showToast(`${item.label} must start with https://, http://, or /.`, 'error');
        return;
      }
    }

    const payload: SiteSettingsConfig = {
      ...form,
      websiteName: cleanName,
      websiteTitle: form.websiteTitle.trim() || `${cleanName} — Watch Ads & Earn Rewards`,
      websiteLogoUrl: sanitizeBrandUrl(form.websiteLogoUrl),
      loadingLogoUrl: sanitizeBrandUrl(form.loadingLogoUrl),
      websiteFaviconUrl: sanitizeBrandUrl(form.websiteFaviconUrl),
      websiteDescription: form.websiteDescription.trim(),
      primaryColor: sanitizeHexColor(form.primaryColor, DEFAULT_PRIMARY_COLOR),
      secondaryColor: sanitizeHexColor(form.secondaryColor, DEFAULT_SECONDARY_COLOR),
      loginBrandingTitle: form.loginBrandingTitle.trim() || 'Welcome Back',
      loginBrandingSubtitle: form.loginBrandingSubtitle.trim() || 'Sign in cleanly with Email or Google',
      headerBrandText: form.headerBrandText.trim() || cleanName,
      footerText:
        form.footerText.trim() || `${cleanName} · Rewarded Advertising & Wallet Platform`,
    };

    setSaving(true);
    try {
      await saveSiteSettingsConfig({
        next: payload,
        previous: siteSettings,
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
      });
      applyDocumentBranding(payload, { isAdmin: true });
      setForm(payload);
      setDirty(false);
      showToast('Website branding saved and published across the platform.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save branding settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-extrabold font-display text-white">
              Website Branding &amp; Configuration
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Customize your website name, title, logos, favicon, theme colors, header, footer, and
            login screen branding. Changes publish immediately via Firestore{' '}
            <code className="text-violet-300">appSettings/site</code>.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setForm(siteSettings);
                setDirty(false);
              }}
              className="min-h-[42px] px-3.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Discard</span>
            </button>
          )}
          <button
            type="submit"
            disabled={!canEdit || saving}
            className="min-h-[42px] px-5 rounded-xl brand-button text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{saving ? 'Publishing...' : 'Save & Publish Branding'}</span>
          </button>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
          <span>
            Viewing in read-only mode. Only <strong>Super Admin</strong> accounts can publish website
            branding updates.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left 8 cols: Form Sections */}
        <div className="xl:col-span-8 space-y-6">
          {/* 1. Core Identity & SEO */}
          <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <Globe className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold font-display text-white">
                Identity, Header, Footer &amp; Meta
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Website Name *
                </label>
                <input
                  type="text"
                  required
                  disabled={!canEdit}
                  value={form.websiteName}
                  onChange={(e) => updateField('websiteName', e.target.value)}
                  placeholder="AdView Earn"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Website Title (Browser Tab)
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={form.websiteTitle}
                  onChange={(e) => updateField('websiteTitle', e.target.value)}
                  placeholder="AdView Earn — Watch Ads, Earn Points & Withdraw"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Header Branding Text
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={form.headerBrandText}
                  onChange={(e) => updateField('headerBrandText', e.target.value)}
                  placeholder="AdView Earn"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
                <p className="text-[11px] text-slate-500">
                  Last word automatically highlights in gold accent across headers.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Footer Branding Text
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={form.footerText}
                  onChange={(e) => updateField('footerText', e.target.value)}
                  placeholder="AdView Earn · Rewarded Advertising & Wallet Platform"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                Website Description (Meta &amp; Social Summary)
              </label>
              <textarea
                rows={3}
                disabled={!canEdit}
                value={form.websiteDescription}
                onChange={(e) => updateField('websiteDescription', e.target.value)}
                placeholder="Describe your platform for search engines and social share previews..."
                className="w-full p-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {/* 2. Logos & Favicon */}
          <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-bold font-display text-white">
                  Logos &amp; Favicon Assets
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">
                Leave blank to keep built-in vector mark
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="w-14 h-14 rounded-xl bg-[#070B22] border border-white/15 flex items-center justify-center shrink-0 overflow-hidden p-1.5">
                  {safeLogoUrl && !logoImgErr ? (
                    <img
                      src={safeLogoUrl}
                      alt="Logo Preview"
                      onError={() => setLogoImgErr(true)}
                      className="w-full h-full object-contain rounded-lg"
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 text-center">
                      Default SVG
                    </span>
                  )}
                </div>
                <div className="flex-1 w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Website Logo URL
                  </label>
                  <input
                    type="url"
                    disabled={!canEdit}
                    value={form.websiteLogoUrl}
                    onChange={(e) => updateField('websiteLogoUrl', e.target.value)}
                    placeholder="https://example.com/logo.png or /pwa-192x192.png"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="w-14 h-14 rounded-xl bg-[#070B22] border border-white/15 flex items-center justify-center shrink-0 overflow-hidden p-1.5">
                  {safeLoadingUrl && !loadingImgErr ? (
                    <img
                      src={safeLoadingUrl}
                      alt="Loading Logo Preview"
                      onError={() => setLoadingImgErr(true)}
                      className="w-full h-full object-contain rounded-lg"
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 text-center">
                      Uses Main
                    </span>
                  )}
                </div>
                <div className="flex-1 w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Website Loading Logo URL
                  </label>
                  <input
                    type="url"
                    disabled={!canEdit}
                    value={form.loadingLogoUrl}
                    onChange={(e) => updateField('loadingLogoUrl', e.target.value)}
                    placeholder="https://example.com/loading-logo.png"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <div className="w-14 h-14 rounded-xl bg-[#070B22] border border-white/15 flex items-center justify-center shrink-0 overflow-hidden p-2">
                  {safeFaviconUrl && !faviconImgErr ? (
                    <img
                      src={safeFaviconUrl}
                      alt="Favicon Preview"
                      onError={() => setFaviconImgErr(true)}
                      className="w-8 h-8 object-contain"
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500 text-center">
                      /icon.svg
                    </span>
                  )}
                </div>
                <div className="flex-1 w-full space-y-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Website Favicon URL
                  </label>
                  <input
                    type="url"
                    disabled={!canEdit}
                    value={form.websiteFaviconUrl}
                    onChange={(e) => updateField('websiteFaviconUrl', e.target.value)}
                    placeholder="https://example.com/favicon.png or /icon.svg"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 3. Theme Colors & Login Screen Copy */}
          <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold font-display text-white">
                  Theme Colors &amp; Login Page Branding
                </h3>
              </div>
              <button
                type="button"
                disabled={!canEdit}
                onClick={handleResetColors}
                className="text-[11px] font-semibold text-violet-300 hover:text-violet-200 disabled:opacity-50"
              >
                Reset Colors to Default
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Primary Accent Color
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    type="color"
                    disabled={!canEdit}
                    value={previewPrimary}
                    onChange={(e) => updateField('primaryColor', e.target.value)}
                    aria-label="Pick primary color"
                    className="w-11 h-11 rounded-xl bg-[#070B22] border border-white/15 cursor-pointer p-1"
                  />
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={form.primaryColor}
                    onChange={(e) => updateField('primaryColor', e.target.value)}
                    placeholder="#7c3aed"
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Secondary Accent Color
                </label>
                <div className="flex items-center gap-2.5">
                  <input
                    type="color"
                    disabled={!canEdit}
                    value={previewSecondary}
                    onChange={(e) => updateField('secondaryColor', e.target.value)}
                    aria-label="Pick secondary color"
                    className="w-11 h-11 rounded-xl bg-[#070B22] border border-white/15 cursor-pointer p-1"
                  />
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={form.secondaryColor}
                    onChange={(e) => updateField('secondaryColor', e.target.value)}
                    placeholder="#2563eb"
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Login Page Heading
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={form.loginBrandingTitle}
                  onChange={(e) => updateField('loginBrandingTitle', e.target.value)}
                  placeholder="Welcome Back"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300">
                  Login Page Subtitle
                </label>
                <input
                  type="text"
                  disabled={!canEdit}
                  value={form.loginBrandingSubtitle}
                  onChange={(e) => updateField('loginBrandingSubtitle', e.target.value)}
                  placeholder="Sign in cleanly with Email or Google"
                  className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#070B22] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 cols: Live Interactive Preview */}
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-4 sticky top-20">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold font-display text-white">Live Brand Preview</h3>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-400/25">
                Real-Time
              </span>
            </div>

            {/* Header Preview */}
            <div className="rounded-xl border border-white/10 bg-[#06091B] p-3.5 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Header &amp; Sidebar Brand
              </p>
              <div className="flex items-center gap-2.5">
                {safeLogoUrl && !logoImgErr ? (
                  <img
                    src={safeLogoUrl}
                    alt="Preview"
                    className="w-8 h-8 rounded-lg object-contain bg-white/5 p-0.5"
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                    style={{
                      background: `linear-gradient(135deg, ${previewPrimary}, ${previewSecondary})`,
                    }}
                  >
                    <Sparkles className="w-4 h-4" />
                  </div>
                )}
                <span className="text-sm font-extrabold font-display text-white truncate">
                  {form.headerBrandText || form.websiteName || 'AdView Earn'}
                </span>
              </div>
            </div>

            {/* Login Box Preview */}
            <div className="rounded-xl border border-white/10 bg-[#06091B] p-4 space-y-3 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Login Screen Branding
              </p>
              <h4 className="text-base font-extrabold font-display text-white">
                {form.loginBrandingTitle || 'Welcome Back'}
              </h4>
              <p className="text-xs text-slate-400 leading-snug">
                {form.loginBrandingSubtitle || 'Sign in cleanly with Email or Google'}
              </p>
              <div
                className="h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${previewPrimary}, ${previewSecondary})`,
                }}
              >
                Sign In Button Gradient
              </div>
            </div>

            {/* Browser Tab & Footer Preview */}
            <div className="rounded-xl border border-white/10 bg-[#06091B] p-3.5 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Browser Tab &amp; Footer
              </p>
              <p className="text-xs font-semibold text-violet-200 truncate">
                {form.websiteTitle || `${form.websiteName || 'AdView Earn'} — Watch Ads`}
              </p>
              <p className="text-[11px] text-slate-400 line-clamp-2">
                {form.websiteDescription || 'No description provided.'}
              </p>
              <div className="pt-2 border-t border-white/10 text-[10px] text-slate-500 truncate">
                {form.footerText || `${form.websiteName || 'AdView Earn'} · Footer`}
              </div>
            </div>

            <div className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed pt-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                All existing Wallet, Payment Gateway, Monetag, Referral, and Fraud protections
                remain 100% intact.
              </span>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
};
