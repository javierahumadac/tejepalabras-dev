// Lectura/escritura en localStorage

import { Fechas } from "./Fechas.js";

// Claves de localStorage
const CLAVE_DIARIO = "tejepalabras-diario-estado";
const CLAVE_HISTORICO_DIARIO = "tejepalabras-historico-diario";
const CLAVE_RACHA_DIARIA = "tejepalabras-racha-diaria";

const HISTORICO_MAX = 90;

export class Saves {
  static cargarBooleano(clave, porDefecto) {
    try {
      const guardado = localStorage.getItem(clave);
      return guardado === null ? porDefecto : guardado === "1";
    } catch {
      return porDefecto;
    }
  }

  static guardarBooleano(clave, valor) {
    try {
      localStorage.setItem(clave, valor ? "1" : "0");
    } catch {
      // localStorage puede no estar disponible
    }
  }

  // Carga el grafo diario
  static cargarEstadoDiario() {
    try {
      const bruto = localStorage.getItem(CLAVE_DIARIO);
      if (!bruto) return null;
      const datos = JSON.parse(bruto);
      if (datos.fecha !== Fechas.hoy()) return null;
      if (!datos.origen || !datos.destino || !Array.isArray(datos.palabras)) return null;
      return datos;
    } catch {
      return null;
    }
  }

  // Guarda el grafo diario
  static guardarEstadoDiario(origen, destino, palabras) {
    try {
      localStorage.setItem(
        CLAVE_DIARIO,
        JSON.stringify({ fecha: Fechas.hoy(), origen, destino, palabras })
      );
    } catch {
      // localStorage puede no estar disponible
    }
  }

  // Historial ordenado hasta hoy (días sin jugar = puntaje -1)
  static cargarHistoricoDiario(cantidad = 14) {
    try {
      const bruto = localStorage.getItem(CLAVE_HISTORICO_DIARIO);
      if (!bruto) return [];
      const datos = JSON.parse(bruto);
      if (!datos || typeof datos !== "object" || Array.isArray(datos)) return [];

      const mapa = {};
      for (const [fecha, puntaje] of Object.entries(datos)) {
        if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && Number.isFinite(puntaje)) {
          mapa[fecha] = Number(puntaje);
        }
      }

      const fechas = Object.keys(mapa).sort();
      if (!fechas.length) return [];

      const hoy = Fechas.hoy();
      const fin = Fechas.aDate(hoy);
      let inicio = Fechas.aDate(fechas[0]);
      if (cantidad != null) {
        const ventana = Fechas.aDate(hoy);
        ventana.setDate(ventana.getDate() - (cantidad - 1));
        if (inicio < ventana) inicio = ventana;
      }

      const out = [];
      for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
        const f = Fechas.deDate(d);
        const jugado = mapa[f] != null;
        out.push({ fecha: f, puntaje: jugado ? mapa[f] : -1, jugado });
      }
      return out;
    } catch {
      return [];
    }
  }

  // Guarda el puntaje diario al historico
  static guardarPuntajeDiario(fecha, puntaje) {
    try {
      const historico = {};
      for (const e of Saves.cargarHistoricoDiario(null)) {
        if (e.jugado) historico[e.fecha] = e.puntaje;
      }
      historico[fecha] = puntaje;

      const fechas = Object.keys(historico).sort();
      if (fechas.length > HISTORICO_MAX) {
        for (const f of fechas.slice(0, fechas.length - HISTORICO_MAX)) {
          delete historico[f];
        }
      }
      localStorage.setItem(CLAVE_HISTORICO_DIARIO, JSON.stringify(historico));
    } catch {
      // localStorage puede no estar disponible
    }
  }

  static cargarRachaDiaria() {
    try {
      const bruto = localStorage.getItem(CLAVE_RACHA_DIARIA);
      if (!bruto) return null;
      const datos = JSON.parse(bruto);
      if (
        !datos ||
        typeof datos.fecha !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) ||
        !Number.isFinite(datos.racha)
      ) {
        return null;
      }
      return { fecha: datos.fecha, racha: Number(datos.racha) };
    } catch {
      return null;
    }
  }

  static guardarRachaDiaria(fecha, racha) {
    try {
      localStorage.setItem(CLAVE_RACHA_DIARIA, JSON.stringify({ fecha, racha }));
    } catch {
      // localStorage puede no estar disponible
    }
  }

  // Registra la victoria de hoy y actualiza la racha
  static registrarRachaDiaria(hoy = Fechas.hoy()) {
    const guardado = Saves.cargarRachaDiaria();
    if (guardado && guardado.fecha === hoy) return guardado.racha;

    let racha = 1;
    if (guardado) {
      const ayer = Fechas.aDate(hoy);
      ayer.setDate(ayer.getDate() - 1);
      if (guardado.fecha === Fechas.deDate(ayer)) racha = guardado.racha + 1;
    }
    Saves.guardarRachaDiaria(hoy, racha);
    return racha;
  }

  // Racha vigente para mostrar (0 si el último día no es hoy ni ayer)
  static obtenerRachaDiaria(hoy = Fechas.hoy()) {
    const guardado = Saves.cargarRachaDiaria();
    if (!guardado) return 0;

    if (guardado.fecha === hoy) return guardado.racha;
    const ayer = Fechas.aDate(hoy);
    ayer.setDate(ayer.getDate() - 1);
    if (guardado.fecha === Fechas.deDate(ayer)) return guardado.racha;
    return 0;
  }
}
