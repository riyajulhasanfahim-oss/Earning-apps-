import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  Advertisement,
  DirectLinkAdRecord,
  DirectLinkPlacement,
  RewardVerificationMethod,
} from '../types';
import { formatDhakaDateTime } from './appService';
import {
  MAX_AD_VIEW_SECONDS,
  MIN_AD_VIEW_SECONDS,
  normalizeAdDurationSeconds,
} from './dashboardService';

const DEFAULT_AD_VIEW_SECONDS = MIN_AD_VIEW_SECONDS;

function formatFirestoreTimestamp(ts: unknown): { label: string; millis: number } {
  if (ts instanceof Timestamp) {
    const ms = ts.toDate().getTime();
    return { millis: ms, label: formatDhakaDateTime(ms) };
  }
  return { millis: 0, label: 'Recent' };
}

export const DIRECT_LINK_PLACEMENT_OPTIONS: Array<{
  value: DirectLinkPlacement;
  label: string;
  bengaliLabel: string;
  shortTag: string;
  description: string;
}> = [
  {
    value: 'home_page',
    label: 'Home Page Advertisement',
    bengaliLabel: 'হোম পেজ বিজ্ঞাপন',
    shortTag: 'Home Page',
    description: 'Featured Direct Link showcase strip on the main Home Page.',
  },
  {
    value: 'available_ads',
    label: 'Available Ads',
    bengaliLabel: 'Available Ads সেকশন',
    shortTag: 'Available Ads',
    description: 'Appears inside the Available Ads list on the Home dashboard.',
  },
  {
    value: 'watch_ads',
    label: 'Watch Ads Page',
    bengaliLabel: 'Watch Ads পেজ',
    shortTag: 'Watch Ads',
    description: 'Displayed on the dedicated Watch & Earn advertisements page.',
  },
  {
    value: 'daily_bonus',
    label: 'Daily Check-in Bonus',
    bengaliLabel: 'Daily Check-in Bonus',
    shortTag: 'Daily Bonus',
    description: 'Partner Direct Links displayed inside the Daily Check-in Bonus section.',
  },
  {
    value: 'featured_section',
    label: 'Featured Partner Section',
    bengaliLabel: 'অন্যান্য বিজ্ঞাপন সেকশন',
    shortTag: 'Featured Partner',
    description: 'Cross-portal Sponsored Partner Spotlight (Wallet & Referral pages).',
  },
];

export const PLACEMENT_LABEL_MAP: Record<DirectLinkPlacement, string> = {
  home_page: 'Home Page Advertisement',
  available_ads: 'Available Ads',
  watch_ads: 'Watch Ads Page',
  daily_bonus: 'Daily Check-in Bonus',
  featured_section: 'Featured Partner Section',
};

export interface DefaultMonetagDirectLinkSeed {
  linkId: string;
  sortOrder: number;
  title: string;
  url: string;
  adNetwork: string;
  placement: DirectLinkPlacement;
  estimatedDuration: number;
  dailyLimit: number;
  notes: string;
}

export const DEFAULT_MONETAG_DIRECT_LINKS: DefaultMonetagDirectLinkSeed[] = [
  {
    linkId: 'uplcm_12321305',
    sortOrder: 1,
    title: 'Monetag Direct Partner #1',
    url: 'https://uplcm.com/4/12321305',
    adNetwork: 'Monetag',
    placement: 'home_page',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 1 · Zone 12321305 (Home Page Advertisement)',
  },
  {
    linkId: 'uplcm_12325667',
    sortOrder: 2,
    title: 'Monetag Direct Partner #2',
    url: 'https://uplcm.com/4/12325667',
    adNetwork: 'Monetag',
    placement: 'home_page',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 2 · Zone 12325667 (Home Page Advertisement)',
  },
  {
    linkId: 'uplcm_12325669',
    sortOrder: 3,
    title: 'Monetag Direct Campaign #3',
    url: 'https://uplcm.com/4/12325669',
    adNetwork: 'Monetag',
    placement: 'available_ads',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 3 · Zone 12325669 (Available Ads)',
  },
  {
    linkId: 'uplcm_12325670',
    sortOrder: 4,
    title: 'Monetag Direct Campaign #4',
    url: 'https://uplcm.com/4/12325670',
    adNetwork: 'Monetag',
    placement: 'available_ads',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 4 · Zone 12325670 (Available Ads)',
  },
  {
    linkId: 'uplcm_12325671',
    sortOrder: 5,
    title: 'Monetag Watch Ads Offer #5',
    url: 'https://uplcm.com/4/12325671',
    adNetwork: 'Monetag',
    placement: 'watch_ads',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 5 · Zone 12325671 (Watch Ads Page)',
  },
  {
    linkId: 'uplcm_12325673',
    sortOrder: 6,
    title: 'Monetag Watch Ads Offer #6',
    url: 'https://uplcm.com/4/12325673',
    adNetwork: 'Monetag',
    placement: 'watch_ads',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 6 · Zone 12325673 (Watch Ads Page)',
  },
  {
    linkId: 'uplcm_12325675',
    sortOrder: 7,
    title: 'Monetag Daily Bonus Partner #7',
    url: 'https://uplcm.com/4/12325675',
    adNetwork: 'Monetag',
    placement: 'daily_bonus',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 7 · Zone 12325675 (Daily Check-in Bonus)',
  },
  {
    linkId: 'uplcm_12325677',
    sortOrder: 8,
    title: 'Monetag Daily Bonus Partner #8',
    url: 'https://uplcm.com/4/12325677',
    adNetwork: 'Monetag',
    placement: 'daily_bonus',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 8 · Zone 12325677 (Daily Check-in Bonus)',
  },
  {
    linkId: 'uplcm_12325678',
    sortOrder: 9,
    title: 'Monetag Featured Spotlight #9',
    url: 'https://uplcm.com/4/12325678',
    adNetwork: 'Monetag',
    placement: 'featured_section',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 9 · Zone 12325678 (Featured Partner Section)',
  },
  {
    linkId: 'uplcm_12325679',
    sortOrder: 10,
    title: 'Monetag Featured Spotlight #10',
    url: 'https://uplcm.com/4/12325679',
    adNetwork: 'Monetag',
    placement: 'featured_section',
    estimatedDuration: DEFAULT_AD_VIEW_SECONDS,
    dailyLimit: 1,
    notes: 'Slot 10 · Zone 12325679 (Featured Partner Section)',
  },
];

function isDirectLinkPlacement(val: unknown): val is DirectLinkPlacement {
  return (
    val === 'home_page' ||
    val === 'available_ads' ||
    val === 'watch_ads' ||
    val === 'daily_bonus' ||
    val === 'featured_section'
  );
}

function mapDirectLinkDoc(id: string, data: Record<string, unknown>): DirectLinkAdRecord {
  const created = formatFirestoreTimestamp(data.createdAt);
  const updated = formatFirestoreTimestamp(data.updatedAt);
  const rawMethod = String(data.rewardVerificationMethod || 'none');
  const rewardVerificationMethod: RewardVerificationMethod =
    rawMethod === 's2s_postback' || rawMethod === 'sdk_callback' ? rawMethod : 'none';
  const incentivizedTrafficAllowed = Boolean(data.incentivizedTrafficAllowed);
  const rawPoints = Math.max(0, Math.floor(Number(data.rewardPoints || 0)));
  const rewardPoints =
    incentivizedTrafficAllowed && rewardVerificationMethod !== 'none' ? rawPoints : 0;

  return {
    id,
    linkId: String(data.linkId || id),
    title: String(data.title || 'Sponsored Direct Link'),
    url: String(data.url || ''),
    adNetwork: String(data.adNetwork || 'Monetag'),
    placement: isDirectLinkPlacement(data.placement) ? data.placement : 'available_ads',
    rewardPoints,
    estimatedDuration: normalizeAdDurationSeconds(data.estimatedDuration),
    dailyLimit: Math.max(1, Math.floor(Number(data.dailyLimit || 1))),
    status: data.status === 'active' ? 'active' : 'inactive',
    incentivizedTrafficAllowed,
    rewardVerificationMethod,
    sortOrder: Math.max(0, Math.floor(Number(data.sortOrder ?? 0))),
    notes: String(data.notes || ''),
    createdAtMillis: created.millis,
    updatedAtMillis: updated.millis || created.millis,
  };
}

export function isVerifiedRewardedDirectLink(link: DirectLinkAdRecord): boolean {
  return (
    link.status === 'active' &&
    link.incentivizedTrafficAllowed &&
    link.rewardVerificationMethod !== 'none' &&
    link.rewardPoints > 0 &&
    /^https:\/\/.+/i.test(link.url.trim())
  );
}

/**
 * Converts an approved, server-verified Direct Link into an Advertisement object
 * compatible with the existing verified session + 30s timer + S2S callback pipeline.
 */
export function toPlayableAdvertisement(link: DirectLinkAdRecord): Advertisement {
  return {
    id: link.linkId,
    adId: link.linkId,
    adName: link.title,
    adNetwork: link.adNetwork || 'Monetag',
    adType: 'direct_link',
    placementOrUrl: link.url,
    rewardPoints: link.rewardPoints,
    dailyLimit: link.dailyLimit,
    estimatedDuration: normalizeAdDurationSeconds(link.estimatedDuration),
    startDate: '2026-01-01',
    endDate: '2029-12-31',
    status: link.status,
    allowedCountries: 'ALL',
    rewardVerificationMethod: link.rewardVerificationMethod,
    incentivizedTrafficAllowed: link.incentivizedTrafficAllowed,
    description: link.notes || `Partner Direct Link (${PLACEMENT_LABEL_MAP[link.placement]})`,
    createdAtMillis: link.createdAtMillis,
    updatedAtMillis: link.updatedAtMillis,
  };
}

export function subscribeToActiveDirectLinkAds(
  onData: (links: DirectLinkAdRecord[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const path = 'directLinkAds';
  const q = query(collection(db, 'directLinkAds'), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => mapDirectLinkDoc(d.id, d.data() as Record<string, unknown>))
        .filter((item) => /^https:\/\/.+/i.test(item.url.trim()));
      items.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAtMillis - a.updatedAtMillis);
      onData(items);
    },
    (error) => {
      if (!onError) return;
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function subscribeToAllDirectLinkAds(
  onData: (links: DirectLinkAdRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'directLinkAds';
  return onSnapshot(
    collection(db, 'directLinkAds'),
    (snap) => {
      const items = snap.docs.map((d) =>
        mapDirectLinkDoc(d.id, d.data() as Record<string, unknown>),
      );
      items.sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAtMillis - a.updatedAtMillis);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

async function writeDirectLinkAdminLog(
  adminUser: { uid: string; email: string },
  action: string,
  targetId: string,
  details: string,
): Promise<void> {
  const logId = `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'adminLogs', logId), {
      logId,
      adminUid: adminUser.uid,
      adminEmail: adminUser.email || 'admin@adviewearn.com',
      action: action.slice(0, 80),
      targetId: targetId.slice(0, 128),
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Audit write should not abort completed config save if optional
  }
}

/**
 * Keeps `/advertisements/{linkId}` in sync strictly for Verified Rewarded Direct Links
 * so Cloud Functions (`createAdSession`, `verifyAdNetworkCallback`, `verifyAdSessionReward`)
 * can enforce server-side session & S2S verification. Non-incentivized or inactive links
 * deactivate any matching `/advertisements/{linkId}` record so they can never be rewarded.
 */
async function syncBackingAdvertisementDoc(input: {
  linkId: string;
  title: string;
  url: string;
  adNetwork: string;
  placement: DirectLinkPlacement;
  rewardPoints: number;
  estimatedDuration: number;
  dailyLimit: number;
  status: 'active' | 'inactive';
  incentivizedTrafficAllowed: boolean;
  rewardVerificationMethod: RewardVerificationMethod;
}): Promise<void> {
  const adRef = doc(db, 'advertisements', input.linkId);
  const rewardReady =
    input.status === 'active' &&
    input.incentivizedTrafficAllowed &&
    input.rewardVerificationMethod !== 'none' &&
    input.rewardPoints > 0;

  try {
    const existingSnap = await getDocFromServer(adRef);

    if (!rewardReady) {
      if (existingSnap.exists()) {
        await updateDoc(adRef, {
          status: 'inactive',
          updatedAt: serverTimestamp(),
        });
      }
      return;
    }

    const adPayload = {
      adId: input.linkId,
      adName: input.title,
      adNetwork: input.adNetwork,
      adType: 'direct_link' as const,
      placementOrUrl: input.url,
      rewardPoints: input.rewardPoints,
      dailyLimit: input.dailyLimit,
      estimatedDuration: input.estimatedDuration,
      startDate: '2026-01-01',
      endDate: '2029-12-31',
      status: 'active' as const,
      allowedCountries: 'ALL',
      rewardVerificationMethod: input.rewardVerificationMethod,
      incentivizedTrafficAllowed: true,
      description: `Managed via Multi Direct Link Ads (${PLACEMENT_LABEL_MAP[input.placement]})`,
      updatedAt: serverTimestamp(),
    };

    if (existingSnap.exists()) {
      await updateDoc(adRef, adPayload);
    } else {
      await setDoc(adRef, {
        ...adPayload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn(`Unable to sync advertisements/${input.linkId}:`, err);
  }
}

export interface SaveDirectLinkAdInput {
  linkId: string;
  title: string;
  url: string;
  adNetwork: string;
  placement: DirectLinkPlacement;
  rewardPoints: number;
  estimatedDuration: number;
  dailyLimit: number;
  status: 'active' | 'inactive';
  incentivizedTrafficAllowed: boolean;
  rewardVerificationMethod: RewardVerificationMethod;
  sortOrder: number;
  notes?: string;
  isNew: boolean;
}

export async function saveDirectLinkAd(
  input: SaveDirectLinkAdInput,
  adminUser?: { uid: string; email: string },
): Promise<void> {
  const cleanId = input.linkId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  if (cleanId.length < 2) {
    throw new Error('Link ID must contain at least 2 valid characters.');
  }

  const cleanTitle = input.title.trim().slice(0, 100);
  if (cleanTitle.length < 2) {
    throw new Error('Advertisement title must be at least 2 characters.');
  }

  const cleanUrl = input.url.trim().slice(0, 500);
  if (!/^https:\/\/.+/i.test(cleanUrl)) {
    throw new Error('Direct Link URL must start with https://');
  }

  const cleanNetwork = (input.adNetwork.trim() || 'Monetag').slice(0, 60);
  const rawDuration = Math.floor(Number(input.estimatedDuration || DEFAULT_AD_VIEW_SECONDS));
  const cleanDuration = Math.min(
    MAX_AD_VIEW_SECONDS,
    Math.max(MIN_AD_VIEW_SECONDS, rawDuration),
  );
  const cleanDailyLimit = Math.min(500, Math.max(1, Math.floor(Number(input.dailyLimit || 1))));
  const cleanSortOrder = Math.min(1000, Math.max(0, Math.floor(Number(input.sortOrder || 0))));
  const cleanNotes = (input.notes ?? '').trim().slice(0, 300);

  const rawPoints = Math.min(10000, Math.max(0, Math.floor(Number(input.rewardPoints || 0))));
  const incentivized = Boolean(input.incentivizedTrafficAllowed);
  const method: RewardVerificationMethod =
    input.rewardVerificationMethod === 's2s_postback' ||
    input.rewardVerificationMethod === 'sdk_callback'
      ? input.rewardVerificationMethod
      : 'none';

  if (rawPoints > 0 && (!incentivized || method === 'none')) {
    throw new Error(
      'To award points (e.g. 150 Pts) on a Direct Link, you must enable Incentivized Traffic Approval AND select S2S Postback or SDK Callback verification.',
    );
  }

  const effectivePoints = incentivized && method !== 'none' ? rawPoints : 0;

  const ref = doc(db, 'directLinkAds', cleanId);
  const path = `directLinkAds/${cleanId}`;

  try {
    if (input.isNew) {
      await setDoc(ref, {
        linkId: cleanId,
        title: cleanTitle,
        url: cleanUrl,
        adNetwork: cleanNetwork,
        placement: input.placement,
        rewardPoints: effectivePoints,
        estimatedDuration: cleanDuration,
        dailyLimit: cleanDailyLimit,
        status: input.status,
        incentivizedTrafficAllowed: incentivized,
        rewardVerificationMethod: method,
        sortOrder: cleanSortOrder,
        notes: cleanNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        title: cleanTitle,
        url: cleanUrl,
        adNetwork: cleanNetwork,
        placement: input.placement,
        rewardPoints: effectivePoints,
        estimatedDuration: cleanDuration,
        dailyLimit: cleanDailyLimit,
        status: input.status,
        incentivizedTrafficAllowed: incentivized,
        rewardVerificationMethod: method,
        sortOrder: cleanSortOrder,
        notes: cleanNotes,
        updatedAt: serverTimestamp(),
      });
    }

    await syncBackingAdvertisementDoc({
      linkId: cleanId,
      title: cleanTitle,
      url: cleanUrl,
      adNetwork: cleanNetwork,
      placement: input.placement,
      rewardPoints: effectivePoints,
      estimatedDuration: cleanDuration,
      dailyLimit: cleanDailyLimit,
      status: input.status,
      incentivizedTrafficAllowed: incentivized,
      rewardVerificationMethod: method,
    });

    if (adminUser) {
      await writeDirectLinkAdminLog(
        adminUser,
        input.isNew ? 'direct_link_created' : 'direct_link_updated',
        cleanId,
        `${cleanTitle} (${PLACEMENT_LABEL_MAP[input.placement]}, ${effectivePoints} Pts, ${cleanDuration}s, ${input.status})`,
      );
    }
  } catch (error) {
    handleFirestoreError(
      error,
      input.isNew ? OperationType.CREATE : OperationType.UPDATE,
      path,
    );
  }
}

export async function toggleDirectLinkAdStatus(
  link: DirectLinkAdRecord,
  adminUser?: { uid: string; email: string },
): Promise<void> {
  const nextStatus: 'active' | 'inactive' = link.status === 'active' ? 'inactive' : 'active';
  const path = `directLinkAds/${link.linkId}`;
  try {
    await updateDoc(doc(db, 'directLinkAds', link.linkId), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    await syncBackingAdvertisementDoc({
      linkId: link.linkId,
      title: link.title,
      url: link.url,
      adNetwork: link.adNetwork,
      placement: link.placement,
      rewardPoints: link.rewardPoints,
      estimatedDuration: link.estimatedDuration,
      dailyLimit: link.dailyLimit,
      status: nextStatus,
      incentivizedTrafficAllowed: link.incentivizedTrafficAllowed,
      rewardVerificationMethod: link.rewardVerificationMethod,
    });
    if (adminUser) {
      await writeDirectLinkAdminLog(
        adminUser,
        'direct_link_toggled',
        link.linkId,
        `${link.title} status changed to ${nextStatus}`,
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteDirectLinkAd(
  link: DirectLinkAdRecord,
  adminUser?: { uid: string; email: string },
): Promise<void> {
  const path = `directLinkAds/${link.linkId}`;
  try {
    await deleteDoc(doc(db, 'directLinkAds', link.linkId));
    // Also deactivate or remove any backing advertisement document so paused/deleted links cannot start sessions
    try {
      const adRef = doc(db, 'advertisements', link.linkId);
      const adSnap = await getDocFromServer(adRef);
      if (adSnap.exists()) {
        await deleteDoc(adRef);
      }
    } catch {
      // ignore if backing ad doc doesn't exist
    }
    if (adminUser) {
      await writeDirectLinkAdminLog(
        adminUser,
        'direct_link_deleted',
        link.linkId,
        `Deleted Direct Link ad "${link.title}" (${link.url})`,
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Idempotently seeds any missing entries from the 10 predefined Monetag Direct Links.
 * Preserves any existing customized links untouched.
 * Seeds in Non-Incentivized Safe Mode (0 Pts) by default unless `enableVerified150Preset` is explicitly chosen.
 */
export async function seedDefaultMonetagDirectLinks(
  adminUser: { uid: string; email: string },
  options?: { enableVerified150Preset?: boolean },
): Promise<{ createdCount: number; skippedCount: number }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication required.');
  }

  const snap = await getDocsFromServer(collection(db, 'directLinkAds'));
  const existingIds = new Set(snap.docs.map((d) => d.id));
  const existingUrls = new Set(
    snap.docs.map((d) => String(d.data().url || '').trim().toLowerCase()),
  );

  const rewardMode = Boolean(options?.enableVerified150Preset);
  let createdCount = 0;
  let skippedCount = 0;

  for (const item of DEFAULT_MONETAG_DIRECT_LINKS) {
    if (
      existingIds.has(item.linkId) ||
      existingUrls.has(item.url.trim().toLowerCase())
    ) {
      skippedCount += 1;
      continue;
    }

    await saveDirectLinkAd(
      {
        linkId: item.linkId,
        title: item.title,
        url: item.url,
        adNetwork: item.adNetwork,
        placement: item.placement,
        rewardPoints: rewardMode ? 150 : 0,
        estimatedDuration: item.estimatedDuration,
        dailyLimit: item.dailyLimit,
        status: 'active',
        incentivizedTrafficAllowed: rewardMode,
        rewardVerificationMethod: rewardMode ? 's2s_postback' : 'none',
        sortOrder: item.sortOrder,
        notes: item.notes,
        isNew: true,
      },
      undefined,
    );
    createdCount += 1;
  }

  if (createdCount > 0) {
    await writeDirectLinkAdminLog(
      adminUser,
      'direct_links_seeded',
      'multi_direct_links',
      `Seeded ${createdCount} Monetag Direct Links (mode=${rewardMode ? '150_pts_s2s_verified' : 'standard_0_pts'})`,
    );
  }

  return { createdCount, skippedCount };
}
