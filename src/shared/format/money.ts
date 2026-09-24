/**
 * Costs per output are often a few hundredths of a cent. Rounding those to four
 * decimals prints $0.0000 for work that did happen and makes the parts stop
 * adding up to the whole, so the precision shown scales with the amount.
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd >= 1) return `$${usd.toFixed(2)}`;

  const decimals = Math.min(8, Math.max(2, Math.ceil(-Math.log10(usd)) + 2));
  const trimmed = usd.toFixed(decimals).replace(/(\.\d\d)(\d*?)0+$/, '$1$2');
  return `$${trimmed}`;
}
