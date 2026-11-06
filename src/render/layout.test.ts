import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bottleGeom, computeLayout, hitTest, pourPlacement, type Slot } from './layout.ts';
import { generateLevel } from '../solver/generator.ts';

/** Hrací plocha po odečtení lišt a safe areas (CSS px, na výšku). */
const IPHONE_14 = { w: 390, h: 844 - 47 - 34 - 64 - 84 };
const IPHONE_SE = { w: 375, h: 667 - 20 - 0 - 64 - 84 };

function check(caps: number[], area: { w: number; h: number }, minW: number) {
  const l = computeLayout(caps, area.w, area.h);
  assert.equal(l.slots.length, caps.length);
  assert.ok(l.w >= minW, `šířka lahve ${l.w} < ${minW} pro ${caps.length} lahví`);
  for (const s of l.slots) {
    assert.ok(s.x - s.w / 2 >= 0 && s.x + s.w / 2 <= area.w + 0.01, 'lahev přesahuje do strany');
    assert.ok(s.y >= -0.01 && s.y + s.h <= area.h + 0.01, `lahev přesahuje výšku (${s.y}, ${s.y + s.h} > ${area.h})`);
  }
  // Lahve se nepřekrývají.
  for (let i = 0; i < l.slots.length; i++) {
    for (let j = i + 1; j < l.slots.length; j++) {
      const a = l.slots[i];
      const b = l.slots[j];
      const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
      const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!(overlapX && overlapY), `lahve ${i} a ${j} se překrývají`);
    }
  }
  return l;
}

describe('rozložení', () => {
  test('malý level má velké lahve v jedné řadě', () => {
    const l = check([4, 4, 4, 4], IPHONE_14, 50);
    assert.equal(l.rows, 1);
  });

  test('24 lahví s kapacitami až 8 má na iPhonu SE i 14 šířku aspoň 40 pt', () => {
    const caps = [8, 7, 7, 6, 6, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 4];
    const se = check(caps, IPHONE_SE, 40);
    const i14 = check(caps, IPHONE_14, 40);
    // Přidaná lahev (+1) je navíc nad rámec zadání, smí být o trochu užší.
    const seAdded = check(caps.concat([4]), IPHONE_SE, 38.5);
    console.log(`    šířka lahve: SE ${se.w} px (s přidanou ${seAdded.w} px), iPhone 14 ${i14.w} px`);
  });

  test('vygenerované levely 1–300 se vejdou na iPhone SE', () => {
    let minW = Infinity;
    for (let level = 1; level <= 300; level += 3) {
      const caps = generateLevel(level).capacities.concat([4]); // i s +1 lahví
      const l = check(caps, IPHONE_SE, 34);
      minW = Math.min(minW, l.w);
    }
    assert.ok(minW >= 34);
  });

  test('trefení lahve funguje i s okrajem', () => {
    const l = computeLayout([4, 4, 4], 390, 600);
    const s = l.slots[1];
    assert.equal(hitTest(l.slots, s.x, s.y + s.h / 2), 1);
    assert.equal(hitTest(l.slots, s.x + s.w / 2 + 5, s.y + s.h / 2), 1);
    assert.equal(hitTest(l.slots, 2, 2), -1);
  });
});

describe('umístění přelití', () => {
  const BOARD_W = 390;
  const slot = (x: number, y = 100, cap = 8): Slot => ({ ...bottleGeom(48, 20, cap), x, y });
  const reach = slot(0).h;

  test('lahev se naklání od strany, ze které přilétá', () => {
    assert.equal(pourPlacement(slot(100), slot(200), BOARD_W, 50).dir, 1);
    assert.equal(pourPlacement(slot(300), slot(200), BOARD_W, 50).dir, -1);
  });

  test('u levého i pravého kraje míří tělo lahve dovnitř plochy', () => {
    const left = slot(36);
    const right = slot(BOARD_W - 36);
    // Zdroj je ve stejném sloupci, přirozený směr by vedl tělo lahve doleva mimo obrazovku.
    assert.equal(pourPlacement(slot(36, 400), left, BOARD_W, reach).dir, -1);
    // Zdroj je vpravo od cíle u pravého kraje, přirozený směr by vedl tělo doprava mimo obrazovku.
    assert.equal(pourPlacement(slot(BOARD_W - 10, 400), right, BOARD_W, reach).dir, 1);
  });

  test('když se lahev nevejde na žádnou stranu, vybere se ta s větším místem', () => {
    assert.equal(pourPlacement(slot(150), slot(150, 100), 300, 1000).dir, 1);
    assert.equal(pourPlacement(slot(100, 400), slot(100), 300, 1000).dir, -1);
  });

  test('límec se u horní řady nedostane nad plátno', () => {
    const src = slot(100);
    const { y } = pourPlacement(src, slot(200, 4), BOARD_W, 50);
    assert.ok(y - src.w * 0.57 >= 0, `y = ${y}`);
    // Dole je místa dost: hrdlo zůstává nad cílovou lahví.
    assert.equal(pourPlacement(src, slot(200, 300), BOARD_W, 50).y, 300 - 24);
  });
});
