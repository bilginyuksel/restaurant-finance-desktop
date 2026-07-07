import { ThermalPrinter } from 'node-thermal-printer';
import { ReceiptPayload, ReceiptLineItem } from '../../shared/receipt';
import { sanitizeForPrinter, formatMoney } from './textSanitize';

const money = (n: number, currency: string) => formatMoney(n, currency);

const s = sanitizeForPrinter;

export function renderCustomerBill(p: ThermalPrinter, r: ReceiptPayload): void {
  // Leading feed doubles as sacrificial data: a printer waking from the
  // previous job's cut frequently drops the first line it prints while the
  // head/motor spins up, which was intermittently swallowing the "HobiPark"
  // header on repeated prints. Feeding a blank line first ensures the styled
  // header always makes it onto the paper.
  p.newLine();

  p.alignCenter();
  p.setTextDoubleHeight();
  p.bold(true);
  p.println(s(r.restaurantName ?? 'HobiPark'));
  p.setTextNormal();
  p.println(s(`MASA ${r.tableName}`));
  p.bold(false);

  p.drawLine();

  p.alignLeft();
  p.println(s(`Fis No : ${r.orderNumber ?? '-'}`));
  p.println(s(`Tarih  : ${r.timestamp}`));
  if (r.waiterName) p.println(s(`Garson : ${r.waiterName}`));
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

  const paid = r.amountPaid ?? 0;
  if (paid > 0) {
    // Show the running total and what has already been settled, then the
    // remaining balance the customer actually owes.
    const remaining = Math.max(0, r.total - paid);
    p.tableCustom([
      { text: s('Ara Toplam'), align: 'LEFT', width: 0.5 },
      { text: money(r.total, r.currency), align: 'RIGHT', width: 0.5 },
    ]);
    p.tableCustom([
      { text: s('Odenen'), align: 'LEFT', width: 0.5 },
      { text: money(paid, r.currency), align: 'RIGHT', width: 0.5 },
    ]);
    p.drawLine();
    p.alignRight();
    p.setTextDoubleWidth();
    p.bold(true);
    p.println(s(`KALAN: ${money(remaining, r.currency)}`));
    p.bold(false);
    p.setTextNormal();
  } else {
    p.alignRight();
    p.setTextDoubleWidth();
    p.bold(true);
    p.println(s(`TOPLAM: ${money(r.total, r.currency)}`));
    p.bold(false);
    p.setTextNormal();
  }

  p.alignCenter();
  p.newLine();
  p.println('Afiyet Olsun!');
  p.newLine();
}
