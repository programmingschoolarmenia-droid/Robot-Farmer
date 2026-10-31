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
| `village.json` | The village across the river: buildings and what they cost and unlock, Bridgy's story, the villagers' daily requests, the kitchen machines and recipes, the dishes' boosts, the greenhouse glass |
| `events.json` | Festivals on their real dates, the weekly challenge, the secret notes, the stickers and Perfection % |
| `ranch.json` | Bridgy's ranch: its map and areas, the animals and their needs, prices, the farm's cart, the villagers' orders, the shop, Bridgy's ranch story, lessons and quests |

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
| `seasons` | The plant's favourite seasons (`Spring`, `Summer`, `Autumn`, `Winter`): it grows `calendar.inSeason` times faster in them and `calendar.outOfSeason` times as fast in the others. No `seasons` = the same speed all year | `["Spring", "Autumn"]` |

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
| `fishing` | `research`, `castSeconds` (one cast at the base speed; speed upgrades make it faster), `fish` (`Carp`, `Barbel`, `Trout`, `Golden_Fish`, `Whitefish`, `Catfish`, each `{ "chance": 70, "amount": 1 }`: chance weight and how many fish it gives, doubled by every research level after the first; optional `"seasons": ["Winter"]` / `"weather": ["Rain", "Storm"]` = the fish bites only then), `hat` (unlocked by the first golden fish) |

**Fishing:** `porel()` digs a pond under the drone (plants can't grow there; `herkel()` fills it
in again). `ogtagorcel(Irer.Jur)` fills it with water (a pond does not dry out); when
`jriQanak()` is 1 the pond is full and `dzknorsel()` catches a random fish: Karas, Kogak, Ishkhan
or the golden fish, in winter also Sig (whitefish) and in the rain Loqo (catfish). The fish
(`Irer.Dzuk`) go to the storage, count for the leaderboard and pay for the next fishing levels.

### `calendar` (seasons, weather, luck of the day)
Seasons, weather and the luck of the day follow the **real clock**, so every student has the
same season, weather and luck at the same moment (the whole class sees the snow together, and the
Today list stays fair). Delete the whole section to turn seasons off.

| Field | Meaning | Default |
|---|---|---|
| `seasonMinutes` | Length of one season. With 15 every hour is a year: spring from :00, summer from :15, autumn from :30, winter from :45 | `15` |
| `weatherMinutes` | How often the weather changes | `5` |
| `inSeason`, `outOfSeason` | Growth speed of a plant in its favourite seasons (`entities.X.seasons`) and in the others | `2`, `0.5` |
| `weather` | Weather weights for each season, e.g. `"Winter": { "Sunny": 4, "Snow": 6 }`. Weathers: `Sunny` (☀️), `Rain` (🌧️ every square and pond is full of water), `Storm` (⛈️ rain + lightning), `Heat` (🔥 water dries faster), `Snow` (🌨️) | see the file |
| `heatEvaporation` | Water dries this many times faster in the heat | `3` |
| `lightningSeconds`, `lightningMultiplier` | In a storm, lightning strikes a random square every N seconds of game time; a plant there gets ⚡ and its harvest is × this | `15`, `3` |
| `luck` | Luck of the day: one per day (the date in `leaderboard.timeZone`), each once in every run of N days, never the same two days in a row. Each: `text` and any of `yield` (`{ "Carrot": 2 }`: everything gathered of that item, i.e. harvests, fish, maze gold or bones, × a whole number), `fish` (`{ "Golden_Fish": 3 }`: catch chance ×), `growth` (all plants grow × this), `pumpkinDeath` (`0` = pumpkins don't rot) | 12 lucks |

In winter the water on the ground is ice: watering still works, but it doesn't speed plants up
(ponds still have fish). Students see the season and the weather on the **📺** button above the
farm; it opens Bridgy's TV with today's luck, what grows fast now and when the next season and
weather come. Bridgy also says a word at every new season. In code (research «Օրացույց»):
`sezon()` → `Sezonner.Garun / Amar / Ashun / Dzmer`, `exanak()` and `hajordExanak()` (the next
weather) → `Exanakner.Arev / Andzrev / Amprop / Shog / Dzyun`. If you change `seasonMinutes`,
also change «15 րոպե» in the Calendar lesson (`bridgy.json → lessons.Calendar`).

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

The leaderboard has two dropdowns. **What:** ⭐ points, 💻 code words, 🎓 this week's challenge
(the fastest time first), 🌟 Perfection, 🐄 ֏ earned on the ranch (sales and orders), and the
running festival (objects found) while one is on. **When** (for points and the ranch):
**Այսօր** (today), **Այս ամիս** (this month) or **Բոլոր ժամանակները** (all time). The ranch's
goods count for points like farm items (`points.Egg`, `points.Milk`: one ranch good is worth
about 10 000 farm items, as the farm's cart counts them). Next to each name: the drone hat, the tier icon, 🔥 days played in a row, 👑
yesterday's champion, 🏆 last month's champion and 🎓 last week's challenge winner. Clicking a
name opens the player's card. In the Profile, students also see where their points come from, how
far the next tier is, their Perfection and sticker album, and «🎯 Հաջորդը…», the player just above
them. The challenge's 🏅 medals count for points like items (`points.Medal`).

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
  "secret": true,                // optional: shows "?" until it can be bought
  "minLevels": 70                // optional: also needs this many research levels in all
}
```
`"panels": ["ranch"]` (on the «Ranch» card) shows the 🐄 ranch button.
Icons available: `hat, goldhat, speed, grass, expand, carrot, water, tree, fertilizer,
sunflower, maze, drones, pumpkin, cactus, polyculture, dinosaur, secret, debugger, trophy, fishing,
calendar, ranch`.
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
The `ranch` section has the ranch's own names in the same format (`datarkel()`, `kendaniner()`,
`Tesakner.Hav`, `Sarqer.Keraman`…); the farm's names (`gnal`, `tpel`, `havaqel`…) work there too.

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
* `ranch` — the ranch's commands, like `commands`; on the ranch the book shows these (a command
  that means something else there, like `havaqel()` = pick up an egg, has its own text here).

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
         return request.auth != null && request.auth.token.email == name + '@bridgys-farm.app'
           && !exists(/databases/$(database)/documents/deleted/$(name));
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

**Delete a student:** Authentication → Users → ⋮ → *Delete account* (or *Disable account*),
then delete `players/username` and `saves/username` in Firestore. Before every load and save
the game asks Firebase whether the account still exists, so an open game stops saving at its
next save (within `cloudSaveSeconds`), goes back to the login screen with «Այս հաշիվը ջնջված է»
and forgets the farm in that browser. Nothing comes back.
(Optional, to block a username for good: add a document `deleted/username` in Firestore; the
rules above then refuse its saves even if the name is registered again.)

The free plan (50 000 reads and 20 000 writes per day) is plenty for a school. The leaderboard
needs no extra setup: every list is one query, a list is reused for a minute when students
switch tabs, and «you moved up» costs one small count per online save.

## village.json (the village)
The «🏘 Գյուղ» button appears after the research in `research` (default `Plant`). It opens a map
of the village across the river. Every building starts as a ruin; students bring the items it
needs **little by little** («Տալ» gives what they have), and when everything is there it is
repaired, Bridgy tells a chapter of the story and it unlocks new things.

| Field | Meaning |
|---|---|
| `buildings` | `id`, `name`, `icon` (the picture `assets/village/<icon>.png` and its ruin `assets/village/<icon>-ruin.png`: `bridge, mill, jamhouse, bakery, greenhouse, school, square`; a new building needs both pictures), `x`/`y` (the picture's centre on the map, % from the left/top), `w` (its width, % of the map; default 17), `after` (buildings that must be repaired first), `description`, `cost` (`{ "Wood": 300, "Star": 3 }`), `grants` (like research: `functions`, `machines`, `hats`), `story` (Bridgy's pages after the repair, like lessons: `text`, `code`, `quiz`), `available: false` (shows «Շուտով») |
| `intro`, `finale` | Bridgy's pages the first time the village opens, and when every building is repaired |
| `requests` | The requests board, opened by `building`: every day `perDay` villagers ask for items the student has already gathered, at least the number in `items` or `share` (2%) of everything they ever gathered of it. Each done request gives `stars` ⭐, all of them `bonus` ⭐ more. `villagers`: `name`, `face` (an emoji) or `portrait` (a picture), `lines` with `{amount}` and `{item}`. `x`/`y`/`w`: the board (`assets/village/board.png`) on the map |
| `machines` | `Mill`, `JamPot`, `Tonir`: `cost` to build one on the farm, `recipes` (`"Flour": { "in": { "Hay": 20 }, "seconds": 5 }`) |
| `boosts` | Dishes that can be eaten: `kind` (`speed` = the drone, `growth` = the plants, `goldenFish`), `multiplier`, `seconds` (game time; eating again adds more) |
| `greenhouse` | `cost` of one glass square |

In code (unlocked by the buildings): `karucel(Sarqer.Jraxac / Katsa / Tonir)` builds a machine on
the drone's square, `patrastel(Irer.Aljur)` starts a recipe (the ingredients come from the
storage), `hasunE()` says when it is ready and `havaqel()` takes it (an unfinished machine is
never destroyed, `herkel()` removes it), `utel(Irer.Gata)` eats a dish, and `apakepatel()` puts
a glass roof on the square: under glass it is always the plant's favourite season, and rain,
heat, ice and lightning stay outside. The new items (flour, jam, lavash, gata, ghapama, grilled
fish, ⭐ stars) count for the leaderboard like the others (`settings.json → leaderboard.points`).

## events.json (festivals, the weekly challenge, notes, stickers, Perfection)
**Festivals** come on their real dates (Yerevan time) for everyone. On a festival day its bonus
replaces the luck of the day, the farm's fence gets flags and the 📺 shows it. With the
**🎪 Festival square** repaired, objects hide in the farm: `hototel()` tells how many steps away
the nearest one is (left/right + up/down), `porel()` on its square takes it, and `porel()` on a
wrong square makes the nearest one run away. 60 objects give the festival's hat; the 3 players
who found the most get its gold hat after the festival (on their next login). A missed hat comes
back next year.

| Field | Meaning |
|---|---|
| `today` | A festival's `id` (e.g. `"Vardavar"`) runs that festival for everyone today, until you set it back to `""` |
| `festival` | `building` (opens the hidden objects), `count` (objects for the hat, `60`), `hidden` (how many hide at once, `3`) |
| `festivals` | `id`, `name`, `icon`, the days: `from`/`to` (`"MM-DD"`, may go into the next year) or `easter: [-1, 1]` (days around Easter, computed for each year; Vardavar is `[97, 99]`), `luck` (like `calendar` luck, plus `freeWater: true`), `hat` and `goldHat` (in `settings.json → hats`), `colors` (the flags), `object` (`firewood, egg, drop, basket, book, flower, gift`) and `objectName`, `greeting` (Bridgy's words), `splash` (Vardavar: chance that watering hides a new drop), `snow: true` |

**The weekly challenge** opens with the **🏫 School**. Every Monday the next task of `challenges`
starts, the same for everyone. Students open it from the School's panel («🎓 Սկսել մրցույթը»): a
clear page with a test farm, an empty editor (their code is kept for the week), a console and
the storage; the main farm waits meanwhile. Every ▶ starts the same fresh farm (the task's size,
research, items and seed; no seasons, luck or dishes), and the time is the game time when the goal
was reached, so speeds up to ×8 only show it faster. The best time counts (unlimited tries), the
first solution gives ⭐, and the School shows the top 10, the student's place and last week's
winner's code. Last week's 1st, 2nd and 3rd get a challenge hat and 🏅 medals on their next login.

| Field | Meaning |
|---|---|
| `challenge` | `building`, `limit` (game seconds per try, `600`), `speeds`, `stars` (first solution), `hats` and `medals` (for places 1–3), `levels` (research every test farm has; a task's `levels` add to it) |
| `challenges` | `id`, `name`, `about`, `goal` (one of: `items: { "Hay": 500 }` gathered, `harvest: { "Trout": 1 }` harvested or caught, also `Treasure`, `giant: 4` pumpkin size, `chain: 16` cacti in one harvest, `dino: 12` dinosaur length), `levels` (`Expand` sets the farm size), `items` (the storage at the start), `seed` (the farm's luck: the same for everyone) |

**Secret notes:** after a request a villager sometimes gives the next note (one at a time). Each
is a riddle whose answer is a square; `gtnel()` there digs out the treasure (⭐), `gtnel()` on a
wrong square loses it (the note can come again later). Erik gives hints in «Բրիջի, օգնի՛ր», the
notes are in Bridgy's book («Գրառումներ»), and solving all of them gives the treasure hunter's hat.
`notes`: `chance` (per request, `0.25`), `stars`, `hat`, `list` (`id`, `kind`: `math`, `code`,
`cipher` or `fact`, `text`, `hint`, the answer `x`/`y`, or `fact`: `sunflower`, `cactus`, `giant`,
`ponds`, `gold` with `dx`/`dy` from it and `needs`: the research the fact needs). A note waits
until the farm is big enough for its square.

**Stickers** (`stickers`) are only for the album in the Profile: `id`, `group` (`code`, `farm`,
`village`, `ranch`, `secret`), `icon`, `name`, `about`, `secret: true` (shown «?» until earned) and `when`,
one condition: `feature` (`loops`, `if`, `variables`, `functions`, `lists`, `objects`, `import`),
`params`, `recursion`, `drones`, `codeWords`, `giant`, `chain`, `sunflowerBonus`, `dino`,
`fishAll`, `fish`, `goldenFish`, `total` (`{ "Hay": 1000000 }`, also ranch goods: `{ "Egg": 500 }`),
`researchAll`, `village` (`"all"`), `requests`, `notes`, `festivalHats` (a number or `"all"`),
`challengeTop`, `perfection`, `flips`, `hats`, `eaten`, `ranchEarned` (֏ earned on the ranch),
`ranchOrders` (villagers' orders delivered).

**Perfection** (`perfection`): how much of the game is done, shown as «🌟 37%» next to the
player's name, in the Profile (with what is missing), on the player card and in the leaderboard.
`research`, `village` and `ranch` are the weights of the research levels, the repaired buildings
and what was bought to keep in the ranch's shop (areas, bigger pens, upgrades and commands, level
by level; animals and troughs don't count). «Soon» things don't count; `hat` comes at 100%.

## ranch.json (Bridgy's ranch)
The ranch opens with the research named in `research` («Ռանչո», after 70 research levels). It is a
second world on its own screen: only the open world runs, so the farm waits while the ranch is open
and the ranch waits while the farm is. Its areas lie on one map, each with **its own drone and its
own code tab** (pen coordinates start at (0, 0) in the area's bottom-left corner; the fences stop
the drones). Animals get hungry, thirsty and dirty, walk to a trough that has what they need,
and give their goods only while they are happy enough: a sad, starving or very thirsty animal gives
nothing (nothing ever dies). Drones carry a few things in their hands: eggs (`havaqel()`), milk
(`kitel()`), feed from the basket and water from the well (`vercnel()`), poured into troughs
(`lcnel()`) and unloaded into the storage at the basket (`datarkel()`). ֏ is earned by the market's
drone (`vacharel()`, villagers' orders) and spent in the 🛒 shop.

| Field | Meaning |
|---|---|
| `research` | The research that opens the ranch |
| `map` | `layout`: the areas in rows, the first row on top; on the map they are equal squares divided by fences, and a bigger pen gets more (smaller) tiles in the same square |
| `start` | `areas` (open from the start), `animals` (`{ "Hen": 2 }`), `items` (the storage: `{ "Dram": 50, "Grain": 6 }`) |
| `areas` | Each area: `icon`, `name`, `script` (its code tab's name), `animal` (who lives there), `sizes` (its side now and after each «bigger» upgrade, up to 12), `objects` (where its things start: `Basket`, `Well`, `FeedTrough`, `WaterTrough`, the market's `Stall`; a market is the area with the stall), `code` (the tab's first text), `available: false` = «soon» (drawn as a ruin) |
| `animals` | `feed` (what it eats: an item with `"feed": true`), `product` and `lays` (`true`: a hen lays it on its square; `false`: a cow's milk gets ready on the animal), `every` (seconds per product when happy), `space` (squares per animal: more animals make everyone sad), `step` (seconds per step), `needs` (how fast `hunger`, `thirst` and the `dirt` of its square grow per second, 0–100), `colors` and `rare` (a baby has a parent's colour, now and then the rare one), `hatch` (seconds until an egg left on the ground hatches), `breed` (seconds of two happy adults for a baby), `grow` (seconds a baby stays young), `price` (what a villager pays for it, `vacharelKendani()`), `butt` (a goat's chance to butt the fence on each step) |
| `needs` | `seek` (from this hunger/thirst it walks to a trough), `fill` (how much one portion takes off), `unhappy` (from this it gets sad), `dirty` (a dirt this high makes it sad), `sad` (below this mood it gives nothing), `petBoost` and `petSeconds` (`shoyel()`), `moodSpeed`, `happy` (mood for babies), `rareChance` and `rarePrice` (× the price), `sickDirt` and `sickSeconds` (that much dirt for that long makes it sick), `runaway` (below this mood it leaves through a hole), `fenceHit` (strength a butt takes off, of 100), `ropeSeconds` (`kapel()`) |
| `seasons` | How a season or weather changes the animals: `{ "Summer": { "thirst": 1.5 }, "Rain": { "dirt": 1.5 }, "Spring": { "breed": 2 } }` |
| `machines` | The workshop's machines and their recipes: `{ "Dairy": { "Cheese": { "in": { "Milk": 3 }, "seconds": 60 } } }` (`lcnel()` puts the goods in, `patrastel()` starts, `havaqel()` takes the product) |
| `ship` | What the market's cart takes to the farm (`tanel()`): `{ "Manure": { "Fertilizer": 3 }, "Egg": { "Egg": 1 } }` (a move, not a harvest: no points twice) |
| `troughs` | `capacity` (portions in one trough) |
| `items` | The ranch's goods in storage order: `sell` (base price in ֏), `buy` (base price for `gnel()`: feed, medicine, planks), `feed: true` |
| `prices` | `spread`: every day each price moves up to this share from its base (`0.3` = ±30%), the same for everyone |
| `cart` | Farm items for one ranch good: `{ "Bale": { "Hay": 10000 }, "Plank": { "Wood": 10000 } }` (`berel()`) |
| `orders` | `perDay`, `pay` (× the base price), `base` (amounts asked, grown with the animals), `lines` (`{list}` and `{pay}`), `animals` (the chance that an order also asks for a live animal of a colour); the names and faces come from `village.json → requests.villagers` |
| `hands` | What a drone holds at each «big hands» level: `[3, 5, 10, 20]` |
| `shop` | `id`, `kind` and `cost` (or `costs`, one per level), `icon`, `name`, `about`, `needs` (buy that first), `available: false`. Kinds: `area` (its id is the area's; `animals` come with it, `grants` its commands), `animal` (`animal`), `size` (`area`; one cost per bigger size), `trough` (`FeedTrough` / `WaterTrough`: built with `karucel()`), `machine` (`Stove`: built in the workshop), `upgrade` (`Speed`: drones ×1.5 per level; `Hands`; `Drones`: one more drone in every area, with `grants`), `command` (`grants`: the commands it opens), `boost` (`{ "kind": "speed", "multiplier": 1.5, "seconds": 600 }`: a boost for the farm, bought again and again) |
| `story` | Bridgy's pages: `intro` (the first visit) and `areas` (when an area is bought) |
| `lessons` | Bridgy's pages when a shop item (by its `id`) is bought |
| `quests` | The ranch's quests, like `bridgy.json`; goals: `gain`/`have` (ranch goods), `code` (`fn`, `feature`), `research` (a shop item's `id` bought), `earn` (֏ earned), `order` (orders delivered) |

## texts.json
All interface text. Words in `{curly}` braces are filled in by the game — keep them.
