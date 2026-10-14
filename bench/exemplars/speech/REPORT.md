# Speech campaign: engine vs human (report)

Original: 720x1040, navy background. Elements: logo, 3-line headline, red button 1 ("רוצה להגשים חלום?"), 4-line body, red button 2 ("לפרטים"), URL.
Human sizes: 720x250 and 640x640. Engine sizes: those two plus 1200x200, 728x90, 300x600, 300x250, 160x600, 320x70, 1200x60.

## Files
- `fx.json`, `fx.rgba` : engine fixture, 6 elements, all `group: null` (every element alone). `fx_grouped.json` : same boxes, but logo+headline in one group and button2+URL in one group (see finding 6).
- `out/engine_<WxH>.png` : engine output with the current `public/engine.js`. `out/grouped/` : same, with `fx_grouped.json`.
- `out/cmp_720x250.png`, `out/cmp_640x640.png` : engine (left) next to human (right). `out/sheet_tall.png`, `out/sheet_wide.png` : the other sizes.
- `out/proposed/` : outputs with the proposed fixes 1-4 applied to a COPY of the engine. `out/proposed_engine.diff` : the exact diff against `public/engine.js`. `public/engine.js` was not touched.
- `out/run.mjs <fx.json> <outdir> [engine.js path]` and `out/topng.py <outdir>` : how the PNGs were made.

## What the human did (measured on the pixels)
Scale = human size / original size (ink bands, 1.0 = same pixel size as in the 720x1040 original).

| Item | Original | Human 640x640 | Scale | Human 720x250 | Scale |
|---|---|---|---|---|---|
| Logo | 291x84 | 215x62 | 0.74 | ~147x34 | 0.50 |
| Headline line height (ink band) | 51 | 39 (2 lines) | 0.76 | 36 (1 line, 623 px wide = 86% of width) | 0.70 |
| Button 1 | 575x90 | 431x67 | 0.75 | DROPPED | - |
| Body | 4 lines, 31 px each | 1 line (text shortened), 29 px | 0.94 | DROPPED | - |
| Button 2 | 271x90 | 219x72 | 0.81 | ~161x54 | 0.59 |
| URL | 183x31 | DROPPED | - | DROPPED | - |

Human rules: headline is always the biggest thing (about 0.7-0.76 of original). Text and buttons all keep a similar scale. At 640x640 the body is cut from 4 lines to 1. At 2.9:1 only logo + headline + ONE button remain, and the button kept is the final call to action ("לפרטים"), not the question button. Layout is rows: headline on top, logo and button side by side below, all centred. Margins are big (about 15-25% of height empty above and below).

## What the engine did (current code, fx.json)
Scale = sqrt(placed area / original area).

| Size | Dropped | Logo | Headline | Button 1 | Body | Button 2 | URL |
|---|---|---|---|---|---|---|---|
| 720x250 | none | 0.47 | 0.46 (3 lines, 203 wide) | 0.47 | 0.47 | 0.47 | 0.47 |
| 640x640 | none | 0.78 | 0.74 | 0.42 | 0.60 | 0.42 | 1.50 |
| 1200x200 | none | 0.64 | 0.63 | 0.64 | 0.64 | 0.64 | 0.64 |
| 728x90 | none | 0.30 | 0.37 | 0.30 | 0.30 | 0.48 | 0.30 |
| 300x600 | none | 0.44 | 0.64 | 0.31 | 0.48 | 0.46 | 0.75 |
| 300x250 | none | 0.31 | 0.30 | 0.16 | 0.22 | 0.15 | 0.77 |
| 160x600 | none | 0.33 | 0.48 | 0.24 | 0.43 | 0.50 | 0.40 |
| 320x70 | URL | 0.19 | 0.18 | 0.19 | 0.19 | 0.19 | gone |
| 1200x60 | none | 0.28 | 0.42 | 0.44 | 0.28 | 0.28 | 0.46 |

Text height in px on the tiny sizes (body line = box height / 4): 728x90 body about 13 px/line but headline about 16 px/line, button text about 7 px. 1200x60: body is clipped at the bottom edge and the plate shows a smudge. 300x250: headline 0.30, URL 0.77, body 0.22.

## Findings (what is kept / dropped, and what looks wrong)
1. BUG, letter missing (yod). The headline shows "כמה פעמ ם" and a grey blob stays in the background plate (see `out/cmp_*.png`, the blob is also in every size at the same spot). Cause in `textLayer`: ink components are only kept if they touch the middle band (15%-85% of the AI box height). The "י" of "פעמים" is a small separate piece at the top of line 1 (y 197-222, band starts y 226). It is neither copied nor erased. This hits every Hebrew headline with yod, dots, niqqud, quotation marks, "?" dots. Reproduced in all 9 sizes.
2. Hierarchy flips on square/medium sizes. With `fx.json` the body is placed at 0.60 and the URL at 1.50 (bigger than the original!) while buttons shrink to 0.42. Human: headline 0.76, everything else 0.75-0.94. Cause: `layoutTall` first grows every unit to `min(aw/u.w, cap)` (narrow units like the URL grow the most), then shrinks everything with the same factor. Also the fine-print branch uses `s0 = max(aw/q.w)` (the NARROWEST unit) so the URL gets `min(.., 1.5, 0.8*s0)` = 1.5x.
3. Wide sizes keep too much. At 720x250, 1200x200, 728x90, 320x70, 1200x60 nothing is dropped except the URL at 320x70. Human keeps logo + headline + one button. The engine fills 4 columns, so every text shrinks to 0.15-0.30 (about 6-8 px, unreadable). `layout` only drops units whose text would be under 5.5 px, and it treats every button as essential.
4. Two buttons. Human keeps the last (lowest) button for wide, both for square. Engine keeps both always.
5. Wide layout shape. Human puts the headline on ONE line across 86% of the width and the logo/button under it. Engine wraps the headline in a narrow column (`reflowUnit` with `bw = W*0.46` when wide) so it is 3 lines at 0.46 scale.
6. Grouping matters a lot. With `fx_grouped.json` (logo+headline merged, button2+URL merged) the engine scales each group as one block: at 640x640 headline 0.38, body 1.00, logo 0.38 (see `out/grouped/`). The same banner looks good or bad depending on how Gemini groups. Rule of thumb: never merge a logo with a headline, or a button with fine print, into one scaled block (or at least re-balance after).
7. Sharpness: text and logo are good (crisp, cut from pixels, no halo). The logo box edge has a faint grey line at about 0.3-0.4 scale (see 640x640 engine). Buttons are crisp. No sharpness problem found.
8. Margins: engine fills the whole canvas (1200x60 headline touches both edges, 300x250 headline touches the top). Human leaves 10-25% empty. `enforceBans` keeps only 2% margin.
9. Human rewrote the body text (one short line). Engine cannot retype, but it could keep only the FIRST line of a multi-line body (cut from pixels). Idea 7 below.

## Ranked general fixes
Fixes 1-4 were applied to a copy of the engine and the speech outputs checked (`out/proposed/`). They were NOT yet run on the other benches (`bench/bench.mjs`, stress sets). Run those before merging.

### 1. Keep floating marks inside the AI box (`textLayer`) - bug, high impact
Add before the `if (extSide)` block. Result: headline reads "כמה פעמים" and the blob in the plate disappears (`out/proposed/engine_640x640.png`).
```diff
+  { // marks (yod, dots, niqqud) whose centre is inside the AI box but outside the 15%-85% band
+    const bb2 = new Map();
+    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) { const i = yy * cw + xx, id = lab[i]; if (id > 0 && ink[i]) { let b = bb2.get(id); if (!b) { b = [xx, yy, xx, yy, 0]; bb2.set(id, b); } b[0] = Math.min(b[0], xx); b[1] = Math.min(b[1], yy); b[2] = Math.max(b[2], xx); b[3] = Math.max(b[3], yy); b[4]++; } }
+    for (const [id, b] of bb2) { if (keepIds.has(id) || b[4] < 4) continue; const mx = (b[0] + b[2]) / 2 + x0, my = (b[1] + b[3]) / 2 + y0; if (mx >= x && mx < x + w && my >= y && my < y + h) keepIds.add(id); }
+  }
   if (extSide) { // מילים וסימנים ...
```
(The `bb` map in the `extSide` block can be hoisted and shared.)

### 2. Fine print never bigger than the content (`layoutTall`)
```diff
-  const s0 = Math.max(0.05, ...units.filter(q => !finePrint(q, sh) && q.role !== 'hero').map(q => aw / q.w));
+  const s0 = Math.max(0.05, Math.min(1, ...units.filter(q => !finePrint(q, sh) && q.role !== 'hero' && q.kids.some(k => k.text && ['headline', 'body', 'subheadline'].includes(k.role))).map(q => aw / q.w)));
-  ... const f0 = Math.min(aw / u.w, 1.5, 0.8 * s0) ...
+  ... const f0 = Math.min(aw / u.w, 1.0, 0.8 * s0) ...
```
Result: URL goes from 1.50 to about 0.5 at 640x640.

### 3. Hierarchy clamp (`layoutTall`, right before `const gmin = ...`)
Plain text (body, caption, subheadline) never gets a bigger scale than the headline:
```diff
+  { const hi = list.findIndex(({ u }) => rank(u) === 0);
+    if (hi >= 0) f = f.map((v, i) => (i === hi || list[i].u.cards || list[i].u.kids.some(k => ['button', 'logo', 'brand', 'photo'].includes(k.role))) ? v : Math.min(v, f[hi])); }
   const gmin = Math.max(5, H * 0.025), nGap = ...
```
Small effect alone on this banner (body was already below the headline once fix 2 is in) but it protects other banners.

### 4. Wide: one button, and drop what would be too small (`layout`, wide drop loop)
```diff
-    const essential = u => u.kids.some(k => ['headline', 'button', 'logo', 'brand'].includes(k.role));
+    const btns = tx.filter(u => u.kids.some(k => k.role === 'button')), lastBtn = btns.length ? btns.reduce((p, q) => (q.y > p.y ? q : p)) : null;
+    const essential = u => u.kids.some(k => ['headline', 'logo', 'brand'].includes(k.role)) || (lastBtn && u === lastBtn);
 ...
-      const sv = solveS(tx), bad = tx.filter(u => !essential(u) && minTextH(u) * sv < 5.5).sort(...)
+      const sv = solveS(tx), bad = tx.filter(u => !essential(u) && (minTextH(u) * sv < 5.5 || sv < 0.62)).sort(...)
```
Result: 728x90, 320x70 and 1200x60 become headline + button + logo, very close to the human style (`out/proposed/engine_728x90.png` etc.). 720x250 and 1200x200 still keep button 1 and the body because `sv` stays above 0.62 there; raise the threshold to about 0.7 or add idea 5 below.

### 5. (not built) Stacked wide layout for aspect 2-4:1
New `layoutWideStack(W,H,units)`: if there are at most 2 headline lines of text, put the headline on ONE line (re-wrap with `reflowLeaf(k, W*0.86, H*0.4)`), logo and last button side by side in a row below, both centred, gap = 0.5 x button height, outer margin 12% of H. Choose it in `autoplaceRules0` the way `mid` picks tall vs wide today: compare covered area, but prefer the stack when the headline line height is bigger (larger text wins). This is the human 720x250.

### 6. (not built) Drop by priority when tall layout overflows (`layoutTall`, the `tot() + gmin*nGap > ah` branch)
Today it shrinks everything by the same factor. Instead, before shrinking: while the headline scale `f[hi]` would be under 0.7 x its natural fit, remove the unit with the highest drop rank, in this order: URL/finePrint, body (or cut it to its first line, see 7), button 2, button 1 (only if two buttons). Never drop headline, logo, last button. This is the human 640x640 (body cut, URL gone, headline at 0.76).
Priority table (below) is the order to use.

### 7. (not built) Keep only the first line(s) of a body
Use `lineBands(L, n)` on the body leaf to cut the text layer to its first 1-2 lines when the unit is under 0.7 x headline scale. Human did the same (kept one line).

### 8. (not built) Shrink buttons last
In the shrink loop in `layoutTall` use exponent 0.6 for `button`/`logo` units (like cards already do with `Math.pow(g, 0.6)`), so a button at 640x640 is not 0.42 while the human has 0.75-0.81. In `layoutTall` the button cap `Math.max(0.1*H, 28)/u.h` already limits height; after the shrink the button should not go below 0.6 x its cap.

### 9. (not built) Grouping guard in `buildScene` / units
After units are made, split a group that contains a logo and a headline (or a button and text with different roles and a gap above 0.25 x height) into separate units, or check `analyze` prompt so Gemini does not group them. Also keep 5-10% margins (raise the 2% in `enforceBans` to 4-5% for sizes under 100 px tall).

## Keep / drop priority per aspect ratio
1 = keep last (never drop). Higher number = drop first. "cut" = keep only first line.

| Element | Tall (under 0.5, e.g. 160x600, 300x600) | Square-ish (0.8-1.3, 640x640, 300x250 is 1.2) | Wide (1.8-4, 720x250, 1200x200, 728x90) | Very wide (over 5, 320x70, 1200x60) |
|---|---|---|---|---|
| Headline | 1 | 1 | 1 (one line if it fits) | 1 |
| Logo | 2 | 2 | 2 | 2 |
| Last button ("לפרטים") | 3 | 3 | 3 | 3 |
| Button 1 (question) | 5 (drop if headline < 0.7 scale) | 5 | 6 drop | 6 drop |
| Body | 4 (cut to 1-2 lines) | 4 (cut to 1 line, human) | 7 drop (or cut at 1200x200) | 7 drop |
| URL / fine print | 6 (keep only if there is empty space) | 7 drop (human) | 8 drop | 8 drop |

Notes: at 300x250 (1.2:1) the human would most likely do the square recipe (headline + button + one body line). Engine currently shows all six units at 0.15-0.30 scale, which is unreadable. Targets from the human: headline 0.70-0.76 of original text size, buttons 0.6-0.8, logo 0.5-0.75, empty margin 10-25%.
