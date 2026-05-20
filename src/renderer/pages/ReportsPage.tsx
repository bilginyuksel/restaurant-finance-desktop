import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency } from '../utils/currency';
import { itemPrice, recipeName, recipeUnitLabel } from '../utils/totals';
import { Table } from '../../shared/types';

export const ReportsPage: React.FC = () => {
  const { tables, recipesById, tableGroups } = useFinance();
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'>('today');
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const closedTables = useMemo(() => {
    return tables
      .filter((t) => t.status === 'closed')
      .sort((a, b) => {
        const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return bTime - aTime; // descending
      });
  }, [tables]);

  const parseDateString = (dateString: string, isEnd: boolean) => {
    if (!dateString) return isEnd ? new Date() : new Date(0);
    const [y, m, d] = dateString.split('-').map(Number);
    if (!y || isNaN(y) || !m || isNaN(m) || !d || isNaN(d)) return isEnd ? new Date() : new Date(0);
    const date = new Date(y, m - 1, d);
    if (isEnd) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date;
  };

  const { filteredTables, currentRange } = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let start: Date;
    let end: Date;

    if (dateFilter === 'today') {
      start = startOfDay;
      end = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else if (dateFilter === 'yesterday') {
      start = new Date(startOfDay.getTime() - 24 * 60 * 60 * 1000);
      end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    } else if (dateFilter === 'this_week') {
      const day = startOfDay.getDay();
      const diff = startOfDay.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(startOfDay.getTime());
      start.setDate(diff);
      end = new Date();
    } else if (dateFilter === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date();
    } else { // 'custom'
      start = parseDateString(customDateRange.start, false);
      end = parseDateString(customDateRange.end, true);
    }

    const filtered = closedTables.filter(t => {
      if (!t.closedAt) return false;
      const tTime = new Date(t.closedAt).getTime();
      return tTime >= start.getTime() && tTime <= end.getTime();
    });

    return { filteredTables: filtered, currentRange: { start, end } };
  }, [closedTables, dateFilter, customDateRange]);

  useEffect(() => {
    setSelectedCategory('all');
  }, [dateFilter, customDateRange]);

  const calculateReport = (groupTables: Table[]) => {
    let totalCash = 0;
    let totalCard = 0;
    let totalDiscount = 0;
    let grossTotal = 0; // Total before discount

    const productMap = new Map<string, { quantity: number; amount: number; name: string; unit: string; category: string }>();
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

          const existing = productMap.get(productKey) || { quantity: 0, amount: 0, name: productKey, unit: rUnit, category: categoryName };
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

  const report = filteredTables.length > 0 ? calculateReport(filteredTables) : null;

  const getReportLabel = () => {
    const formatDate = (d: Date) => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
    const formatShortDate = (d: Date) => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

    switch (dateFilter) {
      case 'today': return `Bugün (${formatDate(currentRange.start)})`;
      case 'yesterday': return `Dün (${formatDate(currentRange.start)})`;
      case 'this_week': return `Bu Hafta (${formatShortDate(currentRange.start)} - ${formatShortDate(currentRange.end)})`;
      case 'this_month': return `Bu Ay (${formatShortDate(currentRange.start)} - ${formatShortDate(currentRange.end)})`;
      case 'custom': 
        const s = customDateRange.start ? formatShortDate(currentRange.start) : '...';
        const e = customDateRange.end ? formatShortDate(currentRange.end) : '...';
        return `Özel Tarih (${s} - ${e})`;
      default: return '';
    }
  };

  const categories = useMemo(() => {
    if (!report) return [];
    return Array.from(new Set(report.products.map(p => p.category))).sort();
  }, [report]);

  const filteredProducts = useMemo(() => {
    if (!report) return [];
    if (selectedCategory === 'all') return report.products;
    return report.products.filter(p => p.category === selectedCategory);
  }, [report, selectedCategory]);

  return (
    <div className="reports-page flex-row" style={{ alignItems: 'flex-start', gap: 24 }}>
      {/* Sidebar for dates */}
      <div className="reports-sidebar" style={{ width: 250, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <h2 style={{ margin: '0 0 16px 0' }}>Filtreler</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { value: 'today', label: 'Bugün' },
              { value: 'yesterday', label: 'Dün' },
              { value: 'this_week', label: 'Bu Hafta' },
              { value: 'this_month', label: 'Bu Ay' }
            ].map(f => (
              <button
                key={f.value}
                className={`btn ${dateFilter === f.value ? 'primary' : 'outline'}`}
                style={{ textAlign: 'left', justifyContent: 'flex-start' }}
                onClick={() => setDateFilter(f.value as any)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Özel Tarih</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }} className="muted">Başlangıç</label>
              <input 
                type="date" 
                className="input" 
                style={{ width: '100%' }}
                value={customDateRange.start}
                onChange={e => {
                  setCustomDateRange(prev => ({ ...prev, start: e.target.value }));
                  setDateFilter('custom');
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }} className="muted">Bitiş</label>
              <input 
                type="date" 
                className="input" 
                style={{ width: '100%' }}
                value={customDateRange.end}
                onChange={e => {
                  setCustomDateRange(prev => ({ ...prev, end: e.target.value }));
                  setDateFilter('custom');
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="reports-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {report ? (
          <>
            <h2 style={{ margin: 0 }}>Rapor: {getReportLabel()}</h2>

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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ margin: 0 }}>Ürün Satışları</h3>
                {categories.length > 0 && (
                  <select 
                    className="input" 
                    value={selectedCategory} 
                    onChange={e => setSelectedCategory(e.target.value)}
                    style={{ width: 220, padding: '6px 12px' }}
                  >
                    <option value="all">Tüm Kategoriler</option>
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </div>
              {filteredProducts.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Ürün</th>
                      {selectedCategory === 'all' && <th style={{ padding: '12px 16px', fontWeight: 600 }}>Kategori</th>}
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Miktar</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map(p => (
                      <tr key={p.name} style={{ borderBottom: '1px solid var(--border-light, var(--border))' }}>
                        <td style={{ padding: '12px 16px' }}>{p.name}</td>
                        {selectedCategory === 'all' && (
                          <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>{p.category}</td>
                        )}
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          {p.unit === 'kg' 
                            ? `${(p.quantity * 1000).toFixed(0)}g` 
                            : `${p.quantity % 1 !== 0 ? p.quantity.toFixed(2).replace('.', ',') : p.quantity} ${p.unit}`}
                        </td>
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
