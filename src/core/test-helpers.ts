import type { LevelDef } from './types.ts';

/**
 * Pomocník pro testy: postaví level z textového zápisu.
 * Každá lahev je řetězec barev odspodu nahoru, např. "0012"; skrytá jednotka má za sebou "?",
 * např. "0?12". Kapacity se zadávají zvlášť.
 */
export function makeLevel(caps: number[], bottles: string[], level = 1): LevelDef {
  let id = 0;
  const hidden: number[] = [];
  const parsed = bottles.map((s) => {
    const units = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '?') continue;
      const u = { c: Number.parseInt(ch, 36), id: id++ };
      if (s[i + 1] === '?') hidden.push(u.id);
      units.push(u);
    }
    return units;
  });
  const colors = new Set(parsed.flat().map((u) => u.c)).size;
  return {
    level,
    version: 0,
    tier: 'normal',
    capacities: caps,
    bottles: parsed,
    hidden,
    colors,
    params: {
      colors,
      bottles: caps.length,
      empties: 0,
      capMin: Math.min(...caps),
      capMax: Math.max(...caps),
      hidden: hidden.length,
      partial: 0,
      failMin: 0,
      failMax: 1,
    },
    meta: { failRate: 0, solutionLength: 0, candidates: 1, ms: 0 },
  };
}
