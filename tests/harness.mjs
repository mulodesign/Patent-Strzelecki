// Lekkie środowisko testowe: uruchamia skrypt z index.html w node:vm z prostą atrapą DOM.
// Bez zależności (jsdom/Playwright nie są potrzebne). Sterowany zegar, localStorage w pamięci,
// fetch rejestruje wywołania (żadne dane nie wychodzą do sieci).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function scriptFrom(html) {
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!m.length) throw new Error('Brak <script> w index.html');
  return m[m.length - 1][1];
}
export const currentScript = () => scriptFrom(readFileSync(path.join(ROOT, 'index.html'), 'utf8'));

export class Storage {
  constructor(init = {}) { this.m = new Map(Object.entries(init)); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  snapshot() { return Object.fromEntries(this.m); }
}

function makeEl(doc, tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(), id: '', className: '', textContent: '', value: '', hidden: false, disabled: false,
    style: {}, dataset: {}, attrs: {}, children: [], onclick: null,
    classList: { _s: new Set(), add(...c) { c.forEach(x => this._s.add(x)); }, remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { this.children.push(c); if (c.id) doc._attached.set(c.id, c); return c; },
    remove() { if (this.id) doc._attached.delete(this.id); },
    addEventListener() {}, focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    reset() {},
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: v => { html = String(v); doc._version++; } });
  return el;
}

export function createApp({ script = currentScript(), storage = new Storage(), now = Date.UTC(2026, 10, 26, 12, 0, 0), random } = {}) {
  const clock = { now };
  const listeners = { document: {}, window: {} };
  const fetchCalls = [];
  const timers = [];
  const doc = { _attached: new Map(), _version: 0, _byKey: new Map(), _byKeyVersion: -1, visibilityState: 'visible' };
  const app = makeEl(doc); app.id = 'app';
  const body = makeEl(doc, 'body');
  const htmlPool = () => [app.innerHTML, ...[...doc._attached.values()].map(e => e.innerHTML)].join('\n');
  const stub = id => { if (!doc._byKey.has('#' + id)) { const e = makeEl(doc); e.id = id; doc._byKey.set('#' + id, e); } return doc._byKey.get('#' + id); };
  const fresh = () => { if (doc._byKeyVersion !== doc._version) { doc._byKey = new Map(); doc._byKeyVersion = doc._version; } };
  Object.assign(doc, {
    body,
    getElementById(id) {
      if (id === 'app') return app;
      if (doc._attached.has(id)) return doc._attached.get(id);
      fresh();
      if (id === 'privacy-open' || htmlPool().includes(`id="${id}"`)) return stub(id);
      return null;
    },
    querySelectorAll(sel) {
      fresh();
      const attr = (sel.match(/^\[([a-z-]+)\]$/) || [])[1];
      if (!attr) return [];
      const key = 'qsa' + sel;
      if (!doc._byKey.has(key)) {
        const tags = htmlPool().match(new RegExp(`<[^>]*\\b${attr}="[^"]*"[^>]*>`, 'g')) || [];
        doc._byKey.set(key, tags.map(t => {
          const e = makeEl(doc, 'button');
          for (const [, k, v] of t.matchAll(/\bdata-([a-z-]+)="([^"]*)"/g)) e.dataset[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
          return e;
        }));
      }
      return doc._byKey.get(key);
    },
    createElement: tag => makeEl(doc, tag),
    addEventListener(t, f) { (listeners.document[t] ||= []).push(f); },
  });
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock.now])); }
    static now() { return clock.now; }
  }
  const ctx = {
    console, Math: random ? Object.assign(Object.create(Math), { random }) : Math, JSON, Map, Set, Number, String, Object, Array, Boolean, Error, Promise, RegExp, Symbol, Intl,
    Date: FakeDate,
    localStorage: storage,
    document: doc,
    navigator: {},
    crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(16).slice(2) },
    fetch: (...a) => { fetchCalls.push(a); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: () => {},
    confirm: () => true,
    alert: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    scrollTo: () => {},
    addEventListener: (t, f) => { (listeners.window[t] ||= []).push(f); },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx, { filename: 'index.html' });
  const api = {
    ctx, storage, clock, fetchCalls,
    // wynik kopiowany przez JSON: obiekty z innego „realm” vm nie przechodzą assert.deepStrictEqual
    run: code => { const v = vm.runInContext(code, ctx); return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; },
    advance: ms => { clock.now += ms; },
    hide() { doc.visibilityState = 'hidden'; (listeners.document.visibilitychange || []).forEach(f => f()); },
    show() { doc.visibilityState = 'visible'; (listeners.document.visibilitychange || []).forEach(f => f()); },
    fire: (t, ev = {}) => (listeners.window[t] || []).forEach(f => f(ev)),
    listeners,
    overlayOpen: () => doc._attached.has('return-overlay'),
    closeOverlay: () => doc._attached.delete('return-overlay'),
    html: () => app.innerHTML,
    $: id => doc.getElementById(id),
    $$: sel => doc.querySelectorAll(sel),
  };
  return api;
}

export const NO_ANALYTICS = { 'patent-analityka-zgoda-v1': 'no' };
