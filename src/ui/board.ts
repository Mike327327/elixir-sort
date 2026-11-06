import type { Game } from '../core/game.ts';
import type { Move, Unit } from '../core/types.ts';
import type { Sfx } from '../audio/sfx.ts';
import type { ConfettiLayer } from '../render/confetti.ts';
import { computeLayout, hitTest, pourPlacement, type Layout, type Slot } from '../render/layout.ts';
import { Particles } from '../render/particles.ts';
import { pourAngle, Renderer, type LiquidLayer, type Pose } from '../render/renderer.ts';

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
  /** Poloha hrdla při přelévání. */
  x: number;
  y: number;
  /** Náklon na začátku a na konci přelévání (bez znaménka směru). */
  angleStart: number;
  angleEnd: number;
  closedTarget: boolean;
  revealed: number[];
  pourEnded: boolean;
}

interface CorkAnim {
  start: number;
  color: number;
  landed: boolean;
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

// Časování přelití podle zadání: asi 700 ms, víc tekutiny teče o něco déle. Zpět asi 300 ms.
const FLY_MS = 200;
const BACK_MS = 200;
const pourMs = (count: number) => Math.min(380, 220 + count * 40);
const UNDO_FLY_MS = 90;
const UNDO_POUR_MS = 120;

const SHAKE_MS = 320;
const CORK_MS = 420;
/** Kdy zátka poprvé dosedne (první dopad v easeOutBounce). */
const CORK_LAND = 1 / 2.75;
const REVEAL_MS = 200;

export class Board {
  readonly renderer: Renderer;
  private game: Game | null = null;
  private layout: Layout = { slots: [], w: 0, u: 0, rows: 0 };
  private selected = -1;
  private lift: number[] = [];
  private shakes = new Map<number, number>();
  private pours: PourAnim[] = [];
  private corks = new Map<number, CorkAnim>();
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
  private readonly confetti: ConfettiLayer;
  private readonly cb: BoardCallbacks;

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, sfx: Sfx, confetti: ConfettiLayer, cb: BoardCallbacks) {
    this.container = container;
    this.sfx = sfx;
    this.confetti = confetti;
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
    this.confetti.stop();
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

  /** Hráč odešel z hrací plochy: rozehrané animace ani čekající panel výhry už nemají co ukazovat. */
  leave(): void {
    this.locked = true;
    this.hint = null;
    window.clearTimeout(this.winTimer);
    this.confetti.stop();
    this.finishAll(false);
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
    // Lahve v běžící animaci jsou do jejího konce zamčené.
    if (this.isLockedBottle(idx)) return;
    if (this.selected < 0) {
      if (game.canSelect(idx)) {
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

  private startPour(from: number, to: number): void {
    const game = this.game!;
    const res = game.pour(from, to);
    if (!res) return;
    this.selected = -1;
    this.stuckNotified = false;
    const anim = this.makeAnim(from, to, res.move.count, res.before.from, game.bottles[from], res.before.to);
    anim.tFly = FLY_MS;
    anim.tPour = pourMs(res.move.count);
    anim.tBack = BACK_MS;
    anim.closedTarget = res.closedTarget;
    anim.revealed = res.revealed;
    // Odkrytá jednotka ve zdrojové lahvi se rozlije, až když lahev stojí zpátky na místě.
    const pourEnd = anim.start + anim.tFly + anim.tPour;
    const inSource = new Set(anim.srcAfter.map((u) => u.id));
    for (const id of res.revealed) this.reveals.set(id, inSource.has(id) ? pourEnd + anim.tBack : pourEnd);
    this.pours.push(anim);
    this.sfx.pour(anim.tPour);
    this.cb.onChange();
    this.requestRender();
  }

  private makeAnim(from: number, to: number, count: number, srcBefore: Unit[], srcAfter: Unit[], dstBefore: Unit[]): PourAnim {
    const fs = this.layout.slots[from];
    const ts = this.layout.slots[to];
    // Úhel tak, aby hladina právě dosahovala na hrdlo (fyzikálně věrohodné vytékání).
    const angleStart = pourAngle(fs, srcBefore.length);
    const angleEnd = pourAngle(fs, srcAfter.length);
    const place = pourPlacement(fs, ts, this.renderer.width, fs.h * Math.sin(Math.min(angleEnd, Math.PI / 2)));
    return {
      from,
      to,
      count,
      color: srcBefore[srcBefore.length - 1].c,
      srcBefore,
      srcAfter: srcAfter.slice(),
      dstBefore,
      start: performance.now(),
      tFly: UNDO_FLY_MS,
      tPour: UNDO_POUR_MS,
      tBack: UNDO_FLY_MS,
      dir: place.dir,
      x: place.x,
      y: place.y,
      angleStart,
      angleEnd,
      closedTarget: false,
      revealed: [],
      pourEnded: false,
    };
  }

  /** Zpět s rychlou animací (přelití obráceně). */
  undo(): boolean {
    const game = this.game;
    if (!game || !game.canUndo() || game.isWon()) return false;
    this.finishAll(true);
    const res = game.undo();
    if (!res) return false;
    // Animace: jednotky se vracejí z `to` do `from`.
    const { move, before } = res;
    this.corks.delete(move.to);
    this.pours.push(this.makeAnim(move.to, move.from, move.count, before.to, game.bottles[move.to], before.from));
    this.selected = -1;
    this.stuckNotified = false;
    this.cb.onChange();
    this.requestRender();
    return true;
  }

  addBottle(): boolean {
    const game = this.game;
    if (!game || !game.canAddBottle() || game.isWon()) return false;
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
    if (!game || game.isWon()) return;
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
    if (p.closedTarget) this.corks.set(p.to, { start: now, color: p.color, landed: false });
  }

  /** Výhra se vyhlásí, až doběhnou všechna přelití – bez ohledu na to, které bylo vítězné. */
  private checkWin(): void {
    const game = this.game;
    if (game && !this.locked && this.pours.length === 0 && game.isWon()) this.celebrate();
  }

  private celebrate(): void {
    const game = this.game;
    if (!game) return;
    this.locked = true;
    this.confetti.start(Array.from(new Set(game.bottles.flat().map((u) => u.c))));
    this.sfx.win();
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
    for (const [i, cork] of this.corks) {
      const t = (now - cork.start) / CORK_MS;
      if (!cork.landed && t >= CORK_LAND) {
        // Zátka dosedla: cvaknutí a jiskry v barvě lahve.
        cork.landed = true;
        const s = this.layout.slots[i];
        if (s) this.particles.sparkle(s.x, s.y + s.w * 0.1, cork.color);
        this.sfx.pop();
      }
      if (t > 1) this.corks.delete(i);
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
        if (!p.pourEnded && el >= p.tFly + p.tPour) this.onPourEnd(p, now);
        if (el >= p.tFly + p.tPour + p.tBack) done.push(p);
      }
      if (done.length) {
        this.pours = this.pours.filter((p) => !done.includes(p));
        if (done.some((p) => p.revealed.length > 0)) this.sfx.reveal();
        this.checkWin();
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
      const cork = this.corks.get(i);
      const corkT = cork ? clamp01((now - cork.start) / CORK_MS) : 1;
      r.drawBottleCached(i, {
        geom,
        pose: this.homePose(i, now),
        layers,
        cork: closed && units.length > 0 ? units[0].c : null,
        corkProgress: cork ? easeOutBounce(corkT) : 1,
        highlight: this.lift[i] ?? 0,
        flash: corkT >= CORK_LAND && cork ? 0.65 * (1 - (corkT - CORK_LAND) / (1 - CORK_LAND)) ** 2 : 0,
        symbols: this.symbols,
      });
    }

    // 2) Nakloněné zdrojové lahve navrchu + proudy.
    for (const p of this.pours) {
      const fs = this.layout.slots[p.from];
      const ts = this.layout.slots[p.to];
      if (!fs || !ts) continue;
      const el = now - p.start;
      const a1 = p.dir * p.angleStart;
      const a2 = p.dir * p.angleEnd;
      let pose: Pose;
      let layers: LiquidLayer[];
      let streamQ = -1;
      if (el < p.tFly) {
        const t = easeOut(clamp01(el / p.tFly));
        pose = { x: lerp(fs.x, p.x, t), y: lerp(fs.y, p.y, t), angle: lerp(0, a1, t) };
        layers = this.layersOf(p.srcBefore, now);
      } else if (el < p.tFly + p.tPour) {
        const q = clamp01((el - p.tFly) / p.tPour);
        const remaining = p.srcBefore.length - p.count * easeInOut(q);
        pose = { x: p.x, y: p.y, angle: p.dir * pourAngle(fs, remaining) };
        layers = this.layersOf(p.srcBefore, now);
        const last = layers[layers.length - 1];
        if (last) last.amount = Math.max(0, last.amount - p.count * easeInOut(q));
        streamQ = q;
      } else {
        const t = easeInOut(clamp01((el - p.tFly - p.tPour) / p.tBack));
        pose = { x: lerp(p.x, fs.x, t), y: lerp(p.y, fs.y, t), angle: lerp(a2, 0, t) };
        layers = this.layersOf(p.srcAfter, now);
      }
      r.drawBottle({ geom: fs, pose, layers, cork: null, corkProgress: 1, highlight: 0, flash: 0, symbols: false });

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
