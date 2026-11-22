import { initializeApp } from 'firebase/app';
import { AppCheck, getToken, initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import bundledConfig from '../../firebase-applet-config.json';
import { getActiveFirebaseProjectConfig } from './firebaseConfigStore';
import type { AppCheckState } from '../types';

export const activeFirebaseConfig = getActiveFirebaseProjectConfig();

export const firebaseApp = initializeApp({
  apiKey: activeFirebaseConfig.apiKey,
  authDomain: activeFirebaseConfig.authDomain,
  projectId: activeFirebaseConfig.projectId,
  storageBucket: activeFirebaseConfig.storageBucket || undefined,
  messagingSenderId: activeFirebaseConfig.messagingSenderId || undefined,
  appId: activeFirebaseConfig.appId,
  ...(activeFirebaseConfig.measurementId
    ? { measurementId: activeFirebaseConfig.measurementId }
    : {}),
});

export const db = activeFirebaseConfig.firestoreDatabaseId
  ? getFirestore(firebaseApp, activeFirebaseConfig.firestoreDatabaseId)
  : getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);

// --- Firebase App Check (Conditional Production / Dev Initialization) ---
const configuredSiteKey = (
  import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY ||
  (bundledConfig as { recaptchaSiteKey?: string }).recaptchaSiteKey ||
  ''
).trim();

const debugTokenEnv = (import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || '').trim();
const isDevEnvironment = Boolean(import.meta.env.DEV);

let appCheckInstance: AppCheck | null = null;
let appCheckEnabled = false;

if (typeof window !== 'undefined' && configuredSiteKey.length > 0) {
  try {
    if (isDevEnvironment && debugTokenEnv) {
      (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
        debugTokenEnv === 'true' ? true : debugTokenEnv;
    }
    appCheckInstance = initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaV3Provider(configuredSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckEnabled = true;
  } catch (err) {
    console.warn('Firebase App Check initialization skipped:', err);
  }
}

export const appCheckState: AppCheckState = {
  enabled: appCheckEnabled,
  provider: appCheckEnabled ? 'recaptcha_v3' : 'none',
  siteKeyConfigured: configuredSiteKey.length > 0,
  debugMode: isDevEnvironment && Boolean(debugTokenEnv),
};

export async function getAppCheckTokenHeader(): Promise<Record<string, string>> {
  if (!appCheckInstance) return {};
  try {
    const result = await getToken(appCheckInstance, false);
    if (result?.token) {
      return { 'X-Firebase-AppCheck': result.token };
    }
  } catch (err) {
    console.warn('Unable to retrieve App Check token:', err);
  }
  return {};
}

export async function reportSystemError(
  operation: string,
  message: string,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  source: 'client' | 'cloud_function' | 'app_check' | 'firestore' = 'client',
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const errorId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'systemErrors', errorId), {
      errorId,
      userId: uid,
      source,
      operation: operation.trim().slice(0, 100) || 'unknown_operation',
      message: message.trim().slice(0, 500) || 'Unknown error',
      severity,
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking error monitor
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration. Firestore client is offline.');
    }
  }
}

void testConnection();

