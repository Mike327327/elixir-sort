# Zadání: Elixir Sort (PWA)

Původní zadání (30. 10. 2026). Kde se implementace od zadání vědomě odchyluje, je to popsané v README.md v sekci „Odchylky od zadání“.
Živá verze dokumentu: https://claude.ai/artifact/K6nmQQjm1UHhWgH7rug2Kx

## Cíl a kontext

Postav offline PWA hru typu water sort, která se hraje co nejpodobněji mobilní hře Magic Sort (Grand Games) a běží plynule na iPhonu z roku 2022. Hra je pro osobní použití, bez reklam, bez plateb a bez backendu.

Pracovní název je **Elixir Sort**. Název, logo, grafiku ani texty Magic Sortu nekopíruj. Převezmi jen herní mechaniky a celkový pocit, všechny grafické prvky vytvoř vlastní.

Co do hry **nepatří**:

- reklamy, nákupy, mince, životy, série výher
- účty, přihlašování, síťová volání po prvním načtení
- speciální objekty z pozdějších levelů Magic Sortu (led, zámek a klíč, krabice, kámen, štítky) – možné rozšíření později, kód je ale nepřipravuj
- denní výzva s časovačem

Jazyk rozhraní je čeština. Všechny texty dej do jednoho souboru (`strings.ts`), ať jde snadno přeložit.

## Cílové zařízení a stack

Hlavní cíl je iPhone 14 (rok 2022, čip A15, displej 390 × 844 pt, notch) v Safari a jako PWA nainstalovaná na plochu. Musí fungovat také na iPhonu SE 3. gen. (375 × 667 pt) a na iPhonu 14 Pro (Dynamic Island, 120 Hz). Minimální verze je iOS 16.4.

| Oblast | Volba |
| --- | --- |
| Jazyk | TypeScript (strict) |
| Build | Vite |
| Framework | žádný, vanilla TS; UI mimo herní plochu jako jednoduché DOM komponenty |
| Vykreslování herní plochy | Canvas 2D, škálovaný podle `devicePixelRatio` |
| Generátor a solver | Web Worker |
| PWA | `vite-plugin-pwa` (Workbox), precache všech souborů |
| Testy | Vitest pro logiku, solver a generátor |
| Zvuky | Web Audio API, synteticky generované, bez audio souborů |

Výsledek je statický web (složka `dist/`), který jde nasadit na libovolný HTTPS hosting.

## Pravidla hry

Hráč přelévá barevné vrstvy mezi lahvemi, dokud v každé neprázdné lahvi není jen jedna barva. Všechna pravidla implementuj jako čisté funkce bez závislosti na vykreslování.

**Datový model**

- Level = seznam lahví. Lahev má `capacity` (počet jednotek, 2–8) a obsah jako zásobník jednotek odspodu nahoru.
- Jednotka = `{ color: number, hidden: boolean }`.
- Lahve v jednom levelu mohou mít různou kapacitu, stejně jako v Magic Sortu (úzké vysoké lahve vedle normálních).
- Každá barva má v levelu tolik jednotek, kolik je součet kapacit lahví, do kterých má skončit. Jedna barva tak může zaplnit i víc lahví, jako v originále.

**Přelit z A do B jde, když platí vše:**

1. A není prázdná, A ≠ B a A není uzavřená.
2. B není plná a není uzavřená.
3. B je prázdná, nebo má nahoře stejnou barvu jako A.

Přelije se souvislý blok stejné barvy z vrcholu A, ale jen tolik jednotek, kolik se vejde do B. Zbytek zůstane v A.

**Uzavření lahve:** lahev plná jedné barvy (bez skrytých jednotek) dostane zátku a už s ní nejde hýbat.

**Výhra:** každá neprázdná lahev je plná jedné barvy a uzavřená; ostatní lahve jsou prázdné.

**Bezvýchodná situace:** když neexistuje žádný platný tah, hra to oznámí a nabídne Zpět, +1 lahev (pokud ještě nebyla použita) a Restart. Level se nikdy automaticky neprohrává.

**Pomocníky (zdarma, bez měny):**

| Pomocník | Pravidlo |
| --- | --- |
| Zpět | neomezeně, vrací tahy jeden po druhém až na začátek levelu |
| +1 lahev | jednou za level, přidá prázdnou lahev s kapacitou nejběžnější lahve v levelu |
| Restart | vrátí level do počátečního stavu se stejným rozložením |

## Skryté barvy

Skryté jednotky fungují jako v Magic Sortu, ale bez prvku náhody, který na originálu hráči nejvíc kritizují.

- Skrytá jednotka se kreslí jako tmavá vrstva s otazníkem. Skrytá může být jen jednotka, která není na vrcholu lahve.
- Jakmile se jednotka dostane na vrchol (po odlití toho, co bylo nad ní), odkryje se s krátkou animací a zůstane odkrytá natrvalo.
- **Zpět jednotku znovu neskryje.** Hráč tak může odkrýt, zjistit barvu a vrátit se. Díky tomu nikdy neprohraje kvůli špatnému odhadu.
- Restart levelu vrací stejné rozložení. Již odkryté jednotky po restartu zůstanou odkryté.
- Generátor ověřuje řešitelnost s plnými informacemi o skrytých barvách.
- Skryté barvy se objeví od levelu 31 (viz obtížnost), zpočátku 2–3 jednotky na level.

## Generátor levelů a obtížnost

Levely se generují nekonečně a deterministicky: level N vypadá vždy stejně. Generování běží ve Web Workeru a další level se předgeneruje už během hraní toho aktuálního.

**Generátor**

1. Seed = číslo levelu + konstanta `GENERATOR_VERSION`. PRNG např. mulberry32, nikdy `Math.random`.
2. Podle křivky níže zvol počet barev, lahví, kapacity a počet skrytých jednotek.
3. Přiřaď barvám cílové lahve (barva může mít víc lahví) a vytvoř všechny jednotky.
4. Jednotky náhodně rozděl do lahví. Většina lahví je plná, některé částečně, 1–2 prázdné.
5. Odmítni kandidáta, když je některá lahev už vyřešená, nebo když je moc souvislých bloků stejné barvy.
6. Označ skryté jednotky (nikdy ne vrchol lahve).
7. Ověř solverem a změř obtížnost. Nevyhovuje → další kandidát ze stejného PRNG.

Generování jednoho levelu musí na iPhonu 14 trvat pod 500 ms.

**Solver**

- Hledání do hloubky nebo best-first s heuristikou (počet barevných rozhraní + nevyřešené lahve).
- Memoizace kanonického stavu: lahve seřazené, v klíči i kapacita.
- Ořezávání zbytečných tahů: přelití celé jednobarevné lahve do prázdné, tah hned vracející předchozí.
- Limit 200 000 stavů, pak kandidáta zahodit.
- Solver vrací i řešení. Použij ho pro testy a skrytou nápovědu v debug módu.

**Měření obtížnosti:** délka řešení a podíl náhodných „hladových“ hráčů (např. 30 simulací), kteří skončí v bezvýchodné situaci. Každé pásmo níže má cílový rozsah těchto hodnot.

**Křivka obtížnosti** (hodnoty uvnitř pásma rostou s číslem levelu):

| Levely | Barev | Lahví celkem | Prázdných | Kapacity | Skrytých jednotek |
| --- | --- | --- | --- | --- | --- |
| 1–3 (tutoriál) | 2–3 | 4–5 | 2 | 4 | 0 |
| 4–15 | 4–5 | 6–8 | 2 | 4 | 0 |
| 16–30 | 5–6 | 9–12 | 2 | 3–5 | 0 |
| 31–60 | 6–8 | 12–16 | 2 | 3–6 | 2–4 |
| 61–120 | 7–9 | 16–20 | 1–2 | 2–7 | 3–6 |
| 121+ | 8–10 | 20–24 | 1–2 | 2–8 | 4–8 |

Každý 5. level je **Těžký** (horní hranice pásma), každý 25. **Velmi těžký** (parametry pásma o jedno výš). Po těžkém levelu následuje 1–2 lehčí. Všechny parametry dej do jednoho konfiguračního souboru, ať jde křivka ladit.

## Ovládání a animace

Hra se ovládá jen ťuknutím, jako originál. Animace jsou hlavní důvod, proč je originál příjemný, takže jim věnuj nejvíc pozornosti.

**Ovládání**

- Ťuk na lahev → lahev se zvedne asi o 12 % své výšky (výběr). Ťuk na tutéž lahev → položí se zpět.
- Ťuk na jinou lahev s platným tahem → přelití.
- Ťuk na lahev bez platného tahu → cílová lahev se krátce zatřese. Je-li neprázdná, výběr přejde na ni.
- Prázdnou nebo uzavřenou lahev nejde vybrat.
- Zóna pro dotyk je celý obdélník lahve plus okraj 8 pt, ať se trefí i úzké lahve.
- Během animace přelévání může hráč začít další tah s jinými lahvemi. Lahve zapojené do běžící animace jsou do jejího konce zamčené. Logický stav se mění okamžitě, animace ho jen dohání.

**Animace přelití** (celkem asi 700 ms):

1. Zdrojová lahev odletí nad cílovou, hrdlem k jejímu hrdlu (200 ms, ease-out).
2. Naklání se o 60–85° podle toho, kolik tekutiny v ní zbývá. Hladina zůstává vodorovná: tekutinu kresli jako obdélníky oříznuté tvarem otočené lahve.
3. Z hrdla teče proud v barvě tekutiny, v cíli plynule stoupá hladina, ve zdroji klesá (300 ms).
4. Lahev se vrátí na místo (200 ms).

**Další efekty**

- Odkrytí skryté jednotky: otazník zmizí, barva se „rozlije“ (200 ms).
- Uzavření lahve: zátka spadne shora, krátký záblesk a pár částic v barvě lahve.
- Výhra: konfety přes celou obrazovku, pak panel s tlačítkem Další.
- Zpět: zrychlená obrácená animace přelití (asi 300 ms).

**Zvuky** (Web Audio, vypnutelné): bublání při přelévání, cvaknutí při výběru, „pop“ zátky, krátká fanfára při výhře. Audio kontext odemkni při prvním dotyku. Vibrace iOS Safari nepodporuje, nepoužívej je.

## Vizuální styl

Pastelový „kouzelný“ styl podobný originálu, ale s vlastní grafikou. Vše kresli kódem (Canvas, SVG ikony), bez bitmap.

- **Pozadí:** světle levandulové (kolem `#D8B9F2`), jemný vertikální gradient a pár rozmazaných „jiskřiček“.
- **Lahve:** průhledné sklo s bílým obrysem, zakulacené dno, úzké hrdlo s rozšířeným okrajem. Svislý lesk na levé straně.
- **Tekutina:** syté barvy, každá vrstva s lehkým gradientem a světlejší elipsou hladiny nahoře. Sousední jednotky stejné barvy splývají v jednu vrstvu bez švu.
- **Paleta (10 barev):** růžová, žlutá, oranžová, zelená, modrá, fialová, červená, tyrkysová, hnědá, světle zelená. Barvy musí být na displeji jasně rozlišitelné; jako volitelné nastavení přidej symboly na vrstvách (pro barvoslepé).
- **Skrytá jednotka:** tmavě šedá vrstva s bílým otazníkem.
- **Zátka:** malý kulatý uzávěr v barvě lahve.

**Rozložení plochy**

- Lahve v řadách, zarovnané dnem na společnou linii řady, řady vycentrované.
- Výška jedné jednotky je v celém levelu stejná, takže vyšší kapacita = vyšší lahev.
- Rozložení se počítá automaticky tak, aby se vše vešlo na výšku obrazovky bez scrollování a lahve byly co největší. Při 24 lahvích musí být lahev široká aspoň 40 pt.
- Volitelně (nice-to-have): velmi vysoké lahve umístit po stranách přes víc řad, jako na snímku originálu.

## Obrazovky a UI

Hra má jen tři obrazovky a jeden panel. Hra je jen na výšku.

| Obrazovka | Obsah |
| --- | --- |
| Úvod | logo Elixir Sort (vlastní, kódem), velké tlačítko „Hrát – Level N“, ikona nastavení |
| Hra | horní lišta: zpět na úvod, „Level N“, štítek Těžký / Velmi těžký; uprostřed herní plocha; dolní lišta: Restart, Zpět, +1 lahev |
| Nastavení | zvuky zap/vyp, symboly pro barvoslepé, reset postupu (s potvrzením), verze aplikace |
| Panel výhry | „Level N splněn“, počet tahů, tlačítko Další level |

- Tlačítka mají dotykovou plochu aspoň 44 × 44 pt.
- Zpět je neaktivní na začátku levelu, +1 lahev po použití.
- Na začátku Těžkého levelu se krátce zobrazí banner „Těžký level“ (podobně jako v originálu).
- Tutoriál v levelech 1–3: animovaná ruka ukazuje, kam ťuknout. V levelu 31 krátké vysvětlení skrytých barev.

## Ukládání, PWA a iOS

Po prvním načtení hra funguje kompletně offline a po zavření pokračuje přesně tam, kde hráč skončil.

**Ukládání** (localStorage, každý přístup v try/catch, verze schématu v klíči):

- aktuální level a jeho rozehraný stav včetně historie tahů pro Zpět, odkrytých jednotek a použití +1 lahve
- nastavení
- statistiky (splněné levely, celkový počet tahů)
- Ukládej po každém tahu a při `visibilitychange` / `pagehide`.
- Zavolej `navigator.storage.persist()`, kde je k dispozici.

**PWA**

- Manifest: `display: standalone`, `orientation: portrait`, `theme_color` a `background_color` podle pozadí, ikony 192 a 512 px (i maskable).
- `apple-touch-icon` 180 px, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`.
- Service worker precachuje vše. Nová verze se aktivuje při příštím spuštění, nikdy uprostřed levelu.
- Na úvodní obrazovce v Safari (ne ve standalone) krátký návod: Sdílet → Přidat na plochu.

**iOS Safari specifika**

- `viewport-fit=cover` a `env(safe-area-inset-*)` pro notch, Dynamic Island a domácí indikátor.
- Zakázat zoom dvojklepnutím a pinch (`touch-action: manipulation`, meta viewport), gumový scroll (`overscroll-behavior: none`, `position: fixed` na body), výběr textu a callout (`-webkit-user-select`, `-webkit-touch-callout`), zvýraznění klepnutí (`-webkit-tap-highlight-color`).
- Ovládání přes Pointer Events, bez 300ms zpoždění a bez hover stavů.
- Výška obrazovky přes `100dvh` nebo `visualViewport`, ne `100vh`.
- Při změně velikosti nebo návratu z pozadí přepočítat rozložení a canvas.
- Web Audio odemknout při prvním dotyku a po návratu z pozadí obnovit (`resume()`).

## Výkon

Animace musí běžet stále na 60 fps na iPhonu 14 i při 24 lahvích a několika současných přelitích.

| Metrika | Limit |
| --- | --- |
| Snímková frekvence při animaci | 60 fps, žádný snímek nad 20 ms |
| Generování levelu (worker) | pod 500 ms |
| První vykreslení z cache | pod 1 s |
| Velikost buildu (gzip) | pod 150 kB |

- `requestAnimationFrame` jen když něco animuje; v klidu se nepřekresluje (šetří baterii).
- Statické části (pozadí, sklo lahví) předkreslit do offscreen canvasu a jen kopírovat.
- Canvas škálovat podle `devicePixelRatio` (max 3), žádné CSS filtry ani stíny na canvasu za běhu.
- Solver ani generátor nikdy neběží na hlavním vlákně.

## Postup implementace

Pracuj po fázích. Po každé fázi spusť testy, udělej commit a krátce shrň, co jde vyzkoušet.

1. **Kostra projektu:** Vite + TS, struktura složek (`core/`, `solver/`, `render/`, `ui/`, `worker/`), Vitest, lint.
2. **Herní logika:** model, pravidla přelití, uzavírání, výhra, bezvýchodná situace, Zpět, +1 lahev, skryté jednotky. Pokrýt testy.
3. **Solver a generátor** ve workeru: PRNG, křivka obtížnosti, měření. Test: prvních 300 levelů je řešitelných a deterministických. Skript, který vypíše parametry a čas generování pro levely 1–300.
4. **Vykreslení a ovládání** bez animací: rozložení, lahve, tekutiny, výběr, okamžité přelití. Hra je v této fázi hratelná.
5. **Animace a zvuky** podle sekce Ovládání a animace.
6. **Obrazovky, ukládání, tutoriál.**
7. **PWA a iOS doladění:** manifest, ikony, service worker, safe areas, test v Safari na iPhonu (přes lokální síť / HTTPS tunel).
8. **Ladění obtížnosti** podle hraní na zařízení.

Přidej debug panel (zapne se parametrem `?debug`): skok na libovolný level, zobrazení řešení, FPS počítadlo.

## Akceptační kritéria

Hra je hotová, když platí vše níže na reálném iPhonu 14.

- [ ] Nainstalovaná PWA se spustí v režimu letadlo a jde hrát.
- [ ] Pravidla přelévání, uzavírání a výhry odpovídají sekci Pravidla hry; logika má testy.
- [ ] Levely 1–300 jsou řešitelné, deterministické a obtížnost viditelně roste.
- [ ] Lahve různé výšky a skryté barvy fungují podle zadání; Zpět skryté jednotky znovu neskrývá.
- [ ] Přelití má animaci s nakloněnou lahví, proudem a vodorovnou hladinou, plynule při 60 fps.
- [ ] Po zavření a znovuotevření hra pokračuje v rozehraném levelu i s historií tahů.
- [ ] Nic se nepřekrývá s notchem ani domácím indikátorem; nejde zoomovat ani posouvat stránku.
- [ ] Na iPhonu SE 3. gen. se 24 lahví vejde na obrazovku a jde pohodlně trefovat.
