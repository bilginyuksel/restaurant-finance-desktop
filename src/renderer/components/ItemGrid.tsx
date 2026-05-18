import React, { useEffect, useMemo, useState } from 'react';
import { Recipe } from '../../shared/types';
import { formatCurrency } from '../utils/currency';

interface Props {
  recipes: Recipe[];
  categories: string[];
  onPick: (r: Recipe) => void;
}

type ViewMode = 'tabs' | 'categories';
const VIEW_MODE_KEY = 'itemGrid.viewMode';

export const ItemGrid: React.FC<Props> = ({ recipes, categories, onPick }) => {
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_MODE_KEY) : null;
    return saved === 'categories' ? 'categories' : 'tabs';
  });

  useEffect(() => {
    try { window.localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch { /* noop */ }
  }, [viewMode]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return recipes
      .filter((r) => !active || r.category === active)
      .filter((r) => !s || r.name.toLowerCase().includes(s));
  }, [recipes, active, search]);

  // Count of products per category (for the category-drilldown view)
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recipes) {
      if (!r.category) continue;
      map.set(r.category, (map.get(r.category) ?? 0) + 1);
    }
    return map;
  }, [recipes]);

  const switchView = (mode: ViewMode) => {
    setViewMode(mode);
    setActive(null);
    setSearch('');
  };

  // In the drilldown view: when no category is picked and no search is active,
  // show categories as big cards. A search will show matching products across
  // all categories regardless of the selected one.
  const showCategoryCards =
    viewMode === 'categories' && !active && search.trim().length === 0;

  return (
    <>
      <div className="flex-row" style={{ gap: 8 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Ürün ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="view-toggle" role="tablist" aria-label="Görünüm">
          <button
            type="button"
            className={viewMode === 'tabs' ? 'active' : ''}
            onClick={() => switchView('tabs')}
            title="Kategori sekmeli görünüm"
          >
            Sekmeli
          </button>
          <button
            type="button"
            className={viewMode === 'categories' ? 'active' : ''}
            onClick={() => switchView('categories')}
            title="Önce kategori seçimi"
          >
            Kategoriler
          </button>
        </div>
      </div>

      {viewMode === 'tabs' && (
        <div className="cat-tabs">
          <button className={active === null ? 'active' : ''} onClick={() => setActive(null)}>
            Tümü
          </button>
          {categories.map((c) => (
            <button key={c} className={active === c ? 'active' : ''} onClick={() => setActive(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {viewMode === 'categories' && active && (
        <div className="cat-breadcrumb">
          <button className="btn small" onClick={() => setActive(null)}>← Kategoriler</button>
          <span className="cat-breadcrumb-name">{active}</span>
        </div>
      )}

      {showCategoryCards ? (
        <div className="item-grid">
          {categories.map((c) => (
            <button key={c} className="item-card category-card" onClick={() => setActive(c)}>
              <div className="item-name">{c}</div>
              <div className="item-price">{categoryCounts.get(c) ?? 0} ürün</div>
            </button>
          ))}
          {categories.length === 0 && (
            <div className="empty-state">Kategori yok</div>
          )}
        </div>
      ) : (
        <div className="item-grid">
          {filtered.map((r) => (
            <button key={r.id} className="item-card" onClick={() => onPick(r)}>
              <div className="item-name">{r.name}</div>
              <div className="item-price">
                {formatCurrency(r.price)}
                {r.pricingType === 'by_weight' ? ' /kg' : ''}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="empty-state">Ürün bulunamadı</div>
          )}
        </div>
      )}
    </>
  );
};
