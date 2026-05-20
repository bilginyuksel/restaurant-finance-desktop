import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency } from '../utils/currency';
import { tableTotalFromOrders } from '../utils/totals';

export const HistoryPage: React.FC = () => {
  const { tables, recipes, tableGroups, userProfile, staffPermissions } = useFinance();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  const toggleDay = (label: string) =>
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  const canSeeTotal = userProfile?.role === 'admin' || (staffPermissions?.canSeeHistoryTotal ?? true);

  const closedTables = tables
    .filter((t) => t.status === 'closed')
    .sort((a, b) => {
      const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return bTime - aTime;
    });

  const filtered = search.trim()
    ? closedTables.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    : closedTables;

  // Group by local date string (e.g. "17 Mayıs 2026")
  const groupedByDay: { label: string; items: typeof filtered }[] = [];
  for (const t of filtered) {
    const label = t.closedAt
      ? new Date(t.closedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Bilinmeyen tarih';
    const existing = groupedByDay.find((g) => g.label === label);
    if (existing) {
      existing.items.push(t);
    } else {
      groupedByDay.push({ label, items: [t] });
    }
  }

  const paymentLabel = (method?: string) => {
    if (method === 'cash') return '💵 Nakit';
    if (method === 'credit_card') return '💳 Kart';
    return null;
  };

  // Build a per-table payment summary out of stored transactions. Falls back
  // to the legacy single `paymentMethod` field when no transactions exist
  // (very old records).
  const summarize = (t: typeof closedTables[number]) => {
    const txs = t.transactions ?? [];
    const cash = txs.filter((tx) => tx.paymentMethod === 'cash').reduce((s, tx) => s + tx.amount, 0);
    const card = txs.filter((tx) => tx.paymentMethod === 'credit_card').reduce((s, tx) => s + tx.amount, 0);
    const discount = txs.reduce((s, tx) => s + (tx.discount ?? 0), 0);
    const hasPrepay = txs.some((tx) => tx.isPrepayment);
    const split = cash > 0 && card > 0;
    return { cash, card, discount, hasPrepay, split, txCount: txs.length };
  };

  return (
    <>
      <div className="flex-row" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Geçmiş</h2>
        <span className="muted" style={{ fontSize: 14 }}>{closedTables.length} kayıt</span>
        <div className="spacer" />
        <input
          className="input"
          placeholder="Masa ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>Kapatılmış masa bulunamadı.</p>
        </div>
      ) : (
        <div className="history-list">
          {groupedByDay.map(({ label, items }) => {
            const collapsed = collapsedDays.has(label);

            // Daily totals
            const dayTotals = items.reduce(
              (acc, t) => {
                const s = summarize(t);
                const total = tableTotalFromOrders(t, recipes);
                acc.cash += s.cash;
                acc.card += s.card;
                acc.discount += s.discount;
                acc.total += total;
                return acc;
              },
              { cash: 0, card: 0, discount: 0, total: 0 },
            );

            return (
            <div key={label} className="history-day-section">
              <button
                className={`history-day-header${collapsed ? ' history-day-header--collapsed' : ''}`}
                onClick={() => toggleDay(label)}
                aria-expanded={!collapsed}
              >
                <span className="history-day-title">
                  <span className="history-day-chevron" />
                  <span className="history-day-label">{label}</span>
                  <span className="history-day-count">{items.length} kayıt</span>
                </span>
                {canSeeTotal && (
                  <span className="history-day-totals">
                    {dayTotals.discount > 0 && (
                      <span className="history-day-chip history-day-chip--warn">
                        −{formatCurrency(dayTotals.discount)} indirim
                      </span>
                    )}
                    {dayTotals.cash > 0 && (
                      <span className="history-day-chip">💵 {formatCurrency(dayTotals.cash)}</span>
                    )}
                    {dayTotals.card > 0 && (
                      <span className="history-day-chip">💳 {formatCurrency(dayTotals.card)}</span>
                    )}
                    <span className="history-day-chip history-day-chip--total">{formatCurrency(dayTotals.total)}</span>
                  </span>
                )}
              </button>
              {!collapsed && <div className="history-day-body">{items.map((t) => {
            const total = tableTotalFromOrders(t, recipes);
            const rawItemCount = (t.orders ?? []).reduce(
              (s, o) => s + (o.items ?? []).reduce((ss, it) => ss + it.quantity, 0),
              0,
            );
            const itemCount = Number(rawItemCount.toFixed(3));
            const group = tableGroups.find((g) => g.id === t.group);
            const s = summarize(t);

            return (
              <button
                key={t.id}
                className="history-card"
                onClick={() => navigate(`/table/${t.id}`)}
              >
                <div className="history-card-left">
                  <span className="history-card-name">{t.name}</span>
                  {t.group === '__quick_sale__' && (
                    <span className="history-card-group" style={{ color: 'var(--info)' }}>Peşin Satış</span>
                  )}
                  {group && t.group !== '__quick_sale__' && (
                    <span className="history-card-group">{group.name}</span>
                  )}
                  <div className="history-card-tags" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {s.discount > 0 && (
                      <span className="badge" style={{ background: 'var(--warn, #b06d00)', color: '#fff', fontSize: 11 }}>
                        İndirim −{formatCurrency(s.discount)}
                      </span>
                    )}
                    {s.hasPrepay && (
                      <span className="badge" style={{ background: 'var(--info, #1f6feb)', color: '#fff', fontSize: 11 }}>
                        Ön ödeme
                      </span>
                    )}
                    {s.txCount > 1 && (
                      <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: 11 }}>
                        {s.txCount} ödeme
                      </span>
                    )}
                  </div>
                </div>
                <div className="history-card-meta">
                  <span className="history-card-date">
                    {t.closedAt
                      ? new Date(t.closedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </span>
                  <span className="history-card-items">{itemCount} ürün</span>
                </div>
                <div className="history-card-right">
                  {s.split ? (
                    <span className="history-card-payment">
                      💵 {formatCurrency(s.cash)} · 💳 {formatCurrency(s.card)}
                    </span>
                  ) : (
                    paymentLabel(t.paymentMethod) && (
                      <span className="history-card-payment">{paymentLabel(t.paymentMethod)}</span>
                    )
                  )}
                  {canSeeTotal && (
                    <span className="history-card-total">{formatCurrency(total)}</span>
                  )}
                  <span className="history-card-chevron">›</span>
                </div>
              </button>
              );
            })}</div>}
            </div>
            );
          })}
        </div>
      )}
    </>
  );
};
