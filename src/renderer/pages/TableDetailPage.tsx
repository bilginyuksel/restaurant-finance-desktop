import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useFinance } from '../context/FinanceContext';
import { fetchTableById } from '../services/financeService';
import { ItemGrid } from '../components/ItemGrid';
import { ConfirmModal } from '../components/ConfirmModal';
import { PaymentModal, PaymentPayload } from '../components/PaymentModal';
import { toast, toastError, toastSuccess } from '../components/Toast';
import { Recipe, Table, TableItem, TableOrder, Transaction, SelectedVariation } from '../../shared/types';
import { VariationModal } from '../components/VariationModal';
import { formatCurrency, CURRENCY } from '../utils/currency';
import {
  itemLineTotal,
  itemPrice,
  recipeName,
  recipeUnitLabel,
  tableTotalFromOrders,
  tableUnpaidTotal,
} from '../utils/totals';
import { useHotkeys } from 'react-hotkeys-hook';
import { ReceiptLineItem, ReceiptPayload } from '../../shared/receipt';
import { recordAudit } from '../firebase/auditService';

const newId = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// Internal type used while editing an existing order. Tracks the original quantity per line
// and flags lines added during this edit session, so we can compute & print the kitchen delta on save.
type EditItem = TableItem & { _origQty?: number; _isNew?: boolean };
type EditState = { orderId: string; items: EditItem[] };


const variationsKey = (v?: SelectedVariation[]) => {
  if (!v || v.length === 0) return '';
  const sorted = [...v].sort((a, b) => a.groupId.localeCompare(b.groupId)).map(x => ({
    ...x,
    optionIds: [...x.optionIds].sort()
  }));
  return JSON.stringify(sorted);
};

export const TableDetailPage: React.FC<{ tableId?: string; onClose?: () => void }> = ({ tableId: propTableId, onClose }) => {
  const params = useParams<{ id: string }>();
  const id = propTableId || params.id;
  const navigate = useNavigate();
  const location = useLocation();
  const { tables, recipes, recipesById, categories, updateTable, deleteTable, addTable, user, userProfile, restaurantId, staffPermissions, tableLayout, tableGroups, warehouses, stocks, defaultWarehouseId, updateStock, recordStockMovement } = useFinance();



  // Draft mode: TablesPage navigates here with a pre-generated `t_*` ID and
  // the slot's identity in router state when the user taps a placeholder.
  // No Firestore doc exists yet — we synthesize a local empty Table so the
  // page can render. The doc is materialised on the first updateTable call
  // (e.g. when an order is sent to the kitchen). If the user backs out
  // without ordering, no orphan doc is left in Firestore.
  type DraftState = { draft?: { name: string; group: string | null } };
  const draft = (location.state as DraftState | null)?.draft ?? null;
  // Legacy preset placeholder support (in case any in-flight route still uses
  // the old preset_<groupId>_<num> scheme). New navigations go through `draft`.
  const isPreset = Boolean(id?.startsWith('preset_'));
  const presetTable = useMemo<Table | null>(() => {
    if (!isPreset || !id) return null;
    const parts = id.split('_'); // ['preset', groupId, num]
    const num = parts[parts.length - 1];
    const groupId = parts.slice(1, -1).join('_');
    const prefix =
      tableLayout?.groupPrefixes?.[groupId] ||
      (tableGroups.find((g) => g.id === groupId)?.name ?? '').slice(0, 2).toUpperCase() ||
      'M';
    return {
      id,
      name: `${prefix} ${num}`,
      group: groupId || undefined,
      status: 'active',
      createdAt: new Date().toISOString(),
      orders: [],
      totalPrice: 0,
      transactions: [],
    };
  }, [id, isPreset, tableLayout, tableGroups]);

  const draftTable = useMemo<Table | null>(() => {
    if (!draft || !id) return null;
    return {
      id,
      name: draft.name,
      ...(draft.group ? { group: draft.group } : {}),
      status: 'active',
      createdAt: new Date().toISOString(),
      orders: [],
      totalPrice: 0,
      transactions: [],
    };
  }, [draft, id]);

  const [historyTable, setHistoryTable] = useState<Table | null>(null);

  const table = useMemo(
    () => tables.find((t) => t.id === id) || draftTable || presetTable || historyTable,
    [tables, id, draftTable, presetTable, historyTable],
  );
  const [basket, setBasket] = useState<TableItem[]>([]);
  const [weightModal, setWeightModal] = useState<{ recipe: Recipe; value: string; target: 'basket' | 'edit', variations?: SelectedVariation[] } | null>(null);
  const [variationModal, setVariationModal] = useState<{ recipe: Recipe; target: 'basket' | 'edit' } | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reopenConfirm, setReopenConfirm] = useState(false);
  const [prepayConfirm, setPrepayConfirm] = useState(false);
  const [closeSettledConfirm, setCloseSettledConfirm] = useState(false);
  const [editingTableName, setEditingTableName] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableGroup, setNewTableGroup] = useState('');
  // In-flight guard: blocks all mutation handlers while one is running so
  // rapid double-clicks (or hotkey hammering) can't submit twice. The ref
  // gives us a synchronous check; the state drives button `disabled`.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const runExclusive = async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // Edit-mode: when set, picking items on the left grid is routed into this buffer
  // (instead of the basket), and Save will persist the whole order and print only
  // the delta (newly added items + quantity increases) to the kitchen.
  const [edit, setEdit] = useState<EditState | null>(null);
  // When saving an edit that removes items, we prompt for a reason first.
  const [removalReasonModal, setRemovalReasonModal] = useState<{ reason: string } | null>(null);

  // Preserve the originating group tab so back-navigation returns to the same filter.
  const backTo = useMemo(() => {
    const g = table?.group;
    return g ? `/tables?group=${encodeURIComponent(g)}` : '/tables';
  }, [table?.group]);

  const handleClose = () => {
    if (onClose) onClose();
    else navigate(backTo);
  };


  useEffect(() => {
    // Draft and preset paths always synthesize a table, so `table` is truthy
    // and this guard is skipped naturally. For real IDs that don't resolve
    // (e.g. a stale URL), give the snapshot a brief window to deliver before
    // declaring the table missing.
    if (tables.length === 0 || table || isPreset || draft) return;

    let isMounted = true;
    if (id && restaurantId && !historyTable) {
      fetchTableById(restaurantId, id).then(t => {
        if (!isMounted) return;
        if (t) {
          setHistoryTable(t);
        } else {
          toastError('Masa bulunamadı');
          if (onClose) onClose(); else navigate('/tables');
        }
      }).catch(err => {
        if (!isMounted) return;
        console.error("Failed to fetch table:", err);
        toastError('Masa bulunamadı');
        if (onClose) onClose(); else navigate('/tables');
      });
      return () => { isMounted = false; };
    }

    const timer = setTimeout(() => {
      toastError('Masa bulunamadı');
      if (onClose) onClose(); else navigate('/tables');
    }, 600);
    return () => {
      clearTimeout(timer);
      isMounted = false;
    };
  }, [tables, table, navigate, isPreset, draft, id, restaurantId, historyTable, onClose]);

  // If the table reloads and the order being edited no longer exists, drop edit state.
  useEffect(() => {
    if (!edit || !table) return;
    if (!(table.orders ?? []).some((o) => o.id === edit.orderId)) setEdit(null);
  }, [edit, table]);

  const canDelete = userProfile?.role === 'admin' || (staffPermissions?.canDeleteTables ?? true);
  const canEditOrders = userProfile?.role === 'admin' || (staffPermissions?.canUpdateOrders ?? false);
  const canRemoveItems = userProfile?.role === 'admin' || (staffPermissions?.canRemoveTableItems ?? false);

  // ---------- existing-order: bulk edit ----------
  const startEdit = (o: TableOrder) => {
    if (!canEditOrders) return;
    setEdit({
      orderId: o.id,
      items: o.items.map((it) => ({ ...it, _origQty: it.quantity })),
    });
  };

  const cancelEdit = () => setEdit(null);

  const editInc = (idx: number, delta: number) => {
    setEdit((e) => {
      if (!e) return e;
      const items = [...e.items];
      const it = items[idx];
      if (!it || it.paymentStatus === 'paid') return e;
      const unit = recipeUnitLabel(it.recipeId, recipes);
      if (unit === 'kg') return e; // kg-priced lines can only be removed entirely
      const nextQty = it.quantity + delta;
      if (nextQty <= 0) {
        // Allow removing only if user has permission or it's a freshly added (un-printed) line
        if (!canRemoveItems && !it._isNew) return e;
        items.splice(idx, 1);
      } else {
        items[idx] = { ...it, quantity: nextQty };
      }
      return { ...e, items };
    });
  };

  const editRemove = (idx: number) => {
    setEdit((e) => {
      if (!e) return e;
      const it = e.items[idx];
      if (!it || it.paymentStatus === 'paid') return e;
      if (!canRemoveItems && !it._isNew) return e;
      const items = [...e.items];
      items.splice(idx, 1);
      return { ...e, items };
    });
  };

  const editAdd = (recipe: Recipe, qty: number, selectedVariations?: SelectedVariation[]) => {
    setEdit((e) => {
      if (!e) return e;
      // For weight-based, always add a new line so weights don't merge unintuitively.
      if (recipe.pricingType === 'by_weight') {
        return {
          ...e,
          items: [
            ...e.items,
            {
              recipeId: recipe.id,
              quantity: qty,
              price: recipe.price,
              productSnapshot: recipe,
              paymentStatus: 'pending',
              _isNew: true,
              selectedVariations,
            },
          ],
        };
      }
      // Merge into an existing freshly-added line of the same recipe, if any.
      const vKey = variationsKey(selectedVariations);
      const idx = e.items.findIndex((it) => it._isNew && it.recipeId === recipe.id && variationsKey(it.selectedVariations) === vKey);
      if (idx >= 0) {
        const items = [...e.items];
        items[idx] = { ...items[idx], quantity: items[idx].quantity + qty };
        return { ...e, items };
      }
      return {
        ...e,
        items: [
          ...e.items,
          {
            recipeId: recipe.id,
            quantity: qty,
            price: recipe.price,
            productSnapshot: recipe,
            paymentStatus: 'pending',
            _isNew: true,
            selectedVariations,
          },
        ],
      };
    });
  };

  /**
   * Returns true if the current edit has reduced or removed at least one
   * previously-persisted (non-new) item compared to the original order.
   */
  const editHasRemovals = (): boolean => {
    if (!table || !edit) return false;
    const originalOrder = (table.orders ?? []).find((o) => o.id === edit.orderId);
    if (!originalOrder) return false;
    const originalQty = new Map<string, number>();
    for (const it of originalOrder.items) {
      const key = it.recipeId + '_' + variationsKey(it.selectedVariations);
      originalQty.set(key, (originalQty.get(key) ?? 0) + it.quantity);
    }
    const editedQty = new Map<string, number>();
    for (const it of edit.items) {
      if (it._isNew) continue;
      const key = it.recipeId + '_' + variationsKey(it.selectedVariations);
      editedQty.set(key, (editedQty.get(key) ?? 0) + it.quantity);
    }
    return [...originalQty.entries()].some(([key, qty]) => (editedQty.get(key) ?? 0) < qty);
  };

  /**
   * Called by the Save button. If items were removed, shows the reason modal
   * first; otherwise saves immediately.
   */
  const handleSaveEdit = () => {
    if (editHasRemovals()) {
      setRemovalReasonModal({ reason: '' });
    } else {
      void saveEdit('');
    }
  };

  const saveEdit = (removalReason = '') => runExclusive(async () => {
    if (!table || !edit) return;
    const now = Date.now();
    const cleanItems: TableItem[] = edit.items.map((it) => {
      const qtyToSave = typeof it.quantity === 'number' ? it.quantity : 1;
      const { _origQty, _isNew, quantity, ...rest } = it as any;
      void _origQty;
      // Stamp createdBy/createdAt on newly added items so the rest of the app treats them like any other order item.
      if (_isNew) {
        return {
          ...rest,
          quantity: qtyToSave,
          createdBy: user?.uid,
          createdByName: user?.displayName || user?.email || 'Unknown',
          createdAt: now,
        };
      }
      return { ...rest, quantity: qtyToSave } as TableItem;
    });

    // Compute delta: new items get their full quantity; existing items contribute (new - original) if positive.
    const deltaItems: TableItem[] = [];
    for (const it of edit.items) {
      if (it._isNew) {
        deltaItems.push({ ...it, _isNew: undefined, _origQty: undefined } as TableItem);
      } else if (typeof it._origQty === 'number' && it.quantity > it._origQty) {
        deltaItems.push({ ...it, quantity: it.quantity - it._origQty, _origQty: undefined } as TableItem);
      }
    }

    // Compute cancellations: any decrease in qty (or full removal) of a previously-persisted line.
    // We aggregate by recipeId so multiple lines of the same recipe collapse into a single İPTAL row.
    const originalOrder = (table.orders ?? []).find((o) => o.id === edit.orderId);
    const cancelledItems: TableItem[] = [];
    if (originalOrder) {
      const originalByRecipe = new Map<string, { qty: number; sample: TableItem }>();
      for (const it of originalOrder.items) {
        const key = it.recipeId + '_' + variationsKey(it.selectedVariations);
        const cur = originalByRecipe.get(key);
        if (cur) cur.qty += it.quantity;
        else originalByRecipe.set(key, { qty: it.quantity, sample: it });
      }
      const remainingByRecipe = new Map<string, number>();
      for (const it of edit.items) {
        if (it._isNew) continue;
        const key = it.recipeId + '_' + variationsKey(it.selectedVariations);
        remainingByRecipe.set(key, (remainingByRecipe.get(key) ?? 0) + it.quantity);
      }
      for (const [key, { qty: origQty, sample }] of originalByRecipe) {
        const remaining = remainingByRecipe.get(key) ?? 0;
        const cancelledQty = +(origQty - remaining).toFixed(6);
        if (cancelledQty > 0) {
          cancelledItems.push({ ...sample, quantity: cancelledQty });
        }
      }
    }

    // Build the next orders list. If after edit the order becomes empty, drop it.
    const nextOrders = (table.orders ?? [])
      .map((o) => (o.id === edit.orderId ? stampOrder({ ...o, items: cleanItems }) : o))
      .filter((o) => o.items.length > 0);

    const next: Table = {
      ...table,
      orders: nextOrders,
      totalPrice: tableTotalFromOrders({ ...table, orders: nextOrders }, recipes),
    };

    try {
      await updateTable(next);
      setEdit(null);
      // Audit: order updated
      if (restaurantId && user && originalOrder) {
        recordAudit(restaurantId, user, {
          action: 'order.update',
          entityId: edit.orderId,
          entityName: `${table.name} — Sipariş`,
          metadata: {
            tableId: table.id,
            tableName: table.name,
            orderNumber: originalOrder.orderNumber,
            ...(removalReason.trim() ? { removalReason: removalReason.trim() } : {}),
          },
          before: {
            items: originalOrder.items.map((it) => ({
              recipeId: it.recipeId,
              productName: it.productSnapshot?.name ?? it.recipeId,
              quantity: it.quantity,
              price: it.price,
              selectedVariations: it.selectedVariations,
            })),
          },
          after: {
            items: cleanItems.map((it) => ({
              recipeId: it.recipeId,
              productName: it.productSnapshot?.name ?? it.recipeId,
              quantity: it.quantity,
              price: it.price,
              selectedVariations: it.selectedVariations,
            })),
          },
        });
      }
      if (deltaItems.length > 0 || cancelledItems.length > 0) {
        const deltaOrder: TableOrder = {
          id: newId('o-edit'),
          orderNumber: originalOrder?.orderNumber,
          items: deltaItems,
          createdBy: user?.uid,
          createdByName: user?.displayName || user?.email || 'Unknown',
          createdAt: now,
        };
        // Print delta with a clear marker so the kitchen knows it's a change, not a brand-new order.
        void printKitchen(deltaOrder, `${table.name} (DEĞİŞİKLİK)`, cancelledItems);
        if (deltaItems.length > 0 && cancelledItems.length > 0) {
          toastSuccess('Sipariş güncellendi · değişiklikler yazdırıldı');
        } else if (cancelledItems.length > 0) {
          toastSuccess('Sipariş güncellendi · iptaller yazdırıldı');
        } else {
          toastSuccess('Sipariş güncellendi · yeni ürünler yazdırıldı');
        }
      } else {
        toastSuccess('Sipariş güncellendi');
      }
    } catch (err) {
      console.error(err);
      toastError('Sipariş güncellenemedi');
    }
  });

  const stampOrder = (o: TableOrder): TableOrder => ({
    ...o,
    updatedAt: Date.now(),
    updatedBy: user?.uid,
    updatedByName: user?.displayName || user?.email || undefined,
  });

  // ---------- basket management ----------
  const addToBasket = (recipe: Recipe, qty: number, selectedVariations?: SelectedVariation[]) => {
    setBasket((b) => {
      // For weight-based, always add a new line so weights don't merge unintuitively.
      if (recipe.pricingType === 'by_weight') {
        return [
          ...b,
          {
            recipeId: recipe.id,
            quantity: qty,
            price: recipe.price * qty / qty, // unit price (per kg)
            productSnapshot: recipe,
            selectedVariations,
          },
        ];
      }
      const vKey = variationsKey(selectedVariations);
      const idx = b.findIndex((it) => it.recipeId === recipe.id && variationsKey(it.selectedVariations) === vKey);
      if (idx >= 0) {
        const copy = [...b];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
        return copy;
      }
      return [
        ...b,
        {
          recipeId: recipe.id,
          quantity: qty,
          price: recipe.price,
          productSnapshot: recipe,
          selectedVariations,
        },
      ];
    });
  };


  const handlePickRecipe = (recipe: Recipe) => {
    const target: 'basket' | 'edit' = edit ? 'edit' : 'basket';
    if (recipe.variationGroups && recipe.variationGroups.length > 0) {
      setVariationModal({ recipe, target });
      return;
    }
    if (recipe.pricingType === 'by_weight') {
      setWeightModal({ recipe, value: '', target });
      return;
    }
    if (target === 'edit') editAdd(recipe, 1);
    else addToBasket(recipe, 1);
  };

  const confirmVariation = (variations: SelectedVariation[]) => {
    if (!variationModal) return;
    const { recipe, target } = variationModal;
    setVariationModal(null);
    if (recipe.pricingType === 'by_weight') {
      setWeightModal({ recipe, value: '', target, variations });
      return;
    }
    if (target === 'edit') editAdd(recipe, 1, variations);
    else addToBasket(recipe, 1, variations);
  };

  const confirmWeight = () => {
    if (!weightModal) return;
    const kg = parseFloat(weightModal.value.replace(',', '.'));
    if (!kg || kg <= 0) {
      toastError('Geçerli bir ağırlık girin (kg, örn: 0,452)');
      return;
    }
    if (weightModal.target === 'edit') editAdd(weightModal.recipe, kg, weightModal.variations);
    else addToBasket(weightModal.recipe, kg, weightModal.variations);
    setWeightModal(null);
  };

  const incBasket = (idx: number, delta: number) => {
    setBasket((b) => {
      const copy = [...b];
      const next = (copy[idx].quantity ?? 0) + delta;
      if (next <= 0) {
        copy.splice(idx, 1);
      } else {
        copy[idx] = { ...copy[idx], quantity: next };
      }
      return copy;
    });
  };

  const setBasketQty = (idx: number, qty: any) => {
    setBasket((b) => {
      const copy = [...b];
      if (qty !== '' && qty <= 0) {
        copy.splice(idx, 1);
      } else {
        copy[idx] = { ...copy[idx], quantity: qty };
      }
      return copy;
    });
  };

  const setEditQty = (idx: number, qty: any) => {
    setEdit((e) => {
      if (!e) return e;
      const items = [...e.items];
      const it = items[idx];
      if (!it || it.paymentStatus === 'paid') return e;
      const unit = recipeUnitLabel(it.recipeId, recipes);
      if (unit === 'kg') return e;
      if (qty !== '' && qty <= 0) {
        if (!canRemoveItems && !it._isNew) return e;
        items.splice(idx, 1);
      } else {
        items[idx] = { ...it, quantity: qty };
      }
      return { ...e, items };
    });
  };

  // ---------- send to kitchen ----------
  const sendToKitchen = () => runExclusive(async () => {
    if (!table || basket.length === 0) return;

    // If this is still a placeholder (no Firestore doc yet), create it now.
    const isPersistedTable = tables.some((t) => t.id === table.id);
    if (!isPersistedTable) {
      try {
        await addTable(table);
      } catch (err) {
        console.error(err);
        toastError('Masa oluşturulamadı');
        return;
      }
    }

    const { orderNumber } = await window.api.nextOrderNumber();
    const order: TableOrder = {
      id: newId('o'),
      orderNumber,
      items: basket.map((it) => ({
        ...it,
        quantity: typeof it.quantity === 'number' ? it.quantity : 1,
        createdBy: user?.uid,
        createdByName: user?.displayName || user?.email || 'Unknown',
        createdAt: Date.now(),
        paymentStatus: 'pending',
      })),
      createdBy: user?.uid,
      createdByName: user?.displayName || user?.email || 'Unknown',
      createdAt: Date.now(),
    };

    const newTable: Table = {
      ...table,
      orders: [...(table.orders ?? []), order],
      totalPrice: tableTotalFromOrders({ ...table, orders: [...(table.orders ?? []), order] }, recipes),
      receiptPrinted: false,
    };
    try {
      await updateTable(newTable);
      // Audit: order added
      if (restaurantId && user) {
        recordAudit(restaurantId, user, {
          action: 'order.add',
          entityId: order.id,
          entityName: `${table.name} — Sipariş`,
          metadata: { tableId: table.id, tableName: table.name, orderNumber: order.orderNumber },
          after: {
            items: order.items.map((it) => ({
              recipeId: it.recipeId,
              productName: it.productSnapshot?.name ?? it.recipeId,
              quantity: it.quantity,
              price: it.price,
              selectedVariations: it.selectedVariations,
            })),
          },
        });
      }
      // Fire-and-forget kitchen print (don't block UI)
      void printKitchen(order, table.name);
      setBasket([]);
      toastSuccess('Mutfağa gönderildi');
    } catch (err) {
      console.error(err);
      toastError('Sipariş gönderilemedi');
    }
  });

  // ---------- printing ----------
  // TableItem may carry an extra `_cancelled` marker (set by saveEdit) so the kitchen ticket
  // line is rendered with an İPTAL tag. The flag is stripped before reaching the receipt payload.
  const buildLineItems = (items: (TableItem & { _cancelled?: boolean })[]): ReceiptLineItem[] =>
    items.map((it) => ({
      name: recipeName(it.recipeId, recipes),
      quantity: recipeUnitLabel(it.recipeId, recipes) === 'kg' ? +(it.quantity * 1000).toFixed(0) : it.quantity,
      unitLabel: recipeUnitLabel(it.recipeId, recipes) === 'kg' ? 'g' : undefined,
      unitPrice: itemPrice(it, recipes),
      lineTotal: itemLineTotal(it, recipes),
      cancelled: it._cancelled || undefined,
      variations: it.selectedVariations?.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`),
    }));

  const printKitchen = async (
    order: TableOrder,
    tableName: string,
    cancelledItems: TableItem[] = [],
  ) => {
    if (order.items.length === 0 && cancelledItems.length === 0) return;

    // Look up category-routing each time we print so changes in Settings take effect.
    let routing: Record<string, string> = {};
    try {
      routing = await window.api.getCategoryRouting();
    } catch {
      routing = {};
    }

    // Group items by destination printer id.
    // '' means default kitchen; '__skip__' means do not send to any printer.
    const groups = new Map<string, (TableItem & { _cancelled?: boolean })[]>();
    const pushTo = (it: TableItem & { _cancelled?: boolean }) => {
      const recipe = recipes.find((r) => r.id === it.recipeId);
      const cat = recipe?.category ?? '';
      const dest = routing[cat] ?? '';
      if (dest === '__skip__') return; // category excluded from kitchen printing
      const arr = groups.get(dest) ?? [];
      arr.push(it);
      groups.set(dest, arr);
    };
    for (const it of order.items) pushTo(it);
    for (const it of cancelledItems) pushTo({ ...it, _cancelled: true });

    const baseTimestamp = new Date().toLocaleString('tr-TR');
    const waiterName = user?.displayName || user?.email || undefined;

    for (const [dest, items] of groups) {
      const payload: ReceiptPayload = {
        kind: 'kitchen',
        tableName,
        timestamp: baseTimestamp,
        currency: CURRENCY,
        items: buildLineItems(items),
        total: items.reduce((s, it) => s + (it._cancelled ? 0 : itemLineTotal(it, recipes)), 0),
        waiterName,
        orderNumber: order.orderNumber,
      };
      const res = dest
        ? await window.api.printKitchenTo(dest, payload)
        : await window.api.printKitchenTicket(payload);
      if (!res.ok) toastError(`Yazıcı (${dest || 'mutfak'}): ${res.error}`);
    }
  };

  const printCustomerBill = () => runExclusive(async () => {
    if (!table) return;
    const allItems = (table.orders ?? []).flatMap((o) => o.items);
    if (allItems.length === 0) {
      toastError('Masada ürün yok');
      return;
    }
    const payload: ReceiptPayload = {
      kind: 'customer',
      restaurantName: 'HobiPark',
      tableName: table.name,
      timestamp: new Date().toLocaleString('tr-TR'),
      currency: CURRENCY,
      items: buildLineItems(allItems),
      total: tableTotalFromOrders(table, recipes),
      waiterName: user?.displayName || user?.email || undefined,
      orderNumber: (table.orders ?? []).map(o => o.orderNumber).filter(Boolean)[0],
    };
    const res = await window.api.printCustomerBill(payload);
    if (res.ok) {
      toastSuccess('Fiş yazdırıldı');
      await updateTable({ ...table, receiptPrinted: true });
    } else toastError(`Yazıcı: ${res.error}`);
  });

  // ---------- close / pay ----------
  const deductTableStock = (tableToDeduct: Table) => {
    let warehouseToDeduct = defaultWarehouseId || (warehouses.length > 0 ? warehouses[0].id : null);
    
    if (tableToDeduct.group) {
      const group = tableGroups.find(g => g.id === tableToDeduct.group);
      if (group?.warehouseId) {
        warehouseToDeduct = group.warehouseId;
      }
    }

    if (!warehouseToDeduct) return;

    const allItems = (tableToDeduct.orders ?? []).flatMap((o) => o.items);
    // Aggregate quantities by recipeId AND by selectedProducts (variation-linked products)
    const productQuantities: Record<string, number> = {};
    allItems.forEach((item) => {
      // Main product
      productQuantities[item.recipeId] = (productQuantities[item.recipeId] || 0) + item.quantity;
      // Variation-linked products (e.g. Coke or Sprite chosen as a drink variation)
      if (item.selectedVariations) {
        item.selectedVariations.forEach((variation) => {
          if (variation.selectedProducts) {
            variation.selectedProducts.forEach((sel) => {
              productQuantities[sel.productId] = (productQuantities[sel.productId] || 0) + item.quantity;
            });
          }
        });
      }
    });

    Object.entries(productQuantities).forEach(([productId, qty]) => {
      const stock = stocks.find((s) => s.productId === productId && s.warehouseId === warehouseToDeduct);
      if (stock) {
        updateStock({ ...stock, quantity: stock.quantity - qty });
        recordStockMovement({
          id: newId('sm'),
          warehouseId: warehouseToDeduct,
          productId,
          quantityChange: -qty,
          reason: 'sale',
          referenceId: tableToDeduct.id,
        });
      }
    });
  };

  // Apply a payment to the table. Supports full, custom amount, or per-item partial payments.
  // When the table's remaining balance reaches 0 the table is auto-closed and the user navigated back.
  const takePayment = (p: PaymentPayload) => runExclusive(async () => {
    if (!table) return;
    const now = Date.now();
    const userName = user?.displayName || user?.email || 'Unknown';
    let nextOrders: TableOrder[] = table.orders ?? [];
    let paidItems: TableItem[] | undefined;
    // grossAmount = portion of the bill being settled (pre-discount/rounding).
    // amount      = actual money collected (post-discount, post-rounding).
    // For 'all' and 'items' modes the modal computes confirmAmount from the
    // selected lines, so p.grossAmount already matches the recomputed totals
    // below — but we recompute defensively to avoid rounding drift from the
    // modal's display formatting.
    let grossAmount = p.grossAmount;

    if (p.mode === 'all') {
      paidItems = [];
      nextOrders = nextOrders.map((o) => {
        const newItems = o.items.map((it) => {
          if (it.paymentStatus === 'paid') return it;
          const paidLine: TableItem = { ...it, paymentStatus: 'paid' };
          paidItems!.push(paidLine);
          return paidLine;
        });
        return stampOrder({ ...o, items: newItems });
      });
      grossAmount = tableUnpaidTotal(table, recipes);
    } else if (p.mode === 'items') {
      paidItems = [];
      nextOrders = nextOrders.map((o) => {
        const sel = p.selections.get(o.id);
        if (!sel || sel.size === 0) return o;
        const newItems: TableItem[] = [];
        o.items.forEach((it, idx) => {
          const payQty = sel.get(idx) ?? 0;
          if (payQty <= 0 || it.paymentStatus === 'paid') {
            newItems.push(it);
            return;
          }
          const unit = recipeUnitLabel(it.recipeId, recipes);
          if (unit === 'kg' || payQty >= it.quantity) {
            const paidLine: TableItem = { ...it, paymentStatus: 'paid' };
            newItems.push(paidLine);
            paidItems!.push(paidLine);
          } else {
            // Split line: remaining (pending) + paid portion
            const remaining: TableItem = { ...it, quantity: it.quantity - payQty };
            const paidLine: TableItem = { ...it, quantity: payQty, paymentStatus: 'paid' };
            newItems.push(remaining, paidLine);
            paidItems!.push(paidLine);
          }
        });
        return stampOrder({ ...o, items: newItems });
      });
      grossAmount = paidItems.reduce((s, it) => s + itemLineTotal(it, recipes), 0);
    }
    // mode === 'amount' leaves orders untouched; the gross is whatever the
    // cashier typed before adjustments (i.e. p.grossAmount as-is).

    const tx: Transaction = {
      id: newId('tx'),
      tableId: table.id,
      amount: +p.amount.toFixed(2),
      grossAmount: +grossAmount.toFixed(2),
      paymentMethod: p.method,
      mode: p.mode,
      ...(p.discount && p.discount > 0 ? { discount: +p.discount.toFixed(2) } : {}),
      ...(p.rounding && p.rounding !== 0 ? { rounding: +p.rounding.toFixed(2) } : {}),
      ...(p.isPrepayment ? { isPrepayment: true } : {}),
      ...(paidItems !== undefined ? { items: paidItems } : {}),
      createdAt: now,
      createdBy: user?.uid,
      createdByName: userName,
    };

    const totalAfter = tableTotalFromOrders({ ...table, orders: nextOrders }, recipes);
    // Compare gross-paid against the bill so discounts close the table.
    const grossPaidAfter =
      (table.transactions ?? []).reduce(
        (s, t) => s + (t.grossAmount ?? t.amount ?? 0),
        0,
      ) + (tx.grossAmount ?? tx.amount);
    // Do not auto-close on pre-payment (no orders yet, totalAfter === 0)
    const fullyPaid = totalAfter > 0 && grossPaidAfter + 0.005 >= totalAfter;

    const next: Table = {
      ...table,
      orders: nextOrders,
      totalPrice: totalAfter,
      transactions: [...(table.transactions ?? []), tx],
      ...(fullyPaid
        ? { status: 'closed' as const, closedAt: new Date().toISOString(), paymentMethod: p.method }
        : {}),
    };

    try {
      await updateTable(next);
      setPaymentOpen(false);
      // Audit: payment recorded
      if (restaurantId && user) {
        recordAudit(restaurantId, user, {
          action: 'payment.record',
          entityId: tx.id,
          entityName: table.name,
          metadata: {
            tableId: table.id,
            tableName: table.name,
            amount: tx.amount,
            grossAmount: tx.grossAmount,
            paymentMethod: tx.paymentMethod,
            mode: tx.mode,
            discount: tx.discount,
            rounding: tx.rounding,
            isPrepayment: tx.isPrepayment,
            fullyPaid,
          },
          after: paidItems
            ? {
                items: paidItems.map((it) => ({
                  recipeId: it.recipeId,
                  productName: it.productSnapshot?.name ?? it.recipeId,
                  quantity: it.quantity,
                  price: it.price,
                })),
              }
            : undefined,
        });
      }
      if (fullyPaid) {
        deductTableStock(next);
        toastSuccess('Masa tamamen ödendi ve kapatıldı');
        handleClose();
      } else {
        const remaining = Math.max(0, totalAfter - grossPaidAfter);
        toastSuccess(`${formatCurrency(tx.amount)} tahsil edildi · Kalan ${formatCurrency(remaining)}`);
      }
    } catch (err) {
      console.error(err);
      toastError('Ödeme alınamadı');
    }
  });

  // Close a fully-settled table (pre-payment already covers the order total, no new transaction needed).
  const closeSettledTable = () => runExclusive(async () => {
    if (!table) return;
    const next: Table = {
      ...table,
      status: 'closed',
      closedAt: new Date().toISOString(),
    };
    try {
      await updateTable(next);
      // Audit: table closed via pre-payment settlement (no new transaction, but it's an implicit payment event)
      if (restaurantId && user) {
        recordAudit(restaurantId, user, {
          action: 'payment.record',
          entityId: `close_${table.id}_${Date.now()}`,
          entityName: table.name,
          metadata: {
            tableId: table.id,
            tableName: table.name,
            mode: 'settle_prepaid',
            totalPrice: table.totalPrice,
            fullyPaid: true,
          },
        });
      }
      deductTableStock(next);
      toastSuccess('Masa kapatıldı');
      handleClose();
    } catch (err) {
      console.error(err);
      toastError('Masa kapatılamadı');
    }
  });

  const handleDelete = async () => {
    if (!table) return;
    if ((table.orders?.length ?? 0) > 0) {
      toastError('Siparişi olan masa silinemez');
      return;
    }
    try {
      await deleteTable(table.id);
      handleClose();
    } catch (err) {
      console.error(err);
      toastError('Masa silinemedi');
    }
  };

  const saveTableName = async () => {
    if (!table) return;
    const name = newTableName.trim();
    if (!name) {
      toastError('Masa adı boş olamaz');
      return;
    }

    const isPersistedTable = tables.some((t) => t.id === table.id);
    const nextTable = { ...table, name };
    if (newTableGroup) {
      nextTable.group = newTableGroup;
    } else {
      delete nextTable.group;
    }

    try {
      if (!isPersistedTable) {
        await addTable(nextTable);
      } else {
        await updateTable(nextTable);
      }
      setEditingTableName(false);
      toastSuccess('Masa adı güncellendi');
    } catch (err) {
      console.error(err);
      toastError('Masa adı güncellenemedi');
    }
  };

  const handleReopen = async () => {
    if (!table) return;
    if (userProfile?.role !== 'admin') {
      toastError('Sadece adminler masa açabilir');
      return;
    }

    const isNameActive = tables.some((t) => t.status === 'active' && t.name === table.name && t.id !== table.id);
    if (isNameActive) {
      toastError(`Masa ${table.name} şu an aktif. Önce aktif masayı kapatınız.`);
      return;
    }

    setReopenConfirm(true);
  };

  const confirmReopen = () => runExclusive(async () => {
    if (!table) return;
    setReopenConfirm(false);

    const { closedAt, transactions, paymentMethod, ...rest } = table;
    const resetOrders = (table.orders || []).map((o) => ({
      ...o,
      items: o.items.map((i) => {
        const { paymentStatus, ...itemRest } = i;
        return { ...itemRest, paymentStatus: 'pending' as const };
      }),
    }));

    const tableToUpdate: Table = {
      ...rest,
      status: 'active',
      orders: resetOrders,
      transactions: [],
    };

    try {
      await updateTable(tableToUpdate);

      let warehouseToRestore = defaultWarehouseId || (warehouses.length > 0 ? warehouses[0].id : null);
      if (table.group) {
        const group = tableGroups.find((g) => g.id === table.group);
        if (group?.warehouseId) {
          warehouseToRestore = group.warehouseId;
        }
      }

      if (warehouseToRestore) {
        const allItems = (table.orders || []).flatMap((o) => o.items);
        const productQuantities: Record<string, number> = {};
        allItems.forEach((item) => {
          productQuantities[item.recipeId] = (productQuantities[item.recipeId] || 0) + item.quantity;
          if (item.selectedVariations) {
            item.selectedVariations.forEach((variation) => {
              if (variation.selectedProducts) {
                variation.selectedProducts.forEach((sel) => {
                  productQuantities[sel.productId] = (productQuantities[sel.productId] || 0) + item.quantity;
                });
              }
            });
          }
        });

        Object.entries(productQuantities).forEach(([productId, qty]) => {
          const stock = stocks.find(
            (s) => s.productId === productId && s.warehouseId === warehouseToRestore
          );
          if (stock) {
            updateStock({ ...stock, quantity: stock.quantity + qty });
            recordStockMovement({
              id: newId('sm'),
              warehouseId: warehouseToRestore,
              productId,
              quantityChange: qty,
              reason: 'manual',
              referenceId: table.id,
            });
          }
        });
      }

      toastSuccess('Masa tekrar açıldı');
    } catch (err) {
      console.error(err);
      toastError('Masa tekrar açılamadı');
    }
  });

  // ---------- hotkeys ----------
  useHotkeys(
    'enter',
    () => {
      if (edit) void handleSaveEdit();
      else if (basket.length > 0) void sendToKitchen();
    },
    { enableOnFormTags: false },
  );
  useHotkeys('p', () => void printCustomerBill(), { enableOnFormTags: false });
  useHotkeys('escape', () => {
    if (edit) cancelEdit();
    else handleClose();
  });

  if (!table) return <div className="empty-state">Yükleniyor…</div>;

  // ---- Read-only view for closed tables ----
  if (table.status === 'closed') {
    const closedTotal = tableTotalFromOrders(table, recipes);
    const txs = table.transactions ?? [];
    const closedPaid = txs.reduce((s, t) => s + t.amount, 0);
    const closedGross = txs.reduce((s, t) => s + (t.grossAmount ?? t.amount), 0);
    const totalDiscount = txs.reduce((s, t) => s + (t.discount ?? 0), 0);
    const totalRounding = txs.reduce((s, t) => s + (t.rounding ?? 0), 0);
    const cashTotal = txs
      .filter((t) => t.paymentMethod === 'cash')
      .reduce((s, t) => s + t.amount, 0);
    const cardTotal = txs
      .filter((t) => t.paymentMethod === 'credit_card')
      .reduce((s, t) => s + t.amount, 0);
    const canSeePrices = userProfile?.role === 'admin' || (staffPermissions?.canSeeHistoryPrices ?? true);
    const canSeeTotal = userProfile?.role === 'admin' || (staffPermissions?.canSeeHistoryTotal ?? true);
    const methodIcon = (m?: string) =>
      m === 'cash' ? '💵' : m === 'credit_card' ? '💳' : '•';
    const methodLabel = (m?: string) =>
      m === 'cash' ? 'Nakit' : m === 'credit_card' ? 'Kart' : '—';
    const modeLabel = (m?: string) =>
      m === 'all' ? 'Tümü' : m === 'items' ? 'Ürün seçimi' : m === 'amount' ? 'Tutar' : null;

    return (
      <div className="closed-table-view">
        {/* Header */}
        <div className="flex-row closed-table-header">
          <button className="btn small" onClick={() => onClose ? onClose() : navigate('/history')}>← Geri</button>
          <h2 style={{ margin: 0 }}>Masa {table.name}</h2>
          <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 12 }}>
            Kapalı
          </span>
          {userProfile?.role === 'admin' && (
            <button className="btn small outline" style={{ marginLeft: 8 }} onClick={handleReopen}>
              Masayı Tekrar Aç
            </button>
          )}
          {/* Top-line payment summary: show split if mixed, otherwise the single method. */}
          {cashTotal > 0 && cardTotal > 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              💵 {formatCurrency(cashTotal)} · 💳 {formatCurrency(cardTotal)}
            </span>
          ) : table.paymentMethod ? (
            <span className="muted" style={{ fontSize: 13 }}>
              {methodIcon(table.paymentMethod)} {methodLabel(table.paymentMethod)}
            </span>
          ) : null}
          {table.closedAt && (
            <span className="muted" style={{ fontSize: 13 }}>
              {new Date(table.closedAt).toLocaleString('tr-TR')}
            </span>
          )}
          <div className="spacer" />
          {canSeeTotal && (
            <span style={{ fontWeight: 700, fontSize: 18 }}>{formatCurrency(closedTotal)}</span>
          )}
        </div>

        {/* Orders */}
        <div className="closed-table-orders">
          {(table.orders ?? []).length === 0 ? (
            <div className="muted">Sipariş kaydı yok.</div>
          ) : (
            (table.orders ?? []).slice().reverse().map((o) => {
              const orderTotal = o.items.reduce((s, it) => s + itemLineTotal(it, recipesById), 0);
              return (
                <div key={o.id} className="order-block">
                  <div className="order-head">
                    <span>
                      {new Date(o.createdAt ?? 0).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                      {o.orderNumber ? ` • ${o.orderNumber}` : ''}
                    </span>
                    <span>{o.createdByName ?? ''}</span>
                  </div>
                  {o.items.map((it, i) => {
                    const unit = recipeUnitLabel(it.recipeId, recipesById);
                    const qty = unit === 'kg' ? `${(it.quantity * 1000).toFixed(0)}g` : `${it.quantity}x`;
                    return (
                      <div key={i} className={`order-item${it.paymentStatus === 'paid' ? ' paid' : ''}`}>
                        <div className="order-item-main">
                          <div>
                            <span className="order-item-name">{qty} {recipeName(it.recipeId, recipesById)}</span>
                          </div>
                          {it.selectedVariations && it.selectedVariations.length > 0 && (
                            <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                              {it.selectedVariations.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`).join(' | ')}
                            </div>
                          )}
                          {canSeePrices && (
                            <span className="order-item-price">{formatCurrency(itemLineTotal(it, recipesById))}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {canSeeTotal && (
                    <div className="order-foot">
                      <span className="muted">Sipariş toplamı</span>
                      <span className="spacer" />
                      <span className="order-foot-total">{formatCurrency(orderTotal)}</span>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Totals summary */}
        {canSeeTotal && (
          <div className="totals" style={{ maxWidth: 340 }}>
            <div className="row">
              <span>Masa toplam</span>
              <span>{formatCurrency(closedTotal)}</span>
            </div>
            {totalDiscount > 0 && (
              <div className="row">
                <span>İndirim</span>
                <span className="warn-text">−{formatCurrency(totalDiscount)}</span>
              </div>
            )}
            {totalRounding !== 0 && (
              <div className="row">
                <span>Yuvarlama</span>
                <span className={totalRounding > 0 ? 'ok-text' : 'warn-text'}>
                  {totalRounding > 0 ? '+' : '−'}{formatCurrency(Math.abs(totalRounding))}
                </span>
              </div>
            )}
            {cashTotal > 0 && (
              <div className="row">
                <span>💵 Nakit</span>
                <span className="ok-text">{formatCurrency(cashTotal)}</span>
              </div>
            )}
            {cardTotal > 0 && (
              <div className="row">
                <span>💳 Kart</span>
                <span className="ok-text">{formatCurrency(cardTotal)}</span>
              </div>
            )}
            <div className="row">
              <span>Tahsilat toplamı</span>
              <span className="ok-text">{formatCurrency(closedPaid)}</span>
            </div>
            <div className="row grand">
              <span>Kalan</span>
              <span>{formatCurrency(Math.max(0, closedTotal - closedGross))}</span>
            </div>
          </div>
        )}

        {/* Transaction history — every individual settlement on this table */}
        {canSeeTotal && txs.length > 0 && (
          <div className="closed-table-transactions" style={{ marginTop: 16 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 16 }}>Ödeme Kayıtları</h3>
            <div className="transaction-list">
              {txs
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .map((t) => {
                  const mLabel = modeLabel(t.mode);
                  const gross = t.grossAmount ?? t.amount;
                  const rawItemCount = (t.items ?? []).reduce((s, it) => s + it.quantity, 0);
                  const itemCount = Number(rawItemCount.toFixed(3));
                  return (
                    <div key={t.id} className="order-block">
                      <div className="order-head">
                        <span>
                          {methodIcon(t.paymentMethod)} {methodLabel(t.paymentMethod)}
                          {mLabel ? ` · ${mLabel}` : ''}
                          {t.isPrepayment ? ' · Ön ödeme' : ''}
                        </span>
                        <span>
                          {new Date(t.createdAt).toLocaleString('tr-TR')}
                          {t.createdByName ? ` · ${t.createdByName}` : ''}
                        </span>
                      </div>
                      <div className="order-item">
                        <div className="order-item-main">
                          <span className="order-item-name">Brüt</span>
                          <span className="order-item-price">{formatCurrency(gross)}</span>
                        </div>
                      </div>
                      {!!t.discount && t.discount > 0 && (
                        <div className="order-item">
                          <div className="order-item-main">
                            <span className="order-item-name warn-text">İndirim</span>
                            <span className="order-item-price warn-text">−{formatCurrency(t.discount)}</span>
                          </div>
                        </div>
                      )}
                      {!!t.rounding && t.rounding !== 0 && (
                        <div className="order-item">
                          <div className="order-item-main">
                            <span className="order-item-name">Yuvarlama</span>
                            <span className={`order-item-price ${t.rounding > 0 ? 'ok-text' : 'warn-text'}`}>
                              {t.rounding > 0 ? '+' : '−'}{formatCurrency(Math.abs(t.rounding))}
                            </span>
                          </div>
                        </div>
                      )}
                      {t.mode === 'items' && itemCount > 0 && (
                        <div className="order-item">
                          <div className="order-item-main">
                            <span className="order-item-name muted">
                              {itemCount} ürün ödendi
                              {(t.items ?? []).length > 0 && canSeePrices ? ': ' : ''}
                              {(t.items ?? [])
                                .map((it) => {
                                  const unit = recipeUnitLabel(it.recipeId, recipesById);
                                  const qty = unit === 'kg' ? `${(it.quantity * 1000).toFixed(0)}g` : `${it.quantity}x`;
                                  const varInfo = it.selectedVariations && it.selectedVariations.length > 0
                                    ? ` (${it.selectedVariations.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`).join(' | ')})`
                                    : '';
                                  return `${qty} ${recipeName(it.recipeId, recipesById)}${varInfo}`;
                                })
                                .join(', ')}
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="order-foot">
                        <span className="muted">Tahsilat</span>
                        <span className="spacer" />
                        <span className="order-foot-total">{formatCurrency(t.amount)}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        <ConfirmModal
          open={reopenConfirm}
          title="Masayı Tekrar Aç"
          message="Bu masa tekrar aktif edilecek. Ödeme işlemleri geri alınacak ve masa bakiyesi tekrar açık hale gelecek."
          confirmLabel="Tekrar Aç"
          onConfirm={() => void confirmReopen()}
          onCancel={() => setReopenConfirm(false)}
        />
      </div>
    );
  }

  const basketTotal = basket.reduce((s, it) => s + itemLineTotal(it, recipesById), 0);
  const tableTotal = tableTotalFromOrders(table, recipesById);
  const paid = (table.transactions ?? []).reduce((s, t) => s + t.amount, 0);
  const unpaid = Math.max(0, tableTotal - paid);

  const editTotal = edit ? edit.items.reduce((s, it) => s + itemLineTotal(it, recipesById), 0) : 0;
  const editOrigTotal = edit
    ? edit.items.reduce((s, it) => {
      const origQty = it._isNew ? 0 : (it._origQty ?? it.quantity);
      const unitPrice = itemPrice(it, recipes);
      return s + unitPrice * origQty;
    }, 0)
    : 0;
  const editDiff = editTotal - editOrigTotal;
  const editingOrder = edit ? (table.orders ?? []).find((o) => o.id === edit.orderId) ?? null : null;

  return (
    <div className="detail-split-3">
      <div className="detail-main">
        <div className="flex-row">
          <button className="btn small" onClick={handleClose}>← Geri</button>
          <h2 style={{ margin: 0 }}>Masa {table.name}</h2>
          {table.group && tableGroups.find((g) => g.id === table.group) && (
            <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              {tableGroups.find((g) => g.id === table.group)?.name}
            </span>
          )}

          <div className="spacer" />
          <button className="btn small" style={{ marginLeft: 8 }} onClick={() => { setNewTableName(table.name); setNewTableGroup(table.group ?? ''); setEditingTableName(true); }}>Düzenle</button>
          {canDelete && (table.orders?.length ?? 0) === 0 && (
            <button className="btn danger small" onClick={() => setConfirmDelete(true)}>Sil</button>
          )}
        </div>
        <ItemGrid recipes={recipes} categories={categories} onPick={handlePickRecipe} />
      </div>

      {/* Middle column — existing orders on this table */}
      <aside className="detail-orders">
        <div className="orders-section-head">
          <span>Masadaki Siparişler</span>
          <span className="muted">{(table.orders ?? []).length}</span>
        </div>
        <div className="orders-scroll">
          {(table.orders ?? []).length === 0 && <div className="muted">Henüz sipariş yok</div>}
          {(table.orders ?? []).slice().reverse().map((o) => {
            const isEditing = edit?.orderId === o.id;
            const orderTotal = o.items.reduce((s, it) => s + itemLineTotal(it, recipes), 0);
            const hasUnpaid = o.items.some((it) => it.paymentStatus !== 'paid');
            return (
              <div key={o.id} className={`order-block${isEditing ? ' editing' : ''}`}>
                <div className="order-head">
                  <span>
                    {new Date(o.createdAt ?? 0).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                    {o.orderNumber ? ` • ${o.orderNumber}` : ''}
                  </span>
                  <span>{o.createdByName ?? ''}</span>
                </div>
                {o.items.map((it, i) => {
                  const unit = recipeUnitLabel(it.recipeId, recipes);
                  const qty = unit === 'kg' ? `${(it.quantity * 1000).toFixed(0)}g` : `${it.quantity}x`;
                  const paidItem = it.paymentStatus === 'paid';
                  return (
                    <div key={i} className={`order-item${paidItem ? ' paid' : ''}`}>
                      <div className="order-item-main">
                        <div>
                          <span className="order-item-name">{qty} {recipeName(it.recipeId, recipes)}</span>
                        </div>
                        {it.selectedVariations && it.selectedVariations.length > 0 && (
                          <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                            {it.selectedVariations.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`).join(' | ')}
                          </div>
                        )}
                        <span className="order-item-price">{formatCurrency(itemLineTotal(it, recipes))}</span>
                      </div>
                      {paidItem && <span className="order-item-paid muted">ödendi</span>}
                    </div>
                  );
                })}
                <div className="order-foot">
                  <span className="muted">Toplam</span>
                  <span className="order-foot-total">{formatCurrency(orderTotal)}</span>
                  {canEditOrders && hasUnpaid && !isEditing && (
                    <button className="btn small" onClick={() => startEdit(o)}>Düzenle</button>
                  )}
                  {isEditing && <span className="badge editing-badge">DÜZENLENİYOR</span>}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right column — either the new-order basket OR the edit panel for the selected order */}
      <aside className="detail-side">
        {edit ? (
          <section className="basket-panel edit-panel">
            <header className="basket-panel-head">
              <span className="basket-panel-title">Sipariş Düzenle</span>
              <span className="basket-panel-badge edit">
                {editingOrder ? new Date(editingOrder.createdAt ?? 0).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <div className="spacer" />
              <button className="btn small" onClick={cancelEdit}>İptal (Esc)</button>
            </header>
            <div className="basket-list">
              {edit.items.length === 0 ? (
                <div className="basket-empty">Tüm ürünler kaldırıldı. Kaydederseniz bu sipariş silinir.</div>
              ) : (
                edit.items.map((it, idx) => {
                  const unit = recipeUnitLabel(it.recipeId, recipes);
                  const qtyDisplay = unit === 'kg' ? `${(it.quantity * 1000).toFixed(0)}g` : it.quantity;
                  const paidItem = it.paymentStatus === 'paid';
                  const locked = paidItem;
                  const increased = !it._isNew && typeof it._origQty === 'number' && it.quantity > it._origQty;
                  const decreased = !it._isNew && typeof it._origQty === 'number' && it.quantity < it._origQty;
                  return (
                    <div
                      key={idx}
                      className={`basket-row${it._isNew ? ' new' : ''}${increased ? ' increased' : ''}${decreased ? ' decreased' : ''}${locked ? ' locked' : ''}`}
                    >
                      <div className="qty-ctrl">
                        {unit !== 'kg' && !locked ? (
                          <>
                            <button
                              className="qty-btn"
                              onClick={() => editInc(idx, -1)}
                              title="Azalt"
                            >−</button>
                            <input
                              className="qty-input"
                              type="number"
                              min={1}
                              value={(it.quantity as any) === '' ? '' : it.quantity}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  setEditQty(idx, '');
                                } else {
                                  const v = parseInt(val, 10);
                                  if (!isNaN(v)) setEditQty(idx, v);
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value === '' || e.target.value === '0') {
                                  setEditQty(idx, 1);
                                }
                              }}
                            />
                            <button
                              className="qty-btn"
                              onClick={() => editInc(idx, 1)}
                              title="Artır"
                            >+</button>
                          </>
                        ) : (
                          <span className="qty">{qtyDisplay}</span>
                        )}
                      </div>
                      <div className="name">
                        {recipeName(it.recipeId, recipes)}
                        {it._isNew && <span className="row-tag new"> YENİ</span>}
                        {increased && <span className="row-tag inc"> +{it.quantity - (it._origQty ?? 0)}</span>}
                        {decreased && <span className="row-tag dec"> −{(it._origQty ?? 0) - it.quantity}</span>}
                        {locked && <span className="row-tag paid"> ödendi</span>}
                        {it.selectedVariations && it.selectedVariations.length > 0 && (
                          <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                            {it.selectedVariations.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`).join(' | ')}
                          </div>
                        )}
                      </div>
                      <div className="price">{formatCurrency(itemLineTotal(it, recipes))}</div>
                      {!locked && (canRemoveItems || it._isNew) && (
                        <button className="btn small danger" onClick={() => editRemove(idx)} title="Kaldır">×</button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="basket-panel-foot">
              <div className="basket-panel-subtotal">
                <span>Yeni Toplam</span>
                <span>{formatCurrency(editTotal)}</span>
              </div>
              <div className="basket-panel-subtotal small">
                <span className="muted">Fark</span>
                <span className={editDiff > 0 ? 'ok-text' : editDiff < 0 ? 'warn-text' : 'muted'}>
                  {editDiff > 0 ? '+' : ''}{formatCurrency(editDiff)}
                </span>
              </div>
              <button className="btn primary large block" disabled={busy} onClick={handleSaveEdit}>
                Kaydet &amp; Yeni Ürünleri Yazdır (Enter)
              </button>
            </div>
          </section>
        ) : (
          <section className="basket-panel">
            <header className="basket-panel-head">
              <span className="basket-panel-title">Yeni Sipariş</span>
              <span className="basket-panel-badge">{basket.length}</span>
            </header>
            <div className="basket-list">
              {basket.length === 0 ? (
                <div className="basket-empty">Ürün eklemek için soldaki listeden tıklayın.</div>
              ) : (
                basket.map((it, idx) => {
                  const unit = recipeUnitLabel(it.recipeId, recipes);
                  const qtyDisplay = unit === 'kg' ? `${(it.quantity * 1000).toFixed(0)}g` : it.quantity;
                  return (
                    <div key={idx} className="basket-row">
                      <div className="qty-ctrl">
                        {unit !== 'kg' ? (
                          <>
                            <button
                              className="qty-btn"
                              onClick={() => incBasket(idx, -1)}
                              title="Azalt"
                            >−</button>
                            <input
                              className="qty-input"
                              type="number"
                              min={1}
                              value={(it.quantity as any) === '' ? '' : it.quantity}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  setBasketQty(idx, '');
                                } else {
                                  const v = parseInt(val, 10);
                                  if (!isNaN(v)) setBasketQty(idx, v);
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value === '' || e.target.value === '0') {
                                  setBasketQty(idx, 1);
                                }
                              }}
                            />
                            <button
                              className="qty-btn"
                              onClick={() => incBasket(idx, 1)}
                              title="Artır"
                            >+</button>
                          </>
                        ) : (
                          <span className="qty">{qtyDisplay}</span>
                        )}
                      </div>
                      <div className="name">
                        <div>{recipeName(it.recipeId, recipes)}</div>
                        {it.selectedVariations && it.selectedVariations.length > 0 && (
                          <div className="muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
                            {it.selectedVariations.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`).join(' | ')}
                          </div>
                        )}
                      </div>
                      <div className="price">{formatCurrency(itemLineTotal(it, recipes))}</div>
                      <button className="btn small danger" onClick={() => incBasket(idx, -it.quantity)} title="Kaldır">×</button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="basket-panel-foot">
              <div className="basket-panel-subtotal">
                <span>Sepet Toplamı</span>
                <span>{formatCurrency(basketTotal)}</span>
              </div>
              <button className="btn primary large block" disabled={busy || basket.length === 0} onClick={sendToKitchen}>
                Onayla &amp; Mutfağa Gönder (Enter)
              </button>
            </div>
          </section>
        )}

        <div className="totals">
          <div className="row">
            <span>Masa toplam</span>
            <span>{formatCurrency(tableTotal)}</span>
          </div>
          {paid > 0 && (
            <div className="row">
              <span>Ödenen</span>
              <span className="ok-text">−{formatCurrency(paid)}</span>
            </div>
          )}
          <div className="row grand">
            <span>Kalan</span>
            <span>{formatCurrency(unpaid)}</span>
          </div>
        </div>

        <div className="flex-row">
          <button className="btn info" style={{ flex: 1 }} onClick={printCustomerBill} disabled={busy || !!edit}>
            Fiş Yazdır (P)
          </button>
        </div>
        <button
          className="btn warn large block"
          disabled={!!edit}
          onClick={() => {
            if (unpaid <= 0 && tableTotal > 0) setCloseSettledConfirm(true);
            else if (unpaid <= 0) setPrepayConfirm(true);
            else setPaymentOpen(true);
          }}
        >
          {unpaid <= 0 && tableTotal > 0 ? 'Hesabı Kapat' : 'Ödeme Al'}
        </button>
        {unpaid <= 0 && tableTotal > 0 && !edit && (
          <button
            className="btn small block"
            style={{ marginTop: 6 }}
            onClick={() => setPaymentOpen(true)}
          >
            + Ön Ödeme Ekle
          </button>
        )}
      </aside>

      <ConfirmModal
        open={!!weightModal}
        title={`${weightModal?.recipe.name ?? ''} — Ağırlık`}
        confirmLabel="Ekle"
        onConfirm={confirmWeight}
        onCancel={() => setWeightModal(null)}
      >
        <label className="label">Ağırlık (kg, örn: 0,452)</label>
        <input
          className="input"
          type="text"
          inputMode="decimal"
          autoFocus
          value={weightModal?.value ?? ''}
          onChange={(e) => setWeightModal((m) => (m ? { ...m, value: e.target.value } : m))}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmWeight(); }}
        />
        <div className="muted">
          Birim fiyat: {weightModal ? formatCurrency(weightModal.recipe.price) : ''} / kg
        </div>
      </ConfirmModal>

      <PaymentModal
        open={paymentOpen}
        table={table}
        recipes={recipesById}
        forcePrepayment={unpaid <= 0 && tableTotal > 0}
        onCancel={() => setPaymentOpen(false)}
        onConfirm={(p) => void takePayment(p)}
      />

      <ConfirmModal
        open={closeSettledConfirm}
        title="Hesabı Kapat"
        message={`Ön ödeme (${formatCurrency(paid)}) masa tutarını (${formatCurrency(tableTotal)}) karşılıyor. Ek ödeme almadan masayı kapatmak istiyor musunuz?`}
        confirmLabel="Evet, Kapat"
        onConfirm={() => {
          setCloseSettledConfirm(false);
          void closeSettledTable();
        }}
        onCancel={() => setCloseSettledConfirm(false)}
      />

      <ConfirmModal
        open={prepayConfirm}
        title="Ön Ödeme"
        message="Masada henüz sipariş yok. Müşteriden peşin / ön ödeme almak istediğinize emin misiniz?"
        confirmLabel="Evet, Ön Ödeme Al"
        onConfirm={() => { setPrepayConfirm(false); setPaymentOpen(true); }}
        onCancel={() => setPrepayConfirm(false)}
      />

      <ConfirmModal
        open={confirmDelete}
        title="Masayı sil"
        message="Bu masa ve tüm siparişleri silinecek. Bu işlem geri alınamaz."
        confirmLabel="Sil"
        destructive
        onConfirm={() => { setConfirmDelete(false); void handleDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        open={editingTableName}
        title="Masa Düzenle"
        confirmLabel="Kaydet"
        onConfirm={() => void saveTableName()}
        onCancel={() => setEditingTableName(false)}
      >
        <label className="label">Masa Adı</label>
        <input
          className="input"
          value={newTableName}
          onChange={(e) => setNewTableName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void saveTableName(); }}
          autoFocus
        />
        
        {tableGroups.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <label className="label">Grup</label>
            <select
              className="input"
              value={newTableGroup}
              onChange={(e) => setNewTableGroup(e.target.value)}
            >
              <option value="">— Grupsuz —</option>
              {tableGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
      </ConfirmModal>

      {variationModal && (
        <VariationModal
          recipe={variationModal.recipe}
          onConfirm={confirmVariation}
          onCancel={() => setVariationModal(null)}
        />
      )}

      <ConfirmModal
        open={!!removalReasonModal}
        title="Ürün Silme Sebebi"
        confirmLabel="Onayla &amp; Kaydet"
        confirmDisabled={!removalReasonModal?.reason.trim()}
        onConfirm={() => {
          const reason = removalReasonModal?.reason ?? '';
          setRemovalReasonModal(null);
          void saveEdit(reason);
        }}
        onCancel={() => setRemovalReasonModal(null)}
      >
        <p className="muted" style={{ marginBottom: 8 }}>
          ⚠️ Silinmiş ürünler bulundu, lütfen sebebini giriniz.
        </p>
        <textarea
          className="input"
          rows={3}
          autoFocus
          placeholder="Sebep giriniz..."
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          value={removalReasonModal?.reason ?? ''}
          onChange={(e) =>
            setRemovalReasonModal((m) => (m ? { ...m, reason: e.target.value } : m))
          }
        />
      </ConfirmModal>
    </div>
  );

};

// suppress unused-import warning if toast isn't used in some build
void toast;
