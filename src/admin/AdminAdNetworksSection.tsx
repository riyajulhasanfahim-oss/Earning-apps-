import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Megaphone,
  Network,
  Plus,
  Power,
  RefreshCw,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  AdAnalyticsRecord,
  AdCallbackRecord,
  AdCampaignRecord,
  AdCompletionRecord,
  AdminRole,
  AdNetworkConfig,
  AdNetworkHealthStatus,
  AdNetworkIntegrationType,
  AdNetworkLogRecord,
  AdNetworkLogoKey,
  AdPlacementRecord,
  AdSessionRecord,
  Advertisement,
  AppLixirEnvCredentialsStatus,
} from '../types';
import { hasAdminPermission } from '../services/adminService';
import {
  getCanonicalCallbackUrl,
  getDefaultNetworkTemplates,
  saveAdNetworkConfiguration,
  testAdNetworkHealth,
} from '../services/adNetworkService';
import { formatPoints } from '../services/appService';
import { AdNetworkDirectLinksTab } from './AdNetworkDirectLinksTab';
import { AdNetworkCampaignsTab } from './AdNetworkCampaignsTab';
import { AdNetworkCallbacksLogsTab } from './AdNetworkCallbacksLogsTab';
import { useToast } from '../components/ui/ToastProvider';

interface AdminAdNetworksSectionProps {
  networks: AdNetworkConfig[];
  placements: AdPlacementRecord[];
  campaigns: AdCampaignRecord[];
  callbacks: AdCallbackRecord[];
  analytics: AdAnalyticsRecord[];
  networkLogs: AdNetworkLogRecord[];
  ads: Advertisement[];
  adSessions: AdSessionRecord[];
  adCompletions: AdCompletionRecord[];
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

type SubTabKey = 'networks' | 'direct-links' | 'campaigns' | 'analytics';

const HEALTH_BADGE: Record<
  AdNetworkHealthStatus,
  { label: string; cls: string }
> = {
  connected: {
    label: 'Connected',
    cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35',
  },
  configuration_required: {
    label: 'Configuration Required',
    cls: 'bg-amber-500/15 text-amber-200 border-amber-400/35',
  },
  verification_pending: {
    label: 'Verification Pending',
    cls: 'bg-blue-500/15 text-blue-200 border-blue-400/35',
  },
  error: {
    label: 'Error',
    cls: 'bg-rose-500/15 text-rose-300 border-rose-400/35',
  },
  disabled: {
    label: 'Disabled',
    cls: 'bg-slate-500/15 text-slate-300 border-slate-400/35',
  },
};

interface NetworkConfigForm {
  isNew: boolean;
  networkId: string;
  networkName: string;
  logoKey: AdNetworkLogoKey;
  integrationType: AdNetworkIntegrationType;
  publisherId: string;
  websiteId: string;
  placementId: string;
  directLinkUrl: string;
  apiBaseUrl: string;
  callbackUrl: string;
  postbackParamsTemplate: string;
  incentivizedTrafficAllowed: boolean;
  rewardVerificationSupported: boolean;
  rewardEnabled: boolean;
  clicksSupported: boolean;
  apiHealthSupported: boolean;
  enabled: boolean;
  existingSecretConfigured: boolean;
  existingSecretHint: string;
  callbackSecretInput: string;
  apiKeyInput: string;
}

export const AdminAdNetworksSection: React.FC<AdminAdNetworksSectionProps> = ({
  networks,
  placements,
  campaigns,
  callbacks,
  analytics,
  networkLogs,
  ads,
  adSessions,
  adCompletions,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const canManage = hasAdminPermission(adminRole, 'manage_ads');
  const [activeTab, setActiveTab] = useState<SubTabKey>('networks');
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [form, setForm] = useState<NetworkConfigForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [appLixirEnvStatus, setAppLixirEnvStatus] =
    useState<AppLixirEnvCredentialsStatus | null>(null);

  // Merge Firestore networks with built-in Monetag & Adsterra blueprints if not yet initialized
  const displayNetworks = useMemo(() => {
    const map = new Map<string, AdNetworkConfig>();
    for (const tpl of getDefaultNetworkTemplates()) {
      map.set(tpl.networkId, tpl);
    }
    for (const saved of networks) {
      map.set(saved.networkId, saved);
    }
    return Array.from(map.values());
  }, [networks]);

  // Real-time KPI summary derived exclusively from live Firestore collections
  const kpiSummary = useMemo(() => {
    const totalNetworks = displayNetworks.length;
    const activeNetworks = displayNetworks.filter((n) => n.enabled).length;
    const inactiveNetworks = totalNetworks - activeNetworks;
    const totalInventory = ads.length + placements.length + campaigns.length;

    const verifiedCompletionsFromDb =
      analytics.length > 0
        ? analytics.reduce((s, r) => s + r.verifiedCompletions, 0)
        : adCompletions.filter((c) => c.status === 'completed').length;

    const totalDistributedRewards =
      analytics.length > 0
        ? analytics.reduce((s, r) => s + r.totalRewardsDistributed, 0)
        : adCompletions
            .filter((c) => c.status === 'completed')
            .reduce((s, c) => s + c.rewardPoints, 0);

    const totalAttempts =
      analytics.length > 0
        ? analytics.reduce((s, r) => s + r.verifiedCompletions + r.rejectedCompletions, 0)
        : adSessions.length;

    const verificationRate =
      totalAttempts > 0
        ? Math.min(100, Math.round((verifiedCompletionsFromDb / totalAttempts) * 100))
        : 0;

    return {
      totalNetworks,
      activeNetworks,
      inactiveNetworks,
      totalInventory,
      verifiedCompletions: verifiedCompletionsFromDb,
      totalDistributedRewards,
      verificationRate,
    };
  }, [displayNetworks, ads.length, placements.length, campaigns.length, analytics, adCompletions, adSessions.length]);

  const openConfigureModal = (net: AdNetworkConfig, isNew = false) => {
    setForm({
      isNew,
      networkId: net.networkId,
      networkName: net.networkName,
      logoKey: net.logoKey,
      integrationType: net.integrationType,
      publisherId: net.publisherId,
      websiteId: net.websiteId,
      placementId: net.placementId,
      directLinkUrl: net.directLinkUrl,
      apiBaseUrl: net.apiBaseUrl,
      callbackUrl: net.callbackUrl || getCanonicalCallbackUrl(net.networkId),
      postbackParamsTemplate: net.postbackParamsTemplate,
      incentivizedTrafficAllowed: net.incentivizedTrafficAllowed,
      rewardVerificationSupported: net.rewardVerificationSupported,
      rewardEnabled: net.rewardEnabled,
      clicksSupported: net.clicksSupported,
      apiHealthSupported: net.apiHealthSupported,
      enabled: net.enabled,
      existingSecretConfigured: net.secretConfigured,
      existingSecretHint: net.secretHint,
      callbackSecretInput: '',
      apiKeyInput: '',
    });
    setConfigModalOpen(true);
  };

  const openNewNetworkModal = () => {
    const newId = `net_${Date.now().toString().slice(-5)}`;
    openConfigureModal(
      {
        id: newId,
        networkId: newId,
        networkName: '',
        logoKey: 'custom',
        integrationType: 's2s_postback',
        publisherId: '',
        websiteId: '',
        placementId: '',
        directLinkUrl: '',
        apiBaseUrl: '',
        callbackUrl: getCanonicalCallbackUrl(newId),
        postbackParamsTemplate: 'ymid={session_id}&subid={user_id}&tx_id={provider_tx_id}&ts={ts}&sig={hmac}',
        incentivizedTrafficAllowed: false,
        rewardVerificationSupported: true,
        rewardEnabled: false,
        clicksSupported: false,
        apiHealthSupported: false,
        secretConfigured: false,
        secretHint: '',
        healthStatus: 'configuration_required',
        healthMessage: '',
        enabled: false,
        lastTestedAt: '',
        updatedAtLabel: '',
        updatedAtMillis: 0,
      },
      true,
    );
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !canManage) return;

    setSaving(true);
    try {
      const res = await saveAdNetworkConfiguration({
        networkId: form.networkId,
        networkName: form.networkName,
        logoKey: form.logoKey,
        integrationType: form.integrationType,
        publisherId: form.publisherId,
        websiteId: form.websiteId,
        placementId: form.placementId,
        directLinkUrl: form.directLinkUrl,
        apiBaseUrl: form.apiBaseUrl,
        callbackUrl: form.callbackUrl,
        postbackParamsTemplate: form.postbackParamsTemplate,
        incentivizedTrafficAllowed: form.incentivizedTrafficAllowed,
        rewardVerificationSupported: form.rewardVerificationSupported,
        rewardEnabled: form.rewardEnabled,
        clicksSupported: form.clicksSupported,
        apiHealthSupported: form.apiHealthSupported,
        enabled: form.enabled,
        existingSecretConfigured: form.existingSecretConfigured,
        existingSecretHint: form.existingSecretHint,
        callbackSecretInput: form.callbackSecretInput,
        apiKeyInput: form.apiKeyInput,
        adminUser: { ...adminUser, role: adminRole },
      });
      if (res.envCredentials) {
        setAppLixirEnvStatus(res.envCredentials);
      }
      showToast(
        `${form.networkName} saved (${HEALTH_BADGE[res.healthStatus].label}).`,
        'success',
      );
      setConfigModalOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save Ad Network.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickToggle = async (net: AdNetworkConfig) => {
    if (!canManage) return;
    setTestingId(net.networkId);
    try {
      const nextEnabled = !net.enabled;
      const res = await saveAdNetworkConfiguration({
        networkId: net.networkId,
        networkName: net.networkName,
        logoKey: net.logoKey,
        integrationType: net.integrationType,
        publisherId: net.publisherId,
        websiteId: net.websiteId,
        placementId: net.placementId,
        directLinkUrl: net.directLinkUrl,
        apiBaseUrl: net.apiBaseUrl,
        callbackUrl: net.callbackUrl,
        postbackParamsTemplate: net.postbackParamsTemplate,
        incentivizedTrafficAllowed: net.incentivizedTrafficAllowed,
        rewardVerificationSupported: net.rewardVerificationSupported,
        rewardEnabled: net.rewardEnabled,
        clicksSupported: net.clicksSupported,
        apiHealthSupported: net.apiHealthSupported,
        enabled: nextEnabled,
        existingSecretConfigured: net.secretConfigured,
        existingSecretHint: net.secretHint,
        adminUser: { ...adminUser, role: adminRole },
      });
      showToast(
        `${net.networkName} ${nextEnabled ? 'enabled' : 'disabled'} (${HEALTH_BADGE[res.healthStatus].label}).`,
        'info',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Toggle failed.', 'error');
    } finally {
      setTestingId(null);
    }
  };

  const handleTestConnection = async (net: AdNetworkConfig) => {
    if (!canManage) return;
    setTestingId(net.networkId);
    try {
      const res = await testAdNetworkHealth({
        network: net,
        adminUser: { ...adminUser, role: adminRole },
      });
      if (res.envCredentials) {
        setAppLixirEnvStatus(res.envCredentials);
      }
      showToast(
        `${net.networkName}: ${HEALTH_BADGE[res.healthStatus].label} — ${res.healthMessage}`,
        res.healthStatus === 'connected' ? 'success' : 'info',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Connection test failed.', 'error');
    } finally {
      setTestingId(null);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard.`, 'success');
    } catch {
      showToast('Clipboard copy failed.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {!canManage && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-400/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Support Admin has read-only access to Ad Networks, Campaigns, Callbacks, and Analytics.
          </span>
        </div>
      )}

      {/* Top Ad Network KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="rounded-2xl bg-gradient-to-br from-violet-600/20 to-[#0D1330] border border-violet-400/25 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Total Networks
          </p>
          <p className="text-2xl font-extrabold font-mono-num text-white mt-1">
            {kpiSummary.totalNetworks}
          </p>
          <p className="text-[11px] text-emerald-300 mt-1">
            {kpiSummary.activeNetworks} Active · {kpiSummary.inactiveNetworks} Inactive
          </p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Active Networks
          </p>
          <p className="text-2xl font-extrabold font-mono-num text-emerald-300 mt-1">
            {kpiSummary.activeNetworks}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Enabled in console</p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Inactive Networks
          </p>
          <p className="text-2xl font-extrabold font-mono-num text-slate-300 mt-1">
            {kpiSummary.inactiveNetworks}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Paused or unconfigured</p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Ads &amp; Placements
          </p>
          <p className="text-2xl font-extrabold font-mono-num text-blue-300 mt-1">
            {kpiSummary.totalInventory}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {campaigns.length} campaigns · {placements.length} links
          </p>
        </div>

        <div className="rounded-2xl bg-[#0D1330] border border-white/10 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Verified Completions
          </p>
          <p className="text-2xl font-extrabold font-mono-num text-emerald-300 mt-1">
            {formatPoints(kpiSummary.verifiedCompletions)}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            {kpiSummary.verificationRate}% verification rate
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-blue-600/20 to-[#0D1330] border border-blue-400/25 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Distributed Rewards
          </p>
          <p className="text-2xl font-extrabold font-mono-num text-violet-300 mt-1">
            {formatPoints(kpiSummary.totalDistributedRewards)}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Verified Pts issued</p>
        </div>
      </div>

      {/* Section Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { key: 'networks', label: 'Networks & Health', icon: Network },
              { key: 'direct-links', label: `Direct Links (${placements.length})`, icon: Link2 },
              { key: 'campaigns', label: `Campaigns (${campaigns.length})`, icon: Megaphone },
              { key: 'analytics', label: 'Analytics & Callbacks', icon: Activity },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`min-h-[40px] px-4 rounded-xl text-xs font-bold inline-flex items-center gap-2 border transition-colors ${
                  active
                    ? 'bg-gradient-to-r from-violet-600/30 to-blue-600/25 border-violet-400/45 text-white'
                    : 'bg-[#0D1330] border-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 text-violet-300" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {activeTab === 'networks' && canManage && (
          <button
            type="button"
            onClick={openNewNetworkModal}
            className="min-h-[40px] px-4 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Authorized Network</span>
          </button>
        )}
      </div>

      {/* Tab 1: Networks & Health Cards */}
      {activeTab === 'networks' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-violet-500/10 border border-violet-400/25 p-3.5 flex items-start gap-2.5 text-xs text-violet-100">
            <ShieldCheck className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
            <span>
              <strong>Zero-Trust Secret Isolation:</strong> Public config lives in{' '}
              <code>adNetworks</code> while Callback Secrets &amp; API Keys are strictly isolated in{' '}
              server-only <code>adNetworkSecrets</code> (zero client reads). Placeholder API keys are
              never fabricated.
            </span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {displayNetworks.map((net) => {
              const badge = HEALTH_BADGE[net.healthStatus] ?? HEALTH_BADGE.configuration_required;
              const busy = testingId === net.networkId;
              return (
                <div
                  key={net.networkId}
                  className="rounded-2xl bg-[#0D1330] border border-white/10 p-5 space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-blue-600/25 border border-violet-400/30 flex items-center justify-center shrink-0">
                          <Globe className="w-5 h-5 text-violet-200" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-extrabold font-display text-white truncate">
                              {net.networkName}
                            </h3>
                            <span className="text-[10px] font-mono-num px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-300 uppercase">
                              {net.integrationType.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono-num">
                            ID: {net.networkId}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border shrink-0 ${badge.cls}`}
                      >
                        {net.healthStatus === 'connected' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : net.healthStatus === 'error' ? (
                          <ShieldAlert className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {badge.label}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{net.healthMessage}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px] bg-[#070B22] border border-white/10 rounded-xl p-3">
                      <div>
                        <span className="text-slate-500 block">
                          {net.networkId === 'applixir'
                            ? 'Publisher / Account ID'
                            : 'Publisher / Account ID'}
                        </span>
                        <span className="text-slate-200 font-mono-num">
                          {net.publisherId || 'Optional'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">
                          {net.networkId === 'applixir'
                            ? 'AppLixir Site ID / Player Key'
                            : 'Website / Zone ID'}
                        </span>
                        <span className="text-slate-200 font-mono-num">
                          {net.websiteId || net.placementId || 'Not Set'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">
                          {net.networkId === 'applixir'
                            ? 'Backend Env / Secret'
                            : 'Server Secret'}
                        </span>
                        <span
                          className={`font-mono-num font-semibold ${
                            net.secretConfigured ? 'text-emerald-300' : 'text-amber-300'
                          }`}
                        >
                          {net.secretConfigured
                            ? `Configured ${net.secretHint || ''}`
                            : 'Missing'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span
                        className={`px-2 py-0.5 rounded border font-semibold ${
                          net.incentivizedTrafficAllowed
                            ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                            : 'bg-rose-500/10 border-rose-400/25 text-rose-200'
                        }`}
                      >
                        Incentivized Traffic:{' '}
                        {net.incentivizedTrafficAllowed ? 'Approved' : 'Not Permitted'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border font-semibold ${
                          net.rewardVerificationSupported
                            ? 'bg-blue-500/15 border-blue-400/30 text-blue-200'
                            : 'bg-slate-500/15 border-slate-400/25 text-slate-300'
                        }`}
                      >
                        Reward Verification:{' '}
                        {net.rewardVerificationSupported ? 'Supported' : 'Not Available'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded border font-semibold ${
                          net.rewardEnabled
                            ? 'bg-violet-500/20 border-violet-400/35 text-violet-200'
                            : 'bg-slate-500/15 border-slate-400/25 text-slate-300'
                        }`}
                      >
                        Rewards: {net.rewardEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 bg-[#070B22] border border-white/10 rounded-xl px-3 py-2 text-[11px]">
                      <span className="truncate font-mono-num text-slate-400">
                        Postback: {net.callbackUrl || getCanonicalCallbackUrl(net.networkId)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopy(
                            net.callbackUrl || getCanonicalCallbackUrl(net.networkId),
                            'Postback URL',
                          )
                        }
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 shrink-0"
                        title="Copy S2S Callback URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10">
                    <span className="text-[11px] text-slate-500">
                      Updated: {net.updatedAtLabel}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!canManage || busy}
                        onClick={() => void handleTestConnection(net)}
                        className="min-h-[36px] px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5 disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>Check Health</span>
                      </button>

                      <button
                        type="button"
                        disabled={!canManage || busy}
                        onClick={() => void handleQuickToggle(net)}
                        className={`min-h-[36px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 ${
                          net.enabled
                            ? 'bg-amber-500/15 border-amber-400/35 text-amber-200'
                            : 'bg-emerald-500/15 border-emerald-400/35 text-emerald-200'
                        }`}
                      >
                        <Power className="w-3.5 h-3.5" />
                        <span>{net.enabled ? 'Disable' : 'Enable'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => openConfigureModal(net, false)}
                        className="min-h-[36px] px-3.5 rounded-xl brand-button text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-40"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        <span>Configure</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Direct Links & Placements */}
      {activeTab === 'direct-links' && (
        <AdNetworkDirectLinksTab
          networks={displayNetworks}
          placements={placements}
          adminRole={adminRole}
          adminUser={adminUser}
        />
      )}

      {/* Tab 3: Campaigns */}
      {activeTab === 'campaigns' && (
        <AdNetworkCampaignsTab
          networks={displayNetworks}
          placements={placements}
          campaigns={campaigns}
          adminRole={adminRole}
          adminUser={adminUser}
        />
      )}

      {/* Tab 4: Analytics, S2S Callbacks & Audit Logs */}
      {activeTab === 'analytics' && (
        <AdNetworkCallbacksLogsTab
          networks={displayNetworks}
          analytics={analytics}
          callbacks={callbacks}
          networkLogs={networkLogs}
          adSessions={adSessions}
          adCompletions={adCompletions}
        />
      )}

      {/* Configure Ad Network Modal */}
      {configModalOpen && form && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-[#0B1026] border border-white/15 overflow-hidden max-h-[92dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Settings2 className="w-5 h-5 text-violet-400" />
                <h3 className="text-base font-bold font-display text-white">
                  {form.isNew
                    ? 'Add Authorized Ad Network'
                    : `Configure ${form.networkName}`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfigModalOpen(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Network ID</label>
                  <input
                    type="text"
                    disabled={!form.isNew}
                    value={form.networkId}
                    onChange={(e) => setForm({ ...form, networkId: e.target.value })}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Network Name</label>
                  <input
                    type="text"
                    value={form.networkName}
                    onChange={(e) => setForm({ ...form, networkName: e.target.value })}
                    placeholder="e.g. Monetag"
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Integration Type</label>
                  <select
                    value={form.integrationType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        integrationType: e.target.value as AdNetworkIntegrationType,
                      })
                    }
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white"
                  >
                    <option value="s2s_postback">S2S Postback</option>
                    <option value="sdk_callback">Rewarded SDK Callback</option>
                    <option value="direct_link">Direct Link</option>
                    <option value="hybrid">Hybrid (SDK + S2S)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">
                    {form.networkId === 'applixir' ? 'Publisher / Dev ID (Optional)' : 'Publisher ID'}
                  </label>
                  <input
                    type="text"
                    value={form.publisherId}
                    onChange={(e) => setForm({ ...form, publisherId: e.target.value })}
                    placeholder={form.networkId === 'applixir' ? 'Optional Dev ID' : 'Your real Publisher ID'}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">
                    {form.networkId === 'applixir'
                      ? 'AppLixir Site ID / Player Key'
                      : 'Website / Domain ID'}
                  </label>
                  <input
                    type="text"
                    value={form.websiteId}
                    onChange={(e) => setForm({ ...form, websiteId: e.target.value })}
                    placeholder={
                      form.networkId === 'applixir'
                        ? 'e.g. 12345 or xxxx-xxxx-xxxx-xxxx'
                        : 'Website ID'
                    }
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">
                    {form.networkId === 'applixir'
                      ? 'Game / Placement ID (Optional)'
                      : 'Default Placement / Zone ID'}
                  </label>
                  <input
                    type="text"
                    value={form.placementId}
                    onChange={(e) => setForm({ ...form, placementId: e.target.value })}
                    placeholder={form.networkId === 'applixir' ? 'AppLixir Game ID' : 'Zone / Placement ID'}
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Direct Link URL (if permitted)</label>
                  <input
                    type="url"
                    value={form.directLinkUrl}
                    onChange={(e) => setForm({ ...form, directLinkUrl: e.target.value })}
                    placeholder="https://..."
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Provider API Endpoint (optional)</label>
                  <input
                    type="url"
                    value={form.apiBaseUrl}
                    onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                    placeholder="https://api..."
                    className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-semibold text-slate-300">S2S Callback / Postback URL</label>
                  <button
                    type="button"
                    onClick={() => void handleCopy(form.callbackUrl, 'Postback URL')}
                    className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy URL</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={form.callbackUrl}
                  onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-slate-200 font-mono-num"
                />
                {form.networkId === 'applixir' && (
                  <p className="text-[11px] text-cyan-200/80 leading-relaxed pt-1">
                    Paste this Callback URL in your AppLixir Dashboard under S2S Callback Settings
                    (select <strong>MD5 and TID</strong> mode). AppLixir automatically appends{' '}
                    <code>gameApiKey</code>, <code>gameId</code>, <code>userId</code>,{' '}
                    <code>tid</code>, <code>customData</code>, and <code>signature</code>.
                  </p>
                )}
              </div>

              {form.networkId === 'applixir' && (
                <div className="rounded-xl bg-cyan-500/10 border border-cyan-400/25 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-cyan-200 font-bold">
                      Backend Environment Variables Status (`functions/.env` — Never Exposed to Frontend)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-lg bg-[#070B22] border border-white/10 px-3 py-2">
                      <span className="text-slate-400 block">APPLIXIR_API_KEY</span>
                      <span
                        className={`font-semibold ${
                          appLixirEnvStatus?.apiKeyConfigured || form.existingSecretConfigured
                            ? 'text-emerald-300'
                            : 'text-amber-300'
                        }`}
                      >
                        {appLixirEnvStatus
                          ? appLixirEnvStatus.apiKeyConfigured
                            ? 'Configured in Backend Env'
                            : 'Not Detected in Env'
                          : form.existingSecretConfigured
                            ? 'Configured (Run Check Health)'
                            : 'Set in functions/.env'}
                      </span>
                    </div>
                    <div className="rounded-lg bg-[#070B22] border border-white/10 px-3 py-2">
                      <span className="text-slate-400 block">APPLIXIR_SECRET_KEY</span>
                      <span
                        className={`font-semibold ${
                          appLixirEnvStatus?.secretKeyConfigured || form.existingSecretConfigured
                            ? 'text-emerald-300'
                            : 'text-amber-300'
                        }`}
                      >
                        {appLixirEnvStatus
                          ? appLixirEnvStatus.secretKeyConfigured
                            ? 'Configured in Backend Env'
                            : 'Not Detected in Env'
                          : form.existingSecretConfigured
                            ? 'Configured (Run Check Health)'
                            : 'Set in functions/.env'}
                      </span>
                    </div>
                    <div className="rounded-lg bg-[#070B22] border border-white/10 px-3 py-2">
                      <span className="text-slate-400 block">APPLIXIR_SITE_ID</span>
                      <span className="font-semibold text-slate-200">
                        {appLixirEnvStatus?.siteIdConfigured
                          ? 'Configured in Backend Env'
                          : form.websiteId
                            ? `Using Admin Site ID (${form.websiteId})`
                            : 'Enter Site ID above'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Private Server-Only Credentials Section */}
              <div className="rounded-xl bg-amber-500/10 border border-amber-400/25 p-3.5 space-y-3">
                <div className="flex items-center gap-2 text-amber-200 font-bold">
                  <KeyRound className="w-4 h-4" />
                  <span>
                    Server-Only Credentials (`adNetworkSecrets` — Optional Override if not in `functions/.env`)
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">
                      {form.networkId === 'applixir' ? 'Secret Key' : 'Callback Secret'}{' '}
                      {form.existingSecretConfigured ? `(${form.existingSecretHint})` : ''}
                    </label>
                    <input
                      type="password"
                      value={form.callbackSecretInput}
                      onChange={(e) =>
                        setForm({ ...form, callbackSecretInput: e.target.value })
                      }
                      placeholder={
                        form.networkId === 'applixir'
                          ? 'Recommended: set APPLIXIR_SECRET_KEY in backend env'
                          : 'Leave blank to keep unchanged'
                      }
                      autoComplete="new-password"
                      className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">API Key (Optional)</label>
                    <input
                      type="password"
                      value={form.apiKeyInput}
                      onChange={(e) => setForm({ ...form, apiKeyInput: e.target.value })}
                      placeholder={
                        form.networkId === 'applixir'
                          ? 'Recommended: set APPLIXIR_API_KEY in backend env'
                          : 'Stored only in adNetworkSecrets'
                      }
                      autoComplete="new-password"
                      className="w-full h-10 px-3 rounded-xl bg-[#070B22] border border-white/15 text-white font-mono-num"
                    />
                  </div>
                </div>
              </div>

              {/* Policy & Activation Checkboxes */}
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 space-y-2">
                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.incentivizedTrafficAllowed}
                    onChange={(e) => {
                      const nextInc = e.target.checked;
                      setForm({
                        ...form,
                        incentivizedTrafficAllowed: nextInc,
                        rewardEnabled: nextInc ? form.rewardEnabled : false,
                      });
                    }}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span>Network explicitly permits Incentivized Traffic</span>
                </label>

                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.rewardVerificationSupported}
                    onChange={(e) => {
                      const nextVer = e.target.checked;
                      setForm({
                        ...form,
                        rewardVerificationSupported: nextVer,
                        rewardEnabled: nextVer ? form.rewardEnabled : false,
                      });
                    }}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span>Network supports Server Reward Verification (S2S Postback / Signed SDK)</span>
                </label>

                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={
                      !form.incentivizedTrafficAllowed || !form.rewardVerificationSupported
                    }
                    checked={
                      form.rewardEnabled &&
                      form.incentivizedTrafficAllowed &&
                      form.rewardVerificationSupported
                    }
                    onChange={(e) => setForm({ ...form, rewardEnabled: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600 disabled:opacity-40"
                  />
                  <span>
                    Enable Reward Points Earning (strictly blocked unless both checks above are true)
                  </span>
                </label>

                <label className="flex items-center gap-2.5 text-slate-200 cursor-pointer pt-1 border-t border-white/10">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="font-bold text-white">Network Enabled in AdView Earn</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setConfigModalOpen(false)}
                  className="min-h-[40px] px-4 rounded-xl border border-white/15 text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[40px] px-5 rounded-xl brand-button text-white font-bold inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Configuration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
