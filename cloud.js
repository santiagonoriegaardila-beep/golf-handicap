/* ============================================================
 * cloud.js — Cliente de Supabase (sin dependencias)
 *
 * Habla con las funciones `golf_get` y `golf_save` definidas en
 * supabase/schema.sql. Funciona en navegador y en Node 18+ (fetch).
 * El acceso se protege con el CÓDIGO DE FAMILIA: sin él no se lee ni
 * se escribe nada (la tabla no es accesible directamente).
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./store.js'));
  else root.Cloud = factory(root.Store);
})(typeof self !== 'undefined' ? self : this, function (Store) {
  'use strict';

  function headers(cfg) {
    const h = { apikey: cfg.key, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(cfg.key)) h.Authorization = 'Bearer ' + cfg.key; // llaves "anon" JWT clásicas
    return h;
  }

  async function rpc(cfg, fn, body) {
    const url = String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/' + fn;
    const r = await fetch(url, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }

  /** → null (familia nueva) | {rev, data, updated_at, updated_by} */
  function get(cfg) { return rpc(cfg, 'golf_get', { p_code: cfg.code }); }

  /** → {ok:true, rev} | {ok:false, rev, data} (alguien guardó antes: hay que mezclar) */
  function save(cfg, rev, data, by) {
    return rpc(cfg, 'golf_save', { p_code: cfg.code, p_rev: rev, p_data: data, p_by: by || null });
  }

  /** Guarda `local` mezclando con lo que haya en la nube si alguien guardó antes.
   *  → {rev, state} con el estado final que quedó en la nube. */
  async function saveMerged(cfg, base, local, rev, by, tries = 6) {
    let b = base, l = local, r = rev;
    for (let i = 0; i < tries; i++) {
      const res = await save(cfg, r, l, by);
      if (res && res.ok) return { rev: res.rev, state: l };
      const remote = res && res.data ? res.data : null;
      l = remote ? Store.merge3(b, l, remote) : l;
      b = remote; r = res ? res.rev : 0;
    }
    throw new Error('Demasiados conflictos al guardar; intenta de nuevo');
  }

  /** Nombre del canal realtime derivado del código (no revela el código). */
  function channelName(code) {
    let h = 2166136261;
    for (const ch of String(code)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return 'golf-' + h.toString(36);
  }

  function isConfigured(cfg) {
    return !!(cfg && cfg.url && cfg.key && cfg.code && String(cfg.code).length >= 8);
  }

  return { get, save, saveMerged, channelName, isConfigured };
});
