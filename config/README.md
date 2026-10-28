# Bridgy's Farm — settings files (for teachers)

Everything you may want to change lives in this folder. Edit the files with any text
editor, save, and **reload the page**. If something is wrong (a missing comma, an unknown
name…), the game shows a red error screen that names the **file, the field and the
problem**; nothing breaks silently.

> JSON rules: text in `"double quotes"`, a comma between items but **not** after the last
> one, no comments. Keys that start with `_` (like `_readme`) are notes and are ignored.

| File | What it controls |
|---|---|
| `settings.json` | Game rules and numbers: speed, farm sizes, plants, yields, costs, water, power… and the online accounts (`online`) |
| `research.json` | The research tree: cards, prices per level, what each card unlocks |
| `texts.json` | Every Armenian text of the interface and the error messages |
| `bridgy.json` | Bridgy's words: intro, lessons (with quizzes), quests (with 3 hints each), reactions, credits |
| `aliases.json` | The Armenian names of the game commands students write (`havaqel()`, `tnkel()`, `gnal(Aj)`…) |
| `guide.json` | Bridgy's book («Բրիջի, օգնի՛ր»): every game command, the JavaScript topics and the plants |

---

## settings.json

### `game`
| Field | Meaning | Default |
|---|---|---|
| `startItems` | Items a new player starts with, e.g. `{ "Hay": 100 }` | `{}` |
| `maxCallDepth` | How deep functions may call themselves before Bridgy says "too much recursion" | `400` |
| `autosaveSeconds` | Autosave interval | `10` |
| `speedOptions` | Speed buttons in the bottom bar. `[0.25, 0.5, 1]` lets students slow down; add `2, 5, 10` for a fast teacher demo | `[0.25, 0.5, 1]` |
| `defaultSpeed` | Speed when the game opens | `1` |
| `frameBudgetMs` | Max milliseconds per frame spent running code (lower = smoother on weak PCs) | `12` |

### `time`
| Field | Meaning |
|---|---|
| `ticksPerSecond` | How many "ticks" the drone does per game second (400 = an action of 200 ticks takes 0.5 s) |
| `speedResearch` | Research id that makes the drone faster (`"Speed"`) |
| `speedPerTier` | Speed multiplier per level of that research (`1.5`) |
| `doAFlipSeconds` | How long `salto()` takes |

### `costs`
`actionSuccess` (200) — ticks for a successful drone action (move, harvest, plant, till…);
`actionFail` (1) — ticks when an action fails; `getter` (1) — ticks for questions like
`hasunE()`. `language` — ticks for JS operations (`loop`, `if`, `binary`, `index`,
`define`, `callValue`, `collection`, `template`, `method`).

### `world`
`sizeResearch` — research that grows the farm (`"Expand"`). `sizes` — farm size for each
level of it: `[[1,1], [3,1], [3,3], …]` (level 0 = first item).

### `entities` (plants)
Each plant has:
| Field | Meaning | Example |
|---|---|---|
| `grounds` | Where it can be planted | `["Soil"]` or `["Grassland", "Soil"]` |
| `growTime` | Random grow time between min and max seconds | `[4.8, 7.2]` |
| `yield` | What one harvest gives | `{ "Carrot": 1 }` |
| `yieldResearch` | Research whose levels multiply the yield | `"Carrots"` |
| `yieldBaseLevel` | Level at which the multiplier is ×1 | `1` |
| `yieldFactor` | Multiplier per extra level (default 2) | `2` |
| `plantCost` | Items paid to plant it | `{ "Hay": 1, "Wood": 1 }` |
| `plantCostScales` | If `true`, the cost grows together with the yield | `true` |
| `neighborSlowdown` | (Tree) growth time × this for each neighbouring tree | `2` |
| `deathChance` | (Pumpkin) chance to rot when ripe | `0.2` |
| `giant` | (Pumpkin) giant yield: n³ up to `cubeUntil`, then n²×`bigMultiplier` | |
| `petals`, `minForBonus`, `bonusMultiplier` | (Sunflower) petals range and the big-sunflower bonus | |
| `sizes` | (Cactus) size range | `[0, 9]` |

### `water`, `fertilizer`, `power`, `megafarm`, `maze`, `dinosaur`, `polyculture`, `fishing`
| Section | Fields |
|---|---|
| `water` | `research`, `secondsPerItem` (one tank every N s, halves per level), `tankAmount` (0.25), `evaporationPerSecond`, `maxGrowthMultiplier` (5) |
| `fertilizer` | `research`, `secondsPerItem`, `secondsSaved` (growth per use), `infectedYieldToWeird` (share of yield given as weird substance) |
| `power` | `speedMultiplier` (2), `actionsPerPower` (one power used per N actions) |
| `megafarm` | `research`, `dronesPerLevel` (`[1, 2, 4, 8, 16, 32]`) |
| `maze` | `research`, `maxReuses` (how many times the treasure can be moved) |
| `dinosaur` | `research`, `appleCost`, `moveTicks`, `speedupPerApple` |
| `polyculture` | `research`, `entities`, `distance`, `baseMultiplier` |
| `fishing` | `research`, `castSeconds` (one cast at the base speed; speed upgrades make it faster), `fish` (`Carp`, `Barbel`, `Trout`, `Golden_Fish`, each `{ "chance": 70, "amount": 1 }`: chance weight and how many fish it gives, doubled by every research level after the first), `hat` (unlocked by the first golden fish) |

**Fishing:** `porel()` digs a pond under the drone (plants can't grow there; `herkel()` fills it
in again). `ogtagorcel(Irer.Jur)` fills it with water (a pond does not dry out); when
`jriQanak()` is 1 the pond is full and `dzknorsel()` catches a random fish: Karas, Kogak, Ishkhan
or the golden fish. The fish (`Irer.Dzuk`) go to the storage, count for the leaderboard and pay
for the next fishing levels.

### `hats`
Hat colours: `{ "Red_Hat": { "color": "#ef4444", "band": "#7f1d1d" } }`. To add a hat, add it
here, give it a name in `texts.json → hats`, and unlock it from a research card
(`grants.hats`).

### `online` (accounts, online saves and the leaderboard)
| Field | Meaning | Default |
|---|---|---|
| `apiKey`, `projectId` | Your Firebase project's keys (see **Accounts and the leaderboard** below). Empty = accounts and the leaderboard live only in this browser | `""` |
| `emailDomain` | Hidden e-mail domain for usernames (`aram` → `aram@bridgys-farm.app`). If you change it, change it in the Firestore rules too | `bridgys-farm.app` |
| `cloudSaveSeconds` | How often a changed farm is saved online (it is also saved right after a research, when the page is hidden or closed, and on log out) | `60` |
| `leaderboardSize` | How many players each leaderboard list shows (a player outside it still sees their own row and place) | `50` |

### `leaderboard` (points, tiers)
| Field | Meaning | Default |
|---|---|---|
| `points` | Points for each gathered item, e.g. `{ "Hay": 1, "Gold": 20 }`. A student's **score** is everything they ever gathered (what they have + what they spent) × these weights. Water and fertilizer are `0` because they come by themselves. Changing a weight also changes old points (all-time points are recomputed) | see the file |
| `tiers` | Rank tiers by all-time points, in growing order: `{ "name": "Հասկ", "icon": "🌾", "points": 1000 }`. Reaching a new tier gives confetti and a word from Bridgy. (Avoid 🥇🥈🥉 here: they already mark the first three places.) | 🌱 0 … 🌟 100 000 000 |
| `timeZone` | The day and month lists restart at midnight in this time zone | `Asia/Yerevan` |

The leaderboard has four tabs: **Այսօր** (points gathered today), **Այս ամիս** (this month),
**Բոլոր ժամանակները** (all-time points) and **💻 Լավագույն կոդ** (code words). Next to each name:
the drone hat, the tier icon, 🔥 days played in a row, 👑 yesterday's champion and 🏆 last
month's champion. Clicking a name opens the player's card. In the Profile, students also see
where their points come from, how far the next tier is, and «🎯 Հաջորդը…», the player just
above them.

**Code words** (the 💻 tab) count working code a student wrote: only code that ran without an
error, and only statements that really ran. Each piece of code counts **once per student,
ever**: repeating it (`tpel(); tpel(); tpel();`), changing its numbers or texts, or renaming
variables gives nothing new, and long repeated chains (`1 + 1 + 1 + …`, `[1, 2, 3, …]`) count as
one step. Words are names, keywords, values and operators (brackets and `;` do not count). After
each run the console shows the new words, e.g. «💻 +7 նոր կոդի բառ».

### `display` (defaults for new players; each student can change them in ⚙)
`animations`, `lowGraphics`, `fontSize` (`small` / `normal` / `large`), `sfxVolume`,
`musicVolume`, `blips`, `showGrid`.

### `dev` (teacher testing)
`"unlockAll": true` — every research card is bought (great for preparing a lesson).
`"extraItems": { "Wood": 5000 }` — items added to **new** players.
Remember to switch these back before class!

---

## research.json
Each card in `nodes`:
```json
{
  "id": "Carrots",               // internal name (Latin letters); in code students write its
                                 //   Armenian name from aliases.json: Hetazotutyunner.Gazar
  "icon": "carrot",              // picture  (or "label": "while" to show code text)
  "name": "Գազար",               // Armenian name
  "description": "…",            // Armenian description
  "parents": ["Plant"],          // cards that must be bought first (draws the tree)
  "tiers": [{ "Wood": 50 }, { "Wood": 250 }],   // price of each level
  "grants": {                    // what level 1 unlocks
    "functions": ["till"],       // game functions (internal name; students see herkel())
    "syntax": ["loops"],         // JS features: loops, if, operators, variables,
                                 //   functions, lists, objects, import
    "entities": ["Carrot"],      // plants
    "hats": ["Red_Hat"],         // hats
    "panels": ["debugger"]       // the Variables window
  },
  "available": false,            // optional: shows the card as "Coming soon"
  "secret": true                 // optional: shows "?" until it can be bought
}
```
Icons available: `hat, goldhat, speed, grass, expand, carrot, water, tree, fertilizer,
sunflower, maze, drones, pumpkin, cactus, polyculture, dinosaur, secret, debugger, trophy, fishing`.
A function that is not listed in any card is available from the start (e.g. `harvest` = `havaqel()`).
A `label` with code (`tnkel()`, `while`…) should use the Armenian command names.

## bridgy.json
* `starterCode` — what a new player's editor contains (only comments: students write the
  first command themselves).
* `intro` — pages shown to a new player. A page: `{ "emotion": "happy", "text": "…", "code": "…" }`.
  `emotion` is `happy`, `thinking`, `worried` or `celebrating`. `code` shows a code box —
  a small **example, never the answer to a quest** (students must write their code themselves).
* `lessons` — pages shown when a research card is bought, keyed by card id. A page can end
  with a quiz:
  ```json
  { "emotion": "thinking", "text": "Ի՞նչ կանի այս կոդը։", "code": "while (true) {\n  salto();\n}",
    "quiz": { "answers": ["…", "…", "…"], "correct": 1, "right": "Ճիշտ է…", "wrong": "Ոչ այնքան…" } }
  ```
  `correct` counts from 0. A wrong answer shows `wrong` and the student tries again; the
  "Next" button appears after the right answer.
* `quests` — the quest chain, in order. Each quest:
  `id`, `title`, `text`, `goals`, `hints` (3 hints: a nudge, which commands to use, then the
  steps **in words** — no code; a line break starts a new line), `done` (Bridgy's line when finished).
  Goal types:

  | type | fields | done when… |
  |---|---|---|
  | `gain` | `item`, `amount` | the player **collects** that many since the quest started |
  | `have` | `item`, `amount` | the player **has** that many |
  | `research` | `id`, `level` (opt.) | the research card has that level |
  | `harvest` | `entity`, `amount` | that many plants were harvested |
  | `plant` | `entity`, `amount` | that many were planted |
  | `use` | `item`, `amount` | `useItem()` used that many times |
  | `code` | `feature` or `fn` | the player runs code that uses e.g. `"loops"` or `"move"` |
  | `visitAll` | — | the drone visits every tile in one run |
  | `giant` | `size` | a giant pumpkin of that size is harvested |
  | `chain` | `size` | that many sorted cacti are harvested at once |
  | `pond` | — | a full pond is on the farm |
  | `fish` | `fish`, `amount` | that many fish of a kind (`Carp`, `Barbel`, `Trout`, `Golden_Fish`) are caught |

  The game remembers each player's current quest by its `id`, so quests can be added anywhere in
  the chain without moving anybody.
* `reactions` — random short lines (`questDone`, `errorIntro`, `research`, …).
* `credits` — pages shown after the final research.
* `portraits` — Bridgy images per emotion (replace with your own pictures if you like).
* `friends` — Bridgy's two student friends: **Nshan** answers «Ի՞նչ անեմ հիմա», **Erik** gives the hints from «Հուշում տուր» (both only in the «Բրիջի, օգնի՛ր» menu). Each has a `name`, a `portrait` (in `assets/friends/`) and short `lines`, one of which is said first. Remove a friend and Bridgy speaks again.

## aliases.json
The Armenian names of the game commands. Left = the internal (English) name, right = a list
of Armenian names. **The first name is the one shown everywhere** (lessons, hints, the book,
autocomplete, error messages); the other names also work. The English name always works too
(old code keeps running) but is never shown.
```json
"functions":  { "harvest": ["havaqel", "հավաքել"] },
"constants":  { "East": ["Aj", "Աջ", "Arevelq", "Արևելք"] },
"namespaces": { "Entities": ["Bujser", "Բույսեր"] },
"members":    { "Entities": { "Carrot": ["Gazar", "Գազար"] } }
```
If you rename a command here, also update the texts that mention it (`bridgy.json`,
`guide.json`, `texts.json`). JavaScript itself (`while`, `if`, `let`, `Math.floor`…) is not
renamed — it is the real language the students learn.

## guide.json (Bridgy's book)
Opened from «Բրիջի, օգնի՛ր» → 📖 Խաղի հրամաններ / 🟨 JavaScript / 🌱 Բույսեր. Students see
**only what they have unlocked**, plus a line saying how many parts are still locked.
* `commands` — keyed by the internal name: `{ "sig": "tnkel(բույս)", "doc": "…", "example": "…", "notes": "…" }`.
  `sig` must start with the Armenian name from `aliases.json`. The `doc` is also shown in
  the editor's autocomplete.
* `js` — JavaScript topics, in order: `{ "id", "title", "needs": ["loops"], "about", "syntax", "example", "mistakes": [] }`.
  `needs` lists what must be unlocked: `loops`, `if`, `operators`, `variables`,
  `functions`, `lists`, `objects`, `import`, or a function name such as `"Math"`.
* `plants` — plant cards: `{ "entity": "Carrot", "icon": "carrot3", "about": "…", "tips": "…" }`
  (the numbers — where it grows, cost, growth time, harvest — are read live from
  `settings.json`), or a card for a research: `{ "research": "Watering", "title": "Ջուր", "icon": "item:Water", … }`.

## Accounts and the leaderboard (Firebase, free)
Students register with a **username and a password** only (no e-mail, no verification).
Their farm is saved in their account, so they can play at school and continue on a phone at
home, and the leaderboard ranks everybody by points and code words (see `leaderboard` above).

Until you add Firebase keys, accounts and the leaderboard work **only inside one browser**
(the login screen says so). To put them online (~10 minutes, once):

1. Open <https://console.firebase.google.com>, sign in with your Google account and create a
   project (any name, e.g. `bridgys-farm`; Google Analytics is not needed).
2. **Authentication** (in the newer console under *Security*, in the older one under *Build*)
   **→ Get started → Sign-in method → Email/Password → Enable** (only the first switch) → Save.
3. **Firestore Database** (under *Databases & Storage*, or *Build*) **→ Create database** →
   pick a location (e.g. `europe-west`) → *production mode* → Create. Open the **Rules** tab,
   replace everything with the rules below and press **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isOwner(name) {
         return request.auth != null && request.auth.token.email == name + '@bridgys-farm.app';
       }
       match /players/{name} {
         allow read: if true;
         allow write: if isOwner(name);
       }
       match /saves/{name} {
         allow read, write: if isOwner(name);
       }
     }
   }
   ```
4. **Project settings** (⚙ next to *Project Overview*) → **Your apps** → the web icon
   `</>` → register an app (any nickname, no hosting) → copy `apiKey` and `projectId` from
   the code shown into `config/settings.json → online`. (The API key is not a secret; the
   rules above protect the data: everyone can read the leaderboard, but each student can
   change only their own farm.)
5. Reload the game.

**A student forgot the password:** Firebase → Authentication → Users → find
`username@bridgys-farm.app` → ⋮ → *Delete account*. The student registers again with the
**same username** and a new password, and gets the same farm back (it is stored under the
username). To remove a student completely, also delete `saves/username` and
`players/username` in Firestore.

The free plan (50 000 reads and 20 000 writes per day) is plenty for a school. The leaderboard
needs no extra setup: every list is one query, a list is reused for a minute when students
switch tabs, and «you moved up» costs one small count per online save.

## texts.json
All interface text. Words in `{curly}` braces are filled in by the game — keep them.
