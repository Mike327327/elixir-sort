import type { LevelDef, Move } from '../core/types.ts';

export type WorkerRequest =
  | { id: number; type: 'generate'; level: number }
  | { id: number; type: 'solve'; caps: number[]; b: number[][]; nodeLimit: number };

export type WorkerResponse =
  | { id: number; ok: true; type: 'generate'; def: LevelDef }
  | { id: number; ok: true; type: 'solve'; moves: Move[] | null }
  | { id: number; ok: false; error: string };
