/* ============================================================
 * Handicap de Golf — Reglas World Handicap System (WHS)
 * Módulo: cálculo de handicap (una o varias tarjetas)
 * ============================================================ */

// Tabla WHS: número de diferenciales a promediar según cantidad de scores
// (oficial USGA/CONGU, aplica a los N más bajos)
const WHS_AVERAGE_TABLE = {
  1: 1, 2: 1, 3: 1, 4: 1, 5: 1,
  6: 2, 7: 2, 8: 2, 9: 3, 10: 3,
  11: 3, 12: 4, 13: 4, 14: 4, 15: 5,
  16: 5, 17: 6, 18: 6, 19: 7, 20: 8
};

const MAX_HANDICAP_INDEX = 54;   // WHS máximo oficial
const DEFAULT_ALLOWANCE = 0.95;  // 95% estándar para competencia (configurable)

/**
 * Net Double Bogey por hoyo = par + 2 + asignación de golpes del jugador.
 * Sin handicap aún (index null), la asignación es 0 → par + 2.
 * Con handicap: los golpes se asignan según el hándicap del hoyo (1 = más difícil).
 * strokeAllowance: número de golpes que el jugador recibe en ESE hoyo.
 */
function netDoubleBogey(par, strokeAllowance) {
  return par + 2 + (strokeAllowance || 0);
}

/**
 * Ajusta la tarjeta golpe por golpe (Adjusted Gross Score).
 * holes: [{par, strokes, holeHandicap}], index: Handicap Index vigente o null.
 */
function adjustedGrossScore(holes, index) {
  return holes.reduce((total, h) => {
    let allowance = 0;
    if (index != null) {
      // Asignación de golpes: index 14.3 → 14 hoyos con 1 golpe + hoyo 15 con 1
      const base = Math.floor(index / 18);
      allowance = base + (index % 18 >= h.holeHandicap ? 1 : 0);
    }
    const cap = netDoubleBogey(h.par, allowance);
    return total + Math.min(h.strokes, cap);
  }, 0);
}

/**
 * Diferencial de score WHS.
 * AGS: Adjusted Gross Score, cr: Course Rating, slope: Slope Rating
 */
function scoreDifferential(ags, cr, slope) {
  return ((ags - cr) * 113) / slope;
}

/**
 * Handicap Index según WHS.
 * differentials: lista de diferenciales (ya ajustados, con PCC si aplica).
 * Con 1 tarjeta → se usa el único diferencial (requisito WHS: al menos 1 score de 18 hoyos).
 * Retorna redondeado a 1 decimal, limitado a máx 54.
 */
function handicapIndex(differentials) {
  if (!differentials || differentials.length === 0) return null;
  const n = differentials.length;
  const avgCount = WHS_AVERAGE_TABLE[Math.min(n, 20)] || 8;
  const lowest = [...differentials].sort((a, b) => a - b).slice(0, avgCount);
  const avg = lowest.reduce((s, d) => s + d, 0) / lowest.length;
  return Math.min(Math.round(avg * 10) / 10, MAX_HANDICAP_INDEX);
}

/**
 * Course Handicap (handicap de juego en un campo específico).
 * index: Handicap Index, slope, cr: Course Rating, par del campo (72 típico).
 */
function courseHandicap(index, slope, cr, par) {
  return Math.round(index * (slope / 113) + (cr - par));
}

/**
 * Playing Handicap (handicap de juego para la competencia).
 * courseHcp: Course Handicap, allowance: % (0.95 = 95%).
 */
function playingHandicap(courseHcp, allowance = DEFAULT_ALLOWANCE) {
  return Math.round(courseHcp * allowance * 10) / 10;
}

/* El almacenamiento (localStorage, migraciones) vive en store.js */

/* Exports para pruebas Node */
if (typeof module !== 'undefined') {
  module.exports = {
    WHS_AVERAGE_TABLE, MAX_HANDICAP_INDEX,
    netDoubleBogey, adjustedGrossScore, scoreDifferential,
    handicapIndex, courseHandicap, playingHandicap
  };
}
