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
import { recordAudit } from '../firebase/auditService';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  Recipe,
  StaffPermissions,
  Table,
  TableGroup,
  TableLayout,
  UserProfile as UserProfileType,
  Warehouse,
  Stock,
  StockMovement,
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
  warehouses: Warehouse[];
  stocks: Stock[];
  defaultWarehouseId: string | null;

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
  updateTableGroup: (group: TableGroup) => Promise<void>;
  deleteTableGroup: (id: string) => Promise<void>;
  setTableLayout: (layout: TableLayout) => Promise<void>;

  addWarehouse: (warehouse: Warehouse) => Promise<void>;
  updateWarehouse: (warehouse: Warehouse) => Promise<void>;
  deleteWarehouse: (id: string) => Promise<void>;

  addStock: (stock: Stock) => Promise<void>;
  updateStock: (stock: Stock) => Promise<void>;
  deleteStock: (id: string) => Promise<void>;
  recordStockMovement: (movement: StockMovement) => Promise<void>;
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
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string | null>(null);
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
      setWarehouses([]);
      setStocks([]);
      setDefaultWarehouseId(null);
      setStaffPermissions(null);
      return;
    }

    setInitialSyncDone(false);

    const unsubscribers: Unsubscribe[] = [];
    const writeFlags: Record<string, boolean> = {};
    // The collections whose server confirmation we wait for.
    const EXPECTED_KEYS = ['recipes', 'tables', 'tableGroups', 'categories', 'warehouses', 'stocks'] as const;
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
    subscribe<Warehouse>('warehouses', setWarehouses);
    subscribe<Stock>('stocks', setStocks);
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
            setDefaultWarehouseId(data?.defaultWarehouseId ?? null);
            setStaffPermissions(data?.settings?.staffPermissions ?? defaultPermissions);
            setTableLayoutState(data?.settings?.tableLayout ?? null);
          } else {
            setDefaultWarehouseId(null);
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
    // Capture before-state from in-memory tables (avoids extra Firestore read).
    const previous = tables.find((t) => t.id === table.id);
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
    // Determine which action to emit based on status transition.
    const prevStatus = previous?.status;
    const nextStatus = table.status;
    let action: 'table.update' | 'table.close' | 'table.reopen' = 'table.update';
    if (prevStatus === 'active' && nextStatus === 'closed') action = 'table.close';
    else if (prevStatus === 'closed' && nextStatus === 'active') action = 'table.reopen';
    recordAudit(restaurantId, user, {
      action,
      entityId: table.id,
      entityName: table.name,
      before: previous ? { name: previous.name, status: previous.status, group: previous.group, totalPrice: previous.totalPrice } : undefined,
      after: { name: table.name, status: table.status, group: table.group, totalPrice: table.totalPrice },
    });
  };

  const deleteTable = async (id: string) => {
    if (!restaurantId || !user) return;
    const previous = tables.find((t) => t.id === id);
    // Fire-and-forget: offline-safe (see addTable note).
    void deleteDoc(doc(db, 'restaurants', restaurantId, 'tables', id))
      .catch((err) => console.error('[deleteTable] write failed', id, err));
    recordAudit(restaurantId, user, {
      action: 'table.delete',
      entityId: id,
      entityName: previous?.name,
      before: previous ? { name: previous.name, status: previous.status, totalPrice: previous.totalPrice } : undefined,
    });
  };

  const addTableGroup = async (group: TableGroup) => {
    if (!restaurantId || !user) return;
    void setDoc(doc(db, 'restaurants', restaurantId, 'tableGroups', group.id), group)
      .catch((err) => console.error('[addTableGroup] write failed', group.id, err));
  };

  const updateTableGroup = async (group: TableGroup) => {
    if (!restaurantId || !user) return;
    await setDoc(doc(db, 'restaurants', restaurantId, 'tableGroups', group.id), group, { merge: true })
      .catch((err) => console.error('[updateTableGroup] write failed', group.id, err));
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

  const addWarehouse = async (warehouse: Warehouse) => {
    if (!restaurantId || !user) return;
    void setDoc(doc(db, 'restaurants', restaurantId, 'warehouses', warehouse.id), { ...warehouse, ...getAuditInfo() })
      .catch((err) => console.error('[addWarehouse] write failed', warehouse.id, err));
  };

  const updateWarehouse = async (warehouse: Warehouse) => {
    if (!restaurantId || !user) return;
    void updateDoc(doc(db, 'restaurants', restaurantId, 'warehouses', warehouse.id), { ...warehouse })
      .catch((err) => console.error('[updateWarehouse] write failed', warehouse.id, err));
  };

  const deleteWarehouse = async (id: string) => {
    if (!restaurantId || !user) return;
    void deleteDoc(doc(db, 'restaurants', restaurantId, 'warehouses', id))
      .catch((err) => console.error('[deleteWarehouse] write failed', id, err));
  };

  const addStock = async (stock: Stock) => {
    if (!restaurantId || !user) return;
    void setDoc(doc(db, 'restaurants', restaurantId, 'stocks', stock.id), { ...stock, ...getAuditInfo() })
      .catch((err) => console.error('[addStock] write failed', stock.id, err));
  };

  const updateStock = async (stock: Stock) => {
    if (!restaurantId || !user) return;
    void updateDoc(doc(db, 'restaurants', restaurantId, 'stocks', stock.id), { ...stock })
      .catch((err) => console.error('[updateStock] write failed', stock.id, err));
  };

  const deleteStock = async (id: string) => {
    if (!restaurantId || !user) return;
    void deleteDoc(doc(db, 'restaurants', restaurantId, 'stocks', id))
      .catch((err) => console.error('[deleteStock] write failed', id, err));
  };

  const recordStockMovement = async (movement: StockMovement) => {
    if (!restaurantId || !user) return;
    void setDoc(doc(db, 'restaurants', restaurantId, 'stockMovements', movement.id), { ...movement, ...getAuditInfo() })
      .catch((err) => console.error('[recordStockMovement] write failed', movement.id, err));
    const productName =
      recipes.find((r) => r.id === movement.productId)?.name ?? movement.productId;
    const warehouseName =
      warehouses.find((w) => w.id === movement.warehouseId)?.name ?? movement.warehouseId;
    recordAudit(restaurantId, user, {
      action: 'stock_movement.record',
      entityId: movement.id,
      entityName: productName,
      metadata: {
        warehouseId: movement.warehouseId,
        warehouseName,
        productId: movement.productId,
        productName,
        quantityChange: movement.quantityChange,
        reason: movement.reason,
        referenceId: movement.referenceId,
      },
    });
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
        updateTableGroup,
        deleteTableGroup,
        setTableLayout,
        warehouses,
        stocks,
        defaultWarehouseId,
        addWarehouse,
        updateWarehouse,
        deleteWarehouse,
        addStock,
        updateStock,
        deleteStock,
        recordStockMovement,
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
