# HORA banner: engine vs human (simple English)

Original: 300x600. Teal top band (y 0-468), white bottom band (y 469-600).
Elements: top logo (ICF), giant word "הורה" (with niqqud), 4 text lines (first one salmon), footnote, outline button, 4 sponsor logos (on WHITE).
Files: `fx.json` + `fx.rgba` (fixture, 9 boxes measured from pixels), `run.mjs` (render all sizes), `meas.mjs` (placement numbers), `out/e_*.png` (engine), `out/cmp_*.png` (engine on top, human below), `out/m_tall.png`, `out/m_wide.png`.

## 0. Biggest surprise
The two tiny human files are NOT crops. `h_320x70.gif` and `h_360x125.gif` are **3-frame animated GIFs, 2 s per frame**:
- frame 1 = the word only (320x70: word 34 px tall, 49% of height, niqqud included)
- frame 2 = the 4 text lines (2 or 3 lines after reflow) + footnote (7 px tall at 320x70)
- frame 3 = button (23-25 px tall) + ALL logos in one white strip (ICF logo moved into the sponsor row), white background for this frame

So the human drops nothing. He splits the content into time. A static engine must drop, so the priority table below matters.

## 1. Measured numbers (px, canvas height in brackets)

| Item | Human 290x350 | Engine 290x350 | Human 360x125 | Engine 360x125 | Human 320x70 | Engine 320x70 |
|---|---|---|---|---|---|---|
| Word height incl. niqqud | 74 (21%) | 88 (25%) | 66 (53%) | 60 (48%) | 34 (49%) | 34 (49%) |
| Text, px per line | ~14 | 18 | ~13 | 12.5 | ~13 (own frame) | DROPPED |
| Footnote height | 8 | 10.7 | 9 (own frame) | DROPPED | 7 (own frame) | DROPPED |
| Button height | 22 | 25 | 25 | 17 | 23 | **10** |
| Sponsor strip height / width | 16 / 272 (94% of W) | **7 / 117 (40%)** | 25 / 344 | 24 / 352 | 23 / 308 | 22 / 316 |
| Top ICF logo | 50 tall | 56 tall | in sponsor row | 40 tall | in sponsor row | 23 tall |

Other engine sizes (kept elements, word height / text px per line):
- 300x600: word 125, text 26. Same size as the original but layout is NOT the original (see bug A).
- 1200x200: word 144, text 25, button 42, all kept, but bug B.
- 728x90: word 47, button 13, text and footnote dropped, ICF logo 33 px (bigger than needed).
- 160x600: word 67 (only 42% of width 160, original word is 83% of width), text 13.8, footnote 8.1, button 10 px tall (illegible), sponsors 6 px tall (illegible).
- 300x250: word 67, text 13.9, button 15, sponsors 6 px tall.
- 120x500: word 50, text 10.4, button 7 px, sponsors 4 px tall.
- 1200x60: word 18 (30% of height!), sponsors 28 px (bigger than the word), button 5 px.

Sharpness (99th percentile edge step and share of anti-alias grey pixels on the word): engine 178 / 1.7-3.9%, human 177 / 2.8-8.4%, original 153 / 2.3%. The engine is as sharp as the human, or sharper. Niqqud (cholam dot above, kamatz dots below) is kept in every size and stays visible down to a 34 px tall word. Below ~20 px word height (1200x60) the dots turn to 1-2 grey pixels. Niqqud is not a problem; word SIZE is.

## 2. Bugs seen (all general, not specific to this banner)

A. **Text lands on the wrong colour band.** In 300x600 the 4th text line (white) and the footnote (white) fall on the white bottom band. The footnote is invisible, the 4th line is cut in half (see `out/m_tall.png`, right). Also in 290x350 and 160x600. Cause: `layoutTall` places units by free flow, and the background is just a scaled/cropped copy of the original (`render`, `SizyBg.map`), so the colour boundary and the units are not linked.

B. **Logos cut with white backing appear as white boxes on teal.** 320x70, 728x90, 1200x60, 1200x200: the sponsor logos were on white, the new background there is teal (or half teal). Looks broken (`out/cmp_320x70.png`, top). The human gives the logos their own white strip.

C. **Sponsor strip shrinks to 40% of width in tall layouts.** `layoutTall` pairs "the first logo unit" with the button in a footer row. Here the first logo unit is the 4-logo sponsor strip (aspect 14:1), so strip + button share one row and the strip becomes 7 px tall. Human: button on its own row, strip on its own row at full width.

D. **Wide layouts make logos bigger than the headline.** `layout` (wide branch): `essential` includes `logo`, so a logo strip of 28 px height is kept while the word is squeezed to 18 px (1200x60) and the button to 5 px.

E. **Button is the smallest thing in tiny sizes** (5-10 px tall at 1200x60, 320x70, 160x600, 120x500) while the human gives it 23-25 px (it is the call to action).

F. **Same-size render is not identity** (300x600). Order and gaps change, word grows 118 -> 125 px. A render at nearly the original aspect should preserve the original order and band positions.

G. **Static output cannot copy the animated human files.** Option: for H <= 130 px or aspect >= 4:1, export a 3-frame GIF (see fix 7).

## 3. Ranked general fixes (with function names)

All diffs are proposals, not applied. Line numbers are as of today's engine.js.

### Fix 1 (highest): backing chip when original background differs from new background (bugs A, B)
Where: `buildScene` (compute `u.bg`) and `render` (draw chip before leaves).

```diff
 // buildScene, after units are built, per unit u:
+u.bg = medianBg(cropImg(sc.plate, u.x, u.y, u.x + u.w, u.y + u.h), 1); // [r,g,b] of the ORIGINAL local background
```
```diff
 // render(), after bg is composed and BEFORE the leaf loop. pl = autoplace(...)
+const lum = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
+const byUnit = new Map();
+for (const [leaf, x, y, w, h] of pl) { const u = leaf.unit; if (!u || !u.bg || u.role === 'hero') continue;
+  const g = byUnit.get(u) || [1e9, 1e9, -1e9, -1e9]; g[0] = Math.min(g[0], x); g[1] = Math.min(g[1], y); g[2] = Math.max(g[2], x + w); g[3] = Math.max(g[3], y + h); byUnit.set(u, g); }
+// merge neighbours with the same u.bg into one strip (sponsors become ONE strip, not 4 boxes)
+for (const [u, [x0, y0, x1, y1]] of byUnit) {
+  const cx = Math.round(((x0 + x1) / 2) * K), cy = Math.round(((y0 + y1) / 2) * K);
+  const here = bg.d.subarray((cy * Wk + cx) * 3, (cy * Wk + cx) * 3 + 3);   // new local bg
+  if (Math.abs(lum(here) - lum(u.bg)) < 60) continue;                       // same band: nothing to do
+  const pad = Math.max(3, 0.25 * (y1 - y0)), r = Math.min(pad * 1.5, (y1 - y0 + 2 * pad) / 2);
+  fillRoundRect(out, Wk, Hk, (x0 - pad) * K, (y0 - pad) * K, (x1 + pad) * K, (y1 + pad) * K, r * K, u.bg); }
```
Notes: `leaf.unit` back-pointer may need adding in `buildScene` (check name). `fillRoundRect` is a new 10-line helper. For wide sizes, extend the chip to full width ("white footer strip") when the chip covers >60% of the width. The 4 sponsors must be ONE unit in `buildScene` (group g4 already says so; unit 4 in `meas.mjs` confirms). This one fix removes the ghost footnote, the half-cut 4th line (it gets a teal chip), and the white boxes on teal.

### Fix 2: band-aware tall layout (bug A, F), the "real" version of fix 1
Where: `layoutTall`. Detect bands once in `buildScene`: row-wise median colour of `sc.plate`, split where colour distance > 90 for > 6 rows. Give each unit `u.band`. In `layoutTall`, place band 0 units inside `[m, bandEnd*H]`, band 1 units inside `[bandEnd*H, H-m]`, where `bandEnd = origBandEnd/sc.H`. Same for `layout` in wide mode: if the band layout cannot fit, use fix 1 chips.
```diff
-let y = m + Math.max(0, (ah - used) / 2);
+const bands = [...new Set(list.map(({u}) => u.band || 0))].sort();
+// run the existing flow once per band with its own [y0,y1] window (ah, yb, gap recomputed per band)
```

### Fix 3: do not pair the logo with the button when the logo is a strip (bug C)
Where: `layoutTall`, the `foot` block.
```diff
-const lg = units.find(u => u.kids.some(k => k.role === 'logo') && !u.cards && !fine.includes(u) && rankOf(u, sh, false) >= 0), bt = ...
+const lg = units.find(u => u.kids.some(k => k.role === 'logo') && !u.cards && !fine.includes(u) && rankOf(u, sh, false) >= 0 && u.w / u.h < 4), bt = ...
```
A strip (aspect >= 4) goes into `list` as its own full-width row. Also in `list.map(... cap ...)` give a logo strip `cap = 1.6` (so strips reach ~aw wide, human used 94% of width).

### Fix 4: priority order in wide/tiny sizes: headline > button > brand strip (bugs D, E)
Where: `layout`, wide branch (`essential`, `solveS`).
```diff
-const essential = u => u.kids.some(k => ['headline', 'button', 'logo', 'brand'].includes(k.role));
+const essential = u => u.kids.some(k => ['headline', 'button'].includes(k.role));
+// logos/brand: keep one strip, but never taller than 0.55 * headline height, and drop it first when H < 70
+const logoCapH = hero ? 0 : 0.55 * Math.max(...tx.filter(u => u.role === 'headline').map(u => u.h * sv)); 
```
And a button floor: `buttonH >= max(18, 0.28*H)` for H <= 130 (human: 23-25 px at H 70-125); if it does not fit, drop the top logo and sponsors before shrinking the button.

### Fix 5: lower the tiny-text drop for one-line fine print (bug: footnote lost at 360x125)
Where: `dropTiny` (and the wide `minTextH * sv < 5.5` test). Human kept a 7 px footnote.
```diff
-return pl.filter(e => !(e[0].text && ['caption','body','subheadline'].includes(e[0].role) && e[4] / Math.max(1, (e[0].lines || [1]).length) < 7.5));
+const keepMin = e => (e[0].role === 'caption' && (e[0].lines || [1]).length === 1) ? 6.5 : 7.5;
+return pl.filter(e => !(e[0].text && [...] && e[4] / Math.max(1, (e[0].lines || [1]).length) < keepMin(e)));
```
Low priority: the footnote is legal text, usually dropped last-minute anyway; only do it if there is free space.

### Fix 6: near-original aspect = keep original order and proportions (bug F)
Where: `autoplaceRules0` start. If `|log((W/H)/(sc.W/sc.H))| < 0.6` (290x350 vs 300x600 is 0.73, 300x600 itself is 0), skip `layoutTall` flow and use the original y order with a uniform vertical squeeze: `y' = y * H/sc.H`, `scale = min(W/sc.W, H/sc.H * 1.15)`, word width capped at 0.85 W. At 300x600 this reproduces the original exactly (it is the easy regression test: output must equal input). Human 290x350 is exactly this: same order, ICF logo top, button then sponsors at the bottom, gaps squeezed.

### Fix 7: animated GIF for very small sizes (bug G)
Where: new `renderFrames(sc, W, H, K)` next to `render`; UI picks it when `H <= 130 || W/H >= 4`. Frames, 2 s each (as the human did): (1) headline [+ top logo if room]; (2) subheadline/body + caption; (3) button + all logos strip on a chip (fix 1). Each frame is just `render` with a `keep` filter on roles. Cheap: `autoplace` already returns per-leaf rows, so filter by `leaf.role`. GIF encoder is the only new code.

### Fix 8 (small): niqqud-safe heights
Do not shrink a headline box so the lower niqqud dots are clipped: in `render` text sharpen step A = 0.55 is fine, but for words whose box includes marks below the baseline (`headline` with niqqud), keep at least 1 px of padding below (`th + 1`). We saw no clipping in this banner; this is a guard only. Also the sharpen step could be lowered to A=0.4 when `tw/L.lw > 0.8` (near 1:1) to keep the original 2.3% grey-pixel look; no visible gain, skip unless needed.

## 4. What to keep at each aspect ratio (priority table)
Priority 1 = never drop, 5 = drop first. "px" = minimum height to keep; if it cannot reach it, drop the item.

| Aspect (W:H) | Example | Keep, in order | Drop | Min px |
|---|---|---|---|---|
| Tall <= 0.4 | 120x500, 160x600 | 1 word (full width, 80%+) 2 button (own row) 3 text 4 sponsors strip (own row, full width) 5 top logo, then footnote | footnote if text < 7 px | word >= 0.8W; button >= 22; text line >= 10; strip >= 12 |
| Tall 0.4-0.9 | 300x600, 290x350 | everything, original order, band colours kept | nothing | text line >= 12; footnote >= 7; strip >= 14; button >= 22 |
| Square-ish 0.9-1.6 | 300x250 | 1 word 2 text 3 button 4 sponsors strip 5 top logo | top logo, footnote | word >= 0.28H; text line >= 11 |
| Wide 1.6-4 | 360x125, 728x90 | 1 word 2 button 3 sponsors strip (white chip) 4 text (if >= 11 px/line) | top logo (merge ICF into strip), footnote, text under 11 px | word >= 0.4H; button >= 0.22H and >= 18 |
| Strip >= 4 and H <= 70 | 320x70, 1200x60 | 1 word 2 button 3 sponsors strip. Or 3 animated frames (fix 7) | text, footnote, top logo | word >= 0.45H; button >= 18; strip >= 14. At H=60 only word+button (strip does not fit) |

Reasons: the word is the hook, the button is the action, the sponsor strip is required by the client but is the first to go when space runs out; the human moved the ICF top logo INTO the sponsor strip at small sizes (one strip, one chip, fewer objects). Body text needs ~11-13 px per line to read (human: 13-14 px); footnote 7-9 px is allowed only when there is spare room.

## 5. Regression checks to run after fixes
1. `node bench/exemplars/hora/run.mjs` and compare `out/e_300x600.png` to `orig_300x600.jpg` (should match).
2. No white-on-white (min contrast between text colour and local bg >= 3) in all 10 sizes.
3. Sponsor strip height >= 12 px in every size that keeps it.
4. Run `npm test`, `npx tsc --noEmit`, and the stress sets (`bench/gen_stress1..4.py`).
