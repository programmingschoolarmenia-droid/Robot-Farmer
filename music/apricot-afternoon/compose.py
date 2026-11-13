"""Original score for Bridgy's Farm. Writes standard MIDI; no third-party Python packages.

Render with FluidSynth and GeneralUser GS. The two-cycle score lets the final
loop be cut from a settled second performance, including the first cycle's reverb.
"""
from pathlib import Path
import json
import random
import struct

ROOT = Path(__file__).resolve().parent
PPQ = 960
BPM = 84
BARS = 64
rng = random.Random(20261113)
tracks = [[] for _ in range(7)]
channels = [0, 1, 2, 3, 4, 5, 9]
programs = [0, 24, 32, 73, 8, 48, 40]
names = ['Soft piano', 'Nylon guitar', 'Acoustic bass', 'Airy flute', 'Celesta', 'Warm strings', 'Brush percussion']


def event(track, beat, data):
    tracks[track].append((max(0, round(beat * PPQ)), bytes(data)))


def note(track, pitch, beat, length, velocity=55, human=True):
    offset = rng.uniform(-0.008, 0.008) if human else 0
    vel = max(1, min(127, velocity + rng.randint(-3, 3)))
    ch = channels[track]
    event(track, beat + offset, [0x90 | ch, pitch, vel])
    event(track, beat + offset + length, [0x80 | ch, pitch, 0])


def vlq(n):
    out = [n & 127]
    while n > 127:
        n >>= 7
        out.insert(0, 128 | (n & 127))
    return bytes(out)


def midi_track(events):
    data = bytearray()
    previous = 0
    for tick, message in sorted(events, key=lambda x: (x[0], x[1][0] & 0xF0 != 0x80)):
        data += vlq(tick - previous) + message
        previous = tick
    data += b'\x00\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(data)) + data


for i, (ch, prog) in enumerate(zip(channels, programs)):
    event(i, 0, [0xC0 | ch, prog])
    for cc, value in [(7, [85, 64, 69, 52, 43, 38, 52][i]), (10, [55, 79, 64, 44, 87, 63, 67][i]), (91, [42, 33, 20, 52, 48, 60, 24][i])]:
        event(i, 0, [0xB0 | ch, cc, value])
    text = names[i].encode()
    tracks[i].append((0, b'\xff\x03' + vlq(len(text)) + text))

# Closely voiced major sevenths and ninths, with a lightly suspended dominant.
CHORDS = {
    'D9': ([50, 57, 61, 64, 66], 38),
    'AC': ([49, 57, 59, 64, 69], 37),
    'Bm': ([47, 54, 57, 61, 66], 35),
    'G9': ([43, 54, 57, 59, 62], 31),
    'Em': ([52, 55, 59, 62, 66], 40),
    'A9': ([45, 55, 59, 61, 64], 33),
    'DF': ([54, 57, 62, 64, 69], 42),
    'As': ([45, 55, 59, 62, 64], 33),
    'Fm': ([54, 57, 61, 64, 69], 42),
    'D6': ([50, 57, 59, 62, 66], 38),
}
A = ['D9', 'AC', 'Bm', 'G9', 'Em', 'A9', 'DF', 'As']
B = ['G9', 'A9', 'Fm', 'Bm', 'Em', 'As', 'D9', 'D6']
progression = ['D9', 'G9', 'DF', 'A9', 'Bm', 'G9', 'Em', 'As'] + A * 2 + B + B * 2 + A + ['G9', 'A9', 'Fm', 'Bm', 'Em', 'A9', 'D6', 'As']
assert len(progression) == BARS

# Original eight-bar phrases: (offset in beats, MIDI pitch, note duration).
MELODY_A = [
 [(0,66,.7),(.85,69,.5),(1.5,71,.7),(2.5,69,.65),(3.35,64,.55)],
 [(0,64,.9),(1.25,66,.5),(2,64,.65),(3,61,.75)],
 [(.15,66,.6),(1,69,.7),(2,73,.6),(2.8,71,.5),(3.5,69,.4)],
 [(0,67,.8),(1.25,66,.5),(2,62,1.45)],
 [(0,64,.65),(.9,66,.5),(1.65,67,.6),(2.5,71,.9)],
 [(.25,69,.65),(1.2,66,.55),(2,64,.6),(3,61,.75)],
 [(0,62,.65),(.9,66,.6),(1.8,69,.6),(2.8,66,.9)],
 [(0,64,.7),(1,62,.6),(2,61,1.1)],
]
MELODY_B = [
 [(.2,71,.8),(1.4,74,.65),(2.5,73,.5),(3.25,71,.6)],
 [(0,69,1),(1.5,71,.6),(2.5,69,.9)],
 [(.2,69,.55),(1,73,.6),(2,76,.7),(3,73,.7)],
 [(0,74,.9),(1.3,73,.5),(2.15,71,1.3)],
 [(.25,71,.65),(1.15,69,.5),(2,67,.65),(3,66,.7)],
 [(0,64,.75),(1.2,66,.5),(2,64,.65),(3.2,61,.5)],
 [(0,66,.65),(.9,69,.6),(1.8,74,.85),(3,73,.6)],
 [(0,71,.8),(1.2,69,1.8)],
]

for cycle in range(2):
    for bar, chord_id in enumerate(progression):
        at = (cycle * BARS + bar) * 4
        chord, bass = CHORDS[chord_id]
        intro = bar < 8
        ending = bar >= 56
        busy = 32 <= bar < 48
        # Piano accompaniment is gently rolled rather than struck as a block.
        for j, pitch in enumerate(chord[1:]):
            note(0, pitch, at + .04 * j, 2.55 if intro else 3.25, 35 if intro or ending else 39)
        if not intro and not ending and bar % 2 == 1:
            note(0, chord[3], at + 2.75, .45, 34)
        pattern = [0, 2, 1, 3, 2, 4, 3, 1]
        for k in range(4 if intro or ending else 8):
            offset = k if intro or ending else k * .5
            note(1, chord[pattern[k]], at + offset + .025, .65, 39 if ending else 45)
        note(2, bass, at + .035, 1.65, 49 if intro or ending else 57)
        if not intro:
            note(2, bass + 7, at + 2.05, 1.4, 42 if ending else 49)
        if 8 <= bar < 56:
            phrase = MELODY_B if 24 <= bar < 48 else MELODY_A
            for offset, pitch, length in phrase[bar % 8]:
                # The bridge is answered by an airy flute; piano remains the main voice.
                voice = 3 if 32 <= bar < 40 else 0
                note(voice, pitch, at + offset + .045, length, 56 if voice == 0 else 61)
        elif intro and bar in [2, 3, 6]:
            for offset, pitch, length in MELODY_A[bar % 8][:3]:
                note(0, pitch, at + offset, length, 45)
        elif ending and bar < 62:
            for offset, pitch, length in MELODY_A[bar % 8][:2]:
                note(0, pitch, at + offset, length * 1.4, 44)
        # Sparse high notes and quiet sustained strings open space behind the melody.
        if bar >= 16 and bar < 56 and bar % 4 in [1, 3]:
            note(4, chord[3] + 12, at + 3, .8, 43)
        if 24 <= bar < 56:
            for pitch in chord[1:4]:
                note(5, pitch, at + .1, 3.8, 26 if not busy else 31)
        if 8 <= bar < 56:
            for beat in [0, 1, 2, 3]:
                note(6, 42, at + beat + .04, .1, 16 if beat % 2 else 20)
            for beat in [1, 3]:
                note(6, 38, at + beat + .06, .15, 24 if not busy else 30)
            if busy:
                for beat in [.5, 1.5, 2.5, 3.5]:
                    note(6, 70, at + beat, .1, 18)

tempo = round(60_000_000 / BPM)
meta = [(0, b'\xff\x51\x03' + tempo.to_bytes(3, 'big')), (0, b'\xff\x58\x04\x04\x02\x18\x08')]
body = midi_track(meta) + b''.join(midi_track(t) for t in tracks)
out = ROOT / 'apricot-afternoon.mid'
out.write_bytes(b'MThd' + struct.pack('>IHHH', 6, 1, len(tracks) + 1, PPQ) + body)
(ROOT / 'score.json').write_text(json.dumps({
    'title': 'Apricot Afternoon', 'bpm': BPM, 'key': 'D major', 'bars': BARS,
    'loopSeconds': BARS * 4 * tempo / 1_000_000,
    'form': ['8-bar introduction', '16-bar theme A', '8-bar bridge', '16-bar theme B', '8-bar theme A return', '8-bar turnaround'],
    'instruments': names, 'chords': progression,
}, indent=2) + '\n')
print(out)
print('One cycle:', BARS * 4 * tempo / 1_000_000, 'seconds')
