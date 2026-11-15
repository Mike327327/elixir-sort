import type { LevelParams, Tier } from './types.ts';

/**
 * Verze generátoru. Při změně algoritmu nebo křivky ji zvyš – levely se pak vygenerují jinak
 * a rozehraný snapshot starší verze se zahodí.
 */
export const GENERATOR_VERSION = 3;

/** Kolik barev umí hra vykreslit (viz render/palette.ts). */
export const MAX_COLORS = 12;

/** Kapacita lahve. Všechny lahve ve všech levelech jsou stejné, obtížnost dělá počet lahví a barev. */
export const CAPACITY = 4;

/**
 * Nejvíc lahví v levelu (bez +1 lahve). S 31 lahvemi má lahev na iPhonu SE šířku 39 pt,
 * od 36 už jen 34 pt (viz render/layout.test.ts).
 */
export const MAX_BOTTLES = 30;

export const TUTORIAL_LEVELS = 3;
export const HIDDEN_INTRO_LEVEL = 31;
export const HARD_EVERY = 5;
export const VERY_HARD_EVERY = 25;

/** Hodnota parametru na začátku a na konci pásma; uvnitř pásma se lineárně interpoluje. */
type Range = readonly [atStart: number, atEnd: number];

export interface Band {
  from: number;
  to: number;
  colors: Range;
  bottles: Range;
  /** Počet náhradních lahví (prázdných ve vyřešeném stavu). */
  empties: Range;
  hidden: Range;
  /** >0 = část volného místa se rozprostře do více lahví (ne všechny lahve jsou plné). */
  partial: Range;
  /**
   * Jemné doladění obtížnosti: generátor vyrobí několik kandidátů, seřadí je podle naměřené
   * obtížnosti a vybere ten na tomto kvantilu (0 = nejlehčí, 1 = nejtěžší).
   */
  pick: Range;
}

/**
 * Křivka obtížnosti. Laď hlavně tady (hrubá obtížnost = počty barev/lahví, jemná = pick).
 * Poslední pásmo se interpoluje do levelu `to` a pak zůstává na konečných hodnotách.
 */
export const BANDS: readonly Band[] = [
  { from: 1, to: 3, colors: [2, 3], bottles: [4, 5], empties: [2, 2], hidden: [0, 0], partial: [0, 0], pick: [0, 0] },
  { from: 4, to: 12, colors: [5, 7], bottles: [7, 10], empties: [2, 2], hidden: [0, 0], partial: [0, 1], pick: [0.4, 0.6] },
  { from: 13, to: 30, colors: [8, 11], bottles: [11, 16], empties: [2, 2], hidden: [0, 0], partial: [1, 1], pick: [0.7, 0.85] },
  { from: 31, to: 60, colors: [9, 12], bottles: [16, 22], empties: [2, 2], hidden: [3, 6], partial: [1, 1], pick: [0.7, 0.9] },
  { from: 61, to: 100, colors: [12, 12], bottles: [22, 28], empties: [2, 2], hidden: [5, 9], partial: [1, 1], pick: [0.8, 0.95] },
  { from: 101, to: 200, colors: [12, 12], bottles: [28, 30], empties: [2, 2], hidden: [8, 12], partial: [1, 1], pick: [0.9, 1] },
];

export const GEN = {
  /** Počet kandidátů na jeden level (deterministické, nezávisí na rychlosti zařízení). */
  candidates: 8,
  /** Počet náhodných her pro měření obtížnosti. */
  playouts: 16,
  playoutMaxSteps: 200,
} as const;

export function tierForLevel(level: number): Tier {
  if (level <= TUTORIAL_LEVELS) return 'normal';
  if (level % VERY_HARD_EVERY === 0) return 'veryhard';
  if (level % HARD_EVERY === 0) return 'hard';
  return 'normal';
}

function bandIndex(level: number): number {
  for (let i = 0; i < BANDS.length; i++) {
    if (level <= BANDS[i].to) return i;
  }
  return BANDS.length - 1;
}

const lerp = (r: Range, t: number) => r[0] + (r[1] - r[0]) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function paramsFromBand(band: Band, t: number): LevelParams {
  const tt = clamp01(t);
  return {
    colors: Math.round(lerp(band.colors, tt)),
    bottles: Math.round(lerp(band.bottles, tt)),
    empties: Math.round(lerp(band.empties, tt)),
    hidden: Math.round(lerp(band.hidden, tt)),
    partial: Math.round(lerp(band.partial, tt)),
    pick: clamp01(lerp(band.pick, tt)),
  };
}

/**
 * Parametry pro level. Těžký level = horní hranice pásma a nejtěžší kandidát,
 * velmi těžký = parametry o pásmo výš. Level po těžkém je o něco lehčí.
 */
export function paramsForLevel(level: number): { params: LevelParams; tier: Tier } {
  const tier = tierForLevel(level);
  const bi = bandIndex(level);
  const band = BANDS[bi];
  const t = band.to === band.from ? 0 : (level - band.from) / (band.to - band.from);

  let params: LevelParams;
  if (tier === 'veryhard') {
    const isLast = bi + 1 >= BANDS.length;
    params = paramsFromBand(BANDS[isLast ? bi : bi + 1], isLast ? 1 : 0.3);
    params.pick = 1;
  } else if (tier === 'hard') {
    params = paramsFromBand(band, 1);
    params.pick = Math.max(params.pick, 0.9);
  } else {
    const relief = level > HARD_EVERY && level % HARD_EVERY === 1;
    params = paramsFromBand(band, relief ? t - 0.3 : t);
    if (relief) params.pick = clamp01(params.pick - 0.3);
  }

  // Skryté barvy až od zaváděcího levelu.
  if (level < HIDDEN_INTRO_LEVEL) params.hidden = 0;
  if (level === HIDDEN_INTRO_LEVEL) params.hidden = 2;
  params.bottles = Math.min(params.bottles, MAX_BOTTLES);
  params.colors = Math.max(1, Math.min(params.colors, MAX_COLORS, params.bottles - params.empties));
  return { params, tier };
}
