import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bottleGeom } from './layout.ts';
import { pourAngle, spriteKey, type BottleDraw } from './renderer.ts';

describe('úhel přelévání', () => {
  test('čím méně tekutiny, tím větší náklon', () => {
    const g = bottleGeom(50, 34, 4);
    const angles = [4, 3, 2, 1, 0].map((n) => (pourAngle(g, n) * 180) / Math.PI);
    for (let i = 1; i < angles.length; i++) {
      assert.ok(angles[i] > angles[i - 1], `úhly nerostou: ${angles.map((a) => a.toFixed(0)).join(', ')}`);
    }
    assert.ok(angles[0] < 60, `plná lahev by měla téct už při malém náklonu (${angles[0].toFixed(0)}°)`);
    assert.ok(angles[3] <= 95);
  });

  test('vysoká lahev s jednou jednotkou se nakloní skoro vodorovně', () => {
    const g = bottleGeom(40, 20, 8);
    const a = (pourAngle(g, 1) * 180) / Math.PI;
    assert.ok(a > 75 && a <= 95, `úhel ${a.toFixed(0)}°`);
  });
});

describe('klíč předkreslené lahve', () => {
  const base: BottleDraw = {
    geom: bottleGeom(50, 34, 4),
    pose: { x: 10, y: 10, angle: 0 },
    layers: [{ color: 1, amount: 2, hidden: 0 }],
    cork: null,
    corkProgress: 1,
    highlight: 0,
    flash: 0,
    symbols: false,
  };

  test('nezávisí na poloze ani zvýraznění, takže se zdvih a zatřesení nepřekreslují', () => {
    const moved = { ...base, pose: { x: 99, y: 3, angle: 0 }, highlight: 0.5 };
    assert.equal(spriteKey(moved), spriteKey(base));
  });

  test('změní se s obsahem lahve', () => {
    const keys = [
      base,
      { ...base, layers: [{ color: 2, amount: 2, hidden: 0 }] },
      { ...base, layers: [{ color: 1, amount: 3, hidden: 0 }] },
      { ...base, layers: [{ color: 1, amount: 2, hidden: 1 }] },
      { ...base, cork: 1 },
      { ...base, symbols: true },
      { ...base, geom: bottleGeom(50, 34, 5) },
    ].map(spriteKey);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('lahev uprostřed animace se nepředkresluje', () => {
    assert.equal(spriteKey({ ...base, pose: { x: 0, y: 0, angle: 0.5 } }), null);
    assert.equal(spriteKey({ ...base, corkProgress: 0.5 }), null);
    assert.equal(spriteKey({ ...base, flash: 0.3 }), null);
    assert.equal(spriteKey({ ...base, layers: [{ color: 1, amount: 1.5, hidden: 0 }] }), null);
    assert.equal(spriteKey({ ...base, layers: [{ color: 1, amount: 1, hidden: 0.4 }] }), null);
  });
});
