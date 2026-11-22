import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  FileCode2,
  Flame,
  FolderCheck,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import firestoreRulesRaw from '../../firestore.rules?raw';
import {
  AdminRole,
  FirebaseCollectionSetupResult,
  FirebaseProjectBackupEntry,
  FirebaseProjectConfig,
  FirebaseWizardStepKey,
  FirebaseWizardStepResult,
  SiteSettingsConfig,
} from '../types';
import { hasAdminPermission } from '../services/adminService';
import {
  exportFirebaseConfigJson,
  getActiveFirebaseProjectConfig,
  getBundledFirebaseConfig,
  getFirebaseConfigBackups,
  isCustomFirebaseProjectActive,
  normalizeFirebaseProjectConfig,
  parseFirebaseConfigInput,
  resetToBundledFirebaseConfig,
  rollbackToFirebaseBackup,
  validateFirebaseProjectConfig,
} from '../lib/firebaseConfigStore';
import {
  activateVerifiedFirebaseProject,
  disposeWizardFirebaseApp,
  getExportableFirestoreIndexesJson,
  getExportableStorageRulesText,
  getWizardSignedInUser,
  provisionDefaultCollectionsStep,
  signInWizardEmailPassword,
  signInWizardGoogle,
  signOutWizardUser,
  testFirebaseConnectionStep,
  verifyFirebaseAuthStep,
  verifyFirebaseStorageStep,
  verifyFirestoreStatusStep,
  verifySecurityRulesStep,
} from '../services/firebaseSetupService';
import { useToast } from '../components/ui/ToastProvider';

interface AdminFirebaseProjectSectionProps {
  siteSettings: SiteSettingsConfig;
  adminRole: AdminRole;
  adminUser: { uid: string; email: string };
}

type RulesTab = 'firestore_rules' | 'firestore_indexes' | 'storage_rules' | 'cli';

const INITIAL_STEP_RESULT: FirebaseWizardStepResult = {
  status: 'idle',
  summary: 'Not checked yet.',
  details: [],
};

function StatusBadge({ status }: { status: FirebaseWizardStepResult['status'] }) {
  switch (status) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-violet-500/20 border border-violet-400/35 text-[11px] font-bold text-violet-200">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </span>
      );
    case 'success':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/35 text-[11px] font-bold text-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          Passed
        </span>
      );
    case 'warning':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/35 text-[11px] font-bold text-amber-200">
          <AlertTriangle className="w-3 h-3" />
          Action Needed
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-500/20 border border-rose-400/35 text-[11px] font-bold text-rose-200">
          <XCircle className="w-3 h-3" />
          Failed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px] font-semibold text-slate-400">
          Pending
        </span>
      );
  }
}

export const AdminFirebaseProjectSection: React.FC<AdminFirebaseProjectSectionProps> = ({
  siteSettings,
  adminRole,
  adminUser,
}) => {
  const { showToast } = useToast();
  const canManage = hasAdminPermission(adminRole, 'manage_site_settings');

  const activeConfig = useMemo(() => getActiveFirebaseProjectConfig(), []);
  const bundledConfig = useMemo(() => getBundledFirebaseConfig(), []);
  const customActive = useMemo(() => isCustomFirebaseProjectActive(), []);

  const [form, setForm] = useState<FirebaseProjectConfig>(activeConfig);
  const [backups, setBackups] = useState<FirebaseProjectBackupEntry[]>(() =>
    getFirebaseConfigBackups(),
  );

  // Import/Export UI
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Wizard Steps State
  const [steps, setSteps] = useState<Record<FirebaseWizardStepKey, FirebaseWizardStepResult>>({
    connection: INITIAL_STEP_RESULT,
    auth: INITIAL_STEP_RESULT,
    firestore: INITIAL_STEP_RESULT,
    collections: INITIAL_STEP_RESULT,
    storage: INITIAL_STEP_RESULT,
    security_rules: INITIAL_STEP_RESULT,
    activation: INITIAL_STEP_RESULT,
  });

  const [runningAll, setRunningAll] = useState(false);
  const [wizardUser, setWizardUser] = useState<User | null>(() => getWizardSignedInUser());
  const [wizEmail, setWizEmail] = useState(adminUser.email || '');
  const [wizPassword, setWizPassword] = useState('');
  const [wizAuthBusy, setWizAuthBusy] = useState(false);

  const [collectionsReport, setCollectionsReport] = useState<FirebaseCollectionSetupResult[]>([]);
  const [showAllCollections, setShowAllCollections] = useState(true);
  const [rulesTab, setRulesTab] = useState<RulesTab>('firestore_rules');

  // Safe Activation / Rollback Modals
  const [confirmActivateOpen, setConfirmActivateOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [confirmRollbackEntry, setConfirmRollbackEntry] =
    useState<FirebaseProjectBackupEntry | null>(null);
  const [confirmDefaultResetOpen, setConfirmDefaultResetOpen] = useState(false);

  useEffect(() => {
    return () => {
      void disposeWizardFirebaseApp();
    };
  }, []);

  const setStepResult = (key: FirebaseWizardStepKey, result: FirebaseWizardStepResult) => {
    setSteps((prev) => ({ ...prev, [key]: result }));
  };

  const updateField = <K extends keyof FirebaseProjectConfig>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleCopyText = async (label: string, text: string, keyId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyId);
      showToast(`${label} copied to clipboard.`, 'success');
      window.setTimeout(() => setCopiedKey((curr) => (curr === keyId ? null : curr)), 2200);
    } catch {
      showToast('Clipboard permission denied. Select and copy manually.', 'error');
    }
  };

  const handleDownloadFile = (filename: string, content: string, mime = 'text/plain') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportParse = () => {
    setImportError('');
    const parsed = parseFirebaseConfigInput(importText);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    setForm(parsed.config);
    setImportOpen(false);
    setImportText('');
    showToast(`Imported Firebase config for "${parsed.config.projectId}". Run Setup Check next.`, 'success');
  };

  // Individual Wizard Runners
  const runConnectionCheck = async (): Promise<boolean> => {
    setStepResult('connection', { status: 'running', summary: 'Testing SDK config...', details: [] });
    const res = await testFirebaseConnectionStep(form);
    setStepResult('connection', res);
    return res.status === 'success';
  };

  const runAuthCheck = async (): Promise<User | null> => {
    setStepResult('auth', { status: 'running', summary: 'Verifying Firebase Authentication...', details: [] });
    const { result, user } = await verifyFirebaseAuthStep(form);
    setWizardUser(user);
    setStepResult('auth', result);
    return user;
  };

  const runFirestoreCheck = async (): Promise<boolean> => {
    setStepResult('firestore', { status: 'running', summary: 'Checking Cloud Firestore server...', details: [] });
    const res = await verifyFirestoreStatusStep(form);
    setStepResult('firestore', res);
    return res.status !== 'error';
  };

  const runProvisionCollections = async (): Promise<boolean> => {
    setStepResult('collections', {
      status: 'running',
      summary: 'Inspecting & initializing default collections safely...',
      details: [],
    });
    const { stepResult, collections } = await provisionDefaultCollectionsStep(form, siteSettings);
    setCollectionsReport(collections);
    setStepResult('collections', stepResult);
    return stepResult.status !== 'error';
  };

  const runStorageCheck = async (): Promise<boolean> => {
    setStepResult('storage', { status: 'running', summary: 'Probing Firebase Storage...', details: [] });
    const res = await verifyFirebaseStorageStep(form);
    setStepResult('storage', res);
    return res.status !== 'error';
  };

  const runSecurityRulesCheck = async (): Promise<boolean> => {
    setStepResult('security_rules', {
      status: 'running',
      summary: 'Auditing Firestore Security Rules enforcement...',
      details: [],
    });
    const res = await verifySecurityRulesStep(form);
    setStepResult('security_rules', res);
    return res.status !== 'error';
  };

  const handleRunFullSetup = async () => {
    const check = validateFirebaseProjectConfig(form);
    if (!check.valid) {
      showToast(check.errors[0] || 'Fix invalid Firebase config fields first.', 'error');
      setStepResult('connection', {
        status: 'error',
        summary: 'Invalid Firebase Project configuration.',
        details: check.errors,
      });
      return;
    }

    setForm(check.normalized);
    setRunningAll(true);
    try {
      const okConn = await runConnectionCheck();
      if (!okConn) return;

      const user = await runAuthCheck();
      const okFs = await runFirestoreCheck();
      if (okFs && user) {
        await runProvisionCollections();
      } else if (!user) {
        setStepResult('collections', {
          status: 'warning',
          summary: 'Waiting for target project Admin sign-in in Step 2 before initializing collections.',
          details: ['Sign in using Google or Email/Password in Step 2, then click Initialize Collections.'],
        });
      }
      await runStorageCheck();
      await runSecurityRulesCheck();
      showToast('Firebase Project compatibility check finished. Review step statuses below.', 'info');
    } finally {
      setRunningAll(false);
    }
  };

  const handleWizardGoogleSignIn = async () => {
    setWizAuthBusy(true);
    try {
      const u = await signInWizardGoogle(form);
      setWizardUser(u);
      showToast(`Signed in to target project as ${u.email || u.uid}.`, 'success');
      await runAuthCheck();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Google sign-in failed on target project.', 'error');
    } finally {
      setWizAuthBusy(false);
    }
  };

  const handleWizardEmailSignIn = async () => {
    if (!wizEmail.trim() || !wizPassword) {
      showToast('Enter Admin email & password for the target project.', 'error');
      return;
    }
    setWizAuthBusy(true);
    try {
      const u = await signInWizardEmailPassword(form, wizEmail, wizPassword);
      setWizardUser(u);
      setWizPassword('');
      showToast(`Signed in to target project as ${u.email || u.uid}.`, 'success');
      await runAuthCheck();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Email sign-in failed on target project.', 'error');
    } finally {
      setWizAuthBusy(false);
    }
  };

  const handleWizardSignOut = async () => {
    setWizAuthBusy(true);
    try {
      await signOutWizardUser(form);
      setWizardUser(null);
      await runAuthCheck();
    } finally {
      setWizAuthBusy(false);
    }
  };

  const handleConfirmActivate = async () => {
    if (!canManage) return;
    const check = validateFirebaseProjectConfig(form);
    if (!check.valid) {
      showToast(check.errors[0] || 'Invalid configuration.', 'error');
      return;
    }

    setActivating(true);
    try {
      await activateVerifiedFirebaseProject({
        nextConfig: check.normalized,
        adminUser: { uid: adminUser.uid, email: adminUser.email, role: adminRole },
      });
      setBackups(getFirebaseConfigBackups());
      setConfirmActivateOpen(false);
      showToast(`Switched active Firebase Project to ${check.normalized.projectId}. Reloading...`, 'success');
      window.setTimeout(() => {
        window.location.reload();
      }, 650);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to activate new Firebase project.', 'error');
      setActivating(false);
    }
  };

  const handleConfirmRollback = () => {
    if (!confirmRollbackEntry || !canManage) return;
    const restored = rollbackToFirebaseBackup(confirmRollbackEntry.id, adminUser.email);
    setConfirmRollbackEntry(null);
    if (!restored) {
      showToast('Backup snapshot not found.', 'error');
      return;
    }
    showToast(`Restored Firebase config (${restored.projectId}). Reloading...`, 'success');
    window.setTimeout(() => window.location.reload(), 600);
  };

  const handleConfirmDefaultReset = () => {
    if (!canManage) return;
    const restored = resetToBundledFirebaseConfig(adminUser.email);
    setConfirmDefaultResetOpen(false);
    showToast(`Restored default project (${restored.projectId}). Reloading...`, 'success');
    window.setTimeout(() => window.location.reload(), 600);
  };

  const normalizedPreview = normalizeFirebaseProjectConfig(form);
  const indexesJsonText = useMemo(() => getExportableFirestoreIndexesJson(), []);
  const storageRulesText = useMemo(
    () => getExportableStorageRulesText(adminUser.email),
    [adminUser.email],
  );
  const cliCommandText = useMemo(
    () =>
      `firebase use ${normalizedPreview.projectId || 'YOUR_PROJECT_ID'}\nfirebase deploy --only firestore:rules,firestore:indexes,storage --project ${normalizedPreview.projectId || 'YOUR_PROJECT_ID'}`,
    [normalizedPreview.projectId],
  );

  const canActivate =
    canManage &&
    validateFirebaseProjectConfig(form).valid &&
    steps.connection.status === 'success' &&
    steps.firestore.status !== 'error';

  return (
    <div className="space-y-6">
      {/* Active Project Status Banner */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Flame className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-extrabold font-display text-white">
              Firebase Project Management &amp; Auto-Setup
            </h2>
            <span
              className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold border ${
                customActive
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/35'
                  : 'bg-violet-500/15 text-violet-200 border-violet-400/35'
              }`}
            >
              {customActive ? 'Custom Project Active' : 'Default Bundled Project'}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
            Active Project:{' '}
            <strong className="text-white font-mono-num">{activeConfig.projectId}</strong>
            {' · '}Database:{' '}
            <strong className="text-slate-200 font-mono-num">
              {activeConfig.firestoreDatabaseId || '(default)'}
            </strong>
            {' · '}Automatic pre-switch backups ({backups.length} saved) allow instant rollback
            without deleting any project data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {customActive && canManage && (
            <button
              type="button"
              onClick={() => setConfirmDefaultResetOpen(true)}
              className="min-h-[40px] px-3.5 rounded-xl border border-amber-400/35 bg-amber-500/10 hover:bg-amber-500/20 text-xs font-semibold text-amber-200 inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore Default ({bundledConfig.projectId})</span>
            </button>
          )}
          <button
            type="button"
            disabled={!canManage || runningAll}
            onClick={handleRunFullSetup}
            className="min-h-[42px] px-5 rounded-xl brand-button text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {runningAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            <span>{runningAll ? 'Running Setup Checks...' : 'Save & Connect · Run Setup'}</span>
          </button>
        </div>
      </div>

      {!canManage && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-300" />
          <span>
            Restricted to <strong>Super Admin</strong>. Only Super Admins may inspect, connect, or
            switch Firebase projects.
          </span>
        </div>
      )}

      {/* Configuration Fields + Import / Export */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-bold font-display text-white">
              Target Firebase Project Configuration
            </h3>
            <p className="text-xs text-slate-400">
              Edit credentials manually or import directly from Firebase Console Web App config.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canManage}
              onClick={() => {
                setImportError('');
                setImportOpen((p) => !p);
              }}
              className="min-h-[38px] px-3 rounded-xl border border-violet-400/35 bg-violet-500/15 hover:bg-violet-500/25 text-xs font-semibold text-violet-200 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import JSON / Snippet</span>
            </button>
            <button
              type="button"
              onClick={() =>
                handleCopyText(
                  'Firebase JSON config',
                  exportFirebaseConfigJson(normalizedPreview),
                  'export_json',
                )
              }
              className="min-h-[38px] px-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
            >
              {copiedKey === 'export_json' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>Copy JSON</span>
            </button>
            <button
              type="button"
              onClick={() =>
                handleDownloadFile(
                  `firebase-config-${normalizedPreview.projectId || 'export'}.json`,
                  exportFirebaseConfigJson(normalizedPreview),
                  'application/json',
                )
              }
              className="min-h-[38px] px-3 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </button>
          </div>
        </div>

        {/* Paste Import Box */}
        {importOpen && (
          <div className="rounded-xl border border-violet-400/30 bg-[#070B22] p-4 space-y-3">
            <p className="text-xs font-semibold text-violet-200">
              Paste JSON or Firebase Console <code className="text-white">const firebaseConfig = &#123; ... &#125;</code>
            </p>
            <textarea
              rows={6}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                setImportError('');
              }}
              placeholder={`{\n  "apiKey": "AIza...",\n  "authDomain": "my-project.firebaseapp.com",\n  "projectId": "my-project",\n  "storageBucket": "my-project.firebasestorage.app",\n  "messagingSenderId": "123456789",\n  "appId": "1:123456789:web:abcdef"\n}`}
              className="w-full p-3 rounded-xl bg-[#040717] border border-white/15 text-xs font-mono-num text-slate-200 focus:outline-none focus:border-violet-400"
            />
            {importError && (
              <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
                {importError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="min-h-[36px] px-3 rounded-lg text-xs text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportParse}
                className="min-h-[36px] px-4 rounded-lg brand-button text-xs font-bold text-white"
              >
                Parse &amp; Fill Form
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Firebase Project ID *
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.projectId}
              onChange={(e) => updateField('projectId', e.target.value)}
              placeholder="my-adview-project"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Firebase Project Name
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.projectName}
              onChange={(e) => updateField('projectName', e.target.value)}
              placeholder="AdView Production"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Firebase API Key *
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.apiKey}
              onChange={(e) => updateField('apiKey', e.target.value)}
              placeholder="AIzaSy..."
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Auth Domain *
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.authDomain}
              onChange={(e) => updateField('authDomain', e.target.value)}
              placeholder="my-adview-project.firebaseapp.com"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Storage Bucket
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.storageBucket}
              onChange={(e) => updateField('storageBucket', e.target.value)}
              placeholder="my-adview-project.firebasestorage.app"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Messaging Sender ID
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.messagingSenderId}
              onChange={(e) => updateField('messagingSenderId', e.target.value)}
              placeholder="123456789012"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              App ID *
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.appId}
              onChange={(e) => updateField('appId', e.target.value)}
              placeholder="1:123456789:web:abcdef123456"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Measurement ID (Optional)
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.measurementId}
              onChange={(e) => updateField('measurementId', e.target.value)}
              placeholder="G-XXXXXXXXXX"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-300">
              Firestore Database ID (Optional)
            </label>
            <input
              type="text"
              disabled={!canManage}
              value={form.firestoreDatabaseId}
              onChange={(e) => updateField('firestoreDatabaseId', e.target.value)}
              placeholder="Leave blank for (default)"
              className="w-full min-h-[40px] px-3 rounded-xl bg-[#070B22] border border-white/15 text-xs sm:text-sm font-mono-num text-white focus:outline-none focus:border-violet-400"
            />
          </div>
        </div>
      </div>

      {/* 7-Step Automatic Setup Wizard */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-bold font-display text-white">
              Automatic Firebase Setup &amp; Health Verification Wizard
            </h3>
            <p className="text-xs text-slate-400">
              All tests execute inside an isolated secondary Firebase SDK instance until you confirm
              final activation.
            </p>
          </div>
          <button
            type="button"
            disabled={!canManage || runningAll}
            onClick={handleRunFullSetup}
            className="min-h-[38px] px-4 rounded-xl border border-violet-400/35 bg-violet-500/15 hover:bg-violet-500/25 text-xs font-bold text-violet-200 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${runningAll ? 'animate-spin' : ''}`} />
            <span>Run All Checks</span>
          </button>
        </div>

        {/* Step 1: Connection */}
        <div className="rounded-xl border border-white/10 bg-[#070B22]/90 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold flex items-center justify-center">
                1
              </span>
              <span className="text-sm font-bold text-white">Firebase Connection &amp; SDK Init</span>
              <StatusBadge status={steps.connection.status} />
            </div>
            <button
              type="button"
              disabled={!canManage}
              onClick={runConnectionCheck}
              className="min-h-[34px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
            >
              Test Connection
            </button>
          </div>
          <p className="text-xs text-slate-300">{steps.connection.summary}</p>
          {steps.connection.details.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
              {steps.connection.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Step 2: Authentication */}
        <div className="rounded-xl border border-white/10 bg-[#070B22]/90 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold flex items-center justify-center">
                2
              </span>
              <KeyRound className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-bold text-white">Firebase Authentication Verification</span>
              <StatusBadge status={steps.auth.status} />
            </div>
            <button
              type="button"
              disabled={!canManage}
              onClick={runAuthCheck}
              className="min-h-[34px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
            >
              Verify Auth
            </button>
          </div>
          <p className="text-xs text-slate-300">{steps.auth.summary}</p>
          {steps.auth.details.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
              {steps.auth.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}

          {/* Isolated Target Project Sign-in Panel */}
          <div className="rounded-xl border border-white/10 bg-[#040717] p-3.5 space-y-3">
            {wizardUser ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-300">
                  Signed in on target project <strong className="text-white">{form.projectId}</strong>{' '}
                  as <span className="text-emerald-300 font-semibold">{wizardUser.email || wizardUser.uid}</span>
                </div>
                <button
                  type="button"
                  disabled={wizAuthBusy}
                  onClick={handleWizardSignOut}
                  className="min-h-[32px] px-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-200"
                >
                  Sign Out Target
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-400">
                  Sign in with your Super Admin account on the <strong>target project</strong> to
                  run authenticated collection initialization (Step 4) without disturbing your active
                  Admin session:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="email"
                    value={wizEmail}
                    onChange={(e) => setWizEmail(e.target.value)}
                    placeholder="Admin Email"
                    className="min-h-[38px] px-3 rounded-lg bg-[#0D1330] border border-white/15 text-xs text-white"
                  />
                  <input
                    type="password"
                    value={wizPassword}
                    onChange={(e) => setWizPassword(e.target.value)}
                    placeholder="Password"
                    className="min-h-[38px] px-3 rounded-lg bg-[#0D1330] border border-white/15 text-xs text-white"
                  />
                  <button
                    type="button"
                    disabled={!canManage || wizAuthBusy}
                    onClick={handleWizardEmailSignIn}
                    className="min-h-[38px] px-3 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {wizAuthBusy ? 'Signing In...' : 'Sign In Email'}
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || wizAuthBusy}
                    onClick={handleWizardGoogleSignIn}
                    className="min-h-[38px] px-3 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Sign In Google
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Firestore Database */}
        <div className="rounded-xl border border-white/10 bg-[#070B22]/90 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold flex items-center justify-center">
                3
              </span>
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">Firestore Database Connectivity</span>
              <StatusBadge status={steps.firestore.status} />
            </div>
            <button
              type="button"
              disabled={!canManage}
              onClick={runFirestoreCheck}
              className="min-h-[34px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
            >
              Check Firestore
            </button>
          </div>
          <p className="text-xs text-slate-300">{steps.firestore.summary}</p>
          {steps.firestore.details.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
              {steps.firestore.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Step 4: Automatic Collections & Default Docs */}
        <div className="rounded-xl border border-white/10 bg-[#070B22]/90 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold flex items-center justify-center">
                4
              </span>
              <FolderCheck className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-bold text-white">
                Automatic Collections &amp; Default Schema Setup
              </span>
              <StatusBadge status={steps.collections.status} />
            </div>
            <div className="flex items-center gap-2">
              {collectionsReport.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllCollections((p) => !p)}
                  className="min-h-[34px] px-2.5 rounded-lg text-xs text-slate-300 hover:bg-white/5 inline-flex items-center gap-1"
                >
                  {showAllCollections ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Hide Table</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Show {collectionsReport.length} Collections</span>
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                disabled={!canManage}
                onClick={runProvisionCollections}
                className="min-h-[34px] px-3 rounded-lg bg-violet-600/80 hover:bg-violet-500 text-xs font-bold text-white"
              >
                Initialize Missing Collections
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-300">{steps.collections.summary}</p>
          {steps.collections.details.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
              {steps.collections.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}

          {collectionsReport.length > 0 && showAllCollections && (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[#040717] divide-y divide-white/5">
              {collectionsReport.map((col) => (
                <div
                  key={col.collection}
                  className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono-num font-bold text-white">{col.collection}</code>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                        {col.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{col.detail}</p>
                    {col.seededDocs.length > 0 && (
                      <p className="text-[10px] text-violet-300 font-mono-num mt-0.5">
                        Docs: {col.seededDocs.join(', ')}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      col.status === 'created'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : col.status === 'existing' || col.status === 'verified'
                          ? 'bg-sky-500/20 text-sky-300'
                          : col.status === 'permission_denied'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {col.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step 5: Firebase Storage */}
        <div className="rounded-xl border border-white/10 bg-[#070B22]/90 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold flex items-center justify-center">
                5
              </span>
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-white">Firebase Storage Check</span>
              <StatusBadge status={steps.storage.status} />
            </div>
            <button
              type="button"
              disabled={!canManage}
              onClick={runStorageCheck}
              className="min-h-[34px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
            >
              Test Storage
            </button>
          </div>
          <p className="text-xs text-slate-300">{steps.storage.summary}</p>
          {steps.storage.details.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
              {steps.storage.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Step 6: Security Rules & Indexes */}
        <div className="rounded-xl border border-white/10 bg-[#070B22]/90 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold flex items-center justify-center">
                6
              </span>
              <Lock className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">
                Security Rules, Indexes &amp; Storage Rules Kit
              </span>
              <StatusBadge status={steps.security_rules.status} />
            </div>
            <button
              type="button"
              disabled={!canManage}
              onClick={runSecurityRulesCheck}
              className="min-h-[34px] px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200"
            >
              Audit Rules
            </button>
          </div>
          <p className="text-xs text-slate-300">{steps.security_rules.summary}</p>
          {steps.security_rules.details.length > 0 && (
            <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
              {steps.security_rules.details.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          )}

          {/* Rules / Indexes / CLI Exporter */}
          <div className="rounded-xl border border-white/10 bg-[#040717] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'firestore_rules', label: 'firestore.rules' },
                    { id: 'firestore_indexes', label: 'firestore.indexes.json' },
                    { id: 'storage_rules', label: 'storage.rules' },
                    { id: 'cli', label: 'Deploy CLI' },
                  ] as Array<{ id: RulesTab; label: string }>
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRulesTab(t.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      rulesTab === t.id
                        ? 'bg-violet-600/30 text-violet-200 border border-violet-400/40'
                        : 'bg-white/5 text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text =
                      rulesTab === 'firestore_rules'
                        ? firestoreRulesRaw
                        : rulesTab === 'firestore_indexes'
                          ? indexesJsonText
                          : rulesTab === 'storage_rules'
                            ? storageRulesText
                            : cliCommandText;
                    void handleCopyText(rulesTab, text, rulesTab);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
                >
                  {copiedKey === rulesTab ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>Copy</span>
                </button>
                {rulesTab !== 'cli' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (rulesTab === 'firestore_rules') {
                        handleDownloadFile('firestore.rules', firestoreRulesRaw);
                      } else if (rulesTab === 'firestore_indexes') {
                        handleDownloadFile(
                          'firestore.indexes.json',
                          indexesJsonText,
                          'application/json',
                        );
                      } else {
                        handleDownloadFile('storage.rules', storageRulesText);
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download</span>
                  </button>
                )}
              </div>
            </div>

            <pre className="max-h-48 overflow-auto rounded-lg bg-black/50 p-3 text-[11px] font-mono-num text-slate-300 leading-relaxed">
              {rulesTab === 'firestore_rules'
                ? firestoreRulesRaw
                : rulesTab === 'firestore_indexes'
                  ? indexesJsonText
                  : rulesTab === 'storage_rules'
                    ? storageRulesText
                    : cliCommandText}
            </pre>
          </div>
        </div>

        {/* Step 7: Final Safe Switch Activation */}
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">
                Step 7 · Activate Connected Firebase Project
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Automatically saves a full backup of your current config (
              <code className="text-emerald-300">{activeConfig.projectId}</code>) before switching
              services cleanly to{' '}
              <code className="text-white">{normalizedPreview.projectId || '...'}</code>.
            </p>
          </div>
          <button
            type="button"
            disabled={!canActivate}
            onClick={() => setConfirmActivateOpen(true)}
            className="min-h-[42px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 shrink-0 disabled:opacity-45 transition-colors"
          >
            <span>Activate Project</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Backup History & Safe Rollback */}
      <div className="rounded-2xl border border-white/10 bg-[#0D1330] p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold font-display text-white">
              Configuration Backups &amp; Instant Rollback
            </h3>
          </div>
          <span className="text-[11px] text-slate-400">
            Zero data deletion on switch or rollback
          </span>
        </div>

        {backups.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#070B22]/70 p-4 text-xs text-slate-400 flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-slate-500 shrink-0" />
            <span>
              No previous switch backups yet. An automatic snapshot of{' '}
              <strong className="text-slate-200">{activeConfig.projectId}</strong> will be stored
              here the moment you activate another Firebase project.
            </span>
          </div>
        ) : (
          <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#070B22]/80">
            {backups.map((b) => (
              <div
                key={b.id}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{b.label}</p>
                  <p className="text-[11px] text-slate-400 font-mono-num truncate">
                    Project: {b.config.projectId} · DB: {b.config.firestoreDatabaseId || '(default)'}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Saved {new Date(b.backedUpAtIso).toLocaleString()} by {b.backedUpByEmail}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canManage}
                  onClick={() => setConfirmRollbackEntry(b)}
                  className="min-h-[36px] px-3.5 rounded-lg border border-sky-400/35 bg-sky-500/15 hover:bg-sky-500/25 text-xs font-bold text-sky-200 inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore Snapshot</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal: Activate New Firebase Project */}
      {confirmActivateOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-300 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold font-display text-white">
                  Confirm Firebase Project Switch
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  You are about to switch all website Authentication, Firestore, and Storage
                  connections to:
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#06091B] p-3.5 text-xs space-y-1.5 font-mono-num">
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Current:</span>
                <span className="text-slate-200">{activeConfig.projectId}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">New Target:</span>
                <span className="text-emerald-300 font-bold">{normalizedPreview.projectId}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Database ID:</span>
                <span className="text-white">
                  {normalizedPreview.firestoreDatabaseId || '(default)'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Your previous configuration is backed up automatically so you can roll back anytime.
              No data in either Firebase project will be overwritten or deleted. After switching,
              sign in using your Admin account on the new project.
            </p>

            <div className="flex gap-2.5 pt-1">
              <button
                type="button"
                disabled={activating}
                onClick={() => setConfirmActivateOpen(false)}
                className="flex-1 min-h-[42px] rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={activating}
                onClick={handleConfirmActivate}
                className="flex-1 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {activating && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{activating ? 'Activating...' : 'Confirm & Switch'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Rollback Snapshot */}
      {confirmRollbackEntry && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-extrabold font-display text-white">
              Restore Firebase Backup Snapshot?
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Restore active Firebase runtime to{' '}
              <strong className="text-sky-300 font-mono-num">
                {confirmRollbackEntry.config.projectId}
              </strong>{' '}
              ({confirmRollbackEntry.label})? Current config will also be saved to backup history.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmRollbackEntry(null)}
                className="flex-1 min-h-[40px] rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRollback}
                className="flex-1 min-h-[40px] rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold text-white"
              >
                Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Reset to Bundled Default */}
      {confirmDefaultResetOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0B1026] p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-extrabold font-display text-white">
              Restore Default Bundled Project?
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              Switch back to the default bundled Firebase project (
              <strong className="text-amber-300 font-mono-num">{bundledConfig.projectId}</strong>
              )? Your custom configuration remains saved in backup history.
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDefaultResetOpen(false)}
                className="flex-1 min-h-[40px] rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDefaultReset}
                className="flex-1 min-h-[40px] rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white"
              >
                Restore Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
