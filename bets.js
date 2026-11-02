/* ============================================================
 * bets.js — Motor de apuestas (Robin + War) y liquidación
 *
 * Funciones PURAS: reciben el estado y una ronda (game), devuelven
 * resultados. No tocan el DOM ni localStorage. Las usan la interfaz
 * (window.Bets) y el CLI para agentes (cli.js).
 *
 * Reglas completas en docs/REGLAS.md
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./handicap.js'), require('./store.js'));
  } else {
    root.Bets = factory(root, root.Store);
  }
})(typeof self !== 'undefined' ? self : this, function (H, Store) {
  'use strict';

  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /** Segmentos del War (match, medal y putts se juegan en los 3). */
  const WAR_SEGMENTS = [
    { key: 'front', label: 'Primeros 9', holes: range(0, 9) },
    { key: 'back',  label: 'Segundos 9', holes: range(9, 18) },
    { key: 'total', label: 'Total 18',   holes: range(0, 18) }
  ];
  const WAR_TYPES = [
    { key: 'match', label: 'Match' },
    { key: 'medal', label: 'Medal' },
    { key: 'putts', label: 'Putts' }
  ];

  /** Robin: 3 bloques de 6 hoyos con parejas rotativas. */
  const ROBIN_SEGMENTS = [range(0, 6), range(6, 12), range(12, 18)];
  const ROBIN_POINTS = [
    { key: 'suma',     label: 'Suma',     kind: 'duelo' },
    { key: 'putts',    label: 'Putts',    kind: 'duelo' },
    { key: 'baja',     label: 'Baja',     kind: 'duelo' },
    { key: 'sandy',    label: 'Sandy',    kind: 'logro' },
    { key: 'birdie',   label: 'Birdie',   kind: 'logro' },
    { key: 'paraguas', label: 'Paraguas', kind: 'logro' }
  ];

  function defaultBets() {
    return {
      robin: {
        enabled: true,
        segmentValue: 10000,   // "la base": la gana cada jugador del equipo que gana el bloque de 6 hoyos
        pointValue: 2000,      // valor de cada punto de diferencia en el bloque
        pairingMode: 'manual', // 'manual' (se definen en el campo) | 'auto' (por orden)
        pairings: [],          // manual: por grupo [bloque1, bloque2] = [[a,b],[c,d]]; el bloque 3 es lo que queda
        puttsMode: 'suma',     // 'suma' (putts del equipo) | 'baja' (mejor putts)
        groups: []             // [[p1,p2,p3,p4], ...] vacío = automático en orden
      },
      war: {
        enabled: true,
        participants: [],      // vacío = todos los jugadores de la ronda
        match: { front: 10000, back: 10000, total: 20000 },
        medal: { front: 10000, back: 10000, total: 20000 },
        putts: { front: 5000,  back: 5000,  total: 10000 }
      }
    };
  }

  /* ---------------- Ventajas ---------------- */

  /** Golpes que recibe un jugador con handicap `hcp` en un hoyo de hándicap `holeHcp` (1–18).
   *  Handicap "plus" (negativo) devuelve golpes en los hoyos más fáciles. */
  function strokesOnHole(hcp, holeHcp) {
    hcp = Math.round(Number(hcp) || 0);
    if (hcp === 0) return 0;
    if (hcp > 0) return Math.floor(hcp / 18) + ((hcp % 18) >= holeHcp ? 1 : 0);
    const p = -hcp;
    return -(Math.floor(p / 18) + (holeHcp > 18 - (p % 18) ? 1 : 0));
  }

  /** Playing Handicap = round(Course Handicap × allowance), con CR/Slope/Par de SU marca. */
  function playingHandicapFor(index, tee, allowance) {
    if (index == null || index === '' || isNaN(index) || !tee) return 0;
    const ch = H.courseHandicap(Number(index), tee.slope, tee.cr, Store.parTotal(tee));
    return Math.round(ch * (allowance == null ? 1 : Number(allowance)));
  }

  function categoryFor(ph, threshold) { return ph > threshold ? 'alto' : 'bajo'; }

  function gameSettings(state, game) {
    return { ...Store.DEFAULT_SETTINGS, ...(state.settings || {}), ...(game.settings || {}) };
  }

  /** Datos efectivos de cada jugador en la ronda (marca, PH, categoría). */
  function resolvePlayers(state, game) {
    const course = state.courses.find(c => c.id === game.courseId);
    const settings = gameSettings(state, game);
    return game.players.map(gp => {
      const tee = Store.teeOf(course, gp.teeId);
      const player = state.players.find(p => p.id === gp.playerId);
      const auto = playingHandicapFor(gp.index, tee, settings.allowance);
      const hasOverride = gp.playingHcp != null && gp.playingHcp !== '' && !isNaN(gp.playingHcp);
      const ph = hasOverride ? Math.round(Number(gp.playingHcp)) : auto;
      return {
        playerId: gp.playerId,
        name: player ? player.name : (gp.name || '?'),
        teeId: tee.id, teeName: tee.name, teeColor: tee.color,
        pars: tee.pars, holeHcps: tee.holeHcps,
        index: gp.index == null ? null : Number(gp.index),
        autoPlayingHcp: auto,
        playingHcp: ph,
        category: gp.category || categoryFor(ph, settings.highHcpThreshold)
      };
    });
  }

  /** Contexto de ventajas para un subconjunto de jugadores (grupo de robin o war). */
  function makeCtx(resolved, ids, mode) {
    const sub = ids.map(id => resolved.find(p => p.playerId === id)).filter(Boolean);
    const min = mode === 'offLow' && sub.length ? Math.min(...sub.map(p => p.playingHcp)) : 0;
    const ctx = {};
    sub.forEach(p => {
      const eff = p.playingHcp - min;
      ctx[p.playerId] = { ...p, effHcp: eff, strokes: p.holeHcps.map(hh => strokesOnHole(eff, hh)) };
    });
    return ctx;
  }

  function scoreOf(game, playerId, h) {
    const s = game.scores && game.scores[playerId] && game.scores[playerId][h];
    return s && Number(s.strokes) > 0 ? s : null;
  }
  const hasPutts = (s) => s && s.putts != null && s.putts !== '' && !isNaN(s.putts);

  /* ---------------- Logros (gross, sin ventaja) ---------------- */

  /** Puntos de logro de un jugador en un hoyo. Todo es GROSS.
   *  bajo: sandy = par desde bunker · birdie 1 pt, águila 2 pts (cada golpe bajo par suma)
   *        paraguas = par gross tras echarla al agua
   *  alto: sandy = bogey (o mejor) desde bunker · par 1 pt, birdie 2 pts
   *        paraguas = bogey (o mejor) tras agua */
  function achievements(p, h, score) {
    const par = p.pars[h];
    const g = Number(score.strokes);
    const alto = p.category === 'alto';
    const tol = alto ? 1 : 0;
    const under = par - g;
    return {
      sandy: score.bunker && g <= par + tol ? 1 : 0,
      birdie: alto ? (under >= 0 ? under + 1 : 0) : (under >= 1 ? under : 0),
      paraguas: score.water && g <= par + tol ? 1 : 0
    };
  }

  /* ---------------- ROBIN ---------------- */

  function robinPairings(g) {
    return [
      [[g[0], g[1]], [g[2], g[3]]],   // hoyos 1–6
      [[g[0], g[2]], [g[1], g[3]]],   // hoyos 7–12
      [[g[0], g[3]], [g[1], g[2]]]    // hoyos 13–18
    ];
  }

  /** Compañero de `id` en un emparejamiento [[a,b],[c,d]]. */
  function partnerOf(pairing, id) {
    const t = pairing.find(team => team.includes(id));
    return t ? t.find(x => x !== id) : null;
  }

  /** Emparejamiento a partir del compañero del primer jugador del grupo. */
  function pairingFromPartner(g, partner) {
    const a = [g[0], partner];
    return [a, g.filter(id => !a.includes(id))];
  }

  function validPairing(p, g) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(t => Array.isArray(t) && t.length === 2)) return false;
    const ids = p.flat();
    return new Set(ids).size === 4 && g.every(id => ids.includes(id));
  }

  /** Parejas de los 3 bloques de un grupo. En modo manual:
   *  bloque 1 y 2 los define la familia en el campo (null = por definir);
   *  el bloque 3 es la combinación que queda. */
  function robinPairingsFor(cfg, gi, g) {
    if (!cfg || cfg.pairingMode !== 'manual') return robinPairings(g);
    const man = (cfg.pairings && cfg.pairings[gi]) || [];
    const key = (p) => partnerOf(p, g[0]);
    const p1 = validPairing(man[0], g) ? pairingFromPartner(g, key(man[0])) : null;
    const p2 = p1 && validPairing(man[1], g) && key(man[1]) !== key(p1) ? pairingFromPartner(g, key(man[1])) : null;
    const p3 = p1 && p2 ? pairingFromPartner(g, g.slice(1).find(id => id !== key(p1) && id !== key(p2))) : null;
    return [p1, p2, p3];
  }

  /** Opciones válidas para el bloque `si` (0 o 1) dadas las parejas ya puestas. */
  function robinPairingOptions(cfg, gi, g, si) {
    const all = robinPairings(g);
    if (si === 0) return all;
    const cur = robinPairingsFor({ ...cfg, pairingMode: 'manual' }, gi, g);
    if (!cur[0]) return [];
    return all.filter(p => partnerOf(p, g[0]) !== partnerOf(cur[0], g[0]));
  }

  function robinGroups(game) {
    const cfg = game.bets && game.bets.robin;
    const ids = game.players.map(p => p.playerId);
    let groups = cfg && cfg.groups && cfg.groups.length ? cfg.groups : [];
    if (!groups.length) for (let i = 0; i + 4 <= ids.length; i += 4) groups.push(ids.slice(i, i + 4));
    return groups.filter(g => g.length === 4 && g.every(id => ids.includes(id)));
  }

  const emptyPts = () => Object.fromEntries(ROBIN_POINTS.map(p => [p.key, 0]));

  function duel(pts, key, a, b) {
    if (a == null || b == null || a === b) return;
    pts[a < b ? 0 : 1][key] = 1;
  }

  function robinSegment(game, ctx, teams, holes, cfg) {
    const val = Number(cfg.pointValue) || 0;
    const bonus = Number(cfg.segmentValue) || 0;
    if (!teams) {
      const ids = Object.keys(ctx);
      return {
        holes: [holes[0] + 1, holes[holes.length - 1] + 1], teams: null,
        totals: [emptyPts(), emptyPts()], points: [0, 0], diff: 0, played: 0, complete: false,
        status: 'sin parejas', perHole: [], money: Object.fromEntries(ids.map(id => [id, 0]))
      };
    }
    const totals = [emptyPts(), emptyPts()];
    const perHole = [];
    let played = 0;

    holes.forEach(h => {
      const ids = teams.flat();
      const sc = Object.fromEntries(ids.map(id => [id, scoreOf(game, id, h)]));
      if (ids.some(id => !sc[id])) { perHole.push({ hole: h + 1, played: false }); return; }
      played++;
      const allPutts = ids.every(id => hasPutts(sc[id]));
      const t = teams.map(team => {
        const nets = team.map(id => sc[id].strokes - ctx[id].strokes[h]);
        const putts = team.map(id => Number(sc[id].putts));
        const ach = team.map(id => achievements(ctx[id], h, sc[id]));
        return {
          nets,
          netSum: sum(nets),
          bestNet: Math.min(...nets),
          putts: allPutts ? (cfg.puttsMode === 'baja' ? Math.min(...putts) : sum(putts)) : null,
          sandy: sum(ach.map(a => a.sandy)),
          birdie: sum(ach.map(a => a.birdie)),
          paraguas: sum(ach.map(a => a.paraguas))
        };
      });
      const pts = [emptyPts(), emptyPts()];
      duel(pts, 'suma', t[0].netSum, t[1].netSum);
      duel(pts, 'putts', t[0].putts, t[1].putts);
      duel(pts, 'baja', t[0].bestNet, t[1].bestNet);
      ['sandy', 'birdie', 'paraguas'].forEach(k => { pts[0][k] = t[0][k]; pts[1][k] = t[1][k]; });
      [0, 1].forEach(i => ROBIN_POINTS.forEach(p => { totals[i][p.key] += pts[i][p.key]; }));
      perHole.push({ hole: h + 1, played: true, teams: t, points: pts, total: [sum(Object.values(pts[0])), sum(Object.values(pts[1]))] });
    });

    const ptsA = sum(Object.values(totals[0]));
    const ptsB = sum(Object.values(totals[1]));
    const diff = ptsA - ptsB;
    const complete = played === holes.length;
    const bonusSign = complete && diff !== 0 ? Math.sign(diff) : 0;
    const perPlayerA = diff * val + bonusSign * bonus;
    const money = {};
    teams[0].forEach(id => { money[id] = perPlayerA; });
    teams[1].forEach(id => { money[id] = -perPlayerA; });

    return {
      holes: [holes[0] + 1, holes[holes.length - 1] + 1],
      teams, totals, points: [ptsA, ptsB], diff,
      played, complete,
      status: complete ? (diff === 0 ? 'empate' : 'terminado') : (played ? 'en juego' : 'pendiente'),
      perHole, money
    };
  }

  function computeRobin(state, game, resolved, settings) {
    const cfg = game.bets && game.bets.robin;
    if (!cfg || !cfg.enabled) return null;
    const groups = robinGroups(game);
    const inRobin = new Set(groups.flat());
    return {
      config: cfg,
      excluded: game.players.map(p => p.playerId).filter(id => !inRobin.has(id)),
      groups: groups.map((g, gi) => {
        const ctx = makeCtx(resolved, g, settings.strokeMode);
        const pairings = robinPairingsFor(cfg, gi, g);
        const segments = ROBIN_SEGMENTS.map((holes, si) => robinSegment(game, ctx, pairings[si], holes, cfg));
        const money = Object.fromEntries(g.map(id => [id, 0]));
        segments.forEach(s => Object.entries(s.money).forEach(([id, v]) => { money[id] += v; }));
        return { players: g, segments, money };
      })
    };
  }

  /* ---------------- WAR (match / medal / putts) ---------------- */

  function soleBest(ids, values, better) {
    const vals = ids.map(id => values[id]).filter(v => v != null);
    if (!vals.length) return { best: null, leaders: [] };
    const best = better === 'min' ? Math.min(...vals) : Math.max(...vals);
    return { best, leaders: ids.filter(id => values[id] === best) };
  }

  function warBet(game, ctx, ids, seg, type, price) {
    const done = seg.holes.filter(h => ids.every(id => scoreOf(game, id, h)));
    const complete = done.length === seg.holes.length;
    const values = {};
    const holeWinners = [];

    if (type === 'match') {
      ids.forEach(id => { values[id] = 0; });
      done.forEach(h => {
        const nets = Object.fromEntries(ids.map(id => [id, scoreOf(game, id, h).strokes - ctx[id].strokes[h]]));
        const { leaders } = soleBest(ids, nets, 'min');
        const w = leaders.length === 1 ? leaders[0] : null;
        if (w) values[w]++;
        holeWinners.push({ hole: h + 1, winner: w });
      });
    } else if (type === 'medal') {
      ids.forEach(id => { values[id] = sum(done.map(h => scoreOf(game, id, h).strokes - ctx[id].strokes[h])); });
    } else { // putts (gross)
      ids.forEach(id => {
        values[id] = done.every(h => hasPutts(scoreOf(game, id, h)))
          ? sum(done.map(h => Number(scoreOf(game, id, h).putts))) : null;
      });
    }

    const better = type === 'match' ? 'max' : 'min';
    const { best, leaders } = soleBest(ids, values, better);
    const valid = type !== 'match' || best > 0;
    const leader = valid && leaders.length === 1 ? leaders[0] : null;
    const winner = complete ? leader : null;
    const money = Object.fromEntries(ids.map(id => [id, 0]));
    if (winner && price) {
      ids.forEach(id => { money[id] = id === winner ? price * (ids.length - 1) : -price; });
    }
    return {
      segment: seg.key, segmentLabel: seg.label, type, price,
      holesPlayed: done.length, complete,
      status: complete ? (winner ? 'ganada' : 'muere') : (done.length ? 'en juego' : 'pendiente'),
      winner, leader, values, holeWinners, money
    };
  }

  function computeWar(state, game, resolved, settings) {
    const cfg = game.bets && game.bets.war;
    if (!cfg || !cfg.enabled) return null;
    const all = game.players.map(p => p.playerId);
    const ids = cfg.participants && cfg.participants.length ? cfg.participants.filter(id => all.includes(id)) : all;
    if (ids.length < 2) return { config: cfg, participants: ids, bets: [], money: {} };
    const ctx = makeCtx(resolved, ids, settings.strokeMode);
    const bets = [];
    WAR_SEGMENTS.forEach(seg => WAR_TYPES.forEach(t => {
      const c = cfg[t.key];
      if (!c || c.enabled === false) return;
      bets.push(warBet(game, ctx, ids, seg, t.key, Number(c[seg.key]) || 0));
    }));
    const money = Object.fromEntries(ids.map(id => [id, 0]));
    bets.forEach(b => Object.entries(b.money).forEach(([id, v]) => { money[id] += v; }));
    return { config: cfg, participants: ids, bets, money };
  }

  /* ---------------- Liquidación ---------------- */

  /** Minimiza transferencias: quién le paga a quién. */
  function settle(totals) {
    const debt = [], cred = [];
    Object.entries(totals).forEach(([id, v]) => {
      const r = Math.round(v * 100) / 100;
      if (r < 0) debt.push({ id, v: -r }); else if (r > 0) cred.push({ id, v: r });
    });
    debt.sort((a, b) => b.v - a.v); cred.sort((a, b) => b.v - a.v);
    const out = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i].v, cred[j].v);
      out.push({ from: debt[i].id, to: cred[j].id, amount: Math.round(amt * 100) / 100 });
      debt[i].v -= amt; cred[j].v -= amt;
      if (debt[i].v < 0.005) i++;
      if (cred[j].v < 0.005) j++;
    }
    return out;
  }

  /* ---------------- Tarjeta por jugador ---------------- */

  function scorecard(game, p, ctx) {
    const holes = range(0, 18).map(h => {
      const s = scoreOf(game, p.playerId, h);
      const recv = ctx[p.playerId].strokes[h];
      return {
        hole: h + 1, par: p.pars[h], holeHcp: p.holeHcps[h], received: recv,
        strokes: s ? Number(s.strokes) : null,
        putts: s && hasPutts(s) ? Number(s.putts) : null,
        bunker: !!(s && s.bunker), water: !!(s && s.water),
        net: s ? Number(s.strokes) - recv : null,
        achievements: s ? achievements(p, h, s) : null
      };
    });
    const tot = (hs, k) => { const v = hs.map(x => x[k]); return v.every(x => x != null) ? sum(v) : (v.some(x => x != null) ? sum(v.filter(x => x != null)) : null); };
    const seg = (a, b) => { const hs = holes.slice(a, b); return { gross: tot(hs, 'strokes'), net: tot(hs, 'net'), putts: tot(hs, 'putts'), par: sum(hs.map(x => x.par)), played: hs.filter(x => x.strokes != null).length }; };
    return { holes, front: seg(0, 9), back: seg(9, 18), total: seg(0, 18) };
  }

  /* ---------------- API principal ---------------- */

  /** Calcula TODO para una ronda. Resultado serializable (JSON). */
  function computeGame(state, game) {
    const settings = gameSettings(state, game);
    const course = state.courses.find(c => c.id === game.courseId);
    if (!course) throw new Error('La ronda apunta a un campo que no existe: ' + game.courseId);
    const resolved = resolvePlayers(state, game);
    const ctxAll = makeCtx(resolved, resolved.map(p => p.playerId), settings.strokeMode);
    const robin = computeRobin(state, game, resolved, settings);
    const war = computeWar(state, game, resolved, settings);

    const totals = Object.fromEntries(resolved.map(p => [p.playerId, 0]));
    const breakdown = Object.fromEntries(resolved.map(p => [p.playerId, { robin: 0, war: 0 }]));
    if (robin) robin.groups.forEach(g => Object.entries(g.money).forEach(([id, v]) => { totals[id] += v; breakdown[id].robin += v; }));
    if (war) Object.entries(war.money).forEach(([id, v]) => { totals[id] += v; breakdown[id].war += v; });

    return {
      gameId: game.id, date: game.date, status: game.status,
      course: { id: course.id, name: course.name },
      settings,
      players: resolved.map(p => ({
        ...p,
        effHcp: ctxAll[p.playerId].effHcp,
        card: scorecard(game, p, ctxAll)
      })),
      robin, war, totals, breakdown,
      transfers: settle(totals)
    };
  }

  /* ---------------- Texto para WhatsApp / agentes ---------------- */

  function fmtMoney(v, cur) {
    const n = Math.round(Number(v) || 0);
    return (n < 0 ? '-' : n > 0 ? '+' : '') + (cur || '$') + Math.abs(n).toLocaleString('es-CO');
  }

  function summaryText(result) {
    const cur = result.settings.currency;
    const name = (id) => (result.players.find(p => p.playerId === id) || {}).name || id;
    const L = [];
    L.push(`⛳ ${result.course.name} · ${result.date}`);
    L.push('');
    L.push('🏌️ Tarjetas (gross / neto / putts)');
    result.players.forEach(p => {
      const t = p.card.total;
      L.push(`• ${p.name} (${p.teeName}, PH ${p.playingHcp}, ${p.category}): ${t.gross ?? '-'} / ${t.net ?? '-'} / ${t.putts ?? '-'}`);
    });
    if (result.robin) {
      L.push('');
      L.push('🔄 Robin');
      result.robin.groups.forEach((g, gi) => {
        g.segments.forEach(s => {
          if (!s.teams) { L.push(`H${s.holes[0]}–${s.holes[1]}: parejas por definir`); return; }
          const tn = s.teams.map(t => t.map(name).join(' + '));
          L.push(`H${s.holes[0]}–${s.holes[1]}: ${tn[0]} ${s.points[0]} – ${s.points[1]} ${tn[1]}${s.complete ? '' : ' (en juego)'}`);
        });
      });
    }
    if (result.war) {
      L.push('');
      L.push('⚔️ War');
      WAR_TYPES.forEach(t => {
        const row = result.war.bets.filter(b => b.type === t.key)
          .map(b => `${b.segmentLabel}: ${b.winner ? name(b.winner) : b.status === 'muere' ? 'muere' : b.leader ? name(b.leader) + '…' : '—'}`);
        if (row.length) L.push(`${t.label} → ${row.join(' | ')}`);
      });
    }
    L.push('');
    L.push('💰 Totales');
    Object.entries(result.totals).sort((a, b) => b[1] - a[1]).forEach(([id, v]) => L.push(`• ${name(id)}: ${fmtMoney(v, cur)}`));
    if (result.transfers.length) {
      L.push('');
      L.push('🤝 Pagos');
      result.transfers.forEach(t => L.push(`• ${name(t.from)} → ${name(t.to)}: ${fmtMoney(t.amount, cur).replace('+', '')}`));
    }
    return L.join('\n');
  }

  return {
    WAR_SEGMENTS, WAR_TYPES, ROBIN_SEGMENTS, ROBIN_POINTS,
    defaultBets, strokesOnHole, playingHandicapFor, categoryFor, gameSettings,
    resolvePlayers, makeCtx, achievements, robinPairings, robinGroups,
    robinPairingsFor, robinPairingOptions, pairingFromPartner, partnerOf,
    computeRobin, computeWar, settle, computeGame, summaryText, fmtMoney
  };
});
