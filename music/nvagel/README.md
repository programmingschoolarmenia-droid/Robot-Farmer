# nvagel piano

`nvagel(note, beats = 1, bpm)` keeps the original enum notes and rests, and also
accepts scientific pitch names (`"C4"`, `"F#3"`, `"Bb5"`) across A0–C8. A list of
up to eight notes plays a chord. Durations are 0.125–8 beats. BPM is optional,
30–300; without it, the existing `time.noteBeatSeconds` setting applies (120 BPM
in the shipped game). Use the same BPM on each call to keep a song at one tempo.

Copy [song.js](song.js) into the game editor for an original eight-bar waltz.
Existing calls such as `nvagel(Notaner.Do, 1)` continue to work.
The [short preview](preview.mp3) renders its first four bars through the same
WebAudio piano used by the game.

The instrument uses eight acoustic piano samples (C1–C8), rendered from
GeneralUser GS 2.0.3 by S. Christian Collins. Adjacent pitches use the nearest
sample, with at most six semitones of transposition. The complete local MP3 is
about 385 KB and loads once when Music is available. No remote audio service or
new runtime dependency is needed. A soft piano synthesiser handles playback
while samples load or if loading fails.

Notes use the sound-effects volume, with a maximum of 24 voices and short
release tails. A compressor on this instrument keeps simultaneous drones from
clipping. Stop, Pause, restart, errors, leaving the game, and hiding the
tab silence this instrument without interrupting the background score or
changing farming actions. A small audio lookahead keeps successive notes on
the same clock; the game speed still stretches note durations as before.

To rebuild the MP3, install FluidSynth and FFmpeg, then run:

```sh
python3 music/nvagel/render.py /path/to/GeneralUser-GS.sf2
```

The source sound bank is not packaged. Its full license is retained at
`../apricot-afternoon/GeneralUser-GS-LICENSE.txt`.
