# Teacher admin
Code: `js/storage/account.js`, `js/ui/account.js`, `settings.json` → `online.admins`. Fake Firebase only (`createFakeFirebase({ admins: ['admin'] })`). Never on live.

- [ ] Only `admin` sees Delete on player cards; removal takes effect at once, and the removed player can't write.
- [ ] «Տեղափոխել ֆերման» moves a farm to another account without loss; refuse or warn on overwriting a farm with progress.
- [ ] Admin can remove market orders and contest carpets; normal players can't (fake refuses).
- [ ] Every dialog button is Armenian (askText/confirmModal default "OK" showed in «Տեղափոխել ֆերման» and the new-script-tab dialog).
