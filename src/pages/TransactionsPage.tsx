import React from 'react';
import { TransactionRecord, WalletLedgerEntry } from '../types';
import { TransactionHistorySection } from '../components/wallet/TransactionHistorySection';

interface TransactionsPageProps {
  transactions: TransactionRecord[];
  walletLedger?: WalletLedgerEntry[];
  loading?: boolean;
}

export const TransactionsPage: React.FC<TransactionsPageProps> = ({
  transactions,
  walletLedger = [],
  loading = false,
}) => {
  return (
    <TransactionHistorySection
      transactions={transactions}
      walletLedger={walletLedger}
      loading={loading}
      pageSize={12}
      title="All Wallet Transactions"
    />
  );
};
