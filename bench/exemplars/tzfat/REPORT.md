# Tzfat banner: engine vs. human designer

Original: 700x500. Human sizes: 361x251, 321x71, 301x601. Engine extra sizes: 728x90, 160x600, 300x250, 1200x200.

Files in this folder:
- `fx.json`, `fx.rgba`: the engine fixture (same as /tmp/jt/in.json and in.rgba; the RGBA is byte-identical to orig_700x500.png). Boxes are 0-1000 [x1,y1,x2,y2]. I drew them on the image and they fit all 13 elements (headline, subheadline, 4 circle photos, 4 captions, logo, address, button).
- `run.mjs` renders all 7 sizes into `out/`. `pl.mjs` prints where the engine puts each element.
- `out/<WxH>.png` engine results. `out/cmp_*.png` = engine (left) next to human (right). `out/plate.png` = the background after the elements were removed.
- `proposed.diff` = a tested patch (not applied to public/). `out/patched_*.png` and `out/cmp_patched_301x601_361x251.png` show the result.

## Numbers (percent of H unless noted)

| | 361x251 human | 361x251 engine | 301x601 human | 301x601 engine |
|---|---|---|---|---|
| headline block height | 37% (3 lines, 92px) | 24% (2 lines, 60px) | 22% (131px) | 22% (132px) |
| headline width (% of W) | 56% | 69% | 90% | 86% |
| subheadline height | 3% | 4% | 1.5% | 4.7% (wraps to 2 lines) |
| photo diameter | 11% of H (27px) | 15% (37px) | 12% of W (36px) | 20% of W (60px) |
| photo layout | 1 row, y 82% (bottom) | 1 row, y 39%-53% (middle) | 1 row, y 59% | 2x2 grid, y 35%-67% |
| logo diameter | 26% (65px) | 14% (36px) | 30% of W (90px) | 34% of W (103px) |
| button size | 54x37 px (15% H) | 30x21 px (8% H) | 144x32 px | 82x59 px, 2 lines |
| logo/button place | bottom row, left, same row as photos | stacked in the center column | bottom row | bottom row (good) |
| side margin | about 5.5% of W | headline 8% | 0-5% | 5% |

| | 321x71 human | 321x71 engine |
|---|---|---|
| headline | 2 lines, 54% of H, x 125-300 | 2 lines, 69% of H, x 110-313 (right margin only 2.5% of W) |
| logo | 52% of H | 65% of H |
| photos | 4 tiny (10px) in a 2x2 block | dropped |
| button | small strip under the logo | 38% of H, beside the logo |
| address | dropped | kept but about 5px high, unreadable |

## What I saw (looking at the pictures)

1. 361x251 (ratio 1.44): the engine stacks everything in one centered column. Headline is smaller than the human one (60px vs 92px), logo and button are about half the human size, and there is a big empty band left and right of the logo/button. The human uses a footer row: logo | button | 4 photos, and gives the headline 37% of the height.
2. Blurry smudge at bottom-left of 361x251, 301x601 and 300x250. It is the hole where the logo was cut out of the background (see `out/plate.png`, lower left). The human banner never shows it because the logo is placed on top of the same spot. The engine moves the logo, so the smudge is exposed. A client sees this as a dirty background.
3. 301x601 and 160x600: the background is squeezed by `SizyBg.map` (centre compressed to about 36% of its width). Hills look narrow and the sky is a dark vertical column with heavy stone on both sides. The human just crops the centre at natural proportions; it looks clean.
4. 301x601: engine shows photos as a 2x2 grid (60px) which eats 40% of the height and splits the headline from the logo. Human: one row (36px), calm, more air. (CLAUDE.md also says one row for tall banners.)
5. 321x71: engine is good (headline bigger than the human one, readable). Problems: tiny address line (illegible garbage under the logo) and a right margin of 8px.
6. 728x90 and 1200x200: layouts are sensible. 728x90 photos are 22px and there is no caption; fine. 1200x200 is good (logo big, headline two lines, button). No human reference, nothing to flag.
7. Sharpness: text and logo are sharp in all sizes; the sharpening step in `render` works. Small photos look slightly soft, same as the human ones.

## Ranked general fixes

### 1. Do not squeeze the background more than about 45% (`SizyBg.map` in public/bgmap.js)
Why: any tall or narrow target (ratio below about 0.6) currently compresses the middle of the picture to 5% scale at the limit. The fix is general: when the needed compression is too big, return null so `render` falls back to the normal "cover" crop, which already picks the detailed rows with `pickTop`.
Tested: yes, 301x601 now looks like the human one (see `out/patched_301x601.png`).

```diff
-    let lo = 0.05 * s, hi = s;
+    let lo = 0.55 * s, hi = s;       // squeeze at most to 55% of the cover scale, otherwise crop
     if (total(lo) > Wk) return null;
```

### 2. Single-row photos in tall banners when the circles are still about 11% of W (`layoutTall`, the `cols === total` test)
Why: the 0.17*W threshold rejects the one-row design that the human chose (circles 12% of W), so the engine builds a tall 2x2 grid. Keep 0.17 for very narrow banners (at 160px wide the row is too small and captions get dropped by `dropTiny`; I tested this and it was worse).
Tested: yes for 301x601 (matches human) and 160x600 (unchanged).

```diff
-      if (cols === total && total >= 3 && dia >= 0.17 * W) { pick = { a, f }; break; }
+      if (cols === total && total >= 3 && dia >= (W >= 250 ? 0.11 : 0.17) * W) { pick = { a, f }; break; }
```

### 3. New "footer row" layout for medium ratios 1.1 to 1.6 (`layout`, the non-wide branch)
Why: 361x251 and 300x250 get one centered column with logo and button at half the size the human used. Designers put a bottom row: logo | button | photos, and give the headline about 35% of H. `layoutTall` already has the footer logic (`foot`, `fr`, `rw`). Proposal (not tested, needs care):
- In `layout`, add `const mid = !wideMode && W / H >= 1.1;`.
- If `mid` and there is a logo, button or gallery: put them in ONE row at the bottom with the same code shape as the `foot` block of `layoutTall` (scale `fr = min((aw - gaps)/(sum of widths), 0.30*H/maxH)`, items vertically centered in the row), and run the existing `plan()` for the headline unit only in the space above (`th = H - rowH - 2*m - vg`).
- Order for Hebrew (rtl): logo at the left end, then button, gallery at the right (this matches the original where the logo is bottom-left).
- Success measure: logo diameter at least 22% of H and headline at least 33% of H at 361x251.

### 4. Hide the removed-element smudge (`msFill` and `softenDenseHoles`)
Why: big holes (logo 178x246 on the original) are filled with a smooth blend plus fine grain, so they look like a blur next to sharp stone. Options, cheapest first:
- a. In `render`, extend the `pickTop` idea to the horizontal crop: avoid choosing a window where `sc.holeRows`-style hole density (per column) is above 12%. For 361x251 there is no free choice, so this alone is not enough.
- b. In `msFill`, for holes larger than 2% of the image, add the high-pass detail of a donor patch: take the same-size patch shifted by the hole width left or right (the one whose 8px border ring matches best), subtract its blur, and add it to `fill` inside the hole. This keeps stone texture instead of a smear.
- c. I tried limiting the blur in `softenDenseHoles` to the hole + 3px ring. The smudge stayed the same, so that is not where it comes from (do not spend time there).

### 5. `dropTiny` should use real text height, not box height (`dropTiny`)
Why: in 321x71 the address leaf is 18px high but the text inside is about 5px, so it is not dropped and shows as unreadable noise. Use the ink height: `L.lh` of the leaf layer scaled by `e[4]/(L.lh)`, or simply measure rows of `L.a` above 0.3 and multiply by the scale. Proposed:

```js
// in dropTiny: replace  e[4] / Math.max(1,(e[0].lines||[1]).length) < 7.5
const ink = (lf) => { const L = lf.layer; if (!L || !L.a) return 1; let a = L.lh, b = 0; for (let y = 0; y < L.lh; y++) { let s = 0; for (let x = 0; x < L.lw; x++) s += L.a[y * L.lw + x]; if (s > 0.5) { a = Math.min(a, y); b = y; } } return Math.max(1, (b - a + 1) / L.lh); };
// then:  e[4] * ink(e[0]) / Math.max(1,(e[0].lines||[1]).length) < 7.5
```
(Cache `ink` on the leaf; it is read once per render.)

### 6. Bigger side margin in wide layouts (`layout`, wide branch: `ax0`, `ax1`)
Why: at 321x71 the headline ends 8px from the right edge (2.5% of W); the human leaves 6.5%. Change `let ax0 = m * 1.5, ax1 = W - m * 1.5;` to `const mx = Math.max(m * 1.5, 0.04 * W); let ax0 = mx, ax1 = W - mx;`. Low risk, small win.

### 7. Subheadline wrapping (`reflowLeaf`)
In 301x601 and 160x600 the one-line subheadline wraps into 2 and 3 lines (orphan word "מציג:"). The human keeps one line at small size. Prefer a smaller font over a new line for subheadline with 3 or fewer words per line: cap lines at 1 for role `subheadline` when the one-line scale would be at least 0.6 of the wanted scale.

## Summary of what the engine does better than the human
- 321x71: bigger, more readable headline and logo.
- 1200x200 and 728x90: a good, full use of the space (human reference not available).
- Text is crisp at every size.

## 1200x300 (לקוח, נלמד)
שלושה אזורים: גלריה 2×2 בקצה ימין, כותרת+כותרת משנה במרכז (הכי גדולה), לוגו עם כפתור מתחתיו בקצה שמאל. המנוע מיישם את זה בבאנר רחב רגיל (יחס עד 4.2); פסים צרים יותר נשארים בשורה אחת.
