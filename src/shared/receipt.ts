export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unitLabel?: string;
  unitPrice: number;
  lineTotal: number;
  note?: string;
  /** When true the line represents a cancelled/removed item from an edited order. */
  cancelled?: boolean;
  variations?: string[];
}

export interface ReceiptPayload {
  kind: 'customer' | 'kitchen';
  restaurantName?: string;
  tableName: string;
  timestamp: string;
  items: ReceiptLineItem[];
  total: number;
  currency: string;
  waiterName?: string;
  orderNote?: string;
  orderNumber?: string;
}

export type PrinterTarget = 'customer' | 'kitchen';

export interface PrinterConfig {
  enabled: boolean;
  type: 'epson' | 'star';
  interface: string;
  characterSet?: string;
  width?: number;
  cashDrawer?: boolean;
}

export type PrintersConfig = Record<PrinterTarget, PrinterConfig>;

/** A user-defined extra (kitchen-style) printer, keyed by id in settings store. */
export interface NamedPrinterConfig extends PrinterConfig {
  id: string;
  name: string;
}

/** category name -> printer id ('kitchen' | 'customer' | extra-printer id) */
export type CategoryRouting = Record<string, string>;

/** A printer enumerated from the OS via Electron's webContents.getPrintersAsync(). */
export interface SystemPrinter {
  name: string;
  displayName?: string;
  description?: string;
  status?: number;
  isDefault?: boolean;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}
