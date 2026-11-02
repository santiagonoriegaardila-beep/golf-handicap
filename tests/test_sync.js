/* Pruebas del merge de 3 vías y del cliente Cloud contra un Supabase simulado. */
const http = require('http');
const Store = require('../store.js');
const Cloud = require('../cloud.js');
const mock = require('./mock_supabase.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
const c = (o) => JSON.parse(JSON.stringify(o));

/* ---------- merge3 ---------- */
const base = {
  settings: { allowance: 1, currency: '$' },
  players: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Beto' }],
  games: [{ id: 'g', scores: { a: [null, null, null], b: [null, null, null] } }]
};

// Dos celulares anotan hoyos/jugadores distintos al tiempo
let L = c(base); L.games[0].scores.a[0] = { strokes: 4 };
let R = c(base); R.games[0].scores.b[1] = { strokes: 5 };
let M = Store.merge3(base, L, R);
eq('scores de ambos se conservan (a)', M.games[0].scores.a[0], { strokes: 4 });
eq('scores de ambos se conservan (b)', M.games[0].scores.b[1], { strokes: 5 });

// Alta de jugador en cada lado
L = c(base); L.players.push({ id: 'c', name: 'Caro' });
R = c(base); R.players.push({ id: 'd', name: 'Dani' });
eq('altas en ambos lados', Store.merge3(base, L, R).players.map(p => p.id), ['a', 'b', 'd', 'c']);

// Borrado local + edición remota de otro
L = c(base); L.players = L.players.filter(p => p.id !== 'b');
R = c(base); R.players[0].name = 'Ana María';
M = Store.merge3(base, L, R);
eq('borrado local respetado', M.players.map(p => p.id), ['a']);
eq('edición remota respetada', M.players[0].name, 'Ana María');

// Borrado local pero el remoto editó ese mismo → se conserva (no perder datos)
L = c(base); L.players = L.players.filter(p => p.id !== 'b');
R = c(base); R.players[1].name = 'Beto2';
eq('borrado vs edición: gana la edición', Store.merge3(base, L, R).players.map(p => p.name), ['Ana', 'Beto2']);

// Mismo campo cambiado en ambos: gana local
L = c(base); L.settings.allowance = 0.9;
R = c(base); R.settings.allowance = 0.8; R.settings.currency = 'COP';
M = Store.merge3(base, L, R);
eq('conflicto mismo campo → local', M.settings.allowance, 0.9);
eq('campo distinto → remoto', M.settings.currency, 'COP');

// Sin cambios locales → remoto tal cual
eq('sin cambios locales', Store.merge3(base, c(base), R), R);

/* ---------- Cloud contra Supabase simulado ---------- */
(async () => {
  const srv = await mock.start(0);
  const cfg = { url: `http://127.0.0.1:${srv.port}`, key: 'test-key', code: 'familia-prueba' };

  eq('familia nueva → null', await Cloud.get(cfg), null);
  const s0 = Store.migrate(null);
  const r1 = await Cloud.save(cfg, 0, s0, 'Santi');
  eq('crear familia rev 1', r1, { ok: true, rev: 1 });

  // Dos celulares parten de rev 1
  const phoneA = c(s0), phoneB = c(s0);
  phoneA.players.push({ id: 'p1', name: 'Papá' });
  phoneB.players.push({ id: 'p2', name: 'Mamá' });
  const ra = await Cloud.saveMerged(cfg, s0, phoneA, 1, 'A');
  eq('A guarda rev 2', ra.rev, 2);
  const rb = await Cloud.saveMerged(cfg, s0, phoneB, 1, 'B');  // conflicto → mezcla
  eq('B mezcla y guarda rev 3', rb.rev, 3);
  const now = await Cloud.get(cfg);
  eq('nube tiene ambos jugadores', now.data.players.map(p => p.id).sort(), ['p1', 'p2']);
  eq('updated_by', now.updated_by, 'B');

  const bad = { ...cfg, code: 'otro-codigo-x' };
  eq('otro código no ve nada', await Cloud.get(bad), null);
  let threw = false;
  try { await Cloud.save({ ...cfg, code: 'corto' }, 0, s0); } catch (e) { threw = true; }
  eq('código corto rechazado', threw, true);
  eq('código sin distinguir mayúsculas/espacios', (await Cloud.get({ ...cfg, code: ' Familia-Prueba ' })).rev, 3);
  srv.changeCode('FAMILIA-PRUEBA', 'CODIGO-NUEVO-1');
  eq('código viejo ya no ve nada', await Cloud.get(cfg), null);
  let retiredErr = null;
  try { await Cloud.save(cfg, 0, s0); } catch (e) { retiredErr = e; }
  eq('código viejo no puede recrear la familia', Cloud.isRetired(retiredErr), true);
  eq('código nuevo conserva los datos', (await Cloud.get({ ...cfg, code: 'codigo-nuevo-1' })).data.players.length, 2);
  eq('canal no revela el código', Cloud.channelName('familia-prueba').includes('familia'), false);

  srv.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
