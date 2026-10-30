/**
 * Vypíše parametry, naměřenou obtížnost a čas generování pro levely.
 * Použití: npm run levels -- [od] [do]   (výchozí 1 300)
 */
import { generateLevel } from '../src/solver/generator.ts';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 300);

const pad = (v: string | number, n: number) => String(v).padStart(n);
console.log(
  [
    pad('lvl', 4), pad('tier', 8), pad('bar', 4), pad('lah', 4), pad('prz', 4), pad('kap', 5),
    pad('skr', 4), pad('pick', 5), pad('obt', 5), pad('fail', 5), pad('řeš', 4), pad('kand', 5), pad('ms', 5),
  ].join(' '),
);

let total = 0;
let max = 0;
for (let level = from; level <= to; level++) {
  const def = generateLevel(level);
  const p = def.params;
  const m = def.meta;
  total += m.ms;
  max = Math.max(max, m.ms);
  const caps = `${Math.min(...def.capacities)}-${Math.max(...def.capacities)}`;
  console.log(
    [
      pad(level, 4), pad(def.tier, 8), pad(def.colors, 4), pad(def.capacities.length, 4),
      pad(def.bottles.filter((b) => b.length === 0).length, 4), pad(caps, 5), pad(def.hidden.length, 4),
      pad(p.pick.toFixed(2), 5), pad(m.difficulty.toFixed(2), 5), pad(m.failRate.toFixed(2), 5),
      pad(m.solutionLength, 4), pad(m.candidates, 5), pad(m.ms, 5),
    ].join(' '),
  );
}
const n = to - from + 1;
console.log(`\nLevelů: ${n}`);
console.log(`Čas generování: průměr ${Math.round(total / n)} ms, max ${max} ms (Node na PC; iPhone bude zhruba 1,5–2× pomalejší)`);
