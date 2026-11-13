"""Render nvagel's small piano sample bank using FluidSynth and GeneralUser GS.

Usage: python3 music/nvagel/render.py /path/to/GeneralUser-GS.sf2
Only the rendered MP3 is shipped. The sound bank license is retained alongside
the background score in music/apricot-afternoon/GeneralUser-GS-LICENSE.txt.
"""
from pathlib import Path
import argparse
import struct
import subprocess
import tempfile


def vlq(value):
    result = [value & 127]
    while value > 127:
        value >>= 7
        result.insert(0, (value & 127) | 128)
    return bytes(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('soundfont', type=Path)
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[2] / 'assets/audio/nvagel-piano.mp3'
    # Eight six-second slots, C1 to C8. The nearest sample is at most six
    # semitones away, so the full A0-C8 keyboard keeps its natural timbre.
    events = [(0, b'\xff\x51\x03\x07\xa1\x20'), (0, b'\xc0\x00')]
    for index, pitch in enumerate(range(24, 109, 12)):
        events.append((index * 12000, bytes([0x90, pitch, 80])))
        events.append((index * 12000 + 10000, bytes([0x80, pitch, 0])))
    events.append((96000, b'\xff\x2f\x00'))
    track = bytearray()
    previous = 0
    for tick, message in sorted(events, key=lambda event: event[0]):
        track += vlq(tick - previous) + message
        previous = tick
    midi = b'MThd' + struct.pack('>IHHH', 6, 0, 1, 1000)
    midi += b'MTrk' + struct.pack('>I', len(track)) + track
    with tempfile.TemporaryDirectory(prefix='bridgy-piano-') as directory:
        directory = Path(directory)
        (directory / 'piano.mid').write_bytes(midi)
        subprocess.run([
            'fluidsynth', '-ni', '-g', '0.8', '-r', '32000',
            '-o', 'synth.reverb.active=0', '-o', 'synth.chorus.active=0',
            '-F', str(directory / 'piano.wav'), str(args.soundfont), str(directory / 'piano.mid'),
        ], check=True)
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-i', str(directory / 'piano.wav'), '-t', '48', '-ac', '1',
            '-af', 'highpass=f=30,lowpass=f=10000,volume=4,alimiter=limit=0.9:level=false:latency=true',
            '-ar', '32000', '-codec:a', 'libmp3lame', '-b:a', '64k', str(output),
        ], check=True)
    print(f'{output}: {output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
