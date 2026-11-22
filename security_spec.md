# Security Specification — AdView Earn (Phase 4, Phase 5 & Phase 6 Withdrawal Security)

## 1. Data Invariants

1. **Active & Policy-Eligible Ads Only for Users**: Non-admin users can read `/advertisements/{adId}` ONLY when `resource.data.status == 'active'`. Creating, editing, deleting, activating, or deactivating ads is strictly restricted to `isAdmin()`.
2. **Initiation-Only Ad Sessions**: Verified active users can create `/adSessions/{sessionId}` ONLY with `userId == request.auth.uid`, `status == 'pending'`, `transactionId == ''`, `rejectionReason == ''`, `createdAt == request.time`, and referencing an existing `active` advertisement that uses verified S2S/SDK callbacks (`rewardVerificationMethod != 'none'`) and permits incentivized traffic when `adType == 'direct_link'`. Users CANNOT update or delete `adSessions`.
3. **Server-Only Wallets, Wallet Ledger & Transactions**: `/wallets/{userId}`, `/walletLedger/{entryId}`, `/withdrawalRequests/{requestId}`, `/adCompletions`, `/dailyAdLimits`, `/transactions`, and `/fraudLogs` are completely non-writable from any regular client SDK. Owners can ONLY read their own documents; `fraudLogs` and `adminLogs` are strictly Admin-only.
4. **Admin-Controlled App Settings, Payment Methods & Withdrawal Rules**: `/appSettings/{settingId}`, `/paymentMethods/{methodId}`, and `/withdrawalSettings/{settingId}` are readable by signed-in users (`settingId == 'wallet'` or `config` or `isAdmin()`), and strictly writable ONLY by `isAdmin()` with schema validation.
5. **Single-Refund Guarantee & Atomic Withdrawal Reservations**: Withdrawals reserve points (`availablePoints -> reservedPoints`) atomically on the backend (`requestWithdrawal`), and user cancellations (`cancelWithdrawalRequest`) or Admin rejections (`adminManageWithdrawal`) refund `reservedPoints -> availablePoints` at most once inside an atomic Firestore transaction checking non-terminal status.

6. **Admin-Controlled Referral Settings & Backend Qualification**: `/referralSettings/config` is readable by signed-in users and writable ONLY by `isAdmin()`. Registration creates `/referrals/{referredUid}` strictly with `qualificationStatus in ['registered', 'pending']`, `rewardStatus == 'pending'`, and `rewardPoints == 0`. Rewards (`referralRewards`, `wallets`, `walletLedger`, `transactions`) are credited exclusively server-side or by verified Admin after email verification, account status, ad qualification, and anti-abuse checks pass (never flagging shared IP alone as fraud).
7. **Privacy-Safe Referral Leaderboard**: `/referralLeaderboard/{uid}` contains strictly masked `publicUsername`, `totalQualifiedReferrals`, and `totalReferralRewards` (zero email, phone, or private PII), readable by signed-in users and writable ONLY by backend/Admin.
8. **3-Tier Role-Based Admin Authorization (Custom Claims + Server Marker)**: Administrative authorization differentiates `super_admin`, `admin`, and `support_admin` via verified Firebase Auth Custom Claims (`request.auth.token.adminRole` with `email_verified == true`) and server-managed `/admins/{uid}`. `support_admin` has read-only audit/support visibility (`users`, `withdrawalRequests`, `referrals`, `adminLogs`, `fraudLogs`, `referralLogs`, `failedTransactionLogs`, `reconciliationReports`, `systemErrors`) and cannot mutate wallet balances, payment methods, app settings, or mark payouts `paid`. Only `super_admin` can assign admin roles via `setAdminRoleClaim`.
9. **Immutable Monitoring, Failed Transactions & Reconciliation Trails**: `/failedTransactionLogs`, `/reconciliationReports`, `/adminLogs`, and `/referralLogs` are strictly append-only (`allow update, delete: if false`).

## 2. Adversarial Payloads ("Dirty Dozen+" Verification)

19. **Fake Ad Completion on Session Create**: User creates `adSessions/{id}` with `status: 'completed'` -> `PERMISSION_DENIED`.
20. **Client-Side Session Status Escalation**: User updates their `adSessions/{id}` from `pending` to `completed` -> `PERMISSION_DENIED`.
21. **Non-Verified / Unapproved Direct Link Session**: User tries to initiate `adSessions` for an inactive or `rewardVerificationMethod == 'none'` ad -> `PERMISSION_DENIED`.
22. **Fake Ad Completion Injection**: User attempts `setDoc(doc(db, 'adCompletions', 'fake'), ...)` -> `PERMISSION_DENIED`.
23. **Daily Limit Reset Tampering**: User attempts `setDoc(doc(db, 'dailyAdLimits', uid + '_2026-11-18'), { completedCount: 0 })` -> `PERMISSION_DENIED`.
24. **Fraud Log Tampering / Reading**: Non-admin user reads or deletes `/fraudLogs/{id}` -> `PERMISSION_DENIED`.
25. **Client-Side Wallet Balance Tampering**: User attempts `setDoc(doc(db, 'wallets', uid), { totalPoints: 999999, availablePoints: 999999 })` -> `PERMISSION_DENIED`.
26. **Client-Side Wallet Ledger Injection**: User attempts `setDoc(doc(db, 'walletLedger', 'fake_credit'), { entryType: 'credit', pointsDelta: 5000 })` -> `PERMISSION_DENIED`.
27. **Cross-User Wallet / Ledger Snooping**: User A attempts `getDoc(doc(db, 'wallets', userB))` or queries `walletLedger` with `where('userId', '==', userB)` -> `PERMISSION_DENIED`.
28. **Unauthorized AppSettings Modification**: Regular user attempts `updateDoc(doc(db, 'appSettings', 'wallet'), { pointsPerBdt: 1 })` -> `PERMISSION_DENIED`.
29. **Client-Side Withdrawal Status Spoofing**: User attempts `setDoc(doc(db, 'withdrawalRequests', 'wd1'), { status: 'paid' })` -> `PERMISSION_DENIED`.
30. **Client-Side Payment Method Enable/Fee Tampering**: Regular user attempts `setDoc(doc(db, 'paymentMethods', 'bkash'), { enabled: true, feePercent: 0 })` -> `PERMISSION_DENIED`.
31. **Unauthorized Withdrawal Settings Bypass**: Regular user attempts `updateDoc(doc(db, 'withdrawalSettings', 'config'), { dailyLimitBdt: 999999 })` -> `PERMISSION_DENIED`.
32. **Cross-User Withdrawal Request Snooping**: User A attempts `getDoc(doc(db, 'withdrawalRequests', userB_req))` or lists without `where('userId', '==', uid)` -> `PERMISSION_DENIED`.
33. **Client-Side Withdrawal Self-Cancel / Double-Refund Spoofing**: User attempts `updateDoc(doc(db, 'withdrawalRequests', reqId), { status: 'cancelled' })` directly in Firestore instead of verified `cancelWithdrawalRequest` Cloud Function -> `PERMISSION_DENIED`.
34. **Admin Audit Log Forgery or Deletion**: Non-admin user attempts `setDoc` / `getDoc` / `deleteDoc` on `/adminLogs/{logId}` -> `PERMISSION_DENIED`.
35. **Self-Referral Spoofing**: User registers or writes `/referrals/{uid}` with `referrerUid == request.auth.uid` -> `PERMISSION_DENIED`.
36. **Pre-Rewarded Referral Injection**: User creates `/referrals/{uid}` with `qualificationStatus: 'rewarded'` or `rewardPoints: 500` -> `PERMISSION_DENIED`.
37. **Client-Side Referral Reward Injection**: Regular user attempts `setDoc(doc(db, 'referralRewards', 'fake'), ...)` -> `PERMISSION_DENIED`.
38. **Unauthorized Referral Settings Modification**: Regular user attempts `updateDoc(doc(db, 'referralSettings', 'config'), { referrerBonusPoints: 9999 })` -> `PERMISSION_DENIED`.
39. **Cross-User Referrals Snooping**: User A queries `referrals` without `where('referrerUid', '==', userA)` or reads `referrals/{userB}` unrelated to User A -> `PERMISSION_DENIED`.
40. **Referral Security Log Tampering**: Non-admin user reads, writes, or deletes `/referralLogs/{logId}` -> `PERMISSION_DENIED`.
41. **Leaderboard Manipulation**: Regular user attempts `setDoc(doc(db, 'referralLeaderboard', uid), { totalQualifiedReferrals: 999 })` -> `PERMISSION_DENIED`.
42. **Self-Role Escalation (`/admins/{uid}`)**: User or Support Admin attempts `setDoc(doc(db, 'admins', uid), { role: 'super_admin' })` -> `PERMISSION_DENIED`.
43. **Support Admin Privilege Escalation on Settings**: `support_admin` attempts `updateDoc(doc(db, 'appSettings', 'wallet'), ...)` or `setDoc(doc(db, 'paymentMethods', 'bkash'), ...)` -> `PERMISSION_DENIED`.
44. **Support Admin Payout Finalization Bypass**: `support_admin` attempts `updateDoc(doc(db, 'withdrawalRequests', reqId), { status: 'paid' })` -> `PERMISSION_DENIED`.
45. **User Profile Shadow Role Injection**: User attempts `updateDoc(doc(db, 'users', uid), { role: 'admin', points: 999999 })` -> `PERMISSION_DENIED`.
46. **Failed Transaction Log Tampering**: User or Admin attempts `deleteDoc(doc(db, 'failedTransactionLogs', logId))` -> `PERMISSION_DENIED`.
47. **Reconciliation Report Tampering**: User attempts `setDoc` or `updateDoc` on `/reconciliationReports/{id}` -> `PERMISSION_DENIED`.
48. **Unverified Email Claim Spoofing**: Unverified token claiming `adminRole: 'admin'` attempts admin read/write -> `PERMISSION_DENIED`.


