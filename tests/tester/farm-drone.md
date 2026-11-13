# Farm and drone
Code: `js/engine/world.js`, `drone.js`, `game.js`, `inventory.js`, `api.js`, `js/ui/farmView.js`, `sprites.js`.

- [ ] Every plant (wheat, rosehip, apricot tree, mulberry, eggplant, the three watermelons, pomegranate, grape vine, mushrooms) plants, grows, and harvests the right item and amount. Unripe wheat stays when harvested; other unripe plants are lost with a warning.
- [ ] Moving off the edge wraps around as designed. `gnal` with a bad direction gives a clear error.
- [ ] Watering and humus. Tired soil starts only after the Humus card: the same crop again and again lowers the harvest to a half (the soil turns pale), another crop rests it, humus mends it at once. Magic dust comes from mushrooms only.
- [ ] Each crop's own rule: eggplant seeds (wheat drops the first ones), apricot's 3 fruits and `chapel()`, mulberry ×2 next to a ripe rosehip, watermelon sweetness 0–100 (under 80 nothing, too late it rots), yellow melon vines and n², pomegranate even-number combo and `xmel()`, the running mouse.
- [ ] Giant square melons (n³), sorted grape rows (n², swaps only left and right), the snake (skins = mice × length): sizes and payouts match `settings.json`.
- [ ] Several drones (`DronneriTim`): no two drones break each other's square, and stopping stops all of them.
- [ ] Speed: 7 levels, the top speed is the same as before; an old save (`v` 1) moves up by `OLD_SPEED_LEVEL`.
- [ ] A 16×16 farm (and an old 32×32 one from a save) with several drones keeps the FPS steady (report numbers).
- [ ] Hats: put on and taken off, drawn on the drone at every size.
