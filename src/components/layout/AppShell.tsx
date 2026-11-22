import React, { useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Clock,
  CreditCard,
  History,
  Home,
  LogIn,
  LogOut,
  Menu,
  PlaySquare,
  User,
  Users,
  Wallet,
  X,
  CheckCircle2,
} from 'lucide-react';
import { AppPage, NavTab, NotificationItem, UserProfile, WalletMetrics } from '../../types';
import { AdViewLogoMark, BrandWordmark, UserAvatarGraphic } from '../icons/BrandAssets';
import { formatBdt, formatPoints, pointsToBdt } from '../../services/appService';
import { ModalDrawer } from '../ui/ModalDrawer';
import { useSiteBranding } from '../../contexts/SiteBrandingContext';

interface AppShellProps {
  currentPage: AppPage;
  user: UserProfile;
  wallet: WalletMetrics;
  notifications: NotificationItem[];
  isAuthenticated?: boolean;
  onNavigate: (page: AppPage) => void;
  onMarkNotificationsRead: () => void;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  activeClass: string;
  inactiveIconClass: string;
  activeTextClass: string;
}> = [
  {
    id: 'home',
    label: 'Home',
    icon: Home,
    activeClass:
      'bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[0_0_20px_rgba(34,211,238,0.85)] ring-1 ring-cyan-200/70',
    inactiveIconClass: 'text-sky-300/85',
    activeTextClass: 'text-cyan-200 drop-shadow-[0_0_10px_rgba(56,189,248,0.8)]',
  },
  {
    id: 'earn',
    label: 'Earn',
    icon: PlaySquare,
    activeClass:
      'bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-[0_0_20px_rgba(192,38,211,0.75)] ring-1 ring-violet-200/70',
    inactiveIconClass: 'text-violet-300/85',
    activeTextClass: 'text-violet-200 drop-shadow-[0_0_10px_rgba(192,132,252,0.8)]',
  },
  {
    id: 'referral',
    label: 'Referral',
    icon: Users,
    activeClass:
      'bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[0_0_20px_rgba(16,185,129,0.8)] ring-1 ring-emerald-200/70',
    inactiveIconClass: 'text-emerald-300/85',
    activeTextClass: 'text-emerald-200 drop-shadow-[0_0_10px_rgba(52,211,153,0.8)]',
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: Wallet,
    activeClass:
      'bg-gradient-to-br from-amber-400 to-orange-500 text-[#071133] shadow-[0_0_20px_rgba(251,191,36,0.8)] ring-1 ring-amber-200/80',
    inactiveIconClass: 'text-amber-300/85',
    activeTextClass: 'text-amber-200 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]',
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: User,
    activeClass:
      'bg-gradient-to-br from-indigo-500 to-blue-400 text-white shadow-[0_0_20px_rgba(99,102,241,0.8)] ring-1 ring-indigo-200/70',
    inactiveIconClass: 'text-indigo-300/85',
    activeTextClass: 'text-indigo-200 drop-shadow-[0_0_10px_rgba(129,140,248,0.8)]',
  },
];

const PAGE_TITLES: Record<AppPage, string> = {
  splash: 'AdView Earn',
  login: 'Sign In',
  register: 'Create Account',
  'verify-email': 'Verify Email',
  home: 'AdView Earn',
  earn: 'Watch Ads',
  'watch-ad': 'Watch Advertisement',
  'ad-history': 'Ad History',
  referral: 'Referral Program',
  wallet: 'My Wallet',
  withdraw: 'Withdraw Request',
  'withdrawal-history': 'Withdrawal History',
  transactions: 'Transaction History',
  profile: 'My Profile',
};

export const AppShell: React.FC<AppShellProps> = ({
  currentPage,
  user,
  wallet,
  notifications,
  isAuthenticated = true,
  onNavigate,
  onMarkNotificationsRead,
  onOpenAuth,
  onLogout,
  children,
}) => {
  const branding = useSiteBranding();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const brandLabel = branding.headerBrandText || branding.websiteName || 'AdView Earn';

  const unreadCount = notifications.filter((n) => !n.read).length;

  const activeTab: NavTab =
    currentPage === 'withdraw' || currentPage === 'withdrawal-history'
      ? 'wallet'
      : currentPage === 'transactions'
        ? 'profile'
        : currentPage === 'watch-ad' || currentPage === 'ad-history'
          ? 'earn'
          : (currentPage as NavTab);

  const isSubPage = currentPage !== 'home';
  const bdtBalance = pointsToBdt(wallet.balancePoints, wallet.pointsPerBdt);

  const handleBack = () => {
    if (currentPage === 'withdraw') {
      onNavigate('wallet');
    } else if (currentPage === 'withdrawal-history') {
      onNavigate('withdraw');
    } else if (currentPage === 'transactions') {
      onNavigate('profile');
    } else if (currentPage === 'watch-ad' || currentPage === 'ad-history') {
      onNavigate('earn');
    } else {
      onNavigate('home');
    }
  };

  const openNotifications = () => {
    setNotifOpen(true);
    if (unreadCount > 0) {
      onMarkNotificationsRead();
    }
  };

  return (
    <div className="min-h-dvh flex flex-col lg:flex-row bg-[#06091B] text-slate-100 overflow-x-clip">
      {/* Desktop Responsive Sidebar */}
      <aside className="hidden lg:flex lg:w-[272px] lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 z-30 border-r border-violet-500/15 bg-[#080D25]/95 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
          <AdViewLogoMark size="md" />
          <div className="min-w-0">
            <BrandWordmark
              name={brandLabel}
              className="text-lg font-extrabold tracking-tight font-display text-white block truncate"
            />
          </div>
        </div>

        <nav className="flex-1 px-4 py-5 space-y-1.5 overflow-y-auto" aria-label="Primary Sidebar Navigation">
          <p className="px-3 pb-1 text-xs font-medium text-slate-400">Main Menu</p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                  isActive
                    ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t border-white/10 space-y-1.5">
            <p className="px-3 pb-1 text-xs font-medium text-slate-400">Finance &amp; Records</p>
            <button
              type="button"
              onClick={() => onNavigate('ad-history')}
              className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                currentPage === 'ad-history'
                  ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <History className="w-5 h-5 shrink-0" />
              <span>Ad History</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('withdraw')}
              className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                currentPage === 'withdraw'
                  ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <CreditCard className="w-5 h-5 shrink-0" />
              <span>Withdraw</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('withdrawal-history')}
              className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                currentPage === 'withdrawal-history'
                  ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <History className="w-5 h-5 shrink-0" />
              <span>Withdrawal History</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                currentPage === 'transactions'
                  ? 'brand-gradient text-white shadow-lg shadow-violet-900/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Clock className="w-5 h-5 shrink-0" />
              <span>Transactions</span>
            </button>
          </div>
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3">
          {isAuthenticated ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors text-left"
              >
                <UserAvatarGraphic className="w-10 h-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{user.fullName}</span>
                    {user.verified && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                  </div>
                  <p className="text-xs text-slate-400 truncate">{user.level}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={onLogout}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-rose-300 hover:text-white hover:bg-rose-500/20 border border-rose-500/20 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.04] border border-white/10">
                <UserAvatarGraphic className="w-10 h-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">Guest Visitor</p>
                  <p className="text-[11px] text-slate-400 truncate">Sign in to earn &amp; withdraw</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenAuth?.('login')}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl brand-button text-white text-sm font-bold"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In / Register</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:pl-[272px] min-w-0">
        {/* Mobile Sticky Header */}
        <header className="lg:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between gap-2 bg-[#070B22]/95 backdrop-blur-md border-b border-white/10">
          {isSubPage ? (
            <button
              type="button"
              onClick={handleBack}
              aria-label="Go back"
              className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {currentPage === 'home' ? (
            <div className="flex items-center gap-2 min-w-0">
              <AdViewLogoMark size="sm" />
              <BrandWordmark
                name={brandLabel}
                className="text-base font-extrabold tracking-tight font-display text-white truncate"
              />
            </div>
          ) : (
            <h1 className="text-base font-bold font-display text-white truncate">
              {PAGE_TITLES[currentPage]}
            </h1>
          )}

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={openNotifications}
              aria-label="Notifications"
              className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-200 hover:bg-white/10 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-2 right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-amber-400 text-[#06091B] text-[10px] font-extrabold flex items-center justify-center leading-none tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                aria-label="Open Profile"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl"
              >
                <UserAvatarGraphic className="w-8 h-8" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenAuth?.('login')}
                className="min-h-[36px] px-3 rounded-full brand-button text-white text-xs font-bold whitespace-nowrap"
              >
                Sign In
              </button>
            )}
          </div>
        </header>

        {/* Desktop Top Header */}
        <header className="hidden lg:flex sticky top-0 z-20 h-16 px-8 items-center justify-between gap-8 bg-[#070B22]/80 backdrop-blur-xl border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            {isSubPage && (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Go back"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold font-display text-white truncate">
                {currentPage === 'home'
                  ? isAuthenticated
                    ? `Welcome Back, ${user.fullName}`
                    : brandLabel
                  : PAGE_TITLES[currentPage]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {isAuthenticated && (
              <div className="flex items-center gap-2 text-sm text-slate-300 tabular-nums">
                <span className="text-slate-400">Balance:</span>
                <span className="font-bold text-white">{formatPoints(wallet.balancePoints)} Pts</span>
                {bdtBalance !== null && (
                  <>
                    <span className="text-slate-500" aria-hidden="true">·</span>
                    <span className="text-amber-400 font-semibold">{formatBdt(bdtBalance)}</span>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={openNotifications}
              aria-label="Open notifications"
              className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-[#06091B] text-[10px] font-extrabold flex items-center justify-center leading-none tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                aria-label="Open profile"
                className="min-h-[44px] flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-colors"
              >
                <UserAvatarGraphic className="w-8 h-8 shrink-0" />
                <span className="text-xs font-semibold text-white whitespace-nowrap max-w-[120px] truncate">
                  {user.fullName}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenAuth?.('login')}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-xs font-bold text-white transition-colors whitespace-nowrap"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAuth?.('register')}
                  className="min-h-[40px] px-4 py-2 rounded-xl brand-button text-xs font-bold text-white whitespace-nowrap"
                >
                  Create Account
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Scrollable Content Container */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 pb-24 lg:py-8">
          {children}
          <footer className="mt-8 pt-4 border-t border-white/10 text-center text-[11px] text-slate-500">
            {branding.footerText || `${branding.websiteName || 'AdView Earn'} · Rewarded Advertising & Wallet Platform`}
          </footer>
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 transform-gpu bg-gradient-to-t from-[#040B29]/98 via-[#071645]/96 to-[#091D58]/95 backdrop-blur-md border-t border-cyan-400/55 shadow-[0_-8px_26px_rgba(14,165,233,0.32)] pb-safe"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-6 right-6 h-[1.5px] bg-gradient-to-r from-transparent via-cyan-300/90 to-transparent"
        />
        <div className="grid grid-cols-5 items-center h-16 max-w-lg mx-auto px-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className="relative min-h-[44px] flex flex-col items-center justify-center gap-1 py-1 px-1 rounded-2xl transition-transform duration-150 active:scale-95"
              >
                <div
                  className={`w-12 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${
                    isActive
                      ? item.activeClass
                      : `${item.inactiveIconClass} hover:text-white`
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <span
                  className={`text-[11px] font-medium leading-none tracking-tight whitespace-nowrap transition-colors ${
                    isActive ? `${item.activeTextClass} font-bold` : 'text-slate-300/85'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Mobile Slide-Out Drawer */}
      {mobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative z-10 w-72 max-w-[82vw] bg-[#0B1130] border-r border-violet-500/20 h-full flex flex-col p-5">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <AdViewLogoMark size="sm" />
                <BrandWordmark
                  name={brandLabel}
                  className="text-base font-extrabold font-display text-white truncate"
                />
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 py-4 border-b border-white/10">
              <UserAvatarGraphic className="w-11 h-11 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">
                  {isAuthenticated ? user.fullName : 'Guest Visitor'}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {isAuthenticated ? user.level : 'Sign in to sync points'}
                </p>
              </div>
            </div>

            <div className="flex-1 py-4 space-y-1.5 overflow-y-auto">
              {[
                { label: 'Home Dashboard', page: 'home' as AppPage },
                { label: 'Watch Ads', page: 'earn' as AppPage },
                { label: 'Ad History', page: 'ad-history' as AppPage },
                { label: 'My Wallet', page: 'wallet' as AppPage },
                { label: 'Withdraw Request', page: 'withdraw' as AppPage },
                { label: 'Withdrawal History', page: 'withdrawal-history' as AppPage },
                { label: 'Referral Program', page: 'referral' as AppPage },
                { label: 'Transaction History', page: 'transactions' as AppPage },
                { label: 'My Profile', page: 'profile' as AppPage },
              ].map((link) => (
                <button
                  key={link.page}
                  type="button"
                  onClick={() => {
                    onNavigate(link.page);
                    setMobileDrawerOpen(false);
                  }}
                  className={`w-full min-h-[44px] px-3.5 rounded-xl text-left text-sm font-medium transition-colors ${
                    currentPage === link.page
                      ? 'brand-gradient text-white'
                      : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {link.label}
                </button>
              ))}
            </div>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => {
                  setMobileDrawerOpen(false);
                  onLogout();
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/25 text-sm font-semibold"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMobileDrawerOpen(false);
                  onOpenAuth?.('login');
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl brand-button text-white text-sm font-bold"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In / Create Account</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Notifications Drawer/Modal */}
      <ModalDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title="Notifications"
        subtitle="Real-time account updates & notices"
      >
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="p-6 text-center space-y-1.5">
              <p className="text-sm font-semibold text-white">No notifications yet</p>
              <p className="text-xs text-slate-400">
                Account updates, bonus confirmations, and payout alerts will appear here.
              </p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{n.title}</h3>
                  <span className="text-xs text-slate-400 shrink-0">{n.timeLabel}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{n.message}</p>
              </div>
            ))
          )}
        </div>
      </ModalDrawer>
    </div>
  );
};
