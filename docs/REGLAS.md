# Reglas de juego — Golf en Familia

Este documento describe **exactamente** lo que calcula el motor (`bets.js`).
Si una regla de la familia cambia, se cambia aquí y en `bets.js` (y en `tests/test_bets.js`).

## 1. Marcas y ventajas

- El campo tiene hasta 5 marcas: `negras`, `azules`, `blancas`, `amarillas`, `rojas`.
- **Cada marca** tiene su propio Course Rating (CR), Slope, par por hoyo y **hándicap de hoyo** (orden de ventajas 1–18).
- **Playing Handicap (PH)** de cada jugador, con los datos de *su* marca:

  ```
  Course Handicap = Index × Slope / 113 + (CR − Par de la marca)
  PH = round(Course Handicap × % de handicap)     (por defecto 100 %)
  ```
  El PH se puede escribir a mano en la ronda (sobrescribe el automático).
- **Golpes por hoyo**: el jugador recibe `floor(PH/18)` golpes en todos los hoyos más uno extra en los hoyos cuyo hándicap de hoyo ≤ `PH mod 18`. Un PH negativo (plus) devuelve golpes en los hoyos más fáciles.
- **Modo de ventajas** (Ajustes): `full` = cada uno juega su PH completo; `offLow` = se resta el PH más bajo del grupo (robin: los 4 del grupo; war: todos los participantes).
- **Neto** de un hoyo = golpes − golpes de ventaja en ese hoyo.

## 2. Categoría: handicap bajo / alto

- `alto` si PH > umbral (por defecto 18), si no `bajo`. Se puede forzar por jugador en cada ronda.
- La categoría solo cambia los **logros** (sandy, birdie, paraguas).

## 3. Robin (grupos de 4, parejas rotativas cada 6 hoyos)

Con 8 jugadores se forman 2 grupos (1–4 y 5–8, según el orden de la ronda). Quien no complete grupo de 4 queda fuera del robin (sí juega el war).

**Parejas.** Cada jugador hace pareja una vez con cada uno de los otros tres. Hay dos modos (se elige al crear la ronda):

- **Manual en el campo** (por defecto, la costumbre de la familia):
  | Hoyos | Cómo se decide |
  |---|---|
  | 1–6   | En el hoyo 1, el **1º y el 3º en embocar** juegan juntos. |
  | 7–12  | En el hoyo 7, el **primero de cada pareja en llegar al green** juegan juntos. |
  | 13–18 | La combinación que queda (automática). |

  Se marcan desde la pantalla de la ronda en cualquier momento del bloque (también después del hoyo 1); los puntos se recalculan con esas parejas desde el primer hoyo del bloque. Mientras un bloque no tenga parejas, no suma puntos ni plata. Si se cambian las del bloque 1 y chocan con las del bloque 2, las del bloque 2 se borran para volver a elegirlas.
- **Automático por orden** (jugadores 1, 2, 3, 4):
  | Hoyos | Equipo A | Equipo B |
  |---|---|---|
  | 1–6   | 1 + 2 | 3 + 4 |
  | 7–12  | 1 + 3 | 2 + 4 |
  | 13–18 | 1 + 4 | 2 + 3 |

  En una ronda automática se puede pasar a manual tocando “✎ Parejas”.

**Los 6 puntos por hoyo:**

| Punto | Tipo | Regla |
|---|---|---|
| Suma | duelo, **neto** | Gana el equipo con menor suma de netos. Empate = nadie. |
| Putts | duelo, gross | Menor suma de putts del equipo (o mejor putts, configurable). Empate = nadie. |
| Baja | duelo, **neto** | Gana el equipo con el mejor neto individual. Empate = nadie. |
| Sandy | logro, **gross** | Jugador marcó 🏖 Bunker y: bajo → par o mejor; alto → bogey o mejor. 1 punto por jugador. |
| Birdie | logro, **gross** | Bajo: birdie 1, águila 2 (1 por cada golpe bajo par). Alto: par 1, birdie 2, águila 3. |
| Paraguas | logro, **gross** | Jugador marcó 💧 Agua y: bajo → par o mejor; alto → bogey o mejor. 1 punto. |

Los logros los puede hacer cualquier jugador de cada equipo y se suman (dos sandys = 2 puntos). Un mismo golpe puede dar varios puntos (ej. birdie desde bunker = sandy + birdie).

**Plata del robin (por bloque de 6 hoyos):**
- **Base**: el equipo con más puntos en el bloque gana la base — cada jugador del equipo ganador recibe la base y cada jugador del perdedor la paga. Empate en puntos: nadie gana la base.
- **Valor por punto**: además, cada jugador gana/pierde `(puntos A − puntos B) × valor por punto`.
- La base solo se paga cuando el bloque está completo; los puntos se van sumando hoyo a hoyo.

Ejemplo: base $10.000, punto $2.000, bloque 9–5 → cada ganador +$10.000 + 4 × $2.000 = **+$18.000**, cada perdedor −$18.000.

## 4. War (todos contra todos, un solo ganador)

Se juegan 3 apuestas × 3 tramos = 9 apuestas: **Match**, **Medal** y **Putts** en **primeros 9**, **segundos 9** y **total 18**.

| Apuesta | Cómo se gana |
|---|---|
| Match | Por hoyo, gana el hoyo **solo** el menor neto (empate en el hoyo = hoyo muerto). Gana la apuesta quien gane más hoyos, solo. |
| Medal | Menor suma de netos del tramo, solo. |
| Putts | Menor suma de putts del tramo (gross), solo. |

- **Empate en el primer lugar → la apuesta muere** (nadie cobra).
- El ganador cobra el valor de la apuesta **a cada rival** (`valor × (n − 1)`).
- Mientras el tramo no esté completo, la apuesta está `en juego` y se muestra el líder; no mueve plata.

## 5. Liquidación

Se suman robin + war por jugador (siempre suma cero) y se calcula el **mínimo de pagos** (“quién le paga a quién”).

## 6. Handicap WHS (tarjetas)

- Cada hoyo se limita a **Net Double Bogey** (par + 2 + golpes recibidos según el index previo).
- Diferencial = (AGS − CR) × 113 / Slope de la marca jugada.
- Index = promedio de los mejores diferenciales según la tabla WHS (1 tarjeta ya da index). Máximo 54.
- Una ronda terminada se puede registrar como tarjetas con “📈 Registrar tarjetas en handicap”.
