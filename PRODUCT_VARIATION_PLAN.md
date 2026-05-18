# Plan: Product Variations Feature

## Overview
Add variation groups to recipes. When a user picks a product that has variation groups,
a modal opens to select options (single or multi-select per group). The selected
variations are stored on the basket item, displayed in the basket/order UI, and
printed on the kitchen ticket.

## Decisions
- Multiple independent variation groups per product (e.g. "Modifications" + "Add-ons")
- No conditional/nested variations (all groups shown at once)
- Each group has a `required` flag (must pick before confirming)
- Items with identical recipeId + identical selectedVariations are merged; otherwise
  a new line is created
- by_weight items: always new line (existing behavior preserved). When a recipe is
  both by_weight AND has variations: open variation modal first, then weight modal
- Customer bill is intentionally unchanged — variations print only on kitchen tickets
- Recipe variation definitions are managed directly in Firestore (no admin UI in scope)

## Steps

### Phase 1 — Data model (`src/shared/types.ts`)
1. Add new interfaces:
   - `VariationOption { id: string; name: string }`
   - `VariationGroup { id: string; label: string; mode: 'single' | 'multi';
                        required?: boolean; options: VariationOption[] }`
   - `SelectedVariation { groupId: string; groupLabel: string;
                          optionIds: string[]; optionNames: string[] }`
2. Extend `Recipe` with `variationGroups?: VariationGroup[]`
3. Extend `TableItem` with `selectedVariations?: SelectedVariation[]`

### Phase 2 — Receipt types (`src/shared/receipt.ts`)
4. Add `variations?: string[]` to `ReceiptLineItem` — array of display strings like
   `"Ekstralar: no-ketchup, no-pickle"` for kitchen printing only

### Phase 3 — VariationModal component (new file `src/renderer/components/VariationModal.tsx`)
5. Props: `recipe: Recipe`, `onConfirm(v: SelectedVariation[]): void`, `onCancel(): void`
6. Render one section per `variationGroup` with its label
7. `mode: 'single'` → radio buttons; `mode: 'multi'` → checkboxes
8. Confirm button disabled until all `required` groups have ≥1 selection
9. Style consistent with existing modals (`PaymentModal` / `ConfirmModal` patterns)

### Phase 4 — TableDetailPage.tsx
10. Add `variationModal` state: `{ recipe: Recipe; target: 'basket' | 'edit' } | null`
11. Update `handlePickRecipe`: after by_weight check, if recipe has
    `variationGroups?.length > 0` open variationModal. If recipe is BOTH by_weight
    AND has variations: open variation modal first, then weight modal on confirm
12. Add `confirmVariation(variations)` handler that calls `addToBasket` or `editAdd`
    with variations, then clears the modal
13. Add helper `variationsKey(v?: SelectedVariation[])` → stable JSON string
    (groupId + sorted optionIds) used for merge comparison
14. Update `addToBasket(recipe, qty, selectedVariations?)`: for non-weight items,
    merge only if recipeId matches AND `variationsKey` matches; otherwise push new line
15. Update `editAdd(recipe, qty, selectedVariations?)`: same merge-by-recipe+variationsKey
    logic for `_isNew` lines
16. Update `saveEdit` cancellation aggregation: currently keyed by `recipeId` only —
    change to key by `recipeId + variationsKey` so cancellations of differently-
    customized lines are tracked and printed separately
17. Update basket render and edit-mode order render to display variation labels as
    small sub-text beneath each item name (so staff can see what was picked before
    sending to kitchen)
18. Update `buildLineItems`: map `it.selectedVariations` → `variations` array of
    `"GroupLabel: option1, option2"` strings on `ReceiptLineItem`
19. Render `<VariationModal>` in JSX

### Phase 5 — QuickSalePage.tsx (parallel with Phase 4)
20. Add `variationModal` state and the same `handlePickRecipe` intercept logic
21. Update `addToBasket` to accept `selectedVariations?` and merge by recipeId+key
22. Show variation labels under item names in the basket render
23. Update its `buildLineItems` the same way as Phase 4
24. Render `<VariationModal>` in JSX

### Phase 6 — Kitchen ticket renderer (`src/main/printing/kitchenTicketRenderer.ts`)
25. In the item loop, after printing the item name line, if
    `item.variations?.length > 0` print each variation string as an indented line
    (mirroring the existing `item.note` pattern, both for normal and cancelled items)

## Relevant Files
- `src/shared/types.ts` — add VariationOption, VariationGroup, SelectedVariation;
  extend Recipe, TableItem
- `src/shared/receipt.ts` — add `variations?: string[]` to ReceiptLineItem
- `src/renderer/components/VariationModal.tsx` — new component
- `src/renderer/pages/TableDetailPage.tsx` — variationModal state, handlePickRecipe,
  addToBasket, editAdd, saveEdit cancellation aggregation, basket/order display,
  buildLineItems, JSX
- `src/renderer/pages/QuickSalePage.tsx` — variationModal state, handlePickRecipe,
  addToBasket, basket display, buildLineItems, JSX
- `src/main/printing/kitchenTicketRenderer.ts` — print variation lines under item names
- `src/main/printing/receiptRenderer.ts` — NO CHANGES (customer bill unaffected)

## Verification

### Automated
- `npm run build` (or equivalent) — TypeScript must compile with new types
- Existing tests (if any) must continue to pass

### Manual
1. Add a recipe in Firestore with two `variationGroups`:
   - `Ekstralar` (mode=`multi`, required=false, options: no-ketchup, no-pickle, no-mayo)
   - `İçecek`   (mode=`single`, required=true, options: kola, soda, ayran)
2. Open TableDetailPage, pick that recipe → VariationModal opens with both groups
3. Required group not filled → Confirm button disabled
4. Fill required group → Confirm enabled → click → item appears in basket with
   variation labels shown beneath the name
5. Pick same recipe with the SAME selections → quantity increments (merged line)
6. Pick same recipe with DIFFERENT selections → new separate basket line
7. Send to kitchen → printed ticket shows variation lines indented under item name
8. Enter edit mode on the order, decrement one of the variation lines → save →
   cancellation print shows the correct variations (not collapsed across variants)
9. QuickSalePage: full flow works (pick → modal → basket → print)
10. Recipe with no `variationGroups` → modal never opens (existing behavior unchanged)
11. by_weight + variationGroups combo: variation modal opens first, then weight modal

## Further Considerations (out of scope, can be added later)
1. Admin UI in-app for editing `variationGroups` on recipes
2. Showing variations in `PaymentModal` line list
3. Showing variations in `HistoryPage` past-order view
4. Showing variations on the customer bill (`receiptRenderer.ts`)