import bundledRawConfig from '../../firebase-applet-config.json';
import type { FirebaseProjectBackupEntry, FirebaseProjectConfig } from '../types';

const ACTIVE_CONFIG_STORAGE_KEY = 'adview_active_firebase_config_v1';
const BACKUP_HISTORY_STORAGE_KEY = 'adview_firebase_config_backups_v1';
const MAX_BACKUP_ENTRIES = 15;

export function getBundledFirebaseConfig(): FirebaseProjectConfig {
  const raw = bundledRawConfig as Record<string, unknown>;
  return {
    projectId: String(raw.projectId || '').trim(),
    projectName: String(raw.projectName || raw.projectId || 'Default AdView Project').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    authDomain: String(raw.authDomain || '').trim(),
    storageBucket: String(raw.storageBucket || '').trim(),
    messagingSenderId: String(raw.messagingSenderId || '').trim(),
    appId: String(raw.appId || '').trim(),
    measurementId: String(raw.measurementId || '').trim(),
    firestoreDatabaseId: String(raw.firestoreDatabaseId || '').trim(),
  };
}

export function normalizeFirebaseProjectConfig(
  input: Partial<FirebaseProjectConfig> | Record<string, unknown>,
): FirebaseProjectConfig {
  const raw = input as Record<string, unknown>;
  const projectId = String(raw.projectId || '').trim();
  const rawDbId = String(raw.firestoreDatabaseId || '').trim();
  const firestoreDatabaseId = rawDbId === '(default)' ? '' : rawDbId;

  return {
    projectId,
    projectName: String(raw.projectName || projectId || 'Firebase Project').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    authDomain: String(raw.authDomain || (projectId ? `${projectId}.firebaseapp.com` : '')).trim(),
    storageBucket: String(
      raw.storageBucket || (projectId ? `${projectId}.firebasestorage.app` : ''),
    ).trim(),
    messagingSenderId: String(raw.messagingSenderId || '').trim(),
    appId: String(raw.appId || '').trim(),
    measurementId: String(raw.measurementId || '').trim(),
    firestoreDatabaseId,
  };
}

export function validateFirebaseProjectConfig(
  input: Partial<FirebaseProjectConfig> | Record<string, unknown>,
): { valid: boolean; errors: string[]; normalized: FirebaseProjectConfig } {
  const normalized = normalizeFirebaseProjectConfig(input);
  const errors: string[] = [];

  if (!normalized.projectId || !/^[a-z0-9-]+$/.test(normalized.projectId)) {
    errors.push('Firebase Project ID must contain only lowercase letters, numbers, and hyphens.');
  }
  if (!normalized.apiKey || normalized.apiKey.length < 16) {
    errors.push('Firebase API Key appears missing or too short.');
  }
  if (!normalized.authDomain || !normalized.authDomain.includes('.')) {
    errors.push('Auth Domain must be a valid hostname (e.g. your-project.firebaseapp.com).');
  }
  if (!normalized.appId || !normalized.appId.includes(':')) {
    errors.push('App ID must be a valid Firebase Web App ID (e.g. 1:123456:web:abcdef).');
  }
  if (normalized.storageBucket && normalized.storageBucket.includes(' ')) {
    errors.push('Storage Bucket must not contain spaces.');
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

export function getActiveFirebaseProjectConfig(): FirebaseProjectConfig {
  const fallback = getBundledFirebaseConfig();
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(ACTIVE_CONFIG_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FirebaseProjectConfig>;
    const check = validateFirebaseProjectConfig(parsed);
    if (!check.valid) return fallback;
    return check.normalized;
  } catch {
    return fallback;
  }
}

export function isCustomFirebaseProjectActive(): boolean {
  const active = getActiveFirebaseProjectConfig();
  const bundled = getBundledFirebaseConfig();
  return (
    active.projectId !== bundled.projectId ||
    active.apiKey !== bundled.apiKey ||
    active.appId !== bundled.appId ||
    active.firestoreDatabaseId !== bundled.firestoreDatabaseId
  );
}

export function parseFirebaseConfigInput(
  rawText: string,
): { ok: true; config: FirebaseProjectConfig } | { ok: false; error: string } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, error: 'Paste your Firebase JSON or SDK firebaseConfig snippet first.' };
  }

  let parsedObj: Record<string, unknown> | null = null;

  // Attempt 1: Pure JSON
  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      parsedObj = direct as Record<string, unknown>;
    }
  } catch {
    // Fall back to safe JS snippet extraction
  }

  // Attempt 2: Firebase Console JS snippet (const firebaseConfig = { ... };) without eval
  if (!parsedObj) {
    try {
      const startBrace = trimmed.indexOf('{');
      const endBrace = trimmed.lastIndexOf('}');
      if (startBrace === -1 || endBrace <= startBrace) {
        return { ok: false, error: 'Could not find a configuration object `{ ... }` in the pasted text.' };
      }
      let objectSlice = trimmed.slice(startBrace, endBrace + 1);
      // Strip single-line and block comments safely outside quotes
      objectSlice = objectSlice
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Quote unquoted keys
      objectSlice = objectSlice.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
      // Convert single-quoted string literals to double-quoted
      objectSlice = objectSlice.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => {
        const escaped = inner.replace(/\\'/g, "'").replace(/"/g, '\\"');
        return `"${escaped}"`;
      });
      // Remove trailing commas before closing brace/bracket
      objectSlice = objectSlice.replace(/,\s*([}\]])/g, '$1');

      const obj = JSON.parse(objectSlice) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        parsedObj = obj as Record<string, unknown>;
      }
    } catch {
      return {
        ok: false,
        error: 'Unable to parse configuration. Paste valid JSON or the standard `const firebaseConfig = { ... }` snippet from Firebase Console.',
      };
    }
  }

  if (!parsedObj) {
    return { ok: false, error: 'Invalid Firebase configuration format.' };
  }

  const { valid, errors, normalized } = validateFirebaseProjectConfig(parsedObj);
  if (!valid) {
    return { ok: false, error: errors[0] || 'Missing required Firebase fields.' };
  }
  return { ok: true, config: normalized };
}

export function exportFirebaseConfigJson(cfg: FirebaseProjectConfig): string {
  const payload: Record<string, string> = {
    projectId: cfg.projectId,
    projectName: cfg.projectName || cfg.projectId,
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
    ...(cfg.measurementId ? { measurementId: cfg.measurementId } : {}),
    ...(cfg.firestoreDatabaseId ? { firestoreDatabaseId: cfg.firestoreDatabaseId } : {}),
  };
  return JSON.stringify(payload, null, 2);
}

export function getFirebaseConfigBackups(): FirebaseProjectBackupEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BACKUP_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FirebaseProjectBackupEntry =>
        Boolean(item && typeof item === 'object' && 'id' in item && 'config' in item),
    );
  } catch {
    return [];
  }
}

function writeBackupList(list: FirebaseProjectBackupEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      BACKUP_HISTORY_STORAGE_KEY,
      JSON.stringify(list.slice(0, MAX_BACKUP_ENTRIES)),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function saveFirebaseConfigBackup(
  label: string,
  config: FirebaseProjectConfig,
  backedUpByEmail: string,
): FirebaseProjectBackupEntry {
  const entry: FirebaseProjectBackupEntry = {
    id: `fb_bak_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    backedUpAtIso: new Date().toISOString(),
    backedUpByEmail: backedUpByEmail || 'admin',
    config: normalizeFirebaseProjectConfig(config),
  };
  const existing = getFirebaseConfigBackups();
  // Avoid duplicating identical consecutive snapshot for same project
  const deduped = existing.filter(
    (b) =>
      !(
        b.config.projectId === entry.config.projectId &&
        b.config.appId === entry.config.appId &&
        b.config.firestoreDatabaseId === entry.config.firestoreDatabaseId
      ),
  );
  writeBackupList([entry, ...deduped]);
  return entry;
}

export function activateFirebaseProjectWithBackup(
  nextConfig: FirebaseProjectConfig,
  adminEmail: string,
): FirebaseProjectBackupEntry {
  const current = getActiveFirebaseProjectConfig();
  const backup = saveFirebaseConfigBackup(
    `Pre-Switch Backup (${current.projectName || current.projectId})`,
    current,
    adminEmail,
  );
  const check = validateFirebaseProjectConfig(nextConfig);
  if (!check.valid) {
    throw new Error(check.errors.join(' '));
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACTIVE_CONFIG_STORAGE_KEY, JSON.stringify(check.normalized));
  }
  return backup;
}

export function rollbackToFirebaseBackup(
  backupId: string,
  adminEmail: string,
): FirebaseProjectConfig | null {
  const backups = getFirebaseConfigBackups();
  const found = backups.find((b) => b.id === backupId);
  if (!found) return null;

  const current = getActiveFirebaseProjectConfig();
  saveFirebaseConfigBackup(
    `Before Rollback (${current.projectName || current.projectId})`,
    current,
    adminEmail,
  );

  const normalized = normalizeFirebaseProjectConfig(found.config);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACTIVE_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function resetToBundledFirebaseConfig(adminEmail = 'recovery'): FirebaseProjectConfig {
  const current = getActiveFirebaseProjectConfig();
  if (isCustomFirebaseProjectActive()) {
    saveFirebaseConfigBackup(
      `Before Default Reset (${current.projectName || current.projectId})`,
      current,
      adminEmail,
    );
  }
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(ACTIVE_CONFIG_STORAGE_KEY);
  }
  return getBundledFirebaseConfig();
}
