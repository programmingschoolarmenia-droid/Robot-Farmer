# Բրիջիի ֆերման — Bridgy's Farm

A browser game for learning JavaScript: students write code that drives a drone on a
farm, buy research to unlock new plants, functions and JavaScript features, and Bridgy
the robot teaches them with lessons, quizzes, quests and hints (never ready-made answers).
The interface and the game commands are in Armenian (`havaqel()`, `tnkel(Bujser.Gazar)`,
`gnal(Aj)`); JavaScript itself (`while`, `if`, `let`, `function`…) stays as it is.

## Run it

The game must be opened through a small web server (browsers block reading the
`config/*.json` files from a plain file):

```bash
cd "Robot Farmer"
python3 -m http.server 8080      # or: npm start
```

Then open <http://localhost:8080> in Chrome, Edge, Firefox or Safari — on a computer, a
tablet or a phone (phones get a tabbed layout: Farm / Code / Storage, with a symbol bar
above the keyboard).

To put it online (e.g. GitHub Pages), upload the whole folder as a static site — no build
step is needed.

## For teachers

* **Change the game** (prices, speeds, plants, texts, Bridgy's lessons and quests): see
  [`config/README.md`](config/README.md).
* **Prepare a lesson quickly:** set `"unlockAll": true` in `config/settings.json → dev`.
* **The village** («🏘 Գյուղ», after the «Plant» research): students rebuild a ruined village
  building by building with the items they gather, villagers post 3 requests a day that pay
  ⭐ stars, and the repaired buildings unlock kitchen machines on the farm (mill, jam pot,
  tonir: flour, jam, lavash, gata, ghapama…), dishes that boost the drone, and greenhouse glass.
  Everything is in [`config/village.json`](config/README.md).
* **Festivals and the weekly challenge** (see [`config/README.md`](config/README.md) →
  `events.json`): Trndez, Easter, Vardavar, Navasard, Knowledge Day, Teacher's Day and the New
  Year come on their real dates with a bonus for everyone, and with the Festival square students
  hunt hidden objects with `hototel()` for festival hats. The School opens a weekly coding
  challenge on a test farm that is the same for everyone (fastest time wins, the top 3 get hats
  and 🏅 medals). Villagers also give secret code notes (`gtnel()` digs out their treasure), the
  Profile has a sticker album, and «🌟 %» shows how much of the game a student has done.
* **Seasons, weather and the luck of the day** follow the real clock, the same for every
  student: with the default 15-minute seasons, each hour is spring (:00), summer (:15), autumn
  (:30) and winter (:45). Plants grow faster in their favourite season, rain waters the whole
  farm, lightning makes a plant give ×3, and every day has its own luck. The 📺 button above the
  farm shows it all; see [`config/README.md`](config/README.md) → `calendar`.
* **Accounts and the leaderboard:** students register with a username and a password.
  Their farm is saved in their account. The leaderboard's two dropdowns choose what (points for
  everything gathered, where rare items count more; working code words, where repeats count
  once; the weekly challenge; Perfection; the running festival) and, for points, when
  (today / this month / all time).
  To make this work online (school ↔ home ↔ phone), create a free Firebase project once —
  step by step in [`config/README.md`](config/README.md#accounts-and-the-leaderboard-firebase-free).
  Without it, accounts work only inside one browser.
* In the browser console, `bridgysFarm.screen.game` gives access to the running game
  (e.g. `bridgysFarm.screen.game.inventory.add('Wood', 500)` for a demo).

## Project layout

```
index.html            page + libraries
css/                  styles (light theme)
js/main.js            start-up: load + check config, login, game screen
js/lang/              the JavaScript interpreter (parser front end, research gate, runtime)
js/engine/            game rules: world, plants, research, drones, quests, saves format
js/storage/           accounts: login, online saves (Firebase REST) and the leaderboard
js/ui/                farm view, editor, research tree, Bridgy, Bridgy's book, login/profile, panels
css/mobile.css        phone and portrait-tablet layout
config/               all teacher-editable data (JSON)
assets/               Bridgy, drone and crop pictures (see assets/CREDITS.md)
vendor/               Acorn + CodeMirror 5 (bundled so the game works offline)
tests/                automated tests:  npm test   (Node 18+)
tools/sprites.html    preview of every sprite (open via the web server)
```
