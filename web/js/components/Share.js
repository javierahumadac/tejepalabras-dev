// Compartir partida (imagen + texto)

import { Tablero } from "./Tablero.js";
import { Fechas } from "../utils/Fechas.js";
import { Saves } from "../utils/Saves.js";
import { Theme } from "../utils/Theme.js";

const ASPECTO_CAPTURA = 4 / 3;
const PADDING_CAPTURA = 64;
const TITULO = "Tejepalabras";
const ARCHIVO_CAPTURA = "tejepalabras.png";
const IMAGEN_OVERLAY = {
  desafio: "assets/images/surprised.png",
  "puntaje-bueno": "assets/images/win.png",
  "puntaje-regular": "assets/images/surprised.png",
  "puntaje-malo": "assets/images/lose.png",
};

/** Getters que inyecta juego.js con el estado de la partida. */
const partida = {
  origen: () => null,
  destino: () => null,
  ganado: () => false,
  puntaje: () => 0,
  calidadPuntaje: () => null,
  esDiario: () => false,
  urlJuego: () => location.href,
  alMensaje: () => {},
};

function imagenOverlay() {
  if (!partida.ganado()) return IMAGEN_OVERLAY.desafio;
  return IMAGEN_OVERLAY[partida.calidadPuntaje()] || IMAGEN_OVERLAY["puntaje-regular"];
}

// --- Mensajes ---------------------------------------------------------------

const AVISO = {
  copiado: { texto: "copiado al portapapeles", tipo: "ok" },
  error: { texto: "no se pudo compartir", tipo: "error" },
};

function etiquetaFecha() {
  return partida.esDiario() ? ` (${Fechas.formato(Fechas.hoy())})` : "";
}

function textoCompartir() {
  const origen = partida.origen();
  const destino = partida.destino();
  const fecha = etiquetaFecha();

  if (!partida.ganado()) {
    return `Te desafío a unir '${origen}' con '${destino}'${fecha} en ${TITULO}.`;
  }

  const puntos = partida.puntaje() ?? 0;
  const plural = puntos === 1 ? "" : "s";
  return `Conecté '${origen}' con '${destino}'${fecha} en ${TITULO} con ${puntos} punto${plural}. Crees que podrías hacerlo mejor?`;
}

function avisar(clave) {
  const { texto, tipo } = AVISO[clave];
  partida.alMensaje(texto, tipo);
}

// --- Capacidades del navegador ---------------------------------------------

function esDispositivoTactil() {
  return matchMedia("(pointer: coarse)").matches;
}

function puedeUsarWebShare() {
  return window.isSecureContext && typeof navigator.share === "function";
}

function puedeCopiarImagen() {
  return (
    window.isSecureContext &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

// --- Utilidades de imagen ---------------------------------------------------

function colorFondo() {
  return Theme.colorCss("--fondo") || "#111111";
}

function colorBarraCaptura() {
  // Mismo tono que los nodos objetivo de la captura (p. ej. "sufrido").
  return Theme.colorCss("--texto") || "#bbbbbb";
}

function colorAcento() {
  return Theme.colorCss("--acento") || "#e2586b";
}

/** Icono bi-fire (\uF7F6) si la fuente está lista; si no, emoji. */
async function glifoFuego(tamano) {
  try {
    await document.fonts.load(`${tamano}px bootstrap-icons`);
    if (document.fonts.check(`${tamano}px bootstrap-icons`)) {
      return { texto: "\uF7F6", fuente: `${tamano}px bootstrap-icons` };
    }
  } catch {
    /* fallback */
  }
  return { texto: "🔥", fuente: `${tamano}px system-ui, sans-serif` };
}

function urlCortaDelSitio() {
  return `${location.host}${location.pathname}`.replace(/\/$/, "") || location.host;
}

function canvasAImagen(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (imagen) => (imagen ? resolve(imagen) : reject(new Error("toBlob falló"))),
      "image/png"
    );
  });
}

async function cargarBitmap(origenImagen) {
  if (typeof origenImagen === "string") {
    const respuesta = await fetch(origenImagen);
    if (!respuesta.ok) throw new Error(`no se pudo cargar ${origenImagen}`);
    origenImagen = await respuesta.blob();
  }
  return createImageBitmap(origenImagen);
}

/** Crea un canvas, dibuja con el callback y lo convierte a PNG. */
async function editarImagen(imagen, dibujar) {
  const bitmap = await cargarBitmap(imagen);
  try {
    const canvas = document.createElement("canvas");
    const contexto = canvas.getContext("2d");
    dibujar(canvas, contexto, bitmap);
    return await canvasAImagen(canvas);
  } finally {
    bitmap.close();
  }
}

function truncarTexto(contexto, texto, anchoMaximo) {
  if (contexto.measureText(texto).width <= anchoMaximo) return texto;
  const puntosSuspensivos = "…";
  let recortado = texto;
  while (recortado.length > 1 && contexto.measureText(recortado + puntosSuspensivos).width > anchoMaximo) {
    recortado = recortado.slice(0, -1);
  }
  return recortado + puntosSuspensivos;
}

async function esperarRepintado() {
  await new Promise((resolver) => {
    requestAnimationFrame(() => requestAnimationFrame(resolver));
  });
}

// --- Postproceso de la captura ---------------------------------------------

async function ajustarAspecto(imagen) {
  return editarImagen(imagen, (canvas, contexto, bitmap) => {
    const ancho = bitmap.width;
    const alto = bitmap.height;
    const ratio = ancho / alto;

    let anchoCanvas = ancho;
    let altoCanvas = alto;
    if (Math.abs(ratio - ASPECTO_CAPTURA) >= 0.001) {
      if (ratio > ASPECTO_CAPTURA) altoCanvas = Math.ceil(ancho / ASPECTO_CAPTURA);
      else anchoCanvas = Math.ceil(alto * ASPECTO_CAPTURA);
    }

    canvas.width = anchoCanvas;
    canvas.height = altoCanvas;
    contexto.fillStyle = colorFondo();
    contexto.fillRect(0, 0, anchoCanvas, altoCanvas);
    contexto.drawImage(
      bitmap,
      Math.floor((anchoCanvas - ancho) / 2),
      Math.floor((altoCanvas - alto) / 2)
    );
  });
}

async function anadirTextosCaptura(imagen, rutaOverlay = null) {
  const [grafo, overlay] = await Promise.all([
    cargarBitmap(imagen),
    rutaOverlay ? cargarBitmap(rutaOverlay) : null,
  ]);

  try {
    // 4:3 intacto: grafo encajado → overlay → franja.
    const ancho = grafo.width;
    const alto = grafo.height;
    const altoBarra = Math.max(28, Math.round(Math.min(ancho, alto) * 0.065));
    const altoContenido = alto - altoBarra;
    const padding = Math.max(4, Math.round(altoBarra * 0.16));
    const tamanoFuente = Math.max(11, Math.round(altoBarra * 0.38));

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const contexto = canvas.getContext("2d");

    contexto.fillStyle = colorFondo();
    contexto.fillRect(0, 0, ancho, alto);

    const escala = Math.min(ancho / grafo.width, altoContenido / grafo.height);
    const anchoDibujo = Math.round(grafo.width * escala);
    const altoDibujo = Math.round(grafo.height * escala);
    contexto.drawImage(
      grafo,
      Math.floor((ancho - anchoDibujo) / 2),
      Math.floor((altoContenido - altoDibujo) / 2),
      anchoDibujo,
      altoDibujo
    );

    if (overlay) {
      contexto.drawImage(overlay, 0, 0, ancho, altoContenido);
    }

    // Racha del diario: arriba a la derecha, solo si ya se ganó.
    const racha = partida.esDiario() && partida.ganado() ? Saves.obtenerRachaDiaria() : 0;
    if (racha > 0) {
      const tamanoRacha = Math.max(16, Math.round(Math.min(ancho, alto) * 0.045));
      const padRacha = Math.max(10, Math.round(tamanoRacha * 0.55));
      const gapRacha = Math.max(3, Math.round(tamanoRacha * 0.2));
      const fuenteRacha = `700 ${tamanoRacha}px system-ui, sans-serif`;
      const fuego = await glifoFuego(tamanoRacha);

      contexto.textBaseline = "top";
      contexto.textAlign = "left";
      contexto.fillStyle = colorAcento();
      contexto.font = fuego.fuente;
      const anchoIcono = contexto.measureText(fuego.texto).width;
      contexto.font = fuenteRacha;
      const anchoNumero = contexto.measureText(String(racha)).width;
      const xRacha = ancho - padRacha - anchoIcono - gapRacha - anchoNumero;

      contexto.font = fuego.fuente;
      contexto.fillText(fuego.texto, xRacha, padRacha);
      contexto.font = fuenteRacha;
      contexto.fillText(String(racha), xRacha + anchoIcono + gapRacha, padRacha);
    }

    contexto.fillStyle = colorBarraCaptura();
    contexto.fillRect(0, altoContenido, ancho, altoBarra);

    const fuenteTexto = `700 ${tamanoFuente}px system-ui, sans-serif`;
    contexto.font = fuenteTexto;
    contexto.textBaseline = "middle";
    const yTexto = altoContenido + altoBarra / 2;

    const fecha = partida.esDiario() ? Fechas.formato(Fechas.hoy()) : "";
    const anchoFecha = fecha ? contexto.measureText(fecha).width + padding : 0;
    const url = truncarTexto(
      contexto,
      urlCortaDelSitio(),
      Math.max(0, ancho - padding * 2 - anchoFecha)
    );

    contexto.textAlign = "left";
    contexto.fillStyle = colorFondo();
    contexto.fillText(url, padding, yTexto);

    if (fecha) {
      contexto.textAlign = "right";
      contexto.fillText(fecha, ancho - padding, yTexto);
    }

    return await canvasAImagen(canvas);
  } finally {
    grafo.close();
    overlay?.close();
  }
}

// --- Preparación del grafo para capturar -----------------------------------

function guardarPosiciones(cytoscape) {
  const posiciones = new Map();
  cytoscape.nodes().forEach((nodo) => posiciones.set(nodo.id(), { ...nodo.position() }));
  return posiciones;
}

function restaurarPosiciones(cytoscape, posiciones) {
  for (const [id, posicion] of posiciones) {
    const nodo = cytoscape.getElementById(id);
    if (nodo.nonempty()) nodo.position(posicion);
  }
}

function anclarOrigenDestino(cytoscape, origen, destino) {
  const nodoOrigen = cytoscape.getElementById(origen);
  const nodoDestino = cytoscape.getElementById(destino);
  if (nodoOrigen.empty() || nodoDestino.empty()) return;

  const desdeO = { ...nodoOrigen.position() };
  const desdeD = { ...nodoDestino.position() };
  // Diagonal más abierta que el tablero: origen bien arriba-izq, destino bien abajo-der.
  const haciaO = { x: -340, y: -240 };
  const haciaD = { x: 340, y: 240 };

  const vx = desdeD.x - desdeO.x;
  const vy = desdeD.y - desdeO.y;
  const len = Math.hypot(vx, vy) || 1;
  const nx = haciaD.x - haciaO.x;
  const ny = haciaD.y - haciaO.y;
  const escala = Math.hypot(nx, ny) / len;
  const rot = Math.atan2(ny, nx) - Math.atan2(vy, vx);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  cytoscape.nodes().forEach((nodo) => {
    const p = nodo.position();
    const dx = p.x - desdeO.x;
    const dy = p.y - desdeO.y;
    nodo.position({
      x: haciaO.x + (dx * cos - dy * sin) * escala,
      y: haciaO.y + (dx * sin + dy * cos) * escala,
    });
  });
}

function prepararCapturaGanada(cytoscape) {
  const origen = partida.origen();
  const destino = partida.destino();
  const posiciones = guardarPosiciones(cytoscape);

  anclarOrigenDestino(cytoscape, origen, destino);
  cytoscape.nodes().addClass("captura");
  // Más padding para que origen/destino no queden pegados al borde ni al overlay.
  cytoscape.fit(cytoscape.nodes(), PADDING_CAPTURA * 1.4);
  return { interrogante: null, posiciones };
}

function prepararCapturaDesafio(cytoscape, origen, destino) {
  const nodoOrigen = cytoscape.getElementById(origen);
  const nodoDestino = cytoscape.getElementById(destino);
  const posiciones = guardarPosiciones(cytoscape);

  cytoscape.nodes().difference(nodoOrigen.union(nodoDestino)).addClass("captura-oculto");
  cytoscape.edges().addClass("captura-oculto");
  nodoOrigen.addClass("captura");
  nodoDestino.addClass("captura");
  // Diagonal fija: origen arriba-izquierda → destino abajo-derecha.
  nodoOrigen.position({ x: -200, y: -150 });
  nodoDestino.position({ x: 200, y: 150 });

  const interrogante = cytoscape.add([
    {
      data: { id: "captura-interrogante" },
      position: { x: 0, y: 0 },
      classes: "captura-interrogante",
    },
    {
      data: { id: "captura-interrogante-origen", source: origen, target: "captura-interrogante" },
      classes: "captura-interrogante",
    },
    {
      data: { id: "captura-interrogante-destino", source: "captura-interrogante", target: destino },
      classes: "captura-interrogante",
    },
  ]);

  cytoscape.fit(nodoOrigen.union(nodoDestino).union(interrogante), PADDING_CAPTURA);
  return { interrogante, posiciones };
}

function limpiarCaptura(cytoscape, interrogante, posiciones) {
  interrogante?.remove();
  cytoscape.nodes().removeClass("captura captura-oculto");
  cytoscape.edges().removeClass("captura-oculto");
  if (posiciones) restaurarPosiciones(cytoscape, posiciones);
  Tablero.bloquearNodos(false);
  Tablero.posicionar();
}

async function capturarGrafo() {
  const cytoscape = Tablero.getCy();
  const origen = partida.origen();
  const destino = partida.destino();
  const ganado = partida.ganado();

  document.querySelector("#panel")?.classList.add("oculto");
  // Apaga cola infinita; después de colocar nodos, se bloquean para el pantallazo.
  Tablero.detener();
  await esperarRepintado();

  const { interrogante, posiciones } = ganado
    ? prepararCapturaGanada(cytoscape)
    : prepararCapturaDesafio(cytoscape, origen, destino);

  Tablero.bloquearNodos(true);
  await esperarRepintado();
  try {
    const capturaCruda = await cytoscape.png({
      output: "blob-promise",
      bg: colorFondo(),
      full: true,
      scale: 2,
    });
    const captura43 = await ajustarAspecto(capturaCruda);
    return await anadirTextosCaptura(captura43, imagenOverlay());
  } finally {
    limpiarCaptura(cytoscape, interrogante, posiciones);
  }
}

function estilosCaptura() {
  const colores = Theme.colores();
  return [
    {
      selector: "node.captura",
      style: {
        label: "",
        "text-opacity": 0,
        width: 20,
        height: 20,
        padding: 0,
        "border-width": 0,
        "corner-radius": 4,
        "background-color": colores.bordeFuerte,
      },
    },
    {
      selector: "node.captura.objetivo",
      style: {
        label: "data(id)",
        "text-opacity": 1,
        color: colores.fondo,
        "font-size": 18,
        "font-weight": 700,
        width: "label",
        height: 36,
        padding: 8,
        "border-width": 0,
        "corner-radius": 6,
        "background-color": colores.texto,
      },
    },
    {
      selector: "node.captura.conectado",
      style: { "background-color": colores.exito },
    },
    {
      selector: "node.captura.aislado",
      style: { "background-color": colores.acentoOscuro },
    },
    {
      selector: "node.captura-oculto",
      style: { display: "none" },
    },
    {
      selector: "edge.captura-oculto",
      style: { display: "none" },
    },
    {
      selector: "edge.captura-interrogante",
      style: {
        "line-style": "dashed",
        "line-color": colores.texto,
        width: 2,
        label: "",
        "target-arrow-shape": "none",
        "source-arrow-shape": "none",
        "curve-style": "straight",
      },
    },
    {
      selector: "node.captura-interrogante",
      style: {
        label: "?",
        "font-size": 22,
        "font-weight": 700,
        width: 32,
        height: 32,
        padding: 0,
      },
    },
  ];
}

// --- Acciones de compartir --------------------------------------------------

async function copiarAlPortapapeles(texto, imagen = null) {
  if (imagen && puedeCopiarImagen()) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": Promise.resolve(imagen) }),
      ]);
      avisar("copiado");
      return;
    } catch {
      /* si falla la imagen, caemos a texto */
    }
  }

  await navigator.clipboard.writeText(texto);
  avisar("copiado");
}

async function compartirConImagen(texto) {
  const url = partida.urlJuego();
  const imagen = await capturarGrafo();
  const archivo = new File([imagen], ARCHIVO_CAPTURA, { type: "image/png" });
  const payloadConArchivo = { files: [archivo], title: TITULO, text: texto, url };

  if (navigator.canShare?.(payloadConArchivo)) {
    await navigator.share(payloadConArchivo);
  } else {
    await navigator.share({ title: TITULO, text: texto, url });
  }
}

function botonesCompartir() {
  return [
    document.querySelector("#btn-compartir"),
    document.querySelector("#modal-final-compartir"),
  ].filter(Boolean);
}

function setBotonesDeshabilitados(botones, deshabilitado) {
  for (const boton of botones) boton.disabled = deshabilitado;
}

export class Share {
  static configurar(deps = {}) {
    Object.assign(partida, deps);
  }

  /** Añade estilos de captura encima de los del tablero (tras crear o cambiar tema). */
  static aplicarEstilos() {
    const cytoscape = Tablero.getCy();
    if (!cytoscape) return;
    const estilo = cytoscape.style();
    for (const regla of estilosCaptura()) {
      estilo.selector(regla.selector).style(regla.style);
    }
    estilo.update();
  }

  static async compartir() {
    const botones = botonesCompartir();
    setBotonesDeshabilitados(botones, true);
    try {
      const texto = textoCompartir();
      const textoConUrl = `${texto}\n${partida.urlJuego()}`;

      if (esDispositivoTactil() && puedeUsarWebShare()) {
        await compartirConImagen(texto);
      } else {
        await copiarAlPortapapeles(textoConUrl, await capturarGrafo());
      }
    } catch (error) {
      if (error.name !== "AbortError") avisar("error");
    } finally {
      setBotonesDeshabilitados(botones, false);
    }
  }
}
