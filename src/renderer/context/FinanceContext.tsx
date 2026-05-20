import React, { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  disableNetwork,
  doc,
  enableNetwork,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  Recipe,
  StaffPermissions,
  Table,
  TableGroup,
  TableLayout,
  UserProfile as UserProfileType,
} from '../../shared/types';

interface FinanceContextType {
  user: User | null;
  authReady: boolean;
  userProfile: UserProfileType | null;
  restaurantId: string | null;

  recipes: Recipe[];
  /**
   * Pre-indexed lookup by recipe id. Hot rendering paths (table cards, payment
   * modal, order rows) should use this instead of `recipes.find(...)` which is
   * O(n) per call and gets invoked hundreds of times per render.
   */
  recipesById: ReadonlyMap<string, Recipe>;
  categories: string[];
  tables: Table[];
  tableGroups: TableGroup[];

  staffPermissions: StaffPermissions | null;
  tableLayout: TableLayout | null;

  isOnline: boolean;
  hasPendingWrites: boolean;
  // True once every Firestore collection listener has received at least one
  // server-confirmed (non-cache) snapshot. Used to show a "syncing" badge on
  // cold start without false-positives from fromCache on connected clients.
  initialSyncDone: boolean;
  syncStuck: boolean;
  retryConnection: () => Promise<void>;

  addTable: (table: Table) => Promise<void>;
  updateTable: (table: Table) => Promise<void>;
  deleteTable: (id: string) => Promise<void>;
  addTableGroup: (group: TableGroup) => Promise<void>;
  deleteTableGroup: (id: string) => Promise<void>;
  setTableLayout: (layout: TableLayout) => Promise<void>;
}

const defaultPermissions: StaffPermissions = {
  canSeeHistoryPrices: true,
  canSeeHistoryTotal: true,
  canRemoveTableItems: true,
  canDeleteTables: true,
  canUpdateOrders: true,
};

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

export const FinanceProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfileType | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [tableGroups, setTableGroups] = useState<TableGroup[]>([]);
  const [staffPermissions, setStaffPermissions] = useState<StaffPermissions | null>(null);
  const [tableLayout, setTableLayoutState] = useState<TableLayout | null>(null);

  // Per-table in-flight write tracker. Used to serialize concurrent setDoc
  // calls for the same table doc so we never race ourselves.
  const inFlightWritesRef = useRef<Map<string, Promise<void>>>(new Map());

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const [initialSyncDone, setInitialSyncDone] = useState(false);
  const [syncStuck, setSyncStuck] = useState(false);

  const syncStuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Detect when initial sync is taking too long (Firestore long-poll stuck).
  // Only relevant before initialSyncDone; once the server has confirmed all
  // collections at least once, we never show a stuck state again.
  useEffect(() => {
    if (isOnline && !initialSyncDone) {
      if (!syncStuckTimerRef.current) {
        syncStuckTimerRef.current = setTimeout(() => {
          syncStuckTimerRef.current = null;
          setSyncStuck(true);
        }, 15000);
      }
    } else {
      if (syncStuckTimerRef.current) {
        clearTimeout(syncStuckTimerRef.current);
        syncStuckTimerRef.current = null;
      }
      setSyncStuck(false);
    }
    return () => {
      if (syncStuckTimerRef.current) {
        clearTimeout(syncStuckTimerRef.current);
        syncStuckTimerRef.current = null;
      }
    };
  }, [isOnline, initialSyncDone]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        // Resolve restaurantId from persisted settings (defaults to "restaurant-1" matching mobile).
        try {
          const rid = await window.api.getRestaurantId();
          setRestaurantId(rid || 'restaurant-1');
        } catch {
          setRestaurantId('restaurant-1');
        }
      } else {
        setRestaurantId(null);
        setUserProfile(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !restaurantId) {
      setRecipes([]);
      setCategories([]);
      setTables([]);
      setTableGroups([]);
      setStaffPermissions(null);
      return;
    }

    setInitialSyncDone(false);

    const unsubscribers: Unsubscribe[] = [];
    const writeFlags: Record<string, boolean> = {};
    // The four collections whose server confirmation we wait for.
    const EXPECTED_KEYS = ['recipes', 'tables', 'tableGroups', 'categories'] as const;
    const serverConfirmed = new Set<string>();

    const update = (key: string, snapshot: { metadata: { hasPendingWrites: boolean; fromCache: boolean } }) => {
      writeFlags[key] = snapshot.metadata.hasPendingWrites;
      if (!snapshot.metadata.fromCache) {
        serverConfirmed.add(key);
        if (EXPECTED_KEYS.every((k) => serverConfirmed.has(k))) {
          setInitialSyncDone(true);
        }
      }
      setHasPendingWrites(Object.values(writeFlags).some(Boolean));
    };

    const subscribe = <T,>(
      colName: string,
      setter: (data: T[]) => void,
    ) => {
      const q = query(collection(db, 'restaurants', restaurantId, colName));
      // includeMetadataChanges: true is required so we receive the metadata-only
      // event when a listener transitions from cache to server-confirmed. Without
      // it Firestore suppresses callbacks when the server data equals the cache,
      // and initialSyncDone would never flip to true on an unchanged collection.
      const u = onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snapshot) => {
          const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as T[];
          setter(data);
          update(colName, snapshot);
        },
        (err) => console.error(`onSnapshot ${colName} error`, err),
      );
      unsubscribers.push(u);
    };

    subscribe<Recipe>('recipes', setRecipes);
    subscribe<Table>('tables', setTables);
    subscribe<TableGroup>('tableGroups', (groups) =>
      setTableGroups([...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))),
    );

    const catQ = query(collection(db, 'restaurants', restaurantId, 'categories'));
    unsubscribers.push(
      onSnapshot(
        catQ,
        { includeMetadataChanges: true },
        (snapshot) => {
          setCategories(snapshot.docs.map((d) => d.id));
          update('categories', snapshot);
        },
        (err) => console.error('onSnapshot categories error', err),
      ),
    );

    const restaurantDoc = doc(db, 'restaurants', restaurantId);
    unsubscribers.push(
      onSnapshot(
        restaurantDoc,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            setStaffPermissions(data?.settings?.staffPermissions ?? defaultPermissions);
            setTableLayoutState(data?.settings?.tableLayout ?? null);
          } else {
            setStaffPermissions(defaultPermissions);
            setTableLayoutState(null);
          }
        },
        (err) => console.error('onSnapshot restaurant doc error', err),
      ),
    );

    const userDoc = doc(db, 'users', user.uid);
    unsubscribers.push(
      onSnapshot(
        userDoc,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            setUserProfile({ id: snapshot.id, ...(data as object) } as UserProfileType);
          }
        },
        (err) => console.error('onSnapshot user doc error', err),
      ),
    );

    return () => unsubscribers.forEach((u) => u());
  }, [user, restaurantId]);

  const getAuditInfo = () => ({
    createdBy: user?.uid,
    createdByName: user?.displayName || user?.email || 'Unknown',
    createdAt: Date.now(),
  });

  const addTable = async (table: Table) => {
    if (!restaurantId || !user) return;
    // IMPORTANT: do NOT await the Promise returned by setDoc. Firestore only
    // resolves that promise after the *server* acknowledges the write, so
    // while offline it stays pending forever and blocks the caller's await
    // (which would freeze the UI on "Approve" / "Save" until connectivity
    // returns). The local cache is updated synchronously inside setDoc, so
    // onSnapshot fires immediately and the UI sees the change. The write is
    // safely queued by the SDK and flushed on reconnect.
    void setDoc(doc(db, 'restaurants', restaurantId, 'tables', table.id), {
      ...table,
      ...getAuditInfo(),
      orders: (table.orders || []).map((o) => ({ ...o, ...getAuditInfo() })),
    }).catch((err) => console.error('[addTable] write failed', table.id, err));
  };

  const updateTable = async (table: Table) => {
    if (!restaurantId || !user) return;
    // Serialize per-table writes so we never have two setDoc calls for the
    // same doc kicked off in overlapping ticks (accidental double-clicks on
    // Save or Pay). The queue advances as soon as setDoc has *staged* the
    // write locally — we do not wait for server ack. See the note in
    // addTable for why awaiting setDoc would break offline behaviour
    // (the Approve button would hang until the network is back).
    const prev = inFlightWritesRef.current.get(table.id);
    const run = (): Promise<void> => {
      const sanitized = Object.fromEntries(
        Object.entries(table).filter(([, v]) => v !== undefined),
      );
      // Fire-and-forget the network round-trip; only log async failures.
      void setDoc(doc(db, 'restaurants', restaurantId, 'tables', table.id), sanitized)
        .catch((err) => console.error('[updateTable] write failed', table.id, err));
      // Resolve as soon as the write has been queued by the SDK. The local
      // cache has already been updated synchronously inside setDoc, so the
      // caller can safely proceed (clear basket, print kitchen ticket, etc.).
      return Promise.resolve();
    };
    const next = (prev ?? Promise.resolve())
      .catch(() => {/* swallow prior errors so we still attempt this write */})
      .then(run);
    inFlightWritesRef.current.set(table.id, next);
    try {
      await next;
    } finally {
      // Clear only if no newer write replaced us in the meantime.
      if (inFlightWritesRef.current.get(table.id) === next) {
        inFlightWritesRef.current.delete(table.id);
      }
    }
  };

  const deleteTable = async (id: string) => {
    if (!restaurantId || !user) return;
    // Fire-and-forget: offline-safe (see addTable note).
    void deleteDoc(doc(db, 'restaurants', restaurantId, 'tables', id))
      .catch((err) => console.error('[deleteTable] write failed', id, err));
  };

  const addTableGroup = async (group: TableGroup) => {
    if (!restaurantId || !user) return;
    void setDoc(doc(db, 'restaurants', restaurantId, 'tableGroups', group.id), group)
      .catch((err) => console.error('[addTableGroup] write failed', group.id, err));
  };

  const deleteTableGroup = async (id: string) => {
    if (!restaurantId || !user) return;
    void deleteDoc(doc(db, 'restaurants', restaurantId, 'tableGroups', id))
      .catch((err) => console.error('[deleteTableGroup] write failed', id, err));
  };

  const setTableLayout = async (layout: TableLayout) => {
    if (!restaurantId || !user) return;
    void updateDoc(doc(db, 'restaurants', restaurantId), {
      'settings.tableLayout': layout,
    }).catch((err) => console.error('[setTableLayout] write failed', err));
    setTableLayoutState(layout);
  };

  // Force Firestore to drop and re-establish its long-poll connection. Call
  // this when syncStuck is true to escape a permanently stalled transport.
  const retryConnection = async () => {
    setSyncStuck(false);
    if (syncStuckTimerRef.current) {
      clearTimeout(syncStuckTimerRef.current);
      syncStuckTimerRef.current = null;
    }
    try {
      await disableNetwork(db);
      await enableNetwork(db);
    } catch (err) {
      console.error('[firestore] retryConnection failed', err);
    }
  };

  // updateDoc is imported but unused at top-level; keep reference to avoid tree-shake noise.
  void updateDoc;

  // Stable identity: only rebuilt when the recipes array reference changes.
  const recipesById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r])),
    [recipes],
  );

  return (
    <FinanceContext.Provider
      value={{
        user,
        authReady,
        userProfile,
        restaurantId,
        recipes,
        recipesById,
        categories,
        tables,
        tableGroups,
        staffPermissions,
        tableLayout,
        isOnline,
        hasPendingWrites,
        initialSyncDone,
        syncStuck,
        retryConnection,
        addTable,
        updateTable,
        deleteTable,
        addTableGroup,
        deleteTableGroup,
        setTableLayout,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
};

export const useFinance = () => {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error('useFinance must be used within FinanceProvider');
  return ctx;
};
