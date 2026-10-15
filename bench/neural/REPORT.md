# הגדלה עצבית (נוירונית) בדפדפן — סיכום בעברית

**המלצה: כן (GO) — אבל רק עם waifu2x ולא עם Real-ESRGAN.**

- המודל הטוב ביותר: **waifu2x cunet x2** (רישיון MIT, 5.1MB). חלופה קלה ומהירה יותר: upconv_7_photo (2.2MB). חלופה איכותית יותר ואיטית: swin_unet_art x2 (16MB).
- הדיוק: על 7 חיתוכי לוגו/תמונה מהדוגמאות (הקטנה פי 1.5 ואז הגדלה חזרה) המודל משפר כ-4dB PSNR לעומת Lanczos, ושומר על האותיות (גם בעברית ובאנגלית קטנה).
- Real-ESRGAN general-x4v3 **לא מתאים**: הוא "ממציא" פרטים ומטשטש/משבש אותיות קטנות ("Israeli Children's Fund" יוצא משובש), והציון שלו גרוע מ-Lanczos.
- מהירות: חיתוך 150x150 לוקח כ-0.4 שנייה על מעבד בשרת (Node). בדפדפן עם WASM בערך פי 2-3 יותר; עם WebGPU מהר יותר. 400x400 — כ-3 שניות ב-CPU. מומלץ לעשות רק ללוגואים ותמונות קטנות, בתוך ה-Worker, ולטעון את הקובץ רק בעת הצורך.
- אחסון חינם: קובץ של 5MB נכנס ל-Static Assets של Cloudflare (מגבלה 25MiB לקובץ, 20,000 קבצים בחינם). אין צורך ב-R2.
- סיכון עיקרי: הקובץ שהורדתי מגיע מחבילת vs-mlrt (מאגר GPL-3); המשקולות עצמן נגזרות מ-waifu2x של nagadomi (MIT), אבל צריך לוודא לפני מכירה (או להמיר בעצמנו מ-nunif, שהוא MIT).
- לא הצלחתי לבדוק: Swin2SR (הורדה מ-huggingface נחסמה בסביבה), SPAN, AnimeSharp.

---

# Details (English)

## Sandbox network access
| Host | Result |
|---|---|
| huggingface.co, hf-mirror.com, cdn.jsdelivr.net, download.pytorch.org | **403 blocked by proxy** (not worked around) |
| github.com release downloads, raw.githubusercontent.com | OK (api.github.com repo contents: blocked without add_repo) |
| registry.npmjs.org, pypi.org | OK |

So Swin2SR (Xenova/swin2SR-classical-sr-x2-64 ONNX, HF only) could **not** be downloaded or benchmarked. Its licence page on HF shows no licence field for the Xenova repo; the upstream caidas/swin2SR is Apache-2.0 per the model card (not verified from here). Expect ~50MB fp32 (exceeds the 25MiB asset limit; would need q8/fp16 or R2).

## Candidates
| Model | Licence | Size | ONNX source (fetched here) | Faithfulness |
|---|---|---|---|---|
| waifu2x cunet scale2.0x | nunif/waifu2x MIT (repo LICENSE checked). Weights ship inside vs-mlrt release (repo GPL-3) - provenance to confirm | 5.1MB | https://github.com/AmusementClub/vs-mlrt/releases/download/model-20211209/waifu2x_v3.7z (87MB archive, `waifu2x/cunet/scale2.0x_model.onnx`) | Best. Lettering intact |
| waifu2x upconv_7_photo | same | 2.2MB | same archive | Good, slightly softer |
| waifu2x swin_unet_art scale2x | same | 16MB | https://github.com/AmusementClub/vs-mlrt/releases/download/external-models/waifu2x_swin_unet_v5.7z (444MB archive) | Best PSNR at 1.5x/2x, 2.5x slower than cunet |
| waifu2x swin_unet_photo_v2 scale4x | same | 18MB | same | Sharper, but 4x output wasted for 1.5-2x |
| Real-ESRGAN general-x4v3 | Repo BSD-3-Clause (LICENSE checked); no separate weights licence stated | 4.9MB .pth -> 4.87MB ONNX (I converted with torch, `convert_realesrgan.py`; .pth from github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth) | no official ONNX (community ones on HF, blocked here) | **Poor**: sharpens/redraws small text, garbles Latin lettering at 1.5x |
| Swin2SR classical x2 | Apache-2.0 upstream (unverified here) | ~50MB fp32 | HF only, blocked | not tested |
| SPAN / 2x-AnimeSharp | code Apache; AnimeSharp weights on OpenModelDB are CC-BY-NC-SA (non-commercial: **excluded**); SPAN weights licence varies per trained model | n/a | not fetched | not tested |

## Benchmark (onnxruntime-node 1.30, CPU, 2 cores; 7 crops from bench/exemplars)
Crop is downscaled by s (Lanczos), upscaled back to original size, compared with original. Model outputs (2x or 4x) are resized to target with Lanczos. Mean over crops (logos, badge, small photo, product photo).

| scale | method | PSNR dB | SSIM | sharpness x orig | edge corr |
|---|---|---|---|---|---|
| 1.5 | bicubic | 25.59 | 0.9247 | 0.27 | 0.918 |
| 1.5 | lanczos | 26.15 | 0.9300 | 0.30 | 0.926 |
| 1.5 | **cunet** | 30.45 | 0.9677 | 0.69 | 0.961 |
| 1.5 | swin_unet_art | 30.66 | 0.9695 | 0.67 | 0.962 |
| 1.5 | upconv7photo | 29.46 | 0.9611 | 0.73 | 0.957 |
| 1.5 | swin_unet_photo 4x | 30.62 | 0.9687 | 0.86 | 0.967 |
| 1.5 | Real-ESRGAN x4v3 | 24.09 | 0.9036 | 1.10 | 0.932 |
| 2.0 | lanczos | 23.26 | 0.8690 | 0.14 | 0.831 |
| 2.0 | **cunet** | 27.35 | 0.9401 | 0.63 | 0.911 |
| 2.0 | swin_unet_art | 27.67 | 0.9431 | 0.62 | 0.914 |
| 2.0 | upconv7photo | 26.47 | 0.9270 | 0.59 | 0.903 |
| 2.0 | Real-ESRGAN x4v3 | 22.00 | 0.8576 | 0.89 | 0.874 |

Note: the test inputs are already tiny (e.g. 56x54 logos), a hard case. Visual check (`out/zoom_*.png`, columns: original, Lanczos, cunet, upconv7photo, swin_unet_art, Real-ESRGAN): waifu2x variants keep Hebrew and Latin lettering unchanged, only crisper edges; Real-ESRGAN garbles "Israeli Children's Fund" and thickens strokes (hallucination risk). waifu2x never invented new glyph shapes in these crops; overshoot/halo was not visible.

## Speed (Node CPU, 2nd run, input incl. 8px pad; no browser measurement possible here)
Input 187x133 (~25k px): cunet 447ms, upconv_7 356ms, swin_unet_art 1051ms, Real-ESRGAN 1003ms, swin 4x 2135ms. Scaling ~linearly with pixels: 150x150 ≈ 0.4s (cunet), 400x400 ≈ 2.9s (cunet) in native CPU. Browser estimates (not measured): WASM SIMD multi-thread 1.5-3x slower than native; WebGPU likely faster for 400x400 but cunet/swin ONNX op support on WebGPU is untested. Run in tiles (e.g. 128px + 8px overlap) for big inputs; the models need height/width padded to a multiple of 8 (cunet crashes otherwise; handled in run.mjs).

## Shipping
- Cloudflare Workers static assets: 25 MiB per file, 20,000 files (free); Worker script 64 MiB. A 5MB .onnx fits as a static asset (served compressed, cached); lazy-load only when a logo/photo needs upscaling.
- Larger models (Swin2SR ~50MB): R2 free tier (10GB, no egress fees) or split. jsDelivr npm: files up to 50MB, but blocked here so unverified.
- Runtime: onnxruntime-web (MIT) with wasm backend first, WebGPU as an optional faster path.
- Before selling: (1) obtain weights from the MIT nunif repo (pretrained_models/waifu2x, convert with its export script) or get written confirmation of provenance, instead of the GPL-3 vs-mlrt bundle; (2) bundle the nunif MIT notice.

## Reproduce
Files: `prep.py` (crops -> downscaled raw), `run.mjs` (onnxruntime-node runner, `models.example.json` lists models; paths point to the extracted archives), `eval.py` (metrics + zoom PNGs into `out/`), `convert_realesrgan.py`. `npm install --no-save --ignore-scripts onnxruntime-node` inside bench/neural (the postinstall CUDA download is blocked by the proxy and not needed for CPU). Model files and node_modules are not committed.
