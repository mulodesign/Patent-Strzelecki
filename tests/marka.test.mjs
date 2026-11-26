// Etap B, sekcja 9: znak MULO wg D21 (nagłówek + stopka), bez zmiany ikony i manifestu PifPaf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness.mjs';

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('pliki MULO są w img/ i są wskazane w index.html z alt="MULO"', () => {
  for (const f of ['mulo-symbol.svg', 'mulo-symbol-ciemne-tlo.svg', 'mulo-poziome.svg']) assert.ok(existsSync(path.join(ROOT, 'img', f)), f);
  assert.match(html, /<h1 class="brand-title">.*<img class="mulo-mark" src="\.\/img\/mulo-symbol-ciemne-tlo\.svg"[^>]*alt="MULO"/);
  assert.match(html, /<footer class="foot">.*<span class="mulo-plate"><img src="\.\/img\/mulo-poziome\.svg"[^>]*alt="MULO"><\/span><span>Autor: MULO – pomysły w działaniu<\/span>/);
});

test('zastrzeżenia w stopce zostały; ikona i manifest PifPaf bez znaku MULO', () => {
  const foot = html.slice(html.indexOf('<footer class="foot">'), html.indexOf('</footer>'));
  assert.ok(foot.includes('nie jest powiązany ani autoryzowany przez PZSS'));
  assert.ok(foot.includes('Wszelkie prawa zastrzeżone'));
  assert.ok(foot.indexOf('Wszelkie prawa zastrzeżone') < foot.indexOf('mulo-poziome'), 'logo MULO pod zastrzeżeniami');
  assert.ok(!/mulo/i.test(readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')));
  assert.ok(!/<link[^>]*rel="(icon|apple-touch-icon)"[^>]*mulo/i.test(html), 'ikona karty bez zmian');
});

test('pliki SVG MULO nie ładują zasobów z sieci', () => {
  for (const f of ['mulo-symbol-ciemne-tlo.svg', 'mulo-poziome.svg']) {
    const svg = readFileSync(path.join(ROOT, 'img', f), 'utf8');
    assert.ok(!/(href|src)="https?:/.test(svg), f);
  }
});
