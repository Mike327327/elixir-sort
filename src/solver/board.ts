/**
 * Kompaktní reprezentace pro solver a generátor.
 * Jednotka = číslo: barva 0–31, skrytá jednotka = barva + HIDDEN.
 * Pravidla jsou stejná jako v core/rules.ts (ověřuje to test solver.test.ts).
 */
import type { Unit } from '../core/types.ts';

export const HIDDEN = 32;

export interface SBoard {
  caps: number[];
  b: number[][];
}

export interface SMove {
  from: number;
  to: number;
  count: number;
  score: number;
}

export function toSBoard(caps: number[], bottles: Unit[][], isHidden: (u: Unit) => boolean): SBoard {
  return {
    caps: caps.slice(),
    b: bottles.map((bottle) => bottle.map((u) => (isHidden(u) ? u.c + HIDDEN : u.c))),
  };
}

/** Plná lahev jedné barvy (skryté jednotky se počítají podle skutečné barvy). */
export function isClosedS(bottle: number[], cap: number): boolean {
  if (bottle.length !== cap || cap === 0) return false;
  const c = bottle[0] % HIDDEN;
  for (let i = 1; i < bottle.length; i++) if (bottle[i] % HIDDEN !== c) return false;
  return true;
}

export function isWonS(caps: number[], b: number[][]): boolean {
  for (let i = 0; i < b.length; i++) {
    if (b[i].length > 0 && !isClosedS(b[i], caps[i])) return false;
  }
  return true;
}

/** Kanonický klíč stavu – pořadí lahví nehraje roli. */
export function boardKey(caps: number[], b: number[][]): string {
  const parts: string[] = new Array(b.length);
  for (let i = 0; i < b.length; i++) {
    let s = String.fromCharCode(48 + caps[i]);
    const bottle = b[i];
    for (let j = 0; j < bottle.length; j++) s += String.fromCharCode(65 + bottle[j]);
    parts[i] = s;
  }
  parts.sort();
  return parts.join('|');
}

/**
 * Platné tahy se skóre pro řazení (vyšší = slibnější).
 * Ořezává zbytečné tahy: přesun celé jednobarevné lahve do prázdné stejné kapacity
 * a opakované tahy do prázdných lahví stejné kapacity.
 */
export function genMoves(caps: number[], b: number[][]): SMove[] {
  const moves: SMove[] = [];
  const n = b.length;
  for (let from = 0; from < n; from++) {
    const src = b[from];
    const len = src.length;
    if (len === 0) continue;
    const top = src[len - 1];
    if (top >= HIDDEN) continue;
    if (isClosedS(src, caps[from])) continue;
    let k = 1;
    while (k < len && src[len - 1 - k] === top) k++;
    const uniform = k === len;
    let emptyCapsSeen = 0;
    for (let to = 0; to < n; to++) {
      if (to === from) continue;
      const dst = b[to];
      const dl = dst.length;
      const space = caps[to] - dl;
      if (space <= 0) continue;
      let score = 0;
      if (dl > 0) {
        if (dst[dl - 1] !== top) continue;
        score += 4;
      } else {
        const bit = 1 << caps[to];
        if (emptyCapsSeen & bit) continue;
        emptyCapsSeen |= bit;
        if (uniform && caps[to] === caps[from]) continue;
        score -= 2;
      }
      const amt = k < space ? k : space;
      if (dl + amt === caps[to]) {
        let targetUniform = true;
        for (let j = 0; j < dl; j++) {
          if (dst[j] % HIDDEN !== top) {
            targetUniform = false;
            break;
          }
        }
        if (targetUniform) score += 8;
      }
      if (amt === k && !uniform) score += 2;
      if (amt === len) score += 1;
      moves.push({ from, to, count: amt, score });
    }
  }
  return moves;
}

/** Provede tah a vrátí nový stav (původní nemění). Odkryje nový vrchol zdroje. */
export function applyS(b: number[][], m: { from: number; to: number; count: number }, caps?: number[]): number[][] {
  const nb = b.slice();
  const src = b[m.from].slice();
  const moved = src.splice(src.length - m.count, m.count);
  if (src.length > 0 && src[src.length - 1] >= HIDDEN) src[src.length - 1] -= HIDDEN;
  nb[m.from] = src;
  let dst = b[m.to].concat(moved);
  // Uzavřená lahev odkryje všechny své skryté jednotky (stejně jako Game.revealTops).
  if (caps && isClosedS(dst, caps[m.to])) dst = dst.map((x) => x % HIDDEN);
  nb[m.to] = dst;
  return nb;
}
