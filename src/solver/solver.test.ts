import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../core/game.ts';
import { createRng } from '../core/rng.ts';
import { paramsForLevel, MAX_COLORS } from '../core/config.ts';
import { makeLevel } from '../core/test-helpers.ts';
import type { LevelDef, Move } from '../core/types.ts';
import { applyS, genMoves, toSBoard } from './board.ts';
import { generateLevel, generateLevelWithSolution } from './generator.ts';
import { solve } from './solver.ts';

/** Přehraje řešení v enginu hry. Skrytá jednotka může rozdělit blok, proto se přelévá opakovaně. */
function replay(def: LevelDef, moves: Move[]): Game {
  const g = new Game(def);
  for (const m of moves) {
    let moved = 0;
    while (moved < m.count) {
      const r = g.pour(m.from, m.to);
      assert.ok(r, `level ${def.level}: tah ${m.from}→${m.to} není platný`);
      moved += r.move.count;
    }
    assert.equal(moved, m.count, `level ${def.level}: přelito víc, než mělo`);
  }
  return g;
}

describe('pravidla solveru odpovídají pravidlům hry', () => {
  test('každý tah solveru je platný tah hry se stejným výsledkem', () => {
    const rng = createRng(42);
    for (const level of [2, 9, 18, 33, 47, 70, 140]) {
      const def = generateLevel(level);
      const g = new Game(def);
      for (let step = 0; step < 40; step++) {
        const sb = toSBoard(g.caps, g.bottles, g.isHidden);
        const moves = genMoves(sb.caps, sb.b);
        if (moves.length === 0) break;
        const m = rng.pick(moves);
        assert.equal(g.pourAmount(m.from, m.to), m.count, `level ${level}: množství nesedí`);
        const expected = applyS(sb.b, m, sb.caps);
        g.pour(m.from, m.to);
        const actual = toSBoard(g.caps, g.bottles, g.isHidden).b;
        assert.deepEqual(actual, expected, `level ${level}: stav po tahu nesedí`);
      }
    }
  });

  test('solver najde řešení jednoduchého levelu a hra ho přijme', () => {
    const def = makeLevel([4, 4, 4, 4], ['0101', '1010', '', '']);
    const sb = toSBoard(def.capacities, def.bottles, () => false);
    const res = solve(sb.caps, sb.b);
    assert.equal(res.status, 'solved');
    assert.equal(replay(def, res.moves).isWon(), true);
  });

  test('solver pozná neřešitelný level', () => {
    const def = makeLevel([2, 2], ['01', '10']);
    const sb = toSBoard(def.capacities, def.bottles, () => false);
    assert.equal(solve(sb.caps, sb.b).status, 'unsolvable');
  });
});

describe('generátor', () => {
  test('parametry jsou platné pro levely 1–500', () => {
    for (let level = 1; level <= 500; level++) {
      const { params: p } = paramsForLevel(level);
      assert.ok(p.colors >= 1 && p.colors <= MAX_COLORS, `level ${level}: barvy`);
      assert.ok(p.colors <= p.bottles - p.empties, `level ${level}: málo lahví pro barvy`);
      assert.ok(p.capMin >= 2 && p.capMax <= 8 && p.capMin <= p.capMax, `level ${level}: kapacity`);
      assert.ok(p.pick >= 0 && p.pick <= 1, `level ${level}: pick`);
    }
  });

  test('levely 1–300 jsou deterministické a řešitelné podle pravidel hry', () => {
    for (let level = 1; level <= 300; level++) {
      const { def, solution } = generateLevelWithSolution(level);
      assert.ok(solution.length > 0, `level ${level}: chybí řešení`);
      assert.ok(def.colors <= MAX_COLORS);
      assert.ok(def.capacities.length <= 26, `level ${level}: moc lahví`);
      for (let i = 0; i < def.bottles.length; i++) {
        assert.ok(def.bottles[i].length <= def.capacities[i], `level ${level}: přeplněná lahev`);
      }
      const g = new Game(def);
      assert.equal(g.isWon(), false, `level ${level}: už vyřešený`);
      assert.equal(replay(def, solution).isWon(), true, `level ${level}: řešení nevede k výhře`);
      if (level % 37 === 0) {
        const again = generateLevel(level);
        assert.deepEqual(again.bottles, def.bottles, `level ${level}: není deterministický`);
        assert.deepEqual(again.capacities, def.capacities);
        assert.deepEqual(again.hidden, def.hidden);
      }
    }
  });

  test('skryté barvy jsou až od levelu 31 a nikdy na vrcholu', () => {
    for (let level = 1; level <= 30; level++) assert.equal(generateLevel(level).hidden.length, 0);
    for (const level of [31, 50, 100, 200]) {
      const def = generateLevel(level);
      assert.ok(def.hidden.length > 0, `level ${level}: chybí skryté`);
      const hidden = new Set(def.hidden);
      for (const b of def.bottles) {
        if (b.length > 0) assert.equal(hidden.has(b[b.length - 1].id), false, `level ${level}: skrytý vrchol`);
      }
    }
  });

  test('obtížnost v průměru roste', () => {
    const avg = (from: number, to: number) => {
      let s = 0;
      for (let l = from; l <= to; l++) s += generateLevel(l).meta.difficulty;
      return s / (to - from + 1);
    };
    const early = avg(4, 14);
    const late = avg(121, 131);
    assert.ok(late > early, `obtížnost neroste: ${early.toFixed(2)} → ${late.toFixed(2)}`);
  });

  test('solver vyřeší i středně velký vygenerovaný level', () => {
    // Level 33: 8 barev, 14 lahví, skryté jednotky. Největší levely solver do limitu nevyřeší vždy
    // (používá se jen pro nápovědu v levelech 1–3 a v debug panelu).
    const def = generateLevel(33);
    const g = new Game(def);
    const sb = toSBoard(g.caps, g.bottles, () => false);
    const hidden = new Set(def.hidden);
    sb.b = def.bottles.map((b) => b.map((u) => (hidden.has(u.id) ? u.c + 32 : u.c)));
    const res = solve(sb.caps, sb.b, 60000);
    assert.equal(res.status, 'solved');
    assert.equal(replay(def, res.moves).isWon(), true);
  });
});
