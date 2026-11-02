/* Supabase simulado para pruebas: implementa golf_get / golf_save igual que
 * supabase/schema.sql (control de versión optimista, código ≥ 8). También
 * sirve los archivos de la app para pruebas en navegador.
 *   node tests/mock_supabase.js 8787   → http://127.0.0.1:8787/index.html */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function start(port) {
  const db = new Map(); // hash → {data, rev, updated_at, updated_by}
  const retired = new Set();
  const hash = (c) => crypto.createHash('sha256').update(String(c)).digest('hex');
  const ROOT = path.join(__dirname, '..');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const send = (code, obj) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(obj === null ? 'null' : JSON.stringify(obj)); };

    if (req.url.startsWith('/rest/v1/rpc/')) {
      if (!req.headers.apikey) return send(401, { message: 'No API key' });
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const fn = req.url.split('/').pop();
        const p = JSON.parse(body || '{}');
        const h = hash(p.p_code);
        const cur = db.get(h);
        if (fn === 'golf_get') return send(200, cur ? { rev: cur.rev, data: cur.data, updated_at: cur.updated_at, updated_by: cur.updated_by } : null);
        if (fn === 'golf_save') {
          if (!p.p_code || p.p_code.length < 8) return send(400, { message: 'El código de familia debe tener al menos 8 caracteres' });
          if (!cur) {
            if (retired.has(h)) return send(400, { message: 'codigo_retirado: este código de familia ya no se usa; pide el código nuevo' });
            if (p.p_rev !== 0) return send(200, { ok: false, rev: 0, data: null });
            db.set(h, { data: p.p_data, rev: 1, updated_at: new Date().toISOString(), updated_by: p.p_by });
            return send(200, { ok: true, rev: 1 });
          }
          if (cur.rev !== p.p_rev) return send(200, { ok: false, rev: cur.rev, data: cur.data });
          db.set(h, { data: p.p_data, rev: cur.rev + 1, updated_at: new Date().toISOString(), updated_by: p.p_by });
          return send(200, { ok: true, rev: cur.rev + 1 });
        }
        send(404, { message: 'función desconocida' });
      });
      return;
    }
    // archivos estáticos
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => {
    const changeCode = (o, n) => { const ho = hash(o), hn = hash(n); db.set(hn, db.get(ho)); db.delete(ho); retired.add(ho); };
    resolve({ port: server.address().port, close: () => server.close(), db, changeCode });
  }));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2]) || 8787).then(s => console.log(`mock en http://127.0.0.1:${s.port}`));
