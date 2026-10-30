import type { Game } from '../core/game.ts';
import type { Move } from '../core/types.ts';
import type { Board } from './board.ts';

export interface DebugHost {
  board: Board;
  getGame(): Game | null;
  jumpTo(level: number): void;
  solveCurrent(): Promise<Move[] | null>;
}

/** Debug panel (zapne se parametrem ?debug): FPS, skok na level, řešení, automatické dohrání. */
export function setupDebug(host: DebugHost): { onFrame(dt: number): void; refresh(): void } {
  const el = document.getElementById('debug');
  if (!el || !new URLSearchParams(location.search).has('debug')) {
    return { onFrame: () => undefined, refresh: () => undefined };
  }
  el.hidden = false;
  // Přístup z konzole / automatických testů.
  (window as unknown as { __debug?: DebugHost }).__debug = host;
  el.innerHTML = `
    <div id="dbg-fps">FPS: –</div>
    <div id="dbg-info"></div>
    <div><input id="dbg-level" type="number" min="1" inputmode="numeric" /><button id="dbg-go">Skok</button></div>
    <div><button id="dbg-hint">Nápověda</button><button id="dbg-auto">Dohrát</button></div>
  `;
  const fpsEl = el.querySelector<HTMLDivElement>('#dbg-fps')!;
  const infoEl = el.querySelector<HTMLDivElement>('#dbg-info')!;
  const input = el.querySelector<HTMLInputElement>('#dbg-level')!;

  let frames = 0;
  let acc = 0;
  let worst = 0;
  const onFrame = (dt: number) => {
    frames++;
    acc += dt;
    worst = Math.max(worst, dt);
    if (acc >= 0.5) {
      fpsEl.textContent = `FPS: ${Math.round(frames / acc)} (nejhorší snímek ${Math.round(worst * 1000)} ms)`;
      frames = 0;
      acc = 0;
      worst = 0;
    }
  };

  const refresh = () => {
    const g = host.getGame();
    if (!g) {
      infoEl.textContent = '';
      return;
    }
    const m = g.def.meta;
    infoEl.innerHTML =
      `L${g.def.level} ${g.def.tier} · ${g.def.colors} barev · ${g.caps.length} lahví<br>` +
      `obtížnost ${m.difficulty.toFixed(2)} · fail ${m.failRate.toFixed(2)}<br>` +
      `řešení ${m.solutionLength} tahů · gen ${m.ms} ms`;
    input.value = String(g.def.level);
  };

  el.querySelector('#dbg-go')!.addEventListener('click', () => {
    const n = Number(input.value);
    if (n >= 1) host.jumpTo(Math.floor(n));
  });
  el.querySelector('#dbg-hint')!.addEventListener('click', async () => {
    const moves = await host.solveCurrent();
    host.board.setHint(moves && moves.length ? moves[0] : null);
    if (!moves) infoEl.textContent = 'Solver nenašel řešení (zkus Zpět).';
  });
  el.querySelector('#dbg-auto')!.addEventListener('click', async () => {
    const moves = await host.solveCurrent();
    if (!moves) return;
    host.board.setHint(null);
    for (const m of moves) {
      host.board.tap(m.from);
      host.board.tap(m.to);
      await new Promise((r) => setTimeout(r, 120));
      while (host.board.isBusy()) await new Promise((r) => setTimeout(r, 50));
    }
  });
  return { onFrame, refresh };
}
