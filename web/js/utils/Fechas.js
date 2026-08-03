// Utilidades de fecha

export class Fechas {
  static hoy() {
    return Fechas.deDate(new Date());
  }

  static deDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dia}`;
  }

  static aDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  
  static formato(str, estilo = "dmy") {
    const [y, m, d] = str.split("-");
    return estilo === "dm" ? `${d}/${m}` : `${d}/${m}/${y}`;
  }
}
