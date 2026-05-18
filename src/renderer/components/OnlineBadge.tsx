import React from 'react';
import { useFinance } from '../context/FinanceContext';

export const OnlineBadge: React.FC = () => {
  const { isOnline, hasPendingWrites, initialSyncDone, syncStuck, retryConnection } = useFinance();

  // Derive status in priority order:
  //   error   — network appears up but initial sync never completed (>15 s)
  //   offline — browser reports no network (optionally with pending writes)
  //   syncing — waiting for first server-confirmed snapshot, or writes in flight
  //   online  — all good
  let status: 'online' | 'offline' | 'syncing' | 'error' = 'online';
  let text = 'Çevrimiçi';

  if (!isOnline && hasPendingWrites) {
    status = 'offline';
    text = 'Çevrimdışı (bekleyen değişiklikler var)';
  } else if (!isOnline) {
    status = 'offline';
    text = 'Çevrimdışı';
  } else if (syncStuck) {
    status = 'error';
    text = 'Bağlantı sorunu';
  } else if (!initialSyncDone || hasPendingWrites) {
    status = 'syncing';
    text = 'Senkronize ediliyor…';
  }

  return (
    <span className={`online-badge ${status}`} title={text}>
      <span className="dot" />
      {text}
      {syncStuck && (
        <button
          className="online-badge-retry"
          onClick={retryConnection}
          title="Yeniden bağlan"
        >
          ↺
        </button>
      )}
    </span>
  );
};
