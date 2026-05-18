import React, { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
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
  fromCache: boolean;

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
  const [fromCache, setFromCache] = useState(false);

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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u) {
        // Resolve restaurantId from persisted settings (defaults to "restaurant-2" matching mobile).
        try {
          const rid = await window.api.getRestaurantId();
          setRestaurantId(rid || 'restaurant-2');
        } catch {
          setRestaurantId('restaurant-2');
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

    const unsubscribers: Unsubscribe[] = [];
    // Aggregate pending-write / fromCache state across listeners
    const writeFlags: Record<string, boolean> = {};
    const cacheFlags: Record<string, boolean> = {};
    const update = (key: string, snapshot: { metadata: { hasPendingWrites: boolean; fromCache: boolean } }) => {
      writeFlags[key] = snapshot.metadata.hasPendingWrites;
      cacheFlags[key] = snapshot.metadata.fromCache;
      // Diagnostic: log every listener's sync state so we can see which one is stuck offline.
      console.log('[firestore-sync]', key, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
        allCacheFlags: { ...cacheFlags },
      });
      setHasPendingWrites(Object.values(writeFlags).some(Boolean));
      setFromCache(Object.values(cacheFlags).some(Boolean));
    };

    const subscribe = <T,>(
      colName: string,
      setter: (data: T[]) => void,
    ) => {
      const q = query(collection(db, 'restaurants', restaurantId, colName));
      const u = onSnapshot(
        q,
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
    await setDoc(doc(db, 'restaurants', restaurantId, 'tables', table.id), {
      ...table,
      ...getAuditInfo(),
      orders: (table.orders || []).map((o) => ({ ...o, ...getAuditInfo() })),
    });
  };

  const updateTable = async (table: Table) => {
    if (!restaurantId || !user) return;
    // Serialize per-table writes: if a write for this table is already in
    // flight, queue behind it so we never have two overlapping setDoc calls
    // racing for the same document (e.g. accidental double-clicks on Save
    // or Pay). Each caller's await resolves only after its own write lands.
    const prev = inFlightWritesRef.current.get(table.id);
    const run = async () => {
      const sanitized = Object.fromEntries(
        Object.entries(table).filter(([, v]) => v !== undefined),
      );
      await setDoc(doc(db, 'restaurants', restaurantId, 'tables', table.id), sanitized);
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
    await deleteDoc(doc(db, 'restaurants', restaurantId, 'tables', id));
  };

  const addTableGroup = async (group: TableGroup) => {
    if (!restaurantId || !user) return;
    await setDoc(doc(db, 'restaurants', restaurantId, 'tableGroups', group.id), group);
  };

  const deleteTableGroup = async (id: string) => {
    if (!restaurantId || !user) return;
    await deleteDoc(doc(db, 'restaurants', restaurantId, 'tableGroups', id));
  };

  const setTableLayout = async (layout: TableLayout) => {
    if (!restaurantId || !user) return;
    await updateDoc(doc(db, 'restaurants', restaurantId), {
      'settings.tableLayout': layout,
    });
    setTableLayoutState(layout);
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
        fromCache,
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
