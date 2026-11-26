#!/usr/bin/env node
// Wczytanie partii pytań od czatu do bazy PifPaf (Etap B, B3). Node (>=18), bez zależności.
//
//   node tools/merge_batch.mjs ŚCIEŻKA/batch-NN.json [--stems tools/stems/batch-NN.json] [--dry-run] [--file index.html]
//
// Kolejno: schemat v2 → duplikaty id/treści → bramka jakości B3 dla partii → kontrola całej bazy.
// Partia, która nie przechodzi, jest odrzucana w całości (nic nie jest zapisywane, kod wyjścia 1).
// Po przejściu: pytania bez statusu dostają status „stare”, nowe są dopisywane NA KOŃCU tablicy BANK
// (kolejność istniejących pytań nie zmienia się – analityka nadal wysyła indeksy).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArrayLiteral, analyze, validateV2Record, gateNew, formatGate, V2_FIELDS } from './check_bank.mjs';

export function mergeBatch({ html, batch, stems = null }) {
  const problems = [];
  const literal = extractArrayLiteral(html, 'const BANK=');
  const bank = JSON.parse(literal);
  if (!Array.isArray(batch) || !batch.length) return { ok: false, problems: ['partia nie jest niepustą tablicą pytań'] };

  // 1. schemat
  batch.forEach((q, i) => problems.push(...validateV2Record(q, i)));
  // 2. duplikaty id (w partii i względem bazy)
  const known = new Set(bank.map(q => q.id)), seen = new Set();
  for (const q of batch) {
    if (!q || !q.id) continue;
    if (seen.has(q.id)) problems.push(`${q.id}: duplikat id w partii`);
    if (known.has(q.id)) problems.push(`${q.id}: id już istnieje w bazie`);
    seen.add(q.id);
  }
  // 3. bramka jakości B3 dla partii
  const gate = gateNew(batch.filter(q => q && typeof q === 'object'));
  if (!gate.ok) problems.push(...gate.fails.map(f => 'bramka: ' + f));
  // 4. kontrola całej bazy po dołączeniu (np. dokładny duplikat treści)
  const merged = [...bank.map(q => (q.status ? q : { ...q, status: 'stare' })), ...batch];
  if (!problems.length) {
    const all = analyze(merged);
    problems.push(...all.errors.map(e => 'baza: ' + e));
  }
  if (problems.length) return { ok: false, problems, gate };

  // mapowanie stem (tylko pewność wysoka/średnia; niska zostaje null)
  const applied = [];
  const out = batch.map(q => {
    const s = stems && stems[q.id];
    const stem = s && s.stem != null && ['wysoka', 'srednia'].includes(s.pewnosc) ? s.stem : q.stem;
    if (stem !== q.stem) applied.push(q.id);
    const rec = { ...q, stem };
    return Object.fromEntries(V2_FIELDS.map(f => [f, rec[f]]));
  });
  const finalBank = [...merged.slice(0, bank.length), ...out];
  const at = html.indexOf(literal);
  return {
    ok: true, gate, applied, added: out.length, before: bank.length, after: finalBank.length,
    html: html.slice(0, at) + JSON.stringify(finalBank) + html.slice(at + literal.length),
  };
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const batchPath = argv.find((a, i) => !a.startsWith('--') && !['--stems', '--file'].includes(argv[i - 1]));
  if (!batchPath) { console.error('Użycie: node tools/merge_batch.mjs batch-NN.json [--stems plik.json] [--dry-run]'); return 2; }
  const file = opt('--file') || path.join(root, 'index.html');
  let batch, stems = null;
  try { batch = JSON.parse(readFileSync(batchPath, 'utf8')); } catch (e) { console.error(`ODRZUCONO: nie da się odczytać partii (${e.message})`); return 1; }
  if (opt('--stems')) stems = JSON.parse(readFileSync(opt('--stems'), 'utf8'));
  const r = mergeBatch({ html: readFileSync(file, 'utf8'), batch, stems });
  const name = path.basename(batchPath);
  if (r.gate) console.log(formatGate(r.gate, name));
  if (!r.ok) {
    console.log(`\nODRZUCONO PARTIĘ ${name} w całości – ${r.problems.length} problemów:`);
    r.problems.forEach(p => console.log('  ✗ ' + p));
    console.log('WYNIK: merge=nie');
    return 1;
  }
  console.log(`\nPartia ${name}: OK – dopisano ${r.added} pytań na końcu BANK (${r.before} → ${r.after}); stem przypisany z mapowania: ${r.applied.length}`);
  if (argv.includes('--dry-run')) { console.log('(--dry-run: nic nie zapisano)'); console.log('WYNIK: merge=tak (próba)'); return 0; }
  writeFileSync(file, r.html);
  console.log(`Zapisano ${path.relative(root, file)}`);
  console.log('WYNIK: merge=tak');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
