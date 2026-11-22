import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  activeFirebaseConfig as firebaseConfig,
  auth,
  db,
  getAppCheckTokenHeader,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  FraudReportCategory,
  FraudReportRecord,
  FraudReviewStatus,
  FraudRiskLevel,
  SecurityAuditCategory,
  SecurityAuditLogRecord,
} from '../types';
import { formatDhakaDateTime } from './appService';

function formatTs(ts: unknown): { label: string; millis: number } {
  if (ts instanceof Timestamp) {
    const ms = ts.toDate().getTime();
    return { millis: ms, label: formatDhakaDateTime(ms) };
  }
  return { millis: 0, label: 'Recent' };
}

function mapCategory(raw: unknown): FraudReportCategory {
  const v = String(raw || '').toLowerCase();
  if (
    v === 'multi_account' ||
    v === 'ad_reward' ||
    v === 'referral' ||
    v === 'withdrawal' ||
    v === 'auth_security'
  ) {
    return v;
  }
  return 'auth_security';
}

function mapRiskLevel(raw: unknown, score: number): FraudRiskLevel {
  const v = String(raw || '').toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low';
}

function mapReviewStatus(raw: unknown): FraudReviewStatus {
  const v = String(raw || '').toLowerCase();
  if (
    v === 'pending_review' ||
    v === 'reviewed' ||
    v === 'verification_requested' ||
    v === 'restricted' ||
    v === 'suspended' ||
    v === 'restored'
  ) {
    return v;
  }
  return 'pending_review';
}

function mapAuditCategory(raw: unknown): SecurityAuditCategory {
  const v = String(raw || '').toLowerCase();
  if (
    v === 'auth' ||
    v === 'wallet' ||
    v === 'ad_reward' ||
    v === 'withdrawal' ||
    v === 'referral' ||
    v === 'admin' ||
    v === 'account_restriction' ||
    v === 'security'
  ) {
    return v;
  }
  return 'security';
}

export function subscribeToFraudReports(
  onData: (reports: FraudReportRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'fraudReports';
  return onSnapshot(
    collection(db, 'fraudReports'),
    (snap) => {
      const items: FraudReportRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const created = formatTs(data.createdAt);
        const updated = formatTs(data.updatedAt);
        const riskScore = Math.max(0, Math.min(100, Number(data.riskScore || 0)));
        return {
          id: d.id,
          reportId: String(data.reportId || d.id),
          category: mapCategory(data.category),
          riskLevel: mapRiskLevel(data.riskLevel, riskScore),
          riskScore,
          reviewStatus: mapReviewStatus(data.reviewStatus),
          userId: String(data.userId || ''),
          userEmail: String(data.userEmail || ''),
          userName: String(data.userName || ''),
          title: String(data.title || 'Suspicious Activity Alert'),
          details: String(data.details || ''),
          signals: Array.isArray(data.signals) ? data.signals.map((s) => String(s)) : [],
          relatedTxId: String(data.relatedTxId || ''),
          actionTaken: String(data.actionTaken || ''),
          reviewedBy: String(data.reviewedBy || ''),
          reviewedEmail: String(data.reviewedEmail || ''),
          resolutionNote: String(data.resolutionNote || ''),
          falsePositiveProtected: Boolean(data.falsePositiveProtected ?? true),
          createdAtLabel: created.label,
          createdAtMillis: created.millis,
          updatedAtLabel: updated.label,
          updatedAtMillis: updated.millis,
        };
      });
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

export function subscribeToSecurityAuditLogs(
  onData: (logs: SecurityAuditLogRecord[]) => void,
  onError: (err: Error) => void,
): () => void {
  const path = 'securityAuditLogs';
  return onSnapshot(
    collection(db, 'securityAuditLogs'),
    (snap) => {
      const items: SecurityAuditLogRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const { label, millis } = formatTs(data.createdAt);
        const sevRaw = String(data.severity || 'info').toLowerCase();
        const severity: SecurityAuditLogRecord['severity'] =
          sevRaw === 'critical' ||
          sevRaw === 'high' ||
          sevRaw === 'medium' ||
          sevRaw === 'low'
            ? sevRaw
            : 'info';
        return {
          id: d.id,
          logId: String(data.logId || d.id),
          userId: String(data.userId || ''),
          eventType: String(data.eventType || 'security_event'),
          category: mapAuditCategory(data.category),
          severity,
          transactionId: String(data.transactionId || ''),
          riskScore:
            typeof data.riskScore === 'number' ? Math.round(data.riskScore) : null,
          details: String(data.details || ''),
          metadata: String(data.metadata || ''),
          createdAtLabel: label,
          createdAtMillis: millis,
        };
      });
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

export type FraudReviewActionType =
  | 'mark_reviewed'
  | 'request_verification'
  | 'temporarily_restrict'
  | 'suspend'
  | 'restore';

export async function executeFraudReviewAction(params: {
  reportId: string;
  action: FraudReviewActionType;
  resolutionNote?: string;
  adminUser: { uid: string; email: string };
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Admin authentication required.');
  }

  const { reportId, action, resolutionNote = '', adminUser } = params;

  try {
    const [idToken, appCheckHeaders] = await Promise.all([
      currentUser.getIdToken(),
      getAppCheckTokenHeader(),
    ]);
    const endpoint = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/reviewFraudReport`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...appCheckHeaders,
      },
      body: JSON.stringify({
        reportId,
        action,
        resolutionNote: resolutionNote.trim(),
      }),
    });
    if (response.ok) return;
    if (response.status >= 400 && response.status < 500 && response.status !== 404) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Fraud review action rejected.');
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !err.message.includes('Failed to fetch') &&
      !err.message.includes('NetworkError') &&
      !err.message.includes('Load failed')
    ) {
      throw err;
    }
  }

  // Admin-authorized Firestore transaction fallback (enforced by isAdmin() in firestore.rules)
  const reportRef = doc(db, 'fraudReports', reportId);
  const secLogId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const secLogRef = doc(db, 'securityAuditLogs', secLogId);
  const admLogId = `adm_${Date.now()}_fr_${reportId.slice(0, 20)}`;
  const admLogRef = doc(db, 'adminLogs', admLogId);

  try {
    await runTransaction(db, async (txn) => {
      const reportSnap = await txn.get(reportRef);
      if (!reportSnap.exists()) {
        throw new Error('Fraud report not found.');
      }
      const report = reportSnap.data();
      const targetUid = String(report.userId || '');
      const userRef = targetUid ? doc(db, 'users', targetUid) : null;
      const userSnap = userRef ? await txn.get(userRef) : null;

      let nextReviewStatus: FraudReviewStatus = 'reviewed';
      let nextAccountStatus: 'active' | 'restricted' | 'suspended' | null = null;
      let actionLabel = 'Marked as Reviewed';
      let notifTitle = '';
      let notifMessage = '';

      if (action === 'request_verification') {
        nextReviewStatus = 'verification_requested';
        actionLabel = 'Verification Requested';
        notifTitle = 'Account Security Verification Notice';
        notifMessage =
          resolutionNote.trim() ||
          'Our security team flagged unusual activity for verification. Please contact Support from your Profile.';
      } else if (action === 'temporarily_restrict') {
        nextReviewStatus = 'restricted';
        nextAccountStatus = 'restricted';
        actionLabel = 'Temporarily Restricted';
        notifTitle = 'Account Temporarily Restricted';
        notifMessage =
          resolutionNote.trim() ||
          'Your account has been placed under temporary security review. Contact Support to restore access.';
      } else if (action === 'suspend') {
        nextReviewStatus = 'suspended';
        nextAccountStatus = 'suspended';
        actionLabel = 'Account Suspended';
      } else if (action === 'restore') {
        nextReviewStatus = 'restored';
        nextAccountStatus = 'active';
        actionLabel = 'Account Restored';
        notifTitle = 'Account Access Restored';
        notifMessage =
          resolutionNote.trim() ||
          'Security review completed. Your account has been restored to active status.';
      }

      txn.update(reportRef, {
        reviewStatus: nextReviewStatus,
        actionTaken: actionLabel,
        reviewedBy: adminUser.uid,
        reviewedEmail: adminUser.email || 'admin@adviewearn.com',
        resolutionNote: resolutionNote.trim().slice(0, 400),
        updatedAt: serverTimestamp(),
      });

      if (userRef && userSnap && userSnap.exists() && nextAccountStatus) {
        txn.update(userRef, { accountStatus: nextAccountStatus });
      }

      if (targetUid && notifTitle) {
        const notifRef = doc(db, 'notifications', `notif_fr_${Date.now()}`);
        txn.set(notifRef, {
          userId: targetUid,
          title: notifTitle,
          message: notifMessage.slice(0, 300),
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      txn.set(secLogRef, {
        logId: secLogId,
        userId: targetUid || adminUser.uid,
        eventType: `fraud_${action}`,
        category: nextAccountStatus ? 'account_restriction' : 'security',
        severity:
          action === 'suspend' || action === 'temporarily_restrict' ? 'high' : 'info',
        riskScore: Number(report.riskScore || 0),
        details: `Admin ${adminUser.email} executed ${actionLabel} on ${reportId}. ${resolutionNote.trim()}`.slice(0, 500),
        createdAt: serverTimestamp(),
      });

      txn.set(admLogRef, {
        logId: admLogId,
        adminUid: adminUser.uid,
        adminEmail: adminUser.email || 'admin@adviewearn.com',
        action: `fraud_report_${action}`,
        targetId: reportId,
        previousValue: String(report.reviewStatus || 'pending_review'),
        newValue: nextReviewStatus,
        details: `${actionLabel} on ${reportId} (user=${targetUid || 'n/a'}). ${resolutionNote.trim()}`.slice(0, 500),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `fraudReports/${reportId}`);
  }
}
