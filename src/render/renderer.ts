import type { BottleGeom } from './layout.ts';
import { colorOf, HIDDEN_COLOR, shade, SYMBOLS } from './palette.ts';

/** Vrstva tekutiny pro vykreslení. `amount` v jednotkách (může být desetinné během animace). */
export interface LiquidLayer {
  color: number;
  amount: number;
  /** 1 = skrytá (tmavá s otazníkem), 0 = odkrytá; mezi = animace odkrývání. */
  hidden: number;
}

/** Poloha lahve: x/y = střed horního okraje límce (hrdlo), angle = náklon kolem hrdla (rad). */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export interface BottleDraw {
  geom: BottleGeom;
  pose: Pose;
  layers: LiquidLayer[];
  /** Barva zátky (null = bez zátky). */
  cork: number | null;
  /** 0 = zátka nad lahví, 1 = usazená. */
  corkProgress: number;
  /** 0–1 zvýraznění vybrané lahve. */
  highlight: number;
  symbols: boolean;
}

export interface StreamDraw {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  width: number;
}

type Pt = { x: number; y: number };

/** Plocha polygonu pod vodorovnou přímkou y = level (v canvasu y roste dolů). */
function areaBelow(poly: Pt[], level: number): number {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = a.y >= level;
    const bIn = b.y >= level;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (level - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: level });
    }
  }
  let s = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** Najde výšku hladiny tak, aby plocha pod ní odpovídala objemu. */
function levelForVolume(poly: Pt[], volume: number, minY: number, maxY: number): number {
  if (volume <= 0) return maxY;
  let lo = minY;
  let hi = maxY;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (areaBelow(poly, mid) > volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Mnohoúhelník vnitřku lahve v souřadnicích s počátkem v hrdle, otočený o `angle`. */
function innerPoly(g: BottleGeom, angle: number, ox = 0, oy = 0): Pt[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const iw = g.innerW;
  const tw = (x: number, y: number): Pt => ({ x: ox + x * cos - y * sin, y: oy + x * sin + y * cos });
  return [tw(-iw / 2, 0), tw(iw / 2, 0), tw(iw / 2, g.liquidBottom), tw(-iw / 2, g.liquidBottom)];
}

/**
 * Úhel náklonu (kladný, ve směru hodinových ručiček), při kterém hladina daného množství
 * tekutiny právě dosáhne na spodní okraj hrdla – tehdy začne tekutina vytékat.
 */
export function pourAngle(g: BottleGeom, units: number): number {
  const maxA = (95 * Math.PI) / 180;
  const minA = (30 * Math.PI) / 180;
  if (units <= 0.01) return maxA;
  const volume = units * g.u * g.innerW;
  // Vytéká, když hladina (y) je nad (menší y) nebo na úrovni dolního rtu hrdla.
  const pours = (a: number) => {
    const poly = innerPoly(g, a);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const level = levelForVolume(poly, volume, minY, maxY);
    const lipY = (g.innerW / 2) * Math.sin(a);
    return level <= lipY;
  };
  if (pours(minA)) return minA;
  let lo = minA;
  let hi = maxA;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (pours(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  width = 0;
  height = 0;
  private gradients = new Map<string, CanvasGradient>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D není k dispozici');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.gradients.clear();
  }

  clear(): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private worldTransform(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private liquidGradient(color: number, innerW: number): CanvasGradient {
    const key = `${color}|${innerW}`;
    let g = this.gradients.get(key);
    if (!g) {
      const base = colorOf(color);
      g = this.ctx.createLinearGradient(-innerW / 2, 0, innerW / 2, 0);
      g.addColorStop(0, shade(base, 0.28));
      g.addColorStop(0.32, base);
      g.addColorStop(1, shade(base, -0.2));
      this.gradients.set(key, g);
    }
    return g;
  }

  /** Obrys těla lahve v lokálních souřadnicích (počátek = střed hrdla nahoře). */
  private bodyPath(g: BottleGeom, inset: number, close: boolean): void {
    const ctx = this.ctx;
    const hw = g.w / 2 - inset;
    const top = close ? -2 : g.rimH * 0.6;
    const bottom = g.h - inset;
    const r = Math.max(2, g.r - inset);
    ctx.beginPath();
    ctx.moveTo(-hw, top);
    ctx.lineTo(-hw, bottom - r);
    ctx.quadraticCurveTo(-hw, bottom, -hw + r, bottom);
    ctx.lineTo(hw - r, bottom);
    ctx.quadraticCurveTo(hw, bottom, hw, bottom - r);
    ctx.lineTo(hw, top);
    if (close) ctx.closePath();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  drawBottle(d: BottleDraw): void {
    const { ctx } = this;
    const g = d.geom;
    ctx.save();
    ctx.translate(d.pose.x, d.pose.y);
    if (d.pose.angle !== 0) ctx.rotate(d.pose.angle);

    // Zvýraznění výběru.
    if (d.highlight > 0.01) {
      this.bodyPath(g, -g.w * 0.06, true);
      ctx.fillStyle = `rgba(255,255,255,${0.35 * d.highlight})`;
      ctx.fill();
    }

    // Sklo – zadní výplň.
    this.bodyPath(g, 0, true);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();

    // Tekutina.
    ctx.save();
    this.bodyPath(g, g.t, true);
    ctx.clip();
    if (d.pose.angle === 0) this.drawLiquidUpright(g, d.layers, d.symbols);
    ctx.restore();
    if (d.pose.angle !== 0) {
      ctx.restore();
      this.drawLiquidTilted(g, d.pose, d.layers);
      ctx.save();
      ctx.translate(d.pose.x, d.pose.y);
      ctx.rotate(d.pose.angle);
    }

    // Lesk a obrys skla.
    const hw = g.w / 2;
    this.roundRect(-hw + g.w * 0.13, g.rimH + g.w * 0.16, g.w * 0.1, Math.max(4, g.h - g.r - g.rimH - g.w * 0.22), g.w * 0.05);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    this.bodyPath(g, 0, false);
    ctx.lineWidth = Math.max(1.5, g.w * 0.045);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Límec hrdla.
    this.roundRect(-g.w * 0.57, 0, g.w * 1.14, g.rimH, g.rimH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, g.w * 0.03);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();

    // Zátka.
    if (d.cork !== null) {
      const p = Math.max(0, Math.min(1, d.corkProgress));
      const drop = (1 - p) * -g.w * 1.4;
      const cw = g.w * 0.74;
      const ch = g.w * 0.34;
      const base = colorOf(d.cork);
      ctx.globalAlpha = Math.min(1, p * 3);
      this.roundRect(-cw / 2, -ch * 0.55 + drop, cw, ch, ch * 0.35);
      ctx.fillStyle = shade(base, -0.15);
      ctx.fill();
      this.roundRect(-cw / 2 + cw * 0.12, -ch * 0.55 + drop + ch * 0.16, cw * 0.5, ch * 0.22, ch * 0.1);
      ctx.fillStyle = shade(base, 0.45);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawLiquidUpright(g: BottleGeom, layers: LiquidLayer[], symbols: boolean): void {
    const ctx = this.ctx;
    const iw = g.innerW;
    let y = g.liquidBottom;
    let topColor = -1;
    let topY = y;
    for (const layer of layers) {
      if (layer.amount <= 0) continue;
      const h = layer.amount * g.u;
      const y1 = y - h;
      ctx.fillStyle = this.liquidGradient(layer.color, iw);
      // +0.5 px přesah, ať mezi vrstvami nevzniká šev.
      ctx.fillRect(-iw / 2 - 1, y1, iw + 2, h + 0.5);
      if (layer.hidden > 0) {
        ctx.globalAlpha = layer.hidden;
        ctx.fillStyle = HIDDEN_COLOR;
        ctx.fillRect(-iw / 2 - 1, y1, iw + 2, h + 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(g.u * 0.62)}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, y1 + h / 2 + 1);
        ctx.globalAlpha = 1;
      } else if (symbols) {
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = `${Math.round(g.u * 0.46)}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const whole = Math.floor(layer.amount + 0.001);
        for (let k = 0; k < whole; k++) ctx.fillText(SYMBOLS[layer.color % SYMBOLS.length], 0, y - (k + 0.5) * g.u);
      }
      y = y1;
      topY = y1;
      topColor = layer.hidden > 0.5 ? -1 : layer.color;
    }
    // Hladina – světlejší elipsa nahoře.
    if (topColor >= 0) {
      ctx.fillStyle = shade(colorOf(topColor), 0.4);
      ctx.beginPath();
      ctx.ellipse(0, topY, iw / 2, Math.max(1.5, g.u * 0.11), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Tekutina v nakloněné lahvi: hladiny zůstávají vodorovné. */
  private drawLiquidTilted(g: BottleGeom, pose: Pose, layers: LiquidLayer[]): void {
    const ctx = this.ctx;
    const iw = g.innerW;
    const poly = innerPoly(g, pose.angle, pose.x, pose.y);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    this.bodyPath(g, g.t, true);
    ctx.clip();
    this.worldTransform();

    let volume = 0;
    let prevLevel = maxY + 2;
    let topLevel = maxY;
    let topColor = -1;
    for (const layer of layers) {
      if (layer.amount <= 0) continue;
      volume += layer.amount * g.u * iw;
      const level = levelForVolume(poly, volume, minY, maxY);
      const base = colorOf(layer.color);
      ctx.fillStyle = layer.hidden > 0.5 ? HIDDEN_COLOR : base;
      ctx.fillRect(minX - 2, level, maxX - minX + 4, prevLevel - level + 0.5);
      prevLevel = level;
      topLevel = level;
      topColor = layer.hidden > 0.5 ? -1 : layer.color;
    }
    if (topColor >= 0) {
      ctx.fillStyle = shade(colorOf(topColor), 0.4);
      ctx.fillRect(minX - 2, topLevel - 1, maxX - minX + 4, Math.max(1.5, g.u * 0.08));
    }
    ctx.restore();
  }

  drawStream(s: StreamDraw): void {
    const ctx = this.ctx;
    this.worldTransform();
    ctx.strokeStyle = colorOf(s.color);
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.quadraticCurveTo(s.x1 + (s.x0 - s.x1) * 0.15, s.y0 + (s.y1 - s.y0) * 0.35, s.x1, s.y1);
    ctx.stroke();
  }

  /** Ukazovací ruka pro tutoriál (kreslená, bez emoji). */
  drawHand(x: number, y: number, scale: number, alpha: number): void {
    const ctx = this.ctx;
    this.worldTransform();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // Kruh v místě dotyku.
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
    // Prst + dlaň.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#5b3a8a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(-6, 26);
    ctx.quadraticCurveTo(-18, 22, -16, 34);
    ctx.lineTo(-4, 52);
    ctx.lineTo(22, 52);
    ctx.quadraticCurveTo(28, 40, 26, 30);
    ctx.lineTo(26, 22);
    ctx.quadraticCurveTo(20, 16, 14, 22);
    ctx.quadraticCurveTo(10, 14, 4, 20);
    ctx.lineTo(4, 0);
    ctx.quadraticCurveTo(-1, -6, -6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
