"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAtomicWalletCredit = executeAtomicWalletCredit;
exports.executeAtomicWalletDebit = executeAtomicWalletDebit;
exports.computeLedgerReconciliation = computeLedgerReconciliation;
const helpers_1 = require("./helpers");
/**
 * Atomically credits points to `wallets/{userId}` + `users/{userId}` with strict
 * idempotency (`transactions/{txId}` + `walletLedger/{ledgerId}`), preventing duplicate rewards.
 */
async function executeAtomicWalletCredit(txn, input) {
    const cleanPoints = Math.floor(Number(input.points || 0));
    if (!Number.isFinite(cleanPoints) || cleanPoints <= 0) {
        throw new Error('INVALID_CREDIT_AMOUNT');
    }
    const txId = (0, helpers_1.sanitizeId)(input.transactionId || `tx_${input.idempotencyKey}`);
    const ledgerId = (0, helpers_1.sanitizeId)(`led_${input.idempotencyKey}`);
    const userRef = helpers_1.db.collection('users').doc(input.userId);
    const walletRef = helpers_1.db.collection('wallets').doc(input.userId);
    const txRef = helpers_1.db.collection('transactions').doc(txId);
    const ledgerRef = helpers_1.db.collection('walletLedger').doc(ledgerId);
    const [userSnap, walletSnap, txSnap, ledgerSnap, settings] = await Promise.all([
        txn.get(userRef),
        txn.get(walletRef),
        txn.get(txRef),
        txn.get(ledgerRef),
        (0, helpers_1.readActiveAppSettings)(txn),
    ]);
    if (txSnap.exists || ledgerSnap.exists) {
        throw new Error('DUPLICATE_WALLET_TRANSACTION');
    }
    if (!userSnap.exists) {
        throw new Error('USER_NOT_FOUND');
    }
    const userData = userSnap.data();
    const w = walletSnap.exists ? walletSnap.data() : {};
    const prevTotalPoints = Number(w.totalPoints ?? userData.points ?? 0);
    const prevReserved = Number(w.reservedPoints ?? 0);
    const prevAvailable = Number(w.availablePoints ?? Math.max(0, prevTotalPoints - prevReserved));
    const prevPending = Number(w.pendingPoints ?? 0);
    const prevTotalEarned = Number(w.totalEarnedPoints ?? userData.totalEarnings ?? 0);
    const prevWithdrawnPts = Number(w.totalWithdrawnPoints ?? 0);
    const prevWithdrawnBdt = Number(w.totalWithdrawnBdt ?? 0);
    const newTotalPoints = prevTotalPoints + cleanPoints;
    const newAvailablePoints = prevAvailable + cleanPoints;
    const shouldIncEarned = input.incrementTotalEarned !== false;
    const newTotalEarned = shouldIncEarned ? prevTotalEarned + cleanPoints : prevTotalEarned;
    const bdtSnapshot = (0, helpers_1.calcBdtSnapshot)(cleanPoints, settings.pointsPerBdt);
    const rateUsed = settings.pointsPerBdt ?? 0;
    const nowServer = helpers_1.FieldValue.serverTimestamp();
    txn.set(txRef, {
        transactionId: txId,
        userId: input.userId,
        title: input.title.slice(0, 100),
        subtitle: input.description.slice(0, 160),
        description: input.description.slice(0, 300),
        type: input.transactionType,
        direction: 'credit',
        pointsDelta: cleanPoints,
        points: cleanPoints,
        bdtAmount: settings.pointsPerBdt ? bdtSnapshot : null,
        conversionRateUsed: settings.pointsPerBdt ?? null,
        status: 'completed',
        createdAt: nowServer,
    });
    txn.set(ledgerRef, {
        entryId: ledgerId,
        transactionId: txId,
        userId: input.userId,
        entryType: 'credit',
        transactionType: input.transactionType,
        pointsDelta: cleanPoints,
        bdtAmount: bdtSnapshot,
        conversionRateUsed: rateUsed,
        previousPoints: prevTotalPoints,
        newPoints: newTotalPoints,
        previousReservedPoints: prevReserved,
        newReservedPoints: prevReserved,
        status: 'completed',
        description: input.description.slice(0, 300),
        createdAt: nowServer,
    });
    txn.set(walletRef, {
        userId: input.userId,
        totalPoints: newTotalPoints,
        availablePoints: newAvailablePoints,
        pendingPoints: prevPending,
        reservedPoints: prevReserved,
        totalEarnedPoints: newTotalEarned,
        totalWithdrawnPoints: prevWithdrawnPts,
        totalWithdrawnBdt: prevWithdrawnBdt,
        updatedAt: nowServer,
    });
    txn.update(userRef, {
        points: newAvailablePoints,
        totalEarnings: newTotalEarned,
    });
    return {
        txId,
        ledgerId,
        previousPoints: prevTotalPoints,
        newPoints: newTotalPoints,
        availablePoints: newAvailablePoints,
        bdtSnapshot,
        conversionRateUsed: settings.pointsPerBdt,
    };
}
/**
 * Atomically debits available points from `wallets/{userId}` + `users/{userId}`,
 * strictly forbidding negative balances and preventing duplicate debits.
 */
async function executeAtomicWalletDebit(txn, input) {
    const cleanPoints = Math.floor(Number(input.points || 0));
    if (!Number.isFinite(cleanPoints) || cleanPoints <= 0) {
        throw new Error('INVALID_DEBIT_AMOUNT');
    }
    const txId = (0, helpers_1.sanitizeId)(input.transactionId || `tx_${input.idempotencyKey}`);
    const ledgerId = (0, helpers_1.sanitizeId)(`led_${input.idempotencyKey}`);
    const userRef = helpers_1.db.collection('users').doc(input.userId);
    const walletRef = helpers_1.db.collection('wallets').doc(input.userId);
    const txRef = helpers_1.db.collection('transactions').doc(txId);
    const ledgerRef = helpers_1.db.collection('walletLedger').doc(ledgerId);
    const [userSnap, walletSnap, txSnap, ledgerSnap, settings] = await Promise.all([
        txn.get(userRef),
        txn.get(walletRef),
        txn.get(txRef),
        txn.get(ledgerRef),
        (0, helpers_1.readActiveAppSettings)(txn),
    ]);
    if (txSnap.exists || ledgerSnap.exists) {
        throw new Error('DUPLICATE_WALLET_TRANSACTION');
    }
    if (!userSnap.exists) {
        throw new Error('USER_NOT_FOUND');
    }
    const userData = userSnap.data();
    const w = walletSnap.exists ? walletSnap.data() : {};
    const prevTotalPoints = Number(w.totalPoints ?? userData.points ?? 0);
    const prevReserved = Number(w.reservedPoints ?? 0);
    const prevAvailable = Number(w.availablePoints ?? Math.max(0, prevTotalPoints - prevReserved));
    const prevPending = Number(w.pendingPoints ?? 0);
    const prevTotalEarned = Number(w.totalEarnedPoints ?? userData.totalEarnings ?? 0);
    const prevWithdrawnPts = Number(w.totalWithdrawnPoints ?? 0);
    const prevWithdrawnBdt = Number(w.totalWithdrawnBdt ?? 0);
    if (prevAvailable < cleanPoints || prevTotalPoints < cleanPoints) {
        throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
    }
    const newTotalPoints = prevTotalPoints - cleanPoints;
    const newAvailablePoints = prevAvailable - cleanPoints;
    const bdtSnapshot = (0, helpers_1.calcBdtSnapshot)(cleanPoints, settings.pointsPerBdt);
    const rateUsed = settings.pointsPerBdt ?? 0;
    const nowServer = helpers_1.FieldValue.serverTimestamp();
    txn.set(txRef, {
        transactionId: txId,
        userId: input.userId,
        title: input.title.slice(0, 100),
        subtitle: input.description.slice(0, 160),
        description: input.description.slice(0, 300),
        type: input.transactionType,
        direction: 'debit',
        pointsDelta: -cleanPoints,
        points: cleanPoints,
        bdtAmount: settings.pointsPerBdt ? bdtSnapshot : null,
        conversionRateUsed: settings.pointsPerBdt ?? null,
        status: 'completed',
        createdAt: nowServer,
    });
    txn.set(ledgerRef, {
        entryId: ledgerId,
        transactionId: txId,
        userId: input.userId,
        entryType: 'debit',
        transactionType: input.transactionType,
        pointsDelta: -cleanPoints,
        bdtAmount: bdtSnapshot,
        conversionRateUsed: rateUsed,
        previousPoints: prevTotalPoints,
        newPoints: newTotalPoints,
        previousReservedPoints: prevReserved,
        newReservedPoints: prevReserved,
        status: 'completed',
        description: input.description.slice(0, 300),
        createdAt: nowServer,
    });
    txn.set(walletRef, {
        userId: input.userId,
        totalPoints: newTotalPoints,
        availablePoints: newAvailablePoints,
        pendingPoints: prevPending,
        reservedPoints: prevReserved,
        totalEarnedPoints: prevTotalEarned,
        totalWithdrawnPoints: prevWithdrawnPts,
        totalWithdrawnBdt: prevWithdrawnBdt,
        updatedAt: nowServer,
    });
    txn.update(userRef, {
        points: newAvailablePoints,
    });
    return {
        txId,
        ledgerId,
        previousPoints: prevTotalPoints,
        newPoints: newTotalPoints,
        availablePoints: newAvailablePoints,
        bdtSnapshot,
        conversionRateUsed: settings.pointsPerBdt,
    };
}
/**
 * Reconciles `wallets/{userId}` against the full immutable `walletLedger` stream
 * and records discrepancies into `reconciliationReports` when requested.
 */
async function computeLedgerReconciliation(userId, persistReport = false) {
    const [walletSnap, ledgerSnap] = await Promise.all([
        helpers_1.db.collection('wallets').doc(userId).get(),
        helpers_1.db.collection('walletLedger').where('userId', '==', userId).get(),
    ]);
    const w = walletSnap.exists ? walletSnap.data() : {};
    const walletTotalPoints = Number(w.totalPoints ?? 0);
    const walletReservedPoints = Number(w.reservedPoints ?? 0);
    const walletAvailablePoints = Number(w.availablePoints ?? Math.max(0, walletTotalPoints - walletReservedPoints));
    let ledgerNetPoints = 0;
    let ledgerReservedPoints = 0;
    ledgerSnap.forEach((docSnap) => {
        const d = docSnap.data();
        const entryType = String(d.entryType || '');
        const delta = Number(d.pointsDelta || 0);
        if (entryType === 'credit' || entryType === 'debit') {
            ledgerNetPoints += delta;
        }
        else if (entryType === 'reserve') {
            ledgerReservedPoints += Math.abs(delta);
        }
        else if (entryType === 'release') {
            ledgerReservedPoints -= Math.abs(delta);
        }
    });
    ledgerReservedPoints = Math.max(0, ledgerReservedPoints);
    const totalDiff = Math.abs(walletTotalPoints - ledgerNetPoints);
    const reservedDiff = Math.abs(walletReservedPoints - ledgerReservedPoints);
    const availableCheckDiff = Math.abs(walletTotalPoints - walletReservedPoints - walletAvailablePoints);
    const discrepancyPoints = totalDiff + reservedDiff + availableCheckDiff;
    const status = discrepancyPoints === 0 ? 'matched' : 'mismatch_detected';
    const reportId = (0, helpers_1.sanitizeId)(`rec_${userId}_${Date.now()}`);
    if (persistReport) {
        await helpers_1.db
            .collection('reconciliationReports')
            .doc(reportId)
            .set({
            reportId,
            userId,
            walletTotalPoints,
            walletReservedPoints,
            ledgerNetPoints,
            ledgerReservedPoints,
            discrepancyPoints,
            status,
            details: status === 'matched'
                ? `Verified ${ledgerSnap.size} ledger entries; balances match exactly.`
                : `Discrepancy detected across ${ledgerSnap.size} ledger entries: walletTotal=${walletTotalPoints}, ledgerNet=${ledgerNetPoints}, walletReserved=${walletReservedPoints}, ledgerReserved=${ledgerReservedPoints}`,
            createdAt: helpers_1.FieldValue.serverTimestamp(),
        });
    }
    return {
        reportId,
        userId,
        walletTotalPoints,
        walletAvailablePoints,
        walletReservedPoints,
        ledgerNetPoints,
        ledgerReservedPoints,
        discrepancyPoints,
        status,
        entriesCount: ledgerSnap.size,
    };
}
//# sourceMappingURL=walletCore.js.map