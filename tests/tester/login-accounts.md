# Login and accounts
Code: `js/storage/account.js`, `js/ui/account.js`, `js/storage/localStorageAdapter.js`. Docs: `config/README.md` → Accounts.
Modes: blocked (local accounts) and fake (online).

- [ ] Register, log out, log in again: same farm. Wrong password, empty fields, a very long name, Armenian letters, spaces, a taken name: each gives a clear Armenian message and no crash.
- [ ] «Շարունակել որպես …» on the login screen goes into the right account, and the game does not auto-enter.
- [ ] Rename: the save, the player row and the leaderboard follow. Renaming is refused while market orders are open (`hasOrders`).
- [ ] Two tabs on one account (fake): the older tab is sent back to login (`rev`) and never overwrites the newer save.
- [ ] Expired token (`fake.expireTokens()`): the game refreshes it silently or asks to log in again, and nothing is lost.
- [ ] Offline at login (`fake.offline = true`): a clear message, then it works once back online.
- [ ] A deleted account (`deleted/<name>` doc exists): it can't write, and the student sees a clear message.
- [ ] Double-click on «Մուտք» / register: there must be no double account and no error.
