# dreams (הגרלת החלומות) - real client banner that exposed big failures

- `orig_800x600.jpg` original. `bad_300x600.png` = what the live site produced with REAL Gemini boxes (screenshot of the user).
- `fx.json` + `fx.rgba` = my hand-made approximation of Gemini boxes (headline boxes are TIGHT to the text so the black gold-framed panel stays in the plate, exactly like the real run). It is an approximation, so also look at bad_300x600.png.
- `node run.mjs [sizes]` renders to out/*.rgba, `python3 png.py [sizes]` converts to png (out/ is gitignored).
- Known failures (see lead analysis): (1) photographic background: the engine removes the man and stretches the plate -> smears; (2) panel behind headline falls apart into black ragged blobs; (3) rectangles with original background around man, button, prize strip look like stickers; (4) prize strip text < 9px; (5) QA does not notice any of this.
