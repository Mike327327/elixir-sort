import { Sfx } from './audio/sfx.ts';
import { HIDDEN_INTRO_LEVEL, TUTORIAL_LEVELS } from './core/config.ts';
import { Game } from './core/game.ts';
import type { LevelDef, Move } from './core/types.ts';
import { applyPendingUpdate, registerServiceWorker } from './pwa.ts';
import { ConfettiLayer } from './render/confetti.ts';
import { toSBoard } from './solver/board.ts';
import { Board } from './ui/board.ts';
import { setupDebug } from './ui/debug.ts';
import { clearData, defaultData, loadData, requestPersistence, saveData, type SaveData } from './ui/storage.ts';
import { S } from './ui/strings.ts';
import { LevelService } from './worker/client.ts';

const APP_VERSION = '0.1.0';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Chybí prvek #${id}`);
  return el as T;
};

type PanelId = 'panel-win' | 'panel-stuck' | 'panel-settings' | 'panel-tip';

class App {
  private data: SaveData = loadData();
  private readonly sfx = new Sfx();
  private readonly levels = new LevelService();
  private readonly board: Board;
  private game: Game | null = null;
  /** Hra, jejíž výhra už je započítaná (výhra se ukládá hned, panel přijde až po oslavě). */
  private recordedWin: Game | null = null;
  private loadToken = 0;
  private hintToken = 0;
  private resetArmed = 0;
  private readonly debug: { onFrame(dt: number): void; refresh(): void };

  constructor() {
    this.fillStrings();
    this.sfx.enabled = this.data.settings.sound;
    this.board = new Board($('board'), $<HTMLCanvasElement>('canvas'), this.sfx, new ConfettiLayer($<HTMLCanvasElement>('confetti')), {
      onChange: () => this.onChange(),
      onWin: () => this.onWin(),
      onStuck: () => this.onStuck(),
      onFrame: (dt) => this.debug.onFrame(dt),
    });
    this.board.symbols = this.data.settings.symbols;
    this.debug = setupDebug({
      board: this.board,
      getGame: () => this.game,
      jumpTo: (level) => {
        this.data.level = level;
        this.data.current = null;
        this.persist();
        void this.startLevel();
      },
      solveCurrent: () => this.solveCurrent(),
    });
    this.bindUi();
    this.updateHome();
    // Předgeneruj aktuální level, ať je po ťuknutí na Hrát hned připravený.
    this.levels.prefetch(this.data.level);
    requestPersistence();
  }

  // ---------------------------------------------------------------- UI

  private fillStrings(): void {
    for (const el of document.querySelectorAll<HTMLElement>('[data-s]')) {
      const key = el.dataset.s as keyof typeof S;
      const value = S[key];
      if (typeof value === 'string') el.textContent = value;
    }
    $('loading-text').textContent = S.loading;
    $('btn-retry').textContent = S.retry;
    $('app-version').textContent = S.version(APP_VERSION);
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    document.documentElement.classList.toggle('standalone', standalone);
    if (isIos && !standalone) {
      const hint = $('install-hint');
      hint.textContent = S.installHint;
      hint.hidden = false;
    }
  }

  private bindUi(): void {
    const on = (id: string, fn: () => void) =>
      $(id).addEventListener('click', () => {
        this.sfx.unlock();
        fn();
      });

    on('btn-play', () => void this.startLevel());
    on('btn-back', () => this.goHome());
    on('btn-home-settings', () => this.openSettings());
    on('btn-game-settings', () => this.openSettings());
    on('btn-restart', () => {
      this.board.restart();
    });
    on('btn-undo', () => {
      this.board.undo();
    });
    on('btn-add', () => {
      this.board.addBottle();
    });
    on('btn-next', () => {
      this.closePanels();
      void this.startLevel();
    });
    on('btn-stuck-undo', () => {
      this.closePanels();
      this.board.undo();
    });
    on('btn-stuck-add', () => {
      this.closePanels();
      this.board.addBottle();
    });
    on('btn-stuck-restart', () => {
      this.closePanels();
      this.board.restart();
    });
    on('btn-retry', () => void this.startLevel());
    on('btn-settings-close', () => this.closePanels());
    on('btn-tip-ok', () => {
      if (!this.data.seenTips.includes('hidden')) this.data.seenTips.push('hidden');
      this.persist();
      this.closePanels();
    });
    on('btn-reset', () => this.resetProgress());

    // Na iOS audio odemkne až konec dotyku (pointerdown nestačí), i po návratu z pozadí.
    for (const type of ['pointerup', 'touchend'] as const) {
      document.addEventListener(type, () => this.sfx.unlock(), { capture: true, passive: true });
    }

    const sound = $<HTMLInputElement>('opt-sound');
    sound.checked = this.data.settings.sound;
    sound.addEventListener('change', () => {
      this.data.settings.sound = sound.checked;
      this.sfx.enabled = sound.checked;
      this.persist();
    });
    const symbols = $<HTMLInputElement>('opt-symbols');
    symbols.checked = this.data.settings.symbols;
    symbols.addEventListener('change', () => {
      this.data.settings.symbols = symbols.checked;
      this.board.symbols = symbols.checked;
      this.board.requestRender();
      this.persist();
    });

    // iOS: žádný zoom ani posouvání stránky.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener(
      'touchmove',
      (e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.persist();
      else {
        this.sfx.resume();
        this.board.relayout();
      }
    });
    window.addEventListener('pagehide', () => this.persist());
  }

  private showScreen(name: 'home' | 'game'): void {
    $('screen-home').classList.toggle('active', name === 'home');
    $('screen-game').classList.toggle('active', name === 'game');
    if (name === 'game') requestAnimationFrame(() => this.board.relayout());
  }

  private openPanel(id: PanelId): void {
    for (const p of ['panel-win', 'panel-stuck', 'panel-settings', 'panel-tip'] as const) $(p).hidden = p !== id;
    $('overlay').hidden = false;
  }

  private closePanels(): void {
    $('overlay').hidden = true;
    for (const p of ['panel-win', 'panel-stuck', 'panel-settings', 'panel-tip'] as const) $(p).hidden = true;
  }

  private updateHome(): void {
    $('btn-play').textContent = S.play(this.data.level);
    $('home-stats').textContent = this.data.stats.completed > 0 ? S.completed(this.data.stats.completed) : '';
  }

  private updateButtons(): void {
    const g = this.game;
    const playing = !!g && !g.isWon();
    $<HTMLButtonElement>('btn-undo').disabled = !playing || !g.canUndo();
    $<HTMLButtonElement>('btn-add').disabled = !playing || !g.canAddBottle();
    $<HTMLButtonElement>('btn-restart').disabled = !playing;
  }

  private goHome(): void {
    this.persist();
    this.hintToken++;
    this.board.leave();
    this.closePanels();
    this.showScreen('home');
    this.updateHome();
    applyPendingUpdate();
  }

  private openSettings(): void {
    this.resetArmed = 0;
    $('btn-reset').textContent = S.resetProgress;
    this.openPanel('panel-settings');
  }

  private resetProgress(): void {
    const btn = $('btn-reset');
    if (Date.now() - this.resetArmed > 3000) {
      this.resetArmed = Date.now();
      btn.textContent = S.resetConfirm;
      return;
    }
    clearData();
    const settings = this.data.settings;
    this.data = defaultData();
    this.data.settings = settings;
    this.hintToken++;
    this.board.leave();
    this.game = null;
    this.persist();
    btn.textContent = S.resetDone;
    this.resetArmed = 0;
    this.closePanels();
    this.showScreen('home');
    this.updateHome();
  }

  private persist(): void {
    if (this.game && !this.game.isWon()) this.data.current = this.game.toSnapshot();
    saveData(this.data);
  }

  // ---------------------------------------------------------------- level

  async startLevel(): Promise<void> {
    const token = ++this.loadToken;
    const level = this.data.level;
    this.closePanels();
    this.showScreen('game');
    $('level-label').textContent = S.level(level);
    $('tier-badge').hidden = true;
    $('banner').hidden = true;
    const loading = $('loading');
    $('btn-retry').hidden = true;
    $('loading-text').textContent = S.loading;
    // Spinner jen když generování trvá (z cache je level hned).
    const spinnerTimer = window.setTimeout(() => {
      if (token === this.loadToken) loading.hidden = false;
    }, 120);

    let def: LevelDef;
    try {
      def = await this.levels.getLevel(level);
    } catch {
      window.clearTimeout(spinnerTimer);
      if (token !== this.loadToken) return;
      loading.hidden = false;
      $('loading-text').textContent = S.loadError;
      $('btn-retry').hidden = false;
      return;
    }
    window.clearTimeout(spinnerTimer);
    if (token !== this.loadToken) return;
    loading.hidden = true;

    this.game = new Game(def, this.data.current);
    this.data.current = this.game.toSnapshot();
    this.persist();
    this.board.setGame(this.game);
    this.updateButtons();
    this.debug.refresh();

    const badge = $('tier-badge');
    if (def.tier !== 'normal') {
      badge.textContent = def.tier === 'hard' ? S.tierHard : S.tierVeryHard;
      badge.classList.toggle('very-hard', def.tier === 'veryhard');
      badge.hidden = false;
      if (this.game.history.length === 0) this.showBanner(def.tier === 'hard' ? S.bannerHard : S.bannerVeryHard, def.tier === 'veryhard');
    }
    if (def.level >= HIDDEN_INTRO_LEVEL && def.hidden.length > 0 && !this.data.seenTips.includes('hidden')) {
      this.openPanel('panel-tip');
    }
    void this.refreshTutorialHint();
    this.levels.prefetch(level + 1);
  }

  private showBanner(text: string, veryHard: boolean): void {
    const banner = $('banner');
    banner.textContent = text;
    banner.classList.toggle('very-hard', veryHard);
    banner.hidden = false;
    // Restart animace.
    banner.style.animation = 'none';
    void banner.offsetWidth;
    banner.style.animation = '';
    window.setTimeout(() => {
      banner.hidden = true;
    }, 1700);
  }

  private async solveCurrent(): Promise<Move[] | null> {
    const g = this.game;
    if (!g) return null;
    const sb = toSBoard(g.caps, g.bottles, g.isHidden);
    return this.levels.solve(sb.caps, sb.b);
  }

  /** V tutoriálu (levely 1–3) ukazuje ruka další dobrý tah. */
  private async refreshTutorialHint(): Promise<void> {
    const g = this.game;
    if (!g || g.def.level > TUTORIAL_LEVELS || g.isWon()) {
      this.board.setHint(null);
      return;
    }
    const token = ++this.hintToken;
    const moves = await this.solveCurrent();
    if (token !== this.hintToken || g !== this.game) return;
    this.board.setHint(moves && moves.length > 0 ? moves[0] : null);
  }

  // ---------------------------------------------------------------- události z hrací plochy

  private onChange(): void {
    this.recordWin();
    this.persist();
    this.updateButtons();
    if (this.game && this.game.def.level <= TUTORIAL_LEVELS) {
      this.board.setHint(null);
      void this.refreshTutorialHint();
    }
  }

  /** Započítá výhru hned po vítězném tahu, ať ji neztratí zavření aplikace během oslavy. */
  private recordWin(): void {
    const g = this.game;
    if (!g || !g.isWon() || this.recordedWin === g) return;
    this.recordedWin = g;
    this.data.stats.completed++;
    this.data.stats.totalMoves += g.moves;
    this.data.level = g.def.level + 1;
    this.data.current = null;
    this.levels.prefetch(this.data.level);
  }

  private onWin(): void {
    const g = this.game;
    if (!g) return;
    this.board.setHint(null);
    $('win-title').textContent = S.winTitle(g.def.level);
    $('win-moves').textContent = S.winMoves(g.moves);
    this.openPanel('panel-win');
  }

  private onStuck(): void {
    const g = this.game;
    if (!g) return;
    $<HTMLButtonElement>('btn-stuck-undo').disabled = !g.canUndo();
    $<HTMLButtonElement>('btn-stuck-add').disabled = !g.canAddBottle();
    this.openPanel('panel-stuck');
  }
}

new App();
registerServiceWorker(() => $('screen-home').classList.contains('active'));
