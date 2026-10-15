// מועמדים לטקסט קטן (alpha-matte path). כל אחד: (L, tw, th) → {a, rgb}
export default function (T, E, textEngine, clp) {
  const fillRgb = (L, n) => { const rgb = new Float32Array(n * 3); for (let i = 0; i < n; i++) { rgb[i * 3] = L.rgb[0]; rgb[i * 3 + 1] = L.rgb[1]; rgb[i * 3 + 2] = L.rgb[2]; } return rgb; };
  const aPl = L => ({ w: L.lw, h: L.lh, c: 1, d: L.a });
  // רינדור "וקטורי": area (כיסוי אמיתי של פיקסל) מהמסכה הגדולה, בלי חידוד
  const vec = (L, tw, th) => { const a = E.resize(aPl(L), tw, th, 'area'); return { a: a.d, rgb: fillRgb(L, tw * th) }; };
  // area + שיפוע קל סביב המרכז (מחדד מעבר) – דומה ל-hinting קל
  const vecG = (g, ctr, usm) => (L, tw, th) => { let a = E.resize(aPl(L), tw, th, 'area'); for (let i = 0; i < a.d.length; i++) a.d[i] = clp((a.d[i] - ctr) * g + ctr, 0, 1); if (usm) a = T.usmLim(a, usm, [0], 0); return { a: a.d, rgb: fillRgb(L, tw * th) }; };
  // מסכה מוחלקת קלות לפני area כדי להסיר מדרגות, ואז שיפוע
  const vecB = (sg, g, ctr, usm) => (L, tw, th) => { let a0 = E.blur(aPl(L), sg * L.lw / tw); let a = E.resize(a0, tw, th, 'area'); for (let i = 0; i < a.d.length; i++) a.d[i] = clp((a.d[i] - ctr) * g + ctr, 0, 1); if (usm) a = T.usmLim(a, usm, [0], 0); return { a: a.d, rgb: fillRgb(L, tw * th) }; };
  return {
    'engine-old': textEngine({ txOff: 1 }),
    'new(engine)': textEngine({}),
    'area': vec,
    'area g1.3': vecG(1.3, 0.45, 0),
    'area g1.3 u.6': vecG(1.3, 0.45, 0.6),
    'area g1.6 u.4': vecG(1.6, 0.45, 0.4),
    'blur.3 g1.4': vecB(0.3, 1.4, 0.45, 0),
    'area g1.5 u.8': vecG(1.5, 0.45, 0.8),
    'area g1.4 u.8 c.5': vecG(1.4, 0.5, 0.8),
    'area g2 u.3': vecG(2.0, 0.5, 0.3),
    'gainDn.3': textEngine({ txOff: 1, gainDn: 0.3 }),
    'usm.5': textEngine({ txOff: 1, usmText: 0.5 }),
    'usm1.5': textEngine({ txOff: 1, usmText: 1.5 }),
    'ctr.5': textEngine({ txOff: 1, gainCenter: 0.5 }),
    'ctr.4': textEngine({ txOff: 1, gainCenter: 0.4 }),
  };
}
