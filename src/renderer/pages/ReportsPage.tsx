import React, { useState, useMemo, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency } from '../utils/currency';
import { itemPrice, recipeName, recipeUnitLabel } from '../utils/totals';
import { Table } from '../../shared/types';
import { listenToClosedTables } from '../services/financeService';

export const ReportsPage: React.FC = () => {
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterProducts, setFilterProducts] = useState<string[]>([]);
  const isFiltered = filterCategories.length > 0 || filterProducts.length > 0;
  const { restaurantId, recipesById, tableGroups, ingredients, expenses } = useFinance();
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | 'this_week' | 'this_month' | 'custom'>('today');
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

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

  const currentRange = useMemo(() => {
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

    return { start, end };
  }, [dateFilter, customDateRange]);

  const [filteredTables, setFilteredTables] = useState<Table[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    setIsLoading(true);
    
    const unsubscribe = listenToClosedTables(
      restaurantId, 
      currentRange.start.toISOString(), 
      currentRange.end.toISOString(),
      (data) => {
        data.sort((a, b) => {
          const aTime = a.closedAt ? new Date(a.closedAt).getTime() : 0;
          const bTime = b.closedAt ? new Date(b.closedAt).getTime() : 0;
          return bTime - aTime;
        });
        setFilteredTables(data);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentRange, restaurantId]);

  useEffect(() => {
    setSelectedCategory('all');
    setFilterCategories([]);
    setFilterProducts([]);
  }, [dateFilter, customDateRange]);

  const calculateReport = (groupTables: Table[]) => {
    let totalCash = 0;
    let totalCard = 0;
    let totalDiscount = 0;
    let grossTotal = 0; // Total before discount
    let totalFoodCost = 0;

    const productMap = new Map<string, { quantity: number; amount: number; name: string; unit: string; category: string; cost: number; profit: number }>();
    const groupRevenueMap = new Map<string, { netRevenue: number; grossRevenue: number; cash: number; card: number; discount: number; cost: number }>();
    const categoryRevenueMap = new Map<string, number>();

    const isFiltered = filterCategories.length > 0 || filterProducts.length > 0;
    
    for (const t of groupTables) {
      const groupId = t.group || '__other__';
      const groupData = groupRevenueMap.get(groupId) || { netRevenue: 0, grossRevenue: 0, cash: 0, card: 0, discount: 0, cost: 0 };

      if (!isFiltered) {
        const txs = t.transactions || [];
        const tableNet = txs.reduce((sum, tx) => sum + tx.amount, 0);
        const tableCash = txs.filter(tx => tx.paymentMethod === 'cash').reduce((sum, tx) => sum + tx.amount, 0);
        const tableCard = txs.filter(tx => tx.paymentMethod === 'credit_card').reduce((sum, tx) => sum + tx.amount, 0);
        const tableDiscount = txs.reduce((sum, tx) => sum + (tx.discount || 0), 0);
        
        totalCash += tableCash;
        totalCard += tableCard;
        totalDiscount += tableDiscount;

        groupData.netRevenue += tableNet;
        groupData.cash += tableCash;
        groupData.card += tableCard;
        groupData.discount += tableDiscount;
      }

      let tableGrossFiltered = 0;

      for (const order of (t.orders || [])) {
        for (const item of (order.items || [])) {
          const recipe = recipesById.get(item.recipeId);
          const categoryName = recipe?.category || 'Kategorisiz';

          let mainItemMatches = true;
          if (isFiltered) {
            const catMatch = filterCategories.length === 0 || filterCategories.includes(categoryName);
            const prodMatch = filterProducts.length === 0 || filterProducts.includes(item.recipeId);
            mainItemMatches = catMatch && prodMatch;
          }

          if (mainItemMatches) {
            const rName = recipeName(item.recipeId, recipesById);
            const rUnit = recipeUnitLabel(item.recipeId, recipesById) || 'Adet';

            const itemRevenue = itemPrice(item, recipesById) * item.quantity;
            tableGrossFiltered += itemRevenue;
            
            const itemCost = recipe?.ingredients?.reduce((sum, ingItem) => {
              const ingredient = ingredients.find((i) => i.id === ingItem.ingredientId);
              return sum + (ingredient ? ingredient.cost * ingItem.amount : 0);
            }, 0) || 0;
            const totalItemCost = itemCost * item.quantity;
            
            totalFoodCost += totalItemCost;
            groupData.cost += totalItemCost;

            categoryRevenueMap.set(categoryName, (categoryRevenueMap.get(categoryName) || 0) + itemRevenue);

            const productKey = item.recipeId;
            const existing = productMap.get(productKey) || { quantity: 0, amount: 0, name: rName, unit: rUnit, category: categoryName, cost: 0, profit: 0 };
            existing.quantity += item.quantity;
            existing.amount += itemRevenue;
            existing.cost += totalItemCost;
            existing.profit += (itemRevenue - totalItemCost);
            productMap.set(productKey, existing);
          }

          // Process variations independently of the main item's filter
          if (item.selectedVariations) {
            for (const variation of item.selectedVariations) {
              if (variation.selectedProducts) {
                for (const sel of variation.selectedProducts) {
                  const varProduct = recipesById.get(sel.productId);
                  if (!varProduct) continue;
                  const vpName = varProduct.name;
                  const vpUnit = recipeUnitLabel(sel.productId, recipesById) || 'Adet';
                  const vpCategory = varProduct.category || 'Kategorisiz';
                  
                  let vpMatches = true;
                  if (isFiltered) {
                    const vpCatMatch = filterCategories.length === 0 || filterCategories.includes(vpCategory);
                    const vpProdMatch = filterProducts.length === 0 || filterProducts.includes(sel.productId);
                    vpMatches = vpCatMatch && vpProdMatch;
                  }

                  if (vpMatches) {
                    const vpCost = varProduct.ingredients?.reduce((sum, ingItem) => {
                      const ingredient = ingredients.find((i) => i.id === ingItem.ingredientId);
                      return sum + (ingredient ? ingredient.cost * ingItem.amount : 0);
                    }, 0) || 0;
                    const totalVpCost = vpCost * item.quantity;
                    
                    totalFoodCost += totalVpCost;
                    groupData.cost += totalVpCost;
                    
                    const vpKey = sel.productId;
                    const vpExisting = productMap.get(vpKey) || { quantity: 0, amount: 0, name: vpName, unit: vpUnit, category: vpCategory, cost: 0, profit: 0 };
                    vpExisting.quantity += item.quantity;
                    vpExisting.amount += 0;
                    vpExisting.cost += totalVpCost;
                    vpExisting.profit -= totalVpCost;
                    productMap.set(vpKey, vpExisting);
                  }
                }
              }
            }
          }
        }
      }
      
      grossTotal += tableGrossFiltered;
      groupData.grossRevenue += tableGrossFiltered;
      groupRevenueMap.set(groupId, groupData);
    }

    const products = Array.from(productMap.values()).sort((a, b) => b.amount - a.amount);
    const topProducts = products.slice(0, 10);

    const groupRevenues = Array.from(groupRevenueMap.entries())
      .map(([id, data]) => {
        let name = 'Diğer';
        if (id === '__quick_sale__') name = 'Peşin Satış';
        else {
          const g = tableGroups.find(tg => tg.id === id);
          if (g) name = g.name;
        }
        return { name, ...data };
      })
      .sort((a, b) => b.netRevenue - a.netRevenue);

    const categoryRevenues = Array.from(categoryRevenueMap.entries())
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
      
    const totalMonthlyExpenses = (expenses || []).reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const msInDay = 24 * 60 * 60 * 1000;
    const daysInRange = Math.max(1, Math.round((currentRange.end.getTime() - currentRange.start.getTime()) / msInDay));
    const dailyFixedCost = (totalMonthlyExpenses / 30) * daysInRange;

    const grossProfit = (grossTotal - totalDiscount) - totalFoodCost;
    const netProfit = grossProfit - dailyFixedCost;

    return { totalCash, totalCard, totalDiscount, grossTotal, totalFoodCost, grossProfit, dailyFixedCost, netProfit, products, topProducts, groupRevenues, categoryRevenues };
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
      case 'custom': {
        const s = customDateRange.start ? formatShortDate(currentRange.start) : '...';
        const e = customDateRange.end ? formatShortDate(currentRange.end) : '...';
        return `Özel Tarih (${s} - ${e})`;
      }
      default: return '';
    }
  };

  const categories = useMemo(() => {
    if (!report) return [];
    return Array.from(new Set(report.products.map(p => p.category))).sort();
  }, [report]);

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    recipesById.forEach(r => {
      if (r.category) cats.add(r.category);
    });
    return Array.from(cats).sort();
  }, [recipesById]);

  const allProductsList = useMemo(() => {
    return Array.from(recipesById.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [recipesById]);

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
        
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Gelişmiş Filtreler</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }} className="muted">Kategori Filtresi</label>
              <select 
                multiple
                className="input" 
                style={{ width: '100%', minHeight: 120 }}
                value={filterCategories}
                onChange={e => {
                  const options = Array.from(e.target.options);
                  setFilterCategories(options.filter(o => o.selected).map(o => o.value));
                }}
              >
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-muted)' }}>Birden fazla seçmek için basılı tutun (Cmd/Ctrl)</div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }} className="muted">Ürün Filtresi</label>
              <select 
                multiple
                className="input" 
                style={{ width: '100%', minHeight: 150 }}
                value={filterProducts}
                onChange={e => {
                  const options = Array.from(e.target.options);
                  setFilterProducts(options.filter(o => o.selected).map(o => o.value));
                }}
              >
                {allProductsList
                  .filter(p => filterCategories.length === 0 || filterCategories.includes(p.category || 'Kategorisiz'))
                  .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                }
              </select>
            </div>
            {(filterCategories.length > 0 || filterProducts.length > 0) && (
              <button 
                className="btn outline" 
                onClick={() => { setFilterCategories([]); setFilterProducts([]); }}
                style={{ marginTop: 8 }}
              >
                Filtreleri Temizle
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Main content */}
      <div className="reports-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 48 }}>
            <p className="muted">Rapor yükleniyor...</p>
          </div>
        ) : report ? (
          <>
            <h2 style={{ margin: 0 }}>Rapor: {getReportLabel()}</h2>
            {isFiltered && <div style={{ background: 'var(--warn-bg, #fff8c5)', color: 'var(--warn, #b06d00)', padding: '8px 12px', borderRadius: 6, fontSize: 14 }}>Gelişmiş filtre aktif. Tahsilat detayları masaya ait olduğu için bu görünümde gizlenmiştir.</div>}
            

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Brüt Satış (İndirimsiz)</div>
                <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatCurrency(report.grossTotal)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Gıda Maliyeti</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--danger, #cf222e)' }}>{formatCurrency(report.totalFoodCost)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Sabit Gider (Günlük)</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--danger, #cf222e)' }}>{formatCurrency(report.dailyFixedCost)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>İndirimler</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--warn, #b06d00)' }}>−{isFiltered ? 'N/A' : formatCurrency(report.totalDiscount)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Nakit Tahsilat</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--success, #2da44e)' }}>{isFiltered ? 'N/A' : formatCurrency(report.totalCash)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Kredi Kartı Tahsilat</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: 'var(--info, #1f6feb)' }}>{isFiltered ? 'N/A' : formatCurrency(report.totalCard)}</div>
              </div>
              <div className="card" style={{ padding: 16, background: 'var(--surface-1)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Net Kâr</div>
                <div style={{ fontSize: 24, fontWeight: 'bold', color: report.netProfit >= 0 ? 'var(--success, #2da44e)' : 'var(--danger, #cf222e)' }}>
                  {formatCurrency(report.netProfit)}
                </div>
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
                        dataKey="grossRevenue"
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
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Maliyet</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Kâr</th>
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
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--danger, #cf222e)' }}>{formatCurrency(p.cost)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: p.profit >= 0 ? 'var(--success, #2da44e)' : 'var(--danger, #cf222e)' }}>
                          {formatCurrency(p.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 16 }} className="muted">Hiç ürün satılmamış.</div>
              )}
            </div>

            <div className="card" style={{ borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ margin: 0 }}>Bölümlere Göre Analiz</h3>
              </div>
              {report.groupRevenues.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '12px 16px', fontWeight: 600 }}>Bölüm</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Net Gelir</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Brüt Gelir</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>İndirim</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Nakit</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Kredi Kartı</th>
                      <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Maliyet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.groupRevenues.map(g => (
                      <tr key={g.name} style={{ borderBottom: '1px solid var(--border-light, var(--border))' }}>
                        <td style={{ padding: '12px 16px' }}>{g.name}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(g.netRevenue)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>{formatCurrency(g.grossRevenue)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--warn, #b06d00)' }}>{isFiltered ? 'N/A' : formatCurrency(g.discount)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--success, #2da44e)' }}>{isFiltered ? 'N/A' : formatCurrency(g.cash)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--info, #1f6feb)' }}>{isFiltered ? 'N/A' : formatCurrency(g.card)}</td>
                        <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--danger, #cf222e)' }}>{formatCurrency(g.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: 16 }} className="muted">Bölüm verisi bulunamadı.</div>
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
