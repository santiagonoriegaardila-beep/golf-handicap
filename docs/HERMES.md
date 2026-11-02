# Guía para agentes (Hermes)

Esta app está pensada para que un agente pueda **leer, calcular y escribir** rondas sin tocar la interfaz.
Hay tres formas de integrarse; todas usan el mismo motor (`handicap.js` → `store.js` → `bets.js`).

| Vía | Cuándo usarla |
|---|---|
| **CLI** (`node cli.js …`) | El agente tiene el JSON exportado (lo más simple y robusto). |
| **Módulos Node** (`require('./bets.js')`) | El agente escribe su propio script. |
| **`window.GolfApp`** | El agente maneja un navegador con la app abierta. |

No hay servidor ni base de datos: el estado completo es **un solo JSON** guardado en `localStorage` (clave `golf-familia-v2`).
El usuario lo exporta en *Ajustes → Exportar JSON* y lo importa en *Ajustes → Importar*.

---

## 1. CLI

```bash
node cli.js resultados estado.json [gameId|ultima]   # JSON con todo calculado
node cli.js resumen    estado.json [gameId|ultima]   # texto listo para WhatsApp
node cli.js handicap   estado.json                    # index de cada jugador
node cli.js rondas     estado.json                    # lista de rondas
node cli.js validar    estado.json                    # chequea campos/marcas/rondas (exit 1 si hay problemas)
node cli.js score      estado.json <gameId> <playerId> <hoyo 1-18> <golpes> [putts] [bunker si/no] [agua si/no]
```

- Salida en stdout (JSON salvo `resumen`), errores en stderr con código 1.
- `score` **modifica el archivo** y lo guarda; luego el usuario lo importa en la app.
- Ejemplo: `node cli.js resumen examples/estado-ejemplo.json`

## 2. Módulos Node

```js
const Store = require('./store.js');   // migrate, playerIndex, upsertRound, TEE_PRESETS...
const Bets  = require('./bets.js');    // computeGame, summaryText, defaultBets, strokesOnHole...

const state  = Store.migrate(JSON.parse(fs.readFileSync('estado.json', 'utf8')));
const result = Bets.computeGame(state, state.games[0]);
console.log(Bets.summaryText(result));
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
      "currentHole": 0,                // 0–17 (solo UI)
      "settings": { …copia de settings al empezar… },
      "players": [
        { "playerId": "p_santi", "teeId": "azules",
          "index": 8.4,                // snapshot del index al empezar
          "playingHcp": null,          // null = automático; número = forzado
          "category": null }           // null = automático; "bajo" | "alto"
      ],
      "bets": {
        "robin": { "enabled": true, "pointValue": 5000, "segmentValue": 0,
                   "puttsMode": "suma", "groups": [["p1","p2","p3","p4"]] },
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
| “¿Cómo va la ronda?” | `node cli.js resumen estado.json` |
| “Anota: Santi hizo 5 con 2 putts en el 7, salió del bunker” | `node cli.js score estado.json ultima p_santi 7 5 2 si no` |
| “¿Cuánto debe Papá?” | `resultados` → `totals.p_papa` y `transfers` |
| “¿Cuál es el handicap de Mamá?” | `node cli.js handicap estado.json` |
| “Cambia la base del robin a 10.000” | editar `games[i].bets.robin.pointValue` → `validar` |

## 7. Archivos

| Archivo | Rol |
|---|---|
| `handicap.js` | Fórmulas WHS (AGS, diferencial, index, course/playing handicap). |
| `store.js` | Esquema, migración v1→v2, marcas, index del jugador, tarjetas. |
| `bets.js` | Ventajas por hoyo, Robin, War, liquidación, resumen de texto. |
| `app.js` / `index.html` / `styles.css` | Interfaz (solo dibuja; no calcula). |
| `cli.js` | CLI para agentes. |
| `tests/` | `npm test`. Toda regla nueva debe llevar prueba. |
| `docs/REGLAS.md` | Reglas de juego en lenguaje humano. |
| `examples/estado-ejemplo.json` | Estado completo con una ronda de 4 jugadores. |
