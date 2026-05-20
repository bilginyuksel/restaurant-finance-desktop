import Store from 'electron-store';
import crypto from 'node:crypto';
import {
  CategoryRouting,
  NamedPrinterConfig,
  PrinterConfig,
  PrintersConfig,
  PrinterTarget,
} from '../../shared/receipt';

interface Schema {
  printers: PrintersConfig;
  extraPrinters: Record<string, NamedPrinterConfig>;
  categoryRouting: CategoryRouting;
  restaurantId: string;
  deviceTag?: string;
  orderCounter?: { date: string; seq: number };
}

const defaultPrinter: PrinterConfig = {
  enabled: false,
  type: 'epson',
  interface: 'tcp://192.168.1.100',
  characterSet: 'PC857_TURKISH',
  width: 42,
  cashDrawer: false,
};

const store = new Store<Schema>({
  name: 'restaurant-finance-desktop',
  defaults: {
    printers: {
      customer: { ...defaultPrinter },
      kitchen: { ...defaultPrinter },
    },
    extraPrinters: {},
    categoryRouting: {},
    restaurantId: 'restaurant-1',
  },
});

export const settingsStore = {
  getPrinters(): PrintersConfig {
    return store.get('printers');
  },
  setPrinter(target: PrinterTarget, config: PrinterConfig): void {
    const printers = store.get('printers');
    printers[target] = config;
    store.set('printers', printers);
  },

  getExtraPrinters(): Record<string, NamedPrinterConfig> {
    return store.get('extraPrinters') ?? {};
  },
  setExtraPrinter(config: NamedPrinterConfig): void {
    const extras = store.get('extraPrinters') ?? {};
    extras[config.id] = config;
    store.set('extraPrinters', extras);
  },
  deleteExtraPrinter(id: string): void {
    const extras = store.get('extraPrinters') ?? {};
    delete extras[id];
    store.set('extraPrinters', extras);
    // Also remove any category routing pointing to it.
    const routing = store.get('categoryRouting') ?? {};
    let changed = false;
    for (const cat of Object.keys(routing)) {
      if (routing[cat] === id) {
        delete routing[cat];
        changed = true;
      }
    }
    if (changed) store.set('categoryRouting', routing);
  },

  getCategoryRouting(): CategoryRouting {
    return store.get('categoryRouting') ?? {};
  },
  setCategoryRouting(routing: CategoryRouting): void {
    store.set('categoryRouting', routing);
  },

  /**
   * Resolve a printer config by id. id can be 'customer', 'kitchen', or an extra printer id.
   * Returns null if not found / not enabled.
   */
  resolvePrinter(id: string): PrinterConfig | null {
    if (id === 'customer' || id === 'kitchen') {
      return store.get('printers')[id] ?? null;
    }
    const extras = store.get('extraPrinters') ?? {};
    return extras[id] ?? null;
  },

  getRestaurantId(): string {
    return store.get('restaurantId');
  },
  setRestaurantId(id: string): void {
    store.set('restaurantId', id);
  },

  getOrCreateDeviceTag(): string {
    let tag = store.get('deviceTag');
    if (!tag) {
      // 3-char base32-ish uppercase tag from random UUID
      tag = crypto.randomUUID().replace(/-/g, '').slice(0, 3).toUpperCase();
      store.set('deviceTag', tag);
    }
    return tag;
  },

  setDeviceTag(tag: string): void {
    store.set('deviceTag', tag.trim().toUpperCase().slice(0, 10)); // limit length safely
  },

  nextOrderNumber(): { orderNumber: string; seq: number; date: string; tag: string } {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let counter = store.get('orderCounter');

    if (!counter || counter.date !== today) {
      counter = { date: today, seq: 0 };
    }

    counter.seq += 1;
    store.set('orderCounter', counter); // persists synchronously

    const tag = this.getOrCreateDeviceTag();
    const seqStr = String(counter.seq).padStart(3, '0');
    
    const orderNumber = `${tag}-${seqStr}`;
    return { orderNumber, seq: counter.seq, date: counter.date, tag };
  }
};
