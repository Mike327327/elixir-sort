import {
  applyPour,
  hasAnyMove,
  isClosed,
  isWon,
  mostCommonCapacity,
  pourAmount,
  revertPour,
} from './rules.ts';
import type { Bottle, LevelDef, Move, Unit } from './types.ts';

/** Serializovatelný stav rozehraného levelu (ukládá se do localStorage). */
export interface GameSnapshot {
  level: number;
  version: number;
  caps: number[];
  bottles: Unit[][];
  revealed: number[];
  history: Move[];
  extraUsed: boolean;
  moves: number;
}

export interface PourResult {
  move: Move;
  /** Obsah zdroje a cíle před tahem (kvůli animaci). */
  before: { from: Unit[]; to: Unit[] };
  revealed: number[];
  closedTarget: boolean;
  won: boolean;
}

export interface UndoResult {
  move: Move;
  before: { from: Unit[]; to: Unit[] };
}

const cloneBottles = (bottles: Bottle[]): Bottle[] => bottles.map((b) => b.map((u) => ({ c: u.c, id: u.id })));

export class Game {
  readonly def: LevelDef;
  caps: number[];
  bottles: Bottle[];
  readonly hiddenInitial: Set<number>;
  /** Odkryté jednotky – trvalé, Zpět ani Restart je znovu neskryje. */
  readonly revealed: Set<number>;
  history: Move[];
  extraUsed: boolean;
  /** Počet přelití od začátku (Zpět ho nesnižuje). */
  moves: number;

  readonly isHidden = (u: Unit): boolean => this.hiddenInitial.has(u.id) && !this.revealed.has(u.id);

  constructor(def: LevelDef, snapshot?: GameSnapshot | null) {
    this.def = def;
    this.hiddenInitial = new Set(def.hidden);
    const useSnap = snapshot && snapshot.level === def.level && snapshot.version === def.version;
    if (useSnap) {
      this.caps = snapshot.caps.slice();
      this.bottles = cloneBottles(snapshot.bottles);
      this.revealed = new Set(snapshot.revealed);
      this.history = snapshot.history.map((m) => ({ ...m }));
      this.extraUsed = snapshot.extraUsed;
      this.moves = snapshot.moves;
    } else {
      this.caps = def.capacities.slice();
      this.bottles = cloneBottles(def.bottles);
      this.revealed = new Set();
      this.history = [];
      this.extraUsed = false;
      this.moves = 0;
    }
    this.revealTops();
  }

  /** Odkryje skryté jednotky, které jsou na vrcholu. Vrací nově odkrytá id. */
  revealTops(): number[] {
    const out: number[] = [];
    for (const b of this.bottles) {
      const top = b[b.length - 1];
      if (top && this.isHidden(top)) {
        this.revealed.add(top.id);
        out.push(top.id);
      }
    }
    return out;
  }

  isClosed(i: number): boolean {
    return isClosed(this.bottles[i], this.caps[i], this.isHidden);
  }

  canSelect(i: number): boolean {
    const b = this.bottles[i];
    return !!b && b.length > 0 && !this.isClosed(i);
  }

  pourAmount(from: number, to: number): number {
    return pourAmount(this.bottles, this.caps, from, to, this.isHidden);
  }

  pour(from: number, to: number): PourResult | null {
    const before = { from: this.bottles[from].slice(), to: this.bottles[to].slice() };
    const move = applyPour(this.bottles, this.caps, from, to, this.isHidden);
    if (!move) return null;
    this.history.push(move);
    this.moves++;
    const revealed = this.revealTops();
    return {
      move,
      before,
      revealed,
      closedTarget: this.isClosed(to),
      won: this.isWon(),
    };
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): UndoResult | null {
    const move = this.history.pop();
    if (!move) return null;
    const before = { from: this.bottles[move.from].slice(), to: this.bottles[move.to].slice() };
    revertPour(this.bottles, move);
    return { move, before };
  }

  canAddBottle(): boolean {
    return !this.extraUsed;
  }

  addBottle(): boolean {
    if (this.extraUsed) return false;
    this.extraUsed = true;
    this.caps.push(mostCommonCapacity(this.def.capacities));
    this.bottles.push([]);
    return true;
  }

  restart(): void {
    this.caps = this.def.capacities.slice();
    this.bottles = cloneBottles(this.def.bottles);
    this.history = [];
    this.extraUsed = false;
    this.moves = 0;
    this.revealTops();
  }

  isWon(): boolean {
    return isWon(this.bottles, this.caps, this.isHidden);
  }

  /** Bezvýchodná situace: žádný platný tah a level není vyhraný. */
  isStuck(): boolean {
    return !this.isWon() && !hasAnyMove(this.bottles, this.caps, this.isHidden);
  }

  toSnapshot(): GameSnapshot {
    return {
      level: this.def.level,
      version: this.def.version,
      caps: this.caps.slice(),
      bottles: cloneBottles(this.bottles),
      revealed: Array.from(this.revealed),
      history: this.history.map((m) => ({ ...m })),
      extraUsed: this.extraUsed,
      moves: this.moves,
    };
  }
}
