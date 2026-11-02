# ⛳ Golf en Familia

App web interna para la familia: **handicap WHS**, **ventajas por marca** y las apuestas **Robin** y **War**, con liquidación de quién le paga a quién.

**App:** https://santiagonoriegaardila-beep.github.io/golf-handicap/ — para entrar con los datos de la familia, abre el **link de invitación** (lo comparte cualquiera desde Ajustes).

Los datos se sincronizan en **tiempo real** entre los celulares de la familia con Supabase; cada celular guarda una copia para anotar sin señal.
Configuración paso a paso: [`docs/SUPABASE.md`](docs/SUPABASE.md).

## Qué hace

- **Campos con 5 marcas** (negras, azules, blancas, amarillas, rojas). Cada marca tiene su CR, Slope, par y orden de ventajas por hoyo.
- **Handicap WHS**: tarjetas → diferencial → index (desde 1 tarjeta). Las rondas jugadas se pueden registrar como tarjetas.
- **Ronda en vivo** hoyo por hoyo: golpes, putts, 🏖 bunker y 💧 agua, con los golpes de ventaja de cada jugador.
- **Robin**: parejas rotativas cada 6 hoyos, 6 puntos por hoyo (suma, putts, baja, sandy, birdie, paraguas) con reglas distintas para handicap bajo y alto.
- **War**: match, medal y putts en primeros 9, segundos 9 y total — un solo ganador; si hay empate, la apuesta muere.
- **Liquidación**: totales por jugador y el mínimo de pagos. Resumen listo para WhatsApp.
- **Sincronización**: todos ven la misma ronda en vivo; link de invitación para la familia; historial de versiones.

Reglas detalladas: [`docs/REGLAS.md`](docs/REGLAS.md).

## Uso

0. **Ajustes → Sincronización** → conectar (o abrir el link de invitación).
1. **Campos** → edita el campo de ejemplo con los datos reales de cada marca.
2. **Jugadores** → agrega a la familia (index manual o tarjetas).
3. **Ronda** → elige jugadores, marcas, valores de apuestas y ¡a jugar!
4. **Apuestas** → resultados, quién le paga a quién, “📋 Copiar resumen”.

## Agentes (Hermes)

Todo se puede coordinar desde un agente con el CLI o los módulos de Node. Ver [`docs/HERMES.md`](docs/HERMES.md).

```bash
node cli.js resumen nube      # con GOLF_SUPABASE_URL / _KEY / GOLF_FAMILY_CODE
```

## Desarrollo

```bash
npm test
```

Sin dependencias ni build (supabase-js se carga de CDN solo para avisos en tiempo real). `handicap.js`, `store.js`, `bets.js` y `cloud.js` funcionan igual en navegador y en Node.
