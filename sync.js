/* ============================================================
 * sync.js — Sincronización en tiempo real con Supabase (navegador)
 *
 * - La nube es la fuente de verdad; cada celular guarda una copia
 *   (localStorage) para abrir rápido y seguir anotando sin señal.
 * - Al guardar: se sube con control de versión. Si alguien guardó
 *   antes, se mezcla (Store.merge3) y se reintenta.
 * - Aviso instantáneo a los demás por Supabase Realtime (broadcast);
 *   si Realtime no está disponible, se consulta cada 20 s.
 *
 * Configuración (en este orden de prioridad):
 *   1. Link de invitación: ?sb=<url>&k=<llave>&familia=<código>
 *   2. Ajustes → Sincronización (se guarda en este celular)
 *   3. config.js (window.GOLF_CONFIG) — opcional
 * ============================================================ */
'use strict';

const Sync = (() => {
  const CFG_KEY = 'golf-cloud-config';
  const META_KEY = 'golf-cloud-meta';   // {rev, base} del último estado sincronizado
  const POLL_MS = 20000;

  let store = null;           // localStorage o sustituto
  let cfg = null;
  let rev = 0;
  let base = null;
  let hooks = null;           // {getState, setState, onStatus}
  let status = 'local';       // local | conectando | en-vivo | guardando | sin-conexion | error
  let lastError = '';
  let lastBy = '';
  let lastAt = '';
  let pushTimer = null;
  let busy = false;
  let again = false;
  let pullAgain = false;
  let pollTimer = null;
  let channel = null;
  let client = null;
  let rtOk = false;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const read = (k) => { try { return JSON.parse(store.getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno o bloqueado */ } };

  function setStatus(s, err) {
    status = s; lastError = err || '';
    hooks && hooks.onStatus && hooks.onStatus(info());
  }

  function info() {
    return { status, error: lastError, configured: Cloud.isConfigured(cfg), rev, lastBy, lastAt, realtime: rtOk, config: cfg ? { url: cfg.url, code: cfg.code, me: cfg.me || '' } : null };
  }

  function loadConfig() {
    const fromFile = (typeof window !== 'undefined' && window.GOLF_CONFIG) || {};
    const saved = read(CFG_KEY) || {};
    let c = { url: fromFile.supabaseUrl || '', key: fromFile.supabaseKey || '', code: fromFile.familyCode || '', me: '' , ...saved };
    // Link de invitación
    try {
      const u = new URL(window.location.href);
      const p = u.searchParams;
      if (p.get('familia') || p.get('sb') || p.get('k')) {
        c = { ...c, url: p.get('sb') || c.url, key: p.get('k') || c.key, code: p.get('familia') || c.code };
        write(CFG_KEY, c);
        ['familia', 'sb', 'k'].forEach(x => p.delete(x));
        window.history.replaceState(null, '', u.pathname + (p.toString() ? '?' + p : '') + u.hash);
      }
    } catch (e) { /* sin URL (tests) */ }
    return c;
  }

  function saveMeta() { write(META_KEY, { rev, base, code: cfg && cfg.code }); }
  const dirty = () => !Store.deepEq(hooks.getState(), base);

  /** Trae la nube y la combina con lo local. */
  async function pull() {
    if (!Cloud.isConfigured(cfg)) return;
    if (busy) { pullAgain = true; return; }
    let remote;
    try { remote = await Cloud.get(cfg); }
    catch (e) { setStatus('sin-conexion', e.message); return; }

    if (!remote) {
      // Familia nueva: este celular la crea con lo que tenga.
      rev = 0; base = null;
      await flush();
      return;
    }
    lastBy = remote.updated_by || ''; lastAt = remote.updated_at || '';
    if (remote.rev === rev && !dirty()) { setStatus('en-vivo'); return; }

    const local = hooks.getState();
    let next;
    if (rev === 0 || base == null) {
      // Primera vez en este celular: se adopta la nube y se respalda lo local.
      const hasLocal = local.players.length || local.games.length || local.rounds.length;
      if (hasLocal) write('golf-respaldo-' + new Date().toISOString().slice(0, 10), local);
      next = Store.migrate(remote.data);
    } else if (remote.rev !== rev) {
      next = dirty() ? Store.migrate(Store.merge3(base, local, remote.data)) : Store.migrate(remote.data);
    } else {
      next = local;
    }
    const pending = !Store.deepEq(next, remote.data);
    base = clone(remote.data); rev = remote.rev; saveMeta();
    if (!Store.deepEq(next, local)) hooks.setState(next, { remote: true, by: remote.updated_by });
    if (pending) schedulePush(0); else setStatus('en-vivo');
  }

  /** Sube lo local (mezclando si hace falta). */
  async function flush() {
    if (!Cloud.isConfigured(cfg)) return;
    if (busy) { again = true; return; }
    busy = true; again = false;
    setStatus('guardando');
    try {
      const local = clone(hooks.getState());
      const res = await Cloud.saveMerged(cfg, base, local, rev, cfg.me || null);
      const merged = Store.migrate(res.state);
      rev = res.rev; base = clone(merged); saveMeta();
      lastBy = cfg.me || ''; lastAt = new Date().toISOString();
      // Si se mezcló con cambios de otro, aplicar sobre lo que haya ahora (pudo cambiar mientras subía).
      if (!Store.deepEq(merged, local)) {
        hooks.setState(Store.migrate(Store.merge3(local, hooks.getState(), merged)), { remote: true });
      }
      announce();
      setStatus('en-vivo');
    } catch (e) {
      setStatus(navigator.onLine === false || /fetch|network|Failed/i.test(e.message) ? 'sin-conexion' : 'error', e.message);
    } finally {
      busy = false;
      if (pullAgain) { pullAgain = false; pull(); }
      else if (again || (status === 'en-vivo' && dirty())) schedulePush(300);
    }
  }

  function schedulePush(ms = 600) {
    if (!Cloud.isConfigured(cfg)) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, ms);
  }

  /* ---------- Realtime ---------- */
  function announce() {
    if (channel) try { channel.send({ type: 'broadcast', event: 'rev', payload: { rev } }); } catch (e) { /* ignorar */ }
  }

  function connectRealtime() {
    disconnectRealtime();
    if (!window.supabase || !window.supabase.createClient) return;
    try {
      client = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: false } });
      channel = client.channel(Cloud.channelName(cfg.code), { config: { broadcast: { self: false } } });
      channel.on('broadcast', { event: 'rev' }, ({ payload }) => { if (!payload || payload.rev !== rev) pull(); });
      channel.subscribe((st) => { rtOk = st === 'SUBSCRIBED'; setStatus(status, lastError); if (rtOk) pull(); });
    } catch (e) { channel = null; }
  }
  function disconnectRealtime() {
    try { if (channel && client) client.removeChannel(channel); } catch (e) { /* ignorar */ }
    channel = null; client = null; rtOk = false;
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState !== 'hidden') pull(); }, POLL_MS);
  }

  /* ---------- API ---------- */
  async function init(h, storage) {
    hooks = h; store = storage;
    cfg = loadConfig();
    const meta = read(META_KEY);
    if (meta && cfg && meta.code === cfg.code) { rev = meta.rev || 0; base = meta.base || null; }
    if (!Cloud.isConfigured(cfg)) { setStatus('local'); return; }
    setStatus('conectando');
    window.addEventListener('online', () => { pull(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
    connectRealtime();
    startPolling();
    await pull();
  }

  async function configure(newCfg) {
    const changedFamily = !cfg || newCfg.code !== cfg.code || newCfg.url !== cfg.url;
    cfg = { ...cfg, ...newCfg };
    write(CFG_KEY, cfg);
    if (changedFamily) { rev = 0; base = null; saveMeta(); }
    if (!Cloud.isConfigured(cfg)) { disconnectRealtime(); clearInterval(pollTimer); setStatus('local'); return; }
    setStatus('conectando');
    connectRealtime(); startPolling();
    await pull();
  }

  function disconnect() {
    cfg = { ...cfg, code: '' }; write(CFG_KEY, cfg);
    rev = 0; base = null; saveMeta();
    disconnectRealtime(); clearInterval(pollTimer);
    setStatus('local');
  }

  /** Sube este celular reemplazando la nube (queda en el historial). */
  async function overwriteCloud() {
    const remote = await Cloud.get(cfg);
    const res = await Cloud.save(cfg, remote ? remote.rev : 0, hooks.getState(), cfg.me || null);
    if (!res.ok) throw new Error('Alguien guardó al mismo tiempo; intenta de nuevo');
    rev = res.rev; base = clone(hooks.getState()); saveMeta(); announce(); setStatus('en-vivo');
  }

  function inviteLink() {
    if (!Cloud.isConfigured(cfg)) return '';
    const u = new URL(window.location.href.split('?')[0].split('#')[0]);
    u.searchParams.set('sb', cfg.url); u.searchParams.set('k', cfg.key); u.searchParams.set('familia', cfg.code);
    return u.toString();
  }

  return {
    init, configure, disconnect, overwriteCloud, inviteLink, info,
    changed: () => schedulePush(),
    syncNow: () => pull(),
    setMe: (me) => { cfg = { ...(cfg || {}), me }; write(CFG_KEY, cfg); }
  };
})();
