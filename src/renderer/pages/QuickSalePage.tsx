import React, { useState } from 'react';
import { useFinance } from '../context/FinanceContext';
import { ItemGrid } from '../components/ItemGrid';
import { ConfirmModal } from '../components/ConfirmModal';
import { toastError, toastSuccess } from '../components/Toast';
import { Recipe, Table, TableItem, SelectedVariation } from '../../shared/types';
import { VariationModal } from '../components/VariationModal';

const variationsKey = (v?: SelectedVariation[]) => {
  if (!v || v.length === 0) return '';
  const sorted = [...v].sort((a, b) => a.groupId.localeCompare(b.groupId)).map(x => ({
    ...x,
    optionIds: [...x.optionIds].sort()
  }));
  return JSON.stringify(sorted);
};
import { formatCurrency, CURRENCY } from '../utils/currency';
import { itemLineTotal, itemPrice, recipeUnitLabel, tableTotalFromOrders } from '../utils/totals';
import { useNavigate } from 'react-router-dom';
import { PaymentModal, PaymentPayload } from '../components/PaymentModal';
import { ReceiptLineItem, ReceiptPayload } from '../../shared/receipt';

const newId = () => `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const recipeName = (id: string, recipes: Recipe[]) =>
  recipes.find((r) => r.id === id)?.name ?? id;

const buildLineItems = (basket: TableItem[], recipes: Recipe[]): ReceiptLineItem[] =>
  basket.map((it) => ({
    name: recipeName(it.recipeId, recipes),
    quantity:
      recipeUnitLabel(it.recipeId, recipes) === 'kg'
        ? +(it.quantity * 1000).toFixed(0)
        : it.quantity,
    unitLabel: recipeUnitLabel(it.recipeId, recipes) === 'kg' ? 'g' : undefined,
    unitPrice: itemPrice(it, recipes),
    lineTotal: itemLineTotal(it, recipes),
    variations: it.selectedVariations?.map(sv => `${sv.groupLabel}: ${sv.optionNames.join(', ')}`),
  }));

export const QuickSalePage: React.FC = () => {
  const { recipes, categories, user, addTable, warehouses, stocks, defaultWarehouseId, updateStock, recordStockMovement, tableGroups } = useFinance();
  const [basket, setBasket] = useState<TableItem[]>([]);
  const [weightModal, setWeightModal] = useState<{ recipe: Recipe; value: string, variations?: SelectedVariation[] } | null>(null);
  const [variationModal, setVariationModal] = useState<{ recipe: Recipe } | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const navigate = useNavigate();
  const [selectedTableGroup, setSelectedTableGroup] = useState<string>("");

  const total = basket.reduce((s, it) => s + itemLineTotal(it, recipes), 0);

  // ---- kitchen ticket ----
  const printKitchenTicket = async (items: TableItem[], orderNumber?: string) => {
    if (items.length === 0) return;

    let routing: Record<string, string> = {};
    try {
      routing = await window.api.getCategoryRouting();
    } catch {
      routing = {};
    }

    // Group items by destination printer (same logic as TableDetailPage).
    const groups = new Map<string, TableItem[]>();
    for (const it of items) {
      const recipe = recipes.find((r) => r.id === it.recipeId);
      const cat = recipe?.category ?? '';
      const dest = routing[cat] ?? '';
      if (dest === '__skip__') continue;
      const arr = groups.get(dest) ?? [];
      arr.push(it);
      groups.set(dest, arr);
    }

    const timestamp = new Date().toLocaleString('tr-TR');
    const waiterName = user?.displayName || user?.email || undefined;

    for (const [dest, groupItems] of groups) {
      const payload: ReceiptPayload = {
        kind: 'kitchen',
        tableName: 'Peşin Satış',
        timestamp,
        currency: CURRENCY,
        items: buildLineItems(groupItems, recipes),
        total: groupItems.reduce((s, it) => s + itemLineTotal(it, recipes), 0),
        waiterName,
        orderNumber,
      };
      const res = dest
        ? await window.api.printKitchenTo(dest, payload)
        : await window.api.printKitchenTicket(payload);
      if (!res.ok) console.error(`Mutfak yazıcı (${dest || 'mutfak'}): ${res.error}`);
    }
  };

  // ---- basket helpers ----
  const addToBasket = (recipe: Recipe, qty: number, selectedVariations?: SelectedVariation[]) => {
    setBasket((b) => {
      if (recipe.pricingType === 'by_weight') {
        return [
          ...b,
          { recipeId: recipe.id, quantity: qty, price: recipe.price, productSnapshot: recipe, selectedVariations },
        ];
      }
      const vKey = variationsKey(selectedVariations);
      const idx = b.findIndex((it) => it.recipeId === recipe.id && variationsKey(it.selectedVariations) === vKey);
      if (idx >= 0) {
        const copy = [...b];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
        return copy;
      }
      return [...b, { recipeId: recipe.id, quantity: qty, price: recipe.price, productSnapshot: recipe, selectedVariations }];
    });
  };

  const incBasket = (idx: number, delta: number) => {
    setBasket((b) => {
      const copy = [...b];
      const next = (copy[idx].quantity ?? 0) + delta;
      if (next <= 0) copy.splice(idx, 1);
      else copy[idx] = { ...copy[idx], quantity: next };
      return copy;
    });
  };

  const handlePickRecipe = (recipe: Recipe) => {
    if (recipe.variationGroups && recipe.variationGroups.length > 0) {
      setVariationModal({ recipe });
      return;
    }
    if (recipe.pricingType === 'by_weight') {
      setWeightModal({ recipe, value: '' });
      return;
    }
    addToBasket(recipe, 1);
  };

  const confirmVariation = (variations: SelectedVariation[]) => {
    if (!variationModal) return;
    const { recipe } = variationModal;
    setVariationModal(null);
    if (recipe.pricingType === 'by_weight') {
      setWeightModal({ recipe, value: '', variations });
      return;
    }
    addToBasket(recipe, 1, variations);
  };

  const confirmWeight = () => {
    if (!weightModal) return;
    const kg = parseFloat(weightModal.value.replace(',', '.'));
    if (!kg || kg <= 0) {
      toastError('Geçerli bir ağırlık girin (kg, örn: 0,452)');
      return;
    }
    addToBasket(weightModal.recipe, kg, weightModal.variations);
    setWeightModal(null);
  };

  // ---- payment ----
  const deductStock = (items: TableItem[]) => {
    const warehouseToDeduct = defaultWarehouseId || (warehouses.length > 0 ? warehouses[0].id : null);
    if (!warehouseToDeduct) return;

    const productQuantities = items.reduce((acc, item) => {
      acc[item.recipeId] = (acc[item.recipeId] || 0) + item.quantity;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(productQuantities).forEach(([productId, qty]) => {
      const stock = stocks.find((s) => s.productId === productId && s.warehouseId === warehouseToDeduct);
      if (stock) {
        updateStock({ ...stock, quantity: stock.quantity - qty });
        recordStockMovement({
          id: newId(),
          warehouseId: warehouseToDeduct,
          productId,
          quantityChange: -qty,
          reason: 'sale',
          referenceId: 'quick_sale',
        });
      }
    });
  };

  const dummyTable = React.useMemo<Table>(() => {
    return {
      id: 'dummy_qs',
      name: 'Peşin Satış',
      group: selectedTableGroup,
      status: 'active',
      createdAt: new Date().toISOString(),
      orders: [
        {
          id: 'dummy_order',
          orderNumber: '0',
          items: basket.map((it) => ({
            ...it,
            paymentStatus: 'pending',
            createdBy: user?.uid,
            createdByName: user?.displayName || user?.email || 'Unknown',
            createdAt: Date.now(),
          })),
          createdBy: user?.uid,
          createdByName: user?.displayName || user?.email || 'Unknown',
          createdAt: Date.now(),
        }
      ],
      totalPrice: total,
      transactions: [],
    };
  }, [basket, selectedTableGroup, total, user]);

  const takePayment = async (p: PaymentPayload) => {
    if (basket.length === 0 || !selectedTableGroup) return;
    setPaymentModalOpen(false);
    setPaying(true);

    try {
      const { orderNumber } = await window.api.nextOrderNumber();
      const now = new Date().toISOString();
      const userName = user?.displayName || user?.email || 'Unknown';

      // Transform dummy order with real order number
      let nextOrders = [{
        ...dummyTable.orders![0],
        orderNumber,
      }];
      
      let paidItems: TableItem[] = [];
      let grossAmount = p.grossAmount;

      if (p.mode === 'all') {
        nextOrders = nextOrders.map((o) => {
          return {
            ...o,
            items: o.items.map((it) => {
              const paidLine: TableItem = { ...it, paymentStatus: 'paid' };
              paidItems.push(paidLine);
              return paidLine;
            })
          };
        });
        grossAmount = total;
      } else if (p.mode === 'items') {
        nextOrders = nextOrders.map((o) => {
          const sel = p.selections.get(o.id);
          if (!sel || sel.size === 0) return o;
          const newItems: TableItem[] = [];
          o.items.forEach((it, idx) => {
            const payQty = sel.get(idx) ?? 0;
            if (payQty <= 0) {
              newItems.push(it);
              return;
            }
            const unit = recipeUnitLabel(it.recipeId, recipes);
            if (unit === 'kg' || payQty >= it.quantity) {
              const paidLine: TableItem = { ...it, paymentStatus: 'paid' };
              newItems.push(paidLine);
              paidItems.push(paidLine);
            } else {
              const remaining: TableItem = { ...it, quantity: it.quantity - payQty };
              const paidLine: TableItem = { ...it, quantity: payQty, paymentStatus: 'paid' };
              newItems.push(remaining, paidLine);
              paidItems.push(paidLine);
            }
          });
          return { ...o, items: newItems };
        });
        grossAmount = paidItems.reduce((s, it) => s + itemLineTotal(it, recipes), 0);
      }

      const tx = {
        id: newId(),
        tableId: '', // placeholder, assigned below
        amount: +p.amount.toFixed(2),
        grossAmount: +grossAmount.toFixed(2),
        paymentMethod: p.method,
        mode: p.mode,
        ...(p.discount && p.discount > 0 ? { discount: +p.discount.toFixed(2) } : {}),
        ...(p.rounding && p.rounding !== 0 ? { rounding: +p.rounding.toFixed(2) } : {}),
        ...(p.isPrepayment ? { isPrepayment: true } : {}),
        ...(paidItems.length > 0 ? { items: paidItems } : {}),
        createdAt: Date.now(),
        createdBy: user?.uid,
        createdByName: userName,
      };

      const tableTotal = tableTotalFromOrders({ ...dummyTable, orders: nextOrders }, recipes);
      const fullyPaid = tableTotal > 0 && tx.grossAmount + 0.005 >= tableTotal;
      const tableId = newId();
      tx.tableId = tableId;

      const record: Table = {
        id: tableId,
        name: 'Peşin Satış',
        group: selectedTableGroup,
        status: fullyPaid ? 'closed' : 'active',
        createdAt: now,
        closedAt: fullyPaid ? now : undefined,
        orders: nextOrders,
        totalPrice: tableTotal,
        paymentMethod: fullyPaid ? p.method : undefined,
        transactions: [tx],
      };

      await addTable(record);

      // Kitchen ticket reflects everything ordered, so it prints for both
      // full and partial payments.
      void printKitchenTicket(basket, orderNumber);

      if (fullyPaid) {
        deductStock(basket);
        const payload = {
          kind: 'customer' as const,
          restaurantName: 'HobiPark',
          tableName: 'Peşin Satış',
          timestamp: new Date().toLocaleString('tr-TR'),
          currency: CURRENCY,
          items: buildLineItems(basket, recipes),
          total: tableTotal,
          waiterName: userName,
          orderNumber,
        };
        const billRes = await window.api.printCustomerBill(payload);
        if (billRes.ok) {
          toastSuccess('Ödeme alındı · Fiş yazdırıldı');
        } else {
          toastSuccess('Ödeme alındı');
          toastError(`Yazıcı: ${billRes.error}`);
        }
        setBasket([]);
      } else {
        toastSuccess(`${formatCurrency(tx.amount)} tahsil edildi. Kalan tutar için masa açıldı.`);
        navigate(`/table/${tableId}`);
      }
    } catch (err) {
      console.error(err);
      toastError('Bir hata oluştu');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="detail-split" style={{ height: '100%' }}>
      {/* Left — item picker */}
      <div className="detail-main">
        <div className="flex-row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Peşin Satış</h2>
        </div>
        <ItemGrid recipes={recipes} categories={categories} onPick={handlePickRecipe} />
      </div>

      {/* Right — basket + payment */}
      <aside className="detail-side">
        <section className="basket-panel" style={{ flex: 1 }}>
          <header className="basket-panel-head">
            <span className="basket-panel-title">Sepet</span>
            <span className="basket-panel-badge">{basket.length}</span>
          </header>

          <div className="basket-list">
            {basket.length === 0 ? (
              <div className="basket-empty">Ürün eklemek için soldaki listeden tıklayın.</div>
            ) : (
              basket.map((it, idx) => {
                const unit = recipeUnitLabel(it.recipeId, recipes);
                const qtyDisplay =
                  unit === 'kg' ? `${(it.quantity * 1000).toFixed(0)}g` : it.quantity;
                return (
                  <div key={idx} className="basket-row">
                    <div className="qty-ctrl">
                      {unit !== 'kg' ? (
                        <>
                          <button onClick={() => incBasket(idx, -1)}>−</button>
                          <span className="qty">{qtyDisplay}</span>
                          <button onClick={() => incBasket(idx, +1)}>+</button>
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
                    {unit === 'kg' && (
                      <button
                        className="btn small danger"
                        onClick={() => incBasket(idx, -it.quantity)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="basket-panel-foot">
            <div className="basket-panel-subtotal">
              <span>Toplam</span>
              <span>{formatCurrency(total)}</span>
            </div>

            {/* Table Group Selection */}
            <div style={{ marginBottom: 8 }}>
              <label className="label" htmlFor="table-group-select">Masa Grubu Seçimi <span style={{color:'red'}}>*</span></label>
              <select
                id="table-group-select"
                className="input"
                value={selectedTableGroup}
                onChange={e => setSelectedTableGroup(e.target.value)}
              >
                <option value="">-- Masa Grubu Seçin --</option>
                {tableGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            <button
              className="btn primary large block"
              disabled={basket.length === 0 || paying || !selectedTableGroup}
              onClick={() => setPaymentModalOpen(true)}
            >
              💵 Ödeme Al
            </button>
            <button
              className="btn small block"
              disabled={basket.length === 0}
              onClick={() => setBasket([])}
              style={{ marginTop: 4 }}
            >
              Sepeti Temizle
            </button>
          </div>
        </section>
      </aside>

      {/* Weight input modal */}
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
          onChange={(e) =>
            setWeightModal((m) => (m ? { ...m, value: e.target.value } : m))
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmWeight();
          }}
        />
        <div className="muted">
          Birim fiyat: {weightModal ? formatCurrency(weightModal.recipe.price) : ''} / kg
        </div>
      </ConfirmModal>

      {variationModal && (
        <VariationModal
          recipe={variationModal.recipe}
          onConfirm={confirmVariation}
          onCancel={() => setVariationModal(null)}
        />
      )}

      {paymentModalOpen && (
        <PaymentModal
          open={paymentModalOpen}
          table={dummyTable}
          recipes={recipes}
          onConfirm={(p) => void takePayment(p)}
          onCancel={() => setPaymentModalOpen(false)}
        />
      )}
    </div>
  );
};
