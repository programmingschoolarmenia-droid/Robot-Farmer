import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, runCode } from './helpers.mjs';
import { Game } from '../js/engine/game.js';
import { QuestTracker } from '../js/engine/quests.js';

const GOLDEN_ONLY = { Carp: { chance: 0, amount: 1 }, Barbel: { chance: 0, amount: 3 }, Trout: { chance: 0, amount: 10 }, Golden_Fish: { chance: 1, amount: 50 } };

test('fishing: dig a pond, fill it with water, then fish', () => {
  const game = makeGame({ unlockAll: true, items: { Water: 10 } });
  const tile = game.world.tile(0, 0);
  let r = runCode(game, 'tpel(dzknorsel());');
  assert.deepEqual([r.out, r.warnings], [['null'], ['pondNeeded']]);

  r = runCode(game, 'porel();\nogtagorcel(Irer.Jur);\ntpel(dzknorsel());');
  assert.deepEqual([tile.ground, tile.water, r.out, r.warnings], ['Pond', 0.25, ['null'], ['pondNotFull']]);

  r = runCode(game, 'while (jriQanak() < 1) {\n  ogtagorcel(Irer.Jur);\n}\nlet dzuk = dzknorsel();\ntpel(dzuk);');
  assert.equal(r.error, null);
  assert.ok(game.world.isFullPond(tile));
  assert.match(r.out[0], /^Dzkner\.(Karas|Kogak|Ishkhan|Voske)$/);
  assert.ok(game.inventory.get('Fish') >= 16, 'research level 5 doubles the catch 4 times');

  // The pond keeps its water and its place in a save; nothing grows in it; herkel() fills it in.
  game.world.sync(tile, game.time + 1000);
  assert.equal(tile.water, 1);
  const loaded = new Game(game.config, JSON.parse(JSON.stringify(game.toSave()))).world.tile(0, 0);
  assert.deepEqual([loaded.ground, loaded.water], ['Pond', 1]);
  assert.deepEqual(runCode(game, 'tnkel(Bujser.Tup);').warnings, ['plant_pond']);
  runCode(game, 'herkel();');
  assert.deepEqual([tile.ground, tile.water], ['Grassland', 0]);
});

test('fishing: a cast takes 3 seconds at the base speed and drones fish too', () => {
  const game = makeGame({ levels: { Fishing: 1, Watering: 1, Loops: 1, Speed: 0 }, items: { Water: 4 } });
  runCode(game, 'porel();\nogtagorcel(Irer.Jur, 4);');
  const r = runCode(game, 'dzknorsel();');
  assert.ok(Math.abs(r.seconds - 3) < 0.2, `took ${r.seconds}s`);
  const fish = makeGame({ unlockAll: true, items: { Water: 8 } });
  const code = 'function lake() {\n  porel();\n  ogtagorcel(Irer.Jur, 4);\n  return dzknorsel();\n}\ngnal(Aj);\nlet d = norDron(lake);\ngnal(Dzax);\ntpel(lake(), spasel(d));';
  const out = runCode(fish, code);
  assert.equal(out.error, null);
  assert.match(out.out[0], /^Dzkner\.\w+ Dzkner\.\w+$/);
});

test('fishing: the chances follow settings.json', () => {
  const game = makeGame({ unlockAll: true });
  const tile = game.world.tile(0, 0);
  const counts = { Carp: 0, Barbel: 0, Trout: 0, Golden_Fish: 0 };
  for (let i = 0; i < 4000; i++) counts[game.catchFish(game.mainDrone, tile)]++;
  const share = (f) => counts[f] / 4000;
  assert.ok(Math.abs(share('Carp') - 0.7) < 0.03 && Math.abs(share('Barbel') - 0.25) < 0.03, JSON.stringify(counts));
  assert.ok(Math.abs(share('Trout') - 0.04) < 0.015 && Math.abs(share('Golden_Fish') - 0.01) < 0.008, JSON.stringify(counts));
  assert.equal(game.stats.harvestCount('Golden_Fish'), counts.Golden_Fish);
});

test('fishing: the first golden fish unlocks the fisher hat, and it stays in the save', () => {
  const game = makeGame({ unlockAll: true });
  assert.equal(game.research.hasHat('Fisher_Hat'), false);
  game.settings.fishing.fish = GOLDEN_ONLY;
  const events = [];
  game.events.on('fish', (e) => events.push([e.species, e.amount, e.hat]));
  game.catchFish(game.mainDrone, game.world.tile(0, 0));
  game.catchFish(game.mainDrone, game.world.tile(0, 0));
  assert.deepEqual(events, [['Golden_Fish', 50 * 16, 'Fisher_Hat'], ['Golden_Fish', 50 * 16, null]]);
  assert.equal(game.research.hasHat('Fisher_Hat'), true);
  assert.equal(new Game(game.config, JSON.parse(JSON.stringify(game.toSave()))).research.hasHat('Fisher_Hat'), true);
});

test('quests: saves keep their quest when the fishing quests are inserted into the chain', () => {
  const game = makeGame();
  const at = (saved) => {
    const q = new QuestTracker(game, saved);
    q.destroy();
    return q.current() ? q.current().id : 'all done';
  };
  // Older saves kept only the position in the list as it was without the fishing quests.
  assert.equal(at({ index: 26 }), 'water_5');
  assert.equal(at({ index: 27 }), 'buy_sunflowers');
  assert.equal(at({ index: 41 }), 'all done');
  // Saves now remember the quest itself.
  assert.equal(at({ index: 3, id: 'fish_20' }), 'fish_20');
  const q = new QuestTracker(game, { index: 27 });
  q.destroy();
  assert.equal(q.toSave().id, 'buy_sunflowers');
});

test('quests: a full pond and a golden fish complete the fishing goals', () => {
  const game = makeGame({ unlockAll: true, items: { Water: 8 } });
  const quests = new QuestTracker(game, { id: 'fill_pond' });
  runCode(game, 'porel();\nwhile (jriQanak() < 1) {\n  ogtagorcel(Irer.Jur);\n}');
  assert.equal(quests.current().id, 'fish_20');
  quests.index = quests.quests.findIndex((x) => x.id === 'golden_fish');
  quests.captureBaseline();
  game.settings.fishing.fish = GOLDEN_ONLY;
  runCode(game, 'dzknorsel();');
  assert.equal(quests.current().id, 'buy_sunflowers');
  quests.destroy();
});
