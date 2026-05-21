import React, { useState, useEffect } from 'react';
import { Recipe, SelectedVariation } from '../../shared/types';

interface Props {
  recipe: Recipe;
  onConfirm: (variations: SelectedVariation[]) => void;
  onCancel: () => void;
}

export const VariationModal: React.FC<Props> = ({ recipe, onConfirm, onCancel }) => {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  // For each option with productIds, store which productId was selected
  const [productSelections, setProductSelections] = useState<Record<string, string>>({});

  // Initialize defaults for single-select required groups and default product picks
  useEffect(() => {
    const initial: Record<string, string[]> = {};
    const initialProducts: Record<string, string> = {};
    if (recipe.variationGroups) {
      recipe.variationGroups.forEach((g) => {
        if (g.mode === 'single' && g.required && g.options.length > 0) {
          initial[g.id] = [g.options[0].id];
        } else {
          initial[g.id] = [];
        }
        // For each option that maps to products, default to first product
        g.options.forEach((opt) => {
          if ((opt.productIds?.length ?? 0) > 0) {
            initialProducts[opt.id] = opt.productIds![0];
          }
        });
      });
    }
    setSelections(initial);
    setProductSelections(initialProducts);
  }, [recipe]);

  const toggleSelection = (groupId: string, optionId: string, mode: 'single' | 'multi') => {
    setSelections((prev) => {
      const current = prev[groupId] || [];
      if (mode === 'single') {
        return { ...prev, [groupId]: [optionId] };
      } else {
        const isSelected = current.includes(optionId);
        if (isSelected) {
          return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
        } else {
          return { ...prev, [groupId]: [...current, optionId] };
        }
      }
    });
  };

  const isReady = recipe.variationGroups?.every((g) => {
    if (!g.required) return true;
    const selected = selections[g.id] || [];
    return selected.length > 0;
  }) ?? true;

  const handleConfirm = () => {
    const result: SelectedVariation[] = [];
    recipe.variationGroups?.forEach((g) => {
      const selectedIds = selections[g.id] || [];
      if (selectedIds.length > 0) {
        const selectedNames = selectedIds.map(
          (id) => g.options.find((o) => o.id === id)?.name || ''
        );
        // Collect selected products for options that link to product recipes
        const selectedProducts = selectedIds
          .map((optionId) => {
            const opt = g.options.find((o) => o.id === optionId);
            if ((opt?.productIds?.length ?? 0) > 0) {
              const productId = productSelections[optionId];
              if (productId) return { optionId, productId };
            }
            return null;
          })
          .filter(Boolean) as { optionId: string; productId: string }[];

        result.push({
          groupId: g.id,
          groupLabel: g.label,
          optionIds: selectedIds,
          optionNames: selectedNames,
          ...(selectedProducts.length > 0 ? { selectedProducts } : {}),
        });
      }
    });
    onConfirm(result);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: '420px' }}>
        <h3>{recipe.name} - Seçenekler</h3>

        <div style={{ maxHeight: '60vh', overflowY: 'auto', margin: '1rem 0' }}>
          {recipe.variationGroups?.map((group) => {
            const selectedIds = selections[group.id] || [];
            return (
              <div key={group.id} style={{ marginBottom: '1.25rem' }}>
                <div style={{ marginBottom: '0.5rem' }}>
                  <strong>{group.label}</strong>
                  {group.required && <span style={{ color: 'red', marginLeft: 4 }}>*</span>}
                  <span className="muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>
                    ({group.mode === 'single' ? 'Tekli Seçim' : 'Çoklu Seçim'})
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {group.options.map((opt) => {
                    const isSelected = selectedIds.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        className={`btn ${isSelected ? 'primary' : ''}`}
                        onClick={() => toggleSelection(group.id, opt.id, group.mode)}
                        style={{ padding: '0.5rem 1rem' }}
                      >
                        {opt.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>İptal</button>
          <button className="btn primary" disabled={!isReady} onClick={handleConfirm}>
            Onayla
          </button>
        </div>
      </div>
    </div>
  );
};
