import { colorOf } from './palette.ts';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  kind: 'spark' | 'confetti';
}

/** Jiskry při uzavření lahve a konfety při výhře. */
export class Particles {
  private items: Particle[] = [];

  get active(): boolean {
    return this.items.length > 0;
  }

  sparkle(x: number, y: number, color: number, count = 12): void {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 70 + Math.random() * 90;
      this.items.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 60,
        life: 0,
        maxLife: 0.55 + Math.random() * 0.25,
        size: 2.5 + Math.random() * 2.5,
        color: i % 3 === 0 ? '#ffffff' : colorOf(color),
        rot: 0,
        vr: 0,
        kind: 'spark',
      });
    }
  }

  confetti(width: number, height: number, colors: number[], count = 110): void {
    for (let i = 0; i < count; i++) {
      this.items.push({
        x: Math.random() * width,
        y: -20 - Math.random() * height * 0.3,
        vx: (Math.random() - 0.5) * 80,
        vy: height * (0.25 + Math.random() * 0.25),
        life: 0,
        maxLife: 2.2 + Math.random() * 0.8,
        size: 5 + Math.random() * 5,
        color: i % 5 === 0 ? '#ffffff' : colorOf(colors[i % colors.length] ?? i),
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 10,
        kind: 'confetti',
      });
    }
  }

  clear(): void {
    this.items = [];
  }

  update(dt: number): void {
    for (const p of this.items) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'spark') {
        p.vy += 260 * dt;
        p.vx *= 0.96;
      } else {
        p.vx += Math.sin(p.life * 3 + p.rot) * 20 * dt;
      }
    }
    this.items = this.items.filter((p) => p.life < p.maxLife);
  }

  draw(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of this.items) {
      const fade = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, fade * 1.6));
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + fade * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
}
