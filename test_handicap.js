const H = require('./handicap.js');

let pass = 0, fail = 0;
function t(name, got, want, tol = 0.05) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${got}, want ${want}`);
  ok ? pass++ : fail++;
}

// 1) Handicap con UNA tarjeta (la función clave que pidió Santi)
// Campo: CR 72.1, Slope 131. Golpea 90 brutos, todos los hoyos bajo par+2 → AGS 90
const holes = Array.from({ length: 18 }, () => ({ par: 4, strokes: 5, holeHandicap: 1 }));
const ags = H.adjustedGrossScore(holes, null);
t('AGS 90 (sin blowups)', ags, 90);
const diff = H.scoreDifferential(ags, 72.1, 131);
t('Diferencial (90-72.1)*113/131', diff, 15.4, 0.1);
const idx1 = H.handicapIndex([diff]);
t('Handicap con 1 tarjeta', idx1, 15.4, 0.1);

// 2) AGS con blowup: 17 hoyos de 5 y un hoyo de 12 (par 4 → cap par+2=6)
const holes2 = Array.from({ length: 17 }, () => ({ par: 4, strokes: 5, holeHandicap: 1 }));
holes2.push({ par: 4, strokes: 12, holeHandicap: 1 });
t('AGS con blowup ajustado (85+6=91)', H.adjustedGrossScore(holes2, null), 91);

// 3) Net Double Bogey con asignación: index 14, hoyo HDCP 3 → 1 golpe → cap = 4+2+1 = 7
t('NDB con 1 golpe asignado', H.netDoubleBogey(4, 1), 7);
t('NDB sin golpes (jugador sin index)', H.netDoubleBogey(4, 0), 6);

// 4) Con handicap vigente, blowup de 12 en hoyo que recibe golpe (cap 7)
const holes3 = Array.from({ length: 17 }, () => ({ par: 4, strokes: 5, holeHandicap: 10 }));
holes3.push({ par: 4, strokes: 12, holeHandicap: 3 }); // recibe golpe con index 14
t('AGS con index 14.3, blowup cap 7', H.adjustedGrossScore(holes3, 14.3), 17 * 5 + 7);

// 5) Tabla WHS: 6 scores → promedio de 2 más bajos
const idx6 = H.handicapIndex([10, 12, 11, 15, 13, 9]);
t('Index con 6 tarjetas (promedio 2 más bajos: 9,10)', idx6, 9.5, 0.05);

// 6) Máximo 54
t('Index cap 54', H.handicapIndex([60, 58]), 54);

// 7) Course Handicap: index 15.4, slope 131, CR 72.1, par 72
const ch = H.courseHandicap(15.4, 131, 72.1, 72);
t('Course Handicap', ch, Math.round(15.4 * 131 / 113 + 0.1));

// 8) Playing Handicap 95%
t('Playing Handicap 95%', H.playingHandicap(18, 0.95), 17.1, 0.05);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
