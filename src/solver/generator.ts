import { GEN, GENERATOR_VERSION, paramsForLevel } from '../core/config.ts';
import { createRng, hashSeed, type Rng } from '../core/rng.ts';
import type { LevelDef, LevelParams, Move, Unit } from '../core/types.ts';
import { HIDDEN } from './board.ts';
import { measureDifficulty } from './solver.ts';

/**
 * Generátor pracuje „pozpátku“: začne z vyřešeného stavu a provádí obrácené tahy.
 * Každý obrácený tah je inverzí platného tahu, takže výsledný level je řešitelný
 * konstrukcí – řešení je posloupnost obrácených tahů v opačném pořadí.
 */

export interface Candidate {
  caps: number[];
  b: number[][];
  /** Řešení (dopředné tahy) od tohoto stavu do vyřešeného. */
  solution: Move[];
  mix: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Kapacity lahví: většinou 4, s rostoucí obtížností víc variací v rozsahu capMin–capMax. */
function pickCapacities(p: LevelParams, rng: Rng): { targetCaps: number[]; spareCaps: number[] } {
  const base = Math.min(Math.max(4, p.capMin), p.capMax);
  const varied = p.capMin !== p.capMax;
  const targets = Math.max(1, p.bottles - p.empties);
  const targetCaps: number[] = [];
  for (let i = 0; i < targets; i++) {
    targetCaps.push(varied && rng.chance(0.45) ? rng.int(p.capMin, p.capMax) : base);
  }
  // Náhradní lahve mají aspoň základní kapacitu, ať jsou užitečné.
  const spareCaps: number[] = [];
  for (let i = 0; i < p.empties; i++) {
    spareCaps.push(varied && rng.chance(0.5) ? rng.int(base, p.capMax) : base);
  }
  return { targetCaps, spareCaps };
}

/** Délka souvislého bloku barvy `c` na vrcholu lahve. */
function topRun(bottle: number[]): number {
  const n = bottle.length;
  if (n === 0) return 0;
  const c = bottle[n - 1];
  let k = 1;
  while (k < n && bottle[n - 1 - k] === c) k++;
  return k;
}

function isFullUniform(bottle: number[], cap: number): boolean {
  if (bottle.length !== cap || cap === 0) return false;
  for (let i = 1; i < bottle.length; i++) if (bottle[i] !== bottle[0]) return false;
  return true;
}

interface RevMove {
  a: number;
  b: number;
  k: number;
}

/**
 * Obrácené tahy: vezmi `k` jednotek barvy c z vrcholu A a polož je na B tak,
 * aby dopředný tah B → A přelil přesně těchto `k` jednotek.
 */
function reverseMoves(caps: number[], b: number[][]): RevMove[] {
  const out: RevMove[] = [];
  const n = b.length;
  for (let a = 0; a < n; a++) {
    const A = b[a];
    const lenA = A.length;
    if (lenA === 0) continue;
    const c = A[lenA - 1];
    const run = topRun(A);
    for (let t = 0; t < n; t++) {
      if (t === a) continue;
      const B = b[t];
      const space = caps[t] - B.length;
      if (space <= 0) continue;
      const bTopSame = B.length > 0 && B[B.length - 1] === c;
      // Když B už má navrchu c, dopředný tah by přelil víc – jde to jen, je-li A před obratem plná.
      if (bTopSame && lenA !== caps[a]) continue;
      const maxK = Math.min(run, space);
      for (let k = 1; k <= maxK; k++) {
        // Po odebrání musí A zůstat prázdná nebo mít navrchu c (jinak by dopředu nešlo přilít).
        if (k === run && k < lenA) continue;
        // B nesmí skončit plná jedné barvy (uzavřená lahev se nedá přelévat).
        if (B.length + k === caps[t]) {
          let uniform = true;
          for (let j = 0; j < B.length; j++) if (B[j] !== c) uniform = false;
          if (uniform) continue;
        }
        out.push({ a, b: t, k });
      }
    }
  }
  return out;
}

function applyReverse(b: number[][], m: RevMove): void {
  const moved = b[m.a].splice(b[m.a].length - m.k, m.k);
  b[m.b].push(...moved);
}

/** Váhy zpětné procházky (vyladěné experimentálně, viz scripts/levels-report.ts). */
export const WEIGHTS = { onDifferent: 6, intoEmpty: 1.2, emptiesSource: 1, single: 0.5, stepsPerBottle: 50, maxBacktracks: 80 };

/** Délka souvislého bloku stejné barvy od dna. */
function bottomRun(bottle: number[]): number {
  if (bottle.length === 0) return 0;
  let k = 1;
  while (k < bottle.length && bottle[k] === bottle[0]) k++;
  return k;
}

/** Míra „promíchanosti“ (nižší = lépe promíchané). */
function mixScore(caps: number[], b: number[][]): number {
  let pairs = 0;
  let same = 0;
  let bad = 0;
  for (let i = 0; i < b.length; i++) {
    const bottle = b[i];
    if (isFullUniform(bottle, caps[i])) bad += 3;
    for (let j = 1; j < bottle.length; j++) {
      pairs++;
      if (bottle[j] === bottle[j - 1]) same++;
    }
    if (topRun(bottle) >= 3) bad += 0.5;
    const br = bottomRun(bottle);
    if (br >= 3 && br < bottle.length) bad += br - 2;
  }
  return (pairs ? same / pairs : 0) + bad * 0.08;
}

function emptyCount(b: number[][]): number {
  let n = 0;
  for (const x of b) if (x.length === 0) n++;
  return n;
}

/** Jeden kandidát: náhodná zpětná procházka z vyřešeného stavu. */
export function buildCandidate(p: LevelParams, rng: Rng): Candidate | null {
  const { targetCaps, spareCaps } = pickCapacities(p, rng);
  const colors = Math.min(p.colors, targetCaps.length);
  const owner: number[] = [];
  for (let i = 0; i < targetCaps.length; i++) owner.push(i < colors ? i : rng.int(0, colors - 1));
  rng.shuffle(owner);

  const caps = targetCaps.concat(spareCaps);
  const b: number[][] = caps.map((cap, i) => (i < targetCaps.length ? new Array<number>(cap).fill(owner[i]) : []));
  // Promíchej pořadí lahví, ať prázdné nejsou vždy na konci.
  const order = rng.shuffle(caps.map((_, i) => i));
  const capsS = order.map((i) => caps[i]);
  const bS = order.map((i) => b[i]);

  const desiredEmpty = p.partial > 0 ? Math.max(1, p.empties - 1) : p.empties;
  const steps = 20 + capsS.length * WEIGHTS.stepsPerBottle;
  let totalUnits = 0;
  for (const c of targetCaps) totalUnits += c;
  const history: RevMove[] = [];
  let best: { b: number[][]; history: RevMove[]; score: number; mix: number } | null = null;
  let last: RevMove | null = null;
  let stuck = 0;

  for (let step = 0; step < steps; step++) {
    let moves = reverseMoves(capsS, bS);
    if (last) {
      const l = last;
      moves = moves.filter((m) => !(m.a === l.b && m.b === l.a && m.k === l.k));
    }
    // Žádný obrácený tah = stav, do kterého se nedá dojít. Je to platné zadání (už ohodnocené),
    // ale pro hlubší promíchání se vrať o pár kroků a zkus jinou větev.
    if (moves.length === 0) {
      if (history.length === 0 || ++stuck > WEIGHTS.maxBacktracks) break;
      const back = Math.min(history.length, rng.int(2, 5));
      for (let i = 0; i < back; i++) {
        const h = history.pop()!;
        applyReverse(bS, { a: h.b, b: h.a, k: h.k });
      }
      last = null;
      continue;
    }
    // Preferuj tahy, které kladou barvu na jinou barvu (víc promíchá).
    // Vyprázdnění lahve umožní později promíchat i její spodek.
    const weights = moves.map((m) => {
      const A = bS[m.a];
      const B = bS[m.b];
      const onDifferent = B.length > 0 && B[B.length - 1] !== A[A.length - 1];
      let w = onDifferent ? WEIGHTS.onDifferent : B.length === 0 ? WEIGHTS.intoEmpty : 1;
      if (m.k === A.length) w *= WEIGHTS.emptiesSource;
      if (m.k === 1) w *= WEIGHTS.single;
      return w;
    });
    let total = 0;
    for (const w of weights) total += w;
    let pick = rng.next() * total;
    let idx = moves.length - 1;
    for (let i = 0; i < moves.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        idx = i;
        break;
      }
    }
    const m = moves[idx];
    applyReverse(bS, m);
    history.push(m);
    last = m;

    // Hodnoť každý stav: promíchanost, správný počet prázdných lahví a hloubka (delší řešení).
    // Stav s už hotovou (plnou jednobarevnou) lahví jako zadání nebereme.
    if (bS.some((x, i) => isFullUniform(x, capsS[i]))) continue;
    const mix = mixScore(capsS, bS);
    const depth = Math.min(1, history.length / totalUnits);
    const score = mix + Math.abs(emptyCount(bS) - desiredEmpty) * 0.6 - depth * 0.3;
    if (!best || score < best.score) best = { b: bS.map((x) => x.slice()), history: history.slice(), score, mix };
  }
  if (!best) return null;

  // Řešení = obrácené tahy pozpátku, z A ← B se stává B → A.
  const solution: Move[] = best.history
    .slice()
    .reverse()
    .map((m) => ({ from: m.b, to: m.a, count: m.k }));
  const cand: Candidate = { caps: capsS, b: best.b, solution, mix: best.mix };
  addHidden(cand.b, p.hidden, rng);
  return cand;
}

/** Skryje `count` jednotek, které nejsou na vrcholu lahve. */
function addHidden(b: number[][], count: number, rng: Rng): void {
  if (count <= 0) return;
  const slots: [number, number][] = [];
  for (let i = 0; i < b.length; i++) {
    for (let j = 0; j < b[i].length - 1; j++) slots.push([i, j]);
  }
  rng.shuffle(slots);
  for (let k = 0; k < Math.min(count, slots.length); k++) {
    const [i, j] = slots[k];
    b[i][j] += HIDDEN;
  }
}

function toLevelDef(level: number, tier: LevelDef['tier'], p: LevelParams, cand: Candidate, meta: LevelDef['meta']): LevelDef {
  let id = 0;
  const hidden: number[] = [];
  const bottles: Unit[][] = cand.b.map((bottle) =>
    bottle.map((x) => {
      const u = { c: x % HIDDEN, id: id++ };
      if (x >= HIDDEN) hidden.push(u.id);
      return u;
    }),
  );
  const colors = new Set(bottles.flat().map((u) => u.c)).size;
  return { level, version: GENERATOR_VERSION, tier, capacities: cand.caps, bottles, hidden, colors, params: p, meta };
}

export interface GeneratedLevel {
  def: LevelDef;
  /** Známé řešení z konstrukce (pro testy a debug). */
  solution: Move[];
}

/**
 * Deterministicky vygeneruje level N: vyrobí několik kandidátů, seřadí je podle naměřené
 * obtížnosti a vybere ten na kvantilu `params.pick`.
 */
export function generateLevelWithSolution(level: number): GeneratedLevel {
  const t0 = now();
  const { params, tier } = paramsForLevel(level);
  const rng = createRng(hashSeed(level, GENERATOR_VERSION, 0x5eed));

  const scored: { cand: Candidate; failRate: number; difficulty: number }[] = [];
  let tried = 0;
  for (let i = 0; i < GEN.candidates * 3 && scored.length < GEN.candidates; i++) {
    tried++;
    const cand = buildCandidate(params, rng);
    if (!cand || cand.solution.length === 0) continue;
    const { failRate, difficulty } = measureDifficulty(cand.caps, cand.b, rng, GEN.playouts, GEN.playoutMaxSteps);
    // Promíchanost je součást obtížnosti: dobře promíchaný level je těžší na čtení.
    scored.push({ cand, failRate, difficulty: difficulty * 0.85 + (1 - Math.min(1, cand.mix)) * 0.15 });
  }

  let chosen: { cand: Candidate; failRate: number; difficulty: number };
  if (scored.length === 0) {
    // Krajní pojistka (prakticky nenastane): jednoduchý řešitelný level se známým řešením.
    chosen = {
      cand: {
        caps: [4, 4, 4],
        b: [[0, 0, 1, 1], [1, 1, 0, 0], []],
        solution: [
          { from: 0, to: 2, count: 2 },
          { from: 1, to: 0, count: 2 },
          { from: 2, to: 1, count: 2 },
        ],
        mix: 0,
      },
      failRate: 0,
      difficulty: 0,
    };
  } else {
    scored.sort((a, b) => a.difficulty - b.difficulty);
    chosen = scored[Math.round(params.pick * (scored.length - 1))];
  }

  const def = toLevelDef(level, tier, params, chosen.cand, {
    failRate: chosen.failRate,
    difficulty: chosen.difficulty,
    solutionLength: chosen.cand.solution.length,
    candidates: tried,
    ms: Math.round(now() - t0),
  });
  return { def, solution: chosen.cand.solution };
}

export function generateLevel(level: number): LevelDef {
  return generateLevelWithSolution(level).def;
}
