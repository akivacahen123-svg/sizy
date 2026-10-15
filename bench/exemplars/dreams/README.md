# dreams (הגרלת החלומות) - real client banner that exposed big failures

- `orig_800x600.jpg` original. `bad_300x600.png` = what the live site produced with REAL Gemini boxes (screenshot of the user).
- `fx.json` + `fx.rgba` = my hand-made approximation of Gemini boxes (headline boxes are TIGHT to the text so the black gold-framed panel stays in the plate, exactly like the real run). It is an approximation, so also look at bad_300x600.png.
- `node run.mjs [sizes]` renders to out/*.rgba, `python3 png.py [sizes]` converts to png (out/ is gitignored).
- Known failures (see lead analysis): (1) photographic background: the engine removes the man and stretches the plate -> smears; (2) panel behind headline falls apart into black ragged blobs; (3) rectangles with original background around man, button, prize strip look like stickers; (4) prize strip text < 9px; (5) QA does not notice any of this.

## Root cause of the "catastrophic 300x600" with fx.json (fixed)
`fx.json` boxes were written as percent (0-100) but the engine reads 0-1000 (`cleanElements` output), so every element was 10x too small/misplaced. Boxes are now x10. `run.mjs` also resolves paths relative to the repo it is in (it used to import the main checkout).

## REFRAME strategy (engine.js, section "REFRAME")
For a photographic background with a rectangular hero that is part of the photo (plate: >=40% textured 8x8 blocks, <=10% flat blocks), the engine does not remove the hero. It picks a cover window of the ORIGINAL pixels (zoom and sky/floor padding allowed, <=42% padding), keeps the hero whole (or cut by the canvas edge in strips, face always whole), re-lays out the other units outside the hero rectangle (stack above/below, or a column beside), or keeps everything as is ("native") when the size is close to the original. A dark panel behind the headline is cut from the original as one rigid rounded piece. Plate holes of moved units are filled (msFill + PatchMatch). Choice among candidates = score (headline area, CTA, hero, padding, uncovered filled holes). Flat/illustration banners never enter this path (gate unchanged).
Limits: first reframed size per scene costs ~2s (hole fill); the editor (`placements`/`exportScene`) does not know the reframe background yet; very thin strips (1200x60, 895x80) still use the old method; large filled holes can still look like soft blur when the window must contain them.
