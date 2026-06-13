const fs = require('fs');
const file = 'src/renderer/pages/ReportsPage.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add state variables for the new filters
content = content.replace(
  "const [selectedCategory, setSelectedCategory] = useState<string>('all');",
  "const [selectedCategory, setSelectedCategory] = useState<string>('all');\n  const [filterCategories, setFilterCategories] = useState<string[]>([]);\n  const [filterProducts, setFilterProducts] = useState<string[]>([]);"
);

// 2. Clear filters on date change
content = content.replace(
  "setSelectedCategory('all');\n  }, [dateFilter, customDateRange]);",
  "setSelectedCategory('all');\n    setFilterCategories([]);\n    setFilterProducts([]);\n  }, [dateFilter, customDateRange]);"
);

// 3. Update calculateReport to use the filters
const calculateReportOld = `    for (const t of groupTables) {
      const txs = t.transactions || [];
      const tableNet = txs.reduce((sum, tx) => sum + tx.amount, 0);
      const tableCash = txs.filter(tx => tx.paymentMethod === 'cash').reduce((sum, tx) => sum + tx.amount, 0);
      const tableCard = txs.filter(tx => tx.paymentMethod === 'credit_card').reduce((sum, tx) => sum + tx.amount, 0);
      const tableDiscount = txs.reduce((sum, tx) => sum + (tx.discount || 0), 0);
      
      totalCash += tableCash;
      totalCard += tableCard;
      totalDiscount += tableDiscount;

      const groupId = t.group || '__other__';
      const groupData = groupRevenueMap.get(groupId) || { netRevenue: 0, grossRevenue: 0, cash: 0, card: 0, discount: 0, cost: 0 };
      groupData.netRevenue += tableNet;
      groupData.cash += tableCash;
      groupData.card += tableCard;
      groupData.discount += tableDiscount;

      const tableGross = (t.orders || []).reduce((sum, order) => {
        return sum + (order.items || []).reduce((itemSum, item) => {
          return itemSum + (itemPrice(item, recipesById) * item.quantity);
        }, 0);
      }, 0);
      grossTotal += tableGross;
      groupData.grossRevenue += tableGross;

      // Products
      for (const order of (t.orders || [])) {
        for (const item of (order.items || [])) {
          const rName = recipeName(item.recipeId, recipesById);
          const rUnit = recipeUnitLabel(item.recipeId, recipesById) || 'Adet';
          const recipe = recipesById.get(item.recipeId);
          const categoryName = recipe?.category || 'Kategorisiz';

          const itemRevenue = itemPrice(item, recipesById) * item.quantity;
          
          const itemCost = recipe?.ingredients?.reduce((sum, ingItem) => {
            const ingredient = ingredients.find((i) => i.id === ingItem.ingredientId);
            return sum + (ingredient ? ingredient.cost * ingItem.amount : 0);
          }, 0) || 0;
          const totalItemCost = itemCost * item.quantity;
          
          totalFoodCost += totalItemCost;
          groupData.cost += totalItemCost;

          categoryRevenueMap.set(categoryName, (categoryRevenueMap.get(categoryName) || 0) + itemRevenue);

          // Key by recipeId so the same product is always grouped into one row
          // regardless of which variation options were chosen — matches mobile behaviour.
          const productKey = item.recipeId;

          const existing = productMap.get(productKey) || { quantity: 0, amount: 0, name: rName, unit: rUnit, category: categoryName, cost: 0, profit: 0 };
          existing.quantity += item.quantity;
          existing.amount += itemRevenue;
          existing.cost += totalItemCost;
          existing.profit += (itemRevenue - totalItemCost);
          productMap.set(productKey, existing);

          // Also count variation-linked products (e.g. Coke/Sprite chosen as a drink variation)
          // These are real recipes that should appear as separate sold items in reports.
          if (item.selectedVariations) {
            for (const variation of item.selectedVariations) {
              if (variation.selectedProducts) {
                for (const sel of variation.selectedProducts) {
                  const varProduct = recipesById.get(sel.productId);
                  if (!varProduct) continue;
                  const vpName = varProduct.name;
                  const vpUnit = recipeUnitLabel(sel.productId, recipesById) || 'Adet';
                  const vpCategory = varProduct.category || 'Kategorisiz';
                  
                  const vpCost = varProduct.ingredients?.reduce((sum, ingItem) => {
                    const ingredient = ingredients.find((i) => i.id === ingItem.ingredientId);
                    return sum + (ingredient ? ingredient.cost * ingItem.amount : 0);
                  }, 0) || 0;
                  const totalVpCost = vpCost * item.quantity;
                  
                  totalFoodCost += totalVpCost;
                  groupData.cost += totalVpCost;
                  
                  // Key by productId so multiple tables all roll up into the same linked-product row
                  const vpKey = sel.productId;
                  const vpExisting = productMap.get(vpKey) || { quantity: 0, amount: 0, name: vpName, unit: vpUnit, category: vpCategory, cost: 0, profit: 0 };
                  vpExisting.quantity += item.quantity;
                  // Variation products are included in the main item price; no extra revenue
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
      groupRevenueMap.set(groupId, groupData);
    }`;

const calculateReportNew = `    const isFiltered = filterCategories.length > 0 || filterProducts.length > 0;
    
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
    }`;

content = content.replace(calculateReportOld, calculateReportNew);

// 4. Update the linter fix for the switch block
content = content.replace(
  "case 'custom': \n        const s = customDateRange.start ? formatShortDate(currentRange.start) : '...';\n        const e = customDateRange.end ? formatShortDate(currentRange.end) : '...';\n        return `Özel Tarih (${s} - ${e})`;",
  "case 'custom': {\n        const s = customDateRange.start ? formatShortDate(currentRange.start) : '...';\n        const e = customDateRange.end ? formatShortDate(currentRange.end) : '...';\n        return `Özel Tarih (${s} - ${e})`;\n      }"
);

// 5. Add allCategories and allProducts definition right after "const categories = useMemo..."
const categoriesDef = "  const categories = useMemo(() => {\n    if (!report) return [];\n    return Array.from(new Set(report.products.map(p => p.category))).sort();\n  }, [report]);";
const allFilterDefs = `  const categories = useMemo(() => {
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
  }, [recipesById]);`;
content = content.replace(categoriesDef, allFilterDefs);

// 6. Inject the UI for Advanced Filters and fix the Top Products BarChart
const advancedFiltersUI = `
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
        </div>`;

content = content.replace("</div>\n      </div>\n\n      {/* Main content */}", advancedFiltersUI + "\n      </div>\n      </div>\n\n      {/* Main content */}");

// 7. Inject top products graph above "Bölümlere Göre Gelir"
const graphsSplit = `<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>`;

const barChartStr = `<div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8, marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 16px 0' }}>En Çok Satan Ürünler</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.topProducts} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={150} />
                    <Tooltip formatter={(value: any) => formatCurrency(Number(value))} />
                    <Bar dataKey="amount" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 16 }}>
              <div className="card" style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 8 }}>`;

content = content.replace(graphsSplit, barChartStr);

// 8. Update N/A for cash/card/discount cards
const isFilteredCheck = `const isFiltered = filterCategories.length > 0 || filterProducts.length > 0;`;
// Insert after `<h2 style={{ margin: 0 }}>Rapor: {getReportLabel()}</h2>`
content = content.replace(
  "<h2 style={{ margin: 0 }}>Rapor: {getReportLabel()}</h2>",
  "<h2 style={{ margin: 0 }}>Rapor: {getReportLabel()}</h2>\n            {isFiltered && <div style={{ background: 'var(--warn-bg, #fff8c5)', color: 'var(--warn, #b06d00)', padding: '8px 12px', borderRadius: 6, fontSize: 14 }}>Gelişmiş filtre aktif. Tahsilat detayları masaya ait olduğu için bu görünümde gizlenmiştir.</div>}\n            "
);
content = content.replace("export const ReportsPage: React.FC = () => {", `export const ReportsPage: React.FC = () => {\n  const [filterCategories, setFilterCategories] = useState<string[]>([]);\n  const [filterProducts, setFilterProducts] = useState<string[]>([]);\n  const isFiltered = filterCategories.length > 0 || filterProducts.length > 0;`);

content = content.replace(
  "{formatCurrency(report.totalDiscount)}",
  "{isFiltered ? 'N/A' : formatCurrency(report.totalDiscount)}"
);
content = content.replace(
  "{formatCurrency(report.totalCash)}",
  "{isFiltered ? 'N/A' : formatCurrency(report.totalCash)}"
);
content = content.replace(
  "{formatCurrency(report.totalCard)}",
  "{isFiltered ? 'N/A' : formatCurrency(report.totalCard)}"
);
// Also for table columns:
content = content.replace(
  "<td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--warn, #b06d00)' }}>{formatCurrency(g.discount)}</td>",
  "<td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--warn, #b06d00)' }}>{isFiltered ? 'N/A' : formatCurrency(g.discount)}</td>"
);
content = content.replace(
  "<td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--success, #2da44e)' }}>{formatCurrency(g.cash)}</td>",
  "<td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--success, #2da44e)' }}>{isFiltered ? 'N/A' : formatCurrency(g.cash)}</td>"
);
content = content.replace(
  "<td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--info, #1f6feb)' }}>{formatCurrency(g.card)}</td>",
  "<td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--info, #1f6feb)' }}>{isFiltered ? 'N/A' : formatCurrency(g.card)}</td>"
);

// We had two `const [filterCategories, setFilterCategories]` because of steps 1 and 8. 
// Let's remove the one from step 1.
content = content.replace(
  "const [selectedCategory, setSelectedCategory] = useState<string>('all');\n  const [filterCategories, setFilterCategories] = useState<string[]>([]);\n  const [filterProducts, setFilterProducts] = useState<string[]>([]);",
  "const [selectedCategory, setSelectedCategory] = useState<string>('all');"
);

fs.writeFileSync(file, content);
console.log("Patched correctly");
