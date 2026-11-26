// Jednorazowo: generuje fixture postępu w formacie v1 KODEM v1 (index.html z gałęzi main, commit 5c4104b).
// Użycie: git show 5c4104b:index.html > /tmp/v1.html && node tests/fixtures/make_v1_fixture.mjs /tmp/v1.html
import { readFileSync, writeFileSync } from 'node:fs';
import { createApp, Storage, NO_ANALYTICS, scriptFrom } from '../harness.mjs';
let seed = 42; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const app = createApp({ script: scriptFrom(readFileSync(process.argv[2], 'utf8')), storage: new Storage(NO_ANALYTICS), random });
app.run(`
  [[0,true],[5,false],[17,true],[40,false],[99,true],[120,true],[150,false],[200,true],[234,false]].forEach(([i,c])=>mark(i,c));
  updateReview(3,'good');updateReview(17,'easy');updateReview(150,'again');updateReview(60,'good');
  mark(60,false);
  state.examMode='pzss';beginExam();state.examIds.forEach((id,i)=>state.examAnswers[i]=i%3);finishExam();
  state.examMode='training';beginExam();state.examIds.forEach((id,i)=>state.examAnswers[i]=BANK[id].answer);finishExam();
  beginFlash('all');rateFlash('good');rateFlash('again');
`);
const raw = app.storage.getItem('patent-pzss-progress-v1');
const v1 = JSON.parse(raw);
const text = i => app.run(`BANK[${i}].q`);
const keyText = new Map(app.run('BANK.map(q=>[questionKey(q),q.q])'));
const expected = {
  seen: [...new Set([...v1.seen.map(text), ...v1.seenKeys.map(k => keyText.get(k))])].sort(),
  mistakes: v1.mistakes.map(text).sort(),
  reviews: Object.fromEntries(Object.entries(v1.reviews).map(([k, r]) => [keyText.get(k), r])),
  examUsed: Object.fromEntries(Object.entries(v1.examUsed).map(([m, byC]) => [m, Object.fromEntries(Object.entries(byC).map(([c, l]) => [c, l.map(text).sort()]))])),
  flash: { texts: v1.flashSession.keys.map(k => keyText.get(k)), at: v1.flashSession.at, mode: v1.flashSession.mode },
  attempts: v1.attempts.length,
};
writeFileSync(new URL('./progress-v1.json', import.meta.url), JSON.stringify({ note: 'Wygenerowane kodem v1 (commit 5c4104b) przez make_v1_fixture.mjs', storage: { 'patent-pzss-progress-v1': raw }, expected }, null, 1));
console.log('seen', expected.seen.length, 'mistakes', expected.mistakes.length, 'reviews', Object.keys(expected.reviews).length, 'attempts', expected.attempts, 'flash', expected.flash.texts.length);
