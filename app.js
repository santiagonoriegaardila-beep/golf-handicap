/* ============================================================
 * app.js — Interfaz de "Golf en Familia"
 *
 * Toda la lógica de cálculo vive en handicap.js / store.js / bets.js.
 * Este archivo solo pinta pantallas y modifica `state`.
 *
 * Para agentes (Hermes): ver window.GolfApp al final y docs/HERMES.md
 * ============================================================ */
'use strict';

const storage = (() => { try { const s = window.localStorage; s.getItem('x'); return s; } catch (e) { return null; } })();
const memStore = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; } };
let state = Store.load(storage || memStore);

const ui = {
  tab: 'ronda',
  draft: null,          // ronda nueva en configuración
  viewGameId: null,     // ronda vista en Apuestas
  editCourseId: null,
  editTeeId: null,
  card: null            // tarjeta de handicap en edición
};

const $ = (s) => document.querySelector(s);
const view = () => $('#view');
const today = () => new Date().toISOString().slice(0, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));

function persist() { Store.save(storage || memStore, state); Sync.changed(); }

/* Hoyo actual: es de cada celular (no se sincroniza) */
const UI_KEY = 'golf-ui';
const uiSaved = (() => { try { return JSON.parse((storage || memStore).getItem(UI_KEY)) || {}; } catch (e) { return {}; } })();
ui.holes = uiSaved.holes || {};
function saveUi() { try { (storage || memStore).setItem(UI_KEY, JSON.stringify({ holes: ui.holes })); } catch (e) { /* */ } }
const curHole = (g) => Math.min(17, Math.max(0, ui.holes[g.id] ?? 0));

/* Llega un estado nuevo desde la nube */
let renderPending = false;
function applyRemote(next, meta) {
  state = next;
  Store.save(storage || memStore, state);
  const a = document.activeElement;
  const typing = a && view().contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox';
  if (typing) { renderPending = true; return; }   // no interrumpir a quien está escribiendo
  render();
  if (meta && meta.by) toast(`↻ Actualizado por ${meta.by}`);
}

const SYNC_LABEL = {
  'local': ['⚪', 'Solo este celular'], 'conectando': ['🟡', 'Conectando…'], 'en-vivo': ['🟢', 'En vivo'],
  'guardando': ['🟡', 'Guardando…'], 'sin-conexion': ['🟠', 'Sin conexión · se guarda al volver'], 'error': ['🔴', 'Error de sincronización']
};
function syncBadge() {
  const i = Sync.info(); const [dot, txt] = SYNC_LABEL[i.status] || ['⚪', i.status];
  const el = $('#sync-badge'); if (!el) return;
  el.textContent = `${dot} ${txt}`; el.title = i.error || '';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(v, sign = true) {
  const n = Math.round(Number(v) || 0);
  const cur = state.settings.currency || '$';
  const s = cur + Math.abs(n).toLocaleString('es-CO');
  if (!sign) return s;
  return n > 0 ? '+' + s : n < 0 ? '−' + s : s;
}
function moneyClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted'; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
const courseById = (id) => state.courses.find(c => c.id === id);
const playerById = (id) => state.players.find(p => p.id === id);
const pName = (id) => (playerById(id) || {}).name || '?';
function activeGame() {
  return state.games.find(g => g.id === state.activeGameId && g.status === 'en juego') || null;
}
function teeDot(tee) { return tee ? `<span class="tee-dot" style="background:${esc(tee.color)}" title="${esc(tee.name)}"></span>` : ''; }

/* ============================================================
 * Render principal
 * ============================================================ */
const RENDER = {};

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const g = activeGame();
  $('#topbar-sub').textContent = g
    ? `Ronda en juego · ${courseById(g.courseId)?.name || ''} · Hoyo ${curHole(g) + 1}`
    : 'Handicap · Robin · War';
  syncBadge();
  renderPending = false;
  view().innerHTML = RENDER[ui.tab]();
}

function setTab(t) { ui.tab = t; render(); window.scrollTo(0, 0); }

/* ============================================================
 * TAB: RONDA
 * ============================================================ */
RENDER.ronda = () => {
  const g = activeGame();
  return g ? renderPlay(g) : renderSetup();
};

/* ---------- Configurar ronda nueva ---------- */

function newDraft() {
  const last = [...state.games].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  return {
    date: today(),
    courseId: (last && courseById(last.courseId) ? last.courseId : state.courses[0]?.id) || '',
    players: [],
    bets: last ? clone(last.bets) : Bets.defaultBets()
  };
}

function draftPlayer(playerId, course) {
  const p = playerById(playerId);
  const idx = Store.playerIndex(state, playerId).value;
  const teeId = course && course.tees.some(t => t.id === p.defaultTee) ? p.defaultTee : course?.tees[0]?.id;
  return { playerId, teeId, index: idx, playingHcp: null, category: null };
}

function renderSetup() {
  if (!state.courses.length) {
    return `<section class="card"><div class="empty"><span class="big">🚩</span>Primero crea un campo con sus marcas.<br><br>
      <button class="btn" data-act="tab" data-tab="campos">Ir a Campos</button></div></section>`;
  }
  if (!state.players.length) {
    return `<section class="card"><div class="empty"><span class="big">👥</span>Agrega a la familia primero.<br><br>
      <button class="btn" data-act="tab" data-tab="jugadores">Ir a Jugadores</button></div></section>`;
  }
  const d = ui.draft || (ui.draft = newDraft());
  const course = courseById(d.courseId) || state.courses[0];
  d.courseId = course.id;
  const draftGame = { courseId: course.id, players: d.players, settings: state.settings, bets: d.bets, scores: {} };
  const resolved = Bets.resolvePlayers(state, draftGame);
  const sel = new Set(d.players.map(p => p.playerId));

  const playersHtml = d.players.map((dp, i) => {
    const r = resolved[i];
    return `<div class="setup-player">
      <div class="order">
        <button class="iconbtn" data-act="draft-move" data-i="${i}" data-d="-1" aria-label="Subir">▲</button>
        <button class="iconbtn" data-act="draft-move" data-i="${i}" data-d="1" aria-label="Bajar">▼</button>
      </div>
      <div class="head">
        <b>${i + 1}. ${esc(pName(dp.playerId))}</b>
        <span class="tag ${r.category}">${r.category}</span>
        <span class="ph-badge">PH <b>${r.playingHcp}</b>${dp.playingHcp != null && dp.playingHcp !== '' ? ' ✎' : ''}</span>
      </div>
      <div class="fields">
        <label class="f">Marca
          <select data-ch="draft-p" data-i="${i}" data-k="teeId">
            ${course.tees.map(t => `<option value="${t.id}" ${t.id === dp.teeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select></label>
        <label class="f">Index
          <input type="number" step="0.1" inputmode="decimal" value="${dp.index ?? ''}" placeholder="—" data-ch="draft-p" data-i="${i}" data-k="index"></label>
        <label class="f">PH manual
          <input type="number" inputmode="numeric" value="${dp.playingHcp ?? ''}" placeholder="auto ${r.autoPlayingHcp}" data-ch="draft-p" data-i="${i}" data-k="playingHcp"></label>
        <label class="f">Categoría
          <select data-ch="draft-p" data-i="${i}" data-k="category">
            <option value="" ${!dp.category ? 'selected' : ''}>auto (${Bets.categoryFor(r.playingHcp, state.settings.highHcpThreshold)})</option>
            <option value="bajo" ${dp.category === 'bajo' ? 'selected' : ''}>bajo</option>
            <option value="alto" ${dp.category === 'alto' ? 'selected' : ''}>alto</option>
          </select></label>
      </div>
    </div>`;
  }).join('');

  const rb = d.bets.robin, wr = d.bets.war;
  const ids = d.players.map(p => p.playerId);
  const groups = [];
  for (let i = 0; i + 4 <= ids.length; i += 4) groups.push(ids.slice(i, i + 4));
  const leftover = ids.length % 4;
  const pairingsHtml = groups.map((g, gi) => {
    const pr = Bets.robinPairings(g);
    return `${groups.length > 1 ? `<h3>Grupo ${gi + 1}</h3>` : ''}` + pr.map((t, si) => `<div class="pairing">
        <span class="muted">H${si * 6 + 1}–${si * 6 + 6}</span>
        <span class="team-a">${t[0].map(pName).map(esc).join(' + ')}</span><span class="muted">vs</span>
        <span class="team-b">${t[1].map(pName).map(esc).join(' + ')}</span></div>`).join('');
  }).join('');

  const priceRow = (k, label) => `<tr><th class="l">${label}</th>${['front', 'back', 'total'].map(s =>
    `<td><input class="sm" type="number" inputmode="numeric" value="${wr[k][s]}" data-ch="draft-war" data-k="${k}" data-s="${s}"></td>`).join('')}</tr>`;

  return `
  <section class="card">
    <h2>🏌️ Nueva ronda</h2>
    <div class="row">
      <label class="f">Fecha<input type="date" value="${d.date}" data-ch="draft" data-k="date"></label>
      <label class="f" style="flex:2 1 200px">Campo
        <select data-ch="draft" data-k="courseId">
          ${state.courses.map(c => `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
    </div>
    <h3>¿Quién juega?</h3>
    <div class="chips">
      ${state.players.map(p => `<button class="chip ${sel.has(p.id) ? 'on' : ''}" data-act="draft-toggle" data-id="${p.id}">${esc(p.name)}</button>`).join('')}
    </div>
    ${d.players.length ? `<h3>Marcas y ventajas</h3>${playersHtml}
      <p class="hint">PH (Playing Handicap) = Index × Slope/113 + (CR − Par) de <b>su marca</b>, × ${Math.round(state.settings.allowance * 100)}%.
      Categoría <b>alto</b> si PH &gt; ${state.settings.highHcpThreshold}. El orden define las parejas del robin.</p>` : ''}
  </section>

  <div class="grid2">
    <section class="card">
      <h2>🔄 Robin <span class="spacer"></span>
        <label class="switch"><input type="checkbox" ${rb.enabled ? 'checked' : ''} data-ch="draft-robin" data-k="enabled"> Activo</label></h2>
      ${rb.enabled ? `
      <div class="row">
        <label class="f">Base (valor del punto)<input type="number" inputmode="numeric" value="${rb.pointValue}" data-ch="draft-robin" data-k="pointValue"></label>
        <label class="f">Bono por ganar el bloque<input type="number" inputmode="numeric" value="${rb.segmentValue}" data-ch="draft-robin" data-k="segmentValue"></label>
        <label class="f">Putts del equipo
          <select data-ch="draft-robin" data-k="puttsMode">
            <option value="suma" ${rb.puttsMode === 'suma' ? 'selected' : ''}>Suma de los dos</option>
            <option value="baja" ${rb.puttsMode === 'baja' ? 'selected' : ''}>Mejor de los dos</option>
          </select></label>
      </div>
      <h3>Parejas por bloque de 6</h3>
      ${groups.length ? pairingsHtml : '<p class="hint">Se necesitan 4 jugadores (o grupos de 4).</p>'}
      ${leftover && groups.length ? `<p class="hint">⚠️ ${leftover} jugador(es) quedan fuera del robin (no completan grupo de 4).</p>` : ''}
      <p class="hint">6 puntos por hoyo: <b>suma</b> (neto), <b>putts</b>, <b>baja</b> (neto), <b>sandy</b>, <b>birdie</b> y <b>paraguas</b> (gross).</p>` : ''}
    </section>

    <section class="card">
      <h2>⚔️ War <span class="spacer"></span>
        <label class="switch"><input type="checkbox" ${wr.enabled ? 'checked' : ''} data-ch="draft-war-on"> Activo</label></h2>
      ${wr.enabled ? `
      <table class="price-table">
        <tr><th></th><th>9 ida</th><th>9 vuelta</th><th>Total</th></tr>
        ${priceRow('match', 'Match')}${priceRow('medal', 'Medal')}${priceRow('putts', 'Putts')}
      </table>
      <p class="hint">Todos contra todos, neto (putts en gross). Un solo ganador: si hay empate <b>la apuesta muere</b>.
      El ganador cobra el valor a cada rival.</p>` : ''}
    </section>
  </div>

  <button class="btn block gold" data-act="start-game" ${d.players.length < 2 ? 'disabled style="opacity:.5"' : ''}>⛳ Empezar ronda</button>`;
}

/* ---------- Ronda en juego ---------- */

function scoreName(strokes, par) {
  const d = strokes - par;
  if (d <= -2) return ['Águila' + (d < -2 ? '+' : ''), 'sn-eagle'];
  if (d === -1) return ['Birdie', 'sn-birdie'];
  if (d === 0) return ['Par', 'sn-par'];
  if (d === 1) return ['Bogey', 'sn-bogey'];
  return [d === 2 ? 'Doble' : '+' + d, 'sn-double'];
}

function holeState(g, h) {
  const n = g.players.filter(p => g.scores[p.playerId]?.[h]?.strokes > 0).length;
  return n === g.players.length ? 'done' : n ? 'part' : '';
}

function renderPlay(g) {
  const res = Bets.computeGame(state, g);
  const h = curHole(g);
  const course = courseById(g.courseId);

  // Equipo robin del hoyo actual (para colorear tarjetas)
  const teamOf = {};
  let robinBanner = '';
  if (res.robin) {
    const si = Math.floor(h / 6);
    res.robin.groups.forEach(gr => {
      const s = gr.segments[si];
      s.teams[0].forEach(id => { teamOf[id] = 'a'; });
      s.teams[1].forEach(id => { teamOf[id] = 'b'; });
      robinBanner += `<div class="robin-banner">🔄 <b>H${s.holes[0]}–${s.holes[1]}</b>
        <span class="team-a">${s.teams[0].map(pName).map(esc).join(' + ')} ${s.points[0]}</span>
        <span class="muted">–</span>
        <span class="team-b">${s.points[1]} ${s.teams[1].map(pName).map(esc).join(' + ')}</span></div>`;
    });
  }

  // Par/hcp del hoyo por marca usada
  const teesUsed = [...new Set(g.players.map(p => p.teeId))].map(id => Store.teeOf(course, id));
  const parSet = [...new Set(teesUsed.map(t => t.pars[h]))];
  const meta = teesUsed.map(t => `${teeDot(t)} hcp <b>${t.holeHcps[h]}</b>`).join(' · ');

  const strip = Array.from({ length: 18 }, (_, i) =>
    (i === 9 ? '<span class="sep"></span>' : '') +
    `<button class="${holeState(g, i)} ${i === h ? 'on' : ''}" data-act="goto" data-h="${i}">${i + 1}</button>`).join('');

  const cards = res.players.map(p => {
    const hc = p.card.holes[h];
    const s = g.scores[p.playerId][h] || {};
    const dots = hc.received > 0 ? '●'.repeat(hc.received) : hc.received < 0 ? '−'.repeat(-hc.received) : '';
    let resultHtml = '';
    if (hc.strokes) {
      const [nm, cls] = scoreName(hc.strokes, hc.par);
      const a = hc.achievements;
      resultHtml = `<span class="net-badge">neto <b>${hc.net}</b></span><span class="score-name ${cls}">${nm}</span>` +
        (a.birdie ? `<span class="ach">🐦 ${a.birdie}</span>` : '') +
        (a.sandy ? `<span class="ach">🏖 Sandy</span>` : '') +
        (a.paraguas ? `<span class="ach">☂️ Paraguas</span>` : '');
    }
    const team = teamOf[p.playerId];
    return `<div class="pcard ${team ? 'team-' + team + '-b' : ''}">
      <div class="top">
        ${teeDot({ color: p.teeColor, name: p.teeName })}
        <span class="pname">${esc(p.name)}</span>
        <span class="tag ${p.category}">${p.category}</span>
        <span class="info">PH ${p.playingHcp} · par ${hc.par}</span>
        ${dots ? `<span class="dots" title="Golpes de ventaja en este hoyo">${dots}</span>` : ''}
        <span class="spacer" style="flex:1"></span>
        <span class="info">Total ${p.card.total.gross ?? '–'} · neto ${p.card.total.net ?? '–'}</span>
      </div>
      <div class="inputs">
        <div class="stepper">
          <button data-act="step" data-pid="${p.playerId}" data-k="strokes" data-d="-1" aria-label="Menos golpes">−</button>
          <div class="val"><b class="${s.strokes ? '' : 'empty'}">${s.strokes || hc.par}</b><small>Golpes</small></div>
          <button data-act="step" data-pid="${p.playerId}" data-k="strokes" data-d="1" aria-label="Más golpes">+</button>
        </div>
        <div class="stepper">
          <button data-act="step" data-pid="${p.playerId}" data-k="putts" data-d="-1" aria-label="Menos putts">−</button>
          <div class="val"><b class="${s.putts != null ? '' : 'empty'}">${s.putts ?? 2}</b><small>Putts</small></div>
          <button data-act="step" data-pid="${p.playerId}" data-k="putts" data-d="1" aria-label="Más putts">+</button>
        </div>
      </div>
      <div class="toggles">
        <button class="toggle sand ${s.bunker ? 'on' : ''}" data-act="flag" data-pid="${p.playerId}" data-k="bunker">🏖 Bunker</button>
        <button class="toggle water ${s.water ? 'on' : ''}" data-act="flag" data-pid="${p.playerId}" data-k="water">💧 Agua</button>
        ${!s.strokes ? `<button class="toggle" data-act="par" data-pid="${p.playerId}">✓ Par</button>` : `<button class="toggle" data-act="clear" data-pid="${p.playerId}">Borrar</button>`}
        <span class="result-line">${resultHtml}</span>
      </div>
    </div>`;
  }).join('');

  return `
  <section class="card hole-nav">
    <div class="hole-strip">${strip}</div>
    <div class="hole-head">
      <button class="navbtn" data-act="goto" data-h="${h - 1}" ${h === 0 ? 'disabled' : ''} aria-label="Hoyo anterior">‹</button>
      <span class="num">${h + 1}</span>
      <div class="meta"><b>Par ${parSet.join('/')}</b><br>${meta}</div>
      <button class="navbtn" data-act="goto" data-h="${h + 1}" ${h === 17 ? 'disabled' : ''} aria-label="Hoyo siguiente">›</button>
    </div>
    ${robinBanner}
  </section>
  ${cards}
  ${renderLive(res, h)}
  <div class="row">
    <button class="btn ghost grow" data-act="tab" data-tab="apuestas">💰 Ver apuestas</button>
    <button class="btn grow" data-act="finish-game">🏁 Terminar ronda</button>
  </div>`;
}

function renderLive(res, h) {
  let html = '';
  if (res.war && res.war.bets.length) {
    const segKey = h < 9 ? 'front' : 'back';
    const items = res.war.bets.filter(b => b.segment === segKey || b.segment === 'total').map(b => {
      const who = b.winner || b.leader;
      return `<tr><td class="l">${Bets.WAR_TYPES.find(t => t.key === b.type).label} · ${b.segmentLabel}</td>
        <td class="${b.winner ? 'win' : who ? 'live' : 'dead'}">${who ? esc(pName(who)) : (b.holesPlayed ? 'empatados' : '—')}</td></tr>`;
    }).join('');
    html += `<section class="card"><h2>⚔️ War en vivo</h2><div class="table-wrap"><table class="t">${items}</table></div></section>`;
  }
  html += `<section class="card"><h2>💰 Así va la plata</h2>${renderTotals(res)}</section>`;
  return html;
}

function renderTotals(res) {
  const entries = Object.entries(res.totals).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(e => Math.abs(e[1])));
  return `<div class="totals">${entries.map(([id, v]) => `
    <div class="total-row">
      <span>${esc(pName(id))}</span>
      <div class="bar-wrap"><span class="mid"></span><span class="bar ${v >= 0 ? 'pos' : 'neg'}" style="width:${(Math.abs(v) / max) * 50}%"></span></div>
      <span class="amount ${moneyClass(v)}">${money(v)}</span>
    </div>`).join('')}</div>`;
}

/* ============================================================
 * TAB: APUESTAS (resultados)
 * ============================================================ */
RENDER.apuestas = () => {
  if (!state.games.length) {
    return `<section class="card"><div class="empty"><span class="big">💰</span>Aún no hay rondas. Crea una en la pestaña Ronda.</div></section>`;
  }
  const games = [...state.games].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
  const g = state.games.find(x => x.id === ui.viewGameId) || activeGame() || games[0];
  ui.viewGameId = g.id;
  let res;
  try { res = Bets.computeGame(state, g); } catch (e) {
    return `<section class="card"><div class="empty">No se pudo calcular esta ronda: ${esc(e.message)}</div></section>`;
  }

  const picker = `<section class="card"><div class="row">
    <select class="grow" data-ch="view-game">
      ${games.map(x => `<option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>${x.date} · ${esc(courseById(x.courseId)?.name || '?')} · ${x.players.length} jug. ${x.status === 'en juego' ? '· en juego' : ''}</option>`).join('')}
    </select>
    <button class="btn ghost sm" data-act="copy-summary">📋 Copiar resumen</button>
  </div></section>`;

  const transfers = res.transfers.length
    ? res.transfers.map(t => `<div class="transfer"><b>${esc(pName(t.from))}</b><span class="arrow">→</span><b>${esc(pName(t.to))}</b><span class="amt">${money(t.amount, false)}</span></div>`).join('')
    : '<p class="hint">Nadie le debe a nadie (todavía).</p>';

  const breakdown = `<div class="table-wrap"><table class="t">
    <tr><th class="l">Jugador</th>${res.robin ? '<th>Robin</th>' : ''}${res.war ? '<th>War</th>' : ''}<th>Total</th></tr>
    ${res.players.map(p => { const b = res.breakdown[p.playerId]; const t = res.totals[p.playerId]; return `<tr><td class="l">${esc(p.name)}</td>
      ${res.robin ? `<td class="${moneyClass(b.robin)}">${money(b.robin)}</td>` : ''}
      ${res.war ? `<td class="${moneyClass(b.war)}">${money(b.war)}</td>` : ''}
      <td class="${moneyClass(t)}">${money(t)}</td></tr>`; }).join('')}
  </table></div>`;

  return `${picker}
  <div class="grid2">
    <section class="card"><h2>💰 Totales</h2>${renderTotals(res)}<h3>Desglose</h3>${breakdown}</section>
    <section class="card"><h2>🤝 Quién le paga a quién</h2>${transfers}
      <p class="hint">Liquidación con el mínimo número de pagos.</p></section>
  </div>
  ${res.war ? renderWar(res) : ''}
  ${res.robin ? renderRobin(res) : ''}
  ${renderScorecard(res)}`;
};

function renderWar(res) {
  const cell = (b) => {
    if (!b) return '<div class="war-cell dead">—</div>';
    const v = (id) => b.values[id];
    if (b.winner) return `<div class="war-cell win"><b>${esc(pName(b.winner))}</b><small>${b.type === 'match' ? v(b.winner) + ' hoyos' : v(b.winner)} · ${money(b.price, false)}</small></div>`;
    if (b.status === 'muere') return `<div class="war-cell dead">☠️ Muere<small>empate</small></div>`;
    if (b.status === 'pendiente') return `<div class="war-cell dead">—<small>pendiente</small></div>`;
    return `<div class="war-cell">${b.leader ? `<span class="live">${esc(pName(b.leader))}</span>` : '<span class="muted">empatados</span>'}<small>en juego · ${b.holesPlayed} h</small></div>`;
  };
  const types = Bets.WAR_TYPES.filter(t => res.war.bets.some(b => b.type === t.key));
  const detail = types.map(t => `<tr><td class="l"><b>${t.label}</b></td>${Bets.WAR_SEGMENTS.map(s => {
      const b = res.war.bets.find(x => x.type === t.key && x.segment === s.key);
      return `<td class="l">${b ? res.war.participants.map(id => `${esc(pName(id))} ${b.values[id] ?? '–'}`).join('<br>') : ''}</td>`;
    }).join('')}</tr>`).join('');
  return `<section class="card"><h2>⚔️ War · ${res.war.participants.length} jugadores</h2>
    <div class="war-grid">
      <span></span>${Bets.WAR_SEGMENTS.map(s => `<span class="h">${s.label}</span>`).join('')}
      ${types.map(t => `<span class="rl">${t.label}</span>${Bets.WAR_SEGMENTS.map(s => cell(res.war.bets.find(b => b.type === t.key && b.segment === s.key))).join('')}`).join('')}
    </div>
    <h3>Números</h3>
    <div class="table-wrap"><table class="t"><tr><th></th>${Bets.WAR_SEGMENTS.map(s => `<th class="l">${s.label}</th>`).join('')}</tr>${detail}</table></div>
    <p class="hint">Match = hoyos ganados solo (neto). Medal = golpes netos. Putts = putts totales. Empate en el primer lugar → muere.</p>
  </section>`;
}

function renderRobin(res) {
  const segs = res.robin.groups.map((gr, gi) => `
    ${res.robin.groups.length > 1 ? `<h3>Grupo ${gi + 1}</h3>` : ''}
    ${gr.segments.map(s => {
      const pill = s.complete ? `<span class="pill ok">terminado</span>` : s.played ? `<span class="pill live">en juego · ${s.played}/6</span>` : `<span class="pill">pendiente</span>`;
      const rows = Bets.ROBIN_POINTS.map(pt => `<tr><td class="l">${pt.label}</td>
        <td class="${s.totals[0][pt.key] > s.totals[1][pt.key] ? 'win' : ''}">${s.totals[0][pt.key]}</td>
        <td class="${s.totals[1][pt.key] > s.totals[0][pt.key] ? 'win' : ''}">${s.totals[1][pt.key]}</td></tr>`).join('');
      const holeRows = s.perHole.filter(x => x.played).map(x => `<td>${x.total[0]}–${x.total[1]}</td>`).join('');
      const amtA = s.money[s.teams[0][0]];
      return `<div class="robin-seg">
        <div class="hdr"><b>Hoyos ${s.holes[0]}–${s.holes[1]}</b>${pill}
          <span class="status ${moneyClass(amtA)}">${s.diff ? (s.diff > 0 ? s.teams[0] : s.teams[1]).map(pName).map(esc).join(' + ') + ' ' + money(Math.abs(amtA), false) + ' c/u' : ''}</span></div>
        <div class="hdr">
          <span class="team-a">${s.teams[0].map(pName).map(esc).join(' + ')}</span>
          <span class="score">${s.points[0]} – ${s.points[1]}</span>
          <span class="team-b">${s.teams[1].map(pName).map(esc).join(' + ')}</span>
        </div>
        <div class="table-wrap"><table class="t">
          <tr><th class="l">Punto</th><th class="team-a">A</th><th class="team-b">B</th></tr>${rows}
          ${holeRows ? `<tr class="sub"><td class="l">Por hoyo</td><td colspan="2" style="text-align:left">${s.perHole.filter(x => x.played).map(x => `H${x.hole}: ${x.total[0]}–${x.total[1]}`).join(' · ')}</td></tr>` : ''}
        </table></div>
      </div>`;
    }).join('')}`).join('');
  const excl = res.robin.excluded.length ? `<p class="hint">Fuera del robin: ${res.robin.excluded.map(pName).map(esc).join(', ')}</p>` : '';
  return `<section class="card"><h2>🔄 Robin · base ${money(res.robin.config.pointValue, false)}/punto</h2>${segs}${excl}
    <p class="hint">Cada jugador del equipo gana/pierde (puntos A − puntos B) × base${Number(res.robin.config.segmentValue) ? ' + bono del bloque' : ''}.</p></section>`;
}

function renderScorecard(res) {
  const holes = Array.from({ length: 18 }, (_, i) => i);
  const head = (a, b, lbl) => holes.slice(a, b).map(i => `<th>${i + 1}</th>`).join('') + `<th>${lbl}</th>`;
  const cls = (s, par) => { if (s == null) return ''; const d = s - par; return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : ''; };
  const row = (p, a, b, tot) => holes.slice(a, b).map(i => {
    const x = p.card.holes[i];
    return `<td><span class="sc-cell ${cls(x.strokes, x.par)}">${x.strokes ?? '·'}${x.received > 0 ? `<sup>${'•'.repeat(x.received)}</sup>` : ''}</span></td>`;
  }).join('') + `<td><b>${tot.gross ?? '–'}</b><br><small class="muted">${tot.net ?? '–'}n</small></td>`;
  const half = (a, b, lbl, key) => `<div class="table-wrap"><table class="t">
    <tr><th class="l">Hoyo</th>${head(a, b, lbl)}</tr>
    <tr class="sub"><td class="l">Par</td>${holes.slice(a, b).map(i => `<td>${res.players[0].pars[i]}</td>`).join('')}<td>${res.players[0].card[key].par}</td></tr>
    ${res.players.map(p => `<tr><td class="l">${teeDot({ color: p.teeColor, name: p.teeName })} ${esc(p.name)}</td>${row(p, a, b, p.card[key])}</tr>`).join('')}
  </table></div>`;
  return `<section class="card"><h2>📝 Tarjeta</h2>
    ${half(0, 9, 'Ida', 'front')}<br>${half(9, 18, 'Vuelta', 'back')}
    <div class="table-wrap"><table class="t" style="margin-top:10px">
      <tr><th class="l">Jugador</th><th>Marca</th><th>PH</th><th>Gross</th><th>Neto</th><th>Putts</th></tr>
      ${res.players.map(p => `<tr><td class="l">${esc(p.name)} <span class="tag ${p.category}">${p.category}</span></td><td>${teeDot({ color: p.teeColor })} ${esc(p.teeName)}</td><td>${p.playingHcp}</td><td>${p.card.total.gross ?? '–'}</td><td>${p.card.total.net ?? '–'}</td><td>${p.card.total.putts ?? '–'}</td></tr>`).join('')}
    </table></div>
    <p class="hint">○ birdie · ◎ águila · □ bogey · • golpe de ventaja. Par de la fila: marca de ${esc(res.players[0].teeName)}.</p>
    <div class="row" style="margin-top:10px">
      ${state.games.find(x => x.id === res.gameId)?.status === 'terminada' ? `<button class="btn ghost sm" data-act="reopen-game">↩︎ Reabrir ronda</button>` : ''}
      <button class="btn ghost sm" data-act="register-cards">📈 Registrar tarjetas en handicap</button>
      <button class="btn danger sm" data-act="delete-game">Eliminar ronda</button>
    </div>
  </section>`;
}

/* ============================================================
 * TAB: JUGADORES (+ handicap WHS)
 * ============================================================ */
RENDER.jugadores = () => {
  const firstCourse = state.courses[0];
  const players = state.players.map(p => {
    const idx = Store.playerIndex(state, p.id);
    return `<li>
      <span class="name">${esc(p.name)}</span>
      <span class="muted" style="font-size:12px">${idx.source === 'tarjetas' ? `${idx.count} tarjeta(s)` : idx.source === 'manual' ? 'manual' : 'sin index'}</span>
      <span class="big-num">${idx.value != null ? idx.value.toFixed(1) : '—'}</span>
      <div class="row" style="flex-basis:100%">
        <label class="f">Index manual<input type="number" step="0.1" inputmode="decimal" value="${p.manualIndex ?? ''}" placeholder="si no hay tarjetas" data-ch="player" data-id="${p.id}" data-k="manualIndex"></label>
        <label class="f">Marca habitual
          <select data-ch="player" data-id="${p.id}" data-k="defaultTee">
            ${Store.TEE_PRESETS.map(t => `<option value="${t.id}" ${p.defaultTee === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
          </select></label>
        <button class="btn danger sm" data-act="del-player" data-id="${p.id}" style="align-self:flex-end">Eliminar</button>
      </div>
    </li>`;
  }).join('');

  const c = ui.card || (ui.card = { playerId: '', courseId: firstCourse?.id || '', teeId: '', date: today(), scores: Array(18).fill(''), roundId: null });
  const course = courseById(c.courseId) || firstCourse;
  const tee = Store.teeOf(course, c.teeId);
  if (tee) c.teeId = tee.id;
  const cardGrid = tee ? `<div class="card-grid">${Array.from({ length: 18 }, (_, i) => `<div class="c">
      <span>H${i + 1} · p${tee.pars[i]}</span>
      <input class="sm" type="number" inputmode="numeric" min="1" max="15" value="${c.scores[i]}" placeholder="${tee.pars[i]}" data-ch="card-score" data-i="${i}">
    </div>`).join('')}</div>` : '';

  const rounds = [...state.rounds].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const roundsHtml = rounds.map(r => {
    const t = Store.teeOf(courseById(r.courseId), r.teeId);
    return `<li>
      <span class="name">${esc(pName(r.playerId))}<br><small class="muted">${r.date} · ${esc(r.courseName)} ${t ? teeDot(t) : ''}${r.gameId ? ' · desde ronda' : ''}</small></span>
      <span class="muted" style="font-size:13px">Gross <b>${r.gross}</b> · AGS <b>${r.ags}</b></span>
      <span class="big-num" style="font-size:18px">${r.differential.toFixed(1)}</span>
      <button class="btn ghost sm" data-act="edit-card" data-id="${r.id}">Editar</button>
      <button class="iconbtn" data-act="del-card" data-id="${r.id}" aria-label="Eliminar">✕</button>
    </li>`;
  }).join('');

  return `
  <div class="grid2">
    <section class="card">
      <h2>👥 Jugadores</h2>
      <div class="row">
        <input type="text" class="grow" id="new-player" placeholder="Nombre" enterkeyhint="done">
        <button class="btn" data-act="add-player">Agregar</button>
      </div>
      <ul class="list">${players || '<li class="muted">Aún no hay jugadores.</li>'}</ul>
      <p class="hint">El <b>Handicap Index</b> se calcula con las tarjetas (WHS). Si alguien no tiene tarjetas, usa el index manual.</p>
    </section>

    <section class="card" id="tarjeta">
      <h2>📈 ${c.roundId ? 'Editar' : 'Nueva'} tarjeta de handicap</h2>
      <div class="row">
        <label class="f">Jugador<select data-ch="card" data-k="playerId">
          <option value="">—</option>${state.players.map(p => `<option value="${p.id}" ${p.id === c.playerId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select></label>
        <label class="f">Fecha<input type="date" value="${c.date}" data-ch="card" data-k="date"></label>
      </div>
      <div class="row">
        <label class="f">Campo<select data-ch="card" data-k="courseId">
          ${state.courses.map(x => `<option value="${x.id}" ${x.id === course?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select></label>
        <label class="f">Marca<select data-ch="card" data-k="teeId">
          ${(course?.tees || []).map(t => `<option value="${t.id}" ${t.id === c.teeId ? 'selected' : ''}>${esc(t.name)} · ${t.cr}/${t.slope}</option>`).join('')}
        </select></label>
      </div>
      <h3>Golpes por hoyo</h3>
      ${cardGrid}
      <div class="row" style="margin-top:10px">
        <button class="btn grow" data-act="save-card">${c.roundId ? 'Actualizar' : 'Guardar'} tarjeta</button>
        ${c.roundId ? '<button class="btn ghost" data-act="cancel-card">Cancelar</button>' : ''}
      </div>
      <p class="hint"><b>WHS:</b> cada hoyo se limita a Net Double Bogey; Diferencial = (AGS − CR) × 113 ÷ Slope de la marca;
      el Index promedia los mejores diferenciales según la tabla oficial (máx. 54).</p>
    </section>
  </div>
  <section class="card"><h2>🗂 Historial de tarjetas</h2><ul class="list">${roundsHtml || '<li class="muted">Sin tarjetas.</li>'}</ul></section>`;
};

/* ============================================================
 * TAB: CAMPOS
 * ============================================================ */
RENDER.campos = () => {
  const list = state.courses.map(c => `<li>
    <span class="name">${esc(c.name)}</span>
    <span>${c.tees.map(teeDot).join(' ')}</span>
    <button class="btn ghost sm" data-act="edit-course" data-id="${c.id}">Editar</button>
  </li>`).join('');

  const c = courseById(ui.editCourseId);
  let editor = '';
  if (c) {
    const tee = c.tees.find(t => t.id === ui.editTeeId) || c.tees[0];
    ui.editTeeId = tee?.id;
    const used = new Set(c.tees.map(t => t.id));
    const hcpCount = {};
    (tee?.holeHcps || []).forEach(v => { hcpCount[v] = (hcpCount[v] || 0) + 1; });
    const parT = tee ? Store.parTotal(tee) : 0;
    editor = `<section class="card">
      <h2>🚩 Editar campo</h2>
      <div class="row">
        <label class="f" style="flex:3 1 200px">Nombre<input type="text" value="${esc(c.name)}" data-ch="course" data-k="name"></label>
        <button class="btn danger sm" data-act="del-course" style="align-self:flex-end">Eliminar campo</button>
      </div>
      <h3>Marcas</h3>
      <div class="chips">
        ${Store.TEE_PRESETS.map(p => `<button class="chip ${used.has(p.id) ? 'on' : ''}" data-act="toggle-tee" data-id="${p.id}">${teeDot(p)} ${p.name}</button>`).join('')}
      </div>
      ${tee ? `
      <h3>Datos por marca</h3>
      <div class="seg" style="margin-bottom:10px;flex-wrap:wrap">
        ${c.tees.map(t => `<button class="${t.id === tee.id ? 'on' : ''}" data-act="edit-tee" data-id="${t.id}">${teeDot(t)} ${esc(t.name)}</button>`).join('')}
      </div>
      <div class="tee-card">
        <div class="row">
          <label class="f">Course Rating<input type="number" step="0.1" inputmode="decimal" value="${tee.cr}" data-ch="tee" data-k="cr"></label>
          <label class="f">Slope<input type="number" inputmode="numeric" value="${tee.slope}" data-ch="tee" data-k="slope"></label>
          <label class="f">Copiar par/hcp de
            <select data-ch="copy-tee"><option value="">—</option>
              ${c.tees.filter(t => t.id !== tee.id).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
            </select></label>
        </div>
        <h3>Par y hándicap por hoyo — ${esc(tee.name)} (par ${parT})</h3>
        <div class="table-wrap"><table class="t holes-table">
          ${[[0, 9], [9, 18]].map(([a, b]) => `
          <tr><th class="l">Hoyo</th>${Array.from({ length: b - a }, (_, k) => `<th>${a + k + 1}</th>`).join('')}</tr>
          <tr><td class="l">Par</td>${Array.from({ length: b - a }, (_, k) => `<td><input class="sm" type="number" inputmode="numeric" min="3" max="6" value="${tee.pars[a + k]}" data-ch="tee-hole" data-k="pars" data-i="${a + k}"></td>`).join('')}</tr>
          <tr><td class="l">Hcp</td>${Array.from({ length: b - a }, (_, k) => `<td class="${hcpCount[tee.holeHcps[a + k]] > 1 ? 'dup' : ''}"><input class="sm" type="number" inputmode="numeric" min="1" max="18" value="${tee.holeHcps[a + k]}" data-ch="tee-hole" data-k="holeHcps" data-i="${a + k}"></td>`).join('')}</tr>`).join('')}
        </table></div>
        ${Object.values(hcpCount).some(n => n > 1) ? '<p class="hint" style="color:var(--neg)">⚠️ Hay hándicaps de hoyo repetidos: cada número del 1 al 18 debe aparecer una vez.</p>' : ''}
      </div>
      <p class="hint">Cada marca tiene su propio CR, Slope, par y orden de ventajas. Las ventajas de cada jugador se asignan con <b>su</b> marca.</p>` : '<p class="hint">Activa al menos una marca.</p>'}
    </section>`;
  }

  return `<section class="card">
    <h2>🚩 Campos</h2>
    <ul class="list">${list || '<li class="muted">Sin campos.</li>'}</ul>
    <div class="row" style="margin-top:8px">
      <input type="text" class="grow" id="new-course" placeholder="Nombre del campo nuevo">
      <button class="btn" data-act="add-course">Crear con 5 marcas</button>
    </div>
  </section>${editor}`;
};

/* ============================================================
 * TAB: AJUSTES
 * ============================================================ */
function renderSyncCard() {
  const i = Sync.info(); const c = i.config || {};
  const [dot, txt] = SYNC_LABEL[i.status] || ['⚪', i.status];
  const who = state.players.map(p => `<option ${c.me === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  if (i.configured) {
    return `<section class="card full-span">
      <h2>☁️ Sincronización <span class="spacer"></span><span class="pill ${i.status === 'en-vivo' ? 'ok' : 'live'}" id="sync-status">${dot} ${txt}</span></h2>
      <p class="hint" style="margin-top:0">Conectado a la familia <b>${esc(c.code.slice(0, 2))}••••••</b>${i.realtime ? ' · avisos instantáneos activos' : ' · revisando cada 20 s'}.
      ${i.lastAt ? `Último cambio: ${esc(i.lastBy || 'alguien')} · ${new Date(i.lastAt).toLocaleString('es-CO')}` : ''}
      ${i.error ? `<br><span style="color:var(--neg)">${esc(i.error)}</span>` : ''}</p>
      <div class="row" style="margin-top:8px">
        <label class="f">¿Quién usa este celular?<select data-ch="sync-me"><option value="">—</option>${who}</select></label>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn grow" data-act="sync-invite">🔗 Link de invitación</button>
        <button class="btn ghost grow" data-act="sync-now">↻ Sincronizar ya</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn ghost sm" data-act="sync-overwrite">⬆️ Reemplazar la nube con este celular</button>
        <button class="btn danger sm" data-act="sync-disconnect">Desconectar</button>
      </div>
      <p class="hint">Manda el link por WhatsApp a la familia: al abrirlo quedan conectados. <b>Quien tenga el link puede ver y editar</b>, compártelo solo con la familia.</p>
    </section>`;
  }
  return `<section class="card full-span">
    <h2>☁️ Sincronización <span class="spacer"></span><span class="pill" id="sync-status">${dot} ${txt}</span></h2>
    <p class="hint" style="margin-top:0">Conecta la app a Supabase para que toda la familia vea la misma información en tiempo real.
    Lo más fácil: abre el <b>link de invitación</b> que te mande quien ya está conectado. Para configurarlo la primera vez sigue <code>docs/SUPABASE.md</code>.</p>
    <div class="row" style="margin-top:8px">
      <label class="f" style="flex:2 1 220px">URL del proyecto<input type="text" id="sync-url" placeholder="https://xxxx.supabase.co" value="${esc(c.url || '')}" autocomplete="off"></label>
      <label class="f" style="flex:2 1 220px">Llave pública (anon / publishable)<input type="text" id="sync-key" placeholder="eyJ… o sb_publishable_…" autocomplete="off"></label>
      <label class="f">Código de familia (mín. 8)<input type="text" id="sync-code" placeholder="ej. noriega-golf-2026" value="${esc(c.code || '')}" autocomplete="off"></label>
    </div>
    <button class="btn" data-act="sync-connect" style="margin-top:10px">Conectar</button>
    <p class="hint">Si la familia aún no existe en la nube, se crea con los datos de este celular. Si ya existe, este celular descarga la de la nube (lo de aquí queda respaldado).</p>
  </section>`;
}

RENDER.ajustes = () => {
  const s = state.settings;
  return `${renderSyncCard()}<div class="grid2">
  <section class="card">
    <h2>⚙️ Reglas de la familia</h2>
    <div class="row">
      <label class="f">% de handicap que se juega<input type="number" inputmode="numeric" value="${Math.round(s.allowance * 100)}" data-ch="setting" data-k="allowance"></label>
      <label class="f">Umbral handicap alto (PH &gt;)<input type="number" inputmode="numeric" value="${s.highHcpThreshold}" data-ch="setting" data-k="highHcpThreshold"></label>
    </div>
    <div class="row" style="margin-top:6px">
      <label class="f">Ventajas
        <select data-ch="setting" data-k="strokeMode">
          <option value="full" ${s.strokeMode === 'full' ? 'selected' : ''}>Completas (cada uno su PH)</option>
          <option value="offLow" ${s.strokeMode === 'offLow' ? 'selected' : ''}>Relativas al más bajo del grupo</option>
        </select></label>
      <label class="f">Moneda<input type="text" value="${esc(s.currency)}" data-ch="setting" data-k="currency"></label>
    </div>
    <p class="hint">Estos valores se copian a cada ronda al empezarla, así el historial no cambia si luego ajustas las reglas.</p>
  </section>

  <section class="card">
    <h2>💾 Datos</h2>
    <div class="row">
      <button class="btn grow" data-act="export">⬇️ Exportar JSON</button>
      <button class="btn ghost grow" data-act="copy-json">📋 Copiar JSON</button>
      <label class="btn ghost grow" style="cursor:pointer">⬆️ Importar<input type="file" accept="application/json,.json" data-ch="import" hidden></label>
    </div>
    <p class="hint">${Sync.info().configured ? 'Los datos viven en la nube (Supabase) y este celular guarda una copia para usar sin señal.' : 'Por ahora todo se guarda solo en este celular: conecta la sincronización arriba.'}
    Exportar el JSON sirve como respaldo o para tu agente <b>Hermes</b> (ver <code>docs/HERMES.md</code>). ${storage ? '' : '<b style="color:var(--neg)">⚠️ El almacenamiento está bloqueado: los datos se pierden al cerrar.</b>'}</p>
    <h3>Rondas guardadas</h3>
    <ul class="list">${[...state.games].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(g => `<li>
      <span class="name">${g.date} · ${esc(courseById(g.courseId)?.name || '?')}<br><small class="muted">${g.players.map(p => pName(p.playerId)).map(esc).join(', ')}</small></span>
      <span class="pill ${g.status === 'en juego' ? 'live' : 'ok'}">${g.status}</span>
      <button class="btn ghost sm" data-act="open-game" data-id="${g.id}">Ver</button>
    </li>`).join('') || '<li class="muted">Sin rondas.</li>'}</ul>
    <button class="btn danger sm" data-act="reset" style="margin-top:12px">Borrar todo</button>
  </section></div>`;
};

/* ============================================================
 * Acciones (clicks)
 * ============================================================ */
const ACT = {
  tab: (el) => setTab(el.dataset.tab),

  /* --- setup --- */
  'draft-toggle': (el) => {
    const d = ui.draft, id = el.dataset.id;
    const i = d.players.findIndex(p => p.playerId === id);
    if (i >= 0) d.players.splice(i, 1);
    else d.players.push(draftPlayer(id, courseById(d.courseId)));
    render();
  },
  'draft-move': (el) => {
    const d = ui.draft, i = +el.dataset.i, j = i + +el.dataset.d;
    if (j < 0 || j >= d.players.length) return;
    [d.players[i], d.players[j]] = [d.players[j], d.players[i]];
    render();
  },
  'start-game': () => {
    const d = ui.draft;
    if (!d || d.players.length < 2) return toast('Elige al menos 2 jugadores');
    const ids = d.players.map(p => p.playerId);
    const groups = [];
    for (let i = 0; i + 4 <= ids.length; i += 4) groups.push(ids.slice(i, i + 4));
    const game = {
      id: Store.uid('g'), date: d.date, courseId: d.courseId, status: 'en juego',
      settings: clone(state.settings),
      players: d.players.map(p => ({
        playerId: p.playerId, teeId: p.teeId,
        index: p.index === '' || p.index == null ? null : Number(p.index),
        playingHcp: p.playingHcp === '' || p.playingHcp == null ? null : Number(p.playingHcp),
        category: p.category || null
      })),
      bets: { ...clone(d.bets), robin: { ...clone(d.bets.robin), groups } },
      scores: Object.fromEntries(ids.map(id => [id, Array(18).fill(null)]))
    };
    state.games.push(game);
    state.activeGameId = game.id;
    ui.draft = null;
    persist(); render(); window.scrollTo(0, 0);
    toast('¡A jugar! ⛳');
  },

  /* --- en juego --- */
  goto: (el) => {
    const g = activeGame(); const h = +el.dataset.h;
    if (!g || h < 0 || h > 17) return;
    ui.holes[g.id] = h; saveUi(); render();
  },
  step: (el) => {
    const g = activeGame(); const h = curHole(g); const pid = el.dataset.pid; const k = el.dataset.k; const d = +el.dataset.d;
    const course = courseById(g.courseId);
    const gp = g.players.find(p => p.playerId === pid);
    const par = Store.teeOf(course, gp.teeId).pars[h];
    const s = g.scores[pid][h] || (g.scores[pid][h] = { strokes: null, putts: null, bunker: false, water: false });
    const base = k === 'strokes' ? par : 2;
    const cur = s[k] == null ? null : Number(s[k]);
    let v = cur == null ? (d > 0 ? base : base - 1) : cur + d;
    v = Math.max(k === 'strokes' ? 1 : 0, Math.min(k === 'strokes' ? 15 : 9, v));
    s[k] = v;
    if (k === 'strokes' && s.putts == null) s.putts = 2;
    if (k === 'putts' && s.strokes == null) s.strokes = par;
    persist(); render();
  },
  par: (el) => {
    const g = activeGame(); const h = curHole(g); const pid = el.dataset.pid;
    const gp = g.players.find(p => p.playerId === pid);
    const par = Store.teeOf(courseById(g.courseId), gp.teeId).pars[h];
    const prev = g.scores[pid][h] || {};
    g.scores[pid][h] = { strokes: par, putts: prev.putts ?? 2, bunker: !!prev.bunker, water: !!prev.water };
    persist(); render();
  },
  clear: (el) => {
    const g = activeGame(); g.scores[el.dataset.pid][curHole(g)] = null; persist(); render();
  },
  flag: (el) => {
    const g = activeGame(); const h = curHole(g); const pid = el.dataset.pid; const k = el.dataset.k;
    const s = g.scores[pid][h] || (g.scores[pid][h] = { strokes: null, putts: null, bunker: false, water: false });
    s[k] = !s[k];
    persist(); render();
  },
  'finish-game': () => {
    const g = activeGame();
    const missing = 18 * g.players.length - g.players.reduce((n, p) => n + g.scores[p.playerId].filter(s => s && s.strokes > 0).length, 0);
    if (missing && !confirm(`Faltan ${missing} scores. ¿Terminar igual?`)) return;
    g.status = 'terminada'; state.activeGameId = null; ui.viewGameId = g.id;
    persist(); setTab('apuestas'); toast('Ronda terminada 🏁');
  },

  /* --- resultados --- */
  'copy-summary': async () => {
    const g = state.games.find(x => x.id === ui.viewGameId);
    const txt = Bets.summaryText(Bets.computeGame(state, g));
    try { await navigator.clipboard.writeText(txt); toast('Resumen copiado — pégalo en WhatsApp'); }
    catch (e) { prompt('Copia el resumen:', txt); }
  },
  'reopen-game': () => {
    const g = state.games.find(x => x.id === ui.viewGameId);
    if (activeGame() && activeGame().id !== g.id) return toast('Ya hay otra ronda en juego');
    g.status = 'en juego'; state.activeGameId = g.id; persist(); setTab('ronda');
  },
  'delete-game': () => {
    if (!confirm('¿Eliminar esta ronda y sus apuestas?')) return;
    state.games = state.games.filter(x => x.id !== ui.viewGameId);
    if (state.activeGameId === ui.viewGameId) state.activeGameId = null;
    ui.viewGameId = null; persist(); render();
  },
  'register-cards': () => {
    const g = state.games.find(x => x.id === ui.viewGameId);
    let n = 0, skipped = [];
    g.players.forEach(p => {
      const sc = g.scores[p.playerId];
      if (!sc.every(s => s && s.strokes > 0)) { skipped.push(pName(p.playerId)); return; }
      const existing = state.rounds.find(r => r.gameId === g.id && r.playerId === p.playerId);
      Store.upsertRound(state, { roundId: existing?.id, playerId: p.playerId, courseId: g.courseId, teeId: p.teeId, date: g.date, scores: sc.map(s => Number(s.strokes)), gameId: g.id });
      n++;
    });
    persist(); render();
    toast(`${n} tarjeta(s) registradas` + (skipped.length ? ` · incompletas: ${skipped.join(', ')}` : ''));
  },

  /* --- jugadores --- */
  'add-player': () => {
    const inp = $('#new-player'); const name = inp.value.trim();
    if (!name) return;
    state.players.push({ id: Store.uid('p'), name, manualIndex: null, defaultTee: 'blancas' });
    persist(); render(); $('#new-player').focus();
  },
  'del-player': (el) => {
    const id = el.dataset.id;
    if (state.games.some(g => g.players.some(p => p.playerId === id))) return toast('Tiene rondas guardadas: no se puede eliminar');
    if (!confirm(`¿Eliminar a ${pName(id)} y sus tarjetas?`)) return;
    state.players = state.players.filter(p => p.id !== id);
    state.rounds = state.rounds.filter(r => r.playerId !== id);
    persist(); render();
  },
  'save-card': () => {
    const c = ui.card;
    if (!c.playerId) return toast('Elige el jugador');
    const scores = c.scores.map(Number);
    const miss = scores.findIndex(v => !(v >= 1));
    if (miss >= 0) return toast(`Falta el hoyo ${miss + 1}`);
    try {
      Store.upsertRound(state, { roundId: c.roundId, playerId: c.playerId, courseId: c.courseId, teeId: c.teeId, date: c.date, scores });
    } catch (e) { return toast(e.message); }
    ui.card = { ...c, scores: Array(18).fill(''), roundId: null };
    persist(); render(); toast('Tarjeta guardada');
  },
  'edit-card': (el) => {
    const r = state.rounds.find(x => x.id === el.dataset.id);
    ui.card = { playerId: r.playerId, courseId: r.courseId, teeId: r.teeId, date: r.date, scores: [...r.scores], roundId: r.id };
    render(); document.getElementById('tarjeta').scrollIntoView({ behavior: 'smooth' });
  },
  'cancel-card': () => { ui.card = null; render(); },
  'del-card': (el) => {
    if (!confirm('¿Eliminar esta tarjeta?')) return;
    const r = state.rounds.find(x => x.id === el.dataset.id);
    state.rounds = state.rounds.filter(x => x.id !== r.id);
    Store.recalcPlayerRounds(state, r.playerId);
    persist(); render();
  },

  /* --- campos --- */
  'add-course': () => {
    const name = $('#new-course').value.trim() || 'Campo nuevo';
    const c = Store.sampleCourse(); c.name = name;
    state.courses.push(c); ui.editCourseId = c.id; ui.editTeeId = null;
    persist(); render(); toast('Campo creado: edita CR, Slope, par y hándicaps de cada marca');
  },
  'edit-course': (el) => { ui.editCourseId = el.dataset.id; ui.editTeeId = null; render(); },
  'edit-tee': (el) => { ui.editTeeId = el.dataset.id; render(); },
  'toggle-tee': (el) => {
    const c = courseById(ui.editCourseId); const id = el.dataset.id;
    const i = c.tees.findIndex(t => t.id === id);
    if (i >= 0) {
      if (c.tees.length === 1) return toast('El campo necesita al menos una marca');
      if (state.games.some(g => g.courseId === c.id && g.players.some(p => p.teeId === id))) return toast('Esa marca se usó en rondas guardadas');
      c.tees.splice(i, 1);
    } else {
      const base = c.tees[0];
      c.tees.push(Store.makeTee(id, base.cr, base.slope, base.pars, base.holeHcps));
      c.tees.sort((a, b) => Store.TEE_PRESETS.findIndex(p => p.id === a.id) - Store.TEE_PRESETS.findIndex(p => p.id === b.id));
      ui.editTeeId = id;
    }
    persist(); render();
  },
  'del-course': () => {
    const c = courseById(ui.editCourseId);
    if (state.games.some(g => g.courseId === c.id) || state.rounds.some(r => r.courseId === c.id)) return toast('El campo tiene rondas o tarjetas guardadas');
    if (!confirm(`¿Eliminar ${c.name}?`)) return;
    state.courses = state.courses.filter(x => x.id !== c.id); ui.editCourseId = null;
    persist(); render();
  },

  /* --- sincronización --- */
  'sync-connect': async () => {
    const url = $('#sync-url').value.trim(), key = $('#sync-key').value.trim(), code = $('#sync-code').value.trim();
    if (!/^https?:\/\//.test(url)) return toast('La URL debe empezar por https://');
    if (!key) return toast('Falta la llave pública');
    if (code.length < 8) return toast('El código de familia necesita mínimo 8 caracteres');
    await Sync.configure({ url, key, code });
    render();
    toast(Sync.info().status === 'en-vivo' ? '¡Conectado! 🟢' : 'No se pudo conectar: ' + Sync.info().error);
  },
  'sync-disconnect': () => {
    if (!confirm('¿Desconectar este celular? Los datos quedan aquí, pero dejan de sincronizarse.')) return;
    Sync.disconnect(); render();
  },
  'sync-now': async () => { await Sync.syncNow(); render(); toast('Sincronizado'); },
  'sync-invite': async () => {
    const link = Sync.inviteLink();
    try { await navigator.clipboard.writeText(link); toast('Link copiado — mándalo por WhatsApp'); }
    catch (e) { prompt('Copia este link:', link); }
  },
  'sync-overwrite': async () => {
    if (!confirm('Esto reemplaza los datos de TODA la familia con los de este celular (queda copia en el historial). ¿Seguro?')) return;
    try { await Sync.overwriteCloud(); toast('Nube actualizada'); } catch (e) { toast(e.message); }
    render();
  },

  /* --- ajustes --- */
  'open-game': (el) => { ui.viewGameId = el.dataset.id; setTab('apuestas'); },
  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `golf-familia-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'copy-json': async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(state)); toast('JSON copiado'); }
    catch (e) { toast('No se pudo copiar'); }
  },
  reset: () => {
    if (!confirm('¿Borrar TODOS los datos? Exporta antes si quieres conservarlos.')) return;
    state = Store.migrate(null); ui.draft = null; ui.card = null; persist(); render();
  }
};

/* ============================================================
 * Cambios (inputs / selects)
 * ============================================================ */
const num = (v) => (v === '' || v == null ? null : Number(v));
const CH = {
  draft: (el) => {
    ui.draft[el.dataset.k] = el.value;
    if (el.dataset.k === 'courseId') {
      const c = courseById(el.value);
      ui.draft.players = ui.draft.players.map(p => ({ ...p, teeId: c.tees.some(t => t.id === p.teeId) ? p.teeId : draftPlayer(p.playerId, c).teeId }));
    }
    render();
  },
  'draft-p': (el) => {
    const p = ui.draft.players[+el.dataset.i]; const k = el.dataset.k;
    p[k] = k === 'index' || k === 'playingHcp' ? num(el.value) : (el.value || null);
    render();
  },
  'draft-robin': (el) => {
    const r = ui.draft.bets.robin; const k = el.dataset.k;
    r[k] = el.type === 'checkbox' ? el.checked : (k === 'puttsMode' ? el.value : Number(el.value) || 0);
    render();
  },
  'draft-war-on': (el) => { ui.draft.bets.war.enabled = el.checked; render(); },
  'draft-war': (el) => { ui.draft.bets.war[el.dataset.k][el.dataset.s] = Number(el.value) || 0; },
  'sync-me': (el) => { Sync.setMe(el.value); toast('Guardado'); },
  'view-game': (el) => { ui.viewGameId = el.value; render(); },
  player: (el) => {
    const p = playerById(el.dataset.id); const k = el.dataset.k;
    p[k] = k === 'manualIndex' ? num(el.value) : el.value;
    persist(); render();
  },
  card: (el) => { ui.card[el.dataset.k] = el.value; if (el.dataset.k === 'courseId') ui.card.teeId = ''; render(); },
  'card-score': (el) => { ui.card.scores[+el.dataset.i] = el.value === '' ? '' : Number(el.value); },
  course: (el) => { courseById(ui.editCourseId)[el.dataset.k] = el.value; persist(); },
  tee: (el) => {
    const t = courseById(ui.editCourseId).tees.find(t => t.id === ui.editTeeId);
    t[el.dataset.k] = Number(el.value); persist();
    reRecalcCourse(ui.editCourseId);
  },
  'tee-hole': (el) => {
    const t = courseById(ui.editCourseId).tees.find(t => t.id === ui.editTeeId);
    t[el.dataset.k][+el.dataset.i] = Number(el.value); persist();
    reRecalcCourse(ui.editCourseId); render();
  },
  'copy-tee': (el) => {
    if (!el.value) return;
    const c = courseById(ui.editCourseId);
    const src = c.tees.find(t => t.id === el.value), dst = c.tees.find(t => t.id === ui.editTeeId);
    dst.pars = [...src.pars]; dst.holeHcps = [...src.holeHcps];
    persist(); render(); toast(`Copiado de ${src.name}`);
  },
  setting: (el) => {
    const k = el.dataset.k; let v = el.value;
    if (k === 'allowance') v = (Number(v) || 100) / 100;
    if (k === 'highHcpThreshold') v = Number(v) || 0;
    state.settings[k] = v; persist(); toast('Guardado');
  },
  import: (el) => {
    const f = el.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const data = Store.migrate(JSON.parse(rd.result));
        if (!confirm(`Importar ${data.players.length} jugadores, ${data.courses.length} campos, ${data.games.length} rondas? Reemplaza los datos actuales.`)) return;
        state = data; persist(); render(); toast('Datos importados');
      } catch (e) { toast('JSON inválido'); }
    };
    rd.readAsText(f);
  }
};

function reRecalcCourse(courseId) {
  [...new Set(state.rounds.filter(r => r.courseId === courseId).map(r => r.playerId))].forEach(pid => Store.recalcPlayerRounds(state, pid));
  persist();
}

/* ============================================================
 * Init
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
  view().addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (el && !el.disabled && ACT[el.dataset.act]) ACT[el.dataset.act](el, e);
  });
  view().addEventListener('change', (e) => {
    const el = e.target.closest('[data-ch]');
    if (el && CH[el.dataset.ch]) CH[el.dataset.ch](el, e);
  });
  view().addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'new-player') ACT['add-player']();
    if (e.target.id === 'new-course') ACT['add-course']();
  });
  view().addEventListener('focusout', () => { setTimeout(() => { if (renderPending && !view().contains(document.activeElement)) render(); }, 50); });
  if (activeGame()) ui.tab = 'ronda';
  render();
  Sync.init({
    getState: () => state,
    setState: applyRemote,
    onStatus: (i) => {
      syncBadge();
      const el = $('#sync-status'); const [dot, txt] = SYNC_LABEL[i.status] || ['⚪', i.status];
      if (el) el.textContent = `${dot} ${txt}`;
    }
  }, storage || memStore);
});

/* ============================================================
 * API para agentes (Hermes) — ver docs/HERMES.md
 * Se usa desde la consola del navegador o un navegador automatizado.
 * ============================================================ */
window.GolfApp = {
  version: Store.SCHEMA_VERSION,
  getState: () => clone(state),
  setState: (s) => { state = Store.migrate(clone(s)); persist(); render(); return true; },
  activeGameId: () => activeGame()?.id || null,
  results: (gameId) => Bets.computeGame(state, state.games.find(g => g.id === (gameId || state.activeGameId)) || state.games[state.games.length - 1]),
  summary: (gameId) => Bets.summaryText(window.GolfApp.results(gameId)),
  /** hole: 1–18. score: {strokes, putts, bunker, water} (parcial ok). */
  setScore: (gameId, playerId, hole, score) => {
    const g = state.games.find(x => x.id === gameId);
    if (!g) throw new Error('Ronda no encontrada');
    if (!g.scores[playerId]) throw new Error('El jugador no está en la ronda');
    if (!(hole >= 1 && hole <= 18)) throw new Error('Hoyo 1–18');
    g.scores[playerId][hole - 1] = { strokes: null, putts: null, bunker: false, water: false, ...(g.scores[playerId][hole - 1] || {}), ...score };
    persist(); render(); return g.scores[playerId][hole - 1];
  },
  goToTab: (t) => setTab(t),
  sync: { info: () => Sync.info(), now: () => Sync.syncNow(), inviteLink: () => Sync.inviteLink() }
};
