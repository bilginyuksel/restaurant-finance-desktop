import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  enableNetwork,
} from 'firebase/firestore';
import { initializeAuth, indexedDBLocalPersistence } from 'firebase/auth';

// Same Firebase project as the mobile restaurant-finance app.
const firebaseConfig = {
  apiKey: 'AIzaSyATh9s1RzC6YKnFudfzbJnpyYgX-2yVtm4',
  authDomain: 'restaurant-finance.firebaseapp.com',
  projectId: 'restaurant-finance',
  storageBucket: 'restaurant-finance.firebasestorage.app',
  messagingSenderId: '29715079600',
  appId: '1:29715079600:web:03abb48aa3dd499818b675',
};

export const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  // Persistent IndexedDB cache: tables/recipes survive cold restarts so the app
  // boots with last-known data instantly and reconciles deltas in the background.
  // Combined with long-polling below, this avoids the "stuck in fromCache" issue
  // we hit previously with the default WebChannel transport.
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager({}),
  }),
  // Electron's Chromium drops Firestore's WebChannel streams in many environments,
  // leaving the client stuck in "fromCache" / "syncing" forever. Long-polling is
  // the reliable transport for desktop apps.
  experimentalForceLongPolling: true,
  ignoreUndefinedProperties: true,
});

export const auth = initializeAuth(app, {
  // Persist auth across restarts so staff don't have to re-login every cold start
  // (and so we don't tear down listeners + re-download collections on every launch).
  persistence: indexedDBLocalPersistence,
});

// Safety net: explicitly enable the network. In some Electron cold-start paths
// the Firestore client comes up with the network disabled, leaving every
// listener stuck reporting `fromCache: true`.
enableNetwork(db).catch((err) => {
  console.error('[firestore] enableNetwork failed', err);
});
