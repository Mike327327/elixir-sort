/// Web Worker: generování levelů a solver běží mimo hlavní vlákno.
import { generateLevel } from '../solver/generator.ts';
import { solve } from '../solver/solver.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const reply = (msg: WorkerResponse) => {
  (self as unknown as { postMessage(m: WorkerResponse): void }).postMessage(msg);
};

self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'generate') {
      reply({ id: req.id, ok: true, type: 'generate', def: generateLevel(req.level) });
    } else {
      const res = solve(req.caps, req.b, req.nodeLimit);
      reply({ id: req.id, ok: true, type: 'solve', moves: res.status === 'solved' ? res.moves : null });
    }
  } catch (err) {
    reply({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
