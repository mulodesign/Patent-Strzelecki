#!/usr/bin/env node
// Kontrola jakości bazy pytań PifPaf. Node (>=18), bez zależności.
//
//   node tools/check_bank.mjs                 – pełny raport; kod wyjścia 1 przy błędach
//   node tools/check_bank.mjs --baseline      – porównanie z liczbami kontrolnymi (stan v1, 26.11.2026)
//   node tools/check_bank.mjs --strict        – wszystkie ostrzeżenia blokują
//   node tools/check_bank.mjs --gate          – progi B3 dla pytań „nowe” blokują (Etap B)
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

// Adresy src zmienione świadomie po v1 (Etap B, decyzja czatu 26.11.2026): stary plik → aktualny tekst jednolity.
// --baseline liczy je jako ten sam adres, żeby liczby kontrolne v1 nadal były sprawdzalne.
export const SRC_RENAMED = { 'regulamin-patent-strzelecki-2025.pdf': 'regulamin-patentowy-tekst-jednolity-uchw-47.pdf' };

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
    if (!String(q.art || '').trim() && !/\bart\.|§|\bust\.|\bpkt\b|rozdz|\bpar\./i.test(String(q.src || '').replace(/https?:\/\/\S+/g, ''))) noProvision.push(w);
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
    const names = [frag, ...(SRC_RENAMED[frag] ? [SRC_RENAMED[frag]] : [])];
    const got = [...r.srcCount.entries()].filter(([u]) => names.some(f => u.endsWith(f))).reduce((n, [, c]) => n + c, 0);
    eq(`src …/${frag}`, got, want);
  }
  return rows;
}

/* ---------- Etap B: schemat v2 i bramka jakości dla pytań „nowe” ---------- */
export const V2_FIELDS = ['id', 'stem', 'topic', 'variant', 'cat', 'diff', 'q', 'options', 'answer', 'art', 'why', 'src', 'status'];
export const statusOf = q => q.status || 'stare';

// Schemat rekordu wg DO_CLAUDE/pifpaf/STANDARD_PYTAN.md §5 (partie od czatu).
export function validateV2Record(q, i = 0) {
  const w = q && q.id ? q.id : `#${i + 1}`, e = [];
  if (!q || typeof q !== 'object' || Array.isArray(q)) return [`${w}: rekord nie jest obiektem`];
  for (const f of V2_FIELDS) if (!(f in q)) e.push(`${w}: brak pola ${f}`);
  for (const f of Object.keys(q)) if (!V2_FIELDS.includes(f)) e.push(`${w}: nieznane pole ${f}`);
  if (typeof q.id !== 'string' || !/^B\d{2}-\d{3}$/.test(q.id)) e.push(`${w}: id poza wzorcem Bnn-nnn`);
  if (q.stem !== null && !(Number.isInteger(q.stem) && q.stem >= 1 && q.stem <= 142)) e.push(`${w}: stem poza 1–142 i nie null`);
  if (typeof q.topic !== 'string' || !q.topic.trim()) e.push(`${w}: puste topic`);
  if (!Number.isInteger(q.variant) || q.variant < 1) e.push(`${w}: variant nie jest liczbą ≥ 1`);
  if (![1, 2, 3].includes(q.diff)) e.push(`${w}: diff poza 1–3`);
  if (!Array.isArray(q.options) || q.options.length !== 3) e.push(`${w}: liczba opcji ≠ 3`);
  if (!String(q.art || '').trim()) e.push(`${w}: brak art`);
  if (!String(q.why || '').trim()) e.push(`${w}: brak why`);
  if (!String(q.src || '').trim()) e.push(`${w}: brak src`);
  if (q.status !== 'nowe') e.push(`${w}: status ≠ „nowe”`);
  return e;
}

// Progi blokujące z Etapu B (B3) liczone dla zestawu pytań „nowe” (partii albo całej puli nowych).
export function gateNew(qs) {
  const fails = [];
  const r = analyze(qs);
  fails.push(...r.errors);
  qs.forEach((q, i) => {
    const w = q.id || `#${i + 1}`;
    if (!String(q.art || '').trim()) fails.push(`${w}: brak art`);
    if (!String(q.why || '').trim()) fails.push(`${w}: brak why`);
    if (!String(q.src || '').trim()) fails.push(`${w}: brak src`);
  });
  const m = r.metrics['Cała baza'];
  if (m.n && m.clearly / m.n > THRESHOLDS.clearlyLongestMaxShare)
    fails.push(`poprawna „wyraźnie najdłuższa” w ${m.clearly}/${m.n} = ${pctS(m.clearly, m.n)} (próg ≤ 25%)`);
  if (m.n >= THRESHOLDS.positionMinCount) m.positions.forEach((c, p) => {
    const sh = c / m.n;
    if (sh < THRESHOLDS.positionMin || sh > THRESHOLDS.positionMax) fails.push(`położenie poprawnej ${'ABC'[p]}: ${c}/${m.n} = ${pctS(c, m.n)} (przedział 28–38%)`);
  });
  if (r.ratioList.length) fails.push(`stosunek długości opcji > 1,8: ${r.ratioList.join(', ')}`);
  return { ok: fails.length === 0, fails, metrics: m, analysis: r };
}

export function formatGate(g, label = 'nowe') {
  const m = g.metrics;
  return [
    `BRAMKA JAKOŚCI (Etap B, B3) – pytania „${label}”: ${m.n}`,
    `  położenie A/B/C: ${m.positions.join(' / ')} (${m.positions.map(c => pctS(c, m.n)).join(' / ')}) – próg 28–38%${m.n < THRESHOLDS.positionMinCount ? ' (nieoceniane: < 30 pytań)' : ''}`,
    `  wyraźnie najdłuższa: ${m.clearly}/${m.n} = ${pctS(m.clearly, m.n)} – próg ≤ 25%`,
    `  ściśle najdłuższa (informacyjnie): ${m.strictly}/${m.noTie} = ${pctS(m.strictly, m.noTie)} – cel < 45%`,
    `  stosunek długości > 1,8: ${g.analysis.ratioList.length} pytań`,
    ...g.fails.map(f => '  ✗ ' + f),
    `WYNIK: bramka_${label}=${g.ok ? 'tak' : 'nie'}`,
  ].join('\n');
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
  let full;
  try { full = loadBank(file); } catch (e) { console.error('Nie udało się wczytać bazy: ' + e.message); return 2; }
  // --baseline liczy wyłącznie pytania z v1 (status „stare”), żeby po dopisaniu partii nadal sprawdzał liczby kontrolne.
  const bank = baseline ? full.filter(q => statusOf(q) === 'stare') : full;
  const r = analyze(bank, { baseline });
  console.log(formatReport(bank, r, { baseline }));
  let code = r.errors.length ? 1 : 0;
  if (!baseline) {
    const by = {};
    full.forEach(q => { by[statusOf(q)] = (by[statusOf(q)] || 0) + 1; });
    console.log('\nStatusy: ' + Object.entries(by).map(([s, n]) => `${s} ${n}`).join(' / '));
    const nowe = full.filter(q => statusOf(q) === 'nowe');
    const schema = nowe.flatMap(validateV2Record);
    if (schema.length) { console.log('BŁĘDY SCHEMATU (nowe):\n' + schema.map(x => '  ✗ ' + x).join('\n')); code = 1; }
    if (nowe.length) {
      const g = gateNew(nowe);
      console.log(formatGate(g));
      if (args.has('--gate') && !g.ok) code = 1;
    }
  }
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
