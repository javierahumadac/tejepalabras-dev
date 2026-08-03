// Analítica anónima vía GoatCounter (eventos, sin cookies)

export class Goatcounter {
  static disponible() {
    return Boolean(window.goatcounter?.count);
  }

  static count(path, title, event = true) {
    if (!Goatcounter.disponible()) return;
    window.goatcounter.count({ path, title, event });
  }

  // Palabra que el diccionario rechazó (candidato a incluir)
  static palabraRechazada(palabra) {
    if (palabra.length < 2 || palabra.length > 25) return;
    if (!/^\p{L}+$/u.test(palabra)) return;
    Goatcounter.count(
      `palabra-rechazada/${encodeURIComponent(palabra)}`,
      palabra
    );
  }

  // Reporte manual de una palabra (tipo + comentario opcional)
  static palabraReportada(palabra, tipo, comentario) {
    const titulo = comentario
      ? `${palabra} — ${tipo}: ${comentario}`
      : `${palabra} — ${tipo}`;
    Goatcounter.count(
      `palabra-reportada/${tipo}/${encodeURIComponent(palabra)}`,
      titulo
    );
  }
}
