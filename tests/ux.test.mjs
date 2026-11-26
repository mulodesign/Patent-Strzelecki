// Kryterium 4: ekran „Witaj ponownie” (A3a) i test w toku po odświeżeniu (A3b).
// Środowisko: node:vm + atrapa DOM z tests/harness.mjs (bez jsdom/Playwright), sterowany zegar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, Storage, NO_ANALYTICS } from './harness.mjs';

const MIN = 60 * 1000;
const returning = () => {
  const a = createApp({ storage: new Storage({ ...NO_ANALYTICS, 'pifpaf-visited-v1': '1' }) });
  a.closeOverlay(); // ekran przy otwarciu (jak dotąd) – zamykamy, testujemy powrót z tła
  return a;
};

test('pierwsze otwarcie: bez ekranu; ponowne otwarcie: ekran jak dotąd', () => {
  assert.equal(createApp({ storage: new Storage(NO_ANALYTICS) }).overlayOpen(), false);
  assert.equal(createApp({ storage: new Storage({ ...NO_ANALYTICS, 'pifpaf-visited-v1': '1' }) }).overlayOpen(), true);
});

test('(a) 2 s ukrycia karty → brak ekranu', () => {
  const a = returning();
  a.hide(); a.advance(2000); a.show();
  assert.equal(a.overlayOpen(), false);
});

test('(a) 30 min ukrycia → brak ekranu; 31 min → ekran', () => {
  const a = returning();
  a.hide(); a.advance(30 * MIN); a.show();
  assert.equal(a.overlayOpen(), false);
  a.hide(); a.advance(31 * MIN); a.show();
  assert.equal(a.overlayOpen(), true);
});

test('(a) w trakcie testu ekran się nie pojawia nawet po 31 min', () => {
  const a = returning();
  a.run(`state.examMode='pzss';beginExam()`);
  a.hide(); a.advance(31 * MIN); a.show();
  assert.equal(a.overlayOpen(), false);
});

test('(a) zdarzenie focus jest ignorowane; pageshow z bfcache po 31 min → ekran', () => {
  const a = returning();
  assert.equal((a.listeners.window.focus || []).length, 0);
  a.fire('pagehide'); a.advance(31 * MIN); a.fire('pageshow', { persisted: true });
  assert.equal(a.overlayOpen(), true);
});

test('(a) „Rozpocznij od nowa” jest drugorzędne i oddzielone', () => {
  const a = createApp({ storage: new Storage({ ...NO_ANALYTICS, 'pifpaf-visited-v1': '1' }) });
  const html = a.$('return-overlay').innerHTML;
  assert.match(html, /<div class="return-actions"><button class="btn primary"[^>]*id="return-continue"[^>]*>Kontynuuj naukę<\/button><\/div>/);
  assert.match(html, /<div class="return-secondary">.*id="return-restart"/);
  assert.doesNotMatch(html, /class="btn[^"]*"[^>]*id="return-restart"/);
});

test('(b) odświeżenie w połowie testu → ten sam test, te same odpowiedzi, czas od startu', () => {
  const storage = new Storage(NO_ANALYTICS);
  const a = createApp({ storage });
  a.run(`state.examMode='pzss';beginExam()`);
  const ids = a.run('state.examIds');
  const start = a.run('state.examStart');
  // użytkownik klika odpowiedzi w 5 pierwszych pytaniach
  for (let i = 0; i < 5; i++) {
    a.advance(30 * 1000);
    const btn = a.$$('[data-exam]').find(b => b.dataset.exam === String(i) && b.dataset.answer === String(i % 3));
    btn.onclick();
  }
  a.advance(2 * MIN); // razem 4,5 min od startu
  const b = createApp({ storage, now: a.clock.now });
  assert.equal(b.run('state.page'), 'exam');
  assert.deepEqual(b.run('state.examIds'), ids);
  assert.deepEqual(b.run('JSON.parse(JSON.stringify(state.examAnswers))'), { 0: 0, 1: 1, 2: 2, 3: 0, 4: 1 });
  assert.equal(b.run('state.examStart'), start);
  assert.equal(b.run('state.examMode'), 'pzss');
  assert.equal(b.$('clock').textContent, '15:30');
  assert.equal(b.overlayOpen(), false, 'wznowiony test bez ekranu powrotu');
});

test('(b) odświeżenie po upływie czasu → test zakończony i policzony, stan usunięty', () => {
  const storage = new Storage(NO_ANALYTICS);
  const a = createApp({ storage });
  a.run(`state.examMode='pzss';beginExam();state.examIds.forEach((ix,i)=>{if(i<9)state.examAnswers[i]=BANK[ix].answer});saveActiveExam()`);
  const b = createApp({ storage, now: a.clock.now + 21 * MIN });
  assert.equal(b.run('state.examDone'), true);
  const s = b.run('saved');
  assert.equal(s.activeExam, undefined);
  assert.equal(s.attempts.length, 1);
  assert.equal(s.attempts[0].score, 9);
  assert.equal(s.attempts[0].durationSeconds, 20 * 60);
  assert.match(b.html(), /Cel testu/);
  const c = createApp({ storage, now: b.clock.now + MIN });
  assert.equal(c.run('state.page'), 'start', 'po zakończeniu kolejne otwarcie nie wraca do testu');
});

test('(b) zakończenie testu i zmiana trybu usuwają zapisany stan', () => {
  const a = createApp({ storage: new Storage(NO_ANALYTICS) });
  a.run(`state.examMode='pzss';beginExam();finishExam()`);
  assert.equal(a.run('saved.activeExam'), undefined);
  a.run(`beginExam();selectExamMode('training')`);
  assert.equal(a.run('saved.activeExam'), undefined);
});
