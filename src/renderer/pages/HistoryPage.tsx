import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency } from '../utils/currency';
import { tableTotalFromOrders } from '../utils/totals';
import { fetchClosedTables } from '../services/financeService';
import { Table } from '../../shared/types';
import { TableDetailPage } from './TableDetailPage';

export const HistoryPage: React.FC = () => {
  const { restaurantId, recipes, tableGroups, userProfile, staffPermissions } = useFinance();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [historyTables, setHistoryTables] = useState<Record<string, Table[]>>({});
  const [isLoadingHistory, setIsLoadingHistory] = useState<Record<string, boolean>>({});
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${day}`);
    }
    setHistoryDates(dates);
  }, []);

  const loadMoreDates = () => {
    if (historyDates.length === 0) return;
    const lastDateStr = historyDates[historyDates.length - 1];
    const lastDate = new Date(lastDateStr);
    const newDates: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date(lastDate);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      newDates.push(`${y}-${m}-${day}`);
    }
    setHistoryDates(prev => [...prev, ...newDates]);
  };

  const toggleDay = async (dateStr: string) => {
    const isExpanded = expandedDays.has(dateStr);
    if (isExpanded) {
      setExpandedDays((prev) => {
        const next = new Set(prev);
        next.delete(dateStr);
        return next;
      });
    } else {
      setExpandedDays((prev) => {
        const next = new Set(prev);
        next.add(dateStr);
        return next;
      });

      if (!historyTables[dateStr] && !isLoadingHistory[dateStr] && restaurantId) {
        setIsLoadingHistory(prev => ({ ...prev, [dateStr]: true }));
        try {
          const startOfDay = new Date(dateStr);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(dateStr);
          endOfDay.setHours(23, 59, 59, 999);
          
          const data = await fetchClosedTables(restaurantId, startOfDay.toISOString(), endOfDay.toISOString());
          data.sort((a, b) => {
            const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
            const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
            return bTime - aTime;
          });
          
          setHistoryTables(prev => ({ ...prev, [dateStr]: data }));
        } catch (err) {
          console.error(err);
        } finally {
          setIsLoadingHistory(prev => ({ ...prev, [dateStr]: false }));
        }
      }
    }
  };

  const canSeeTotal = userProfile?.role === 'admin' || (staffPermissions?.canSeeHistoryTotal ?? true);

  const filterTables = (tables: Table[]) => {
    if (!search.trim()) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()));
  };

  const paymentLabel = (method?: string) => {
    if (method === 'cash') return '💵 Nakit';
    if (method === 'credit_card') return '💳 Kart';
    return null;
  };

  // Build a per-table payment summary out of stored transactions. Falls back
  // to the legacy single `paymentMethod` field when no transactions exist
  // (very old records).
  const summarize = (t: Table) => {
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

        <div className="spacer" />
        <input
          className="input"
          placeholder="Masa ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 200 }}
        />
      </div>

      {historyDates.length === 0 ? (
        <div className="empty-state">
          <p>Yükleniyor...</p>
        </div>
      ) : (
        <div className="history-list">
          {historyDates.map((dateStr) => {
            const label = new Date(dateStr).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
            const expanded = expandedDays.has(dateStr);
            const isLoading = isLoadingHistory[dateStr];
            const rawItems = historyTables[dateStr] || [];
            const items = filterTables(rawItems);

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
            <div key={dateStr} className="history-day-section">
              <button
                className={`history-day-header${!expanded ? ' history-day-header--collapsed' : ''}`}
                onClick={() => toggleDay(dateStr)}
                aria-expanded={expanded}
              >
                <span className="history-day-title">
                  <span className="history-day-chevron" />
                  <span className="history-day-label">{label}</span>
                  <span className="history-day-count">{expanded && !isLoading ? `${items.length} kayıt` : 'Yüklemek için tıklayın'}</span>
                </span>
                {expanded && !isLoading && items.length > 0 && canSeeTotal && (
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
              {expanded && (
                <div className="history-day-body">
                  {isLoading ? (
                    <div style={{ padding: 16, color: 'var(--text-muted)' }}>Masalar yükleniyor...</div>
                  ) : items.length === 0 ? (
                    <div style={{ padding: 16, color: 'var(--text-muted)' }}>Bu tarihte kapatılmış masa bulunamadı.</div>
                  ) : items.map((t) => {
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
                onClick={() => setSelectedTableId(t.id)}
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
            })}</div>)}
            </div>
            );
          })}
          
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <button className="btn outline" onClick={loadMoreDates}>Daha eski günleri yükle</button>
          </div>
        </div>
      )}
      {selectedTableId && (
        <div className="side-panel-backdrop" onClick={() => setSelectedTableId(null)}>
          <div className="side-panel-content" onClick={(e) => e.stopPropagation()}>
            <TableDetailPage tableId={selectedTableId} onClose={() => setSelectedTableId(null)} />
          </div>
        </div>
      )}
    </>
  );
};
