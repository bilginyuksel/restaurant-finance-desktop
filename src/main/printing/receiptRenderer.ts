import { ThermalPrinter } from 'node-thermal-printer';
import { ReceiptPayload } from '../../shared/receipt';
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
  p.println(s('ADİSYON / FİŞ'));
  p.drawLine();

  p.alignLeft();
  p.println(s(`Masa  : ${r.tableName}`));
  p.println(s(`Tarih : ${r.timestamp}`));
  if (r.waiterName) p.println(s(`Garson: ${r.waiterName}`));
  p.drawLine();

  p.tableCustom([
    { text: 'Adet', align: 'LEFT', width: 0.12 },
    { text: s('Ürün'), align: 'LEFT', width: 0.58 },
    { text: 'Tutar', align: 'RIGHT', width: 0.3 },
  ]);
  p.drawLine();

  for (const item of r.items) {
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
