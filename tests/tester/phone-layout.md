# Phone layout
Code: `css/mobile.css`, `js/main.js` (`.typing`, `.keyboard`), `js/ui/editor.js`. Sizes 390×844 and 844×390, touch on, Android user agent for typing.

- [ ] No sideways scroll on any screen (farm, code, research, village, ranch, market, challenge, profile, leaderboard, settings).
- [ ] Code tab: the symbol keys scroll to the last one, the console's clear button shows, and the undo key works.
- [ ] Typing with `Input.imeSetComposition`: the composed word is not wiped, and autocomplete fires. The editor height doesn't change while typing.
- [ ] Bars hide only with `.typing` + `.keyboard`.
- [ ] Every modal fits and can be closed. Text is not cut off.
- [ ] 320×640 and every full-screen page (challenge too): `innerWidth` stays the device width (a too-wide control bar makes Android zoom the whole page out).
- [ ] Landscape (800×360, 844×390): the Storage tab shows its items, and the ranch's «Ֆերմա» (back) button is not under the control bar.
- [ ] Profile window at 360–412 wide: nothing cut at the right edge (`.modal-body` grid needs `minmax(0, 1fr)`).
- [ ] Landscape with the keyboard open (height × 0.45): the editor still shows at least 2 code lines.
- [ ] Android back key (`Page.navigateToHistoryEntry`) with a window open: note what happens; the code typed just before must survive.
- [ ] Exactly 360 wide with a 2-digit Perfection (99%), right after login: the top bar stays on 2 rows and «Հետազոտել» opens on the first tap while the login toasts play.
- [ ] No toast (Bridgy's or the game's) sits on a button: tap the TV chip, research zoom, village spots and Storage's «Գյուղ»/«Ռանչո»/«Առևտուր» while a toast shows.
- [ ] Large font («Մեծ») at 320: no page wider than the screen (loom 4th tab, settings «Մեծ», farm header chips).
- [ ] 320–360: Bridgy's dialog (quiz answers, help menu, error dialog with «Ցույց տուր») fits without cut buttons or words split mid-number.
- [ ] Android app build: `diff -rq js mobile/www/js` is empty (run `npm run web` first), and Back with a window open closes the window, not the app (needs a Back handler, e.g. `@capacitor/app`).
