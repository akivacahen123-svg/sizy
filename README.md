# סייזי · Sizes

מעלים באנר, כותבים גדלים, ומקבלים אותו מחדש בכל גודל. הטקסט, הלוגו, התמונות והכפתור נחתכים מהבאנר המקורי ומסודרים מחדש, כך שהאותיות נשארות בדיוק כמו במקור.

## איך זה עובד
1. **ה-AI של גוגל (Gemini)** מסתכל על הבאנר ומסמן איפה כל טקסט, לוגו, תמונה וכפתור. זה קורה ב-Worker של Cloudflare, והמפתח נשמר שם בלבד.
2. **המנוע בדפדפן** (`public/engine.js`) חותך כל אלמנט מהפיקסלים המקוריים, מנקה את הרקע ומסדר הכול מחדש לכל גודל. הוא רץ אצל המשתמש, לא בשרת.

## העלאה לאינטרנט (Cloudflare, חינם)
1. נרשמים ב־https://dash.cloudflare.com/sign-up
2. **Workers & Pages** ← **Create** ← **Import a repository**. מחברים את GitHub ובוחרים את המאגר `sizy`. משאירים את ההגדרות כמו שהן ולוחצים **Deploy**.
3. מפתח של גוגל: נכנסים ל־https://aistudio.google.com/apikey ויוצרים מפתח.
4. ב־Cloudflare: **Settings ← Variables and Secrets** ומוסיפים כ־**Secret**:
   - `APP_PASSWORD`: הסיסמה שתבחר לאתר
   - `GEMINI_API_KEY`: המפתח מגוגל
5. לוחצים **Deploy** שוב. האתר זמין בכתובת שמסתיימת ב־`workers.dev`.

מעכשיו כל שינוי שנשמר ב־GitHub עולה לאתר לבד.

## הגדרות (ב־`wrangler.jsonc`)
| משתנה | מה עושה |
|---|---|
| `PUBLIC_ACCESS` | `"true"` פותח את האתר לכולם בלי סיסמה (לא מומלץ, כל ניתוח עולה על המפתח שלך) |
| `GOOGLE_CLIENT_ID` | אם מוגדר, נכנסים עם חשבון Google |
| `GEMINI_MODEL` | דגם מסוים. ריק: `gemini-flash-latest` עם גיבוי |

## למפתחים
```sh
npm install
cp .dev.vars.example .dev.vars   # למלא סיסמה ומפתח
npm run dev                      # http://localhost:8787
npm test                         # בדיקות שרת ומנוע (גוגל מדומה)
npm run typecheck
```
