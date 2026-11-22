import {
  AdminRole,
  DailyAdLimitRecord,
  DailyBonusState,
  EconomyConfig,
  MfsAccountType,
  NotificationItem,
  PaymentMethodConfig,
  PaymentMethodId,
  ReferralSettingsConfig,
  ReferredUser,
  TransactionRecord,
  UserProfile,
  WalletDocRecord,
  WalletMetrics,
  WithdrawalRequestRecord,
  WithdrawalSettingsConfig,
  WithdrawValidationResult,
} from '../types';

export const DEFAULT_DAILY_AD_LIMIT = 20;

export function getDhakaDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function getDhakaMonthKey(date: Date = new Date()): string {
  return getDhakaDateKey(date).slice(0, 7);
}

export function maskAccountNumber(accountNumber: string, methodId: PaymentMethodId): string {
  const clean = accountNumber.trim();
  if (!clean) return '****';
  if (methodId !== 'bank' && clean.length >= 11) {
    return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
  }
  if (clean.length <= 6) {
    return `${clean.slice(0, 2)}****`;
  }
  return `${clean.slice(0, 2)}****${clean.slice(-4)}`;
}

export function maskUsername(username: string): string {
  const clean = username.trim().replace(/^@+/, '');
  if (!clean) return 'mem***';
  if (clean.length <= 3) {
    return `${clean.slice(0, 1)}***`;
  }
  if (clean.length <= 5) {
    return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
  }
  return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

export function getDefaultReferralSettings(): ReferralSettingsConfig {
  return {
    referralEnabled: true,
    referrerBonusPoints: null,
    newUserBonusPoints: null,
    minimumQualificationAds: 1,
    requireEmailVerified: true,
    requireActiveAccount: true,
    maxReferralsPerUser: null,
    dailyReferralCap: 25,
    referralRulesText:
      'Invited friends must verify their email, maintain an active account, and complete the minimum required ad views before referral rewards are unlocked.',
  };
}

export function validateMethodAccountNumber(
  methodId: PaymentMethodId,
  accountNumber: string,
): { valid: boolean; error?: string; normalized: string } {
  const trimmed = accountNumber.trim();
  if (methodId === 'bkash' || methodId === 'nagad' || methodId === 'rocket') {
    const digits = trimmed.replace(/[\s-]/g, '');
    if (!/^01[3-9]\d{8}$/.test(digits)) {
      const label =
        methodId === 'bkash' ? 'bKash' : methodId === 'nagad' ? 'Nagad' : 'Rocket';
      return {
        valid: false,
        error: `Please enter a valid 11-digit Bangladeshi ${label} number (e.g. 017XXXXXXXX).`,
        normalized: digits,
      };
    }
    return { valid: true, normalized: digits };
  }

  if (trimmed.length < 8 || trimmed.length > 80) {
    return {
      valid: false,
      error: 'Please enter a valid bank account number and branch details (min 8 characters).',
      normalized: trimmed,
    };
  }
  return { valid: true, normalized: trimmed };
}

export function getDefaultWithdrawalSettings(economy: EconomyConfig): WithdrawalSettingsConfig {
  return {
    withdrawalEnabled: economy.walletEnabled,
    minimumWithdrawPoints: economy.minimumWithdrawPoints,
    maximumWithdrawBdt: economy.maximumWithdrawAmountBdt,
    defaultFeePercent: 2,
    dailyLimitBdt: null,
    dailyLimitCount: 3,
    monthlyLimitBdt: null,
    processingTimeLabel: 'Within 24 hours (Verification)',
    allowedMethods: ['bkash', 'nagad', 'rocket', 'bank'],
  };
}

export function formatDhakaDateTime(millis: number): string {
  if (!millis) return 'Recent';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
}

export function pointsToBdt(points: number, pointsPerBdt: number | null): number | null {
  if (!pointsPerBdt || pointsPerBdt <= 0) return null;
  return Number((points / pointsPerBdt).toFixed(2));
}

export function formatBdt(amount: number | null): string {
  if (amount === null || Number.isNaN(amount)) {
    return 'Rate Pending';
  }
  return `৳ ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPoints(points: number): string {
  return points.toLocaleString('en-US');
}

export function isAdminUser(
  _user: Pick<UserProfile, 'email' | 'verified'>,
  hasAdminMarker = false,
  adminRole: AdminRole | null = null,
): boolean {
  if (adminRole === 'super_admin' || adminRole === 'admin') return true;
  if (hasAdminMarker && adminRole !== 'support_admin') return true;
  return false;
}

export function isSupportOrHigherRole(
  user: Pick<UserProfile, 'email' | 'verified'>,
  hasAdminMarker = false,
  adminRole: AdminRole | null = null,
): boolean {
  if (adminRole === 'super_admin' || adminRole === 'admin' || adminRole === 'support_admin') {
    return true;
  }
  return isAdminUser(user, hasAdminMarker, adminRole);
}

export function computeDashboardMetrics(
  user: UserProfile,
  transactions: TransactionRecord[],
  referrals: ReferredUser[],
  economy: EconomyConfig,
  dailyAdLimit?: DailyAdLimitRecord | null,
  walletDoc?: WalletDocRecord | null,
): WalletMetrics {
  const todayDhaka = getDhakaDateKey();

  let todayTxViews = 0;
  let todayTxEarningsPoints = 0;
  let adViewsEarnedPoints = 0;
  let referralBonusPoints = 0;
  let dailyBonusEarnedPoints = 0;
  let pendingCreditsPoints = 0;
  let pendingWithdrawalPoints = 0;
  let withdrawnPointsFromTx = 0;
  let withdrawnBdtFromTx = 0;

  for (const tx of transactions) {
    if (tx.status === 'pending') {
      if (tx.direction === 'credit' && tx.pointsDelta > 0) {
        pendingCreditsPoints += tx.pointsDelta;
      } else if (tx.type === 'withdrawal') {
        pendingWithdrawalPoints += Math.abs(tx.pointsDelta);
      }
      continue;
    }

    if (tx.status !== 'completed') continue;

    if (tx.type === 'ad_reward' && tx.pointsDelta > 0) {
      adViewsEarnedPoints += tx.pointsDelta;
    } else if (tx.type === 'referral_bonus' && tx.pointsDelta > 0) {
      referralBonusPoints += tx.pointsDelta;
    } else if (tx.type === 'daily_bonus' && tx.pointsDelta > 0) {
      dailyBonusEarnedPoints += tx.pointsDelta;
    } else if (tx.type === 'withdrawal') {
      withdrawnPointsFromTx += Math.abs(tx.pointsDelta);
      if (tx.bdtAmount !== null) {
        withdrawnBdtFromTx += Math.abs(tx.bdtAmount);
      }
    }

    if (tx.createdAtMillis > 0 && getDhakaDateKey(new Date(tx.createdAtMillis)) === todayDhaka) {
      if (tx.type === 'ad_reward') {
        todayTxViews += 1;
      }
      if (tx.pointsDelta > 0) {
        todayTxEarningsPoints += tx.pointsDelta;
      }
    }
  }

  const todayViews =
    dailyAdLimit && dailyAdLimit.dhakaDate === todayDhaka
      ? Math.max(dailyAdLimit.completedCount, todayTxViews)
      : todayTxViews;

  const todayEarningsPoints =
    dailyAdLimit && dailyAdLimit.dhakaDate === todayDhaka
      ? Math.max(dailyAdLimit.earnedPoints, todayTxEarningsPoints)
      : todayTxEarningsPoints;

  if (referralBonusPoints === 0 && referrals.length > 0) {
    referralBonusPoints = referrals.reduce(
      (sum, r) => sum + (r.rewardStatus === 'credited' ? r.rewardPoints || r.bonusEarnedPoints : 0),
      0,
    );
  }

  // Prefer server-governed `wallets/{uid}` if populated, with lossless sync fallback to `users/{uid}`
  const totalPoints = walletDoc ? Math.max(walletDoc.totalPoints, user.points) : user.points;
  const reservedPoints = walletDoc ? walletDoc.reservedPoints : pendingWithdrawalPoints;
  const availablePoints = walletDoc
    ? Math.max(0, walletDoc.availablePoints)
    : Math.max(0, totalPoints - reservedPoints);
  const pendingPoints = walletDoc
    ? Math.max(walletDoc.pendingPoints, pendingCreditsPoints)
    : pendingCreditsPoints;
  const totalEarnedPoints = walletDoc
    ? Math.max(walletDoc.totalEarnedPoints, user.totalEarnings)
    : user.totalEarnings;
  const totalWithdrawnPoints = walletDoc
    ? Math.max(walletDoc.totalWithdrawnPoints, withdrawnPointsFromTx)
    : withdrawnPointsFromTx;
  const totalWithdrawnBdt = walletDoc
    ? Math.max(walletDoc.totalWithdrawnBdt, withdrawnBdtFromTx)
    : withdrawnBdtFromTx;

  const minWithdraw = economy.minimumWithdrawPoints;
  const withdrawablePoints =
    minWithdraw !== null && availablePoints >= minWithdraw ? availablePoints : 0;

  return {
    totalPoints,
    balancePoints: availablePoints,
    availablePoints,
    pendingPoints,
    reservedPoints,
    withdrawablePoints,
    pointsPerBdt: economy.pointsPerBdt,
    todayViews,
    todayEarningsPoints,
    totalReferrals: referrals.length,
    totalEarnedPoints,
    totalWithdrawnPoints,
    totalWithdrawnBdt,
    adViewsEarnedPoints,
    referralBonusPoints,
    dailyBonusEarnedPoints,
    minimumWithdrawPoints: minWithdraw,
    maximumWithdrawAmountBdt: economy.maximumWithdrawAmountBdt,
  };
}

export function getDefaultDailyBonusState(): DailyBonusState {
  return {
    streakDays: 0,
    lastClaimDate: '',
    lastClaimPoints: 0,
    claimedToday: false,
  };
}

class AppConfigRepository {
  getPaymentMethods(
    economy: EconomyConfig,
    firestoreMethods?: PaymentMethodConfig[],
  ): PaymentMethodConfig[] {
    const baseMin = economy.minimumWithdrawPoints;
    const defaults: PaymentMethodConfig[] = [
      {
        id: 'bkash',
        name: 'bKash',
        enabled: true,
        minPoints: baseMin,
        feePercent: 2,
        processingWindow: 'Within 24 hours after verification',
        allowedAccountTypes: ['personal', 'agent', 'merchant'],
        accountHint: '11-digit bKash number (e.g. 017XXXXXXXX)',
      },
      {
        id: 'nagad',
        name: 'Nagad',
        bengaliName: 'নগদ',
        enabled: true,
        minPoints: baseMin,
        feePercent: 1.5,
        processingWindow: 'Within 24 hours after verification',
        allowedAccountTypes: ['personal', 'agent', 'merchant'],
        accountHint: '11-digit Nagad number (e.g. 017XXXXXXXX)',
      },
      {
        id: 'rocket',
        name: 'Rocket',
        bengaliName: 'রকেট',
        enabled: true,
        minPoints: baseMin,
        feePercent: 1.8,
        processingWindow: 'Within 24 hours after verification',
        allowedAccountTypes: ['personal', 'agent', 'merchant'],
        accountHint: '11-digit Rocket number (e.g. 017XXXXXXXX)',
      },
      {
        id: 'bank',
        name: 'Bank Transfer',
        enabled: true,
        minPoints: baseMin !== null ? baseMin * 2 : null,
        feePercent: 3,
        processingWindow: '1–2 business days after verification',
        allowedAccountTypes: ['bank_account'],
        accountHint: 'Account No, Account Holder & Bank/Branch Name',
      },
    ];

    if (!firestoreMethods || firestoreMethods.length === 0) {
      return defaults;
    }

    return defaults.map((def) => {
      const override = firestoreMethods.find((m) => m.id === def.id);
      if (!override) return def;
      return {
        ...def,
        name: override.name || def.name,
        bengaliName: override.bengaliName ?? def.bengaliName,
        enabled: override.enabled,
        minPoints: override.minPoints ?? def.minPoints,
        feePercent: override.feePercent,
        processingWindow: override.processingWindow || def.processingWindow,
        allowedAccountTypes:
          override.allowedAccountTypes.length > 0
            ? override.allowedAccountTypes
            : def.allowedAccountTypes,
      };
    });
  }

  getSystemNotifications(emailVerified: boolean): NotificationItem[] {
    const list: NotificationItem[] = [];
    if (!emailVerified) {
      list.push({
        id: 'sys_verify',
        title: 'Verify Your Email Address',
        message: 'Confirm your email link to unlock full account security.',
        timeLabel: 'Action Needed',
        read: false,
      });
    }
    return list;
  }

  validateWithdrawInput(
    methodId: PaymentMethodId,
    amountBdt: number,
    accountNumber: string,
    accountType: MfsAccountType,
    wallet: WalletMetrics,
    economy: EconomyConfig,
    userStatus: UserProfile['accountStatus'] = 'active',
    paymentMethods?: PaymentMethodConfig[],
    withdrawalSettings?: WithdrawalSettingsConfig | null,
    existingRequests: WithdrawalRequestRecord[] = [],
  ): WithdrawValidationResult {
    const emptyResult = (error: string): WithdrawValidationResult => ({
      valid: false,
      error,
      grossBdt: 0,
      feeBdt: 0,
      netBdt: 0,
      pointsRequired: 0,
    });

    if (userStatus !== 'active') {
      return emptyResult('Only active accounts can request a withdrawal.');
    }

    const wdEnabled = economy.walletEnabled && (withdrawalSettings?.withdrawalEnabled ?? true);
    if (!wdEnabled) {
      return emptyResult('Withdrawals are currently paused by the Administrator.');
    }

    if (!economy.pointsPerBdt || economy.pointsPerBdt <= 0) {
      return emptyResult('Withdrawals are paused until the Admin configures the Points-to-BDT rate.');
    }

    const methods = paymentMethods ?? this.getPaymentMethods(economy);
    const method = methods.find((m) => m.id === methodId);
    if (!method) {
      return emptyResult('Selected payment method is not recognized.');
    }
    if (!method.enabled || (withdrawalSettings && !withdrawalSettings.allowedMethods.includes(methodId))) {
      return emptyResult(`${method.name} withdrawals are currently disabled by the Administrator.`);
    }

    if (!method.allowedAccountTypes.includes(accountType)) {
      return emptyResult(`Selected account type is not supported for ${method.name}.`);
    }

    const acctCheck = validateMethodAccountNumber(methodId, accountNumber);
    if (!acctCheck.valid) {
      return emptyResult(acctCheck.error || `Invalid ${method.name} account number.`);
    }

    const globalMinPts =
      withdrawalSettings?.minimumWithdrawPoints ?? economy.minimumWithdrawPoints;
    const minPts = method.minPoints ?? globalMinPts ?? 1000;
    const minBdt = pointsToBdt(minPts, economy.pointsPerBdt) ?? 0;
    const maxSingleBdt =
      withdrawalSettings?.maximumWithdrawBdt ?? economy.maximumWithdrawAmountBdt;
    const maxWalletBdt = pointsToBdt(wallet.availablePoints, economy.pointsPerBdt) ?? 0;

    if (Number.isNaN(amountBdt) || amountBdt <= 0 || amountBdt < minBdt) {
      return emptyResult(
        `Minimum withdrawal for ${method.name} is ${formatBdt(minBdt)} (${formatPoints(minPts)} Points).`,
      );
    }

    if (maxSingleBdt !== null && amountBdt > maxSingleBdt) {
      return emptyResult(`Maximum single withdrawal limit is ${formatBdt(maxSingleBdt)}.`);
    }

    if (amountBdt > maxWalletBdt) {
      return emptyResult(
        `Requested amount exceeds your available balance of ${formatBdt(maxWalletBdt)} (${formatPoints(wallet.reservedPoints)} Pts reserved).`,
      );
    }

    // Daily & Monthly Limit checks (excluding rejected/cancelled requests)
    const todayKey = getDhakaDateKey();
    const monthKey = getDhakaMonthKey();
    const countable = existingRequests.filter(
      (r) => r.status !== 'rejected' && r.status !== 'cancelled',
    );
    const todayReqs = countable.filter((r) => r.dhakaDate === todayKey);
    const monthReqs = countable.filter((r) => r.dhakaMonth === monthKey);

    if (withdrawalSettings && todayReqs.length >= withdrawalSettings.dailyLimitCount) {
      return emptyResult(
        `Daily withdrawal count limit (${withdrawalSettings.dailyLimitCount}/day) reached.`,
      );
    }

    const todaySumBdt = todayReqs.reduce((sum, r) => sum + r.grossBdt, 0);
    if (
      withdrawalSettings?.dailyLimitBdt !== null &&
      withdrawalSettings?.dailyLimitBdt !== undefined &&
      todaySumBdt + amountBdt > withdrawalSettings.dailyLimitBdt
    ) {
      const remaining = Math.max(0, withdrawalSettings.dailyLimitBdt - todaySumBdt);
      return emptyResult(
        `Daily withdrawal limit (${formatBdt(withdrawalSettings.dailyLimitBdt)}) exceeded. Remaining today: ${formatBdt(remaining)}.`,
      );
    }

    const monthSumBdt = monthReqs.reduce((sum, r) => sum + r.grossBdt, 0);
    if (
      withdrawalSettings?.monthlyLimitBdt !== null &&
      withdrawalSettings?.monthlyLimitBdt !== undefined &&
      monthSumBdt + amountBdt > withdrawalSettings.monthlyLimitBdt
    ) {
      const remaining = Math.max(0, withdrawalSettings.monthlyLimitBdt - monthSumBdt);
      return emptyResult(
        `Monthly withdrawal limit (${formatBdt(withdrawalSettings.monthlyLimitBdt)}) exceeded. Remaining this month: ${formatBdt(remaining)}.`,
      );
    }

    const feeBdt = Number(((amountBdt * method.feePercent) / 100).toFixed(2));
    const netBdt = Number(Math.max(0, amountBdt - feeBdt).toFixed(2));
    const pointsRequired = Math.round(amountBdt * economy.pointsPerBdt);

    return {
      valid: true,
      grossBdt: amountBdt,
      feeBdt,
      netBdt,
      pointsRequired,
    };
  }
}

export const appRepository = new AppConfigRepository();
