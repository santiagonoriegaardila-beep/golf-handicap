/* ============================================================
 * store.js — Modelo de datos, migraciones y helpers de handicap
 *
 * Funciona en navegador (window.Store) y en Node (require).
 * Todo el estado de la app es UN objeto JSON (ver docs/HERMES.md).
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./handicap.js'));
  else root.Store = factory(root);
})(typeof self !== 'undefined' ? self : this, function (H) {
  'use strict';

  const STORE_KEY = 'golf-familia-v2';
  const LEGACY_KEY = 'golf-handicap-v1';
  const SCHEMA_VERSION = 2;

  /** Las 5 marcas del club. El id es estable y lo usan los agentes. */
  const TEE_PRESETS = [
    { id: 'negras',    name: 'Negras',    color: '#1c1c1c' },
    { id: 'azules',    name: 'Azules',    color: '#1f5fbf' },
    { id: 'blancas',   name: 'Blancas',   color: '#f2f2f2' },
    { id: 'amarillas', name: 'Amarillas', color: '#f2c200' },
    { id: 'rojas',     name: 'Rojas',     color: '#c8102e' }
  ];

  const DEFAULT_PARS = [4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5];
  const DEFAULT_HOLE_HCPS = [11, 5, 15, 1, 13, 9, 17, 7, 3, 18, 4, 14, 6, 12, 16, 2, 10, 8];

  const DEFAULT_SETTINGS = {
    allowance: 1,            // % del Course Handicap que se juega (1 = 100%)
    highHcpThreshold: 18,    // Playing Handicap > umbral → categoría "alto"
    strokeMode: 'full',      // 'full' = ventaja completa · 'offLow' = relativa al más bajo
    currency: '$'
  };

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function makeTee(presetId, cr, slope, pars, holeHcps) {
    const p = TEE_PRESETS.find(t => t.id === presetId) || { id: presetId, name: presetId, color: '#888' };
    return {
      id: p.id, name: p.name, color: p.color,
      cr: Number(cr), slope: Number(slope),
      pars: [...(pars || DEFAULT_PARS)],
      holeHcps: [...(holeHcps || DEFAULT_HOLE_HCPS)]
    };
  }

  /** Campo de ejemplo con las 5 marcas. Las rojas tienen otro orden de ventajas
   *  para mostrar que cada marca puede tener sus propios hándicaps de hoyo. */
  function sampleCourse() {
    const redHcps = [9, 3, 17, 1, 11, 7, 15, 13, 5, 16, 2, 14, 8, 10, 18, 4, 12, 6];
    return {
      id: uid('c'),
      name: 'Mi Club (ejemplo — edita los datos)',
      tees: [
        makeTee('negras', 74.2, 138),
        makeTee('azules', 72.6, 133),
        makeTee('blancas', 71.0, 128),
        makeTee('amarillas', 69.4, 122),
        makeTee('rojas', 72.8, 127, DEFAULT_PARS, redHcps)
      ]
    };
  }

  function defaultState() {
    return {
      version: SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS },
      players: [],   // [{id, name, manualIndex, defaultTee}]
      courses: [],   // [{id, name, tees:[{id,name,color,cr,slope,pars[18],holeHcps[18]}]}]
      rounds: [],    // tarjetas para handicap WHS
      games: [],     // rondas con apuestas
      activeGameId: null
    };
  }

  /** Acepta estado v1 (módulo 1), v2, o null. Siempre devuelve v2 válido. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') {
      const s = defaultState();
      s.courses.push(sampleCourse());
      return s;
    }
    if (raw.version === SCHEMA_VERSION) {
      const s = { ...defaultState(), ...raw };
      s.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      return s;
    }
    // v1: campos con un solo CR/Slope → se convierten a marca "blancas"
    const s = defaultState();
    s.players = (raw.players || []).map(p => ({ manualIndex: null, defaultTee: 'blancas', ...p }));
    s.courses = (raw.courses || []).map(c => ({
      id: c.id, name: c.name,
      tees: [makeTee('blancas', c.cr, c.slope, c.pars, c.holeHcps)]
    }));
    s.rounds = (raw.rounds || []).map(r => ({ teeId: 'blancas', ...r }));
    if (!s.courses.length) s.courses.push(sampleCourse());
    return s;
  }

  function load(storage) {
    try {
      const v2 = storage.getItem(STORE_KEY);
      if (v2) return migrate(JSON.parse(v2));
      const v1 = storage.getItem(LEGACY_KEY);
      if (v1) return migrate(JSON.parse(v1));
    } catch (e) { /* almacenamiento bloqueado o corrupto */ }
    return migrate(null);
  }

  function save(storage, state) {
    try { storage.setItem(STORE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  /* ---------------- Handicap del jugador ---------------- */

  function teeOf(course, teeId) {
    if (!course) return null;
    return course.tees.find(t => t.id === teeId) || course.tees[0];
  }

  function parTotal(tee) { return tee.pars.reduce((a, b) => a + b, 0); }

  /** Index vigente: calculado con tarjetas (WHS) o, si no hay, el manual. */
  function playerIndex(state, playerId) {
    const diffs = state.rounds.filter(r => r.playerId === playerId).map(r => r.differential);
    const idx = H.handicapIndex(diffs);
    if (idx != null) return { value: idx, source: 'tarjetas', count: diffs.length };
    const p = state.players.find(p => p.id === playerId);
    if (p && p.manualIndex != null && p.manualIndex !== '') {
      return { value: Number(p.manualIndex), source: 'manual', count: 0 };
    }
    return { value: null, source: 'ninguno', count: 0 };
  }

  /** Recalcula AGS y diferencial de todas las tarjetas de un jugador en orden cronológico. */
  function recalcPlayerRounds(state, playerId) {
    const rounds = state.rounds
      .filter(r => r.playerId === playerId)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
    const diffs = [];
    rounds.forEach(r => {
      const course = state.courses.find(c => c.id === r.courseId);
      const tee = teeOf(course, r.teeId);
      if (!tee) { diffs.push(r.differential); return; }
      const idx = H.handicapIndex(diffs);
      const holes = r.scores.map((s, i) => ({ par: tee.pars[i], strokes: s, holeHandicap: tee.holeHcps[i] }));
      r.gross = r.scores.reduce((a, b) => a + b, 0);
      r.ags = H.adjustedGrossScore(holes, idx);
      r.differential = Math.round(H.scoreDifferential(r.ags, tee.cr, tee.slope) * 10) / 10;
      diffs.push(r.differential);
    });
  }

  /** Crea (o actualiza si roundId) una tarjeta de handicap y recalcula. */
  function upsertRound(state, { roundId, playerId, courseId, teeId, date, scores, gameId }) {
    const course = state.courses.find(c => c.id === courseId);
    const tee = teeOf(course, teeId);
    if (!tee) throw new Error('Campo/marca no encontrado');
    if (!Array.isArray(scores) || scores.length !== 18 || scores.some(s => !(s >= 1))) {
      throw new Error('La tarjeta necesita 18 scores válidos');
    }
    let r = roundId && state.rounds.find(r => r.id === roundId);
    const data = { playerId, courseId, teeId: tee.id, courseName: course.name, date, scores: [...scores], gameId: gameId || null };
    if (r) Object.assign(r, data);
    else { r = { id: uid('r'), ...data, gross: 0, ags: 0, differential: 0 }; state.rounds.push(r); }
    recalcPlayerRounds(state, playerId);
    return r;
  }

  /* ---------------- Merge de 3 vías (sincronización) ----------------
   * base = último estado sincronizado, local = este dispositivo, remote = la nube.
   * - Objetos: llave por llave.
   * - Arreglos de objetos con `id` (players, games…): por id, respetando altas y bajas.
   * - Arreglos del mismo largo (scores[18], pars…): posición por posición.
   * - Valores simples: si local cambió respecto a base gana local, si no gana remote.
   * Así dos personas anotando hoyos/jugadores distintos al tiempo no se pisan. */
  const isObj = (v) => v !== null && typeof v === 'object';
  function deepEq(a, b) {
    if (a === b) return true;
    if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEq(a[k], b[k]));
  }
  const cloneJ = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const hasIds = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every(x => isObj(x) && x.id != null);

  function merge3(base, local, remote) {
    if (deepEq(local, remote)) return cloneJ(local);
    if (deepEq(local, base)) return cloneJ(remote);
    if (deepEq(remote, base)) return cloneJ(local);

    if (Array.isArray(local) && Array.isArray(remote)) {
      const b = Array.isArray(base) ? base : [];
      if ((hasIds(local) || !local.length) && (hasIds(remote) || !remote.length) && (local.length || remote.length)) {
        const byId = (arr) => new Map(arr.map(x => [x.id, x]));
        const B = byId(hasIds(b) ? b : []), L = byId(local), R = byId(remote);
        const order = [...remote.map(x => x.id), ...local.map(x => x.id).filter(id => !R.has(id))];
        const out = [];
        order.forEach(id => {
          const inB = B.has(id), inL = L.has(id), inR = R.has(id);
          if (inL && inR) out.push(merge3(B.get(id), L.get(id), R.get(id)));
          else if (inR && !inL) { if (!inB || !deepEq(R.get(id), B.get(id))) out.push(cloneJ(R.get(id))); } // borrado local
          else if (inL && !inR) { if (!inB || !deepEq(L.get(id), B.get(id))) out.push(cloneJ(L.get(id))); } // borrado remoto
        });
        return out;
      }
      if (local.length === remote.length) {
        return local.map((x, i) => merge3(b[i], x, remote[i]));
      }
      return cloneJ(local);
    }

    if (isObj(local) && isObj(remote) && !Array.isArray(local) && !Array.isArray(remote)) {
      const b = isObj(base) && !Array.isArray(base) ? base : {};
      const out = {};
      new Set([...Object.keys(remote), ...Object.keys(local)]).forEach(k => {
        const inL = k in local, inR = k in remote, inB = k in b;
        if (inL && inR) out[k] = merge3(b[k], local[k], remote[k]);
        else if (inR) { if (!inB || !deepEq(remote[k], b[k])) out[k] = cloneJ(remote[k]); }
        else if (inL) { if (!inB || !deepEq(local[k], b[k])) out[k] = cloneJ(local[k]); }
      });
      return out;
    }
    return cloneJ(deepEq(local, base) ? remote : local);
  }

  return {
    deepEq, merge3,
    STORE_KEY, LEGACY_KEY, SCHEMA_VERSION, TEE_PRESETS, DEFAULT_PARS, DEFAULT_HOLE_HCPS, DEFAULT_SETTINGS,
    uid, makeTee, sampleCourse, defaultState, migrate, load, save,
    teeOf, parTotal, playerIndex, recalcPlayerRounds, upsertRound
  };
});
