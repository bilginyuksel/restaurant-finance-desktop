# Plan: Offline-safe unique order numbers

Add a human-readable `orderNumber` to every `TableOrder`, generated in the Electron main process from a stable per-device tag + a daily-resetting counter, persisted atomically via `electron-store`. The existing UUID stays as the internal PK; `orderNumber` is a display label printed on kitchen tickets and customer bills and shown in the UI.

Format: `YYMMDD-<TAG>-<NNN>` (e.g. `260518-A3F-042`). TAG is 3 chars (base32 of randomUUID), NNN is zero-padded per-day sequence.

## Phase 1 — Settings store: device tag + counter

1. Extend `Schema` in `src/main/settings/store.ts` with:
   - `deviceTag?: string`
   - `orderCounter?: { date: string; seq: number }` (date = `YYYY-MM-DD`)
2. Add `settingsStore.getOrCreateDeviceTag()`:
   - If empty, generate 3-char uppercase tag from `crypto.randomUUID()` (strip dashes, slice 3, uppercase).
   - Persist immediately via `store.set('deviceTag', tag)`.
3. Add `settingsStore.nextOrderNumber()` returning `{ orderNumber, seq, date, tag }`:
   - Read `orderCounter`; if missing or `date` ≠ today, reset to `{ date: today, seq: 0 }`.
   - Bump `seq`, `store.set('orderCounter', …)` BEFORE returning (electron-store writes synchronously).
   - Compose `orderNumber = ${YYMMDD}-${TAG}-${pad3(seq)}`.

## Phase 2 — IPC plumbing

4. Add channels to `src/shared/ipc.ts`:
   - `ORDER_NEXT_NUMBER = 'order:nextNumber'`
   - `ORDER_GET_DEVICE_TAG = 'order:deviceTag'`
5. Register handlers in `src/main/index.ts`.
6. Expose on `window.api` in `src/preload/index.ts`:
   - `nextOrderNumber(): Promise<{ orderNumber; seq; date; tag }>`
   - `deviceTag(): Promise<string>`

## Phase 3 — Shared types

7. `src/shared/types.ts` `TableOrder`: add `orderNumber?: string` (optional for backward compat).
8. `src/shared/receipt.ts` `ReceiptPayload`: add `orderNumber?: string`.

## Phase 4 — Order creation sites

9. `src/renderer/pages/TableDetailPage.tsx` — initial order creation (~L375) AND edit/delta flow (~L267). Delta reuses the original order's `orderNumber`.
10. `src/renderer/pages/QuickSalePage.tsx` — quick-sale order creation (~L110).

## Phase 5 — Printing

11. `src/main/printing/kitchenTicketRenderer.ts` — render `orderNumber` prominently near the top.
12. `src/main/printing/receiptRenderer.ts` — render `orderNumber` as a header line.
13. `printKitchen` and customer-bill payload builders in `TableDetailPage.tsx` forward `order.orderNumber` into `ReceiptPayload`.

## Phase 6 — UI display

14. `TableDetailPage.tsx` — show `orderNumber` next to each order section header.
15. (Optional) Surface device tag in Settings > Printers as read-only "Device ID".

## Verification

1. `npm run lint` and `npm run start` — no TS errors.
2. Create order → ticket shows `260518-XXX-001`, on-screen header matches, Firestore doc has `orderNumber`.
3. Second order → seq increments to `002`.
4. Roll system clock to next day → seq resets to `001`, date prefix updates.
5. Offline (no network), create 3 orders → all get numbers; later sync preserves them.
6. Second device with cleared store → different TAG, no collisions even on overlapping seqs.
7. Edit existing order → `(DEĞİŞİKLİK)` ticket shows original order number.
8. Quick sale → number appears on both kitchen ticket and receipt.
9. Force-quit between calls → restart and confirm seq never reused (skips allowed).

## Relevant files

- `src/main/settings/store.ts` — schema + `getOrCreateDeviceTag`, `nextOrderNumber`.
- `src/main/index.ts` — IPC handler registration.
- `src/shared/ipc.ts` — channel constants.
- `src/preload/index.ts` — `window.api.nextOrderNumber` / `deviceTag`.
- `src/shared/types.ts` — `TableOrder.orderNumber`.
- `src/shared/receipt.ts` — `ReceiptPayload.orderNumber`.
- `src/renderer/pages/TableDetailPage.tsx` — order creation, edit/delta, payload builders, UI render.
- `src/renderer/pages/QuickSalePage.tsx` — quick-sale order creation.
- `src/main/printing/kitchenTicketRenderer.ts` — render on ticket.
- `src/main/printing/receiptRenderer.ts` — render on bill.

## Decisions / assumptions

- `TableOrder.id` (UUID) remains the Firestore PK; `orderNumber` is display-only.
- Counter lives only in main process `electron-store`. Renderers must IPC each time.
- `electron-store` sync writes give crash safety (worst case: a number is skipped).
- Existing orders without `orderNumber` keep working (field optional). No backfill.
- Out of scope: Firestore-side global sequential numbers, multi-window coordination, renumbering after sync.

## Further considerations

1. **Counter reset** — recommend daily. Alt: monotonic-forever / per-shift.
2. **Ticket format** — recommend full `YYMMDD-TAG-NNN`. Alt: short `TAG-NNN`, full only in DB.
3. **Edit/delta tickets** — recommend reuse original `orderNumber` with `(DEĞİŞİKLİK)` tag. Alt: new number per ticket.
4. **TAG visibility** — recommend showing read-only in Settings > Printers as "Device ID".