import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGame, runCode, loadConfig } from './helpers.mjs';
import { createI18n } from '../js/core/i18n.js';
import { describeError } from '../js/ui/errorText.js';

function musicGame(options = {}) {
  const game = makeGame({ ...options, levels: { Music: 1, Lists: 1, ...options.levels } });
  const notes = [];
  game.events.on('music', (event) => notes.push(event));
  return { game, notes };
}

test('music: new pitch and chord forms still require the Music card', () => {
  for (const code of ['nvagel("C4");', 'nvagel(["C4", "E4"]);']) {
    assert.equal(runCode(makeGame({ levels: { Lists: 1 } }), code).error.code, 'lockedFunction');
  }
});

test('music: sharps, flats, and both ends of the piano keyboard play in tune', () => {
  const { game, notes } = musicGame();
  const result = runCode(game, 'nvagel("C#4", 0.25); nvagel("Db4", 0.25); nvagel("A0", 0.25); nvagel("C8", 0.25);', { step: 0.005 });
  assert.equal(result.error, null);
  assert.equal(notes.length, 4);
  assert.equal(notes[0].freq, notes[1].freq);
  assert.ok(Math.abs(notes[0].freq - 277.1826) < 0.001);
  assert.equal(notes[2].freq, 27.5);
  assert.ok(Math.abs(notes[3].freq - 4186.009) < 0.001);
  assert.ok(Math.abs(result.seconds - 0.5) < 0.03);
  for (let i = 1; i < notes.length; i++) assert.ok(Math.abs(notes[i].at - notes[i - 1].at - 0.125) < 0.005);
});

test('music: a chord has one duration, supports legacy notes, and ignores duplicate pitches and rests', () => {
  const { game, notes } = musicGame();
  const result = runCode(game, 'nvagel([Notaner.Do, Notaner.Mi, Notaner.Sol, Notaner.Do, Notaner.Dadar], 2, 60);', { step: 0.01 });
  assert.equal(result.error, null);
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].frequencies, [261.63, 329.63, 392]);
  assert.equal(notes[0].seconds, 2);
  assert.ok(Math.abs(result.seconds - 2) < 0.04, `${result.seconds} seconds`);
});

test('music: tempo controls notes and rests; Speed research does not change their beat length', () => {
  const { game, notes } = musicGame({ levels: { Speed: 7 } });
  const result = runCode(game, 'nvagel("A4", 2, 60); nvagel(Notaner.Dadar, 1, 60); nvagel("A4", 2, 120);', { step: 0.01 });
  assert.equal(result.error, null);
  assert.deepEqual(notes.map((note) => note.seconds), [2, 1]);
  assert.ok(Math.abs(notes[1].at - notes[0].at - 3) < 0.01);
  assert.ok(Math.abs(result.seconds - 4) < 0.04);
});

test('music: omitted tempo preserves the configured beat length, and the wider duration range works', () => {
  const config = loadConfig();
  config.settings.time.noteBeatSeconds = 0.75;
  const { game, notes } = musicGame({ config });
  const result = runCode(game, 'nvagel("C4", 0.125); nvagel("C4", 8); nvagel([Notaner.Dadar], 1);', { step: 0.005 });
  assert.equal(result.error, null);
  assert.deepEqual(notes.map((note) => note.seconds), [0.09375, 6]);
  assert.ok(Math.abs(result.seconds - 6.84375) < 0.03);
});

test('music: invalid pitches, chords, lengths, and tempos fail before playing a partial chord', () => {
  const cases = [
    ['nvagel("H4");', 'notePitch'],
    ['nvagel("C0");', 'notePitch'],
    ['nvagel("C#8");', 'notePitch'],
    ['nvagel(["C4", "bad"]);', 'notePitch'],
    ['nvagel([]);', 'noteChord'],
    ['nvagel(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5"]);', 'noteChord'],
    ['nvagel(["C4", 42]);', 'badArg'],
    ['nvagel("C4", 0);', 'noteLength'],
    ['nvagel("C4", 9);', 'noteLength'],
    ['nvagel("C4", 1, 0);', 'noteTempo'],
    ['nvagel("C4", 1, 301);', 'noteTempo'],
    ['nvagel("C4", 1, "120");', 'noteTempo'],
    ['nvagel("C4", 1, NaN);', 'noteTempo'],
    ['nvagel("C4", 1, Infinity);', 'noteTempo'],
  ];
  for (const [code, expected] of cases) {
    const { game, notes } = musicGame();
    const result = runCode(game, code);
    assert.equal(result.error?.code, expected, code);
    assert.equal(notes.length, 0, code);
  }
});

test('music: the bundled waltz plays without errors, keeps 24 beats, and leaves crops alone', () => {
  const code = readFileSync(new URL('../music/nvagel/song.js', import.meta.url), 'utf8');
  const { game, notes } = musicGame({ levels: { Loops: 1, Variables: 1, Operators: 1 } });
  const result = runCode(game, code, { step: 0.01 });
  assert.equal(result.error, null);
  assert.ok(result.finished);
  assert.equal(notes.length, 29);
  assert.ok(notes.some((note) => note.frequencies.length === 4));
  assert.ok(Math.abs(notes.reduce((sum, note) => sum + note.seconds, 0) - 14.4) < 0.00001);
  assert.ok(result.seconds < 15.3);
  assert.equal(game.inventory.get('Hay'), 0);
});

test('music: new errors and command help are available in all three languages', () => {
  for (const lang of ['hy', 'en', 'ru']) {
    const config = loadConfig(lang);
    const { game } = musicGame({ config });
    const i18n = createI18n(config.texts, config.research.nodes, config.guide, lang);
    for (const code of ['nvagel("bad");', 'nvagel([]);', 'nvagel("C4", 0);', 'nvagel("C4", 1, 0);']) {
      const { error } = runCode(game, code);
      const { message } = describeError(error, i18n, game);
      assert.ok(!message.startsWith('errors.'), `${lang}: ${error.code}`);
      assert.ok(!message.includes('{gotText}'));
    }
    assert.ok(config.guide.commands.playNote.doc.includes('BPM'));
    assert.ok(config.guide.commands.playNote.doc.includes('C#4'));
  }
});
