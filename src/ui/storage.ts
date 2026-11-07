import type { GameSnapshot } from '../core/game.ts';

/** Verze schématu je součástí klíče – při změně formátu stačí zvýšit. */
const KEY = 'elixir-sort:v1';

export interface Settings {
  sound: boolean;
  symbols: boolean;
  /** Ukazovací ruka s dalším tahem v levelech 1–3. Výchozí stav vypnuto. */
  hints: boolean;
}

export interface SaveData {
  level: number;
  settings: Settings;
  stats: { completed: number; totalMoves: number };
  current: GameSnapshot | null;
  seenTips: string[];
}

export function defaultData(): SaveData {
  return {
    level: 1,
    settings: { sound: true, symbols: false, hints: false },
    stats: { completed: 0, totalMoves: 0 },
    current: null,
    seenTips: [],
  };
}

export function loadData(): SaveData {
  const def = defaultData();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      level: typeof parsed.level === 'number' && parsed.level >= 1 ? Math.floor(parsed.level) : 1,
      settings: { ...def.settings, ...(parsed.settings ?? {}) },
      stats: { ...def.stats, ...(parsed.stats ?? {}) },
      current: parsed.current ?? null,
      seenTips: Array.isArray(parsed.seenTips) ? parsed.seenTips : [],
    };
  } catch {
    return def;
  }
}

export function saveData(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Úložiště nedostupné (soukromý režim, plno) – hra jede dál bez ukládání.
  }
}

export function clearData(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignorovat
  }
}

/** Požádá prohlížeč, aby data nemazal (iOS je jinak může po čase vyčistit). */
export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // ignorovat
  }
}
