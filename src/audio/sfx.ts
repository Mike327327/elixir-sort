/**
 * Syntetické zvuky přes Web Audio API (žádné audio soubory).
 * Na iOS se AudioContext musí odemknout při prvním dotyku a po návratu z pozadí obnovit.
 */
type Ctor = typeof AudioContext;

export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Volat z obsluhy dotyku (gesta) – vytvoří/obnoví AudioContext. */
  unlock(): void {
    if (!this.ctx) {
      const AC: Ctor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  private ready(): AudioContext | null {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  select(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(880, ctx.currentTime, 0.06, 'sine', 0.25, 1200);
  }

  invalid(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(220, ctx.currentTime, 0.12, 'triangle', 0.25, 160);
  }

  /** Bublání: série krátkých tónů s náhodnou výškou. */
  pour(durationMs: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.18;
    const n = Math.max(3, Math.round(durationMs / 55));
    for (let i = 0; i < n; i++) {
      const f = 260 + Math.random() * 380 + i * 18;
      this.tone(f, t0 + i * 0.05 + Math.random() * 0.02, 0.07, 'sine', 0.18, f * 1.6);
    }
  }

  pop(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(520, ctx.currentTime, 0.09, 'square', 0.12, 1400);
    this.tone(1600, ctx.currentTime + 0.05, 0.12, 'sine', 0.2, 2200);
  }

  reveal(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(1200, ctx.currentTime, 0.15, 'sine', 0.15, 1800);
  }

  win(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.11, 0.28, 'triangle', 0.3));
    this.tone(1318.5, t + 0.48, 0.5, 'sine', 0.25);
  }
}
