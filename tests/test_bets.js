const Store = require('../store.js');
const B = require('../bets.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  ok ? pass++ : fail++;
}

/* ---- Ventajas por hoyo ---- */
eq('PH 10 recibe en hoyo hcp 10', B.strokesOnHole(10, 10), 1);
eq('PH 10 no recibe en hoyo hcp 11', B.strokesOnHole(10, 11), 0);
eq('PH 20 recibe 2 en hoyo hcp 2', B.strokesOnHole(20, 2), 2);
eq('PH 20 recibe 1 en hoyo hcp 3', B.strokesOnHole(20, 3), 1);
eq('PH +2 devuelve en hoyo hcp 18', B.strokesOnHole(-2, 18), -1);
eq('PH +2 no devuelve en hoyo hcp 16', B.strokesOnHole(-2, 16), 0);

/* ---- Logros (gross) ---- */
const pars = Array(18).fill(4);
const bajo = { pars, category: 'bajo' }, alto = { pars, category: 'alto' };
eq('bajo birdie = 1', B.achievements(bajo, 0, { strokes: 3 }).birdie, 1);
eq('bajo águila = 2', B.achievements(bajo, 0, { strokes: 2 }).birdie, 2);
eq('bajo par = 0 birdie', B.achievements(bajo, 0, { strokes: 4 }).birdie, 0);
eq('alto par = 1', B.achievements(alto, 0, { strokes: 4 }).birdie, 1);
eq('alto birdie = 2', B.achievements(alto, 0, { strokes: 3 }).birdie, 2);
eq('bajo sandy par', B.achievements(bajo, 0, { strokes: 4, bunker: true }).sandy, 1);
eq('bajo bogey desde bunker no es sandy', B.achievements(bajo, 0, { strokes: 5, bunker: true }).sandy, 0);
eq('alto sandy bogey', B.achievements(alto, 0, { strokes: 5, bunker: true }).sandy, 1);
eq('bajo paraguas (par tras agua)', B.achievements(bajo, 0, { strokes: 4, water: true }).paraguas, 1);
eq('alto paraguas (bogey tras agua)', B.achievements(alto, 0, { strokes: 5, water: true }).paraguas, 1);
eq('alto doble bogey tras agua no', B.achievements(alto, 0, { strokes: 6, water: true }).paraguas, 0);

/* ---- Ronda completa ---- */
const state = Store.migrate(null);
const course = state.courses[0];
course.tees.forEach(t => { t.cr = 72; t.slope = 113; t.pars = [...pars]; });
const ids = ['A', 'B', 'C', 'D'];
state.players = ids.map(id => ({ id, name: 'Jugador ' + id }));
const game = {
  id: 'g1', date: '2026-11-02', courseId: course.id, status: 'en juego',
  settings: { ...state.settings },
  players: ids.map(id => ({ playerId: id, teeId: 'blancas', index: 0 })),
  bets: B.defaultBets(),
  scores: {}
};
// Todos scratch (PH 0). A hace 3 en todos, B 4, C 4, D 5. putts 2.
const strokes = { A: 3, B: 4, C: 4, D: 5 };
ids.forEach(id => { game.scores[id] = Array.from({ length: 18 }, () => ({ strokes: strokes[id], putts: 2 })); });
// Empate de putts → nadie gana putts. Mejora: D hace 1 putt en hoyo 1
game.scores.D[0].putts = 1;

const r = B.computeGame(state, game);
const seg1 = r.robin.groups[0].segments[0]; // A+B vs C+D
// por hoyo: suma 7 vs 9 → A; baja 3 vs 4 → A; birdie A=1. Hoyo 1 putts: 4 vs 3 → CD
eq('Robin seg1 puntos', seg1.points, [6 * 3, 1]);
eq('Robin seg1 dinero A', seg1.money.A, 17 * 5000);
eq('Robin suma cero', Object.values(r.robin.groups[0].money).reduce((a, b) => a + b, 0), 0);

// War: A gana todos los hoyos → match, medal; putts: D (35) vs 36 → D
const mFront = r.war.bets.find(b => b.type === 'match' && b.segment === 'front');
eq('Match 9 ganador A', mFront.winner, 'A');
eq('Match 9 dinero A (3 rivales × 10000)', mFront.money.A, 30000);
const pTotal = r.war.bets.find(b => b.type === 'putts' && b.segment === 'total');
eq('Putts total ganador D', pTotal.winner, 'D');
const pBack = r.war.bets.find(b => b.type === 'putts' && b.segment === 'back');
eq('Putts segundos 9: empate muere', pBack.status, 'muere');
eq('Suma cero total', Math.round(Object.values(r.totals).reduce((a, b) => a + b, 0)), 0);
eq('Transfers cuadran', r.transfers.reduce((a, t) => a + t.amount, 0),
  Object.values(r.totals).filter(v => v > 0).reduce((a, b) => a + b, 0));

// Ventaja: D con index 18 → PH 18 → neto 4 en todos → empata con B y C en neto
game.players[3].index = 18;
const r2 = B.computeGame(state, game);
eq('PH de D = 18', r2.players[3].playingHcp, 18);
eq('Neto total D = 72', r2.players[3].card.total.net, 72);
eq('D categoría alto? (18 no es > 18)', r2.players[3].category, 'bajo');

// Match incompleto queda en juego
game.scores.A[17] = null;
const r3 = B.computeGame(state, game);
eq('Match total en juego', r3.war.bets.find(b => b.type === 'match' && b.segment === 'total').status, 'en juego');

// Migración v1 → v2
const v1 = { players: [{ id: 'p1', name: 'Santi' }], courses: [{ id: 'c1', name: 'X', cr: 71, slope: 125, pars, holeHcps: Store.DEFAULT_HOLE_HCPS }], rounds: [] };
const m = Store.migrate(v1);
eq('Migración crea marca blancas', m.courses[0].tees[0].id, 'blancas');
eq('Migración versión 2', m.version, 2);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
