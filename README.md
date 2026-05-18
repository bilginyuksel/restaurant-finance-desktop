# Restaurant Finance — Desktop (Electron)

Desktop POS for restaurant table & order tracking. Built with **Electron + React + TypeScript**, backed by **Firebase Firestore** (same project as the mobile app), with **offline-first persistence** and **direct ESC/POS thermal printing** for customer bills and kitchen tickets.

## Highlights

- **Offline-first**: uses Firestore IndexedDB persistence (`persistentLocalCache` + multi-tab manager). Works through Wi‑Fi drops; writes are queued and replayed automatically.
- **Same backend as mobile**: signs in to the same Firebase project (`restaurant-finance`); tables, recipes and categories sync in real time across devices.
- **Fast UX**: split product-grid + basket layout, big tap targets, keyboard shortcuts.
- **Silent ESC/POS printing**: configure a **customer/bar** printer and a **kitchen** printer independently (USB or TCP). Turkish character set by default.
- **Targets**: Windows (Squirrel) and macOS (DMG + ZIP).

## Setup

```bash
npm install
npm start            # dev (electron-forge)
npm run package      # produce unpacked app
npm run make         # produce installer (.exe on Windows, .dmg on macOS)
```

The Firebase web config is hardcoded in `src/renderer/firebase/config.ts` to match the mobile app's `firebaseConfig.ts`. Sign in with the same email/password account used on mobile.

## Printer configuration

Open **Ayarlar** in-app. For each target (customer / kitchen):

- **Type**: `epson` or `star`
- **Interface**:
  - Network printer: `tcp://192.168.1.100` (or with port: `tcp://192.168.1.100:9100`)
  - USB printer: `printer:<system printer name>` (uses the system spooler; install vendor driver first)
- **Character Set**: `PC857_TURKISH` is the default and recommended for Turkish menus.
- **Width**: characters per line (`32`, `42`, or `48` depending on the printer).
- **Cash drawer**: customer printer only — pops the drawer on bill print.

Use **Test Yazdır** to verify before service.

> Networked thermal printers are the most reliable on macOS. USB printing requires the platform driver to be installed.

## Offline behavior

- All writes go through Firestore; the SDK queues them locally and pushes when the network returns.
- The header shows a live status badge: **Çevrimiçi**, **Senkronize ediliyor…** (pending writes), or **Çevrimdışı**.
- Auth session is persisted in IndexedDB, so signed-in users stay logged in across restarts and offline launches.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Enter` | Send the basket to the kitchen |
| `P` | Print customer bill |
| `K` | Re-print the last kitchen ticket |
| `Esc` | Go back to the tables grid |

## Project layout

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # window + IPC wiring
│   ├── printing/            # ESC/POS PrinterService + renderers
│   └── settings/store.ts    # electron-store (printer config, restaurantId)
├── preload/index.ts         # contextBridge → window.api
├── renderer/                # React UI
│   ├── firebase/            # Firestore + Auth with offline persistence
│   ├── context/FinanceContext.tsx
│   ├── pages/               # Login, Tables, TableDetail, Settings
│   ├── components/          # TableCard, ItemGrid, Toast, OnlineBadge, ConfirmModal
│   ├── utils/               # currency, totals
│   └── styles/theme.css
└── shared/                  # Types shared main ↔ renderer (Table, Recipe, ReceiptPayload, IPC)
```

## Scope

v1 is focused on **tables, orders and printing**. Recipes, ingredients, expenses and daily-sales management remain in the mobile app; the desktop reads recipes and categories from the same Firestore data.

## Roadmap (post-v1)

- Auto-update via electron-updater.
- Code signing (Windows + macOS notarization).
- Partial payment UI / item-level payment splitting (already supported in the data model).
- Daily sales summary dashboard.
- Linux build.
