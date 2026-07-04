import { ThermalPrinter } from 'node-thermal-printer';
import { ReceiptPayload } from '../../shared/receipt';
import { sanitizeForPrinter } from './textSanitize';

const s = sanitizeForPrinter;

export function renderKitchenTicket(p: ThermalPrinter, r: ReceiptPayload): void {
  p.alignCenter();
  p.setTextQuadArea();
  p.bold(true);
  p.println(s(`MASA ${r.tableName}`));
  p.bold(false);
  p.setTextNormal();
  p.println(s('MUTFAK FİŞİ'));
  p.drawLine();

  p.alignLeft();
  p.println(s(`Tarih : ${r.timestamp}`));
  if (r.waiterName) p.println(s(`Garson: ${r.waiterName}`));
  p.drawLine();

  for (const item of r.items) {
    if (item.cancelled) {
      p.setTextNormal();
      p.bold(true);
      p.drawLine();
      p.println('*** IPTAL ***');
      p.setTextDoubleHeight();
      const qty = item.unitLabel ? `${item.quantity}${item.unitLabel}` : `${item.quantity}x`;
      p.println(s(`- ${qty}  ${item.name}`));
      p.setTextNormal();
      if (item.note) {
        p.println(s(`   * ${item.note}`));
      }
      if (item.variations?.length) {
        for (const v of item.variations) {
          p.println(s(`   - ${v}`));
        }
      }
      p.drawLine();
      p.bold(false);
      continue;
    }
    p.setTextDoubleHeight();
    p.bold(true);
    const qty = item.unitLabel ? `${item.quantity}${item.unitLabel}` : `${item.quantity}x`;
    p.println(s(`${qty}  ${item.name}`));
    p.bold(false);
    p.setTextNormal();
    if (item.note) {
      p.println(s(`   * ${item.note}`));
    }
    if (item.variations?.length) {
      for (const v of item.variations) {
        p.println(s(`   - ${v}`));
      }
    }
  }

  if (r.orderNote) {
    p.drawLine();
    p.bold(true);
    p.println(s(`NOT: ${r.orderNote}`));
    p.bold(false);
  }

  p.drawLine();
  p.alignCenter();
  p.setTextQuadArea();
  p.bold(true);
  p.println(s(`#${r.orderNumber ?? '-'}`));
  p.bold(false);
  p.setTextNormal();
  p.alignLeft();
  // Feed several lines so the order number clears the head-to-cutter gap;
  // otherwise the last printed line sits in the dead zone and gets cut away.
  p.newLine();
  p.newLine();
  p.newLine();
}
