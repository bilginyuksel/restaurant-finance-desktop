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
  const { recipes, categories, user, addTable, warehouses, stocks, defaultWarehouseId, updateStock, recordStockMovement } = useFinance();
  const [basket, setBasket] = useState<TableItem[]>([]);
  const [weightModal, setWeightModal] = useState<{ recipe: Recipe; value: string, variations?: SelectedVariation[] } | null>(null);
  const [variationModal, setVariationModal] = useState<{ recipe: Recipe } | null>(null);
  const [paying, setPaying] = useState(false);
  const [splitPaymentModal, setSplitPaymentModal] = useState(false);
  const [cashAmount, setCashAmount] = useState<string>('');

  const total = basket.reduce((s, it) => s + itemLineTotal(it, recipes), 0);

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
  const deductStock = () => {
    const warehouseToDeduct = defaultWarehouseId || (warehouses.length > 0 ? warehouses[0].id : null);
    if (!warehouseToDeduct) return;

    const productQuantities = basket.reduce((acc, item) => {
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

  const pay = async (method: 'cash' | 'credit_card') => {
    if (basket.length === 0) return;
    setPaying(true);
    try {
      const { orderNumber } = await window.api.nextOrderNumber();
      const now = new Date().toISOString();
      const order = {
        id: newId(),
        orderNumber,
        items: basket.map((it) => ({
          ...it,
          paymentStatus: 'paid' as const,
          createdBy: user?.uid,
          createdByName: user?.displayName || user?.email || 'Unknown',
          createdAt: Date.now(),
        })),
        createdBy: user?.uid,
        createdByName: user?.displayName || user?.email || 'Unknown',
        createdAt: Date.now(),
      };
      const record: Table = {
        id: newId(),
        name: 'Peşin Satış',
        group: '__quick_sale__',
        status: 'closed',
        createdAt: now,
        closedAt: now,
        orders: [order],
        totalPrice: total,
        paymentMethod: method,
        transactions: [{
          id: newId(),
          tableId: '',
          amount: total,
          grossAmount: total,
          mode: 'all',
          paymentMethod: method,
          createdAt: Date.now(),
          createdBy: user?.uid,
        }],
      };
      // Save to Firestore first, then print
      await addTable(record);
      deductStock();

      const payload: ReceiptPayload = {
        kind: 'customer',
        restaurantName: 'HobiPark',
        tableName: 'Peşin Satış',
        timestamp: new Date().toLocaleString('tr-TR'),
        currency: CURRENCY,
        items: buildLineItems(basket, recipes),
        total,
        waiterName: user?.displayName || user?.email || undefined,
        orderNumber,
      };
      const res = await window.api.printCustomerBill(payload);
      if (res.ok) {
        toastSuccess('Ödeme alındı · Fiş yazdırıldı');
      } else {
        toastSuccess('Ödeme alındı');
        toastError(`Yazıcı: ${res.error}`);
      }
      setBasket([]);
    } catch (err) {
      console.error(err);
      toastError('Bir hata oluştu');
    } finally {
      setPaying(false);
    }
  };

  const paySplit = async (cashAmt: number, cardAmt: number) => {
    if (basket.length === 0) return;
    setPaying(true);
    try {
      const { orderNumber } = await window.api.nextOrderNumber();
      const now = new Date().toISOString();
      const order = {
        id: newId(),
        orderNumber,
        items: basket.map((it) => ({
          ...it,
          paymentStatus: 'paid' as const,
          createdBy: user?.uid,
          createdByName: user?.displayName || user?.email || 'Unknown',
          createdAt: Date.now(),
        })),
        createdBy: user?.uid,
        createdByName: user?.displayName || user?.email || 'Unknown',
        createdAt: Date.now(),
      };
      
      const transactions = [];
      if (cashAmt > 0) {
        transactions.push({
          id: newId(),
          tableId: '',
          amount: cashAmt,
          grossAmount: cashAmt,
          mode: 'amount' as const,
          paymentMethod: 'cash' as const,
          createdAt: Date.now(),
          createdBy: user?.uid,
        });
      }
      if (cardAmt > 0) {
        transactions.push({
          id: newId(),
          tableId: '',
          amount: cardAmt,
          grossAmount: cardAmt,
          mode: 'amount' as const,
          paymentMethod: 'credit_card' as const,
          createdAt: Date.now(),
          createdBy: user?.uid,
        });
      }

      const record: Table = {
        id: newId(),
        name: 'Peşin Satış',
        group: '__quick_sale__',
        status: 'closed',
        createdAt: now,
        closedAt: now,
        orders: [order],
        totalPrice: total,
        paymentMethod: 'cash',
        transactions,
      };
      // Save to Firestore first, then print
      await addTable(record);
      deductStock();

      const payload: ReceiptPayload = {
        kind: 'customer',
        restaurantName: 'HobiPark',
        tableName: 'Peşin Satış',
        timestamp: new Date().toLocaleString('tr-TR'),
        currency: CURRENCY,
        items: buildLineItems(basket, recipes),
        total,
        waiterName: user?.displayName || user?.email || undefined,
        orderNumber,
      };
      const res = await window.api.printCustomerBill(payload);
      if (res.ok) {
        toastSuccess('Ödeme alındı · Fiş yazdırıldı');
      } else {
        toastSuccess('Ödeme alındı');
        toastError(`Yazıcı: ${res.error}`);
      }
      setBasket([]);
      setSplitPaymentModal(false);
      setCashAmount('');
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

            <button
              className="btn primary large block"
              disabled={basket.length === 0 || paying}
              onClick={() => pay('cash')}
            >
              💵 Nakit Öde
            </button>
            <button
              className="btn info large block"
              disabled={basket.length === 0 || paying}
              onClick={() => pay('credit_card')}
            >
              💳 Kredi Kartı
            </button>
            <button
              className="btn warning large block"
              disabled={basket.length === 0 || paying}
              onClick={() => {
                setCashAmount('');
                setSplitPaymentModal(true);
              }}
              style={{ marginTop: 4 }}
            >
              🍕 Parçalı Öde
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

      {splitPaymentModal && (
        <div className="modal-backdrop" onClick={() => setSplitPaymentModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Parçalı Öde</h3>
            <div className="pay-summary" style={{ marginBottom: 16 }}>
              <span className="muted">Toplam Tutar: </span>
              <span className="pay-summary-amt" style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{formatCurrency(total)}</span>
            </div>
            
            <label className="label">Nakit Ödenen Tutar</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              max={total}
              autoFocus
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                   const cash = parseFloat(cashAmount);
                   if (cash > 0 && cash < total) {
                     const card = total - cash;
                     paySplit(cash, card);
                   }
                }
              }}
            />
            <div className="muted" style={{ marginTop: 8 }}>
              Kalan (Kredi Kartı): {formatCurrency(Math.max(0, total - (parseFloat(cashAmount) || 0)))}
            </div>

            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={() => setSplitPaymentModal(false)}>İptal</button>
              <button
                className="btn primary"
                disabled={!(parseFloat(cashAmount) > 0 && parseFloat(cashAmount) < total)}
                onClick={() => {
                   const cash = parseFloat(cashAmount);
                   const card = total - cash;
                   paySplit(cash, card);
                }}
              >
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
