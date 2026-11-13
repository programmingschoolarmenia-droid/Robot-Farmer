# Leaderboard
Code: `js/engine/stats.js`, `js/storage/account.js`, `js/ui/account.js`, `settings.json` → `leaderboard`. Use fake Firebase with several players.

- [ ] Both dropdowns (what × when): every pair shows sensible rows. Today/month/all time use the dated fields `d<YYYYMMDD>`, `m<YYYYMM>`, `c<YYYYWW>`.
- [ ] Points = totals × `leaderboard.points`. Traded market goods give no points; ranch→farm moves (`tanel`) don't count twice.
- [ ] Tiers are farm-themed, not medals. The player card opens from a row.
- [ ] An idle tab sends nothing (`touched`), and a running program syncs on `cloudSaveSeconds`.
- [ ] Crossing midnight/month: the new day starts at 0, and old rows stay.
