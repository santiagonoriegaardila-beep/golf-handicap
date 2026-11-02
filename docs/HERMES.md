# Guía para agentes (Hermes)

Esta app está pensada para que un agente pueda **leer, calcular y escribir** rondas sin tocar la interfaz.
Hay tres formas de integrarse; todas usan el mismo motor (`handicap.js` → `store.js` → `bets.js`).

| Vía | Cuándo usarla |
|---|---|
| **CLI** (`node cli.js …`) | El agente tiene el JSON exportado (lo más simple y robusto). |
| **Módulos Node** (`require('./bets.js')`) | El agente escribe su propio script. |
| **`window.GolfApp`** | El agente maneja un navegador con la app abierta. |

El estado completo es **un solo JSON**. Vive en **Supabase** (una fila por familia, ver `supabase/schema.sql` y `docs/SUPABASE.md`)
y cada celular guarda una copia en `localStorage` (clave `golf-familia-v2`) para trabajar sin señal.
Los cambios que haga el agente en la nube aparecen en los celulares de la familia en segundos.

### Credenciales para el agente

```bash
export GOLF_SUPABASE_URL="https://xxxx.supabase.co"
export GOLF_SUPABASE_KEY="<anon / publishable key>"
export GOLF_FAMILY_CODE="<código de familia>"
```

Con eso, en cualquier comando del CLI se usa la palabra **`nube`** en lugar de un archivo.
El código no distingue mayúsculas ni espacios. Si se llama la API HTTP directo, enviar `p_code` **sin espacios y en MAYÚSCULAS** (así lo normalizan la app y el CLI).
Un error que contenga `codigo_retirado` significa que el código cambió: pedir el nuevo al usuario.

### API HTTP directa (sin Node)

```bash
# leer → {rev, data, updated_at, updated_by} | null
curl -s "$GOLF_SUPABASE_URL/rest/v1/rpc/golf_get" -H "apikey: $GOLF_SUPABASE_KEY" \
  -H "Content-Type: application/json" -d "{\"p_code\":\"$GOLF_FAMILY_CODE\"}"

# guardar → {ok:true, rev} | {ok:false, rev, data}  (si ok=false: mezclar con data y reintentar con ese rev)
curl -s "$GOLF_SUPABASE_URL/rest/v1/rpc/golf_save" -H "apikey: $GOLF_SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_code\":\"$GOLF_FAMILY_CODE\",\"p_rev\":12,\"p_data\":{…estado completo…},\"p_by\":\"Hermes\"}"
```
(Las llaves `anon` clásicas, que empiezan por `eyJ`, también van en `Authorization: Bearer …`.)

**Siempre** guardar con el `rev` que se leyó. Nunca sobrescribir sin control de versión: borraría lo que la familia anotó entre medio.
Lo más seguro es usar el CLI o `Cloud.saveMerged`, que ya mezclan y reintentan.

---

## 1. CLI

`<estado.json>` puede ser un archivo o la palabra `nube`.

```bash
node cli.js resultados nube [gameId|ultima]          # JSON con todo calculado
node cli.js resumen    estado.json [gameId|ultima]   # texto listo para WhatsApp
node cli.js handicap   estado.json                    # index de cada jugador
node cli.js rondas     estado.json                    # lista de rondas
node cli.js validar    estado.json                    # chequea campos/marcas/rondas (exit 1 si hay problemas)
node cli.js score      nube <gameId|ultima> <playerId> <hoyo 1-18> <golpes> [putts] [bunker si/no] [agua si/no]
node cli.js bajar      copia.json                     # descarga la nube a un archivo
node cli.js subir      estado.json                    # sube un archivo a la nube (mezcla, no borra)
```

- Salida en stdout (JSON salvo `resumen`), errores en stderr con código 1.
- `score` sobre `nube` queda visible en la app al instante; sobre un archivo, lo modifica en disco.
- Ejemplo: `node cli.js resumen examples/estado-ejemplo.json`

## 2. Módulos Node

```js
const Store = require('./store.js');   // migrate, playerIndex, upsertRound, TEE_PRESETS...
const Bets  = require('./bets.js');    // computeGame, summaryText, defaultBets, strokesOnHole...

const Cloud = require('./cloud.js');   // get, save, saveMerged
const cfg = { url: process.env.GOLF_SUPABASE_URL, key: process.env.GOLF_SUPABASE_KEY, code: process.env.GOLF_FAMILY_CODE };

const remote = await Cloud.get(cfg);                 // {rev, data}
const state  = Store.migrate(remote.data);
console.log(Bets.summaryText(Bets.computeGame(state, state.games.at(-1))));

state.players.push({ id: Store.uid('p'), name: 'Tío Pepe', manualIndex: 20, defaultTee: 'blancas' });
await Cloud.saveMerged(cfg, remote.data, state, remote.rev, 'Hermes');   // mezcla si alguien guardó antes
```

Todas las funciones son puras (no tocan disco ni DOM). `Store.migrate` acepta estados viejos (v1) y siempre devuelve v2.

## 3. `window.GolfApp` (navegador)

```js
GolfApp.getState()                         // copia del estado
GolfApp.setState(obj)                      // reemplaza el estado (se migra y guarda)
GolfApp.activeGameId()                     // ronda en juego o null
GolfApp.setScore(gameId, playerId, 7, { strokes: 4, putts: 2, bunker: true })   // hoyo 1–18
GolfApp.results(gameId?)                   // = Bets.computeGame
GolfApp.summary(gameId?)                   // texto WhatsApp
GolfApp.goToTab('apuestas')                // ronda | apuestas | jugadores | campos | ajustes
GolfApp.sync.info()                        // {status:'en-vivo'|'sin-conexion'|…, rev, lastBy, …}
GolfApp.sync.now()                         // forzar sincronización
```

---

## 4. Esquema del estado (v2)

```jsonc
{
  "version": 2,
  "settings": {
    "allowance": 1,            // 1 = 100 % del Course Handicap
    "highHcpThreshold": 18,    // PH > 18 → categoría "alto"
    "strokeMode": "full",      // "full" | "offLow"
    "currency": "$"
  },
  "players": [
    { "id": "p_santi", "name": "Santi", "manualIndex": 8.4, "defaultTee": "azules" }
  ],
  "courses": [
    {
      "id": "c_club", "name": "Mi Club",
      "tees": [
        {
          "id": "azules",              // negras | azules | blancas | amarillas | rojas
          "name": "Azules", "color": "#1f5fbf",
          "cr": 72.6, "slope": 133,
          "pars":     [4,4,3,4,5,4,4,3,5, 4,4,3,4,5,4,4,3,5],   // 18
          "holeHcps": [11,5,15,1,13,9,17,7,3, 18,4,14,6,12,16,2,10,8]  // 18, 1..18 sin repetir
        }
      ]
    }
  ],
  "rounds": [                          // tarjetas de handicap WHS
    { "id": "r…", "playerId": "p_santi", "courseId": "c_club", "teeId": "azules",
      "courseName": "Mi Club", "date": "2026-11-01", "scores": [18 enteros],
      "gross": 84, "ags": 83, "differential": 8.7, "gameId": "g…|null" }
  ],
  "games": [                           // rondas con apuestas
    {
      "id": "g_ejemplo", "date": "2026-11-01", "courseId": "c_club",
      "status": "en juego",            // "en juego" | "terminada"
      "settings": { …copia de settings al empezar… },
      "players": [
        { "playerId": "p_santi", "teeId": "azules",
          "index": 8.4,                // snapshot del index al empezar
          "playingHcp": null,          // null = automático; número = forzado
          "category": null }           // null = automático; "bajo" | "alto"
      ],
      "bets": {
        "robin": { "enabled": true,
                   "segmentValue": 10000,      // base: por ganar el bloque de 6 hoyos (cada jugador)
                   "pointValue": 2000,         // por cada punto de diferencia en el bloque
                   "puttsMode": "suma",        // "suma" | "baja"
                   "pairingMode": "manual",    // "manual" | "auto" (falta = "auto", rondas viejas)
                   "groups": [["p1","p2","p3","p4"]],
                   // manual: por grupo [bloque 1-6, bloque 7-12]; null = por definir.
                   // El bloque 13-18 es la combinación que queda y NO se guarda.
                   "pairings": [ [ [["p1","p3"],["p2","p4"]], null ] ] },
        "war":   { "enabled": true, "participants": [],          // [] = todos
                   "match": { "front": 10000, "back": 10000, "total": 20000 },
                   "medal": { "front": 10000, "back": 10000, "total": 20000 },
                   "putts": { "front": 5000,  "back": 5000,  "total": 10000 } }
      },
      "scores": {
        "p_santi": [                   // 18 posiciones, índice 0 = hoyo 1
          { "strokes": 5, "putts": 2, "bunker": false, "water": false },
          null                         // hoyo sin jugar
        ]
      }
    }
  ],
  "activeGameId": "g_ejemplo|null"
}
```

### Reglas para escribir el estado

1. IDs: cualquier string único (la app usa prefijos `p`, `c`, `g`, `r`). No cambiar IDs existentes.
2. `scores[playerId]` siempre tiene 18 posiciones; `null` = no jugado.
3. Una sola ronda con `status: "en juego"` a la vez, y `activeGameId` apunta a ella.
4. No borrar jugadores, campos ni marcas usados en rondas guardadas.
5. Tras editar a mano, correr `node cli.js validar estado.json`.

## 5. Resultado de `computeGame` (resumen)

```jsonc
{
  "gameId", "date", "status", "course": {id, name}, "settings",
  "players": [{ playerId, name, teeId, teeName, playingHcp, autoPlayingHcp, category, effHcp,
                card: { holes: [{hole, par, holeHcp, received, strokes, putts, net, bunker, water,
                                 achievements: {sandy, birdie, paraguas}}],
                        front: {gross, net, putts, par, played}, back: {…}, total: {…} } }],
  "robin": { config, excluded: [ids], groups: [{ players, money: {id: $},
             segments: [{ holes: [1,6], teams: [[a,b],[c,d]], totals: [{suma,putts,baja,sandy,birdie,paraguas}×2],
                          points: [A,B], diff, played, complete, status, perHole: […], money: {id: $} }] }] },
  "war":   { participants, money: {id: $},
             bets: [{ segment: "front|back|total", type: "match|medal|putts", price,
                      status: "pendiente|en juego|ganada|muere", winner, leader, values: {id: n}, money }] },
  "totals":    { "p_santi": -5000, … },           // suma cero
  "breakdown": { "p_santi": { "robin": 25000, "war": -30000 } },
  "transfers": [{ "from": "p_papa", "to": "p_juan", "amount": 45000 }]
}
```

`robin` o `war` vienen en `null` si esa apuesta está desactivada.

## 6. Tareas típicas para Hermes

| Pedido del usuario | Qué hacer |
|---|---|
| “¿Cómo va la ronda?” | `node cli.js resumen nube` |
| “Anota: Santi hizo 5 con 2 putts en el 7, salió del bunker” | `node cli.js rondas nube` (ids) → `node cli.js score nube ultima p_santi 7 5 2 si no` |
| “¿Cuánto debe Papá?” | `resultados nube` → `totals.<id>` y `transfers` |
| “¿Cuál es el handicap de Mamá?” | `node cli.js handicap nube` |
| “En el hoyo 1 Santi y Pame quedaron juntos” | módulo Node: `game.bets.robin.pairingMode='manual'`, `pairings[0][0] = Bets.pairingFromPartner(grupo, idPame)` (grupo con Santi primero) → `Cloud.saveMerged` |
| “Cambia la base del robin a 10.000” | módulo Node: leer, editar `games[i].bets.robin.segmentValue`, `Cloud.saveMerged` |
| “Haz un respaldo” | `node cli.js bajar respaldo-$(date +%F).json` |

## 7. Archivos

| Archivo | Rol |
|---|---|
| `handicap.js` | Fórmulas WHS (AGS, diferencial, index, course/playing handicap). |
| `store.js` | Esquema, migración v1→v2, marcas, index del jugador, tarjetas. |
| `bets.js` | Ventajas por hoyo, Robin, War, liquidación, resumen de texto. |
| `cloud.js` | Cliente Supabase (`golf_get` / `golf_save`), navegador y Node. |
| `sync.js` | Sincronización en vivo del navegador (realtime, offline, mezcla). |
| `supabase/schema.sql` | Tablas y funciones de la base de datos. |
| `app.js` / `index.html` / `styles.css` | Interfaz (solo dibuja; no calcula). |
| `cli.js` | CLI para agentes. |
| `tests/` | `npm test`. Toda regla nueva debe llevar prueba. `tests/mock_supabase.js` simula Supabase. |
| `docs/REGLAS.md` | Reglas de juego en lenguaje humano. |
| `examples/estado-ejemplo.json` | Estado completo con una ronda de 4 jugadores. |
