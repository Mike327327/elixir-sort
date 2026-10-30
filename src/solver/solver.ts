import type { Rng } from '../core/rng.ts';
import { applyS, boardKey, genMoves, HIDDEN, isClosedS, isWonS } from './board.ts';

export type SolveStatus = 'solved' | 'unsolvable' | 'limit';

export interface SolveResult {
  status: SolveStatus;
  moves: { from: number; to: number; count: number }[];
  nodes: number;
}

/**
 * Heuristika: počet „rozhraní“ mezi barvami uvnitř lahví + skryté jednotky
 * + barvy rozdělené do více neuzavřených lahví. Ve vyřešeném stavu je 0.
 */
export function heuristic(caps: number[], b: number[][]): number {
  let h = 0;
  const partialByColor = new Map<number, number>();
  for (let i = 0; i < b.length; i++) {
    const bottle = b[i];
    if (bottle.length === 0) continue;
    for (let j = 1; j < bottle.length; j++) {
      if (bottle[j] !== bottle[j - 1]) h++;
      if (bottle[j - 1] >= HIDDEN) h++;
    }
    if (!isClosedS(bottle, caps[i])) {
      const top = bottle[bottle.length - 1] % HIDDEN;
      partialByColor.set(top, (partialByColor.get(top) ?? 0) + 1);
    }
  }
  for (const n of partialByColor.values()) if (n > 1) h += n - 1;
  return h;
}

/** Binární halda (min) nad čísly priorit. */
class MinHeap<T> {
  private items: { p: number; v: T }[] = [];
  get size(): number {
    return this.items.length;
  }
  push(p: number, v: T): void {
    const a = this.items;
    a.push({ p, v });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].p <= a[i].p) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].p < a[m].p) m = l;
        if (r < a.length && a[r].p < a[m].p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.v;
  }
}

interface Node {
  b: number[][];
  g: number;
  parent: Node | null;
  move: { from: number; to: number; count: number } | null;
}

/**
 * Vážené best-first hledání (priorita = g + W·h). Řešení nemusí být nejkratší,
 * ale na velkých levelech je o řády rychlejší než prohledávání do hloubky.
 */
export function solve(caps: number[], start: number[][], nodeLimit = 50000, weight = 3): SolveResult {
  const open = new MinHeap<Node>();
  const seen = new Set<string>();
  open.push(weight * heuristic(caps, start), { b: start, g: 0, parent: null, move: null });
  seen.add(boardKey(caps, start));
  let nodes = 0;
  while (open.size > 0) {
    const node = open.pop()!;
    if (isWonS(caps, node.b)) {
      const moves: { from: number; to: number; count: number }[] = [];
      for (let n: Node | null = node; n && n.move; n = n.parent) moves.push(n.move);
      moves.reverse();
      return { status: 'solved', moves, nodes };
    }
    if (++nodes > nodeLimit) return { status: 'limit', moves: [], nodes };
    for (const m of genMoves(caps, node.b)) {
      const nb = applyS(node.b, m, caps);
      const key = boardKey(caps, nb);
      if (seen.has(key)) continue;
      seen.add(key);
      const g = node.g + 1;
      open.push(g + weight * heuristic(caps, nb), { b: nb, g, parent: node, move: { from: m.from, to: m.to, count: m.count } });
    }
  }
  return { status: 'unsolvable', moves: [], nodes };
}

/** Podíl jednotek, které leží v uzavřených lahvích (0–1). */
function closedProgress(caps: number[], b: number[][], totalUnits: number): number {
  let closed = 0;
  for (let i = 0; i < b.length; i++) if (isClosedS(b[i], caps[i])) closed += b[i].length;
  return totalUnits > 0 ? closed / totalUnits : 1;
}

export interface DifficultyResult {
  /** Podíl her, které skončily zaseknutím. */
  failRate: number;
  /** Spojitá obtížnost 0–1 (1 − průměrný postup), rozlišuje i velké levely, které náhodný hráč nikdy nedohraje. */
  difficulty: number;
}

/**
 * Obtížnost měřená náhodnými „hladovými“ hráči. Hráč preferuje tahy, které uzavřou lahev
 * nebo přilévají na stejnou barvu, a nevrací se do už viděných stavů.
 */
export function measureDifficulty(caps: number[], start: number[][], rng: Rng, runs: number, maxSteps: number): DifficultyResult {
  let fails = 0;
  let progressSum = 0;
  let totalUnits = 0;
  for (const x of start) totalUnits += x.length;
  for (let r = 0; r < runs; r++) {
    let b = start;
    const seen = new Set<string>([boardKey(caps, b)]);
    let solved = false;
    for (let step = 0; step < maxSteps; step++) {
      if (isWonS(caps, b)) {
        solved = true;
        break;
      }
      const moves = genMoves(caps, b);
      const weights: number[] = moves.map((m) => (m.score >= 8 ? 10 : m.score >= 4 ? 3 : m.score >= 0 ? 1.5 : 1));
      let total = 0;
      for (const w of weights) total += w;
      // Vybírej náhodně podle vah; tah do už viděného stavu vyřaď a zkus jiný.
      let next: number[][] | null = null;
      while (total > 1e-9) {
        let pick = rng.next() * total;
        let idx = -1;
        for (let i = 0; i < weights.length; i++) {
          if (weights[i] === 0) continue;
          idx = i;
          pick -= weights[i];
          if (pick <= 0) break;
        }
        if (idx < 0) break;
        const cand = applyS(b, moves[idx], caps);
        const key = boardKey(caps, cand);
        if (!seen.has(key)) {
          seen.add(key);
          next = cand;
          break;
        }
        total -= weights[idx];
        weights[idx] = 0;
      }
      if (!next) break;
      b = next;
    }
    if (solved || isWonS(caps, b)) progressSum += 1;
    else {
      fails++;
      progressSum += closedProgress(caps, b, totalUnits) * 0.9;
    }
  }
  return { failRate: fails / runs, difficulty: 1 - progressSum / runs };
}
