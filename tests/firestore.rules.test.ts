/**
 * AdView Earn — Firebase Firestore Security Rules Test Suite (@firebase/rules-unit-testing)
 *
 * Run against Firebase Emulator Suite (requires Java 11+ & firebase-tools):
 *   firebase emulators:exec --only firestore "npx tsx tests/firestore.rules.test.ts"
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'gen-lang-client-0860540332';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

async function runEmulatorRulesTests(): Promise<void> {
  const rules = fs.readFileSync(RULES_PATH, 'utf8');
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  const tests: Array<{ name: string; fn: () => Promise<void> }> = [
    {
      name: '1. Unauthorized DB access denied for unauthenticated and cross-user reads',
      fn: async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore();
          await setDoc(doc(db, 'users', 'userA'), {
            uid: 'userA',
            fullName: 'User Alpha',
            username: 'useralpha',
            email: 'a@example.com',
            phoneNumber: '01711111111',
            profileImage: '',
            referralCode: 'ADV10001',
            referredBy: '',
            points: 500,
            totalEarnings: 500,
            totalAdViews: 5,
            accountStatus: 'active',
            emailVerified: true,
            createdAt: Timestamp.now(),
          });
          await setDoc(doc(db, 'wallets', 'userA'), {
            userId: 'userA',
            totalPoints: 500,
            availablePoints: 500,
            pendingPoints: 0,
            reservedPoints: 0,
            totalEarnedPoints: 500,
            totalWithdrawnPoints: 0,
            totalWithdrawnBdt: 0,
            updatedAt: Timestamp.now(),
          });
        });

        const anonDb = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(anonDb, 'users', 'userA')));
        await assertFails(getDoc(doc(anonDb, 'wallets', 'userA')));
        await assertFails(getDoc(doc(anonDb, 'adminLogs', 'log1')));
        await assertFails(getDoc(doc(anonDb, 'failedTransactionLogs', 'ftx1')));

        const userBDb = testEnv
          .authenticatedContext('userB', { email: 'b@example.com', email_verified: true })
          .firestore();
        await assertFails(getDoc(doc(userBDb, 'users', 'userA')));
        await assertFails(getDoc(doc(userBDb, 'wallets', 'userA')));
      },
    },
    {
      name: '2. Wallet balance manipulation blocked from client SDK',
      fn: async () => {
        const userADb = testEnv
          .authenticatedContext('userA', { email: 'a@example.com', email_verified: true })
          .firestore();
        await assertFails(updateDoc(doc(userADb, 'wallets', 'userA'), { availablePoints: 999999 }));
        await assertFails(updateDoc(doc(userADb, 'users', 'userA'), { points: 999999 }));
        await assertFails(updateDoc(doc(userADb, 'users', 'userA'), { totalEarnings: 999999 }));
      },
    },
    {
      name: '3. Fake transaction, ledger, adCompletion, and referralReward writes blocked',
      fn: async () => {
        const userADb = testEnv
          .authenticatedContext('userA', { email: 'a@example.com', email_verified: true })
          .firestore();
        await assertFails(
          setDoc(doc(userADb, 'transactions', 'fake_tx_1'), {
            transactionId: 'fake_tx_1',
            userId: 'userA',
            title: 'Fake Reward',
            type: 'ad_reward',
            pointsDelta: 5000,
            status: 'completed',
            createdAt: serverTimestamp(),
          }),
        );
        await assertFails(
          setDoc(doc(userADb, 'walletLedger', 'fake_led_1'), {
            entryId: 'fake_led_1',
            userId: 'userA',
            pointsDelta: 5000,
          }),
        );
        await assertFails(
          setDoc(doc(userADb, 'adCompletions', 'fake_comp_1'), {
            completionId: 'fake_comp_1',
            userId: 'userA',
            rewardPoints: 500,
          }),
        );
        await assertFails(
          setDoc(doc(userADb, 'referralRewards', 'userA'), {
            rewardId: 'userA',
            referrerUid: 'userA',
            referrerBonusPoints: 500,
          }),
        );
      },
    },
    {
      name: '4. Duplicate ad completion tampering on adSessions blocked for clients',
      fn: async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore();
          await setDoc(doc(db, 'adSessions', 'sess_1'), {
            sessionId: 'sess_1',
            userId: 'userA',
            adId: 'ad_1',
            adName: 'Monetag Video',
            adNetwork: 'Monetag',
            expectedRewardPoints: 60,
            dhakaDate: '2026-11-19',
            status: 'pending',
            transactionId: '',
            rejectionReason: '',
            createdAt: Timestamp.now(),
          });
        });

        const userADb = testEnv
          .authenticatedContext('userA', { email: 'a@example.com', email_verified: true })
          .firestore();
        await assertFails(
          updateDoc(doc(userADb, 'adSessions', 'sess_1'), {
            status: 'completed',
            transactionId: 'forged_tx',
          }),
        );
      },
    },
    {
      name: '5. Direct client withdrawal creation & status tampering blocked',
      fn: async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore();
          await setDoc(doc(db, 'withdrawalRequests', 'wd_1'), {
            requestId: 'wd_1',
            transactionId: 'tx_wd_1',
            userId: 'userA',
            methodId: 'bkash',
            accountNumber: '01711111111',
            maskedAccountNumber: '017****1111',
            accountType: 'personal',
            pointsReserved: 1000,
            grossBdt: 10,
            feeBdt: 0.2,
            netBdt: 9.8,
            conversionRateUsed: 100,
            status: 'pending',
            createdAt: Timestamp.now(),
          });
        });

        const userADb = testEnv
          .authenticatedContext('userA', { email: 'a@example.com', email_verified: true })
          .firestore();
        await assertFails(
          setDoc(doc(userADb, 'withdrawalRequests', 'wd_forged'), {
            requestId: 'wd_forged',
            userId: 'userA',
            status: 'paid',
          }),
        );
        await assertFails(updateDoc(doc(userADb, 'withdrawalRequests', 'wd_1'), { status: 'paid' }));
      },
    },
    {
      name: '6. Invalid Admin access & 3-Tier Role Escalation strictly blocked',
      fn: async () => {
        const userADb = testEnv
          .authenticatedContext('userA', { email: 'a@example.com', email_verified: true })
          .firestore();
        await assertFails(setDoc(doc(userADb, 'admins', 'userA'), { uid: 'userA', role: 'super_admin' }));
        await assertFails(
          setDoc(doc(userADb, 'appSettings', 'wallet'), {
            pointsPerBdt: 1,
            walletEnabled: true,
            earningEnabled: true,
            dailyAdLimit: 999,
            updatedAt: serverTimestamp(),
          }),
        );

        // Support Admin: read-only monitoring allowed, financial/admin mutations blocked
        const supportDb = testEnv
          .authenticatedContext('support1', {
            email: 'support@adviewearn.com',
            email_verified: true,
            adminRole: 'support_admin',
          })
          .firestore();
        await assertSucceeds(getDoc(doc(supportDb, 'users', 'userA')));
        await assertSucceeds(getDoc(doc(supportDb, 'wallets', 'userA')));
        await assertFails(updateDoc(doc(supportDb, 'wallets', 'userA'), { availablePoints: 999 }));
        await assertFails(deleteDoc(doc(supportDb, 'users', 'userA')));

        // Standard Admin: can update wallets/settings, cannot write admins/{uid} or delete user
        const adminDb = testEnv
          .authenticatedContext('admin1', {
            email: 'admin@adviewearn.com',
            email_verified: true,
            adminRole: 'admin',
          })
          .firestore();
        await assertFails(setDoc(doc(adminDb, 'admins', 'admin1'), { uid: 'admin1', role: 'super_admin' }));
        await assertFails(deleteDoc(doc(adminDb, 'users', 'userA')));

        // Super Admin: can delete user, still cannot tamper admins from client SDK
        const superAdminDb = testEnv
          .authenticatedContext('super1', {
            email: 'super@adviewearn.com',
            email_verified: true,
            adminRole: 'super_admin',
          })
          .firestore();
        await assertFails(setDoc(doc(superAdminDb, 'admins', 'hacker'), { uid: 'hacker', role: 'super_admin' }));
        await assertSucceeds(deleteDoc(doc(superAdminDb, 'users', 'userA')));
      },
    },
    {
      name: '7. Referral self-referral and pre-credited reward forgery blocked',
      fn: async () => {
        const userBDb = testEnv
          .authenticatedContext('userB', { email: 'b@example.com', email_verified: true })
          .firestore();
        await assertFails(
          setDoc(doc(userBDb, 'referrals', 'userB'), {
            referralId: 'userB',
            referrerUid: 'userB',
            referredUid: 'userB',
            referredName: 'Self Referrer',
            referredUsername: 'selfref',
            referralCodeUsed: 'ADV10001',
            qualificationStatus: 'rewarded',
            rewardStatus: 'credited',
            rewardPoints: 500,
            bonusEarnedPoints: 500,
            newUserBonusPoints: 500,
            rejectionReason: '',
            status: 'active',
            createdAt: serverTimestamp(),
          }),
        );
      },
    },
    {
      name: '8. Default deny catch-all blocks undefined collections',
      fn: async () => {
        const superAdminDb = testEnv
          .authenticatedContext('super1', {
            email: 'super@adviewearn.com',
            email_verified: true,
            adminRole: 'super_admin',
          })
          .firestore();
        await assertFails(setDoc(doc(superAdminDb, 'unknownPrivateCollection', 'x1'), { test: true }));
        await assertFails(getDoc(doc(superAdminDb, 'unknownPrivateCollection', 'x1')));
      },
    },
    {
      name: '9. Immutable audit & monitoring logs reject updates and deletes even by Admin',
      fn: async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore();
          await setDoc(doc(db, 'adminLogs', 'adm_1'), {
            logId: 'adm_1',
            adminUid: 'admin1',
            adminEmail: 'admin@adviewearn.com',
            action: 'test_action',
            targetId: 'userA',
            details: 'Audit test',
            createdAt: Timestamp.now(),
          });
        });

        const superAdminDb = testEnv
          .authenticatedContext('super1', {
            email: 'super@adviewearn.com',
            email_verified: true,
            adminRole: 'super_admin',
          })
          .firestore();
        await assertFails(updateDoc(doc(superAdminDb, 'adminLogs', 'adm_1'), { details: 'tampered' }));
        await assertFails(deleteDoc(doc(superAdminDb, 'adminLogs', 'adm_1')));
      },
    },
    {
      name: '10. Active verified user can update safe profile fields only',
      fn: async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore();
          await setDoc(doc(db, 'users', 'userC'), {
            uid: 'userC',
            fullName: 'User Charlie',
            username: 'usercharlie',
            email: 'c@example.com',
            phoneNumber: '01733333333',
            profileImage: '',
            referralCode: 'ADV30001',
            referredBy: '',
            points: 0,
            totalEarnings: 0,
            totalAdViews: 0,
            accountStatus: 'active',
            emailVerified: true,
            createdAt: Timestamp.now(),
          });
        });

        const userCDb = testEnv
          .authenticatedContext('userC', { email: 'c@example.com', email_verified: true })
          .firestore();
        await assertSucceeds(
          updateDoc(doc(userCDb, 'users', 'userC'), {
            fullName: 'Charlie Updated',
            phoneNumber: '01844444444',
          }),
        );
        await assertFails(updateDoc(doc(userCDb, 'users', 'userC'), { accountStatus: 'banned' }));
      },
    },
    {
      name: '11. Only Super Admin can update SiteSettings branding with valid hex colors',
      fn: async () => {
        const adminDb = testEnv
          .authenticatedContext('admin1', {
            email: 'admin@adviewearn.com',
            email_verified: true,
            adminRole: 'admin',
          })
          .firestore();
        await assertFails(
          setDoc(doc(adminDb, 'appSettings', 'site'), {
            websiteName: 'Hijacked',
            maintenanceMode: false,
            registrationEnabled: true,
            updatedAt: serverTimestamp(),
          }),
        );

        const superAdminDb = testEnv
          .authenticatedContext('super1', {
            email: 'super@adviewearn.com',
            email_verified: true,
            adminRole: 'super_admin',
          })
          .firestore();
        await assertSucceeds(
          setDoc(doc(superAdminDb, 'appSettings', 'site'), {
            websiteName: 'AdView Pro',
            websiteTitle: 'AdView Pro — Rewards',
            primaryColor: '#7C3AED',
            secondaryColor: '#2563EB',
            maintenanceMode: false,
            registrationEnabled: true,
            updatedAt: serverTimestamp(),
          }),
        );
        await assertFails(
          setDoc(doc(superAdminDb, 'appSettings', 'site'), {
            websiteName: 'AdView Pro',
            primaryColor: 'not-a-color',
            maintenanceMode: false,
            registrationEnabled: true,
            updatedAt: serverTimestamp(),
          }),
        );
      },
    },
  ];

  let passed = 0;
  for (const t of tests) {
    await testEnv.clearFirestore();
    await t.fn();
    passed += 1;
    console.log(`PASS: ${t.name}`);
  }

  await testEnv.cleanup();
  assert.equal(passed, tests.length);
  console.log(`\nAll ${passed}/${tests.length} Firestore Emulator Security Tests passed.`);
}

runEmulatorRulesTests().catch((err) => {
  console.error('Firestore Emulator Rules Test failed:', err);
  process.exitCode = 1;
});
