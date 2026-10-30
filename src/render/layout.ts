/**
 * Rozložení lahví na hrací ploše. Závisí jen na kapacitách (ne na obsahu),
 * takže se během hry nemění. Lahve podobné výšky se řadí do stejné řady,
 * aby se i 26 lahví s různými kapacitami vešlo na iPhone SE.
 */

export interface BottleGeom {
  w: number;
  u: number;
  cap: number;
  /** Výška límce u hrdla. */
  rimH: number;
  /** Tloušťka skla. */
  t: number;
  /** Vnitřní šířka (tekutina). */
  innerW: number;
  /** Celková výška lahve. */
  h: number;
  /** Lokální y dna tekutiny (od vrcholu límce). */
  liquidBottom: number;
  /** Poloměr zakulacení dna. */
  r: number;
}

export interface Slot extends BottleGeom {
  /** Střed lahve v ose x (CSS px). */
  x: number;
  /** Horní okraj límce (CSS px). */
  y: number;
}

export interface Layout {
  slots: Slot[];
  /** Šířka lahve (stejná pro všechny). */
  w: number;
  u: number;
  rows: number;
}

/** Poměry tvaru lahve vůči šířce. */
const RIM = 0.1;
const NECK = 0.24;
const GLASS = 0.075;
const LIFT = 0.12;

export function bottleGeom(w: number, u: number, cap: number): BottleGeom {
  const rimH = w * RIM;
  const t = Math.max(1.5, w * GLASS);
  const liquidBottom = rimH + w * NECK + cap * u;
  return {
    w,
    u,
    cap,
    rimH,
    t,
    innerW: w - 2 * t,
    h: liquidBottom + t,
    liquidBottom,
    r: w * 0.38,
  };
}

const heightFactor = (k: number, cap: number) => RIM + NECK + GLASS + cap * k;

export interface LayoutOptions {
  /** Max šířka lahve v px. */
  maxW?: number;
  /** Min/max poměr výšky jednotky k šířce lahve. */
  kMin?: number;
  kMax?: number;
  gapRatio?: number;
  rowGapRatio?: number;
  sidePad?: number;
}

export function computeLayout(caps: number[], width: number, height: number, opts: LayoutOptions = {}): Layout {
  const maxW = opts.maxW ?? 76;
  const kMin = opts.kMin ?? 0.42;
  const kMax = opts.kMax ?? 0.72;
  const gapRatio = opts.gapRatio ?? 0.36;
  const rowGapRatio = opts.rowGapRatio ?? 0.32;
  const sidePad = opts.sidePad ?? 10;
  const n = caps.length;
  if (n === 0) return { slots: [], w: 0, u: 0, rows: 0 };

  // Lahve seřazené podle kapacity (sestupně, stabilně) → podobné výšky v jedné řadě.
  const order = caps.map((_, i) => i).sort((a, b) => caps[b] - caps[a] || a - b);

  let best: { w: number; k: number; rows: number[][] } | null = null;
  const maxRows = Math.min(6, n);
  for (let r = 1; r <= maxRows; r++) {
    const base = Math.floor(n / r);
    const extra = n % r;
    const rows: number[][] = [];
    let p = 0;
    for (let i = 0; i < r; i++) {
      const size = base + (i < extra ? 1 : 0);
      rows.push(order.slice(p, p + size).sort((a, b) => a - b));
      p += size;
    }
    const perRow = Math.max(...rows.map((x) => x.length));
    if (perRow > 9) continue;
    const wByWidth = (width - 2 * sidePad) / (perRow + (perRow - 1) * gapRatio);
    const maxCaps = rows.map((row) => Math.max(...row.map((i) => caps[i])));
    // Výška = Σ řad (výška lahve × (1 + zdvih)) + mezery mezi řadami.
    const heightFor = (k: number) =>
      maxCaps.reduce((s, c) => s + heightFactor(k, c) * (1 + LIFT), 0) + (r - 1) * rowGapRatio;
    let k = kMax;
    let w = Math.min(maxW, wByWidth, height / heightFor(k));
    if (w < Math.min(maxW, wByWidth)) {
      // Výška je úzké hrdlo: sniž výšku jednotky, dokud se šířka nevyrovná.
      const target = Math.min(maxW, wByWidth);
      let lo = kMin;
      let hi = kMax;
      for (let it = 0; it < 20; it++) {
        const mid = (lo + hi) / 2;
        if (height / heightFor(mid) >= target) lo = mid;
        else hi = mid;
      }
      k = lo;
      w = Math.min(target, height / heightFor(k));
    }
    if (!best || w > best.w + 0.5) best = { w, k, rows };
  }
  if (!best) best = { w: 24, k: kMin, rows: [order] };

  const w = Math.floor(best.w * 2) / 2;
  const u = Math.floor(w * best.k * 2) / 2;
  const gap = Math.max(6, w * gapRatio);
  const rowGap = w * rowGapRatio;
  const rowHeights = best.rows.map((row) => {
    const g = bottleGeom(w, u, Math.max(...row.map((i) => caps[i])));
    return g.h * (1 + LIFT);
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0) + (best.rows.length - 1) * rowGap;
  let y = Math.max(0, (height - totalH) / 2);

  const slots: Slot[] = new Array(n);
  best.rows.forEach((row, ri) => {
    const rowH = rowHeights[ri];
    const rowW = row.length * w + (row.length - 1) * gap;
    let x = (width - rowW) / 2 + w / 2;
    const bottomY = y + rowH; // lahve zarovnané dnem
    for (const i of row) {
      const g = bottleGeom(w, u, caps[i]);
      slots[i] = { ...g, x, y: bottomY - g.h };
      x += w + gap;
    }
    y += rowH + rowGap;
  });
  return { slots, w, u, rows: best.rows.length };
}

/** Index lahve pod bodem (s okrajem pro snadné trefení), nebo -1. */
export function hitTest(slots: Slot[], px: number, py: number, liftOf: (i: number) => number = () => 0): number {
  const margin = 8;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const top = s.y - liftOf(i) - margin;
    const bottom = s.y + s.h + margin;
    const halfW = s.w / 2 + margin;
    if (px >= s.x - halfW && px <= s.x + halfW && py >= top && py <= bottom) {
      const d = Math.abs(px - s.x);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}
