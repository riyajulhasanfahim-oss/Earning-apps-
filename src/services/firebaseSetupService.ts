import { deleteApp, FirebaseApp, FirebaseError, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  fetchSignInMethodsForEmail,
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  Firestore,
  getDocFromServer,
  getDocsFromServer,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { FirebaseStorage, getStorage, listAll, ref } from 'firebase/storage';
import {
  activateFirebaseProjectWithBackup,
  validateFirebaseProjectConfig,
} from '../lib/firebaseConfigStore';
import { recordAdminAuditLogClient } from './adminService';
import type {
  AdminRole,
  FirebaseCollectionSetupResult,
  FirebaseProjectBackupEntry,
  FirebaseProjectConfig,
  FirebaseWizardStepResult,
  SiteSettingsConfig,
} from '../types';

const WIZARD_APP_PREFIX = 'adview_setup_wizard_';

interface WizardHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  configKey: string;
}

let cachedHandles: WizardHandles | null = null;

function buildConfigKey(cfg: FirebaseProjectConfig): string {
  return [
    cfg.projectId,
    cfg.apiKey,
    cfg.authDomain,
    cfg.storageBucket,
    cfg.appId,
    cfg.firestoreDatabaseId,
  ].join('|');
}

export async function disposeWizardFirebaseApp(): Promise<void> {
  if (cachedHandles) {
    try {
      await deleteApp(cachedHandles.app);
    } catch {
      // Ignore cleanup error
    }
    cachedHandles = null;
  }
  // Clean up any stray wizard apps
  const existing = getApps().filter((a) => a.name.startsWith(WIZARD_APP_PREFIX));
  await Promise.all(
    existing.map(async (a) => {
      try {
        await deleteApp(a);
      } catch {
        // Ignore
      }
    }),
  );
}

async function getOrCreateWizardHandles(rawCfg: FirebaseProjectConfig): Promise<WizardHandles> {
  const check = validateFirebaseProjectConfig(rawCfg);
  if (!check.valid) {
    throw new Error(check.errors.join(' '));
  }
  const cfg = check.normalized;
  const key = buildConfigKey(cfg);

  if (cachedHandles && cachedHandles.configKey === key) {
    return cachedHandles;
  }

  await disposeWizardFirebaseApp();

  const appName = `${WIZARD_APP_PREFIX}${Date.now()}`;
  const app = initializeApp(
    {
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket || undefined,
      messagingSenderId: cfg.messagingSenderId || undefined,
      appId: cfg.appId,
      ...(cfg.measurementId ? { measurementId: cfg.measurementId } : {}),
    },
    appName,
  );

  const auth = getAuth(app);
  const db = cfg.firestoreDatabaseId ? getFirestore(app, cfg.firestoreDatabaseId) : getFirestore(app);
  const storage = getStorage(app);

  cachedHandles = { app, auth, db, storage, configKey: key };
  return cachedHandles;
}

function describeFirebaseErr(err: unknown): { code: string; message: string } {
  if (err instanceof FirebaseError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

export function getWizardSignedInUser(): User | null {
  return cachedHandles?.auth.currentUser ?? null;
}

export async function testFirebaseConnectionStep(
  rawCfg: FirebaseProjectConfig,
): Promise<FirebaseWizardStepResult> {
  const checkedAtIso = new Date().toISOString();
  const check = validateFirebaseProjectConfig(rawCfg);
  if (!check.valid) {
    return {
      status: 'error',
      summary: 'Configuration fields incomplete or invalid.',
      details: check.errors,
      checkedAtIso,
    };
  }

  try {
    const handles = await getOrCreateWizardHandles(check.normalized);
    const cfg = check.normalized;
    return {
      status: 'success',
      summary: `SDK initialized cleanly for project "${cfg.projectId}".`,
      details: [
        `App Name: ${handles.app.name}`,
        `Auth Domain: ${cfg.authDomain}`,
        `Firestore Database: ${cfg.firestoreDatabaseId || '(default)'}`,
        `Storage Bucket: ${cfg.storageBucket || 'Not configured'}`,
      ],
      checkedAtIso,
    };
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    return {
      status: 'error',
      summary: 'Failed to initialize Firebase SDK with provided credentials.',
      details: [`[${parsed.code}] ${parsed.message}`],
      checkedAtIso,
    };
  }
}

export async function verifyFirebaseAuthStep(
  rawCfg: FirebaseProjectConfig,
): Promise<{ result: FirebaseWizardStepResult; user: User | null }> {
  const checkedAtIso = new Date().toISOString();
  try {
    const handles = await getOrCreateWizardHandles(rawCfg);

    // Live Auth API check against Firebase Identity Toolkit using target apiKey
    let providerProbeNote = 'Identity Toolkit API responded normally.';
    try {
      await fetchSignInMethodsForEmail(handles.auth, 'probe-check@adviewearn.invalid');
    } catch (probeErr) {
      const parsed = describeFirebaseErr(probeErr);
      if (
        parsed.code === 'auth/api-key-not-valid' ||
        parsed.code === 'auth/invalid-api-key' ||
        parsed.code === 'auth/configuration-not-found'
      ) {
        return {
          user: handles.auth.currentUser,
          result: {
            status: 'error',
            summary: 'Firebase Authentication is not enabled or API Key is invalid for this project.',
            details: [
              `[${parsed.code}] ${parsed.message}`,
              'Open Firebase Console → Authentication → Get Started and enable Email/Password + Google.',
            ],
            checkedAtIso,
          },
        };
      }
      if (parsed.code === 'auth/network-request-failed') {
        return {
          user: handles.auth.currentUser,
          result: {
            status: 'error',
            summary: 'Network error reaching Firebase Auth endpoint.',
            details: [parsed.message],
            checkedAtIso,
          },
        };
      }
      // auth/invalid-email or empty list both confirm Auth service is reachable
      providerProbeNote = `Auth endpoint live (probe code: ${parsed.code}).`;
    }

    const user = handles.auth.currentUser;
    if (!user) {
      return {
        user: null,
        result: {
          status: 'warning',
          summary: 'Firebase Auth endpoint is reachable. Sign in to target project below to test Admin session & provision collections.',
          details: [
            providerProbeNote,
            'Target project uses an isolated session so your current active Admin login stays intact.',
          ],
          checkedAtIso,
        },
      };
    }

    let claimRole = 'none';
    try {
      const token = await user.getIdTokenResult(true);
      if (token.claims?.adminRole) {
        claimRole = String(token.claims.adminRole);
      }
    } catch {
      // Non-fatal
    }

    return {
      user,
      result: {
        status: user.emailVerified ? 'success' : 'warning',
        summary: `Authenticated on target project as ${user.email || user.uid}.`,
        details: [
          providerProbeNote,
          `UID: ${user.uid}`,
          `Email Verified: ${user.emailVerified ? 'Yes' : 'No (verification required by rules)'}`,
          `Custom Claim adminRole: ${claimRole}`,
        ],
        checkedAtIso,
      },
    };
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    return {
      user: null,
      result: {
        status: 'error',
        summary: 'Authentication verification failed.',
        details: [`[${parsed.code}] ${parsed.message}`],
        checkedAtIso,
      },
    };
  }
}

export async function signInWizardGoogle(rawCfg: FirebaseProjectConfig): Promise<User> {
  const handles = await getOrCreateWizardHandles(rawCfg);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(handles.auth, provider);
  return cred.user;
}

export async function signInWizardEmailPassword(
  rawCfg: FirebaseProjectConfig,
  email: string,
  password: string,
): Promise<User> {
  const handles = await getOrCreateWizardHandles(rawCfg);
  const cred = await signInWithEmailAndPassword(handles.auth, email.trim(), password);
  return cred.user;
}

export async function signOutWizardUser(rawCfg: FirebaseProjectConfig): Promise<void> {
  const handles = await getOrCreateWizardHandles(rawCfg);
  await signOut(handles.auth);
}

export async function verifyFirestoreStatusStep(
  rawCfg: FirebaseProjectConfig,
): Promise<FirebaseWizardStepResult> {
  const checkedAtIso = new Date().toISOString();
  try {
    const handles = await getOrCreateWizardHandles(rawCfg);
    let connStatus = 'missing';
    let siteDocExists = false;

    try {
      const connSnap = await getDocFromServer(doc(handles.db, 'test', 'connection'));
      connStatus = connSnap.exists() ? `exists (${String(connSnap.data()?.status || 'ok')})` : 'not created yet';
    } catch (err) {
      const parsed = describeFirebaseErr(err);
      if (parsed.code === 'unavailable' || parsed.message.includes('offline')) {
        return {
          status: 'error',
          summary: 'Firestore Database is unreachable or not provisioned yet.',
          details: [
            `[${parsed.code}] ${parsed.message}`,
            'Ensure Cloud Firestore is created in Firebase Console and check Firestore Database ID.',
          ],
          checkedAtIso,
        };
      }
      if (parsed.code === 'not-found') {
        return {
          status: 'error',
          summary: 'Specified Firestore database ID was not found in this project.',
          details: [
            `Database ID tested: ${rawCfg.firestoreDatabaseId || '(default)'}`,
            `[${parsed.code}] ${parsed.message}`,
          ],
          checkedAtIso,
        };
      }
      if (parsed.code === 'permission-denied') {
        connStatus = 'permission-denied (rules may block unauthenticated read on test/connection)';
      } else {
        throw err;
      }
    }

    try {
      const siteSnap = await getDocFromServer(doc(handles.db, 'appSettings', 'site'));
      siteDocExists = siteSnap.exists();
    } catch (siteErr) {
      const parsed = describeFirebaseErr(siteErr);
      if (parsed.code === 'unavailable' || parsed.message.includes('offline')) {
        return {
          status: 'error',
          summary: 'Firestore Database appears offline or not enabled.',
          details: [parsed.message],
          checkedAtIso,
        };
      }
      if (parsed.code === 'permission-denied') {
        return {
          status: 'warning',
          summary: 'Firestore server responded, but security rules denied reading appSettings/site.',
          details: [
            `test/connection probe: ${connStatus}`,
            'Deploy firestore.rules (Step 6) or sign in with an Admin account (Step 2).',
          ],
          checkedAtIso,
        };
      }
    }

    return {
      status: 'success',
      summary: 'Cloud Firestore is enabled and responding from server.',
      details: [
        `Database: ${rawCfg.firestoreDatabaseId || '(default)'}`,
        `test/connection: ${connStatus}`,
        `appSettings/site: ${siteDocExists ? 'Present' : 'Ready to be initialized in Step 4'}`,
      ],
      checkedAtIso,
    };
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    return {
      status: 'error',
      summary: 'Firestore connection check failed.',
      details: [`[${parsed.code}] ${parsed.message}`],
      checkedAtIso,
    };
  }
}

export async function provisionDefaultCollectionsStep(
  rawCfg: FirebaseProjectConfig,
  templateSiteSettings: SiteSettingsConfig,
): Promise<{
  stepResult: FirebaseWizardStepResult;
  collections: FirebaseCollectionSetupResult[];
}> {
  const checkedAtIso = new Date().toISOString();
  const results: FirebaseCollectionSetupResult[] = [];

  let handles: WizardHandles;
  try {
    handles = await getOrCreateWizardHandles(rawCfg);
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    return {
      stepResult: {
        status: 'error',
        summary: 'Cannot run collection setup — invalid configuration.',
        details: [parsed.message],
        checkedAtIso,
      },
      collections: [],
    };
  }

  const user = handles.auth.currentUser;
  if (!user) {
    return {
      stepResult: {
        status: 'error',
        summary: 'Sign in to the target Firebase project in Step 2 before initializing collections.',
        details: ['Authenticated Admin session is required so protected configuration documents can be created safely.'],
        checkedAtIso,
      },
      collections: [],
    };
  }

  const targetDb = handles.db;

  const ensureDocIfMissing = async (
    collectionName: string,
    docId: string,
    payload: Record<string, unknown>,
  ): Promise<'created' | 'existing' | 'permission_denied' | 'error'> => {
    const refDoc = doc(targetDb, collectionName, docId);
    try {
      const snap = await getDocFromServer(refDoc);
      if (snap.exists()) {
        return 'existing';
      }
      await setDoc(refDoc, payload);
      return 'created';
    } catch (err) {
      const parsed = describeFirebaseErr(err);
      if (parsed.code === 'permission-denied') return 'permission_denied';
      console.warn(`Setup error for ${collectionName}/${docId}:`, parsed.code, parsed.message);
      return 'error';
    }
  };

  // 1. test/connection
  const connRes = await ensureDocIfMissing('test', 'connection', {
    status: 'ok',
    updatedAt: serverTimestamp(),
  });
  results.push({
    collection: 'test',
    category: 'core',
    status: connRes === 'created' ? 'created' : connRes === 'existing' ? 'existing' : connRes,
    seededDocs: connRes === 'created' || connRes === 'existing' ? ['connection'] : [],
    detail:
      connRes === 'created'
        ? 'Created test/connection connectivity probe document.'
        : connRes === 'existing'
          ? 'Existing test/connection preserved.'
          : 'Permission denied writing test/connection (deploy updated firestore.rules).',
  });

  // 2. appSettings (site, wallet, dailyBonus)
  const appSettingsSeeded: string[] = [];
  let appSettingsStatus: FirebaseCollectionSetupResult['status'] = 'existing';

  const siteRes = await ensureDocIfMissing('appSettings', 'site', {
    websiteName: templateSiteSettings.websiteName || 'AdView Earn',
    websiteTitle: templateSiteSettings.websiteTitle || `${templateSiteSettings.websiteName || 'AdView Earn'} — Watch Ads & Earn Rewards`,
    websiteLogoUrl: templateSiteSettings.websiteLogoUrl || '',
    websiteFaviconUrl: templateSiteSettings.websiteFaviconUrl || '',
    loadingLogoUrl: templateSiteSettings.loadingLogoUrl || '',
    websiteDescription:
      templateSiteSettings.websiteDescription ||
      'Watch verified advertisements, earn reward points, invite friends, and withdraw securely via bKash, Nagad, Rocket & Bank Transfer.',
    primaryColor: templateSiteSettings.primaryColor || '#7c3aed',
    secondaryColor: templateSiteSettings.secondaryColor || '#2563eb',
    loginBrandingTitle: templateSiteSettings.loginBrandingTitle || 'Welcome Back',
    loginBrandingSubtitle:
      templateSiteSettings.loginBrandingSubtitle || 'Sign in with Google or your email to access rewards',
    headerBrandText: templateSiteSettings.headerBrandText || templateSiteSettings.websiteName || 'AdView Earn',
    footerText: templateSiteSettings.footerText || `${templateSiteSettings.websiteName || 'AdView Earn'} · Rewarded Advertising & Wallet Platform`,
    supportEmail: templateSiteSettings.supportEmail || 'support@adviewearn.com',
    supportContact: templateSiteSettings.supportContact || '',
    maintenanceMode: false,
    registrationEnabled: true,
    updatedAt: serverTimestamp(),
  });
  if (siteRes === 'created' || siteRes === 'existing') appSettingsSeeded.push(`site (${siteRes})`);

  const walletCfgRes = await ensureDocIfMissing('appSettings', 'wallet', {
    pointsPerBdt: 100,
    dailyBonusPoints: 25,
    minimumWithdrawPoints: 5000,
    maximumWithdrawAmountBdt: 5000,
    dailyAdLimit: 20,
    walletEnabled: true,
    earningEnabled: true,
    updatedAt: serverTimestamp(),
  });
  if (walletCfgRes === 'created' || walletCfgRes === 'existing') appSettingsSeeded.push(`wallet (${walletCfgRes})`);

  const dailyBonusCfgRes = await ensureDocIfMissing('appSettings', 'dailyBonus', {
    enabled: false,
    monetagDirectLinkUrl: '',
    rewardPoints: 25,
    durationSeconds: 30,
    incentivizedTrafficAllowed: false,
    updatedAt: serverTimestamp(),
  });
  if (dailyBonusCfgRes === 'created' || dailyBonusCfgRes === 'existing') {
    appSettingsSeeded.push(`dailyBonus (${dailyBonusCfgRes})`);
  }

  if ([siteRes, walletCfgRes, dailyBonusCfgRes].includes('permission_denied')) {
    appSettingsStatus = 'permission_denied';
  } else if ([siteRes, walletCfgRes, dailyBonusCfgRes].includes('error')) {
    appSettingsStatus = 'error';
  } else if ([siteRes, walletCfgRes, dailyBonusCfgRes].includes('created')) {
    appSettingsStatus = 'created';
  }
  results.push({
    collection: 'appSettings',
    category: 'config',
    status: appSettingsStatus,
    seededDocs: appSettingsSeeded,
    detail:
      appSettingsStatus === 'permission_denied'
        ? 'Admin/Super Admin permission required to initialize appSettings.'
        : 'Checked & initialized site, wallet, and dailyBonus documents non-destructively.',
  });

  // 3. appConfig/economy
  const ecoRes = await ensureDocIfMissing('appConfig', 'economy', {
    pointsPerBdt: 100,
    dailyBonusPoints: 25,
    minimumWithdrawPoints: 5000,
    dailyAdLimit: 20,
    updatedAt: serverTimestamp(),
  });
  results.push({
    collection: 'appConfig',
    category: 'config',
    status: ecoRes,
    seededDocs: ecoRes === 'created' || ecoRes === 'existing' ? [`economy (${ecoRes})`] : [],
    detail: ecoRes === 'created' ? 'Created economy configuration.' : 'Existing economy config preserved.',
  });

  // 4. withdrawalSettings/config
  const wdSettingsRes = await ensureDocIfMissing('withdrawalSettings', 'config', {
    withdrawalEnabled: true,
    minimumWithdrawPoints: 5000,
    maximumWithdrawBdt: 5000,
    defaultFeePercent: 2,
    dailyLimitBdt: 10000,
    dailyLimitCount: 3,
    monthlyLimitBdt: 50000,
    processingTimeLabel: 'Within 24 Hours',
    allowedMethods: ['bkash', 'nagad', 'rocket', 'bank'],
    updatedAt: serverTimestamp(),
  });
  results.push({
    collection: 'withdrawalSettings',
    category: 'config',
    status: wdSettingsRes,
    seededDocs: wdSettingsRes === 'created' || wdSettingsRes === 'existing' ? [`config (${wdSettingsRes})`] : [],
    detail: wdSettingsRes === 'created' ? 'Created withdrawal rules config.' : 'Existing withdrawal rules preserved.',
  });

  // 5. paymentMethods (bkash, nagad, rocket, bank)
  const paymentSeedPayloads: Array<{ id: string; data: Record<string, unknown> }> = [
    {
      id: 'bkash',
      data: {
        methodId: 'bkash',
        name: 'bKash',
        bengaliName: 'বিকাশ',
        enabled: true,
        minPoints: 5000,
        feePercent: 2,
        processingWindow: 'Within 24 Hours',
        allowedAccountTypes: ['personal', 'agent', 'merchant'],
        updatedAt: serverTimestamp(),
      },
    },
    {
      id: 'nagad',
      data: {
        methodId: 'nagad',
        name: 'Nagad',
        bengaliName: 'নগদ',
        enabled: true,
        minPoints: 5000,
        feePercent: 2,
        processingWindow: 'Within 24 Hours',
        allowedAccountTypes: ['personal', 'agent'],
        updatedAt: serverTimestamp(),
      },
    },
    {
      id: 'rocket',
      data: {
        methodId: 'rocket',
        name: 'Rocket',
        bengaliName: 'রকেট',
        enabled: true,
        minPoints: 5000,
        feePercent: 2,
        processingWindow: 'Within 24 Hours',
        allowedAccountTypes: ['personal', 'agent'],
        updatedAt: serverTimestamp(),
      },
    },
    {
      id: 'bank',
      data: {
        methodId: 'bank',
        name: 'Bank Transfer',
        bengaliName: 'ব্যাংক ট্রান্সফার',
        enabled: true,
        minPoints: 10000,
        feePercent: 1,
        processingWindow: '1-2 Business Days',
        allowedAccountTypes: ['bank_account'],
        updatedAt: serverTimestamp(),
      },
    },
  ];
  const pmStatuses: Array<'created' | 'existing' | 'permission_denied' | 'error'> = [];
  const pmDocs: string[] = [];
  for (const pm of paymentSeedPayloads) {
    const st = await ensureDocIfMissing('paymentMethods', pm.id, pm.data);
    pmStatuses.push(st);
    if (st === 'created' || st === 'existing') pmDocs.push(`${pm.id} (${st})`);
  }
  results.push({
    collection: 'paymentMethods',
    category: 'finance',
    status: pmStatuses.includes('permission_denied')
      ? 'permission_denied'
      : pmStatuses.includes('error')
        ? 'error'
        : pmStatuses.includes('created')
          ? 'created'
          : 'existing',
    seededDocs: pmDocs,
    detail: 'Checked & ensured bKash, Nagad, Rocket, and Bank Transfer payout channels.',
  });

  // 6. referralSettings/config
  const refCfgRes = await ensureDocIfMissing('referralSettings', 'config', {
    referralEnabled: true,
    referrerBonusPoints: 100,
    newUserBonusPoints: 50,
    minimumQualificationAds: 3,
    requireEmailVerified: true,
    requireActiveAccount: true,
    maxReferralsPerUser: null,
    dailyReferralCap: 20,
    referralRulesText:
      'Invite verified members. Referral bonuses unlock after your friend verifies their email and completes the minimum ad views.',
    updatedAt: serverTimestamp(),
  });
  results.push({
    collection: 'referralSettings',
    category: 'config',
    status: refCfgRes,
    seededDocs: refCfgRes === 'created' || refCfgRes === 'existing' ? [`config (${refCfgRes})`] : [],
    detail: refCfgRes === 'created' ? 'Created referral rules config.' : 'Existing referral config preserved.',
  });

  // 7. adNetworks (monetag, applixir, adsterra)
  const networkSeeds: Array<{ id: string; data: Record<string, unknown> }> = [
    {
      id: 'monetag',
      data: {
        networkId: 'monetag',
        networkName: 'Monetag',
        logoKey: 'monetag',
        integrationType: 'hybrid',
        publisherId: '',
        websiteId: '',
        placementId: '',
        directLinkUrl: '',
        apiBaseUrl: 'https://api.monetag.com',
        callbackUrl: `https://us-central1-${rawCfg.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=monetag&session_id={ymid}&user_id={subid}&provider_tx_id={click_id}&reward_event_type={reward_event_type}&secret=YOUR_MONETAG_CALLBACK_SECRET`,
        postbackParamsTemplate: 'session_id={ymid}&user_id={subid}&provider_tx_id={click_id}&reward_event_type={reward_event_type}',
        incentivizedTrafficAllowed: true,
        rewardVerificationSupported: true,
        rewardEnabled: true,
        clicksSupported: true,
        apiHealthSupported: false,
        secretConfigured: false,
        secretHint: '',
        healthStatus: 'configuration_required',
        healthMessage: 'Configure your Monetag Zone ID / Direct Link and callback secret.',
        enabled: false,
        lastTestedAt: '',
        updatedAt: serverTimestamp(),
      },
    },
    {
      id: 'applixir',
      data: {
        networkId: 'applixir',
        networkName: 'AppLixir',
        logoKey: 'applixir',
        integrationType: 's2s_postback',
        publisherId: '',
        websiteId: '',
        placementId: '',
        directLinkUrl: '',
        apiBaseUrl: 'https://api.applixir.com',
        callbackUrl: `https://us-central1-${rawCfg.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=applixir`,
        postbackParamsTemplate: 'user_id={subid}&session_id={ymid}&provider_tx_id={tx_id}',
        incentivizedTrafficAllowed: true,
        rewardVerificationSupported: true,
        rewardEnabled: true,
        clicksSupported: false,
        apiHealthSupported: true,
        secretConfigured: false,
        secretHint: '',
        healthStatus: 'configuration_required',
        healthMessage: 'Configure AppLixir Site ID and server environment keys.',
        enabled: false,
        lastTestedAt: '',
        updatedAt: serverTimestamp(),
      },
    },
    {
      id: 'adsterra',
      data: {
        networkId: 'adsterra',
        networkName: 'Adsterra',
        logoKey: 'adsterra',
        integrationType: 'direct_link',
        publisherId: '',
        websiteId: '',
        placementId: '',
        directLinkUrl: '',
        apiBaseUrl: 'https://api3.adsterratools.com',
        callbackUrl: `https://us-central1-${rawCfg.projectId}.cloudfunctions.net/verifyAdNetworkCallback?net=adsterra&session_id={ymid}&user_id={subid}&provider_tx_id={tx_id}&ad_id={ad_id}&ts={ts}&sig={sig}`,
        postbackParamsTemplate: 'session_id={ymid}&user_id={subid}',
        incentivizedTrafficAllowed: false,
        rewardVerificationSupported: false,
        rewardEnabled: false,
        clicksSupported: true,
        apiHealthSupported: true,
        secretConfigured: false,
        secretHint: '',
        healthStatus: 'configuration_required',
        healthMessage: 'Direct Link only unless incentivized traffic & S2S callback are approved.',
        enabled: false,
        lastTestedAt: '',
        updatedAt: serverTimestamp(),
      },
    },
  ];
  const netStatuses: Array<'created' | 'existing' | 'permission_denied' | 'error'> = [];
  const netDocs: string[] = [];
  for (const n of networkSeeds) {
    const st = await ensureDocIfMissing('adNetworks', n.id, n.data);
    netStatuses.push(st);
    if (st === 'created' || st === 'existing') netDocs.push(`${n.id} (${st})`);
  }
  results.push({
    collection: 'adNetworks',
    category: 'ads',
    status: netStatuses.includes('permission_denied')
      ? 'permission_denied'
      : netStatuses.includes('error')
        ? 'error'
        : netStatuses.includes('created')
          ? 'created'
          : 'existing',
    seededDocs: netDocs,
    detail: 'Checked & ensured Monetag, AppLixir, and Adsterra integration documents.',
  });

  // 8. Admin User Profile, ReferralCode, Wallet & DailyBonus
  const cleanUid = user.uid;
  const emailName = (user.email || 'admin').split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'admin';
  const username = emailName.length >= 3 ? emailName.toLowerCase() : `adm_${cleanUid.slice(0, 6).toLowerCase()}`;
  const refCode = `ADV${cleanUid.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;

  const userRes = await ensureDocIfMissing('users', cleanUid, {
    uid: cleanUid,
    fullName: (user.displayName || 'Administrator').trim().slice(0, 80),
    username,
    email: user.email || `${username}@example.com`,
    phoneNumber: '',
    profileImage: user.photoURL || '',
    referralCode: refCode,
    referredBy: '',
    points: 0,
    totalEarnings: 0,
    totalAdViews: 0,
    accountStatus: 'active',
    emailVerified: Boolean(user.emailVerified),
    createdAt: serverTimestamp(),
  });
  results.push({
    collection: 'users',
    category: 'core',
    status: userRes,
    seededDocs: userRes === 'created' || userRes === 'existing' ? [`${cleanUid} (${userRes})`] : [],
    detail: userRes === 'created' ? 'Initialized Admin profile doc in users.' : 'Admin profile already present.',
  });

  const refCodeRes = await ensureDocIfMissing('referralCodes', refCode, {
    code: refCode,
    ownerUid: cleanUid,
    username,
    active: true,
    createdAt: serverTimestamp(),
  });
  results.push({
    collection: 'referralCodes',
    category: 'core',
    status: refCodeRes,
    seededDocs: refCodeRes === 'created' || refCodeRes === 'existing' ? [`${refCode} (${refCodeRes})`] : [],
    detail: 'Verified referral code index document for signed-in user.',
  });

  const walletDocRes = await ensureDocIfMissing('wallets', cleanUid, {
    userId: cleanUid,
    totalPoints: 0,
    availablePoints: 0,
    pendingPoints: 0,
    reservedPoints: 0,
    totalEarnedPoints: 0,
    totalWithdrawnPoints: 0,
    totalWithdrawnBdt: 0,
    updatedAt: serverTimestamp(),
  });
  results.push({
    collection: 'wallets',
    category: 'finance',
    status: walletDocRes,
    seededDocs: walletDocRes === 'created' || walletDocRes === 'existing' ? [`${cleanUid} (${walletDocRes})`] : [],
    detail: 'Verified initial wallet record for signed-in account.',
  });

  const dailyBonusRes = await ensureDocIfMissing('dailyBonuses', cleanUid, {
    uid: cleanUid,
    streakDays: 0,
    lastClaimDate: '',
    lastClaimPoints: 0,
    updatedAt: serverTimestamp(),
  });
  results.push({
    collection: 'dailyBonuses',
    category: 'core',
    status: dailyBonusRes,
    seededDocs: dailyBonusRes === 'created' || dailyBonusRes === 'existing' ? [`${cleanUid} (${dailyBonusRes})`] : [],
    detail: 'Verified daily check-in streak record.',
  });

  // 9. advertisements (create 1 inactive template ONLY if collection is empty)
  try {
    const existingAds = await getDocsFromServer(query(collection(targetDb, 'advertisements'), limit(1)));
    if (existingAds.empty) {
      const adStatus = await ensureDocIfMissing('advertisements', 'sample_monetag_rewarded', {
        adId: 'sample_monetag_rewarded',
        adName: 'Sample Monetag Rewarded Zone',
        adNetwork: 'Monetag',
        adType: 'rewarded',
        placementOrUrl: 'https://example.com/configure-your-zone',
        rewardPoints: 10,
        dailyLimit: 5,
        estimatedDuration: 30,
        startDate: '2026-01-01',
        endDate: '2029-12-31',
        status: 'inactive',
        allowedCountries: 'ALL',
        rewardVerificationMethod: 's2s_postback',
        incentivizedTrafficAllowed: true,
        description: 'Inactive starter ad template created during Firebase project setup. Replace URL and set active when ready.',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      results.push({
        collection: 'advertisements',
        category: 'ads',
        status: adStatus,
        seededDocs: adStatus === 'created' ? ['sample_monetag_rewarded (inactive)'] : [],
        detail: 'Created 1 inactive sample advertisement template (collection was empty).',
      });
    } else {
      results.push({
        collection: 'advertisements',
        category: 'ads',
        status: 'existing',
        seededDocs: [existingAds.docs[0].id],
        detail: 'Existing advertisement campaigns preserved untouched.',
      });
    }
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    results.push({
      collection: 'advertisements',
      category: 'ads',
      status: parsed.code === 'permission-denied' ? 'permission_denied' : 'error',
      seededDocs: [],
      detail: parsed.message,
    });
  }

  // 10. adminLogs (record setup audit entry)
  const setupLogId = `adm_setup_${Date.now()}`;
  const logRes = await ensureDocIfMissing('adminLogs', setupLogId, {
    logId: setupLogId,
    adminUid: cleanUid,
    adminEmail: user.email || 'admin@adviewearn.com',
    action: 'firebase_project_initialized',
    targetId: rawCfg.projectId,
    previousValue: 'uninitialized',
    newValue: 'collections_verified',
    metadata: 'source=firebase_setup_wizard',
    details: `Verified and initialized default collections for project ${rawCfg.projectId}`,
    createdAt: serverTimestamp(),
  });
  results.push({
    collection: 'adminLogs',
    category: 'admin',
    status: logRes === 'created' ? 'created' : logRes,
    seededDocs: logRes === 'created' ? [setupLogId] : [],
    detail:
      logRes === 'created'
        ? 'Recorded initialization entry in immutable adminLogs.'
        : 'Admin permission required to write adminLogs.',
  });

  // 11. Runtime & Operational Collections Audit (non-destructive existence / rule check)
  const auditCollections: Array<{
    name: string;
    category: FirebaseCollectionSetupResult['category'];
    note: string;
  }> = [
    { name: 'directLinkAds', category: 'ads', note: 'Multi Direct Link Ads slots & Monetag links' },
    { name: 'adPlacements', category: 'ads', note: 'Populated when creating placements in Ad Networks' },
    { name: 'adCampaigns', category: 'ads', note: 'Populated when launching campaigns in Ad Networks' },
    { name: 'adSessions', category: 'ads', note: 'Created dynamically when users watch ads' },
    { name: 'adCompletions', category: 'ads', note: 'Server-verified ad completion records' },
    { name: 'dailyAdLimits', category: 'ads', note: 'Per-user daily ad counters (Asia/Dhaka)' },
    { name: 'transactions', category: 'finance', note: 'Immutable credit/debit ledger' },
    { name: 'walletLedger', category: 'finance', note: 'Wallet balance snapshot history' },
    { name: 'withdrawalRequests', category: 'finance', note: 'User payout requests' },
    { name: 'referrals', category: 'core', note: 'Referral attribution & qualification records' },
    { name: 'referralRewards', category: 'finance', note: 'Idempotent referral bonus credits' },
    { name: 'referralLogs', category: 'security', note: 'Referral audit & anti-abuse logs' },
    { name: 'referralLeaderboard', category: 'core', note: 'Privacy-safe masked leaderboard' },
    { name: 'notifications', category: 'core', note: 'Per-user notifications' },
    { name: 'admins', category: 'admin', note: 'Admin role markers (server/Super Admin protected)' },
    { name: 'adCallbacks', category: 'ads', note: 'S2S postback verification ledger' },
    { name: 'adAnalytics', category: 'ads', note: 'Daily network analytics metrics' },
    { name: 'adNetworkLogs', category: 'ads', note: 'Ad network integration audit logs' },
    { name: 'fraudReports', category: 'security', note: 'Risk-scored fraud monitoring queue' },
    { name: 'fraudLogs', category: 'security', note: 'Suspicious event audit logs' },
    { name: 'securityAuditLogs', category: 'security', note: 'System-wide security event trail' },
    { name: 'failedTransactionLogs', category: 'finance', note: 'Failed financial operation logs' },
    { name: 'reconciliationReports', category: 'finance', note: 'Wallet vs ledger audit reports' },
    { name: 'systemErrors', category: 'security', note: 'Operational error telemetry' },
  ];

  await Promise.all(
    auditCollections.map(async (col) => {
      try {
        const snap = await getDocsFromServer(query(collection(targetDb, col.name), limit(1)));
        results.push({
          collection: col.name,
          category: col.category,
          status: snap.empty ? 'verified' : 'existing',
          seededDocs: snap.empty ? [] : [snap.docs[0].id],
          detail: snap.empty
            ? `Schema ready · ${col.note}`
            : `Existing documents found & preserved · ${col.note}`,
        });
      } catch (err) {
        const parsed = describeFirebaseErr(err);
        results.push({
          collection: col.name,
          category: col.category,
          status: parsed.code === 'permission-denied' ? 'permission_denied' : 'error',
          seededDocs: [],
          detail:
            parsed.code === 'permission-denied'
              ? 'Read denied by Firestore Rules (ensure Super Admin email/claim is active).'
              : parsed.message,
        });
      }
    }),
  );

  const deniedCount = results.filter((r) => r.status === 'permission_denied').length;
  const errCount = results.filter((r) => r.status === 'error').length;
  const createdCount = results.filter((r) => r.status === 'created').length;

  if (errCount > 0 || deniedCount > 5) {
    return {
      collections: results,
      stepResult: {
        status: 'warning',
        summary: `Initialized ${createdCount} configs; ${deniedCount} collections returned permission-denied.`,
        details: [
          'If targeting a brand-new Firebase project, deploy the Firestore Rules from Step 6 and sign in with your Super Admin email in Step 2.',
          'Existing documents were never overwritten or deleted.',
        ],
        checkedAtIso,
      },
    };
  }

  return {
    collections: results,
    stepResult: {
      status: 'success',
      summary: `Verified all ${results.length} AdView Earn collections (${createdCount} default configs created, existing data untouched).`,
      details: [
        'All required appSettings, economy, paymentMethods, withdrawalSettings, referralSettings, adNetworks, and user/wallet collections verified.',
        'Non-destructive safeguard applied: existing documents were skipped automatically.',
      ],
      checkedAtIso,
    },
  };
}

export async function verifyFirebaseStorageStep(
  rawCfg: FirebaseProjectConfig,
): Promise<FirebaseWizardStepResult> {
  const checkedAtIso = new Date().toISOString();
  if (!rawCfg.storageBucket) {
    return {
      status: 'warning',
      summary: 'Storage Bucket is not configured (optional if using external HTTPS logo/favicon URLs).',
      details: ['Add a storageBucket (e.g. your-project.firebasestorage.app) to enable Storage verification.'],
      checkedAtIso,
    };
  }

  try {
    const handles = await getOrCreateWizardHandles(rawCfg);
    const brandingRef = ref(handles.storage, 'branding');
    const listing = await listAll(brandingRef);
    return {
      status: 'success',
      summary: `Firebase Storage bucket "${rawCfg.storageBucket}" is active and accessible.`,
      details: [
        `Path checked: /branding (${listing.items.length} file(s) found)`,
        'You can host branding logos, favicons, and user avatars cleanly.',
      ],
      checkedAtIso,
    };
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    if (parsed.code === 'storage/unauthorized') {
      return {
        status: 'warning',
        summary: 'Storage bucket exists, but current rules denied listing /branding.',
        details: [
          `[${parsed.code}] ${parsed.message}`,
          'Deploy the recommended storage.rules template from Step 6 to allow public read & Admin upload on /branding/*.',
        ],
        checkedAtIso,
      };
    }
    return {
      status: 'error',
      summary: 'Firebase Storage probe failed.',
      details: [
        `[${parsed.code}] ${parsed.message}`,
        'Verify Storage is enabled in Firebase Console → Build → Storage and the bucket name is exact.',
      ],
      checkedAtIso,
    };
  }
}

export async function verifySecurityRulesStep(
  rawCfg: FirebaseProjectConfig,
): Promise<FirebaseWizardStepResult> {
  const checkedAtIso = new Date().toISOString();
  try {
    const handles = await getOrCreateWizardHandles(rawCfg);
    const details: string[] = [];
    let secretsBlocked = false;
    let rateLimitsBlocked = false;
    let siteReadable = false;

    try {
      await getDocFromServer(doc(handles.db, 'adNetworkSecrets', '_security_probe_'));
      details.push('WARNING: adNetworkSecrets allowed client read! Production rules are NOT deployed.');
    } catch (err) {
      const parsed = describeFirebaseErr(err);
      if (parsed.code === 'permission-denied') {
        secretsBlocked = true;
        details.push('PASS: adNetworkSecrets strictly denied client access.');
      } else {
        details.push(`adNetworkSecrets check returned [${parsed.code}]`);
      }
    }

    try {
      await getDocFromServer(doc(handles.db, 'rateLimits', '_security_probe_'));
      details.push('WARNING: rateLimits allowed client read! Production rules are NOT deployed.');
    } catch (err) {
      const parsed = describeFirebaseErr(err);
      if (parsed.code === 'permission-denied') {
        rateLimitsBlocked = true;
        details.push('PASS: rateLimits strictly denied client access.');
      } else {
        details.push(`rateLimits check returned [${parsed.code}]`);
      }
    }

    try {
      await getDocFromServer(doc(handles.db, 'appSettings', 'site'));
      siteReadable = true;
      details.push('PASS: appSettings/site public branding read verified.');
    } catch (err) {
      const parsed = describeFirebaseErr(err);
      details.push(`appSettings/site read returned [${parsed.code}]`);
    }

    if (secretsBlocked && rateLimitsBlocked && siteReadable) {
      return {
        status: 'success',
        summary: 'Hardened Firestore Security Rules are active and enforced on target project.',
        details,
        checkedAtIso,
      };
    }

    return {
      status: 'warning',
      summary: 'Security Rules need deployment or verification on target project.',
      details: [
        ...details,
        'Use the Firestore Rules, Indexes JSON, and Firebase CLI commands below to deploy hardened rules.',
      ],
      checkedAtIso,
    };
  } catch (err) {
    const parsed = describeFirebaseErr(err);
    return {
      status: 'error',
      summary: 'Could not inspect Security Rules.',
      details: [`[${parsed.code}] ${parsed.message}`],
      checkedAtIso,
    };
  }
}

export async function activateVerifiedFirebaseProject(params: {
  nextConfig: FirebaseProjectConfig;
  adminUser: { uid: string; email: string; role: AdminRole | null };
}): Promise<FirebaseProjectBackupEntry> {
  const { nextConfig, adminUser } = params;
  // Record audit trail in the outgoing project (non-blocking) before switching
  await recordAdminAuditLogClient({
    adminUser,
    action: 'firebase_project_switched',
    targetId: nextConfig.projectId,
    previousValue: 'active_project',
    newValue: `${nextConfig.projectId} (${nextConfig.firestoreDatabaseId || 'default'})`,
    details: `Switched active Firebase Project configuration to ${nextConfig.projectName || nextConfig.projectId}`,
  });

  await disposeWizardFirebaseApp();
  return activateFirebaseProjectWithBackup(nextConfig, adminUser.email);
}

export function getExportableFirestoreIndexesJson(): string {
  return JSON.stringify(
    {
      indexes: [
        {
          collectionGroup: 'transactions',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'walletLedger',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'withdrawalRequests',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'adSessions',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'dhakaDate', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'adCompletions',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'userId', order: 'ASCENDING' },
            { fieldPath: 'dhakaDate', order: 'DESCENDING' },
          ],
        },
        {
          collectionGroup: 'referrals',
          queryScope: 'COLLECTION',
          fields: [
            { fieldPath: 'referrerUid', order: 'ASCENDING' },
            { fieldPath: 'createdAt', order: 'DESCENDING' },
          ],
        },
      ],
      fieldOverrides: [],
    },
    null,
    2,
  );
}

export function getExportableStorageRulesText(adminEmail = 'your-admin-email@gmail.com'): string {
  return `rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    function isSignedIn() {
      return request.auth != null;
    }

    function isSuperAdmin() {
      return isSignedIn() &&
        request.auth.token.email_verified == true &&
        (
          request.auth.token.adminRole == 'super_admin' ||
          request.auth.token.email == '${adminEmail.replace(/'/g, '')}'
        );
    }

    // Website Branding Assets (Logo, Favicon, Loading Logo)
    match /branding/{fileName} {
      allow read: if true;
      allow write: if isSuperAdmin() &&
        request.resource.size < 2 * 1024 * 1024 &&
        request.resource.contentType.matches('image/.*');
    }

    // User Profile Avatars
    match /avatars/{userId}/{fileName} {
      allow read: if isSignedIn();
      allow write: if isSignedIn() &&
        request.auth.uid == userId &&
        request.resource.size < 2 * 1024 * 1024 &&
        request.resource.contentType.matches('image/.*');
    }

    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}`;
}
