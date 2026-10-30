import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, hitTest } from './layout.ts';
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

  test('24 lahví s kapacitami až 8 + přidaná lahev se vejde na iPhone SE se šířkou ≥ 38 px', () => {
    const caps = [8, 7, 7, 6, 6, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 4, 4];
    const se = check(caps, IPHONE_SE, 38);
    const i14 = check(caps, IPHONE_14, 40);
    console.log(`    šířka lahve: SE ${se.w} px, iPhone 14 ${i14.w} px`);
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
