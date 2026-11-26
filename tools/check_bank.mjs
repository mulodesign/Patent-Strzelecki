#!/usr/bin/env node
// Kontrola jakości bazy pytań PifPaf. Node (>=18), bez zależności.
//
//   node tools/check_bank.mjs                 – pełny raport; kod wyjścia 1 przy błędach
//   node tools/check_bank.mjs --baseline      – porównanie z liczbami kontrolnymi (stan v1, 26.11.2026)
//   node tools/check_bank.mjs --strict        – ostrzeżenia z progami też blokują (Etap B)
//   node tools/check_bank.mjs --links         – sprawdzenie źródeł przez HTTP (ręcznie, nieblokujące)
//   node tools/check_bank.mjs --file X.json   – inny plik (tablica pytań w JSON albo index.html)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const CATEGORIES = ['Prawo', 'Bezpieczeństwo', 'Regulaminy', 'Budowa broni', 'Prawo karne'];
export const THRESHOLDS = {
  clearlyLongestMaxShare: 0.25,   // „wyraźnie najdłuższa” w ≤ 25% pytań
  clearlyLongestRel: 0.20,        // ≥ 20% dłuższa od drugiej najdłuższej…
  clearlyLongestAbs: 8,           // …i ≥ 8 znaków
  strictlyLongestTarget: 0.45,    // cel informacyjny
  positionMin: 0.28, positionMax: 0.38,
  positionMinCount: 30,           // udział A/B/C oceniany od 30 pytań
  lengthRatioMax: 1.8, lengthRatioMinOption: 12,
  jaccard: 0.6,
};
const SIGNAL_WORDS = [['zawsze', /\bzawsze\b/i], ['nigdy', /\bnigdy\b/i], ['wyłącznie', /\bwyłącznie\b/i],
  ['tylko', /\btylko\b/i], ['każd*', /\bkażd\p{L}*/iu], ['dowoln*', /\bdowoln\p{L}*/iu]];

// Liczby kontrolne z analizy czatu MULO HUB (26.11.2026) – stan bazy v1.
export const BASELINE = {
  total: 235,
  perCategory: { 'Prawo': 51, 'Bezpieczeństwo': 46, 'Regulaminy': 46, 'Budowa broni': 46, 'Prawo karne': 46 },
  positions: [77, 81, 77],
  strictlyLongest: 140, strictlyLongestOf: 219, ties: 16,
  distinctSrcUrls: 6,
  srcCounts: {
    'regulamin-patent-strzelecki-2025.pdf': 92,
    'pytania-egzaminacyjne-na-patent-strzelcki-1.pdf': 36,
  },
};

/* ---------- wczytanie ---------- */
export function extractArrayLiteral(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`Nie znaleziono „${marker}”`);
  let i = text.indexOf('[', at), depth = 0, inStr = null;
  const start = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") inStr = c;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error(`Niedomknięta tablica po „${marker}”`);
}
export function loadBank(file) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : data.questions;
  }
  return JSON.parse(extractArrayLiteral(text, 'const BANK='));
}

/* ---------- miary ---------- */
const len = s => [...String(s)].length;
const urlsIn = s => String(s || '').match(/https?:\/\/[^\s)"']+/g) || [];
const tokens = s => new Set(String(s).toLowerCase().normalize('NFKC').match(/\p{L}[\p{L}\p{N}]*|\p{N}+/gu) || []);
const pctS = (a, b) => b ? (100 * a / b).toFixed(1).replace('.', ',') + '%' : '–';

export function lengthStats(q) {
  const L = q.options.map(len);
  const max = Math.max(...L), tie = L.filter(x => x === max).length > 1;
  const sorted = [...L].sort((a, b) => b - a);
  const correct = L[q.answer];
  const strictly = !tie && correct === max;
  const second = sorted[1];
  const clearly = strictly && correct >= second * (1 + THRESHOLDS.clearlyLongestRel) && correct - second >= THRESHOLDS.clearlyLongestAbs;
  const min = Math.min(...L);
  const ratio = min >= THRESHOLDS.lengthRatioMinOption ? max / min : null;
  return { tie, strictly, clearly, ratio };
}

export function analyze(bank, { baseline = false } = {}) {
  const errors = [], warnings = [], info = [];
  const where = (q, i) => (q && q.id ? q.id : `#${i + 1}`);

  /* błędy blokujące */
  const ids = new Map(), texts = new Map();
  bank.forEach((q, i) => {
    const w = where(q, i);
    if (!Array.isArray(q.options) || q.options.length !== 3) errors.push(`${w}: liczba opcji ≠ 3 (${Array.isArray(q.options) ? q.options.length : 'brak'})`);
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 2) errors.push(`${w}: answer poza 0–2 (${q.answer})`);
    if (!baseline) {
      if (!q.id || typeof q.id !== 'string') errors.push(`${w}: brak id`);
      else if (ids.has(q.id)) errors.push(`${w}: duplikat id (także ${ids.get(q.id)})`);
      else ids.set(q.id, `#${i + 1}`);
    }
    if (!CATEGORIES.includes(q.cat)) errors.push(`${w}: kategoria spoza listy („${q.cat}”)`);
    if (!String(q.q || '').trim()) errors.push(`${w}: puste q`);
    if (!String(q.why || '').trim()) errors.push(`${w}: puste why`);
    if (!urlsIn(q.src).length) errors.push(`${w}: src bez adresu URL`);
    if (Array.isArray(q.options) && q.options.some(o => !String(o).trim())) errors.push(`${w}: pusta opcja`);
    const t = String(q.q || '').trim().toLowerCase();
    if (t) { if (texts.has(t)) errors.push(`${w}: dokładny duplikat treści pytania (${texts.get(t)})`); else texts.set(t, w); }
  });
  const valid = bank.filter(q => Array.isArray(q.options) && q.options.length === 3 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 2);

  /* przekroje */
  const groups = [['Cała baza', valid], ...CATEGORIES.map(c => [c, valid.filter(q => q.cat === c)])];
  const metrics = {};
  for (const [name, qs] of groups) {
    const s = qs.map(lengthStats);
    const ties = s.filter(x => x.tie).length, noTie = qs.length - ties;
    const m = {
      n: qs.length, ties, noTie,
      strictly: s.filter(x => x.strictly).length,
      clearly: s.filter(x => x.clearly).length,
      positions: [0, 1, 2].map(p => qs.filter(q => q.answer === p).length),
    };
    metrics[name] = m;
    if (!qs.length) continue;
    if (m.clearly / m.n > THRESHOLDS.clearlyLongestMaxShare)
      warnings.push(`[${name}] poprawna „wyraźnie najdłuższa” w ${m.clearly}/${m.n} = ${pctS(m.clearly, m.n)} (próg ≤ 25%)`);
    if (m.n >= THRESHOLDS.positionMinCount) m.positions.forEach((c, p) => {
      const sh = c / m.n;
      if (sh < THRESHOLDS.positionMin || sh > THRESHOLDS.positionMax)
        warnings.push(`[${name}] położenie poprawnej ${'ABC'[p]}: ${c}/${m.n} = ${pctS(c, m.n)} (przedział 28–38%)`);
    });
  }

  /* pojedyncze pytania */
  const ratioList = [], noArt = [], noProvision = [], noStem = [];
  valid.forEach((q, i) => {
    const w = where(q, bank.indexOf(q));
    const { ratio } = lengthStats(q);
    if (ratio !== null && ratio > THRESHOLDS.lengthRatioMax) ratioList.push(`${w} (${ratio.toFixed(2).replace('.', ',')})`);
    if (!String(q.art || '').trim()) noArt.push(w);
    if (!/\bart\.|§|\bust\.|\bpkt\b|rozdz|\bpar\./i.test(String(q.src || '').replace(/https?:\/\/\S+/g, ''))) noProvision.push(w);
    if (q.stem === null || q.stem === undefined || q.stem === '') noStem.push(w);
  });
  if (ratioList.length) warnings.push(`stosunek najdłuższej do najkrótszej opcji > 1,8 w ${ratioList.length} pytaniach: ${ratioList.join(', ')}`);

  /* słowa-sygnały */
  const signal = SIGNAL_WORDS.map(([word, re]) => {
    let inWrong = 0, inCorrect = 0;
    valid.forEach(q => q.options.forEach((o, j) => { if (re.test(o)) { if (j === q.answer) inCorrect++; else inWrong++; } }));
    return { word, inWrong, inCorrect };
  });
  const wrongN = valid.length * 2, correctN = valid.length;

  /* podobne pytania */
  const similar = [];
  for (const c of CATEGORIES) {
    const qs = valid.filter(q => q.cat === c).map(q => ({ q, t: tokens(q.q) }));
    for (let a = 0; a < qs.length; a++) for (let b = a + 1; b < qs.length; b++) {
      const A = qs[a].t, B = qs[b].t; let inter = 0; for (const x of A) if (B.has(x)) inter++;
      const j = inter / (A.size + B.size - inter || 1);
      if (j >= THRESHOLDS.jaccard) similar.push(`${where(qs[a].q, bank.indexOf(qs[a].q))} ~ ${where(qs[b].q, bank.indexOf(qs[b].q))} (${j.toFixed(2).replace('.', ',')})`);
    }
  }
  if (similar.length) warnings.push(`podobne pytania (Jaccard ≥ 0,6, ta sama kategoria): ${similar.length}: ${similar.join('; ')}`);
  if (!baseline) {
    if (noArt.length) warnings.push(`brak art: ${noArt.length} pytań`);
    if (noStem.length) warnings.push(`brak stem: ${noStem.length} pytań`);
  }
  if (noProvision.length) warnings.push(`src bez wskazania konkretnego przepisu: ${noProvision.length} pytań`);

  /* źródła */
  const srcCount = new Map();
  valid.forEach(q => urlsIn(q.src).forEach(u => srcCount.set(u, (srcCount.get(u) || 0) + 1)));

  return { errors, warnings, info, metrics, signal, wrongN, correctN, srcCount, similar, noArt, noStem, noProvision, ratioList };
}

/* ---------- raport ---------- */
export function formatReport(bank, r, { baseline = false } = {}) {
  const out = [];
  const all = r.metrics['Cała baza'];
  out.push(`KONTROLA BAZY PYTAŃ PifPaf${baseline ? ' – tryb --baseline' : ''}`);
  out.push(`Pytań: ${bank.length}`);
  out.push('Kategorie: ' + CATEGORIES.map(c => `${c} ${r.metrics[c].n}`).join(' / '));
  out.push(`Położenie poprawnej A/B/C: ${all.positions.join(' / ')} (${all.positions.map(c => pctS(c, all.n)).join(' / ')})`);
  out.push('');
  out.push('Długość odpowiedzi (przekrój: ściśle najdłuższa bez remisów | wyraźnie najdłuższa ≥20% i ≥8 zn.):');
  for (const [name, m] of Object.entries(r.metrics)) {
    if (!m.n) continue;
    out.push(`  ${name.padEnd(15)} ściśle ${String(m.strictly).padStart(3)}/${m.noTie} = ${pctS(m.strictly, m.noTie).padStart(6)} (remisy ${m.ties}) | wyraźnie ${String(m.clearly).padStart(3)}/${m.n} = ${pctS(m.clearly, m.n)}`);
  }
  out.push(`  (cel dla „ściśle najdłuższa”: < 45%; przy 3 opcjach losowo ≈ 33%)`);
  out.push('');
  out.push(`Słowa-sygnały (odsetek opcji zawierających słowo; błędnych opcji: ${r.wrongN}, poprawnych: ${r.correctN}):`);
  r.signal.forEach(s => out.push(`  ${s.word.padEnd(10)} w błędnych ${String(s.inWrong).padStart(3)} (${pctS(s.inWrong, r.wrongN)}) | w poprawnych ${String(s.inCorrect).padStart(3)} (${pctS(s.inCorrect, r.correctN)})`));
  out.push('');
  out.push(`Źródła (src): ${r.srcCount.size} różnych adresów`);
  [...r.srcCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([u, n]) => out.push(`  ${String(n).padStart(3)} × ${u}`));
  out.push('');
  out.push(`BŁĘDY (blokujące): ${r.errors.length}`);
  r.errors.forEach(e => out.push('  ✗ ' + e));
  out.push(`OSTRZEŻENIA: ${r.warnings.length}`);
  r.warnings.forEach(w => out.push('  ! ' + w));
  return out.join('\n');
}

export function checkBaseline(bank, r) {
  const all = r.metrics['Cała baza'];
  const rows = [];
  const eq = (label, got, want) => rows.push({ label, got, want, ok: JSON.stringify(got) === JSON.stringify(want) });
  eq('liczba pytań', bank.length, BASELINE.total);
  for (const c of CATEGORIES) eq(`kategoria ${c}`, r.metrics[c].n, BASELINE.perCategory[c]);
  eq('położenie A/B/C', all.positions, BASELINE.positions);
  eq('ściśle najdłuższa', all.strictly, BASELINE.strictlyLongest);
  eq('pytania bez remisu', all.noTie, BASELINE.strictlyLongestOf);
  eq('remisy', all.ties, BASELINE.ties);
  eq('udział ściśle najdłuższej', pctS(all.strictly, all.noTie), '63,9%');
  eq('różne adresy src', r.srcCount.size, BASELINE.distinctSrcUrls);
  for (const [frag, want] of Object.entries(BASELINE.srcCounts)) {
    const got = [...r.srcCount.entries()].filter(([u]) => u.endsWith(frag)).reduce((n, [, c]) => n + c, 0);
    eq(`src …/${frag}`, got, want);
  }
  return rows;
}

async function checkLinks(r) {
  const lines = ['SPRAWDZENIE ŹRÓDEŁ (HTTP, nieblokujące):'];
  for (const [u, n] of r.srcCount) {
    let status;
    try {
      let res = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (res.status === 405 || res.status === 403) res = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000) });
      status = `${res.status} ${res.headers.get('content-type') || ''}`.trim();
    } catch (e) { status = 'BŁĄD: ' + (e.cause?.code || e.name); }
    lines.push(`  ${status.padEnd(28)} ${String(n).padStart(3)} × ${u}`);
  }
  return lines.join('\n');
}

/* ---------- CLI ---------- */
async function main(argv) {
  const args = new Set(argv);
  const fileArg = argv.indexOf('--file');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = fileArg >= 0 ? argv[fileArg + 1] : path.join(root, 'index.html');
  const baseline = args.has('--baseline');
  let bank;
  try { bank = loadBank(file); } catch (e) { console.error('Nie udało się wczytać bazy: ' + e.message); return 2; }
  const r = analyze(bank, { baseline });
  console.log(formatReport(bank, r, { baseline }));
  let code = r.errors.length ? 1 : 0;
  if (baseline) {
    const rows = checkBaseline(bank, r);
    console.log('\nPORÓWNANIE Z LICZBAMI KONTROLNYMI (sekcja 2 zlecenia):');
    rows.forEach(x => console.log(`  ${x.ok ? '✓' : '✗'} ${x.label}: ${JSON.stringify(x.got)}${x.ok ? '' : ` (oczekiwano ${JSON.stringify(x.want)})`}`));
    const m = r.metrics['Cała baza'];
    console.log(`  • wartość odniesienia „wyraźnie najdłuższa”: ${m.clearly}/${m.n} = ${pctS(m.clearly, m.n)}`);
    const ok = rows.every(x => x.ok);
    console.log(`WYNIK: baseline=${ok ? 'tak' : 'nie'}`);
    if (!ok) code = 1;
  }
  if (args.has('--strict') && r.warnings.length) code = 1;
  if (args.has('--links')) console.log('\n' + await checkLinks(r));
  console.log(`WYNIK: bledy=${r.errors.length} ostrzezenia=${r.warnings.length}`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(c => process.exit(c));
}
