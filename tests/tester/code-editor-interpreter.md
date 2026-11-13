# Code editor and interpreter
Code: `js/lang/*` (interpreter, gate, errors, stdlib, codeWords), `js/ui/editor.js`, `errorText.js`, `config/aliases.json`.

- [ ] `while(true){}`, `for(;;){}`, recursion with no end: the game stays responsive, ⏹ stops it, and the error is clear.
- [ ] Syntax errors (missing `)`, `}`, `;`, typo in a keyword): an Armenian message pointing to the right line.
- [ ] Runtime errors: unknown command, wrong case (`Tnkel()`), wrong argument type, `undefined`/`null` used: clear Armenian messages.
- [ ] Armenian names, every old spelling in `aliases.json`, and the hidden English names all work.
- [ ] Locked JS features (variables, lists, functions, objects, import…) give the "not researched yet" message until researched.
- [ ] Linter: `f;`, `if (f)`, `if (x = 1)`, comparing a game value with text all warn without stopping a good program.
- [ ] Several code tabs: create, rename, delete, `import` between tabs; deleting the running tab.
- [ ] ⏸ ⏭ ⏹ and the step debugger: pressed once, each works the first time while a program runs.
- [ ] Autocomplete shows only unlocked words. Undo/redo work. Very long code (2000 lines) doesn't freeze.
- [ ] Code words for the leaderboard count once per normalized fingerprint.
