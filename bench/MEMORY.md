# Layout memory (how the engine should use it)

## What it is
Designers resized 4 campaigns by hand (13 sizes). We looked at every size and wrote down, in
`bench/exemplars/library.json`, where each element sits (boxes are 0-1 of the canvas), which
original elements were thrown away, the aspect ratio, and the campaign. `public/memory.js`
turns that into hints: "for a banner shaped like this, headlines are about this tall, logos
usually stay, captions usually go."

## API (works in browser, worker and node)
```js
SizyMemory.load(libraryJson);                       // once (fetch library.json in the browser)
SizyMemory.nearest(aspect, roles, {k:4, area})      // closest human layouts + distance
SizyMemory.priors(aspect, roles, {area})            // per role: {keep, y, h, x, w, textHeightPct, n}
```
`aspect` = width / height. `roles` = roles found in the ORIGINAL banner
(headline, subheadline, logo, button, badge, photo, caption, body, legal).
`area` (pixels) is optional; tiny canvases drop more.

## Rule one: these are hints, never coordinates
The engine already measures real elements from pixels. Memory only helps `autoplace` choose.
Never paste `y` or `h` as a final position, and never let an AI model write them.

## How to use each number (soft)
- `keep` (0-1): a tie-breaker for the "drop small stuff" rule.
  - keep < 0.3: drop this role first when space is tight.
  - keep > 0.8: fight for it; shrink everything else before dropping it.
  - between: use the engine's normal size rules. The test shows keep is right ~73% of
    the time, no better than "always keep", so never drop a role on `keep` alone.
- `h` and `textHeightPct`: a starting guess for the size of the headline block when the
  engine has to pick a font size. Blend it: `target = 0.5*engineGuess + 0.5*prior`, then
  clamp to what fits, so the readability checks still win.
- `y`: use only to choose an ORDER or a zone (top, middle, bottom third). The engine
  keeps its own spacing and alignment.
- `n` is how many neighbours had this role. If `n < 2`, ignore the hint.
- `y/h` can be `null` (nobody kept this role). Treat that as "drop it".

## Safety
- If memory disagrees with a hard rule (minimum text size, overlap, cut-off), the rule wins.
- Log when a hint changed a decision, so the QA report can say why.
- Add new exemplars by annotating them into `library.json` (same format). More campaigns
  matter more than more sizes of one campaign.

## Check it
`node bench/memory_test.mjs` hides one campaign at a time and predicts its human sizes from
the other three. Add `noarea` to turn off the canvas-area nudge.
