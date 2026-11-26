// Etap B, kryteria 1–2: wczytanie partii i odrzucanie partii, które nie spełniają standardu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergeBatch } from '../tools/merge_batch.mjs';
import { extractArrayLiteral, loadBank } from '../tools/check_bank.mjs';
import { ROOT } from './harness.mjs';

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const bank = loadBank(path.join(ROOT, 'index.html'));
const batch = bank.filter(q => q.id.startsWith('B01-'));            // partia batch-01 w postaci z bazy
const oldOnly = bank.filter(q => q.status !== 'nowe').map(({ status, ...q }) => q);
const lit = extractArrayLiteral(html, 'const BANK=');
const htmlBefore = html.replace(lit, JSON.stringify(oldOnly));        // baza sprzed wczytania partii
const clone = x => JSON.parse(JSON.stringify(x));

test('poprawna partia: dopisana na końcu, stare dostają status „stare”, kolejność bez zmian', () => {
  const r = mergeBatch({ html: htmlBefore, batch: clone(batch) });
  assert.ok(r.ok, (r.problems || []).join('\n'));
  const after = JSON.parse(extractArrayLiteral(r.html, 'const BANK='));
  assert.equal(after.length, 270);
  after.slice(0, 235).forEach((q, i) => { assert.equal(q.id, oldOnly[i].id); assert.equal(q.status, 'stare'); });
  assert.deepEqual(after.slice(235).map(q => q.id), batch.map(q => q.id));
});

test('mapowanie stem: wysoka/średnia wpisane, niska zostaje null', () => {
  const b = clone(batch).map(q => ({ ...q, stem: null }));
  const stems = { [b[0].id]: { stem: 7, pewnosc: 'wysoka' }, [b[1].id]: { stem: 8, pewnosc: 'srednia' }, [b[2].id]: { stem: 9, pewnosc: 'niska' } };
  const r = mergeBatch({ html: htmlBefore, batch: b, stems });
  assert.ok(r.ok);
  const after = JSON.parse(extractArrayLiteral(r.html, 'const BANK='));
  assert.deepEqual(after.slice(235, 238).map(q => q.stem), [7, 8, null]);
});

const broken = [
  ['4 opcje', b => { b[0].options.push('czwarta opcja'); }, /liczba opcji ≠ 3/],
  ['brak art', b => { b[1].art = ''; }, /brak art/],
  ['brak pola why', b => { delete b[2].why; }, /brak pola why/],
  ['poprawna zawsze najdłuższa', b => { b.forEach(q => { q.options[q.answer] = q.options[q.answer] + ' – zgodnie z przepisami ustawy o broni i amunicji'; }); }, /wyraźnie najdłuższa.*próg ≤ 25%/],
  ['poprawna zawsze A', b => { b.forEach(q => { const c = q.options[q.answer]; q.options.splice(q.answer, 1); q.options.unshift(c); q.answer = 0; }); }, /położenie poprawnej A/],
  ['duplikat id w partii', b => { b[3].id = b[4].id; }, /duplikat id w partii/],
  ['id istnieje w bazie', b => { b[5].id = 'B01-001'; }, null],
  ['status inny niż nowe', b => { b[6].status = 'stare'; }, /status ≠ „nowe”/],
  ['zły stem', b => { b[7].stem = 500; }, /stem poza 1–142/],
  ['stosunek długości > 1,8', b => { b[8].options = ['krótka odpowiedź tu', 'krótka odpowiedź tam', 'znacznie, znacznie dłuższa odpowiedź opisowa z dodatkami']; }, /stosunek długości opcji > 1,8/],
];
for (const [name, mutate, re] of broken) {
  test(`zepsuta partia odrzucona w całości: ${name}`, () => {
    const b = clone(batch);
    mutate(b);
    const base = name === 'id istnieje w bazie' ? html : htmlBefore;
    const r = mergeBatch({ html: base, batch: b });
    assert.equal(r.ok, false);
    assert.equal(r.html, undefined, 'nic nie zapisano');
    if (re) assert.ok(r.problems.some(p => re.test(p)), `brak czytelnego komunikatu (${re}): ${r.problems.join(' | ')}`);
    else assert.ok(r.problems.some(p => /już istnieje w bazie/.test(p)));
  });
}

test('ponowne wczytanie tej samej partii jest odrzucane (duplikaty id)', () => {
  const r = mergeBatch({ html, batch: clone(batch) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.filter(p => /już istnieje w bazie/.test(p)).length === 35);
});

test('plik stems może nadpisać topic (decyzja czatu: rozdzielenie B01-033..035)', () => {
  const b = clone(batch).map(q => (q.id.startsWith('B01-03') && +q.id.slice(-3) >= 33 ? { ...q, topic: 'kary w ustawie' } : q));
  const stems = { 'B01-033': { stem: 128, pewnosc: 'wysoka', topic: 'porzucenie broni (art. 50)' } };
  const r = mergeBatch({ html: htmlBefore, batch: b, stems });
  assert.ok(r.ok);
  const after = JSON.parse(extractArrayLiteral(r.html, 'const BANK='));
  assert.equal(after.find(q => q.id === 'B01-033').topic, 'porzucenie broni (art. 50)');
  assert.equal(after.find(q => q.id === 'B01-034').topic, 'kary w ustawie');
});
