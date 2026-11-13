# What the teacher decides (learned from `test-reports/decisions.json`)

Read this before testing, before writing suggestions and before proposing ideas. Update it after each round of decisions: add what the new decisions teach, and change any line a decision contradicts. Last update: 2026-11-12 (android + portrait reports, 40 decisions).

## Testing focus
- **Portrait phones matter most.** The Android app is portrait only (commit 8df0923). The teacher rejected every landscape bug and suggestion (storage tab in landscape, ranch button at 800×360, landscape typing, landscape keyboard bars) and tablets side by side. Test landscape only for crashes or freezes; don't report its layout as HIGH.
- **Common Android widths first:** 360, 390–412, then 320. A bug that blocks a tap at 360 was approved as HIGH.
- **Toasts must not disturb.** Notes: "make the toasts less disturbing". Every toast-covers-something bug was approved.
- **Tabs must look like the game's other tabs.** Note on the loom: "make this ui better like other tabs in the game". For tabs that don't fit: "maybe add slide" (a sideways-scrolling row) rather than tiny text.
- **Text cut, English words or overflow on phones:** always approved, even LOW.
- **Android app store work is wanted; web-app (PWA) store pieces were not.** Rejected: manifest, maskable icons, assetlinks, offline page for the website. Approved: the native app's icon, splash and signing. Note: "make the background icon as good as possible to make it clickable like other games are doing". For the icon, use the real pictures (Bridgy) and make it look like a polished mobile-game icon.
- **Touch-target size:** rejected twice as a general rule (android B10, S9), approved once as "main control buttons at least 40 px on phones" (portrait S2). Report only the buttons a student taps all the time, with numbers. Don't send one list of every small button.

## Coming changes (don't fight them)
- **The start of the game will become a tutorial** (teacher, 2026-11-12). Login news should show within the first 10 minutes of play, not all at the start. Don't polish the current first-minutes flow; report only real bugs there.

## Ideas
- **Approved:** a playful teaching puzzle (fix Bridgy's broken program of the day: reading and debugging code) and a small delight that is creative (the drone plays music with arrays of notes).
- **Rejected:** new data-reading commands (a weather forecast list, reading village requests as objects) and a ghost race in the weekly challenge.
- **So:** prefer fun, creative things a child can make or fix, and teaching through play. Avoid "another command that returns data" and competitive add-ons to existing systems.
