import React from 'react';
import { Recipe, Table } from '../../shared/types';
import { tableUnpaidTotal } from '../utils/totals';
import { formatCurrency } from '../utils/currency';

interface Props {
  table: Table;
  recipes: ReadonlyMap<string, Recipe> | Recipe[];
  onOpen: (table: Table) => void;
}

export const TableCard: React.FC<Props> = ({ table, recipes, onOpen }) => {
  const total = tableUnpaidTotal(table, recipes);
  const itemCount = (table.orders ?? []).reduce(
    (s, o) => s + (o.items ?? []).reduce((ss, it) => ss + it.quantity, 0),
    0,
  );
  const empty = itemCount === 0 && table.status !== 'closed';
  const billed = !empty && table.receiptPrinted === true;
  const isPlaceholder = table.id.startsWith('preset_');
  const cls = table.status === 'closed' ? 'closed' : empty ? 'empty' : billed ? 'billed' : 'active';

  return (
    <button className={`table-card ${cls}${isPlaceholder ? ' placeholder' : ''}`} onClick={() => onOpen(table)}>
      <div className="name">{table.name}</div>
      <div className="status">
        {table.status === 'closed' ? 'Kapalı' : empty ? 'Boş' : billed ? `Fiş Kesildi · ${itemCount} ürün` : `${itemCount} ürün`}
      </div>
      {!empty && table.status !== 'closed' && (
        <div className="total">{formatCurrency(total)}</div>
      )}
    </button>
  );
};
