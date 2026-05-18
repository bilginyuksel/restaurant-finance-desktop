import React from 'react';
import { useFinance } from '../context/FinanceContext';

export const OnlineBadge: React.FC = () => {
  const { isOnline, hasPendingWrites, fromCache } = useFinance();

  let status: 'online' | 'offline' | 'syncing' = 'online';
  let text = 'Çevrimiçi';

  if (!isOnline || fromCache) {
    status = 'offline';
    text = 'Çevrimdışı';
  }
  if (hasPendingWrites) {
    status = 'syncing';
    text = 'Senkronize ediliyor…';
  }
  if (!isOnline && hasPendingWrites) {
    status = 'offline';
    text = 'Çevrimdışı (bekleyen değişiklikler var)';
  }

  return (
    <span className={`online-badge ${status}`} title={text}>
      <span className="dot" />
      {text}
    </span>
  );
};
