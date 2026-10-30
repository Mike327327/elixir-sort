import type { Bottle, Move, Unit } from './types.ts';

/** Vrací true, pokud je jednotka (zatím) skrytá. */
export type HiddenFn = (u: Unit) => boolean;

export interface TopBlock {
  color: number;
  count: number;
}

/**
 * Souvislý blok stejné barvy z vrcholu lahve.
 * Blok končí u jiné barvy nebo u skryté jednotky (skrytá se nepřelévá s ostatními).
 */
export function topBlock(bottle: Bottle, isHidden: HiddenFn): TopBlock | null {
  const n = bottle.length;
  if (n === 0) return null;
  const top = bottle[n - 1];
  if (isHidden(top)) return null;
  let count = 1;
  for (let i = n - 2; i >= 0; i--) {
    const u = bottle[i];
    if (u.c !== top.c || isHidden(u)) break;
    count++;
  }
  return { color: top.c, count };
}

/**
 * Lahev je plná jedné barvy → má zátku a nejde s ní hýbat.
 * Skryté jednotky se počítají podle skutečné barvy; při uzavření se odkryjí (viz Game).
 */
export function isClosed(bottle: Bottle, cap: number): boolean {
  if (bottle.length !== cap || cap === 0) return false;
  const c = bottle[0].c;
  for (const u of bottle) {
    if (u.c !== c) return false;
  }
  return true;
}

/** Kolik jednotek by se přelilo z `from` do `to` (0 = tah není platný). */
export function pourAmount(
  bottles: Bottle[],
  caps: number[],
  from: number,
  to: number,
  isHidden: HiddenFn,
): number {
  if (from === to) return 0;
  const src = bottles[from];
  const dst = bottles[to];
  if (!src || !dst) return 0;
  if (src.length === 0) return 0;
  if (isClosed(src, caps[from])) return 0;
  const space = caps[to] - dst.length;
  if (space <= 0) return 0;
  const block = topBlock(src, isHidden);
  if (!block) return 0;
  if (dst.length > 0) {
    const dTop = dst[dst.length - 1];
    if (isHidden(dTop) || dTop.c !== block.color) return 0;
  }
  return Math.min(block.count, space);
}

/** Provede přelití (mutuje pole lahví). Vrací tah nebo null, pokud není platný. */
export function applyPour(
  bottles: Bottle[],
  caps: number[],
  from: number,
  to: number,
  isHidden: HiddenFn,
): Move | null {
  const count = pourAmount(bottles, caps, from, to, isHidden);
  if (count === 0) return null;
  const moved = bottles[from].splice(bottles[from].length - count, count);
  bottles[to].push(...moved);
  return { from, to, count };
}

/** Vrátí tah zpět (mutuje). Jednotky si drží identitu, takže je to přesná inverze. */
export function revertPour(bottles: Bottle[], move: Move): void {
  const src = bottles[move.to];
  const moved = src.splice(src.length - move.count, move.count);
  bottles[move.from].push(...moved);
}

/** Výhra: každá neprázdná lahev je plná jedné barvy a uzavřená. */
export function isWon(bottles: Bottle[], caps: number[]): boolean {
  for (let i = 0; i < bottles.length; i++) {
    const b = bottles[i];
    if (b.length === 0) continue;
    if (!isClosed(b, caps[i])) return false;
  }
  return true;
}

/** Všechny platné tahy. */
export function listMoves(bottles: Bottle[], caps: number[], isHidden: HiddenFn): Move[] {
  const out: Move[] = [];
  for (let from = 0; from < bottles.length; from++) {
    for (let to = 0; to < bottles.length; to++) {
      const count = pourAmount(bottles, caps, from, to, isHidden);
      if (count > 0) out.push({ from, to, count });
    }
  }
  return out;
}

export function hasAnyMove(bottles: Bottle[], caps: number[], isHidden: HiddenFn): boolean {
  for (let from = 0; from < bottles.length; from++) {
    for (let to = 0; to < bottles.length; to++) {
      if (pourAmount(bottles, caps, from, to, isHidden) > 0) return true;
    }
  }
  return false;
}

/** Nejčastější kapacita (při shodě větší) – pro pomocníka +1 lahev. */
export function mostCommonCapacity(caps: number[]): number {
  const counts = new Map<number, number>();
  for (const c of caps) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best = 4;
  let bestCount = -1;
  for (const [cap, count] of counts) {
    if (count > bestCount || (count === bestCount && cap > best)) {
      best = cap;
      bestCount = count;
    }
  }
  return best;
}
