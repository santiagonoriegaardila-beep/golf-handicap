# ⛳ Golf en Familia

App web interna para la familia: **handicap WHS**, **ventajas por marca** y las apuestas **Robin** y **War**, con liquidación de quién le paga a quién.

Sin instalación ni servidor: abre `index.html` en el celular o el computador. Los datos quedan guardados en el dispositivo (exportables como JSON).

## Qué hace

- **Campos con 5 marcas** (negras, azules, blancas, amarillas, rojas). Cada marca tiene su CR, Slope, par y orden de ventajas por hoyo.
- **Handicap WHS**: tarjetas → diferencial → index (desde 1 tarjeta). Las rondas jugadas se pueden registrar como tarjetas.
- **Ronda en vivo** hoyo por hoyo: golpes, putts, 🏖 bunker y 💧 agua, con los golpes de ventaja de cada jugador.
- **Robin**: parejas rotativas cada 6 hoyos, 6 puntos por hoyo (suma, putts, baja, sandy, birdie, paraguas) con reglas distintas para handicap bajo y alto.
- **War**: match, medal y putts en primeros 9, segundos 9 y total — un solo ganador; si hay empate, la apuesta muere.
- **Liquidación**: totales por jugador y el mínimo de pagos. Resumen listo para WhatsApp.

Reglas detalladas: [`docs/REGLAS.md`](docs/REGLAS.md).

## Uso

1. **Campos** → edita el campo de ejemplo con los datos reales de cada marca.
2. **Jugadores** → agrega a la familia (index manual o tarjetas).
3. **Ronda** → elige jugadores, marcas, valores de apuestas y ¡a jugar!
4. **Apuestas** → resultados, quién le paga a quién, “📋 Copiar resumen”.

## Agentes (Hermes)

Todo se puede coordinar desde un agente con el CLI o los módulos de Node. Ver [`docs/HERMES.md`](docs/HERMES.md).

```bash
node cli.js resumen examples/estado-ejemplo.json
```

## Desarrollo

```bash
npm test
```

Sin dependencias. `handicap.js`, `store.js` y `bets.js` funcionan igual en navegador y en Node.
