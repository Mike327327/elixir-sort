# CLAUDE.md – Elixir Sort

Offline PWA hra water sort (klon mechanik hry Magic Sort) pro iPhone 2022+. Vanilla TypeScript + Vite + Canvas 2D, žádný framework, žádný backend. Zadání: SPEC.md, stav a odchylky: README.md. Uživatel komunikuje česky; komentáře v kódu a texty UI jsou česky.

## Příkazy

- `npm test` – `node --test "src/**/*.test.ts"` (Node ≥ 22.18 spouští TS přímo, bez Vitestu)
- `npm run typecheck` – `tsconfig.json` (aplikace, DOM) + `tsconfig.node.json` (testy, skripty, vite.config)
- `npm run build` – typecheck + `vite build` → `dist/` včetně vygenerovaného `sw.js`
- `npm run levels -- 1 300` – report generátoru (parametry, obtížnost, ms)
- Debug v prohlížeči: `?debug` → `window.__debug` (board, getGame, jumpTo, solveCurrent)

## Konvence (důležité)

- Importy vždy s příponou `.ts` (`import { x } from './rules.ts'`) – kvůli Node type stripping. `allowImportingTsExtensions` + `noEmit`.
- Jen „erasable“ TypeScript (`erasableSyntaxOnly`): žádné `enum`, `namespace`, parameter properties.
- Žádné runtime závislosti. Dev závislosti jen vite, typescript, @types/node.
- `Math.random` nikdy v generátoru (determinismus) – jen `core/rng.ts`. Ve vizuálních efektech je OK.
- Logika (`core/`, `solver/`) nesmí sahat na DOM; musí jít testovat v Node.
- Texty UI jen v `src/ui/strings.ts`.
- Po změně generátoru/křivky zvýšit `GENERATOR_VERSION` v `core/config.ts`.

## Architektura

- `core/rules.ts` – čisté funkce nad `Unit[][]` (+ `isHidden`). `core/game.ts` – třída `Game`: stav, Zpět (historie tahů), +1 lahev, Restart, odkrývání (`revealed` je trvalé), snapshot pro localStorage.
- `solver/board.ts` – kompaktní kódování (barva 0–31, skrytá = barva + 32), `genMoves`/`applyS` musí přesně odpovídat `core/rules.ts` (hlídá test „pravidla solveru odpovídají pravidlům hry“).
- `solver/generator.ts` – zpětná konstrukce: z vyřešeného stavu náhodné obrácené tahy (s návratem při zaseknutí), hodnocení promíchanosti, výběr kandidáta podle obtížnosti na kvantilu `params.pick`. Vrací i řešení (test ho přehrává v `Game`).
- `solver/solver.ts` – best-first solver (`solve`) + `measureDifficulty` (náhodní hladoví hráči).
- `worker/` – generování a solver ve Web Workeru; `LevelService` cachuje a předgenerovává další level, při selhání workeru generuje na hlavním vlákně.
- `render/layout.ts` – rozložení podle kapacit (řady seřazené podle výšky), `hitTest`. `render/renderer.ts` – kreslení lahve (sklo, tekutina vzpřímeně i nakloněná s vodorovnou hladinou), proud, ruka; `pourAngle` počítá náklon z objemu.
- `ui/board.ts` – řadič hrací plochy: výběr, animace přelití (fly/pour/back), Zpět, zátky, odkrývání, částice, nápověda; rAF smyčka běží jen při animaci. Logický stav se mění okamžitě, animace ho dohání; lahve v animaci jsou zamčené.
- `main.ts` – obrazovky, panely, ukládání, tutoriál, tipy. `pwa.ts` – registrace SW (jen PROD), aktualizace jen na úvodní obrazovce.
- `vite.config.ts` – plugin `elixir-sw` vyrobí `sw.js` ze `src/sw-template.js` se seznamem všech souborů buildu.

## Co zbývá

1. Ověřit `npm install` + `npm run build` (Vite v původním prostředí neběželo – plugin SW a worker nejsou ověřené buildem).
2. Test na iPhonu (viz checklist v README) a případné doladění výkonu (offscreen cache skla).
3. Ladění obtížnosti v `core/config.ts` podle hraní.
4. Nice-to-have: vysoké lahve po stranách přes víc řad (jako originál), lint.
