import {
  ThermalPrinter,
  PrinterTypes,
  CharacterSet,
} from "node-thermal-printer";
import { spawn } from "node:child_process";
import {
  PrinterConfig,
  PrinterTarget,
  ReceiptPayload,
} from "../../shared/receipt";
import { settingsStore } from "../settings/store";
import { renderCustomerBill } from "./receiptRenderer";
import { renderKitchenTicket } from "./kitchenTicketRenderer";

/**
 * Send raw ESC/POS bytes to a CUPS printer via `lp -o raw`.
 * Avoids any native printer module — relies only on the system `lp` binary,
 * which is already used by macOS's Cmd+P flow.
 */
function sendToCups(printerName: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("lp", ["-d", printerName, "-o", "raw"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `lp exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
    });
    child.stdin.end(data);
  });
}

/** Returns the CUPS printer name if the interface is `printer:NAME`, else null. */
function cupsNameFromInterface(iface: string): string | null {
  return iface.startsWith("printer:") ? iface.slice("printer:".length) : null;
}

/**
 * Finalize a print job: cut, then either let node-thermal-printer write
 * directly (tcp/serial) or hand the buffered ESC/POS bytes to `lp`.
 */
async function dispatch(printer: ThermalPrinter, iface: string): Promise<void> {
  printer.cut();
  const cupsName = cupsNameFromInterface(iface);
  if (cupsName) {
    const buffer = printer.getBuffer();
    await sendToCups(cupsName, buffer);
    return;
  }
  await printer.execute();
}

function buildPrinterFromConfig(
  cfg: PrinterConfig,
  label: string,
): ThermalPrinter {
  if (!cfg.enabled) {
    throw new Error(
      `Yazıcı yapılandırılmamış (${label}). Ayarlar > Yazıcılar ekranından etkinleştirin.`,
    );
  }
  const type = cfg.type === "star" ? PrinterTypes.STAR : PrinterTypes.EPSON;
  const characterSet =
    (CharacterSet as Record<string, CharacterSet>)[
      cfg.characterSet ?? "PC857_TURKISH"
    ] ?? CharacterSet.PC857_TURKISH;

  // For CUPS targets we don't let node-thermal-printer touch the wire — we
  // only use it to build the ESC/POS byte buffer, then shell out to `lp`.
  // Passing `printer:NAME` here would force it to load its native Printer
  // driver, so we substitute a dummy tcp interface that's never opened.
  const iface = cupsNameFromInterface(cfg.interface)
    ? "tcp://127.0.0.1:9100"
    : cfg.interface;

  return new ThermalPrinter({
    type,
    interface: iface,
    characterSet,
    width: cfg.width ?? 42,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
  });
}

/**
 * Emit a small prelude that prevents Turkish bytes (0x80–0xFF in PC857) from
 * being interpreted as the first half of a multibyte Kanji character. Many
 * Epson/Star ESC/POS clones power on with Kanji character mode enabled, which
 * causes letters like `Ş` (0x9E in PC857) to render as Japanese glyphs.
 *
 *   FS .  (0x1C 0x2E) — Cancel Kanji character mode
 *   ESC t 13 (0x1B 0x74 0x0D) — Re-select PC857 (Turkish) just in case
 */
function emitTurkishPrelude(printer: ThermalPrinter): void {
  printer.raw(Buffer.from([0x1c, 0x2e, 0x1b, 0x74, 0x0d]));
}

export const PrinterService = {
  async print(target: PrinterTarget, payload: ReceiptPayload): Promise<void> {
    const cfg = settingsStore.getPrinters()[target];
    const printer = buildPrinterFromConfig(cfg, target);
    emitTurkishPrelude(printer);

    if (payload.kind === "kitchen" || target === "kitchen") {
      renderKitchenTicket(printer, payload);
    } else {
      renderCustomerBill(printer, payload);
    }

    if (cfg.cashDrawer && target === "customer") {
      printer.openCashDrawer();
    }
    await dispatch(printer, cfg.interface);
  },

  /**
   * Print a kitchen ticket to a specific printer (built-in 'kitchen'/'customer' or extra printer id).
   */
  async printKitchenTo(
    printerId: string,
    payload: ReceiptPayload,
  ): Promise<void> {
    const cfg = settingsStore.resolvePrinter(printerId);
    if (!cfg) {
      throw new Error(`Yazıcı bulunamadı: ${printerId}`);
    }
    const printer = buildPrinterFromConfig(cfg, printerId);
    emitTurkishPrelude(printer);
    renderKitchenTicket(printer, { ...payload, kind: "kitchen" });
    await dispatch(printer, cfg.interface);
  },

  async testPrint(target: PrinterTarget): Promise<void> {
    const sample: ReceiptPayload = {
      kind: target,
      restaurantName: "HobiPark",
      tableName: "TEST",
      timestamp: new Date().toLocaleString("tr-TR"),
      currency: "₺",
      total: 123.45,
      items: [
        { name: "Test Ürün 1", quantity: 2, unitPrice: 50, lineTotal: 100 },
        {
          name: "Test Ürün 2",
          quantity: 1,
          unitPrice: 23.45,
          lineTotal: 23.45,
        },
      ],
      waiterName: "Test",
    };
    await this.print(target, sample);
  },

  async testPrintById(printerId: string): Promise<void> {
    const sample: ReceiptPayload = {
      kind: "kitchen",
      tableName: "TEST",
      timestamp: new Date().toLocaleString("tr-TR"),
      currency: "₺",
      total: 0,
      items: [{ name: "Test Ürün", quantity: 1, unitPrice: 0, lineTotal: 0 }],
      waiterName: "Test",
    };
    await this.printKitchenTo(printerId, sample);
  },
};
