import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.ts';
import { makeLevel } from './test-helpers.ts';

const colorsOf = (g: Game, i: number) => g.bottles[i].map((u) => u.c).join('');

describe('přelévání', () => {
  test('přelije celý souvislý blok, když se vejde', () => {
    const g = new Game(makeLevel([4, 4], ['0111', '']));
    const r = g.pour(0, 1);
    assert.ok(r);
    assert.equal(r.move.count, 3);
    assert.equal(colorsOf(g, 0), '0');
    assert.equal(colorsOf(g, 1), '111');
  });

  test('přelije jen tolik, kolik se vejde, zbytek zůstane', () => {
    const g = new Game(makeLevel([4, 4], ['0111', '221']));
    const r = g.pour(0, 1);
    assert.ok(r);
    assert.equal(r.move.count, 1);
    assert.equal(colorsOf(g, 0), '011');
    assert.equal(colorsOf(g, 1), '2211');
  });

  test('nejde přelít na jinou barvu, do plné lahve ani do sebe', () => {
    const g = new Game(makeLevel([4, 4, 2], ['01', '02', '33']));
    assert.equal(g.pour(0, 1), null);
    assert.equal(g.pour(1, 2), null);
    assert.equal(g.pour(0, 0), null);
  });

  test('z prázdné lahve nejde přelévat', () => {
    const g = new Game(makeLevel([4, 4], ['', '01']));
    assert.equal(g.pour(0, 1), null);
  });

  test('různé kapacity: do lahve s kapacitou 2 se vejdou jen 2', () => {
    const g = new Game(makeLevel([5, 2], ['01111', '']));
    const r = g.pour(0, 1);
    assert.ok(r);
    assert.equal(r.move.count, 2);
    assert.equal(r.closedTarget, true);
    assert.equal(colorsOf(g, 0), '011');
  });
});

describe('uzavírání a výhra', () => {
  test('plná jednobarevná lahev je uzavřená a nejde s ní hýbat', () => {
    const g = new Game(makeLevel([3, 3], ['111', '1']));
    assert.equal(g.isClosed(0), true);
    assert.equal(g.canSelect(0), false);
    assert.equal(g.pour(0, 1), null);
  });

  test('výhra, když jsou všechny neprázdné lahve uzavřené', () => {
    const g = new Game(makeLevel([2, 2, 2], ['01', '01', '']));
    assert.equal(g.isWon(), false);
    assert.ok(g.pour(0, 2));
    assert.ok(g.pour(1, 2));
    const r = g.pour(1, 0);
    assert.ok(r);
    assert.equal(r.won, true);
  });

  test('barva přes více lahví: výhra vyžaduje jen plné jednobarevné lahve', () => {
    const g = new Game(makeLevel([2, 2, 2], ['00', '00', '']));
    assert.equal(g.isWon(), true);
  });
});

describe('bezvýchodná situace', () => {
  test('žádný tah → stuck', () => {
    const g = new Game(makeLevel([2, 2], ['01', '10']));
    assert.equal(g.isStuck(), true);
  });

  test('vyhraný level není stuck', () => {
    const g = new Game(makeLevel([2], ['00']));
    assert.equal(g.isStuck(), false);
  });
});

describe('zpět, restart, +1 lahev', () => {
  test('zpět vrací tahy jeden po druhém', () => {
    const g = new Game(makeLevel([4, 4, 4], ['0011', '1100', '']));
    g.pour(0, 2);
    g.pour(1, 0);
    assert.equal(g.history.length, 2);
    g.undo();
    assert.equal(colorsOf(g, 0), '00');
    assert.equal(colorsOf(g, 1), '1100');
    g.undo();
    assert.equal(colorsOf(g, 0), '0011');
    assert.equal(colorsOf(g, 2), '');
    assert.equal(g.undo(), null);
    assert.equal(g.moves, 2, 'Zpět nesnižuje počet tahů');
  });

  test('+1 lahev jde jen jednou a má nejčastější kapacitu', () => {
    const g = new Game(makeLevel([4, 4, 3], ['0011', '1100', '']));
    assert.equal(g.addBottle(), true);
    assert.equal(g.caps.length, 4);
    assert.equal(g.caps[3], 4);
    assert.equal(g.addBottle(), false);
  });

  test('zpět neodstraní přidanou lahev', () => {
    const g = new Game(makeLevel([4, 4], ['0011', '1100']));
    g.addBottle();
    g.pour(0, 2);
    g.undo();
    assert.equal(g.caps.length, 3);
  });

  test('restart vrátí počáteční stav i +1 lahev', () => {
    const g = new Game(makeLevel([4, 4, 4], ['0011', '1100', '']));
    g.addBottle();
    g.pour(0, 2);
    g.restart();
    assert.equal(g.caps.length, 3);
    assert.equal(colorsOf(g, 0), '0011');
    assert.equal(g.canAddBottle(), true);
    assert.equal(g.history.length, 0);
  });
});

describe('skryté barvy', () => {
  test('vrchol lahve je vždy odkrytý', () => {
    const g = new Game(makeLevel([3, 3], ['0?1?', '']));
    const top = g.bottles[0][1];
    assert.equal(g.isHidden(top), false);
    assert.equal(g.isHidden(g.bottles[0][0]), true);
  });

  test('blok končí u skryté jednotky a ta se po odlití odkryje', () => {
    const g = new Game(makeLevel([4, 3], ['11?1', '']));
    const r = g.pour(0, 1);
    assert.ok(r);
    assert.equal(r.move.count, 1, 'skrytá jednotka stejné barvy se nepřelila');
    assert.equal(r.revealed.length, 1);
    assert.equal(g.isHidden(g.bottles[0][1]), false);
  });

  test('zpět jednotku znovu neskryje', () => {
    const g = new Game(makeLevel([3, 3], ['02?1', '']));
    g.pour(0, 1);
    const hiddenUnit = g.bottles[0][1];
    assert.equal(g.isHidden(hiddenUnit), false);
    g.undo();
    assert.equal(g.isHidden(hiddenUnit), false);
  });

  test('restart jednotku znovu neskryje', () => {
    const g = new Game(makeLevel([3, 3], ['02?1', '']));
    g.pour(0, 1);
    g.restart();
    assert.equal(g.isHidden(g.bottles[0][1]), false);
  });

  test('plná jednobarevná lahev se skrytou jednotkou se uzavře a odkryje ji', () => {
    const def = makeLevel([3, 3], ['00?0', '']);
    const g = new Game(def);
    assert.equal(g.isClosed(0), true);
    assert.equal(g.isHidden(g.bottles[0][1]), false);
  });

  test('dolití do plné barvy odkryje skrytou jednotku uvnitř', () => {
    const g = new Game(makeLevel([3, 3], ['0?0', '10']));
    assert.equal(g.isHidden(g.bottles[0][0]), true);
    const r = g.pour(1, 0);
    assert.ok(r);
    assert.equal(r.closedTarget, true);
    assert.ok(r.revealed.includes(g.bottles[0][0].id));
  });

  test('na skrytou jednotku nejde přilévat (není to vrchol, ale kontrola cíle)', () => {
    const g = new Game(makeLevel([3, 3], ['1', '1?']));
    // vrchol cíle se při startu odkryje, takže tah funguje normálně
    assert.ok(g.pour(0, 1));
  });
});

describe('snapshot', () => {
  test('stav jde uložit a obnovit', () => {
    const def = makeLevel([4, 4, 4], ['0?011', '1100', '']);
    const g = new Game(def);
    g.pour(0, 2);
    g.addBottle();
    const snap = JSON.parse(JSON.stringify(g.toSnapshot()));
    const g2 = new Game(def, snap);
    assert.deepEqual(g2.bottles, g.bottles);
    assert.deepEqual(g2.caps, g.caps);
    assert.equal(g2.extraUsed, true);
    assert.equal(g2.history.length, 1);
    assert.deepEqual([...g2.revealed].sort(), [...g.revealed].sort());
  });

  test('snapshot jiného levelu se ignoruje', () => {
    const g = new Game(makeLevel([4, 4], ['0011', '1100'], 1));
    g.pour(0, 1);
    const g2 = new Game(makeLevel([4, 4], ['0011', '1100'], 2), g.toSnapshot());
    assert.equal(g2.history.length, 0);
  });
});
