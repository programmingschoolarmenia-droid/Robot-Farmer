# Desktop apps

Two ways to play Bridgy's Farm as a program on Windows and Mac. Both open the live website
(https://robot-farmer.vercel.app/) in their own window, so every push reaches them with no reinstall,
and farms are the same online accounts. Without internet they show «Ինտերնետ չկա» and retry.
Nothing here is part of the website (`.vercelignore` keeps this folder out of the deploy).

| | Electron | Light (Neutralino) |
|---|---|---|
| Browser engine | its own Chrome, everywhere | the computer's: Edge (WebView2) on Windows, Safari on Mac |
| Size | ~110 MB exe, ~230 MB dmg | ~2.5 MB exe, ~3 MB dmg |
| Windows | 10 or newer | 10 or newer with WebView2 (built into Windows 11 and updated Windows 10) |

Both start full screen. Electron: F11 switches it. Light app: its start page turns on full screen once the
window has drawn (at launch the Mac web view stays white); on Mac the green button or Ctrl+Cmd+F leaves it,
on Windows Alt+F4 closes it. The start page may only call `window.setFullScreen` (`nativeAllowList`), and the
key for it is given out once, so the game site has no access. It sends that one call over Neutralino's
WebSocket itself (no client library), and only after the app's `appClientConnect` message: calls sent
earlier are dropped.

The address is in `web/index.html` (`SITE`) and `electron/main.js` (`SITE`).

## Build (on a Mac)

Electron, in `electron/`: `npm install` once, then `npm run mac` and `npm run win`.
Output in `dist/electron/`: a dmg, a Windows installer (`Setup`) and a portable exe (no install).

Light: `npx -y @neutralinojs/neu@11.8.0 update` once, then `./pack-light.sh`.
Output in `dist/light/`: `Bridgys-Farm-Light.dmg` and `Bridgys-Farm-Light.exe` (one file, no install).

## First start (apps are not signed)

- Mac: open the dmg, drag the app to Applications. If macOS refuses: System Settings → Privacy & Security → "Open Anyway".
- Windows: "Windows protected your PC" → "More info" → "Run anyway".
