import type { LevelParams, Tier } from './types.ts';

/**
 * Verze generátoru. Při změně algoritmu nebo křivky ji zvyš – levely se pak vygenerují jinak
 * a rozehraný snapshot starší verze se zahodí.
 */
export const GENERATOR_VERSION = 2;

/** Kolik barev umí hra vykreslit (viz render/palette.ts). */
export const MAX_COLORS = 12;

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
  capMin: Range;
  capMax: Range;
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
  { from: 1, to: 3, colors: [2, 3], bottles: [4, 5], empties: [2, 2], capMin: [4, 4], capMax: [4, 4], hidden: [0, 0], partial: [0, 0], pick: [0, 0] },
  { from: 4, to: 12, colors: [5, 7], bottles: [7, 10], empties: [2, 2], capMin: [4, 4], capMax: [4, 4], hidden: [0, 0], partial: [0, 1], pick: [0.4, 0.6] },
  { from: 13, to: 30, colors: [7, 9], bottles: [10, 14], empties: [2, 2], capMin: [3, 3], capMax: [5, 6], hidden: [0, 0], partial: [1, 1], pick: [0.5, 0.7] },
  { from: 31, to: 60, colors: [8, 10], bottles: [14, 18], empties: [2, 2], capMin: [3, 2], capMax: [6, 7], hidden: [3, 5], partial: [1, 1], pick: [0.5, 0.8] },
  { from: 61, to: 100, colors: [10, 12], bottles: [18, 24], empties: [2, 2], capMin: [2, 2], capMax: [7, 8], hidden: [4, 8], partial: [1, 1], pick: [0.6, 0.85] },
  { from: 101, to: 200, colors: [12, 12], bottles: [24, 24], empties: [2, 2], capMin: [2, 2], capMax: [8, 8], hidden: [6, 10], partial: [1, 1], pick: [0.7, 0.95] },
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
    capMin: Math.round(lerp(band.capMin, tt)),
    capMax: Math.round(lerp(band.capMax, tt)),
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
    params.pick = 0.9;
  } else {
    const relief = level > HARD_EVERY && level % HARD_EVERY === 1;
    params = paramsFromBand(band, relief ? t - 0.3 : t);
    if (relief) params.pick = clamp01(params.pick - 0.3);
  }

  // Skryté barvy až od zaváděcího levelu.
  if (level < HIDDEN_INTRO_LEVEL) params.hidden = 0;
  if (level === HIDDEN_INTRO_LEVEL) params.hidden = 2;
  params.colors = Math.max(1, Math.min(params.colors, MAX_COLORS, params.bottles - params.empties));
  return { params, tier };
}
