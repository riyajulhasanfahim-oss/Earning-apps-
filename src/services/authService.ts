import {
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import {
  activeFirebaseConfig as firebaseConfig,
  auth,
  db,
  getAppCheckTokenHeader,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  FirestoreUserDoc,
  ReferralQualificationStatus,
  ReferralRewardStatus,
  ReferredUser,
  RegisterPayload,
  UserProfile,
} from '../types';
import { formatDhakaDateTime, maskUsername } from './appService';

export function mapAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/email-already-in-use':
        return 'This email address is already registered. Please sign in instead.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/weak-password':
        return 'Password is too weak. Use at least 6 characters with letters and numbers.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Incorrect email address or password. Please try again.';
      case 'auth/too-many-requests':
        return 'Too many attempts detected. Please wait a moment before trying again.';
      case 'auth/user-disabled':
        return 'This account has been disabled. Please contact support.';
      case 'auth/network-request-failed':
        return 'Network connection error. Please check your internet and try again.';
      case 'auth/requires-recent-login':
        return 'For your security, please sign out and sign back in before changing your password.';
      case 'auth/popup-closed-by-user':
        return 'Google sign-in popup was closed before finishing. Please try again.';
      case 'auth/cancelled-popup-request':
        return 'Previous Google sign-in request was cancelled. Please try again.';
      case 'auth/popup-blocked':
        return 'Popups are blocked by your browser. Please allow popups for this site and try again.';
      case 'auth/account-exists-with-different-credential':
        return 'An account already exists with this email using Email & Password. Please sign in with your password.';
      case 'auth/operation-not-allowed':
        return 'This sign-in provider is not yet enabled in Firebase Console (Authentication → Sign-in method).';
      default:
        return error.message.replace(/^Firebase:\s*/i, '');
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected authentication error occurred.';
}

async function emitAuthSecurityTelemetry(
  eventType:
    | 'login_success'
    | 'login_failed'
    | 'registration_completed'
    | 'password_reset_requested',
  emailHint = '',
): Promise<void> {
  try {
    const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/recordAuthSecurityEvent`;
    const [idToken, appCheckHeaders] = await Promise.all([
      auth.currentUser ? auth.currentUser.getIdToken().catch(() => '') : Promise.resolve(''),
      getAppCheckTokenHeader().catch(() => ({})),
    ]);
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        ...appCheckHeaders,
      },
      body: JSON.stringify({
        eventType,
        emailHint: emailHint.trim().slice(0, 120),
      }),
    }).catch(() => {});
  } catch {
    // Non-blocking security telemetry
  }
}

export function deriveUserLevel(totalEarnings: number): UserProfile['level'] {
  if (totalEarnings >= 50000) return 'Platinum Member';
  if (totalEarnings >= 20000) return 'Gold Member';
  if (totalEarnings >= 5000) return 'Silver Member';
  return 'Bronze Member';
}

export function toUserProfile(docData: FirestoreUserDoc): UserProfile {
  let joinedAt = 'Just now';
  if (docData.createdAt instanceof Timestamp) {
    joinedAt = docData.createdAt.toDate().toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }
  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://adviewearn.com';
  return {
    ...docData,
    level: deriveUserLevel(docData.totalEarnings),
    verified: docData.emailVerified,
    referralLink: `${baseUrl}/register?ref=${docData.referralCode}`,
    joinedAt,
  };
}

async function generateUniqueAdvReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const digits = attempt < 6 ? 5 : 6;
    const min = Math.pow(10, digits - 1);
    const max = Math.pow(10, digits) - 1;
    const num = Math.floor(min + Math.random() * (max - min + 1));
    const candidate = `ADV${num}`;
    try {
      const snap = await getDoc(doc(db, 'referralCodes', candidate));
      if (!snap.exists()) {
        return candidate;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `referralCodes/${candidate}`);
    }
  }
  const fallbackSuffix = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `ADV${fallbackSuffix}`;
}

export async function registerUserWithEmail(payload: RegisterPayload): Promise<User> {
  const cleanName = payload.fullName.trim();
  const cleanUsername = payload.username.trim().toLowerCase();
  const cleanEmail = payload.email.trim().toLowerCase();
  const cleanPhone = payload.phoneNumber.trim();
  const enteredRefCode = payload.referralCode?.trim().toUpperCase() || '';

  if (cleanEmail === 'riyajulhasanfahim@gmail.com') {
    throw new Error('This email address is already registered. Please sign in instead.');
  }

  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new Error('Full name must be between 2 and 80 characters.');
  }
  if (!/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
    throw new Error(
      'Username must be 3–30 characters using only letters, numbers, and underscores.',
    );
  }
  if (cleanPhone.length < 6 || cleanPhone.length > 25) {
    throw new Error('Please enter a valid mobile number (6–25 characters).');
  }

  // 1. Validate entered referral code if provided before creating Auth account
  let referrerUid = '';
  if (enteredRefCode) {
    if (!/^[A-Z0-9_]{3,30}$/.test(enteredRefCode)) {
      throw new Error('Invalid referral code format.');
    }
    const refLookupPath = `referralCodes/${enteredRefCode}`;
    let refSnap;
    try {
      refSnap = await getDoc(doc(db, 'referralCodes', enteredRefCode));
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, refLookupPath);
    }
    if (!refSnap.exists() || !refSnap.data()?.active) {
      throw new Error('Invalid or inactive referral code. Please check the code or leave it blank.');
    }
    referrerUid = String(refSnap.data().ownerUid || '');
  }

  // 2. Generate guaranteed non-duplicating ADV referral code
  const ownReferralCode = await generateUniqueAdvReferralCode();
  if (enteredRefCode && enteredRefCode === ownReferralCode) {
    throw new Error('You cannot use your own referral code.');
  }

  // 3. Create Firebase Auth user
  await setPersistence(auth, browserLocalPersistence);
  const credential = await createUserWithEmailAndPassword(auth, cleanEmail, payload.password);
  const firebaseUser = credential.user;

  if (referrerUid && referrerUid === firebaseUser.uid) {
    throw new Error('Self-referral is not allowed.');
  }

  // 4. Update Auth displayName & dispatch email verification
  await updateProfile(firebaseUser, { displayName: cleanName });
  await sendEmailVerification(firebaseUser);

  // 5. Atomic Firestore batch write: users/{uid} + referralCodes/{ownCode} + optional referrals/{uid}
  const batch = writeBatch(db);
  const userDocRef = doc(db, 'users', firebaseUser.uid);
  const codeDocRef = doc(db, 'referralCodes', ownReferralCode);

  batch.set(userDocRef, {
    uid: firebaseUser.uid,
    fullName: cleanName,
    username: cleanUsername,
    email: firebaseUser.email ?? cleanEmail,
    phoneNumber: cleanPhone,
    profileImage: '',
    referralCode: ownReferralCode,
    referredBy: referrerUid,
    points: 0,
    totalEarnings: 0,
    totalAdViews: 0,
    accountStatus: 'active',
    emailVerified: false,
    createdAt: serverTimestamp(),
  });

  batch.set(codeDocRef, {
    code: ownReferralCode,
    ownerUid: firebaseUser.uid,
    username: cleanUsername,
    active: true,
    createdAt: serverTimestamp(),
  });

  if (referrerUid && enteredRefCode) {
    const referralDocRef = doc(db, 'referrals', firebaseUser.uid);
    batch.set(referralDocRef, {
      referralId: firebaseUser.uid,
      referrerUid,
      referredUid: firebaseUser.uid,
      referredName: cleanName,
      referredUsername: cleanUsername,
      referralCodeUsed: enteredRefCode,
      qualificationStatus: 'registered',
      rewardStatus: 'pending',
      rewardPoints: 0,
      bonusEarnedPoints: 0,
      newUserBonusPoints: 0,
      rejectionReason: '',
      status: 'active',
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
  }

  void emitAuthSecurityTelemetry('registration_completed', cleanEmail);
  return firebaseUser;
}

export async function loginUserWithEmail(
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<User> {
  await setPersistence(
    auth,
    rememberMe ? browserLocalPersistence : browserSessionPersistence,
  );
  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (err) {
    void emitAuthSecurityTelemetry('login_failed', email.trim());
    throw err;
  }
  await reload(credential.user);

  // Sync emailVerified if newly verified before signing in
  if (credential.user.emailVerified) {
    const userRef = doc(db, 'users', credential.user.uid);
    try {
      const snap = await getDoc(userRef);
      if (snap.exists() && snap.data().emailVerified === false) {
        await updateDoc(userRef, { emailVerified: true });
      }
    } catch {
      // Non-blocking sync; listener will surface profile state
    }
  }

  void emitAuthSecurityTelemetry('login_success', email.trim());
  return credential.user;
}

export async function signInWithGoogle(options?: { referralCode?: string }): Promise<User> {
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let credential;
  try {
    credential = await signInWithPopup(auth, provider);
  } catch (err) {
    void emitAuthSecurityTelemetry('login_failed', 'google_oauth');
    throw err;
  }

  const firebaseUser = credential.user;
  const userDocRef = doc(db, 'users', firebaseUser.uid);

  let existingSnap;
  try {
    existingSnap = await getDoc(userDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
  }

  if (existingSnap.exists()) {
    if (firebaseUser.emailVerified && existingSnap.data()?.emailVerified === false) {
      await updateDoc(userDocRef, { emailVerified: true }).catch(() => {});
    }
    void emitAuthSecurityTelemetry('login_success', firebaseUser.email || '');
    return firebaseUser;
  }

  // First-time Google user -> provision Firestore user profile + unique ADV referral code
  const rawName = (firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'AdView Member')
    .trim()
    .slice(0, 80);
  const cleanName = rawName.length >= 2 ? rawName : 'AdView Member';

  const emailLocal =
    (firebaseUser.email?.split('@')[0] || 'member')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '') || 'member';
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const cleanUsername = `${emailLocal.slice(0, 24)}_${suffix}`;

  const cleanEmail = (firebaseUser.email || '').trim().slice(0, 120);
  const cleanPhone = (firebaseUser.phoneNumber || '').trim().slice(0, 25);
  const cleanPhoto = (firebaseUser.photoURL || '').trim().slice(0, 500);

  let referrerUid = '';
  const enteredRefCode = options?.referralCode?.trim().toUpperCase() || '';
  if (enteredRefCode && /^[A-Z0-9_]{3,30}$/.test(enteredRefCode)) {
    try {
      const refSnap = await getDoc(doc(db, 'referralCodes', enteredRefCode));
      if (refSnap.exists() && refSnap.data()?.active) {
        const ownerUid = String(refSnap.data().ownerUid || '');
        if (ownerUid && ownerUid !== firebaseUser.uid) {
          referrerUid = ownerUid;
        }
      }
    } catch {
      // Non-blocking optional referral lookup for Google OAuth
    }
  }

  const ownReferralCode = await generateUniqueAdvReferralCode();
  const batch = writeBatch(db);
  const codeDocRef = doc(db, 'referralCodes', ownReferralCode);

  batch.set(userDocRef, {
    uid: firebaseUser.uid,
    fullName: cleanName,
    username: cleanUsername,
    email: cleanEmail,
    phoneNumber: cleanPhone,
    profileImage: cleanPhoto,
    referralCode: ownReferralCode,
    referredBy: referrerUid && enteredRefCode !== ownReferralCode ? referrerUid : '',
    points: 0,
    totalEarnings: 0,
    totalAdViews: 0,
    accountStatus: 'active',
    emailVerified: Boolean(firebaseUser.emailVerified),
    createdAt: serverTimestamp(),
  });

  batch.set(codeDocRef, {
    code: ownReferralCode,
    ownerUid: firebaseUser.uid,
    username: cleanUsername,
    active: true,
    createdAt: serverTimestamp(),
  });

  if (referrerUid && enteredRefCode && enteredRefCode !== ownReferralCode) {
    const referralDocRef = doc(db, 'referrals', firebaseUser.uid);
    batch.set(referralDocRef, {
      referralId: firebaseUser.uid,
      referrerUid,
      referredUid: firebaseUser.uid,
      referredName: cleanName,
      referredUsername: cleanUsername,
      referralCodeUsed: enteredRefCode,
      qualificationStatus: 'registered',
      rewardStatus: 'pending',
      rewardPoints: 0,
      bonusEarnedPoints: 0,
      newUserBonusPoints: 0,
      rejectionReason: '',
      status: 'active',
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
  }

  void emitAuthSecurityTelemetry('registration_completed', cleanEmail);
  return firebaseUser;
}

export async function sendForgotPasswordEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
  void emitAuthSecurityTelemetry('password_reset_requested', email.trim());
}

export async function resendVerificationEmail(): Promise<void> {
  if (!auth.currentUser) {
    throw new Error('No active user session found.');
  }
  await sendEmailVerification(auth.currentUser);
}

export async function refreshEmailVerification(): Promise<boolean> {
  if (!auth.currentUser) {
    return false;
  }
  await reload(auth.currentUser);
  if (auth.currentUser.emailVerified) {
    const userPath = `users/${auth.currentUser.uid}`;
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        emailVerified: true,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }
    return true;
  }
  return false;
}

export async function updateOwnProfile(
  uid: string,
  updates: { fullName: string; phoneNumber: string },
): Promise<void> {
  const cleanName = updates.fullName.trim();
  const cleanPhone = updates.phoneNumber.trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new Error('Full name must be between 2 and 80 characters.');
  }
  if (cleanPhone.length < 6 || cleanPhone.length > 25) {
    throw new Error('Phone number must be between 6 and 25 characters.');
  }

  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      fullName: cleanName,
      phoneNumber: cleanPhone,
    });
    if (auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: cleanName });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.email) {
    throw new Error('Please sign in again to change your password.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeToUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
  onError: (err: Error) => void,
): () => void {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }
      onData(toUserProfile(snapshot.data() as FirestoreUserDoc));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    },
  );
}

export function mapReferralDoc(id: string, data: Record<string, unknown>): ReferredUser {
  let joinedDate = 'Recent';
  let millis = 0;
  if (data.createdAt instanceof Timestamp) {
    millis = data.createdAt.toDate().getTime();
    joinedDate = formatDhakaDateTime(millis);
  }
  const rawQual = String(data.qualificationStatus || 'registered').toLowerCase();
  const qualificationStatus: ReferralQualificationStatus =
    rawQual === 'pending' ||
    rawQual === 'qualified' ||
    rawQual === 'rewarded' ||
    rawQual === 'rejected'
      ? rawQual
      : 'registered';

  const rawRew = String(data.rewardStatus || 'pending').toLowerCase();
  const rewardStatus: ReferralRewardStatus =
    rawRew === 'credited' || rawRew === 'rejected' ? rawRew : 'pending';

  const referredUsername = String(data.referredUsername || data.referredName || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '') || 'member';
  const rewardPoints = Number(data.rewardPoints ?? data.bonusEarnedPoints ?? 0);

  return {
    id,
    referralId: String(data.referralId || id),
    referrerUid: String(data.referrerUid || ''),
    referredUid: String(data.referredUid || id),
    name: String(data.referredName || 'Member'),
    referredUsername,
    maskedUsername: `@${maskUsername(referredUsername)}`,
    referralCodeUsed: String(data.referralCodeUsed || ''),
    joinedDate,
    createdAtMillis: millis,
    qualificationStatus,
    rewardStatus,
    rewardPoints,
    bonusEarnedPoints: Number(data.bonusEarnedPoints ?? rewardPoints),
    newUserBonusPoints: Number(data.newUserBonusPoints || 0),
    rejectionReason: String(data.rejectionReason || ''),
    tierLabel:
      qualificationStatus === 'rewarded'
        ? 'Rewarded'
        : qualificationStatus === 'qualified'
          ? 'Qualified'
          : qualificationStatus === 'rejected'
            ? 'Rejected'
            : qualificationStatus === 'pending'
              ? 'Pending Verification'
              : 'Registered',
  };
}

export function subscribeToUserReferrals(
  uid: string,
  onData: (referrals: ReferredUser[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'referrals';
  const q = query(collection(db, 'referrals'), where('referrerUid', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) =>
        mapReferralDoc(d.id, d.data() as Record<string, unknown>),
      );
      items.sort((a, b) => b.createdAtMillis - a.createdAtMillis);
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

