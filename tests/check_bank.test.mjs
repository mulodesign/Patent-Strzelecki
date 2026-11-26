// Kryterium 1: checker odtwarza liczby kontrolne i wykrywa błędy blokujące.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadBank, analyze, checkBaseline, statusOf } from '../tools/check_bank.mjs';
import { ROOT } from './harness.mjs';

const bank = loadBank(path.join(ROOT, 'index.html'));

test('--baseline: wszystkie liczby z sekcji 2 zlecenia', () => {
  const stare = bank.filter(q => statusOf(q) === 'stare');
  const rows = checkBaseline(stare, analyze(stare, { baseline: true }));
  for (const r of rows) assert.ok(r.ok, `${r.label}: ${JSON.stringify(r.got)} ≠ ${JSON.stringify(r.want)}`);
});

test('obecna baza: brak błędów blokujących, każde pytanie ma unikalne id', () => {
  const r = analyze(bank);
  assert.deepEqual(r.errors, []);
  assert.equal(new Set(bank.map(q => q.id)).size, bank.length);
});

test('błędy blokujące są wykrywane', () => {
  const ok = bank[0];
  const broken = [
    { ...ok, id: 'X1', q: 'A?', options: ['a', 'b', 'c', 'd'] },
    { ...ok, id: 'X2', q: 'B?', answer: 3 },
    { ...ok, id: 'X2', q: 'C?' },
    { ...ok, id: undefined, q: 'D?' },
    { ...ok, id: 'X5', q: 'E?', cat: 'Inne' },
    { ...ok, id: 'X6', q: ' ', why: '' },
    { ...ok, id: 'X7', q: 'G?', src: 'bez adresu' },
    { ...ok, id: 'X8', q: 'A?' },
  ];
  const e = analyze(broken).errors.join('\n');
  for (const frag of ['liczba opcji ≠ 3', 'answer poza 0–2', 'duplikat id', 'brak id', 'kategoria spoza listy', 'puste q', 'puste why', 'src bez adresu URL', 'dokładny duplikat'])
    assert.ok(e.includes(frag), `brak komunikatu: ${frag}`);
});
