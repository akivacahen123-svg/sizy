# Yachin banner: engine vs human designer

Original: `orig_1200x300.jpg` (red banner, product photo on the right).
Human sizes: 1200x200, 1200x60, 120x500, 320x320. (`h_1200x60b.jpg` is a different campaign, "Hora", so I did not compare it.)
Engine run: `node run.mjs` (reads `fx.json` + `fx.rgba`). Output is in `out/`.
Pictures to look at: `sheet_wide.png`, `sheet_hv.png`, `sheet_other.png`, `sheet_728.png` (first run), `sheet_v1_*.png` and `sheet_v2_*.png` (variants), `zoom_hero.png`.

## What I ran
| File | What it is |
|---|---|
| `fx.json` | Main fixture. Boxes drawn by me, like Gemini would: sub, headline (one box), kosher badge, button, logo, tagline, hero photo, corner mark. Headline, badge, sub and button are all in group g1, logo and tagline in g2. |
| `fx_v1.json` | Same, but badge and button have no group. Test only. |
| (variants use the same `fx.rgba`) | copy it to `fx_v1.rgba` / `fx_v2.rgba` to rerun them |
| `fx_v2.json` | Same as v1, but the headline is cut in two boxes (so the badge is not inside a headline box). Test only. |
| `out/*.png` | Main run: 1200x200, 1200x60, 120x500, 320x320, 300x250, 300x600, 728x90, 160x600. |
| `out/v1_*`, `out/v2_*` | Same sizes for the variants. |

## Main finding in one line
With the fixture as Gemini would likely give it, the engine is clearly worse than the human on every size except 1200x200. The two biggest causes are general, not specific to this banner: (1) text units that contain a badge or button are never re-flowed, so text stays tiny in tall and small sizes; (2) the hero photo is only ever shrunk to fit (never cropped, never bleeding to the edge), so it takes 10-20% of the canvas where the human uses 43-47%.

## Measured numbers (human vs engine)
"Photo share" = share of canvas that is photo (not red, not white), measured by pixel colour. "Headline line height" = height of one white headline line in pixels.

| Size | Photo share human / engine | Headline line height human / engine (main) / engine (v1) | Notes |
|---|---|---|---|
| 1200x200 | 47% / 28% | 50 and 41 / 50 and 42 / 62 and 51 | Human photo is 560 wide and touches the right, top and bottom edges. Engine photo is 355x190, floats 5px inside the canvas, 30% of the width. |
| 1200x60 | 22% / 9% | 35 (one line, 58% of height) / 10 (two tiny lines) / 28 | Human puts everything on one row. Engine main run: tiny cluster at the far right, big empty red in the middle. |
| 120x500 | 43% / 10% | 17,15,15 (3 lines, 85% of width) / 6 (tiny, 60% of width) / 18,16,15 | v1 is almost the same as human for text. Photo is the problem: engine 108x58, human three product shots, about 215 px tall in total. |
| 320x320 | 45% / 20% | 25 / 5-6 (5 tiny lines) / 17-19 (3 lines) | Human puts the photo on top, full width, bleeding to the edges (320x150). Engine puts a 203x109 photo low in the canvas. |
| 300x250 | n/a / 16% | n/a / 6 | Headline is 63 px wide in a 300 px canvas. Most of the canvas is empty red. |
| 300x600 | n/a / 20% | n/a / about 8 | Same. A big hole in the middle. |
| 160x600 | n/a / 11% | n/a / about 5 | Text is almost unreadable. |
| 728x90 | n/a / 22% | n/a / 14-15 | Works. But the badge has a grey blotch (see below). |

Planned sizes from `autoplace` (px, main run), 1200x200: hero 355x190 at x=842; headline 403x100; logo 112x64 (bigger than the human logo, about 85x50); corner mark moved to x=130 (middle of the canvas).

## What a client would call worse (ranked by how much it hurts)
1. Text is tiny on tall and small sizes (120x500, 320x320, 300x250, 300x600, 160x600, 1200x60). Cause: the group "headline + sub + badge + button" is never re-flowed because of the guard in `reflowUnit`. The human breaks the headline into 3 lines to fill the width. With v1 (badge and button ungrouped) the engine does the same and reaches human sizes in 120x500. So the fix is in the engine, not in the data.
2. Photo is too small and floating. In tall and square sizes it is 10-20% of the canvas vs 43-45% (human). The human re-crops the photo to the part that matters and lets it bleed to the edges. The engine only contain-fits it (`Math.min(fr*H/hero.h, aw/hero.w, 1.2)`), so a wide photo in a narrow canvas becomes a small stamp.
3. Badge destroyed (grey blotch, and gold fragments near the headline) in 1200x200, 728x90, 320x320 (v1) and all main-run sizes. Cause: the badge box sits inside the headline box (the badge is between the two headline lines). It is fixed by v2 (headline in two boxes), which shows the data-side cause, but Gemini will often draw one box. The engine must handle this.
4. 1200x60 and other very wide strips: human uses one line for the headline at 58% of the height. The engine keeps two lines, so letters are half the size and the middle of the strip is empty.
5. Hero photo edges: engine has a soft red halo on all four edges (see `zoom_hero.png`) and does not touch the canvas edge. The human photo is crisp and bleeds off the canvas with the red curve cut cleanly. Looks like a pasted sticker.
6. Corner mark (small rotated "mark" at the top-left) is moved into the middle of the canvas (x=130 in 1200x200, x=230 in 1200x60 v1). The human keeps it in a corner (top-left in 1200x200, 120x500, far right in 1200x60).
7. Small things: faint lighter ghost streak where the logo/tagline were removed from the red plate (`zoom_streak.png`, 300x250). In 1200x200 the logo is larger than in the human version while the photo is smaller (priorities are the wrong way round).
8. A real bug (v2): when the headline is two separate boxes, `reflowLeaf` cuts the second line wrongly and prints fragments ("רות", "ן") in 120x500, 320x320, 300x600, 160x600, 300x250. See `out/v2_*`.

## What the engine cannot do (not a bug)
The human sizes use new art: another photo crop (bags bigger, different kitchen), three separate product shots for 120x500, five bags for 1200x60. The engine has only the pixels of the original, so some gap is expected. But cropping the original hero to a better window is possible (fix 2).

## Ranked list of general fixes
Line numbers are for the current `public/engine.js`. The diffs are proposals, I did not apply or test them (I was told not to edit shared files). Test each on all fixtures with `node bench/bench.mjs`.

### Fix 1 (biggest): re-flow a unit that has text plus badge/button/logo
Function: `reflowUnit` (line ~775).
Problem: `if (!u.kids.every(k => k.text && [...].includes(k.role))) return u;` skips any unit with a non-text kid.
Proposed diff (idea: re-flow only the text kids, then keep the non-text kids in their original vertical order, centred):
```diff
-  if (!u.kids.every(k => k.text && ['headline', 'subheadline', 'body'].includes(k.role))) return u;
-  const heads = u.kids.filter(k => (k.role === 'headline' || ...) && wordsOf(k)); if (!heads.length) return u;
+  const FLOW = ['headline', 'subheadline', 'body'];
+  const flowKids = u.kids.filter(k => k.text && FLOW.includes(k.role));
+  if (!flowKids.length) return u;
+  const extras = u.kids.filter(k => !flowKids.includes(k) && (k.role === 'badge' || k.role === 'button' || k.role === 'logo' || k.role === 'caption'));
+  if (extras.length + flowKids.length !== u.kids.length) return u;   // unknown kid type: keep old behaviour
+  const heads = flowKids.filter(k => (k.role === 'headline' || ...) && wordsOf(k)); if (!heads.length) return u;
   ...
-  const kids = orig.map(k => { if (!heads.includes(k)) return k; ... });
+  // same map as before; non-head kids (extras) are returned unchanged
   // stacking loop below already centres every kid in width uw, so extras just join the stack
```
Also: the bh budget `u.kids.length > 1 ? 0.85 : 1` should subtract the extras' height: `bh = box[3] - sum(extras h) * s`, otherwise the headline takes the whole box and the stack overflows.
Test: 120x500 text should reach 17 px lines (human), 320x320 about 25 px.
Cheaper and safe in parallel: in `src/analyze.ts` PROMPT add "a badge or button must NOT share the group of the headline". But engine fix is better (gets old saved fixtures too).

### Fix 2: hero photo with cover-crop and bleed in tall/square sizes
Function: `layout`, non-wide branch (`plan()`, line ~1118) plus a new helper `cropLayer(hero, aspect, focus)`.
Problem: `hs = Math.min(fr * H / hero.h, aw / hero.w, 1.2)` shrinks a 560x300 photo to the canvas width. Result 108 px wide in 120x500.
Proposal: give the hero a target box (full canvas width, `fr*H` tall, bleeding to the edges) and crop the hero layer to that aspect. Choose the crop window with the most detail (edge energy) so the bags stay in.
```diff
-      for (const fr of (hero ? [0.42, 0.34, 0.26] : [0])) {
-        const hs = hero ? Math.min(fr * H / hero.h, aw / hero.w, 1.2) : 0, hh = hero ? hero.h * hs : 0;
+      for (const fr of (hero ? [0.42, 0.34, 0.26] : [0])) {
+        const tgtW = W, tgtH = fr * H;                         // bleed: full width
+        const hs = hero ? Math.max(tgtW / hero.w, tgtH / hero.h) : 0;   // cover, not contain
+        const hh = hero ? tgtH : 0;                            // visible height after crop
```
and in the final `out.push([hero, ...])`: push a cropped copy `heroCrop = cropLayer(hero, W / hh, saliencyCentre(hero))` placed at `x=0`, `y = bottom ? H - hh : 0`.
```js
// helper (new): pick the window of aspect `a` with the most gradient energy
function saliencyCentre(L) { /* sum |dx|+|dy| of luma on a 16x16 grid -> weighted centre of mass */ }
function cropLayer(L, a, c) { /* new layer with lw = min(L.lw, L.lh*a) ; lh = lw/a ; offset so c is in the middle, clamped */ }
```
Keep the existing feather only on edges that do not touch the canvas.
Expected: photo share in 120x500 / 320x320 from 10-20% to about 40%.

### Fix 3: hero in wide sizes: bleed and bigger share
Function: `layout`, wide branch (line ~1090).
```diff
-      const s = Math.min((H - m) / hero.h, W * 0.32 / hero.w, 1.2), hw = hero.w * s, hh = hero.h * s;
-      const hx = right ? W - hw - m * 0.3 : m * 0.3;
-      out.push([hero, hx, (H - hh) / 2, hw, hh]);
+      // if the hero touched the canvas edges in the source, it keeps touching them
+      const bleedV = hero.y <= 2 && hero.y + hero.h >= sh - 2;
+      const s = Math.min((bleedV ? H : H - m) / hero.h, W * 0.40 / hero.w, 1.4), hw = hero.w * s, hh = hero.h * s;
+      const hx = right ? W - hw : 0;     // flush, no margin
+      out.push([hero, hx, bleedV ? 0 : (H - hh) / 2, hw, hh]);
```
For 1200x200 the human photo is 47% of the width. Allow `W * 0.47` when the text still fits at scale >= 0.9 of its best scale (try 0.32, 0.40, 0.47 and keep the largest that keeps text height within 10% of the best).

### Fix 4: very wide strips (W/H >= 5): headline on one line
Function: `reflowUnit`, call `reflowLeaf(k, bw, bh, ...)` (line ~783). For `W / H >= 5` pass a line budget of 1 line (merge the lines using `phrases` or the word list), so `reflowLeaf` is asked for one row of height `0.58 * H`.
```diff
-    const L2 = reflowLeaf(k, bw, ..., wide ? 0.09 : ...);
+    const strip = W / H >= 5;
+    const L2 = reflowLeaf(k, strip ? W * 0.5 : bw, strip ? H * 0.62 : ..., strip ? 0 : ..., strip ? 1 /*maxLines*/ : undefined);
```
(`reflowLeaf` needs an optional `maxLines`). Then `sub` + `headline` can sit on one row like the human 1200x60 ("חדש מיכין! ירקות ...").

### Fix 5: do not take a badge's pixels as headline ink
Function: `buildScene` text loop (line ~898) and `textLayer` (line ~391).
Problem: `blocked()` is used only for the side/below extension, not for the main window.
```diff
-    const others = els.filter(o => o !== e).map(o => o.px);
+    const others = els.filter(o => o !== e).map(o => (o.text ? o.px : Object.assign(o.px.slice(), { solid: true })));
```
```diff
   // in textLayer, right after win is built
+  for (const o of (others || [])) if (o.solid) for (let yy = Math.max(0, o[1] - y0); yy < Math.min(ch, o[1] + o[3] - y0); yy++) for (let xx = Math.max(0, o[0] - x0); xx < Math.min(cw, o[0] + o[2] - x0); xx++) win[yy * cw + xx] = 0;
```
Careful: only when the non-text box lies mostly inside this text box (more than 60% of its area), so a normal text box next to a photo is unchanged. Also do the same for `inner`, or the inner median colour will include gold.

### Fix 6: keep corner marks in their corner
Function: `buildScene` (unit creation, line ~979) and `autoplaceRules0` pin logic. A small `decor` / `brand` element (area < 1.5% of the canvas) whose box is within 6% of an edge gets `pin = 'corner'` with the source corner (tl/tr/bl/br); place it at that corner of every output, size = `min(source size, 0.12 * min(W,H) * ratio)`, outside the layout (no space is taken from other units). Today `pin` supports only top/bottom.

### Fix 7: `reflowLeaf` garbles a second headline line (bug)
Repro: `fx_v2.json`, size 120x500. Likely the word cut for a box that holds a single line whose width is less than the new box (the glyph clusters are cut by gap, not by the known `lines` text). Add a guard: if `wordsOf(k).length` does not match `k.lines.join(' ').split(' ').length`, return null (keep the unflowed layer) instead of a wrong cut. Run on `fx_v2.json` to check.

### Fix 8 (small): priorities in wide layout
In the wide branch the logo can be bigger than in the human version while the photo is smaller. After fixes 3 and 1, cap logo height at `0.42 * H` in `layout` (`put`) when the hero is smaller than 40% of the width.

### Fix 9 (small): ghost streak
After `msFill` for the plate (line ~941), the lighter streak left of the logo comes from the soft plate fill. Use `softenDenseHoles` only when the hole area is more than 4% of the canvas, or run a second pass that matches the median colour of the ring.

## Order I would do them in
Fix 1 (all tall/square/small sizes), Fix 2 (tall/square), Fix 5 (badge looks broken), Fix 3 + 4 (wide strips), Fix 6, then 7-9.
After each: run `node bench/bench.mjs bench/exemplars/<campaign> out` on tzfat, yachin and the stress sets, and look at the sheets. Success on this banner: photo share >= 40% in 120x500 and 320x320, headline line >= 15 px in 120x500, >= 22 px in 320x320, >= 30 px in 1200x60, badge intact everywhere.
