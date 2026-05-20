import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { IPC } from '../shared/ipc';
import {
  ReceiptPayload,
  PrinterTarget,
  PrinterConfig,
  PrintersConfig,
  PrintResult,
  NamedPrinterConfig,
  CategoryRouting,
  SystemPrinter,
} from '../shared/receipt';
import { PrinterService } from './printing/PrinterService';
import { settingsStore } from './settings/store';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    height: 900,
    width: 1440,
    minWidth: 1024,
    minHeight: 700,
    title: 'Restaurant Finance Desktop',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

const registerIpc = () => {
  ipcMain.handle(IPC.PRINT_CUSTOMER, async (_e, payload: ReceiptPayload): Promise<PrintResult> => {
    try {
      await PrinterService.print('customer', { ...payload, kind: 'customer' });
      return { ok: true };
    } catch (err) {
      console.error('print:customer failed', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.PRINT_KITCHEN, async (_e, payload: ReceiptPayload): Promise<PrintResult> => {
    try {
      await PrinterService.print('kitchen', { ...payload, kind: 'kitchen' });
      return { ok: true };
    } catch (err) {
      console.error('print:kitchen failed', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.PRINT_TEST, async (_e, target: PrinterTarget): Promise<PrintResult> => {
    try {
      await PrinterService.testPrint(target);
      return { ok: true };
    } catch (err) {
      console.error('print:test failed', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.PRINT_TEST_BY_ID, async (_e, printerId: string): Promise<PrintResult> => {
    try {
      await PrinterService.testPrintById(printerId);
      return { ok: true };
    } catch (err) {
      console.error('print:testById failed', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.PRINT_KITCHEN_TO, async (_e, printerId: string, payload: ReceiptPayload): Promise<PrintResult> => {
    try {
      await PrinterService.printKitchenTo(printerId, payload);
      return { ok: true };
    } catch (err) {
      console.error('print:kitchenTo failed', err);
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle(IPC.SETTINGS_LIST_SYSTEM_PRINTERS, async (e): Promise<SystemPrinter[]> => {
    try {
      const wc = e.sender;
      const list = await wc.getPrintersAsync();
      return list.map((p) => {
        const raw = p as unknown as Record<string, unknown>;
        return {
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          status: typeof raw.status === 'number' ? (raw.status as number) : undefined,
          isDefault: typeof raw.isDefault === 'boolean' ? (raw.isDefault as boolean) : undefined,
        };
      });
    } catch (err) {
      console.error('settings:listSystemPrinters failed', err);
      return [];
    }
  });

  ipcMain.handle(IPC.SETTINGS_GET_EXTRA_PRINTERS, (): Record<string, NamedPrinterConfig> => settingsStore.getExtraPrinters());

  ipcMain.handle(IPC.SETTINGS_SET_EXTRA_PRINTER, (_e, config: NamedPrinterConfig): Record<string, NamedPrinterConfig> => {
    settingsStore.setExtraPrinter(config);
    return settingsStore.getExtraPrinters();
  });

  ipcMain.handle(IPC.SETTINGS_DELETE_EXTRA_PRINTER, (_e, id: string): Record<string, NamedPrinterConfig> => {
    settingsStore.deleteExtraPrinter(id);
    return settingsStore.getExtraPrinters();
  });

  ipcMain.handle(IPC.SETTINGS_GET_CATEGORY_ROUTING, (): CategoryRouting => settingsStore.getCategoryRouting());

  ipcMain.handle(IPC.SETTINGS_SET_CATEGORY_ROUTING, (_e, routing: CategoryRouting): CategoryRouting => {
    settingsStore.setCategoryRouting(routing);
    return settingsStore.getCategoryRouting();
  });

  ipcMain.handle(IPC.SETTINGS_GET_PRINTERS, (): PrintersConfig => settingsStore.getPrinters());

  ipcMain.handle(IPC.SETTINGS_SET_PRINTER, (_e, target: PrinterTarget, config: PrinterConfig): PrintersConfig => {
    settingsStore.setPrinter(target, config);
    return settingsStore.getPrinters();
  });

  ipcMain.handle(IPC.SETTINGS_GET_RESTAURANT_ID, (): string => settingsStore.getRestaurantId());

  ipcMain.handle(IPC.SETTINGS_SET_RESTAURANT_ID, (_e, id: string): string => {
    settingsStore.setRestaurantId(id);
    return settingsStore.getRestaurantId();
  });

  ipcMain.handle(IPC.ORDER_NEXT_NUMBER, () => {
    return settingsStore.nextOrderNumber();
  });

  ipcMain.handle(IPC.ORDER_GET_DEVICE_TAG, () => {
    return settingsStore.getOrCreateDeviceTag();
  });

  ipcMain.handle(IPC.ORDER_SET_DEVICE_TAG, (_e, tag: string) => {
    settingsStore.setDeviceTag(tag);
    return settingsStore.getOrCreateDeviceTag();
  });
};

app.on('ready', () => {
  // Firebase API keys with HTTP-referrer restrictions reject requests from Electron
  // because there is no Referer header. Inject the authDomain so the key is accepted.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://identitytoolkit.googleapis.com/*', 'https://securetoken.googleapis.com/*', 'https://firestore.googleapis.com/*', 'https://*.firebaseio.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://restaurant-finance.firebaseapp.com/';
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  // Override the CSP injected by webpack-dev-server (which strips Firebase endpoints).
  // The renderer document's CSP from index.html is ignored when the dev server sends
  // its own Content-Security-Policy header, so we replace it here.
  // Only apply to top-level navigations & sub_frame loads — API responses don't need CSP.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['<all_urls>'], types: ['mainFrame', 'subFrame'] },
    (details, callback) => {
      const csp =
        "default-src 'self' 'unsafe-inline' data: blob:; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' data: https://fonts.gstatic.com; " +
        "img-src 'self' data: blob: https:; " +
        "connect-src 'self' " +
        'https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com ' +
        'wss://*.firebaseio.com wss://*.googleapis.com ' +
        'https://*.cloudfunctions.net https://firebaseinstallations.googleapis.com ' +
        'https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ' +
        'https://firestore.googleapis.com https://www.googleapis.com https://firebaselogging-pa.googleapis.com;';
      const headers = { ...details.responseHeaders };
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'content-security-policy') {
          delete headers[key];
        }
      }
      headers['Content-Security-Policy'] = [csp];
      callback({ responseHeaders: headers });
    },
  );

  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Avoid unused-var error for path import in some configs
void path;
