/**
 * Paleta 12 barev (index = barva v levelu). Pastelové, ale rozlišené i světlostí, aby se na displeji
 * nepletly: nejmenší vzájemná vzdálenost ΔE2000 je 18,7 (žlutá/světle zelená, zelená/tyrkysová).
 * Levely s méně barvami berou barvy od začátku seznamu.
 */
export const PALETTE: readonly string[] = [
  '#f8a5d6', // růžová
  '#ffd95e', // žlutá
  '#ffa463', // oranžová
  '#56b47c', // zelená
  '#78b0f7', // modrá
  '#a88af5', // fialová
  '#ec6a6e', // červená
  '#76dbd3', // tyrkysová
  '#9c7558', // hnědá
  '#c6ef78', // světle zelená
  '#b0507a', // vínová
  '#f6f2fb', // mléčně bílá
];

/** Symboly pro barvoslepé (︎ vynutí textovou podobu místo emoji na iOS). */
export const SYMBOLS: readonly string[] = ['●', '▲', '■', '◆', '★', '✚', '♥︎', '✖︎', '⬢', '☾︎', '♣︎', '♠︎'];

export const HIDDEN_COLOR = '#4b4459';

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Zesvětlí (amount > 0) nebo ztmaví (amount < 0) barvu, amount v rozsahu -1..1. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amount >= 0) return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  return toHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
}

export function colorOf(c: number): string {
  return PALETTE[c % PALETTE.length];
}
