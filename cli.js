#!/usr/bin/env node
/* ============================================================
 * cli.js — Herramienta de línea de comandos para agentes (Hermes)
 *
 * Usa EXACTAMENTE el mismo motor que la app (handicap.js, store.js, bets.js).
 * Entrada: el JSON que exporta la app (Ajustes → Exportar JSON).
 *
 *   node cli.js resultados <estado.json> [gameId|ultima]   → JSON con todo calculado
 *   node cli.js resumen    <estado.json> [gameId|ultima]   → texto para WhatsApp
 *   node cli.js handicap   <estado.json>                    → index de cada jugador (JSON)
 *   node cli.js rondas     <estado.json>                    → lista de rondas (JSON)
 *   node cli.js validar    <estado.json>                    → revisa campos/marcas/rondas
 *   node cli.js score      <estado.json> <gameId> <playerId> <hoyo> <golpes> [putts] [bunker] [agua]
 *                                                           → escribe un score y guarda el archivo
 *
 * Salida en stdout; errores en stderr con código 1.
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const Store = require(path.join(__dirname, 'store.js'));
const Bets = require(path.join(__dirname, 'bets.js'));

function die(msg) { process.stderr.write('Error: ' + msg + '\n'); process.exit(1); }
function out(obj) { process.stdout.write((typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n'); }

function readState(file) {
  if (!file) die('falta el archivo de estado (.json exportado de la app)');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die('no se pudo leer ' + file + ': ' + e.message); }
  return Store.migrate(raw);
}

function pickGame(state, id) {
  if (!state.games.length) die('no hay rondas en el archivo');
  if (!id || id === 'ultima') {
    return [...state.games].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id))[0];
  }
  return state.games.find(g => g.id === id) || die('ronda no encontrada: ' + id);
}

function validate(state) {
  const issues = [];
  state.courses.forEach(c => c.tees.forEach(t => {
    const where = `${c.name} / ${t.name}`;
    if (t.pars.length !== 18 || t.holeHcps.length !== 18) issues.push(`${where}: debe tener 18 hoyos`);
    const sorted = [...t.holeHcps].sort((a, b) => a - b).join(',');
    if (sorted !== Array.from({ length: 18 }, (_, i) => i + 1).join(',')) issues.push(`${where}: hándicaps de hoyo deben ser 1..18 sin repetir`);
    if (!(t.cr > 50 && t.cr < 90)) issues.push(`${where}: Course Rating sospechoso (${t.cr})`);
    if (!(t.slope >= 55 && t.slope <= 155)) issues.push(`${where}: Slope fuera de rango WHS 55–155 (${t.slope})`);
  }));
  state.games.forEach(g => {
    const c = state.courses.find(x => x.id === g.courseId);
    if (!c) issues.push(`Ronda ${g.id}: campo inexistente`);
    g.players.forEach(p => {
      if (!state.players.find(x => x.id === p.playerId)) issues.push(`Ronda ${g.id}: jugador inexistente ${p.playerId}`);
      if (c && !c.tees.find(t => t.id === p.teeId)) issues.push(`Ronda ${g.id}: marca ${p.teeId} no existe en ${c.name}`);
    });
  });
  return { ok: issues.length === 0, issues };
}

const [, , cmd, file, ...rest] = process.argv;
switch (cmd) {
  case 'resultados': { const s = readState(file); out(Bets.computeGame(s, pickGame(s, rest[0]))); break; }
  case 'resumen':    { const s = readState(file); out(Bets.summaryText(Bets.computeGame(s, pickGame(s, rest[0])))); break; }
  case 'handicap': {
    const s = readState(file);
    out(s.players.map(p => ({ playerId: p.id, name: p.name, ...Store.playerIndex(s, p.id) })));
    break;
  }
  case 'rondas': {
    const s = readState(file);
    out(s.games.map(g => ({ id: g.id, date: g.date, status: g.status, courseId: g.courseId, players: g.players.map(p => p.playerId) })));
    break;
  }
  case 'validar': { const r = validate(readState(file)); out(r); process.exit(r.ok ? 0 : 1); break; }
  case 'score': {
    const s = readState(file);
    const [gameId, playerId, hole, strokes, putts, bunker, water] = rest;
    const g = pickGame(s, gameId);
    if (!g.scores[playerId]) die('jugador no está en la ronda: ' + playerId);
    const h = Number(hole);
    if (!(h >= 1 && h <= 18)) die('hoyo debe ser 1–18');
    if (!(Number(strokes) >= 1)) die('golpes inválidos');
    const yes = (v) => /^(1|true|si|sí|s|y)$/i.test(v || '');
    g.scores[playerId][h - 1] = {
      strokes: Number(strokes),
      putts: putts == null || putts === '' ? null : Number(putts),
      bunker: yes(bunker), water: yes(water)
    };
    fs.writeFileSync(file, JSON.stringify(s, null, 2));
    out({ ok: true, gameId: g.id, playerId, hole: h, score: g.scores[playerId][h - 1] });
    break;
  }
  default:
    out(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 20).join('\n'));
    process.exit(cmd ? 1 : 0);
}
