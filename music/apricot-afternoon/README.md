# Apricot Afternoon

Original instrumental background score for Bridgy's Farm: 84 BPM, D major, 64 bars, approximately 3:03 per loop.

Soft piano leads a nylon guitar, acoustic bass, airy flute, sparse celesta, quiet strings, and brushed percussion. The arrangement has an introduction, two main themes, a bridge, and a gentle turnaround for long play sessions.

- `apricot-afternoon.wav`: 24-bit stereo listening/master file.
- `apricot-afternoon.mid`: editable two-cycle MIDI score.
- `compose.py`: deterministic original composition source (Python standard library).
- `score.json`: tempo, form, and chord progression.
- `../../assets/audio/apricot-afternoon.ogg`: streamed game version.
- `../../assets/audio/apricot-afternoon.mp3`: fallback and convenient listening version.

The game uses its existing Music slider and saved volume preference. Music is streamed only when enabled, loops across game screens, and pauses when the app is hidden. The previous default of muted music is preserved.

Rendering uses FluidSynth 2.6.2 and GeneralUser GS 2.0.3 by S. Christian Collins. Only rendered music, not the sound bank, is packaged with the game. The sound bank's license permits private and commercial music creation; its full text is retained here.

Instrument source: https://github.com/mrbumpy409/GeneralUser-GS

To reproduce, run `python3 compose.py`, render the MIDI with FluidSynth at 44.1 kHz, and extract the settled second 182.857216-second cycle. The final master has a gentle high-pass/low-pass and approximately -19 LUFS loudness.

The master is fitted to the exact 64-bar loop duration with a tiny timing correction and 6 ms endpoint fades; the PCM boundary has zero sample jump. The Ogg game asset is approximately 1.7 MB.

Verified in Chrome: no music element is created while music is muted; enabling music starts playback; reaching the end loops; mute pauses playback; re-enabling resumes from the stored position. The safe browser play-through passes at 1366×768, 390×844, and 844×390. The existing unit-test baseline remains 158 passing / 21 failing; no additional gameplay test failures appeared.
