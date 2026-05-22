import React, { useEffect, useMemo, useState } from 'react';
import { PaymentMode, Recipe, Table } from '../../shared/types';
import { formatCurrency } from '../utils/currency';
import { itemLineTotal, itemPrice, recipeName, recipeUnitLabel, tableTotalFromOrders } from '../utils/totals';

export type PaymentMethod = 'cash' | 'credit_card';
export type { PaymentMode };

// orderId -> (itemIndex -> qty to pay)
export type ItemSelections = Map<string, Map<number, number>>;

export type DiscountType = 'fixed' | 'percent';

export interface PaymentPayload {
  method: PaymentMethod;
  mode: PaymentMode;
  /** Actual money to collect (post-discount, post-rounding). */
  amount: number;
  /** Nominal bill portion being settled (pre-discount, pre-rounding). */
  grossAmount: number;
  selections: ItemSelections;
  discount?: number;
  rounding?: number;
  isPrepayment?: boolean;
}

interface Props {
  open: boolean;
  table: Table;
  recipes: ReadonlyMap<string, Recipe> | Recipe[];
  forcePrepayment?: boolean;
  onConfirm: (payload: PaymentPayload) => void;
  onCancel: () => void;
}

const cloneSelections = (s: ItemSelections): ItemSelections => {
  const out: ItemSelections = new Map();
  s.forEach((m, k) => out.set(k, new Map(m)));
  return out;
};

export const PaymentModal: React.FC<Props> = ({ open, table, recipes, forcePrepayment, onConfirm, onCancel }) => {
  // Sum prior settlements at *gross* value so discounts on past transactions
  // still count toward closing the bill. Falls back to `amount` for legacy
  // transactions that predate the grossAmount field.
  const totalPaid = (table.transactions ?? []).reduce(
    (s, t) => s + (t.grossAmount ?? t.amount ?? 0),
    0,
  );
  const unpaidTotal = useMemo(
    () => Math.max(0, tableTotalFromOrders(table, recipes) - totalPaid),
    [table, recipes, totalPaid],
  );
  const tableTotal = useMemo(() => tableTotalFromOrders(table, recipes), [table, recipes]);
  const isPrepayment = forcePrepayment || tableTotal === 0;

  const [method, setMethod] = useState<PaymentMethod>('credit_card');
  const [mode, setMode] = useState<PaymentMode>('all');
  const [amount, setAmount] = useState<string>('');
  const [selections, setSelections] = useState<ItemSelections>(new Map());
  // Raw input strings for kg items keyed by "orderId-idx"
  const [kgInputs, setKgInputs] = useState<Map<string, string>>(new Map());
  const [discount, setDiscount] = useState<string>('');
  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [roundingEnabled, setRoundingEnabled] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset on each open
    setMethod('credit_card');
    setMode(isPrepayment ? 'amount' : 'all');
    setAmount(unpaidTotal > 0 ? unpaidTotal.toFixed(2) : '');
    setSelections(new Map());
    setKgInputs(new Map());
    setDiscount('');
    setDiscountType('fixed');
    setRoundingEnabled(false);
  }, [open, unpaidTotal, isPrepayment]);

  const setSel = (orderId: string, idx: number, qty: number) => {
    setSelections((prev) => {
      const next = cloneSelections(prev);
      const inner = next.get(orderId) ?? new Map<number, number>();
      if (qty <= 0) inner.delete(idx);
      else inner.set(idx, qty);
      if (inner.size === 0) next.delete(orderId);
      else next.set(orderId, inner);
      return next;
    });
  };

  const itemsSelectedTotal = useMemo(() => {
    if (mode !== 'items') return 0;
    let sum = 0;
    selections.forEach((inner, orderId) => {
      const order = (table.orders ?? []).find((o) => o.id === orderId);
      if (!order) return;
      inner.forEach((qty, idx) => {
        const it = order.items[idx];
        if (!it) return;
        sum += itemPrice(it, recipes) * qty;
      });
    });
    return sum;
  }, [mode, selections, table, recipes]);

  if (!open) return null;

  // Compute confirm-button state per mode
  const amountNum = parseFloat(amount);
  let confirmEnabled = false;
  let confirmAmount = 0;
  if (isPrepayment) {
    confirmEnabled = !isNaN(amountNum) && amountNum > 0;
    confirmAmount = isNaN(amountNum) ? 0 : amountNum;
  } else if (mode === 'all') {
    confirmEnabled = unpaidTotal > 0;
    confirmAmount = unpaidTotal;
  } else if (mode === 'amount') {
    confirmEnabled = !isNaN(amountNum) && amountNum > 0 && amountNum <= unpaidTotal + 0.001;
    confirmAmount = isNaN(amountNum) ? 0 : amountNum;
  } else {
    confirmEnabled = itemsSelectedTotal > 0;
    confirmAmount = itemsSelectedTotal;
  }

  // Apply discount
  const discountNum = parseFloat(discount);
  const discountAmount =
    !isNaN(discountNum) && discountNum > 0
      ? discountType === 'percent'
        ? Math.min(confirmAmount * (discountNum / 100), confirmAmount)
        : Math.min(discountNum, confirmAmount)
      : 0;
  const afterDiscount = confirmAmount - discountAmount;

  // Apply rounding
  const roundedAmount = roundingEnabled ? Math.round(afterDiscount) : afterDiscount;
  const roundingDelta = roundedAmount - afterDiscount;
  const finalAmount = Math.max(0, roundedAmount);

  const handleConfirm = () => {
    if (!confirmEnabled) return;
    onConfirm({
      method,
      mode,
      amount: finalAmount,
      grossAmount: confirmAmount,
      selections,
      discount: discountAmount > 0 ? discountAmount : undefined,
      rounding: roundingDelta !== 0 ? roundingDelta : undefined,
      isPrepayment: isPrepayment || undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <h3>Ödeme Al · Masa {table.name}</h3>

        {isPrepayment && (
          <div className="prepay-warning">
            ⚠️ Masada henüz sipariş yok. Bu işlem bir <strong>ön ödeme / peşinat</strong> olarak kaydedilecek.
          </div>
        )}

        <div className="pay-summary">
          <span className="muted">Kalan Tutar</span>
          <span className="pay-summary-amt">{formatCurrency(unpaidTotal)}</span>
        </div>

        {/* Payment method toggle */}
        <div className="pay-toggle">
          <button
            className={`pay-toggle-btn${method === 'credit_card' ? ' active' : ''}`}
            onClick={() => setMethod('credit_card')}
          >Kart</button>
          <button
            className={`pay-toggle-btn${method === 'cash' ? ' active' : ''}`}
            onClick={() => setMethod('cash')}
          >Nakit</button>
        </div>

        {/* Mode toggle — hidden in pre-payment since only 'amount' makes sense */}
        {!isPrepayment && (
        <div className="pay-toggle">
          <button
            className={`pay-toggle-btn${mode === 'all' ? ' active' : ''}`}
            onClick={() => setMode('all')}
          >Tümünü Öde</button>
          <button
            className={`pay-toggle-btn${mode === 'amount' ? ' active' : ''}`}
            onClick={() => setMode('amount')}
          >Tutar Gir</button>
          <button
            className={`pay-toggle-btn${mode === 'items' ? ' active' : ''}`}
            onClick={() => setMode('items')}
          >Ürün Seç</button>
        </div>
        )}

        {/* Mode body */}
        {mode === 'all' && (
          <div className="pay-body">
            <div className="muted">Masadaki tüm ödenmemiş ürünler ödenecek olarak işaretlenecek.</div>
          </div>
        )}

        {mode === 'amount' && (
          <div className="pay-body">
            <label className="label">Tahsil edilecek tutar</label>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              max={isPrepayment ? undefined : unpaidTotal}
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
            />
            {!isPrepayment && (
            <div className="pay-quick">
              {[unpaidTotal, unpaidTotal / 2, 50, 100, 200, 500].map((v, i) => {
                const val = +v.toFixed(2);
                if (val <= 0 || val > unpaidTotal) return null;
                return (
                  <button
                    key={i}
                    type="button"
                    className="btn small"
                    onClick={() => setAmount(val.toFixed(2))}
                  >{formatCurrency(val)}</button>
                );
              })}
            </div>
            )}
          </div>
        )}

        {mode === 'items' && (
          <div className="pay-body pay-items">
            {(table.orders ?? []).length === 0 && <div className="muted">Sipariş yok</div>}
            {(table.orders ?? []).map((o) => {
              const pending = o.items
                .map((it, idx) => ({ it, idx }))
                .filter(({ it }) => it.paymentStatus !== 'paid');
              if (pending.length === 0) return null;
              return (
                <div key={o.id} className="pay-order">
                  <div className="pay-order-head">
                    {new Date(o.createdAt ?? 0).toLocaleTimeString('tr-TR')} · {o.createdByName ?? ''}
                  </div>
                  {pending.map(({ it, idx }) => {
                    const unit = recipeUnitLabel(it.recipeId, recipes);
                    const isKg = unit === 'kg';
                    const sel = selections.get(o.id)?.get(idx) ?? 0;
                    const lineTotal = itemPrice(it, recipes) * sel;
                    const fullTotal = itemLineTotal(it, recipes);
                    const allSelected = sel === it.quantity;
                    return (
                      <div key={idx} className={`pay-item${sel > 0 ? ' selected' : ''}`}>
                        <label className="pay-item-check">
                          <input
                            type="checkbox"
                            checked={sel > 0}
                            onChange={(e) => {
                              if (isKg) {
                                const key = `${o.id}-${idx}`;
                                if (e.target.checked) {
                                  const qtyStr = it.quantity.toString().replace('.', ',');
                                  setKgInputs((prev) => new Map(prev).set(key, qtyStr));
                                  setSel(o.id, idx, it.quantity);
                                } else {
                                  setKgInputs((prev) => { const m = new Map(prev); m.delete(key); return m; });
                                  setSel(o.id, idx, 0);
                                }
                              } else {
                                setSel(o.id, idx, e.target.checked ? it.quantity : 0);
                              }
                            }}
                          />
                        </label>
                        <div className="pay-item-name">{recipeName(it.recipeId, recipes)}</div>
                        <div className="pay-item-qty">
                          {isKg ? (
                            <input
                              className="input small"
                              type="text"
                              inputMode="decimal"
                              placeholder={`0 / ${(it.quantity * 1000).toFixed(0)}g`}
                              value={kgInputs.get(`${o.id}-${idx}`) ?? ''}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const key = `${o.id}-${idx}`;
                                setKgInputs((prev) => new Map(prev).set(key, raw));
                                const parsed = parseFloat(raw.replace(',', '.'));
                                if (!isNaN(parsed) && parsed > 0) {
                                  setSel(o.id, idx, Math.min(parsed, it.quantity));
                                } else {
                                  setSel(o.id, idx, 0);
                                }
                              }}
                            />
                          ) : (
                            <div className="qty-ctrl small">
                              <button
                                type="button"
                                onClick={() => setSel(o.id, idx, Math.max(0, sel - 1))}
                                disabled={sel <= 0}
                              >−</button>
                              <span className="qty">{sel} / {it.quantity}</span>
                              <button
                                type="button"
                                onClick={() => setSel(o.id, idx, Math.min(it.quantity, sel + 1))}
                                disabled={allSelected}
                              >+</button>
                            </div>
                          )}
                        </div>
                        <div className="pay-item-price">
                          {sel > 0 ? formatCurrency(lineTotal) : <span className="muted">{formatCurrency(fullTotal)}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Discount & Rounding */}
        <div className="pay-adjustment">
          <div className="pay-adj-row">
            <label className="label">İndirim</label>
            <div className="pay-adj-controls">
              <div className="pay-toggle small">
                <button
                  className={`pay-toggle-btn${discountType === 'fixed' ? ' active' : ''}`}
                  onClick={() => setDiscountType('fixed')}
                >₺</button>
                <button
                  className={`pay-toggle-btn${discountType === 'percent' ? ' active' : ''}`}
                  onClick={() => setDiscountType('percent')}
                >%</button>
              </div>
              <input
                className="input small"
                type="number"
                min="0"
                max={discountType === 'percent' ? 100 : confirmAmount}
                placeholder="0"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            {discountAmount > 0 && (
              <span className="pay-adj-delta neg">−{formatCurrency(discountAmount)}</span>
            )}
          </div>
          <div className="pay-adj-row">
            <label className="label">Yuvarlama</label>
            <div className="pay-adj-controls">
              <label className="pay-adj-check">
                <input
                  type="checkbox"
                  checked={roundingEnabled}
                  onChange={(e) => setRoundingEnabled(e.target.checked)}
                />
                <span>Tam sayıya yuvarla</span>
              </label>
            </div>
            {roundingEnabled && roundingDelta !== 0 && (
              <span className={`pay-adj-delta ${roundingDelta > 0 ? 'pos' : 'neg'}`}>
                {roundingDelta > 0 ? '+' : '−'}{formatCurrency(Math.abs(roundingDelta))}
              </span>
            )}
          </div>
        </div>

        <div className="pay-confirm-row">
          <span className="muted">Tahsil edilecek</span>
          <span className="pay-confirm-amt">{formatCurrency(finalAmount)}</span>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>İptal</button>
          <button
            className="btn primary"
            disabled={!confirmEnabled}
            onClick={handleConfirm}
          >
            {method === 'cash' ? 'Nakit Tahsil Et' : 'Kart ile Tahsil Et'}
          </button>
        </div>
      </div>
    </div>
  );
};
