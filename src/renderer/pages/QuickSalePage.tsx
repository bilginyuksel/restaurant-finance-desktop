import React, { useState } from 'react';
import { useFinance } from '../context/FinanceContext';
import { ItemGrid } from '../components/ItemGrid';
import { ConfirmModal } from '../components/ConfirmModal';
import { toastError, toastSuccess } from '../components/Toast';
import { Recipe, Table, TableItem } from '../../shared/types';
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
  }));

export const QuickSalePage: React.FC = () => {
  const { recipes, categories, user, addTable } = useFinance();
  const [basket, setBasket] = useState<TableItem[]>([]);
  const [weightModal, setWeightModal] = useState<{ recipe: Recipe; value: string } | null>(null);
  const [paying, setPaying] = useState(false);

  const total = basket.reduce((s, it) => s + itemLineTotal(it, recipes), 0);

  // ---- basket helpers ----
  const addToBasket = (recipe: Recipe, qty: number) => {
    setBasket((b) => {
      if (recipe.pricingType === 'by_weight') {
        return [
          ...b,
          { recipeId: recipe.id, quantity: qty, price: recipe.price, productSnapshot: recipe },
        ];
      }
      const idx = b.findIndex((it) => it.recipeId === recipe.id);
      if (idx >= 0) {
        const copy = [...b];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + qty };
        return copy;
      }
      return [...b, { recipeId: recipe.id, quantity: qty, price: recipe.price, productSnapshot: recipe }];
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
    if (recipe.pricingType === 'by_weight') {
      setWeightModal({ recipe, value: '' });
      return;
    }
    addToBasket(recipe, 1);
  };

  const confirmWeight = () => {
    if (!weightModal) return;
    const kg = parseFloat(weightModal.value.replace(',', '.'));
    if (!kg || kg <= 0) {
      toastError('Geçerli bir ağırlık girin (kg, örn: 0,452)');
      return;
    }
    addToBasket(weightModal.recipe, kg);
    setWeightModal(null);
  };

  // ---- payment ----
  const pay = async (method: 'cash' | 'credit_card') => {
    if (basket.length === 0) return;
    setPaying(true);
    try {
      const now = new Date().toISOString();
      const order = {
        id: newId(),
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

      const payload: ReceiptPayload = {
        kind: 'customer',
        restaurantName: 'HobiPark',
        tableName: 'Peşin Satış',
        timestamp: new Date().toLocaleString('tr-TR'),
        currency: CURRENCY,
        items: buildLineItems(basket, recipes),
        total,
        waiterName: user?.displayName || user?.email || undefined,
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
                    <div className="name">{recipeName(it.recipeId, recipes)}</div>
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
    </div>
  );
};
