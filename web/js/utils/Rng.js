import { Fechas } from "./Fechas.js";

export class Rng {
  // Hash de texto a entero 32-bit
  static seedDesdeTexto(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }

  // Generador en [0, 1)
  static mulberry32(semilla) {
    let a = semilla;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // RNG del día (misma semilla para todos los jugadores)
  static delDia() {
    return Rng.mulberry32(Rng.seedDesdeTexto(Fechas.hoy()));
  }
}
