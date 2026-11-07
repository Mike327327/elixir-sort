import { Particles } from './particles.ts';

/**
 * Konfety přes celou obrazovku. Mají vlastní plátno nad panely, které existuje jen během
 * oslavy, takže kvůli nim neběží smyčka hrací plochy ani rozostření pod panelem výhry.
 */
export class ConfettiLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly particles = new Particles();
  private ctx: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private lastT = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  start(colors: number[]): void {
    // Rozměr podle CSS (celá obrazovka), ne innerHeight – v nainstalované PWA na iOS je kratší.
    this.canvas.hidden = false;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || window.innerWidth;
    const h = rect.height || window.innerHeight;
    // Víc než 2× není na malých poletujících obdélnících vidět a stálo by to paměť.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) {
      this.canvas.hidden = true;
      return;
    }
    this.particles.clear();
    this.particles.confetti(w, h, colors);
    this.lastT = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.particles.clear();
    this.canvas.hidden = true;
    // Uvolní paměť plátna, dokud není potřeba.
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private readonly frame = (t: number): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    this.particles.update(dt);
    if (!this.particles.active) {
      this.stop();
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.draw(ctx, this.dpr);
    this.raf = requestAnimationFrame(this.frame);
  };
}
