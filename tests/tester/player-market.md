# Player market («Առևտուր»)
Code: `js/engine/market.js`, `js/ui/market.js`, `settings.json` → `market`. Fake Firebase, two pages sharing one `fake`; live only between `tester` and `tester2`.

- [ ] Only farm goods you have made can be offered. Whole orders only. Player names are shown.
- [ ] Price band: one side at most 3× the other; the slider can't go past it.
- [ ] Limits: 3 open orders, 5 taken a day, orders last 3 days, `maxAmount`.
- [ ] Escrow: offered goods leave the storage at once and come back on cancel/expiry.
- [ ] Two buyers take the same order at once: exactly one wins, and the other gets `gone` with a clear message and no lost goods.
- [ ] Old tab (`stale`), rename with open orders (`hasOrders`), offline during a trade: no goods lost or doubled.
- [ ] Traded goods give no leaderboard points. Admin can remove orders.
- [ ] Live (when asked): one real trade `tester` ↔ `tester2` proves the real Firestore rules. If the test accounts don't have the Market card yet, say so.
