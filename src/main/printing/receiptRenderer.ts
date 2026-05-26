import { ThermalPrinter } from 'node-thermal-printer';
import { ReceiptPayload, ReceiptLineItem } from '../../shared/receipt';
import { sanitizeForPrinter, formatMoney } from './textSanitize';

const money = (n: number, currency: string) => formatMoney(n, currency);

const s = sanitizeForPrinter;

export function renderCustomerBill(p: ThermalPrinter, r: ReceiptPayload): void {
  p.alignCenter();
  p.setTextDoubleHeight();
  p.bold(true);
  p.println(s(r.restaurantName ?? 'RESTORAN'));
  p.bold(false);
  p.setTextNormal();
  p.println(s(`MASA ${r.tableName}`));

  p.drawLine();

  p.alignLeft();
  p.println(s(`Sipariş No: ${r.orderNumber ?? '-'}`));
  p.println(s(`Masa  : ${r.tableName}`));
  p.println(s(`Tarih : ${r.timestamp}`));
  p.drawLine();

  p.tableCustom([
    { text: 'Adet', align: 'LEFT', width: 0.12 },
    { text: s('Ürün'), align: 'LEFT', width: 0.58 },
    { text: 'Tutar', align: 'RIGHT', width: 0.3 },
  ]);
  p.drawLine();

  const groupedItems = new Map<string, ReceiptLineItem>();
  for (const item of r.items) {
    const key = `${item.name}|${item.unitLabel || ''}|${item.unitPrice}`;
    const existing = groupedItems.get(key);
    if (existing) {
      existing.quantity += item.quantity;
      existing.lineTotal += item.lineTotal;
    } else {
      groupedItems.set(key, { ...item });
    }
  }

  for (const item of groupedItems.values()) {
    const qty = item.unitLabel ? `${item.quantity}${item.unitLabel}` : `${item.quantity}`;
    p.tableCustom([
      { text: s(qty), align: 'LEFT', width: 0.12 },
      { text: s(item.name), align: 'LEFT', width: 0.58 },
      { text: money(item.lineTotal, r.currency), align: 'RIGHT', width: 0.3 },
    ]);
  }

  p.drawLine();
  p.alignRight();
  p.setTextDoubleWidth();
  p.bold(true);
  p.println(`TOPLAM: ${money(r.total, r.currency)}`);
  p.bold(false);
  p.setTextNormal();

  p.alignCenter();
  p.newLine();
  p.println('Afiyet Olsun!');
  p.newLine();
}
