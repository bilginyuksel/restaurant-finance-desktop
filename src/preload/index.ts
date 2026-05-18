import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  CategoryRouting,
  NamedPrinterConfig,
  PrinterConfig,
  PrinterTarget,
  PrintersConfig,
  PrintResult,
  ReceiptPayload,
  SystemPrinter,
} from '../shared/receipt';

const api = {
  printCustomerBill: (payload: ReceiptPayload): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.PRINT_CUSTOMER, payload),

  printKitchenTicket: (payload: ReceiptPayload): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.PRINT_KITCHEN, payload),

  printKitchenTo: (printerId: string, payload: ReceiptPayload): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.PRINT_KITCHEN_TO, printerId, payload),

  testPrint: (target: PrinterTarget): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.PRINT_TEST, target),

  testPrintById: (printerId: string): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.PRINT_TEST_BY_ID, printerId),

  getPrinters: (): Promise<PrintersConfig> => ipcRenderer.invoke(IPC.SETTINGS_GET_PRINTERS),

  setPrinter: (target: PrinterTarget, config: PrinterConfig): Promise<PrintersConfig> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET_PRINTER, target, config),

  listSystemPrinters: (): Promise<SystemPrinter[]> =>
    ipcRenderer.invoke(IPC.SETTINGS_LIST_SYSTEM_PRINTERS),

  getExtraPrinters: (): Promise<Record<string, NamedPrinterConfig>> =>
    ipcRenderer.invoke(IPC.SETTINGS_GET_EXTRA_PRINTERS),

  setExtraPrinter: (config: NamedPrinterConfig): Promise<Record<string, NamedPrinterConfig>> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET_EXTRA_PRINTER, config),

  deleteExtraPrinter: (id: string): Promise<Record<string, NamedPrinterConfig>> =>
    ipcRenderer.invoke(IPC.SETTINGS_DELETE_EXTRA_PRINTER, id),

  getCategoryRouting: (): Promise<CategoryRouting> =>
    ipcRenderer.invoke(IPC.SETTINGS_GET_CATEGORY_ROUTING),

  setCategoryRouting: (routing: CategoryRouting): Promise<CategoryRouting> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET_CATEGORY_ROUTING, routing),

  getRestaurantId: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_GET_RESTAURANT_ID),

  setRestaurantId: (id: string): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_SET_RESTAURANT_ID, id),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
