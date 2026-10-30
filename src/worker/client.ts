import type { LevelDef, Move } from '../core/types.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Request = DistributiveOmit<WorkerRequest, 'id'>;

/**
 * Přístup k generátoru a solveru ve Web Workeru, s cache a předgenerováním dalšího levelu.
 * Když worker nejde spustit, generuje se na hlavním vlákně (pomalejší, ale funkční).
 */
export class LevelService {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private cache = new Map<number, Promise<LevelDef>>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data);
        else p.reject(new Error(e.data.error));
      });
      this.worker.addEventListener('error', () => this.fallbackToMainThread());
    } catch {
      this.worker = null;
    }
  }

  private fallbackToMainThread(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.reject(new Error('worker-failed'));
    this.pending.clear();
    this.cache.clear();
  }

  private async run(req: Request): Promise<WorkerResponse> {
    if (this.worker) {
      const id = this.nextId++;
      const worker = this.worker;
      return new Promise<WorkerResponse>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.postMessage({ ...req, id } as WorkerRequest);
      }).catch(() => this.runLocal(req));
    }
    return this.runLocal(req);
  }

  private async runLocal(req: Request): Promise<WorkerResponse> {
    await new Promise((r) => setTimeout(r, 0));
    if (req.type === 'generate') {
      const { generateLevel } = await import('../solver/generator.ts');
      return { id: 0, ok: true, type: 'generate', def: generateLevel(req.level) };
    }
    const { solve } = await import('../solver/solver.ts');
    const res = solve(req.caps, req.b, req.nodeLimit);
    return { id: 0, ok: true, type: 'solve', moves: res.status === 'solved' ? res.moves : null };
  }

  getLevel(level: number): Promise<LevelDef> {
    let p = this.cache.get(level);
    if (!p) {
      p = this.run({ type: 'generate', level }).then((r) => {
        if (r.ok && r.type === 'generate') return r.def;
        throw new Error('generate failed');
      });
      p.catch(() => this.cache.delete(level));
      this.cache.set(level, p);
      // Drž v cache jen pár posledních levelů.
      if (this.cache.size > 6) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined && oldest !== level) this.cache.delete(oldest);
      }
    }
    return p;
  }

  prefetch(level: number): void {
    void this.getLevel(level).catch(() => undefined);
  }

  async solve(caps: number[], b: number[][], nodeLimit = 80000): Promise<Move[] | null> {
    const r = await this.run({ type: 'solve', caps, b, nodeLimit });
    return r.ok && r.type === 'solve' ? r.moves : null;
  }
}
