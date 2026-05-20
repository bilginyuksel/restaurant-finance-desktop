import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency } from '../utils/currency';
import { itemPrice, recipeName, recipeUnitLabel } from '../utils/totals';
import { Table } from '../../shared/types';

export const ReportsPage: React.FC = () => {
  const { tables, recipesById, tableGroups } = useFinance();
  const [selectedDateLabel, setSelectedDateLabel] = useState<string | null>(null);

  const closedTables = useMemo(() => {
    return tables
      .filter((t) => t.status === 'closed')
      .sort((a, b) => {
        const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return bTime - aTime; // descending
      });
  }, [tables]);

  const groupedByDay = useMemo(() => {
    const groups: { label: string; date: string; items: Table[] }[] = [];
    for (const t of closedTables) {
      if (!t.closedAt) continue;
      const dateObj = new Date(t.closedAt);
      const label = dateObj.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      // use YYYY-MM-DD as a stable key/date string
      const dateKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

      const existing = groups.find((g) => g.label === label);
      if (existing) {
        existing.items.push(t);
      } else {
        groups.push({ label, date: dateKey, items: [t] });
      }
    }
    return groups;
  }, [closedTables]);

  const currentGroup = groupedByDay.find(g => g.label === selectedDateLabel) || groupedByDay[0];

  useEffect(() => {
    if (!selectedDateLabel && groupedByDay.length > 0) {
      setSelectedDateLabel(groupedByDay[0].label);
    }
  }, [groupedByDay, selectedDateLabel]);

  const calculateReport = (groupTables: Table[]) => {
    let totalCash = 0;
    let totalCard = 0;
    let totalDiscount = 0;
    let grossTotal = 0; // Total before discount

    const productMap = new Map<string, { quantity: number; amount: number; name: string; unit: string }>();
    const groupRevenueMap = new Map<string, number>();
    const categoryRevenueMap = new Map<string, number>();

    for (const t of groupTables) {
      const txs = t.transactions || [];
      const tableNet = txs.reduce((sum, tx) => sum + tx.amount, 0);
      totalCash += txs.filter(tx => tx.paymentMethod === 'cash').reduce((sum, tx) => sum + tx.amount, 0);
      totalCard += txs.filter(tx => tx.paymentMethod === 'credit_card').reduce((sum, tx) => sum + tx.amount, 0);
      totalDiscount += txs.reduce((sum, tx) => sum + (tx.discount || 0), 0);

      const groupId = t.group || '__other__';
      groupRevenueMap.set(groupId, (groupRevenueMap.get(groupId) || 0) + tableNet);

      const tableGross = (t.orders || []).reduce((sum, order) => {
        return sum + (order.items || []).reduce((itemSum, item) => {
          return itemSum + (itemPrice(item, recipesById) * item.quantity);
        }, 0);
      }, 0);
      grossTotal += tableGross;

      // Products
      for (const order of (t.orders || [])) {
        for (const item of (order.items || [])) {
          const rName = recipeName(item.recipeId, recipesById);
          const rUnit = recipeUnitLabel(item.recipeId, recipesById) || 'Adet';
          const recipe = recipesById.get(item.recipeId);
          const categoryName = recipe?.category || 'Kategorisiz';

          const itemRevenue = itemPrice(item, recipesById) * item.quantity;

          categoryRevenueMap.set(categoryName, (categoryRevenueMap.get(categoryName) || 0) + itemRevenue);

          // Group by variation if we want, but grouping by recipeId is simpler.
          // Or group by name + variations
          const varNames = item.selectedVariations
            ? item.selectedVariations.flatMap(v => v.optionNames).join(', ')
            : '';
          const productKey = rName + (varNames ? ` (${varNames})` : '');

          const existing = productMap.get(productKey) || { quantity: 0, amount: 0, name: productKey, unit: rUnit };
          existing.quantity += item.quantity;
          existing.amount += itemRevenue;
          productMap.set(productKey, existing);
        }
      }
    }

    const products = Array.from(productMap.values()).sort((a, b) => b.amount - a.amount);
    const topProducts = products.slice(0, 10);

    const groupRevenues = Array.from(groupRevenueMap.entries())
      .map(([id, amount]) => {
        let name = 'Diğer';
        if (id === '__quick_sale__') name = 'Peşin Satış';
        else {
          const g = tableGroups.find(tg => tg.id === id);
          if (g) name = g.name;
        }
        return { name, amount };
      })
      .sort((a, b) => b.amount - a.amount);

    const categoryRevenues = Array.from(categoryRevenueMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    return { totalCash, totalCard, totalDiscount, grossTotal, products, topProducts, groupRevenues, categoryRevenues };
  };

  const report = currentGroup ? calculateReport(currentGroup.items) : null;

  return (
    <div className="reports-page flex-row" style={{ alignItems: 'flex-start', gap: 24 }}>
      {/* Sidebar for dates */}
      <div className="reports-sidebar" style={{ width: 250, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: '0 0 16px 0' }}>Günlük Raporlar</h2>
        {groupedByDay.length === 0 && <p className="muted">Hiç kayıt yok.</p>}
        {groupedByDay.map(g => (
          <button
            key={g.label}
            className={`btn ${selectedDateLabel === g.label ? 'primary' : 'outline'}`}
            style={{ textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={() => setSelectedDateLabel(g.label)}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="reports-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {report ? (
          <>
            <h2 style={{ margin: 0 }}>Rapor: {currentGroup?.label}</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Brüt Satış (İndirimsiz)</div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCurrency(report.grossTotal)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>İndirimler</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--warn, #b06d00)' }}>−{formatCurrency(report.totalDiscount)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Nakit Tahsilat</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--success, #2da44e)' }}>{formatCurrency(report.totalCash)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Kredi Kartı Tahsilat</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--info, #1f6feb)' }}>{formatCurrency(report.totalCard)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Net Tahsilat</div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCurrency(report.totalCash + report.totalCard)}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <h3 style={{ margin: '0 0 16px 0' }}>Bölümlere Göre Gelir</h3>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={report.groupRevenues}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={60}
                        dataKey="amount"
                        nameKey="name"
                        label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                      >
                        {report.groupRevenues.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'][index % 6]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => formatCurrency(Number(value))}
                        contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)', borderRadius: 8 }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <h3 style={{ margin: '0 0 16px 0' }}>Kategorilere Göre Gelir</h3>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={report.categoryRevenues}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        innerRadius={60}
                        dataKey="amount"
                        nameKey="name"
                        label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                      >
                        {report.categoryRevenues.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'][index % 6]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => formatCurrency(Number(value))}
                        contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)', borderRadius: 8 }}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>

            <div className="card" style={{ borderRadius: 8, overflow: 'hidden' }}>
              <h3 style={{ margin: '16px 16px', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>Ürün Satışları</h3>
              {report.products.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Ürün</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Miktar</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.products.map(p => (
                      <tr key={p.name} style={{ borderBottom: '1px solid var(--border-light, var(--border))' }}>
                        <td style={{ padding: '12px 16px' }}>{p.name}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{p.quantity % 1 !== 0 ? p.quantity.toFixed(2).replace('.', ',') : p.quantity} {p.unit}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 16 }} className="muted">Hiç ürün satılmamış.</div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>Rapor verisi bulunamadı.</p>
          </div>
        )}
      </div>
    </div>
  );
};
