// Etap B (dokończenie): przegląd sformułowań B5 – brzmienia zatwierdzone przez czat 26.11.2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadBank } from '../tools/check_bank.mjs';
import { ROOT } from './harness.mjs';

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const admin = readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const bank = loadBank(path.join(ROOT, 'index.html'));

test('interfejs: nowe brzmienia są, stare zniknęły', () => {
  for (const s of ['testy próbne', 'nie są pytaniami egzaminacyjnymi PZSS i nie pochodzą z oficjalnej bazy PZSS', 'nie ma gwarancji, że takie same pytania wystąpią na egzaminie',
    'Parametry konkurencji ISSF podano według przepisów obowiązujących w 2026 r.', 'Wykaz zagadnień opublikowany przez PZSS (PDF)', '6 lekcji – zagadnienia potrzebne do egzaminu',
    'regulamin-patentowy-tekst-jednolity-uchw-47.pdf" target="_blank" rel="noopener">Regulamin patentowy'])
    assert.ok(html.includes(s), 'brak: ' + s);
  for (const s of ['egzaminy próbne', 'ksglauberyt', 'Historyczne arkusze', 'Archiwalna baza PZSS', 'historycznych arkuszy', 'Historyczny wykaz zagadnień PZSS', 'zagadnienia egzaminacyjne'])
    assert.ok(!html.includes(s), 'nadal jest: ' + s);
  // zastrzeżenia zostają
  for (const s of ['nie jest powiązany ani autoryzowany przez PZSS', 'Nie jest oficjalnym testem', 'Nie jest to ocena PZSS']) assert.ok(html.includes(s), 'zniknęło: ' + s);
});

test('panel administratora bez „symulacji PZSS”', () => {
  assert.ok(!/Symulacja PZSS|symulacje PZSS|Średnia PZSS/.test(admin));
  for (const s of ['Zdane testy kontrolne', 'Test kontrolny — ukończone', 'Test kontrolny — zdane', 'Średnia (test kontrolny)']) assert.ok(admin.includes(s), s);
});

test('baza: metadane bez „bazy PZSS”, nowe etykiety źródeł i provenance', () => {
  assert.ok(bank.every(q => !/baza PZSS/i.test(q.why)));
  assert.ok(bank.every(q => !String(q.src).includes('PZSS, historyczna lista pytań') && !String(q.src).includes('regulamin-patent-strzelecki-2025.pdf')));
  const prov = bank.filter(q => 'provenance' in q);
  assert.equal(prov.length, 55);
  assert.ok(prov.every(q => q.provenance === 'własne opracowanie na podstawie wskazanego źródła'));
});
