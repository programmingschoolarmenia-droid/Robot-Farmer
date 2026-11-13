# How Bridgy's Farm works inside

For developers and AI assistants. Read this when a task touches how the code fits together. It describes only what the code alone doesn't show quickly. The numbers live in `config/*.json` (their fields are explained in `config/README.md`), and the history and rules are in `CLAUDE.md`. **Update this file in the same commit as any change to what it describes.**

Written 2026-11-12 from the code at commit 1bbc8f0; the crop rules, code order and balance simulator were updated on 2026-11-13.

## 1. The big picture

```
index.html ─▶ js/main.js ─▶ loadConfig (config/*.json + validator)
                         ─▶ LoginScreen (js/ui/account.js) ─▶ GameScreen (js/ui/gameScreen.js)
                                                                 │
             ┌───────────────────────── UI (js/ui/) ─────────────┤ listens to game.events
             │ farmView · editor · panels · bridgy · researchTree │ calls game / runner methods
             │ village · ranch · challenge · market · book        │
             └───────────────────────────────────────────────────┘
                                   │
             Game (js/engine/game.js): the whole state and rules, no DOM
             ├─ World (farm grid, crops)       ├─ Research (tree, grants)
             ├─ Inventory · Stats               ├─ Calendar · Village · Festivals · Notes · Stickers
             ├─ Drone(s) · Runner (scheduler)   ├─ GameApi (commands, enums, Armenian names)
             └─ Ranch (a second "game" with its own areas, runners, inventory, shop)
                                   │
             Interpreter (js/lang/): runs the student's JavaScript step by step
```

- **The engine never touches the DOM.** It changes state and emits events on `game.events` (a small pub/sub in `js/core/events.js`). The UI listens and redraws. Engine tests (`tests/*.test.mjs`) therefore run in plain Node with `makeGame()` from `tests/helpers.mjs`.
- **There's no build step.** The page loads ES modules directly. CodeMirror 5 and Acorn are vendored in `vendor/` as plain scripts.
- **Everything a teacher might change is in `config/`.** It's loaded at boot and checked by `validateConfig` (`js/core/config.js`). One mistake shows a red error screen in Armenian, naming the file and field, instead of a broken game.

## 2. Boot and screens

1. `index.html` loads the CSS, CodeMirror and `js/main.js`. A small inline script picks the loading screen's language (the same rules as `pickLang`) and shows «Սեղմիր F5» / "Press F5" if a module fails to load, or if loading takes over 20 s.
2. `main.js`:
   - picks the language (`pickLang` in `i18n.js`: `?lang=`, this tab's choice, the browser's saved choice, Armenia's time zone → Armenian, the browser's languages, else English)
   - runs `loadConfig('config/', lang)`, which fetches every name in `CONFIG_FILES` with `no-store`, puts the language in (`localize`, §4) and validates the result
   - builds `i18n` (`js/core/i18n.js`, text from `texts.json`) and `SpriteBook` (`js/ui/sprites.js`, all pictures)
   - creates `Accounts` (`js/storage/account.js`)
   - puts everything in an `app` object (`window.bridgysFarm` in the browser console)
3. The **LoginScreen** is always shown first. If a player is still logged in, it offers «Շարունակել որպես X» (for shared school PCs). After login, `account.loadSave()` picks the farm, and a **GameScreen** is built from it.
4. **GameScreen** owns the main `Game`, the rAF loop (`tick`), the autosave timer and every panel. Full-screen worlds take over from it:
   - `openRanch()`: the RanchScreen (`js/ui/ranch.js`) on `game.ranch`
   - `openChallenge()`: the ChallengeScreen (`js/ui/challenge.js`) on a fresh test `Game`

   Each one cancels the farm's rAF and hides the farm. Its `onClose` restarts the farm loop. **Only the open world runs**: a closed world's time doesn't move.
5. **Each loop wraps one frame in `try … catch` → `frameError(app, e)`** (`dom.js`), so one throwing frame can't freeze the game (that was the 2026-10-31 freeze). The error goes to the console once, and the player sees one calm message.

## 3. Student code: from text to drone actions

```
editor text ─▶ parseProgram (frontend-js.js, Acorn) ─▶ AST annotated (_mod, _call)
            ─▶ checkProgram (gate.js): locked syntax / locked functions / unknown names / unsupported JS
            ─▶ lintProgram (gate.js): warnings (f; · if (f) · if (x = 1))
            ─▶ Runner.start ─▶ Interpreter (generators) ─▶ GameApi functions ─▶ World / Inventory / events
```

- **`GameApi.compile(name, code)`** (`js/engine/api.js`) caches the parse and check per script tab. The cache is keyed by the code and a research stamp, so buying a research re-checks. The editor calls `check()` live for its red marks.
- **Gating:** research nodes grant `syntax` features (`SYNTAX_FEATURES` in `gate.js`: loops, if, operators, variables, functions, lists, objects, import) and `functions` (canonical English names). The cards hang in the school's code order (Loops → Variables → Debug → Operators → Plant → Lists → Utilities → Functions → Objects), so `loops` alone gives `while`; a `for` loop also needs `variables`. `Research.rebuildGrants()` builds the unlocked sets, and repaired village buildings add theirs. A locked feature is a compile error, not a runtime one.
- **The interpreter** (`js/lang/interpreter.js`) executes the Acorn AST with generator functions:
  - It yields at statement starts, loop iterations and after actions (`Y.STMT / LOOP / ACTION / WAIT`).
  - Expressions without calls use the faster `evalSync`.
  - Values are plain JS values, plus `Closure`, `BuiltinFunction`, `EnumValue`, `Namespace` and `DroneHandle` (`js/lang/values.js`).
  - Objects are null-prototype, and method tables (`js/lang/stdlib.js`) are whitelists, so `toString` and other prototype names never leak in.
  - Limits: `MAX_STRING` and `MAX_LIST` 100 000, `game.maxCallDepth`.
  - Unsupported JS (`class`, `try`, `this`, …) is refused on purpose by `gate.js → UNSUPPORTED`.
- **Errors** are `GameError(code, params, node)` (`js/lang/errors.js`). The engine never writes text: `js/ui/errorText.js` turns the code into Armenian from `texts.json → errors / warnings`, with "did you mean" suggestions (`suggestNames`), Python habit hints (`PYTHON_HINTS` in `api.js`) and a message for commands the game no longer has (`REMOVED`, e.g. `enker`).
- **Time:** every executed piece of code costs ticks (`settings.costs`):
  - A successful action (`api.act(I, true, kind)`) costs `costs.actionTicks[kind]` (move 150, harvest 200, plant 200, till 300) or else `actionSuccess` (200); a failed one `actionFail` (1).
  - A drone runs `ticksPerSecond × speedPerTier^SpeedLevel` ticks per game second (`Drone.tickRate`).
  - **Runner** (`js/engine/runner.js`) is the scheduler. Each frame `Game.update(realDt)` asks it to advance every running drone up to the target game time, always stepping the drone furthest behind. It stops after `frameBudgetMs` so weak computers keep drawing.
  - Game time moves only as far as the drones got. So the result depends only on game time, never on frame rate or the ×¼/×½/×1 speed buttons. The weekly challenge relies on that.
- **Several drones:** `norDron(fn)` (`spawnDrone`) runs a function on a new drone in the same runner. The ranch uses `erb(event, fn)`: handlers queue on the drone and run when it is free (`Runner.listen` / `queueEvent`), like real JS events.
- **Code words** (the "best coder" list): when a run ends without errors, `Runner.countCode()` → `codeFingerprints` (`js/lang/codeWords.js`) hashes each statement that really ran, with names and numbers normalized. Each fingerprint counts once per student ever, so repeating `tpel();` gives nothing.

## 4. Names: English inside, the player's language outside

- **Inside the code, every command, enum member, item, research id and save key is English and canonical:** `harvest`, `Entities.Carrot`, `Items.Hay`, research `Carrots`. Saves store only these. That's why renaming what players see never touches saves.
- **`config/aliases.json`** maps canonical → `[shownName, ...otherNames]`, in sections `functions`, `constants`, `namespaces`, `members` and `ranch`:
  - The **first** name is the one players see and autocomplete offers (`havaqel`, `Buyser.Badrjan`).
  - The rest keep working as hidden aliases: Armenian letters (`հավաքել`), old spellings (`Gazar`, `Badrijan`) and the English canonical.
  - **When renaming, add the new name first and keep the old one in the list.**
- **`config/texts.json`** has the Armenian display text: `ui.*`, `items`, `entities`, `errors`, `warnings` and so on. `config/guide.json` has the help book (`commands.<canonical>` with sig/doc/example, plus `js`, `plants` and `ranch`). `config/bridgy.json` has lessons (keyed by research id), quests, intro and reactions.
- Enum values carry their shown label (`EnumValue.label`). Printing `Buyser.Badrjan` shows the Armenian name, while comparisons use the canonical one.
- **Languages** (`js/core/i18n.js`, `config/en/`, `config/ru/`, rules for writers in `docs/TRANSLATION.md`). The Armenian files are the source. `loadConfig(base, lang)` always reads `en/aliases.json` and `ru/aliases.json`, and for English/Russian also `<lang>/<file>.json` for each of `TEXT_FILES`; then `localize(config, lang, packs)`:
  - `mergeAliases`: each name list becomes `[...chosen language, ...Armenian, ...the other]`, so the chosen language's first name is shown and every language's names work. The validator then catches a name used for two things.
  - `eachText` walks a config file and gives every text a key (`quests.use_while.hints.2`; a list item by its `id`/`entity`, else its index). Texts are the strings with Armenian letters, and every string of `texts.json`. The pack's text replaces the Armenian; a missing one keeps the Armenian.
  - Code fields without Armenian (`example`, `code`, `sig`, `label`, `syntax`, `popularWords`) are renamed by `codeRenamer` (game names and `Group.Member`, also in comments; not inside quotes).
  - `createI18n(…, lang)`: `{n|one|few|many}` plural forms with `Intl.PluralRules`; `ui.quote` (glowing buttons, research names), `ui.amount` (`costText`), `ui.engineWords` (number suffixes and "Drone #", copied into `WORDS` in `util.js` for the engine).
  - Switching language saves, writes the choice (browser + the account's `ui.prefs.lang`) and reloads (`app.switchLang`); a save whose `prefs.lang` differs switches that tab and enters the farm again (`bridgysFarm.enter` in sessionStorage).
  - `npm run i18n` (`tools/i18n.mjs`): missing / changed (Armenian edited since `--stamp`, fingerprints in `<lang>/_source.json`) / extra keys, `--todo`, `--stamp`, `--check`.

## 5. The farm world

- **`World`** (`js/engine/world.js`) is a grid of tiles: ground (`Grassland/Soil/Pond`), entity, water and lastSync.
  - **Plants grow lazily:** `sync(tile, t)` brings a tile exactly up to game time `t`, including water evaporation and the season and weather rules. Nothing loops over the farm each frame.
  - `Calendar.update` syncs the whole farm before a season or weather change, so no tile's interval mixes two seasons.
- **Crop rules** live in `World.harvest` and its helpers. Each crop has its own rule (`settings.json → entities`):
  - eggplant (Carrot) is planted from `Seeds` and gives 1–3 back; wheat drops a seed now and then (`seedChance`).
  - apricot (Tree) fruits `fruits` times, then is gone; mulberry pays double next to a ripe rosehip (`hasBees`).
  - watermelon (Pumpkin): once grown, `sweeten` counts its seconds in `data.over`; `ripeness` is 0–100, a harvest under `ripeFrom` gives nothing, and it rots `rotSeconds` after 100.
  - yellow melon: `spread` plants vines at exact game times (every `spreadSeconds`), called from `sync` before anything else at that time, so the farm is the same at any frame rate; a harvest takes the `patch` (n² for n).
  - square melon: ripe squares merge into giants (`tryMergePumpkins`, n³).
  - pomegranate (Sunflower): `squeeze` and `world.juiceCombo` (even ones in rising order); grapes (Cactus): `grapeRow` (a sorted run in one row pays n²); `swap` only sideways.
  - tired soil (`soilShare`, tile `s` and `lc`): only after the Fertilizer card; humus (`fertilize`) mends it.
  - also the maze (`maze.js`), mushrooms that hide left or right (`mushroomFound` predicts from the student's last 3 choices) and ponds.

  `Game` handles the snake and its running mouse (`startDino`/`moveDino`/`runMouse`; the internal names are still Dinosaur and Apple), items, hats, boosts, juice (`drinkJuice`, `Drone.juice`) and fishing. `chapel()` (`Game.measure`) reads what each crop's rule is about.
- The **numbers** (growth times, yields, costs) are in `settings.json → entities / items / water / fertilizer / maze / dinosaur / fishing / …`.
- **Randomness** comes from a seeded `Rng` (`js/core/rng.js`), saved as `seed`, so tests and the challenge are reproducible. The ranch areas have their own random numbers.
- **Calendar** (`calendar.js`): seasons, weather and the luck of the day follow the **real clock**, the same for everyone. They are off when `settings.calendar` is missing; tests turn them on with `makeGame({ clock })`.

## 6. Progress systems

| Part | Engine | Config | UI |
|---|---|---|---|
| Research tree | `research.js` (levels, `parentsDone`, `minLevels`, `available: false` = «soon», grants) | `research.json` | `researchTree.js` |
| Quests | `quests.js` (`QuestTracker`; goals like `gain`, `code`, `research`; saves keep the quest's id, the oldest ones a place in `OLD_ORDER`; a removed quest is listed in `MOVED`) | `bridgy.json → quests`, `ranch.json` | `panels.js` quest card, `bridgy.js` |
| Lessons + quizzes | shown on research | `bridgy.json → lessons.<researchId>` | `bridgy.js` |
| Village | `village.js` (buildings repaired item by item, grants, daily ⭐ requests) | `village.json` | `village.js` (map from `assets/village/`) |
| Festivals, notes, stickers, Perfection % | `festivals.js`, `notes.js`, `stickers.js` | `events.json` | `village.js`, profile |
| Weekly challenge | `challenge.js` (task of the ISO week, test farm, score = game time) | `events.json → challenge(s)` | `challenge.js`, `ranchChallenge.js` |
| Stats / points | `stats.js` (totals, per-minute rates, day/month points, streak, code words) | `settings.json → leaderboard.points` | profile, leaderboard |

Inventory (`inventory.js`): `add(item, n, source)` records a gain in Stats unless `source === 'transfer'`. Market trades use `'transfer'`, so traded goods give no points.

## 7. The ranch, a second game inside

- `game.ranch` (`js/engine/ranch.js`) looks like a `Game` to Runner, Drone, Inventory, the API and QuestTracker: it has config, events, rng, time, inventory, stats, scripts, api, warn(). It has **its own** areas, storage with ֏, shop, daily prices, orders, shared board, loom, donkey, fair and New Game Plus.
- Each **area** (`animals.js`, `Pen`) has its own drone, script tab and runner. Its coordinates are pen-local, counted from the bottom-left. Fences stop drones, with no wrap-around.
- Animals advance in whole steps of `STEP` game seconds, with the area's own random numbers, so the same program gives the same ranch at any speed.
- **Commands:** `RanchApi` (`ranchApi.js`) registers ranch commands into the farm's `GameApi` machinery: same compile, gate and interpreter. Their Armenian names are in `aliases.json → ranch`. JS syntax comes from the farm's research; ranch commands are unlocked by buying them in the shop.
- Ranch goods are added to the main game's Stats, so they count as points.
- Drawing: `ranchView.js` reuses `FarmView` and points its tile geometry at one pen at a time (`withPen()`).

## 8. Saving and accounts

**What a save is** (`GameScreen.save()`):
```js
{ v: SAVE_VERSION, rev, game: game.toSave(), quests, ui: { introDone, lessonsSeen, …, prefs }, updated }
```
- `game.toSave()` (`game.js`) holds seed, time, playSeconds, inventory, research levels, world, drone, scripts, stats, village, festivals, notes, stickers, challenge, ranch, boosts and the snake.
- **Old saves must keep working.**
  - `migrateSave` (`account.js`) and `Game.migrate` upgrade old formats (only when the save has a `v`; a new game has none). `v` 1: Speed levels move with `OLD_SPEED_LEVEL`. Before `v` 4: Expand levels move with `OLD_EXPAND_LEVEL`, a 22 or 32 farm keeps its size in `flags.farmSize`, eggplant owners get 10 seeds, and `World.fromSave` turns old giant watermelons into giant square melons and drops the old `infected`/`companion` marks.
  - Any new field must have a default when it is missing.
  - Never rename a saved key or an internal id. Add an alias instead.
- **`rev`** goes up with every market trade (and on a teacher's farm move). Firestore rules refuse a save with a lower `rev`, so an old tab can't bring sold goods back; it gets `stale` and returns to login. `loadSave` prefers the higher `rev`, then the newer `updated`.

**Where it goes** (`js/storage/account.js`, `Accounts` + a backend):
- **Browser copy:** `saveLocal` every `autosaveSeconds` (10) and on every important action. It is always kept, so the game works offline.
- **Online:** `syncCloud` (GameScreen) every `cloudSaveSeconds` (60) when something changed **and** the student did something: a click, a key, or a running program. An idle open tab sends nothing, to save Firebase quota. It sends right away after research or a trade, and when the tab is hidden or closed (`leaveSave`, `keepalive`, without the account `check()`).
- **Backends:**
  - `FirebaseBackend`: REST, no SDK. Auth with the hidden email `name@bridgys-farm.app`, Firestore docs `saves/{id}`, `players/{id}` (the leaderboard row from `playerRow(name, game.leaderStats())`), `deleted/{id}`, `orders/{id}`, carpets/likes. A save and its row are written in one `:commit`.
  - `LocalBackend`: the same interface in `localStorage`, used when `settings.online` has no keys (and in browser tests).
- **Before each load and save, `check()`** asks Auth whether the account still exists and whether `deleted/{id}` is set, because a deleted account's token keeps working for up to an hour.
- **Guests** (`startGuest`, session `{ id: '~guest', guest: true }`; `~` can't be in a username, so the key `save.v2.~guest` never meets a player's farm): one guest farm per browser. `loadSave` reads only the browser copy, `saveOnline` and `GameScreen.syncCloud` send nothing, and the market, prizes, orders, challenge places and the carpet contest check `account.isGuest` (they show `ui.guestOnly`). `keepGuestFarm` registers a name, moves the farm to it (online at the next save) and drops the guest farm. Bridgy reminds a guest once per session (`remindGuest`).
- **Teacher (admin) tools:** `removePlayer` and `moveFarm` (a forgotten password: the farm moves to a new account and the old name is blocked), plus removing market orders and contest carpets. `online.admins` lists the teacher names; Firestore rules must agree (`isAdmin()` in `config/README.md`).
- **A player deletes their own account** (Google Play requires it): Profile → `openDeleteMe` → `GameScreen.deleteAccount` sets `erasing` (so `syncCloud` sends nothing, waits for a save on its way) → `Accounts.deleteMe(password)` signs in again for a fresh token → `backend.erase`: their orders, carpets, likes given and got and the reports they wrote (queried by field, deleted in commits of ≤400), then `remove` (save, row, the Auth login). A failure on the way leaves the account working. No `deleted/{id}`, so the name is free again; teachers can't delete themselves (a student could take the admin name). A keepalive save from *another* open tab within the token's hour could still write the save back; it is rare and the teacher can delete it.
- **Reports and «block»:** `Accounts.report({ kind: 'player' | 'carpet', target, name, week, cells })` writes `reports/{reporter}~{key}` (key = the player id, or `week~id` for a carpet; one per reporter and thing) and returns the key, which goes into `app.prefs.hidden` (saved with the farm). `isHidden(app, …keys)` (`js/ui/account.js`) leaves those players / carpets out of the leaderboards (keeping places), crowns, the rival line, the challenge top lists and winners' code, the contest gallery and the market list. Prizes and places are computed from the unfiltered lists. Teachers read `reports()` (Profile → «Բողոքներ (n)», `openReports`), open the player's card (`player(id)`), remove a reported carpet, `closeReport(id)`.
- **Privacy page:** `privacy.html` (3 languages, one shown by `?lang=`; `#rules`, `#delete`) is the page Google Play links to; the game shows it in an iframe (`openPrivacy` in `settingsModal.js`: ⚙ Settings, the start screen, «Կարդալ կանոնները» on the sign-up tab). `mobile/copy-web.mjs` copies it into the Android app.
- **There is no server, so clients are trusted.** The market re-checks orders on each client (`js/engine/market.js`); cheating with browser tools is a known, accepted risk.

## 9. Drawing and UI rules

- **Background music** (`js/audio.js`): `GameAudio` streams the original 64-bar score *Apricot Afternoon* from `assets/audio/` using one looping media element routed through its existing WebAudio music gain. It selects Ogg/Vorbis when supported and MP3 otherwise, loads only when music is enabled, and pauses while the page is hidden. Returning to the page resumes at the previous position; a tap retries playback when browser autoplay restrictions apply. The existing Music slider and saved preferences control volume. The score, editable MIDI, and composition source are in `music/apricot-afternoon/`; sound effects remain synthesized, while `nvagel()` has its own piano instrument.

- `farmView.js` draws the farm on a canvas each frame (skipped when hidden, or every other frame in low graphics). Sprites come from `SpriteBook`: crops from the CC0 sheet `assets/sprites/crops-josehzz.png`, everything else drawn in code with `Pixels` (`js/ui/pixel.js`, 16×16, the crop pack's palette).
- **Icons:** `icon(app.sprites, name)` (`dom.js`), with names registered in `sprites.js → icons()`. No emojis as pictures.
- DOM is built with `h(tag, props, ...children)` (`dom.js`). A `null` child renders as the text "null", so leave it out instead.
- **Never rebuild a button on a timer:** redraw only on change, write live numbers in place, and wait for `isPressing()` to be false.
- **Phones:** `mobileQuery` in `dom.js` must match the media query in `css/mobile.css`. There, the screen becomes tabs (Farm / Code / Storage), «Հետազոտել» sits in the top bar (`researchTop`; the side panel's button is hidden), and the editor gets the symbol bar (▶, undo, symbols) and the word-suggestion bar (`settings.json → game.popularWords` first, `completions(…, popularFirst)`). Windows get `.modal-body { grid-template-columns: minmax(0, 1fr) }`, or a long line pushes them off screen. Typing rules (composition, `editor.refresh()`, `wordOpen()`) are in `CLAUDE.md`.
- **The Back key** (Android, and the browser's Back): anything that opens on top of the farm registers with `onBack(close)` (`dom.js`) and calls the returned function when it closes by itself. That means windows (`openModal`), Bridgy's dialog, the research tree, the village, the ranch, the loom and the challenge pages. Back closes the top one; with nothing open it leaves the game. The game keeps one history step per open thing and never adds one while its own `history.go()` is on its way (Chrome would land on the wrong step). **A new full-screen view must register too.** In the Android app, `MainActivity` turns the Back key into a WebView `goBack()` while the page has history steps (Capacitor itself has no Back handler).
- **Toasts** (Bridgy's bubbles and the game's `app.toast`) let taps through to the buttons under them (`pointer-events: none`). A tap on one still sends it away: `closeOnTap(el, close)` in `dom.js` checks every press against the open toasts. On phones Bridgy's bubbles wait while a Code tab is open (`Bridgy.coding()`).
- **Bridgy's news** (today's luck, a festival greeting, the season and the weather, a new rank, «you moved up») go through `GameScreen.news(show)`: nothing in the first 2 minutes of a visit (room for the coming tutorial), then one at a time, a minute apart, all by minute 10, then at once. `show()` returns true when it said something, so empty news costs no wait. What the student causes (a harvest, a research, a sticker) is still said right away.
- **Short labels on narrow phones:** `phoneText(t, key)` (`dom.js`) gives a label two forms when `texts.json → ui.short.<key>` exists; under 400 px only the short one shows (`.text-long` / `.text-short` in `css/mobile.css`). Used for the market and loom tabs, the market title, the book's first tab and the running banner.
- **The phone console:** on phones (`mobileQuery`) the console hides until the pixel console button at the top right of the code panel opens it (`EditorPanel.toggleConsole`, `.code-panel.console-open`); a dot on the button means new lines came. Computers keep the console always open. On upright phones the control bar has no status light (it pushed the page sideways on real phones' bigger text).
- **A research card can lock a word list:** an enum named in `grants.functions` (e.g. `Notes` for «Երաժշտություն») is locked like a command until the card is bought (`globalStatus`, `knownNames`; the error is `lockedName`). Enums no card names stay open, as before.
- **`alert(text)`** (research Debug, with `console.log`, which is the `print` command under a `console` namespace in `stdlib.js`): the command prints, emits `alert` and yields. `GameScreen` pauses the runner and opens a Bridgy window («Լավ» and «Կանգնեցնել», so an endless `alert` loop can be left); the program goes on when the last window is closed. Where nobody listens (tests, the challenge page, the ranch) it only prints.
- **`nvagel(note, beats, bpm)`** (`playNote`, research «Երաժշտություն»): accepts the original `Notaner` enums, scientific pitches (`"C#4"`, `"Bb3"`, A0–C8), or a chord list of 1–8 notes. Beats range from 0.125 to 8 (default 1). Optional BPM is 30–300; omitting it preserves `time.noteBeatSeconds`. A chord takes one duration, independent of Speed research. `Notaner.Dadar` remains a silent wait. The `music` event carries frequencies and the exact game-time onset; `GameAudio.note` maps these onto a shared audio clock with a short lookahead. A local ~385 KB sample bank (`assets/audio/nvagel-piano.mp3`, eight six-second C1–C8 slots) loads when Music is available; a synthesized piano handles loading failures. Up to 24 voices use the sound-effects volume and release their audio nodes on completion. Stop, Pause, restart, errors, exit, and hiding the tab silence this instrument without touching the background score. Rendering source and an example song live in `music/nvagel/`.
- **Narrow phones (400 px and less):** Bridgy stands above his box (the text gets the whole width), the control bar's buttons are 40 px tall, and small ✕ / «Մաքրել» buttons get a bigger tap area on touch screens (an `::after` around them, the same look).
- **Bridgy points at buttons:** when his dialog or toast names a button in «…» (its label from `texts.json`), it glows (`.glow`) until he moves on: `Bridgy.point()` → `GameScreen.point()` with the open screen's `glowTargets()` (farm or ranch). A visible button inside the side panel also lights the Storage tab, the way to it on phones.
- All UI text comes from `texts.json` through `app.i18n.t('ui.key', params)`. Don't write Armenian strings in JS.

## 10. Recipes: adding things safely

**A new game command**
1. `this.def('canonicalName', (I, args, node) => { …; api.act(I, ok); })` in `GameApi.buildFunctions` (or `RanchApi`). Use `api.need*` helpers to check arguments.
2. Grant it from a research node in `research.json → grants.functions`, a village building, or the ranch shop.
3. `aliases.json → functions.canonicalName: ["armenianName", "Հայերեն"]`, and the English and Russian names in `en/aliases.json`, `ru/aliases.json` (`npm test` fails without them). The names go in the plan for the teacher's approval first.
4. `guide.json → commands.canonicalName` (sig/doc/example/notes; the example must not be a quest answer).
5. Any new error codes go in `texts.json → errors`.
6. Translate the new texts: `npm run i18n` lists them (the `translator` agent does it).
7. Add a test in `tests/` and run `npm test` and `npm run play`.

**A new plant or item**
1. Add it to `ENTITY_NAMES` / `ITEM_NAMES` (`api.js`), so the validator and enums know it.
2. Add its numbers in `settings.json → entities / items`, and its leaderboard weight in `leaderboard.points`.
3. Add its sprite in `sprites.js`, its name in `texts.json → entities/items`, its aliases, and the help book `guide.json → plants`.

**A new config field or file**
- Add a check in `validateConfig` (and to `CONFIG_FILES` plus `tests/helpers.mjs → loadConfig` for a new file), and document it in `config/README.md`.

**A save change**
- Keep old saves loading: add defaults, and migrate in the `Game` constructor or `migrateSave`. Never drop data.

**A Firestore change**
- Update the rules text in `config/README.md`, the fake in `tests/fakeFirebase.mjs`, and tell the teacher to publish the rules by hand.

## 11. Tests

- `npm test`: Node's test runner on `tests/*.test.mjs` (engine, interpreter, gate, accounts with `fakeFirebase.mjs`, calendar, village, events, ranch, market, stats…). `tests/helpers.mjs → makeGame(opts)` builds a game from the real config.
- `tests/i18n.test.mjs`: the first-visit language, plural forms, every language's names, the code renamer, and for English/Russian: nothing missing, same placeholders, no Armenian letters, the right language's command names.
- `npm run play` (`tests/play.mjs`) is a headless-Chrome play-through in every language (`LANGS=ru` for one) at 1366×768, 390×844, 320×640 and 844×390 (it also reports text cut off in a button and Armenian left in English/Russian):
  - local accounts, with Firebase blocked
  - runs a program, then checks for console errors, the loop still running, sideways scrolling and the phone Code tab
  - `SHOTS=<folder>` saves screenshots
- `npm run balance` (`tests/balance.mjs`) is the balance simulator, not a test: it measures what simple student programs gather per second on the real engine (once per season, whole cycles for programs that end), buys the tree in the order a student could afford it, and writes `test-reports/balance-<label>.md/json` (minutes to every card, walls, when the Ranch, Market and village buildings come in reach). `tests/balance-baseline.json` is the tree as it was before the crop rules changed; `--suggest` proposes prices for an even curve (first eggplant card at 45 min, the whole tree 1.5× the baseline). `makeGame({ config })` takes another config for it.
- `tests/browser.mjs` is the shared way to open the game in headless Chrome (`startServer`, `launchChrome`, `openPage`), used by `play.mjs` and the tester agent (`.claude/agents/tester.md`, checklists in `tests/tester/`). Its `firebase` option is `'blocked'` (the default: local accounts), `'fake'` (`fakeFirebase.mjs`) or `'live'` (the real site, test accounts only).
- GitHub Actions (`.github/workflows/test.yml`) runs both on every push.
