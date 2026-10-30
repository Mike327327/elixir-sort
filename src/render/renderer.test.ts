import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { bottleGeom } from './layout.ts';
import { pourAngle } from './renderer.ts';

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
