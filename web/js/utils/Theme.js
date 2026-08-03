// Colores CSS del tema y aplicación de tema claro/oscuro

export class Theme {
  // Lee el token de color
  static colorCss(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  }

  // Paleta actual según variables CSS del tema activo
  static colores() {
    return {
      fondo: Theme.colorCss("--fondo"),
      superficie: Theme.colorCss("--superficie"),
      borde: Theme.colorCss("--borde"),
      bordeFuerte: Theme.colorCss("--borde-fuerte"),
      texto: Theme.colorCss("--texto"),
      textoSecundario: Theme.colorCss("--texto-secundario"),
      textoDebil: Theme.colorCss("--texto-debil"),
      exito: Theme.colorCss("--exito"),
      acento: Theme.colorCss("--acento"),
      acentoOscuro: Theme.colorCss("--acento-oscuro"),
    };
  }

  // Tema claro/oscuro (data-tema, alineado con CSS e index.html)
  static aplicar(temaClaro) {
    if (temaClaro) document.documentElement.dataset.tema = "claro";
    else delete document.documentElement.dataset.tema;
  }
}
