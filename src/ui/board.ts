import type { Game } from '../core/game.ts';
import type { Move, Unit } from '../core/types.ts';
import type { Sfx } from '../audio/sfx.ts';
import { computeLayout, hitTest, type Layout, type Slot } from '../render/layout.ts';
import { Particles } from '../render/particles.ts';
import { Renderer, type LiquidLayer, type Pose } from '../render/renderer.ts';

export interface BoardCallbacks {
  /** Stav hry se změnil (ulož, aktualizuj tlačítka). */
  onChange(): void;
  onWin(): void;
  onStuck(): void;
  /** Volá se každý snímek (pro FPS v debug panelu). */
  onFrame?(dt: number): void;
}

interface PourAnim {
  from: number;
  to: number;
  count: number;
  color: number;
  srcBefore: Unit[];
  srcAfter: Unit[];
  dstBefore: Unit[];
  start: number;
  tFly: number;
  tPour: number;
  tBack: number;
  dir: 1 | -1;
  closedTarget: boolean;
  revealed: number[];
  won: boolean;
  fast: boolean;
  pourEnded: boolean;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEG = Math.PI / 180;

/** Náklon podle toho, kolik tekutiny v lahvi zbývá (plná = méně, prázdná = víc). */
const tiltFor = (fraction: number) => lerp(102 * DEG, 52 * DEG, clamp01(fraction));

const SHAKE_MS = 320;
const CORK_MS = 420;
const REVEAL_MS = 320;

export class Board {
  readonly renderer: Renderer;
  private game: Game | null = null;
  private layout: Layout = { slots: [], w: 0, u: 0, rows: 0 };
  private selected = -1;
  private lift: number[] = [];
  private shakes = new Map<number, number>();
  private pours: PourAnim[] = [];
  private corks = new Map<number, number>();
  private reveals = new Map<number, number>();
  private particles = new Particles();
  private hint: Move | null = null;
  private running = false;
  private lastT = 0;
  private stuckNotified = false;
  private winTimer = 0;
  symbols = false;
  /** Vstup zablokovaný (např. během panelu výhry). */
  locked = false;

  private readonly container: HTMLElement;
  private readonly sfx: Sfx;
  private readonly cb: BoardCallbacks;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, sfx: Sfx, cb: BoardCallbacks) {
    this.container = container;
    this.sfx = sfx;
    this.cb = cb;
    this.renderer = new Renderer(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onPointer(e));
    const ro = new ResizeObserver(() => this.relayout());
    ro.observe(container);
    window.addEventListener('orientationchange', () => setTimeout(() => this.relayout(), 300));
  }

  setGame(game: Game): void {
    this.finishAll(false);
    window.clearTimeout(this.winTimer);
    this.game = game;
    this.selected = -1;
    this.lift = game.bottles.map(() => 0);
    this.shakes.clear();
    this.corks.clear();
    this.reveals.clear();
    this.particles.clear();
    this.hint = null;
    this.stuckNotified = false;
    this.locked = false;
    this.relayout();
  }

  setHint(move: Move | null): void {
    this.hint = move;
    this.requestRender();
  }

  relayout(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    this.renderer.resize(rect.width, rect.height);
    if (this.game) {
      this.layout = computeLayout(this.game.caps, rect.width, rect.height);
      while (this.lift.length < this.game.caps.length) this.lift.push(0);
    }
    this.requestRender();
  }

  get slots(): Slot[] {
    return this.layout.slots;
  }

  isBusy(): boolean {
    return this.pours.length > 0;
  }

  // ---------------------------------------------------------------- vstup

  private isLockedBottle(i: number): boolean {
    return this.pours.some((p) => p.from === i || p.to === i);
  }

  private onPointer(e: PointerEvent): void {
    e.preventDefault();
    this.sfx.unlock();
    if (!this.game || this.locked) return;
    const rect = this.renderer.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const idx = hitTest(this.layout.slots, x, y, (i) => this.liftPx(i));
    this.tap(idx);
  }

  /** Ťuknutí na lahev (nebo mimo, idx = -1). Veřejné kvůli testům a nápovědě. */
  tap(idx: number): void {
    const game = this.game;
    if (!game) return;
    if (idx < 0) {
      this.select(-1);
      return;
    }
    if (this.selected < 0) {
      if (game.canSelect(idx) && !this.isLockedBottle(idx)) {
        this.select(idx);
        this.sfx.select();
      } else {
        this.shake(idx);
      }
      return;
    }
    if (idx === this.selected) {
      this.select(-1);
      return;
    }
    if (this.isLockedBottle(idx)) return;
    if (game.pourAmount(this.selected, idx) > 0) {
      this.startPour(this.selected, idx);
      return;
    }
    this.shake(idx);
    this.sfx.invalid();
    if (game.canSelect(idx)) {
      this.select(idx);
    }
  }

  private select(i: number): void {
    this.selected = i;
    this.requestRender();
  }

  private shake(i: number): void {
    this.shakes.set(i, performance.now());
    this.requestRender();
  }

  private liftPx(i: number): number {
    const s = this.layout.slots[i];
    return s ? (this.lift[i] ?? 0) * s.h * 0.12 : 0;
  }

  // ---------------------------------------------------------------- tahy

  private startPour(from: number, to: number, fast = false): void {
    const game = this.game!;
    const res = game.pour(from, to);
    if (!res) return;
    this.selected = -1;
    this.stuckNotified = false;
    const count = res.move.count;
    const color = res.before.from[res.before.from.length - 1].c;
    const fs = this.layout.slots[from];
    const ts = this.layout.slots[to];
    const anim: PourAnim = {
      from,
      to,
      count,
      color,
      srcBefore: res.before.from,
      srcAfter: game.bottles[from].slice(),
      dstBefore: res.before.to,
      start: performance.now(),
      tFly: fast ? 120 : 230,
      tPour: fast ? 160 : Math.min(520, 260 + count * 60),
      tBack: fast ? 120 : 230,
      dir: ts.x >= fs.x ? 1 : -1,
      closedTarget: res.closedTarget,
      revealed: res.revealed,
      won: res.won,
      fast,
      pourEnded: false,
    };
    const revealAt = anim.start + anim.tFly + anim.tPour;
    for (const id of res.revealed) this.reveals.set(id, revealAt);
    this.pours.push(anim);
    if (!fast) this.sfx.pour(anim.tPour);
    this.cb.onChange();
    this.requestRender();
  }

  /** Zpět s rychlou animací (přelití obráceně). */
  undo(): boolean {
    const game = this.game;
    if (!game || !game.canUndo()) return false;
    this.finishAll(true);
    const res = game.undo();
    if (!res) return false;
    // Animace: jednotky se vracejí z `to` do `from`.
    const { move, before } = res;
    const fs = this.layout.slots[move.to];
    const ts = this.layout.slots[move.from];
    const anim: PourAnim = {
      from: move.to,
      to: move.from,
      count: move.count,
      color: before.to[before.to.length - 1].c,
      srcBefore: before.to,
      srcAfter: game.bottles[move.to].slice(),
      dstBefore: before.from,
      start: performance.now(),
      tFly: 110,
      tPour: 150,
      tBack: 110,
      dir: ts.x >= fs.x ? 1 : -1,
      closedTarget: false,
      revealed: [],
      won: false,
      fast: true,
      pourEnded: false,
    };
    this.corks.delete(move.to);
    this.pours.push(anim);
    this.selected = -1;
    this.stuckNotified = false;
    this.cb.onChange();
    this.requestRender();
    return true;
  }

  addBottle(): boolean {
    const game = this.game;
    if (!game || !game.canAddBottle()) return false;
    this.finishAll(true);
    game.addBottle();
    this.lift.push(0);
    this.stuckNotified = false;
    this.relayout();
    this.cb.onChange();
    return true;
  }

  restart(): void {
    const game = this.game;
    if (!game) return;
    this.finishAll(false);
    game.restart();
    this.selected = -1;
    this.lift = game.bottles.map(() => 0);
    this.corks.clear();
    this.reveals.clear();
    this.stuckNotified = false;
    this.relayout();
    this.cb.onChange();
  }

  /** Dokončí běžící animace okamžitě (efekty volitelně). */
  finishAll(withEffects: boolean): void {
    const now = performance.now();
    for (const p of this.pours) {
      if (withEffects && !p.pourEnded) this.onPourEnd(p, now);
    }
    this.pours = [];
    for (const [id] of this.reveals) this.reveals.set(id, now - REVEAL_MS);
    this.requestRender();
  }

  private onPourEnd(p: PourAnim, now: number): void {
    p.pourEnded = true;
    const s = this.layout.slots[p.to];
    if (p.closedTarget && s) {
      this.corks.set(p.to, now);
      this.particles.sparkle(s.x, s.y + s.h * 0.3, p.color);
      this.sfx.pop();
    }
    if (p.revealed.length > 0) this.sfx.reveal();
  }

  private onPourDone(p: PourAnim): void {
    if (p.won && this.pours.length === 0) this.celebrate();
  }

  private celebrate(): void {
    const game = this.game;
    if (!game) return;
    this.locked = true;
    const colors = Array.from(new Set(game.bottles.flat().map((u) => u.c)));
    this.particles.confetti(this.renderer.width, colors);
    this.sfx.win();
    this.requestRender();
    this.winTimer = window.setTimeout(() => this.cb.onWin(), 900);
  }

  // ---------------------------------------------------------------- vykreslení

  requestRender(): void {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (t: number): void => {
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    const now = performance.now();
    const animating = this.update(dt, now);
    this.draw(now);
    this.cb.onFrame?.(dt);
    if (animating) requestAnimationFrame(this.frame);
    else {
      this.running = false;
      this.afterSettled();
    }
  };

  private afterSettled(): void {
    const game = this.game;
    if (!game || this.locked || this.stuckNotified) return;
    if (game.isStuck()) {
      this.stuckNotified = true;
      this.cb.onStuck();
    }
  }

  /** Aktualizuje stav animací, vrací true, pokud je potřeba další snímek. */
  private update(dt: number, now: number): boolean {
    let animating = false;
    // Zdvih vybrané lahve (plynulé přiblížení).
    const k = 1 - Math.exp(-dt * 22);
    for (let i = 0; i < this.lift.length; i++) {
      const target = i === this.selected ? 1 : 0;
      const v = this.lift[i] + (target - this.lift[i]) * k;
      this.lift[i] = Math.abs(v - target) < 0.002 ? target : v;
      if (this.lift[i] !== target) animating = true;
    }
    for (const [i, start] of this.shakes) {
      if (now - start > SHAKE_MS) this.shakes.delete(i);
      else animating = true;
    }
    for (const [i, start] of this.corks) {
      if (now - start > CORK_MS) this.corks.delete(i);
      else animating = true;
    }
    for (const [id, start] of this.reveals) {
      if (now - start > REVEAL_MS) this.reveals.delete(id);
      else animating = true;
    }
    if (this.pours.length > 0) {
      animating = true;
      const done: PourAnim[] = [];
      for (const p of this.pours) {
        const el = now - p.start;
        if (!p.pourEnded && el >= p.tFly + p.tPour && !p.fast) this.onPourEnd(p, now);
        else if (!p.pourEnded && el >= p.tFly + p.tPour) p.pourEnded = true;
        if (el >= p.tFly + p.tPour + p.tBack) done.push(p);
      }
      if (done.length) {
        this.pours = this.pours.filter((p) => !done.includes(p));
        for (const p of done) this.onPourDone(p);
      }
    }
    this.particles.update(dt);
    if (this.particles.active) animating = true;
    if (this.hint) animating = true;
    return animating;
  }

  private hiddenAlpha(u: Unit, now: number): number {
    const game = this.game!;
    const start = this.reveals.get(u.id);
    if (start !== undefined) return now < start ? 1 : 1 - clamp01((now - start) / REVEAL_MS);
    return game.isHidden(u) ? 1 : 0;
  }

  private layersOf(units: Unit[], now: number): LiquidLayer[] {
    const out: LiquidLayer[] = [];
    for (const u of units) {
      const h = this.hiddenAlpha(u, now);
      const last = out[out.length - 1];
      if (last && h === 0 && last.hidden === 0 && last.color === u.c) last.amount += 1;
      else out.push({ color: u.c, amount: 1, hidden: h });
    }
    return out;
  }

  private homePose(i: number, now: number): Pose {
    const s = this.layout.slots[i];
    let x = s.x;
    const shake = this.shakes.get(i);
    if (shake !== undefined) {
      const p = clamp01((now - shake) / SHAKE_MS);
      x += Math.sin(p * Math.PI * 6) * s.w * 0.09 * (1 - p);
    }
    return { x, y: s.y - this.liftPx(i), angle: 0 };
  }

  private draw(now: number): void {
    const game = this.game;
    const r = this.renderer;
    r.clear();
    if (!game || this.layout.slots.length === 0) return;

    const sources = new Map<number, PourAnim>();
    const targets = new Map<number, PourAnim>();
    for (const p of this.pours) {
      sources.set(p.from, p);
      targets.set(p.to, p);
    }

    // 1) Lahve v klidu a cíle přelévání.
    for (let i = 0; i < this.layout.slots.length; i++) {
      if (sources.has(i)) continue;
      const geom = this.layout.slots[i];
      const tp = targets.get(i);
      let units = game.bottles[i];
      let layers: LiquidLayer[];
      if (tp) {
        const el = now - tp.start;
        const q = clamp01((el - tp.tFly) / tp.tPour);
        if (el < tp.tFly + tp.tPour) {
          layers = this.layersOf(tp.dstBefore, now);
          if (q > 0) {
            const last = layers[layers.length - 1];
            const amount = tp.count * easeInOut(q);
            if (last && last.color === tp.color && last.hidden === 0) last.amount += amount;
            else layers.push({ color: tp.color, amount, hidden: 0 });
          }
        } else {
          layers = this.layersOf(units, now);
        }
      } else {
        layers = this.layersOf(units, now);
      }
      const closed = game.isClosed(i) && !(tp && !tp.pourEnded);
      const corkStart = this.corks.get(i);
      const corkProgress = corkStart === undefined ? 1 : easeOutBounce(clamp01((now - corkStart) / CORK_MS));
      r.drawBottle({
        geom,
        pose: this.homePose(i, now),
        layers,
        cork: closed && units.length > 0 ? units[0].c : null,
        corkProgress,
        highlight: this.lift[i] ?? 0,
        symbols: this.symbols,
      });
    }

    // 2) Nakloněné zdrojové lahve navrchu + proudy.
    for (const p of this.pours) {
      const fs = this.layout.slots[p.from];
      const ts = this.layout.slots[p.to];
      if (!fs || !ts) continue;
      const el = now - p.start;
      const home = { x: fs.x, y: fs.y, angle: 0 };
      const pourPose = {
        x: ts.x - p.dir * ts.w * 0.2,
        y: ts.y - ts.w * 0.62,
        angle: 0,
      };
      const capFrom = fs.cap;
      const a1 = p.dir * tiltFor(p.srcBefore.length / capFrom);
      const a2 = p.dir * tiltFor(p.srcAfter.length / capFrom);
      let pose: Pose;
      let layers: LiquidLayer[];
      let streamQ = -1;
      if (el < p.tFly) {
        const t = easeOut(clamp01(el / p.tFly));
        pose = { x: lerp(home.x, pourPose.x, t), y: lerp(home.y, pourPose.y, t), angle: lerp(0, a1, t) };
        layers = this.layersOf(p.srcBefore, now);
      } else if (el < p.tFly + p.tPour) {
        const q = clamp01((el - p.tFly) / p.tPour);
        pose = { x: pourPose.x, y: pourPose.y, angle: lerp(a1, a2, easeInOut(q)) };
        layers = this.layersOf(p.srcBefore, now);
        const last = layers[layers.length - 1];
        if (last) last.amount = Math.max(0, last.amount - p.count * easeInOut(q));
        streamQ = q;
      } else {
        const t = easeInOut(clamp01((el - p.tFly - p.tPour) / p.tBack));
        pose = { x: lerp(pourPose.x, home.x, t), y: lerp(pourPose.y, home.y, t), angle: lerp(a2, 0, t) };
        layers = this.layersOf(p.srcAfter, now);
      }
      r.drawBottle({ geom: fs, pose, layers, cork: null, corkProgress: 1, highlight: 0, symbols: false });

      if (streamQ >= 0) {
        const lipX = p.dir * fs.innerW * 0.5;
        const cos = Math.cos(pose.angle);
        const sin = Math.sin(pose.angle);
        const x0 = pose.x + lipX * cos;
        const y0 = pose.y + lipX * sin;
        const filled = p.dstBefore.length + p.count * easeInOut(streamQ);
        const y1 = ts.y + ts.liquidBottom - filled * ts.u;
        const taper = Math.sin(Math.PI * Math.min(1, streamQ * 1.15)) ** 0.35;
        r.drawStream({
          x0,
          y0,
          x1: ts.x,
          y1,
          color: p.color,
          width: Math.max(2.5, fs.innerW * 0.2 * taper),
        });
      }
    }

    // 3) Částice a nápověda.
    this.particles.draw(r.ctx, r.dpr);
    if (this.hint && this.pours.length === 0) {
      const target = this.selected === this.hint.from ? this.hint.to : this.hint.from;
      const s = this.layout.slots[target];
      if (s) {
        const t = (now % 1200) / 1200;
        const press = t < 0.25 ? Math.sin((t / 0.25) * Math.PI) : 0;
        r.drawHand(s.x + s.w * 0.15, s.y + s.h * 0.45 + Math.sin(t * Math.PI * 2) * 4, 0.75 - press * 0.08, 0.95);
      }
    }
  }
}
