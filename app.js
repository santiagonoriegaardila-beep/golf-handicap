/* ============================================================
 * app.js — Interfaz del módulo Handicap
 * ============================================================ */

let state = loadState();
let editingRoundId = null;

const $ = (sel) => document.querySelector(sel);

/* ---------------- Jugadores ---------------- */

function renderPlayers() {
  const list = $('#players-list');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const idx = handicapIndex(differentialsOf(p.id));
    const li = document.createElement('li');
    li.className = 'player-item';
    li.innerHTML = `
      <span class="p-name">${esc(p.name)}</span>
      <span class="p-index">${idx != null ? idx.toFixed(1) : '—'}</span>
      <span class="p-count">${state.rounds.filter(r => r.playerId === p.id).length} tarjeta(s)</span>
      <button class="btn-danger" onclick="deletePlayer('${p.id}')">✕</button>`;
    list.appendChild(li);
  });
  const sel = $('#round-player');
  sel.innerHTML = '<option value="">— Jugador —</option>' +
    state.players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

function addPlayer() {
  const name = $('#player-name').value.trim();
  if (!name) return;
  state.players.push({ id: 'p' + Date.now(), name });
  $('#player-name').value = '';
  saveState(state);
  renderPlayers();
}

function deletePlayer(id) {
  state.players = state.players.filter(p => p.id !== id);
  saveState(state);
  renderPlayers();
}

/* ---------------- Campos ---------------- */

const DEFAULT_PARS = [4,4,3,4,5,4,4,3,5,4,4,3,4,5,4,4,3,5];
const DEFAULT_HOLE_HCPS = [11,5,15,1,13,9,17,7,3,18,4,14,6,12,16,2,10,8];

function renderCourses() {
  const list = $('#courses-list');
  list.innerHTML = '';
  state.courses.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'course-item';
    li.innerHTML = `
      <span class="c-name">${esc(c.name)}</span>
      <span class="c-meta">CR ${c.cr} · Slope ${c.slope} · Par ${c.pars.reduce((a,b)=>a+b,0)}</span>
      <button class="btn-danger" onclick="deleteCourse('${c.id}')">✕</button>`;
    list.appendChild(li);
  });
  const sel = $('#round-course');
  sel.innerHTML = '<option value="">— Campo —</option>' +
    state.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function addCourse() {
  const name = $('#course-name').value.trim();
  const cr = parseFloat($('#course-cr').value);
  const slope = parseFloat($('#course-slope').value);
  if (!name || isNaN(cr) || isNaN(slope)) { alert('Completa nombre, Course Rating y Slope'); return; }
  const course = {
    id: 'c' + Date.now(), name, cr, slope,
    pars: [...DEFAULT_PARS],
    holeHcps: [...DEFAULT_HOLE_HCPS]
  };
  state.courses.push(course);
  saveState(state);
  $('#course-name').value = ''; $('#course-cr').value = ''; $('#course-slope').value = '';
  renderCourses();
}

function deleteCourse(id) {
  state.courses = state.courses.filter(c => c.id !== id);
  saveState(state);
  renderCourses();
}

/* ---------------- Tarjetas (scores) ---------------- */

function differentialsOf(playerId) {
  return state.rounds
    .filter(r => r.playerId === playerId)
    .map(r => r.differential);
}

function currentIndex(playerId) {
  return handicapIndex(differentialsOf(playerId));
}

function buildScoreGrid() {
  const courseId = $('#round-course').value;
  const course = state.courses.find(c => c.id === courseId);
  const grid = $('#score-grid');
  grid.innerHTML = '';
  if (!course) return;
  const existing = editingRoundId
    ? state.rounds.find(r => r.id === editingRoundId)?.scores
    : null;

  const mk = (holes, half, label) => {
    const div = document.createElement('div');
    div.className = 'half-card';
    let html = `<h4>${label}</h4><div class="holes">`;
    holes.forEach((i) => {
      html += `<div class="hole">
        <label>H${i + 1} <small>par ${course.pars[i]} · hdcp ${course.holeHcps[i]}</small></label>
        <input type="number" min="1" max="15" id="h${i}"
               value="${existing ? existing[i] : (course.pars[i] + 2)}" required>
      </div>`;
    });
    div.innerHTML = html + '</div>';
    grid.appendChild(div);
  };
  mk([0,1,2,3,4,5,6,7,8], 'front', 'Ida (H1–H9)');
  mk([9,10,11,12,13,14,15,16,17], 'back', 'Vuelta (H10–H18)');
}

function saveRound() {
  const playerId = $('#round-player').value;
  const courseId = $('#round-course').value;
  const course = state.courses.find(c => c.id === courseId);
  if (!playerId || !course) { alert('Selecciona jugador y campo'); return; }

  const scores = [];
  for (let i = 0; i < 18; i++) {
    const v = parseInt(document.getElementById('h' + i).value, 10);
    if (isNaN(v) || v < 1) { alert(`Falta el score del hoyo ${i + 1}`); return; }
    scores.push(v);
  }

  // El index usado para ajuste es el que existía ANTES de esta ronda
  const priorIndex = currentIndex(playerId);
  const holes = scores.map((s, i) => ({
    par: course.pars[i], strokes: s, holeHandicap: course.holeHcps[i]
  }));
  const ags = adjustedGrossScore(holes, priorIndex);
  const gross = scores.reduce((a, b) => a + b, 0);
  const differential = Math.round(scoreDifferential(ags, course.cr, course.slope) * 10) / 10;

  if (editingRoundId) {
    const r = state.rounds.find(r => r.id === editingRoundId);
    Object.assign(r, { playerId, courseId, courseName: course.name, scores, gross, ags, differential, date: $('#round-date').value });
    editingRoundId = null;
    $('#save-round-btn').textContent = 'Guardar tarjeta';
  } else {
    state.rounds.push({
      id: 'r' + Date.now(), playerId, courseId, courseName: course.name,
      scores, gross, ags, differential, date: $('#round-date').value || new Date().toISOString().slice(0, 10)
    });
  }

  // Recalcular TODAS las tarjetas del jugador con el index vigente en cada fecha
  recalcPlayer(playerId);
  saveState(state);
  renderPlayers(); renderRounds(); buildScoreGrid();
}

function recalcPlayer(playerId) {
  const rounds = state.rounds
    .filter(r => r.playerId === playerId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
  const courseById = Object.fromEntries(state.courses.map(c => [c.id, c]));
  const diffs = [];
  rounds.forEach(r => {
    const course = courseById[r.courseId];
    if (!course) { diffs.push(r.differential); return; }
    const idx = handicapIndex(diffs);
    const holes = r.scores.map((s, i) => ({
      par: course.pars[i], strokes: s, holeHandicap: course.holeHcps[i]
    }));
    r.ags = adjustedGrossScore(holes, idx);
    r.differential = Math.round(scoreDifferential(r.ags, course.cr, course.slope) * 10) / 10;
    diffs.push(r.differential);
  });
}

function editRound(id) {
  const r = state.rounds.find(r => r.id === id);
  if (!r) return;
  editingRoundId = id;
  $('#round-player').value = r.playerId;
  $('#round-course').value = r.courseId;
  $('#round-date').value = r.date;
  buildScoreGrid();
  $('#save-round-btn').textContent = 'Actualizar tarjeta';
  document.getElementById('tarjeta').scrollIntoView({ behavior: 'smooth' });
}

function deleteRound(id) {
  if (!confirm('¿Eliminar esta tarjeta?')) return;
  const r = state.rounds.find(r => r.id === id);
  state.rounds = state.rounds.filter(r => r.id !== id);
  if (r) recalcPlayer(r.playerId);
  saveState(state);
  renderPlayers(); renderRounds();
}

function renderRounds() {
  const list = $('#rounds-list');
  list.innerHTML = '';
  const rounds = [...state.rounds].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  rounds.forEach((r) => {
    const player = state.players.find(p => p.id === r.playerId);
    const li = document.createElement('li');
    li.className = 'round-item';
    li.innerHTML = `
      <div class="r-main">
        <span class="r-player">${esc(player ? player.name : '?')}</span>
        <span class="r-course">${esc(r.courseName)}</span>
        <span class="r-date">${r.date || ''}</span>
      </div>
      <div class="r-nums">
        <span>Bruto <b>${r.gross}</b></span>
        <span>Ajustado <b>${r.ags}</b></span>
        <span class="r-diff">Dif <b>${r.differential.toFixed(1)}</b></span>
      </div>
      <div class="r-actions">
        <button onclick="editRound('${r.id}')">Editar</button>
        <button class="btn-danger" onclick="deleteRound('${r.id}')">✕</button>
      </div>`;
    list.appendChild(li);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Init ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  $('#today').textContent = new Date().toISOString().slice(0, 10);
  $('#round-date').value = new Date().toISOString().slice(0, 10);
  $('#add-player-btn').addEventListener('click', addPlayer);
  $('#player-name').addEventListener('keydown', e => { if (e.key === 'Enter') addPlayer(); });
  $('#add-course-btn').addEventListener('click', addCourse);
  $('#round-course').addEventListener('change', () => { editingRoundId = null; buildScoreGrid(); });
  $('#save-round-btn').addEventListener('click', saveRound);
  renderPlayers();
  renderCourses();
  buildScoreGrid();
  renderRounds();
});
