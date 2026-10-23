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
* **Accounts and the leaderboard:** students register with a username and a password.
  Their farm is saved in their account and the leaderboard ranks everybody by research.
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
