// Kryterium 2: migracja postępu v1 -> schema 2 (klucz = stałe id) oraz odporność na uszkodzone dane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, Storage, NO_ANALYTICS } from './harness.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/progress-v1.json', import.meta.url), 'utf8'));
const boot = (extra = {}) => createApp({ storage: new Storage({ ...NO_ANALYTICS, ...fx.storage, ...extra }) });
const texts = (app, ids) => ids.map(id => app.run(`BANK[idxOf(${JSON.stringify(id)})].q`)).sort();

test('migracja v1: te same pytania widziane, błędne, w powtórkach, w examUsed i w sesji fiszek', () => {
  const app = boot();
  const s = app.run('saved');
  assert.equal(s.schema, 2);
  assert.equal(s.migratedFrom, 'v1');
  assert.deepEqual(texts(app, s.seen), fx.expected.seen);
  assert.deepEqual(texts(app, s.mistakes), fx.expected.mistakes);
  const rev = Object.fromEntries(Object.entries(s.reviews).map(([id, r]) => [app.run(`BANK[idxOf(${JSON.stringify(id)})].q`), r]));
  assert.deepEqual(rev, fx.expected.reviews);
  for (const [mode, byC] of Object.entries(fx.expected.examUsed))
    for (const [cat, list] of Object.entries(byC)) assert.deepEqual(texts(app, s.examUsed[mode][cat]), list, `${mode}/${cat}`);
  assert.equal(s.attempts.length, fx.expected.attempts);
  // sesja fiszek wznowiona w tej samej kolejności i miejscu
  assert.deepEqual(app.run('state.flashIds.map(i=>BANK[i].q)'), fx.expected.flash.texts);
  assert.equal(app.run('state.flashAt'), fx.expected.flash.at);
  // nowy format zapisany, stary klucz v1 nietknięty
  assert.equal(JSON.parse(app.storage.getItem('pifpaf-progress-v2')).schema, 2);
  assert.equal(app.storage.getItem('patent-pzss-progress-v1'), fx.storage['patent-pzss-progress-v1']);
});

test('migracja v1: zaplanowane powtórki i błędy działają w funkcjach aplikacji', () => {
  const app = boot();
  for (const [q, r] of Object.entries(fx.expected.reviews)) {
    const ix = app.run(`BANK.findIndex(x=>x.q===${JSON.stringify(q)})`);
    assert.deepEqual(app.run(`reviewFor(${ix})`), r);
  }
  assert.equal(app.run("(beginStudy('Tylko błędne'),state.studyIds.length)"), fx.expected.mistakes.length);
});

test('po migracji edycja treści pytania nie gubi postępu', () => {
  const first = boot();
  const stored = first.storage.snapshot();
  const app = createApp({ storage: new Storage(stored) });
  const before = app.run('saved.seen.length');
  // symulacja poprawki treści w Etapie B: zmiana tekstu pytania o tym samym id
  app.run(`BANK.forEach(q=>q.q=q.q+' (poprawione)')`);
  const s = app.run('saved');
  assert.equal(new Set(app.run('idsToIdx(saved.seen)')).size, before);
  assert.ok(Object.keys(s.reviews).every(id => app.run(`idxOf(${JSON.stringify(id)})`) !== undefined));
  assert.ok(app.run('readinessDetails().allCovered') > 0);
});

test('ponowne uruchomienie nie migruje drugi raz', () => {
  const first = boot();
  first.run(`mark(1,true)`);
  const again = createApp({ storage: new Storage(first.storage.snapshot()) });
  assert.ok(again.run(`saved.seen.includes('Q0002')`));
});

for (const [name, store] of [
  ['uszkodzony JSON v2', { 'pifpaf-progress-v2': '{oops' }],
  ['uszkodzony JSON v1', { 'patent-pzss-progress-v1': '{"seen":[1,2' }],
  ['v1 o złym kształcie', { 'patent-pzss-progress-v1': JSON.stringify({ seen: 'x', mistakes: { a: 1 }, reviews: [1], examUsed: 5, attempts: 'x', flashSession: { keys: 'x' } }) }],
  ['v1 to tablica', { 'patent-pzss-progress-v1': '[1,2,3]' }],
  ['v2 z obcymi id', { 'pifpaf-progress-v2': JSON.stringify({ schema: 2, seen: ['Q9999'], mistakes: ['ZZZ'], activeExam: { ids: ['Q9999'], start: 1 } }) }],
]) {
  test(`start bez wyjątku: ${name}`, () => {
    const app = createApp({ storage: new Storage({ ...NO_ANALYTICS, ...store }) });
    assert.equal(app.run('state.page'), 'start');
    assert.ok(app.html().includes('Pytania w bazie'));
    assert.equal(app.run('idsToIdx(saved.seen).length'), 0);
    app.run(`mark(0,false);beginStudy('Tylko błędne')`);
    assert.equal(app.run('state.studyIds.length'), 1);
  });
}

test('bez zgody analitycznej nic nie jest wysyłane', () => {
  const app = boot();
  app.run(`state.examMode='pzss';beginExam();finishExam()`);
  assert.equal(app.fetchCalls.length, 0);
});
