// Kryterium 3: generator testów (A4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, Storage, NO_ANALYTICS } from './harness.mjs';

const KEYS = ['Prawo', 'Bezpieczeństwo', 'Regulaminy', 'Budowa broni', 'Prawo karne'];
const app = createApp({ storage: new Storage(NO_ANALYTICS) });

function checkDraw(ids, per) {
  assert.equal(ids.length, per * 5);
  assert.equal(new Set(ids).size, ids.length, 'bez powtórzeń');
  const cats = app.run(`[${ids.join(',')}].map(i=>BANK[i].cat)`);
  assert.deepEqual(cats, KEYS.flatMap(c => Array(per).fill(c)), 'kolejność działów');
  assert.ok(cats.slice(0, 4).every(c => c === 'Prawo' || c === 'Bezpieczeństwo'), 'pierwsze 4 = Prawo + Bezpieczeństwo');
}

for (const [mode, per] of [['pzss', 2], ['training', 4]]) {
  test(`${mode}: 1000 losowań – ${per * 5} pytań, po ${per} z działu, właściwa kolejność, bez powtórzeń`, () => {
    let use = {};
    for (let n = 0; n < 1000; n++) {
      const r = app.run(`pickExam(${JSON.stringify(mode)},${JSON.stringify(use)})`);
      checkDraw(r.ids, per);
      use = r.use; // cykl bez powtórek przez kolejne testy
    }
  });

  test(`${mode}: w jednym cyklu pytania się nie powtarzają między testami`, () => {
    let use = {}, seen = new Map();
    // Prawo karne ma 46 pytań: przy 2 na test cykl = 23 testy, przy 4 = 11 testów
    const tests = Math.floor(46 / per);
    for (let n = 0; n < tests; n++) {
      const r = app.run(`pickExam(${JSON.stringify(mode)},${JSON.stringify(use)})`);
      for (const ix of r.ids) { assert.ok(!seen.has(ix), `pytanie ${ix} powtórzone w cyklu`); seen.set(ix, n); }
      use = r.use;
    }
  });
}

test('dane syntetyczne ze stem: nigdy dwa pytania z tym samym stem w jednym teście', () => {
  const syn = createApp({ storage: new Storage(NO_ANALYTICS) });
  // po 3–4 warianty na hasło w każdym dziale; część pytań bez stem
  syn.run(`BANK.forEach((q,i)=>{q.stem=i%9===0?null:(KEYS.indexOf(q.cat)*100+Math.floor(i/4)%12)})`);
  for (const [mode, per] of [['pzss', 2], ['training', 4]]) {
    let use = {};
    for (let n = 0; n < 1000; n++) {
      const r = syn.run(`pickExam(${JSON.stringify(mode)},${JSON.stringify(use)})`);
      assert.equal(r.ids.length, per * 5);
      const stems = syn.run(`[${r.ids.join(',')}].map(i=>BANK[i].stem).filter(s=>s!=null)`);
      assert.equal(new Set(stems).size, stems.length, `${mode} #${n}: powtórzony stem ${stems}`);
      use = r.use;
    }
  }
});

test('stem wspólny dla wielu działów też jest pilnowany', () => {
  const syn = createApp({ storage: new Storage(NO_ANALYTICS) });
  syn.run(`BANK.forEach((q,i)=>{q.stem=1+i%15})`);
  for (let n = 0; n < 500; n++) {
    const r = syn.run(`pickExam('pzss',{})`);
    const stems = syn.run(`[${r.ids.join(',')}].map(i=>BANK[i].stem)`);
    assert.equal(new Set(stems).size, 10);
  }
});

test('beginExam zapisuje examUsed po id i test w toku', () => {
  const a = createApp({ storage: new Storage(NO_ANALYTICS) });
  a.run(`state.examMode='pzss';beginExam()`);
  const s = a.run('saved');
  assert.ok(Object.values(s.examUsed.pzss).flat().every(id => /^Q\d{4}$/.test(id)));
  assert.equal(s.activeExam.ids.length, 10);
});
