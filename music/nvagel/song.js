// Little Orchard Waltz — an original eight-bar piano example for the game editor.
// Requires Music and the code cards leading to it. Change bpm to set the tempo.
let bpm = 100;
let song = [
  [["C3", "E4", "G4"], 1], ["G4", 0.5], ["E4", 0.5], ["C5", 1],
  [["A2", "C4", "E4"], 1], ["E4", 0.5], ["A4", 0.5], ["B4", 1],
  [["F3", "A3", "C4"], 1], ["A4", 0.5], ["G4", 0.5], ["E4", 1],
  [["G2", "B3", "D4"], 1], ["D4", 0.5], ["G4", 0.5], ["B4", 1],
  [["C3", "E4", "G4"], 1], ["C5", 0.5], ["B4", 0.5], ["G4", 1],
  [["A2", "C4", "E4"], 1], ["A4", 0.5], ["G4", 0.5], ["E4", 1],
  [["F3", "A3", "C4"], 1], ["F4", 0.5], ["D4", 0.5], [["G2", "B3", "D4"], 1],
  [["C3", "E4", "G4", "C5"], 3],
];
for (let part of song) {
  nvagel(part[0], part[1], bpm);
}
