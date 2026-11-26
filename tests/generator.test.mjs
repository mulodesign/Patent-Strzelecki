// Generator testów: kryterium 3 Etapu A (A4) i kryterium 3 Etapu B (B4 – preferencja „nowe”).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, Storage, NO_ANALYTICS } from './harness.mjs';

const KEYS = ['Prawo', 'Bezpieczeństwo', 'Regulaminy', 'Budowa broni', 'Prawo karne'];
const app = createApp({ storage: new Storage(NO_ANALYTICS) });
const info = ids => app.run(`[${ids.join(',')}].map(i=>({ix:i,id:BANK[i].id,cat:BANK[i].cat,status:statusOf(BANK[i]),stem:BANK[i].stem,topic:BANK[i].topic||null}))`);

function checkDraw(ids, per) {
  assert.equal(ids.length, per * 5);
  assert.equal(new Set(ids).size, ids.length, 'bez powtórzeń');
  const qs = info(ids);
  assert.deepEqual(qs.map(q => q.cat), KEYS.flatMap(c => Array(per).fill(c)), 'kolejność działów');
  assert.ok(qs.slice(0, 4).every(q => q.cat === 'Prawo' || q.cat === 'Bezpieczeństwo'), 'pierwsze 4 = Prawo + Bezpieczeństwo');
  const stems = qs.map(q => q.stem).filter(s => s != null), topics = qs.map(q => q.topic).filter(Boolean);
  assert.equal(new Set(stems).size, stems.length, 'powtórzony stem');
  assert.equal(new Set(topics).size, topics.length, 'powtórzony topic');
  return qs;
}

for (const [mode, per] of [['pzss', 2], ['training', 4]]) {
  test(`${mode}: 1000 losowań – ${per * 5} pytań, kolejność działów, bez powtórzeń, bez wspólnego stem/topic`, () => {
    let use = {};
    for (let n = 0; n < 1000; n++) {
      const r = app.run(`pickExam(${JSON.stringify(mode)},${JSON.stringify(use)})`);
      checkDraw(r.ids, per);
      use = r.use;
    }
  });

  test(`${mode}: 1000 losowań – Prawo tylko z puli „nowe”, Bezpieczeństwo/Regulaminy/Budowa tylko „stare”`, () => {
    let use = {};
    const pkNowe = new Map();
    for (let n = 0; n < 1000; n++) {
      const r = app.run(`pickExam(${JSON.stringify(mode)},${JSON.stringify(use)})`);
      const qs = checkDraw(r.ids, per);
      use = r.use;
      for (const q of qs) {
        if (q.cat === 'Prawo') assert.equal(q.status, 'nowe', `Prawo ze „stare”: ${q.id}`);
        if (['Bezpieczeństwo', 'Regulaminy', 'Budowa broni'].includes(q.cat)) assert.equal(q.status, 'stare');
        if (q.cat === 'Prawo karne') pkNowe.set(q.status, (pkNowe.get(q.status) || 0) + 1);
      }
    }
    // Prawo karne: liczba „nowe” w dziale wg puli (po batch-01: 3 pytania o różnych topic) – zawsze min(per, pula nowych)
    const pkPool = app.run(`byCat('Prawo karne').filter(q=>statusOf(q)==='nowe').length`);
    assert.equal(pkNowe.get('nowe'), 1000 * Math.min(per, pkPool), 'Prawo karne: nowe pytania mają pierwszeństwo');
  });

  test(`${mode}: w pierwszym cyklu każdej grupy (dział + status) pytania się nie powtarzają – 100 niezależnych startów`, () => {
    const groups = new Map();
    for (const q of app.run('BANK.map(q=>({cat:q.cat,status:statusOf(q)}))')) { const g = q.cat + '|' + q.status; groups.set(g, (groups.get(g) || 0) + 1); }
    for (let run = 0; run < 100; run++) {
      let use = {};
      const seen = new Map();
      // ostatni test cyklu może sięgnąć do bieżącego cyklu (gdy 2 ostatnie pytania mają wspólny stem/topic) – sprawdzamy cykl bez niego
      const tests = Math.min(...[...groups.entries()].filter(([, n]) => n >= 4 * per).map(([, n]) => Math.floor(n / per))) - 1;
      for (let n = 0; n < tests; n++) {
        const r = app.run(`pickExam(${JSON.stringify(mode)},${JSON.stringify(use)})`);
        use = r.use;
        for (const q of info(r.ids)) {
          const g = q.cat + '|' + q.status;
          if (groups.get(g) < 4 * per) continue; // mała grupa (np. 3 nowe w Prawie karnym) – rotuje szybciej
          const s = seen.get(g) || new Set();
          assert.ok(!s.has(q.ix), `start ${run}, test ${n}: ${q.id} powtórzone w pierwszym cyklu grupy ${g}`);
          s.add(q.ix); seen.set(g, s);
        }
      }
    }
  });
}

test('ACTIVE_STATUSES = [\'stare\'] wyłącza nowe pytania (gotowość na Etap C – tu tylko odwrotnie: same stare)', () => {
  const a = createApp({ storage: new Storage(NO_ANALYTICS) });
  a.run(`ACTIVE_STATUSES.splice(0,ACTIVE_STATUSES.length,'stare')`);
  for (let n = 0; n < 200; n++) {
    const r = a.run(`pickExam('pzss',{})`);
    assert.ok(a.run(`[${r.ids.join(',')}].every(i=>statusOf(BANK[i])==='stare')`));
  }
  assert.equal(a.run('activeIx().length'), 235);
  a.run(`ACTIVE_STATUSES.splice(0,ACTIVE_STATUSES.length,'nowe')`);
  assert.equal(a.run('activeIx().length'), 35);
  assert.equal(a.run(`byCat('Bezpieczeństwo').length`), 0);
});

test('dane syntetyczne ze stem: nigdy dwa pytania z tym samym stem w jednym teście', () => {
  const syn = createApp({ storage: new Storage(NO_ANALYTICS) });
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
    assert.equal(new Set(syn.run(`[${r.ids.join(',')}].map(i=>BANK[i].stem)`)).size, 10);
  }
});

test('beginExam zapisuje examUsed po id i test w toku', () => {
  const a = createApp({ storage: new Storage(NO_ANALYTICS) });
  a.run(`state.examMode='pzss';beginExam()`);
  const s = a.run('saved');
  assert.ok(Object.values(s.examUsed.pzss).flat().every(id => /^(Q\d{4}|B\d{2}-\d{3})$/.test(id)));
  assert.equal(s.activeExam.ids.length, 10);
});

test('kolejność BANK: 235 pytań z v1 na swoich indeksach, nowe na końcu (analityka wysyła indeksy)', () => {
  const ids = app.run('BANK.map(q=>q.id)');
  ids.slice(0, 235).forEach((id, i) => assert.equal(id, 'Q' + String(i + 1).padStart(4, '0')));
  assert.ok(ids.slice(235).every(id => /^B01-\d{3}$/.test(id)));
});
