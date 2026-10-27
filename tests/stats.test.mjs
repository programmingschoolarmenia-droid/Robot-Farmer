import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame } from './helpers.mjs';
import { Stats } from '../js/engine/stats.js';
import { dayKey, prevDayKey, prevMonthKey } from '../js/core/util.js';

const at = (iso) => () => Date.parse(iso);

test('date keys: Armenia time, the day before and the month before', () => {
  assert.equal(dayKey(Date.parse('2026-10-27T21:30:00Z'), 'Asia/Yerevan'), '20261028'); // 01:30 in Yerevan
  assert.equal(dayKey(Date.parse('2026-10-27T19:30:00Z'), 'Asia/Yerevan'), '20261027');
  assert.deepEqual([prevDayKey('20260301'), prevDayKey('20260101')], ['20260228', '20251231']);
  assert.deepEqual([prevMonthKey('202601'), prevMonthKey('202611')], ['202512', '202610']);
});

test('points: weighted gains, today, this month, the streak and the breakdown', () => {
  const game = makeGame();
  const s = game.stats;
  s.clock = at('2026-10-30T10:00:00Z');
  game.inventory.add('Hay', 10);
  game.inventory.add('Gold', 2);
  game.inventory.add('Water', 50); // worth 0
  assert.equal(s.points(), 10 + 40);
  assert.deepEqual([s.day, s.streak], [{ key: '20261030', points: 50 }, 1]);
  assert.deepEqual(s.breakdown().map((b) => [b.item, b.amount, b.weight, b.points]), [['Gold', 2, 20, 40], ['Hay', 10, 1, 10]]);

  // The next day: the streak grows and yesterday is kept (for the champion's crown).
  s.clock = at('2026-10-31T10:00:00Z');
  game.inventory.add('Carrot', 5);
  assert.deepEqual([s.day, s.prevDay, s.streak], [{ key: '20261031', points: 10 }, { key: '20261030', points: 50 }, 2]);

  // A new month after a skipped day: the streak starts again.
  s.clock = at('2026-11-02T10:00:00Z');
  game.inventory.add('Hay', 1);
  assert.deepEqual([s.streak, s.month, s.prevMonth], [1, { key: '202611', points: 1 }, { key: '202610', points: 60 }]);

  // Spending does not take points away; the numbers survive saving and loading.
  game.inventory.pay({ Gold: 2 });
  assert.equal(s.points(), 61);
  assert.equal(s.addCode([{ hash: 'abc', words: 3 }]), 3);
  const loaded = new Stats(game, JSON.parse(JSON.stringify(s.toSave())));
  assert.deepEqual([loaded.points(), loaded.day, loaded.prevDay, loaded.streak, loaded.codeWords], [61, s.day, s.prevDay, 1, 3]);
  assert.equal(loaded.addCode([{ hash: 'abc', words: 3 }]), 0);
});
