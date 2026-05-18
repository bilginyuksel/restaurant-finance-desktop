import { Recipe, Table, TableItem, TableOrder } from '../../shared/types';

/**
 * A lookup source for recipes. Accepting either a raw array or a pre-indexed
 * Map keeps existing call sites working while letting hot paths avoid the
 * O(n) `Array.find` scan on every render. Always prefer passing a Map.
 */
export type RecipeLookup = readonly Recipe[] | ReadonlyMap<string, Recipe>;

const lookup = (recipes: RecipeLookup, id: string): Recipe | undefined => {
  if (recipes instanceof Map) return recipes.get(id);
  return (recipes as readonly Recipe[]).find((r) => r.id === id);
};

export const itemPrice = (item: TableItem, recipes: RecipeLookup): number => {
  if (typeof item.price === 'number') return item.price;
  const r = lookup(recipes, item.recipeId);
  return r?.price ?? 0;
};

export const itemLineTotal = (item: TableItem, recipes: RecipeLookup): number =>
  itemPrice(item, recipes) * item.quantity;

export const orderTotal = (order: TableOrder, recipes: RecipeLookup): number =>
  (order.items ?? []).reduce((sum, it) => sum + itemLineTotal(it, recipes), 0);

export const tableTotalFromOrders = (table: Table, recipes: RecipeLookup): number =>
  (table.orders ?? []).reduce((sum, o) => sum + orderTotal(o, recipes), 0);

export const tableUnpaidTotal = (table: Table, recipes: RecipeLookup): number => {
  const total = tableTotalFromOrders(table, recipes);
  // Use grossAmount (the pre-discount/rounding portion of the bill that was
  // settled) so a discounted past payment correctly reduces the remaining
  // balance. Legacy transactions without grossAmount fall back to amount.
  const paid = (table.transactions ?? []).reduce(
    (s, t) => s + (t.grossAmount ?? t.amount ?? 0),
    0,
  );
  return Math.max(0, total - paid);
};

export const recipeName = (recipeId: string, recipes: RecipeLookup): string =>
  lookup(recipes, recipeId)?.name ?? recipeId;

export const recipeUnitLabel = (recipeId: string, recipes: RecipeLookup): string | undefined => {
  const r = lookup(recipes, recipeId);
  return r?.pricingType === 'by_weight' ? 'kg' : undefined;
};
