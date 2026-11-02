# AGENTS.md

Instrucciones para agentes (Hermes, Claude, etc.) que trabajen en este repositorio o con sus datos.

- **Guía completa de integración y esquema de datos:** [`docs/HERMES.md`](docs/HERMES.md)
- **Puesta en línea y Supabase:** [`docs/SUPABASE.md`](docs/SUPABASE.md)
- **Reglas de juego (fuente de verdad en lenguaje humano):** [`docs/REGLAS.md`](docs/REGLAS.md)

## Reglas del repo

1. Los cálculos viven **solo** en `handicap.js`, `store.js` y `bets.js` (funciones puras, UMD navegador + Node). `app.js` solo pinta.
2. Cualquier cambio de regla: actualizar `bets.js` + `docs/REGLAS.md` + una prueba en `tests/`.
3. Si cambia el esquema del estado: subir `SCHEMA_VERSION` en `store.js`, agregar migración en `Store.migrate`, y actualizar `docs/HERMES.md`.
4. Antes de entregar: `npm test` y `node cli.js validar examples/estado-ejemplo.json`.
5. Escribir en la nube SIEMPRE con control de versión (`Cloud.saveMerged` o el CLI con `nube`), nunca sobrescribir.
6. Sin dependencias ni paso de build: la app debe seguir funcionando abriendo `index.html`.
7. Textos de interfaz en español.
