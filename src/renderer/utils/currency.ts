// Module-level formatter: constructing Intl.NumberFormat is expensive, so we
// cache one per (symbol) and reuse across all calls.
const formatters = new Map<string, Intl.NumberFormat>();
const getFormatter = (): Intl.NumberFormat => {
  let f = formatters.get('default');
  if (!f) {
    f = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set('default', f);
  }
  return f;
};

export const formatCurrency = (n: number, symbol = '₺'): string => {
  return `${symbol}${getFormatter().format(n ?? 0)}`;
};

export const CURRENCY = '₺';
