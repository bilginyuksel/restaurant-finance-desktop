/**
 * Replace characters that aren't reliably printable on the configured ESC/POS
 * code page with safe ASCII equivalents.
 *
 * In theory PC857 (Turkish) covers ç ğ ı İ ö ş ü, but in practice many
 * Epson/Star clones either don't honor `ESC t 13` or use a different index for
 * PC857, so Turkish capitals like `Ş` and `İ` come out as Kanji or wrong
 * glyphs. Until we can verify the printer's actual code page we transliterate
 * Turkish letters to ASCII (`Ş → S`, `İ → I`, …). Flip
 * `ASCII_FALLBACK_FOR_TURKISH` to false once the code page is confirmed.
 */
const ASCII_FALLBACK_FOR_TURKISH = true;

const TURKISH_TO_ASCII: Record<string, string> = {
  '\u00C7': 'C', // Ç
  '\u00E7': 'c', // ç
  '\u011E': 'G', // Ğ
  '\u011F': 'g', // ğ
  '\u0130': 'I', // İ
  '\u0131': 'i', // ı
  '\u00D6': 'O', // Ö
  '\u00F6': 'o', // ö
  '\u015E': 'S', // Ş
  '\u015F': 's', // ş
  '\u00DC': 'U', // Ü
  '\u00FC': 'u', // ü
};

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u20BA/g, 'TL'], // ₺ Turkish Lira sign — not in PC857
  [/\u20AC/g, 'EUR'], // €
  [/\u00A3/g, 'GBP'], // £
  [/\u2013|\u2014/g, '-'], // – —
  [/\u2018|\u2019|\u02BC/g, "'"], // ‘ ’ ʼ
  [/\u201C|\u201D/g, '"'], // “ ”
  [/\u2022/g, '*'], // •
  [/\u2026/g, '...'], // …
  [/\u00A0/g, ' '], // non-breaking space
];

export function sanitizeForPrinter(text: string | undefined | null): string {
  if (!text) return '';
  let out = String(text);
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);
  if (ASCII_FALLBACK_FOR_TURKISH) {
    out = out.replace(/[\u00C7\u00E7\u011E\u011F\u0130\u0131\u00D6\u00F6\u015E\u015F\u00DC\u00FC]/g, (ch) => TURKISH_TO_ASCII[ch] ?? ch);
  }
  return out;
}

/**
 * Format a money amount as `1.234,56 TL` (Turkish convention). If the configured
 * currency is the Turkish Lira sign or "TL" we always emit the "TL" suffix;
 * otherwise we fall back to `<symbol><amount>` after sanitizing the symbol.
 */
export function formatMoney(amount: number, currency: string): string {
  const value = (amount ?? 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const cur = (currency ?? '').trim();
  if (cur === '\u20BA' || cur.toUpperCase() === 'TL' || cur === '') {
    return `${value} TL`;
  }
  return `${sanitizeForPrinter(cur)}${value}`;
}
