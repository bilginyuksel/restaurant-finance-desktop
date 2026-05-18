import Store from 'electron-store';
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
    restaurantId: 'restaurant-2',
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
};
