/** Paleta 10 barev (index = barva v levelu). Syté, na displeji dobře rozlišitelné. */
export const PALETTE: readonly string[] = [
  '#ff5fae', // růžová
  '#ffd23a', // žlutá
  '#ff8a2a', // oranžová
  '#3fb43a', // zelená
  '#2f9bff', // modrá
  '#7a3fe0', // fialová
  '#ee3344', // červená
  '#1fcab7', // tyrkysová
  '#9a5b32', // hnědá
  '#c3ec4f', // světle zelená
];

/** Symboly pro barvoslepé (︎ vynutí textovou podobu místo emoji na iOS). */
export const SYMBOLS: readonly string[] = ['●', '▲', '■', '◆', '★', '✚', '♥︎', '✖︎', '⬢', '☾︎'];

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
