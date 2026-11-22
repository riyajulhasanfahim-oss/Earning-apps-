import React, { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bell,
  CheckCheck,
  Coins,
  Database,
  Gift,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  Network,
  Palette,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AdminNotificationItem, AdminRole, AdminSectionKey } from '../types';
import { AdViewLogoMark, BrandWordmark } from '../components/icons/BrandAssets';
import { VerifiedAdminSession } from '../services/adminService';
import { useSiteBranding } from '../contexts/SiteBrandingContext';

interface AdminLayoutProps {
  siteName: string;
  adminEmail: string;
  adminRole: AdminRole;
  sessionInfo: VerifiedAdminSession;
  activeSection: AdminSectionKey;
  onSelectSection: (section: AdminSectionKey) => void;
  pendingWithdrawalsCount: number;
  pendingFraudReportsCount?: number;
  notifications: AdminNotificationItem[];
  onMarkAllRead: () => void;
  onMarkSingleRead: (id: string) => void;
  onExitToUserSite: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  key: AdminSectionKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'overview', label: 'Overview & Analytics', icon: LayoutDashboard },
  { key: 'users', label: 'User Management', icon: Users },
  { key: 'points', label: 'Points Management', icon: Coins },
  { key: 'withdrawals', label: 'Withdrawals', icon: Wallet },
  { key: 'ads', label: 'Advertisements', icon: Megaphone },
  { key: 'multi-direct-links', label: 'Multi Direct Link Ads Management', icon: Link2 },
  { key: 'ad-networks', label: 'Ad Networks', icon: Network },
  { key: 'referrals', label: 'Referrals', icon: Gift },
  { key: 'security-fraud', label: 'Security & Fraud', icon: ShieldAlert },
  { key: 'branding', label: 'Website Branding', icon: Palette },
  { key: 'firebase-project', label: 'Firebase Project', icon: Database },
  { key: 'settings', label: 'Website & Roles', icon: Settings },
  { key: 'audit-logs', label: 'Audit Logs', icon: Activity },
];

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  support_admin: 'Support Admin',
};

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  siteName,
  adminEmail,
  adminRole,
  sessionInfo,
  activeSection,
  onSelectSection,
  pendingWithdrawalsCount,
  pendingFraudReportsCount = 0,
  notifications,
  onMarkAllRead,
  onMarkSingleRead,
  onExitToUserSite,
  onLogout,
  children,
}) => {
  const branding = useSiteBranding();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const brandLabel = branding.headerBrandText || siteName || branding.websiteName || 'AdView Earn';

  const unreadCount = notifications.filter((n) => !n.read).length;
  const currentMeta = NAV_ITEMS.find((i) => i.key === activeSection) ?? NAV_ITEMS[0];

  const handleNavClick = (section: AdminSectionKey) => {
    onSelectSection(section);
    setMobileMenuOpen(false);
  };

  const SidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <AdViewLogoMark size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-extrabold font-display text-white truncate">
              <BrandWordmark name={brandLabel} />
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
              Admin Console
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Access Tier
          </span>
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
              adminRole === 'super_admin'
                ? 'bg-violet-500/20 text-violet-200 border-violet-400/35'
                : adminRole === 'admin'
                  ? 'bg-blue-500/20 text-blue-200 border-blue-400/35'
                  : 'bg-amber-500/15 text-amber-200 border-amber-400/35'
            }`}
          >
            {ROLE_LABELS[adminRole]}
          </span>
        </div>
        <p className="text-xs text-slate-300 truncate mt-1 font-medium">{adminEmail}</p>
        <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
          <span>
            {sessionInfo.claimsVerified
              ? 'Verified Custom Claims'
              : sessionInfo.verificationSource === 'bootstrap_super_admin'
                ? 'Verified Super Admin Session'
                : 'Verified Server Admin Doc'}
          </span>
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Admin navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.key;
          const badge =
            item.key === 'withdrawals' && pendingWithdrawalsCount > 0
              ? pendingWithdrawalsCount
              : item.key === 'security-fraud' && pendingFraudReportsCount > 0
                ? pendingFraudReportsCount
                : 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => handleNavClick(item.key)}
              className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center justify-between text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-violet-400 ${
                active
                  ? 'bg-gradient-to-r from-violet-600/25 to-blue-600/20 text-white border border-violet-400/35'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${active ? 'text-violet-300' : 'text-slate-400'}`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {badge > 0 && (
                <span className="ml-2 px-1.5 py-0.5 min-w-[20px] text-center rounded-md bg-amber-500/20 border border-amber-400/35 text-[11px] font-bold font-mono-num text-amber-200">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10 space-y-1.5">
        <button
          type="button"
          onClick={onExitToUserSite}
          className="w-full min-h-[42px] px-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] text-xs font-semibold text-slate-200 flex items-center justify-between transition-colors"
        >
          <span>Open User Portal</span>
          <ArrowUpRight className="w-4 h-4 text-slate-400" />
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="w-full min-h-[42px] px-3.5 rounded-xl border border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-semibold text-rose-200 flex items-center justify-between transition-colors"
        >
          <span>Sign Out</span>
          <LogOut className="w-4 h-4 text-rose-300" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#06091B] text-slate-100 flex overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-[264px] lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 bg-[#080D23] border-r border-white/10 z-30">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-[#080D23] border-r border-white/15 z-10">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-[264px] flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 h-16 bg-[#06091B]/90 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open admin navigation"
              className="lg:hidden min-h-[44px] min-w-[44px] rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-slate-200 hover:bg-white/10"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <BarChart3 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span>Admin</span>
                <span>/</span>
                <span className="text-slate-200 font-medium truncate">{currentMeta.label}</span>
              </div>
              <h1 className="text-base sm:text-lg font-extrabold font-display text-white truncate">
                {currentMeta.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {adminRole === 'support_admin' && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/30 text-[11px] font-semibold text-amber-200">
                <ShieldAlert className="w-3.5 h-3.5" />
                Read-Only Tier
              </span>
            )}

            <button
              type="button"
              onClick={() => setNotifDrawerOpen((prev) => !prev)}
              aria-label="Admin Notifications"
              className="relative min-h-[44px] min-w-[44px] px-3 rounded-xl border border-white/12 bg-white/[0.04] hover:bg-white/[0.08] flex items-center gap-2 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Bell className="w-4 h-4 text-violet-300" />
              <span className="hidden sm:inline">Alerts</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-bold font-mono-num">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      {/* Real-Time Admin Notification Drawer */}
      {notifDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Admin Notifications"
        >
          <div className="fixed inset-0" onClick={() => setNotifDrawerOpen(false)} />
          <div className="relative z-10 w-full max-w-md h-full bg-[#0B1026] border-l border-white/15 flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold font-display text-white">
                  Admin Notifications
                </h2>
                <p className="text-xs text-slate-400">
                  Live events from Registrations, Withdrawals, Fraud & Errors
                </p>
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="px-2.5 py-1.5 rounded-lg bg-violet-500/15 border border-violet-400/30 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/25 inline-flex items-center gap-1"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Mark All</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotifDrawerOpen(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                  aria-label="Close alerts"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-white/10">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No real-time alerts recorded in Firestore yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      onMarkSingleRead(n.id);
                      onSelectSection(n.targetSection);
                      setNotifDrawerOpen(false);
                    }}
                    className={`w-full text-left px-5 py-3.5 hover:bg-white/[0.04] transition-colors flex items-start gap-3 ${
                      n.read ? 'opacity-65' : 'bg-violet-500/[0.04]'
                    }`}
                  >
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        n.severity === 'critical'
                          ? 'bg-rose-400'
                          : n.severity === 'warning'
                            ? 'bg-amber-400'
                            : 'bg-blue-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white truncate">{n.title}</span>
                        <span className="text-[10px] font-mono-num text-slate-400 shrink-0">
                          {n.timeLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 leading-snug line-clamp-2">{n.message}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
