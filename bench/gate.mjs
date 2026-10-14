// שער איכות: מריץ את מדד bench/score.mjs על קבוצת בסיס ומשווה ל-bench/baseline.json.
//   node bench/gate.mjs            -> יציאה 1 אם גודל כלשהו ירד ביותר מ-3 נקודות או שמופיע דגל חדש
//   node bench/gate.mjs --update   -> כותב baseline חדש
// קבוצת הבסיס: bench/exemplars/*/fx.json (+ גדלי המעצב שלהם) ו-/tmp/fx אם קיים. אפשר להוסיף נתיבים: --fx dir
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { DEFAULT_SIZES, loadEngine, loadFixtures, scoreFixture } from './score.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), BASE = process.env.GATE_BASE || path.join(here, 'baseline.json'), MAXDROP = 3;
const args = process.argv.slice(2), update = args.includes('--update'), extra = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--fx') extra.push(args[++i]);
const exDir = path.join(here, 'exemplars'), dirs = [];
if (fs.existsSync(exDir)) for (const d of fs.readdirSync(exDir).sort()) if (fs.existsSync(path.join(exDir, d, 'fx.json'))) dirs.push(path.join(exDir, d));
if (fs.existsSync('/tmp/fx')) dirs.push('/tmp/fx');
dirs.push(...extra);
const humanSizes = d => fs.readdirSync(d).map(f => /^h_(\d+)x(\d+)[a-z]?\.\w+$/.exec(f)).filter(Boolean).map(m => [+m[1], +m[2]]);
// פיקסצ'רים של /tmp/fx כבדים (בניית סצנה ~3 שניות): מדרגים אותם בתת-קבוצת גדלים
const FX_SIZES = '1200x200,120x500,300x600,728x90,300x250,320x70'.split(',').map(s => s.split('x').map(Number));
const jobs = [];
for (const d of dirs) for (const fx of loadFixtures([d])) {
  const seen = new Set(), base = d === '/tmp/fx' ? FX_SIZES : DEFAULT_SIZES;
  jobs.push({ d, name: fx.name, sizes: [...base, ...humanSizes(d)].filter(([w, h]) => !seen.has(w + 'x' + h) && seen.add(w + 'x' + h)) });
}
const shard = args.indexOf('--shard') >= 0 ? args[args.indexOf('--shard') + 1].split('/').map(Number) : null;
const runJob = async (E, j) => { const fx = loadFixtures([j.d]).find(f => f.name === j.name); const o = {}; for (const r of scoreFixture(E, fx, j.sizes)) o[`${r.fixture}@${r.size}`] = { score: r.score, flags: r.flags, sub: r.sub }; return o; };
const cur = {};
if (shard) { // תהליך-בן: מדרג כל n-י עבודה ומדפיס JSON
  const E = await loadEngine(), o = {}; for (let i = shard[0]; i < jobs.length; i += shard[1]) Object.assign(o, await runJob(E, jobs[i]));
  process.stdout.write(JSON.stringify(o)); process.exit(0);
}
const { spawn } = await import('child_process'), N = Math.max(1, Math.min(4, (await import('os')).cpus().length, jobs.length));
const passthru = args.filter((a, i) => a === '--fx' || args[i - 1] === '--fx');
await Promise.all(Array.from({ length: N }, (_, i) => new Promise((res, rej) => {
  const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), ...passthru, '--shard', `${i}/${N}`], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 }); let out = '';
  ch.stdout.on('data', d => out += d); ch.on('close', code => { if (code) return rej(new Error('shard failed')); Object.assign(cur, JSON.parse(out || '{}')); res(); });
})));
const keys = Object.keys(cur), avg = keys.reduce((a, k) => a + cur[k].score, 0) / (keys.length || 1);
if (update) {
  fs.writeFileSync(BASE, JSON.stringify({ avg: +avg.toFixed(2), cases: cur }, null, 1));
  console.log(`baseline written: ${keys.length} cases, avg ${avg.toFixed(1)} -> ${path.relative(process.cwd(), BASE)}`); process.exit(0);
}
if (!fs.existsSync(BASE)) { console.error('no bench/baseline.json: run with --update first'); process.exit(2); }
const base = JSON.parse(fs.readFileSync(BASE)).cases, fails = [], notes = [];
for (const k of keys) {
  const b = base[k], c = cur[k]; if (!b) { notes.push(`new case (not in baseline): ${k} ${c.score}`); continue; }
  if (b.score - c.score > MAXDROP) fails.push(`DROP  ${k}: ${b.score} -> ${c.score} (${(c.score - b.score).toFixed(1)})`);
  const nf = c.flags.filter(f => !b.flags.includes(f)); if (nf.length) fails.push(`FLAG  ${k}: new ${nf.join(',')}`);
  if (c.score - b.score > MAXDROP) notes.push(`improved ${k}: ${b.score} -> ${c.score}`);
  const gone = b.flags.filter(f => !c.flags.includes(f)); if (gone.length) notes.push(`flag cleared ${k}: ${gone.join(',')}`);
}
for (const k of Object.keys(base)) if (!cur[k]) notes.push(`missing from this run: ${k}`);
for (const n of notes.slice(0, 40)) console.log('note ', n);
for (const f of fails) console.log(f);
console.log(`${keys.length} cases, avg ${avg.toFixed(1)} (baseline ${JSON.parse(fs.readFileSync(BASE)).avg}) -> ${fails.length ? 'FAIL (' + fails.length + ')' : 'PASS'}`);
process.exit(fails.length ? 1 : 0);
