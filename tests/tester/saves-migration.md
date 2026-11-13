# Saves and migration (most important)
Code: `js/storage/*`, `js/engine/game.js` (save `v`, `Game.migrate`: `OLD_SPEED_LEVEL`, `OLD_EXPAND_LEVEL`), `account.js` (`rev`, keepalive).

- [ ] Reload mid-game and close the tab right after an action: progress is kept (local and fake).
- [ ] Closing saves skip `check()` and use keepalive under 64 KB; a bigger save still saves some other way, or is reported.
- [ ] An old save made by the last commit (`git archive`) loads in the new code with nothing lost. Also a `v` 1 save.
- [ ] A save from before the crop rules (`v` 2): the farm is not smaller (22×22 and 32×32 stay), every item and research level is kept (only «Good neighbours» is gone), giant watermelons are giant square melons, eggplant owners have 10 seeds, the quest is the same one (or the next, for a removed quest), and Bridgy says once that juice is drunk with `xmel()`.
- [ ] Two tabs: the old tab goes back to login and never overwrites (`rev`).
- [ ] localStorage full or blocked: a clear message, no crash, no silent loss.
- [ ] A hand-broken save (bad JSON, missing fields) doesn't white-screen and doesn't overwrite the cloud copy.
- [ ] A guest with full storage (`Storage.prototype.setItem` throws `QuotaExceededError`): the student is told, and a reload doesn't silently lose the progress.
