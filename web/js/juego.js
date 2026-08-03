// Componentes
import { Share } from "./components/Share.js";
import { Tablero } from "./components/Tablero.js";
// Servicios
import { Goatcounter } from "./services/Goatcounter.js";
import { SimilitudService } from "./services/SimilitudService.js";
// Utilidades
import { Fechas } from "./utils/Fechas.js";
import { Rng } from "./utils/Rng.js";
import { Saves } from "./utils/Saves.js";
import { Theme } from "./utils/Theme.js";

// Constantes
const CANTIDAD_PISTAS_PANEL = 5;
const PUNTOS_VERDE = 1;
const PUNTOS_GRIS = 2;
const PUNTOS_ROJO = 3;
const UMBRAL_NORMAL = 16.5;
const UMBRAL_DIFICIL = 21.5;

let origen = null;
let destino = null;
let vecinosOrigen = [];
let vecinosDestino = [];

// Estados
let partidaGanada = false;
let ultimoPuntaje = null;
let ultimaCalidadPuntaje = null;
let ganadaEnDificil = false;
let restaurandoPalabras = false;
let modoDificil = false;
let modoDificilPendiente = null;
let raeVisible = true;
let pistasVisibles = true;
let ayudaYaMostrada = false;
let temaClaro = false;

const CLAVE_DIFICULTAD = "tejepalabras-dificultad";

function umbralSimilitudActual() {
  return modoDificil ? UMBRAL_DIFICIL : UMBRAL_NORMAL;
}

const CLAVE_RAE = "tejepalabras-rae";
const CLAVE_PISTAS = "tejepalabras-hint";
const CLAVE_AYUDA_VISTA = "tejepalabras-ayuda-vista";
const CLAVE_TEMA = "tejepalabras-tema";

function actualizarInfoTema() {
  const switchTema = $("#switch-tema");
  if (switchTema) switchTema.checked = temaClaro;
}

const MODO_DIARIO = "diario";
const MODO_PRACTICA = "practica";
const MODO_LIBRE = "libre";
let modoJuego = MODO_DIARIO;

/** Persiste el tablero del diario solo si hay partida diaria activa. */
function guardarEstadoDiario() {
  if (modoJuego !== MODO_DIARIO || !origen || !destino) return;
  Saves.guardarEstadoDiario(
    origen,
    destino,
    [...Tablero.getPalabras()].filter((palabra) => palabra !== origen && palabra !== destino)
  );
}

const $ = (selector) => document.querySelector(selector);

function normalizarTexto(texto) {
  return texto.trim().toLowerCase().normalize("NFC");
}

function actualizarInfoUmbral() {
  const etiquetaDificultad = modoDificil ? "difícil" : "normal";
  $("#umbral-info").textContent = `Modo ${etiquetaDificultad} (Enlace mínimo: ${umbralSimilitudActual()}% de similitud).`;
  const switchDificultad = $("#switch-dificultad");
  if (switchDificultad) switchDificultad.checked = modoDificil;
}

function actualizarInfoRae() {
  const switchRae = $("#switch-rae");
  if (switchRae) switchRae.checked = raeVisible;
  $("#panel-rae")?.classList.toggle("oculto", !raeVisible);
}

function actualizarInfoPistas() {
  const switchPistas = $("#switch-hint");
  if (switchPistas) switchPistas.checked = pistasVisibles;
  actualizarVisibilidadBotonPista();
}

function cancelarCambioModoDificil() {
  modoDificilPendiente = null;
  const switchDificultad = $("#switch-dificultad");
  if (switchDificultad) switchDificultad.checked = modoDificil;
  $("#modal-confirmar-dificultad")?.classList.add("oculto");
}

async function iniciarAplicacion() {
  modoDificil = Saves.cargarBooleano(CLAVE_DIFICULTAD, false);
  actualizarInfoUmbral();
  raeVisible = Saves.cargarBooleano(CLAVE_RAE, true);
  actualizarInfoRae();
  pistasVisibles = Saves.cargarBooleano(CLAVE_PISTAS, true);
  actualizarInfoPistas();
  temaClaro = Saves.cargarBooleano(CLAVE_TEMA, false);
  Theme.aplicar(temaClaro);
  actualizarInfoTema();
  ayudaYaMostrada = Saves.cargarBooleano(CLAVE_AYUDA_VISTA, false);
  Tablero.configurar({
    umbral: umbralSimilitudActual,
    origen: () => origen,
    destino: () => destino,
    alCambiarAristas: (aristas) => actualizarEstadoConexion(aristas),
    alTocarNodo: (id) => void mostrarPanelPalabra(id),
    alTocarFondo: () => $("#panel").classList.add("oculto"),
  });
  Tablero.crear($("#grafo"));
  Share.configurar({
    origen: () => origen,
    destino: () => destino,
    ganado: () => partidaGanada,
    puntaje: () => ultimoPuntaje,
    calidadPuntaje: () => ultimaCalidadPuntaje,
    esDiario: () => modoJuego === MODO_DIARIO,
    esDificil: () => ganadaEnDificil,
    urlJuego: () => {
      const url = construirUrlActualDelJuego();
      return url.href.replace(/\/$/, "") || url.origin;
    },
    alMensaje: mensaje,
  });
  Share.aplicarEstilos();
  registrarEventosInterfaz();
  bloquearCampoEntrada(true);
  mensaje("cargando vectores…");
  try {
    await SimilitudService.cargar();
  } catch (e) {
    console.error(e);
    return mensaje("no se pudieron cargar los vectores", "error");
  }
  bloquearCampoEntrada(false);
  const parUrl = leerParObjetivoDesdeUrl();
  if (parUrl) await nuevoJuego(false, parUrl);
  else await nuevoJuego(true);
}

function bloquearCampoEntrada(bloquear) {
  $("#entrada").disabled = bloquear;
}

function establecerPlaceholderLibre() {
  const entrada = $("#entrada");
  if (!entrada) return;
  if (!origen) entrada.placeholder = "palabra origen…";
  else if (!destino) entrada.placeholder = "palabra destino…";
  else entrada.placeholder = "palabra puente…";
}

async function nuevoJuego(diario = false, parObjetivo = null) {
  if (!SimilitudService.datosCargados) return;
  partidaGanada = false;
  ultimoPuntaje = null;
  ultimaCalidadPuntaje = null;
  ganadaEnDificil = false;
  SimilitudService.limpiarCacheSimilitudes();
  modoJuego = diario ? MODO_DIARIO : MODO_PRACTICA;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearCampoEntrada(false);
  const entrada = $("#entrada");
  if (entrada) entrada.placeholder = "palabra puente…";
  mensaje("preparando partida…");

  let estadoGuardado = null;
  if (parObjetivo) {
    [origen, destino] = parObjetivo;
  } else if (diario && (estadoGuardado = Saves.cargarEstadoDiario())) {
    [origen, destino] = [estadoGuardado.origen, estadoGuardado.destino];
  } else {
    const rng = diario ? Rng.delDia() : Math.random;
    [origen, destino] = await SimilitudService.elegirPalabrasObjetivo(rng);
  }
  actualizarVecinosDeObjetivos();
  $("#origen").textContent = origen;
  $("#destino").textContent = destino;
  Tablero.resetearObjetivos(origen, destino);
  await Tablero.reconstruir();
  Tablero.posicionar();
  if (estadoGuardado?.palabras.length) await restaurarPalabrasGuardadas(estadoGuardado.palabras);
  actualizarMenuModos();
  actualizarUrlDelNavegador();
  mensaje("");
  $("#entrada").focus();
  guardarEstadoDiario();
}

async function nuevoJuegoLibre() {
  if (!SimilitudService.datosCargados) return;
  partidaGanada = false;
  ultimoPuntaje = null;
  ultimaCalidadPuntaje = null;
  ganadaEnDificil = false;
  SimilitudService.limpiarCacheSimilitudes();
  origen = null;
  destino = null;
  vecinosOrigen = [];
  vecinosDestino = [];
  Tablero.vaciar();
  modoJuego = MODO_LIBRE;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearCampoEntrada(false);
  $("#origen").textContent = "–";
  $("#destino").textContent = "–";
  const flecha = $("#estado-flecha");
  flecha.classList.remove("ok");
  flecha.firstElementChild.className = "bi bi-three-dots";
  establecerPlaceholderLibre();
  mensaje("elige la palabra origen");
  actualizarMenuModos();
  actualizarUrlDelNavegador();
  $("#entrada").focus();
}

async function definirPalabraModoLibre(palabra) {
  if (!origen) {
    origen = palabra;
    Tablero.insertar(palabra, { objetivo: true });
    $("#origen").textContent = origen;
    establecerPlaceholderLibre();
    mensaje("elige la palabra destino");
    $("#entrada").focus();
    return;
  }

  destino = palabra;
  Tablero.insertar(palabra, { objetivo: true });
  $("#destino").textContent = destino;
  await SimilitudService.asegurarSimilitud(origen, destino);
  actualizarVecinosDeObjetivos();
  await Tablero.reconstruir();
  Tablero.posicionar();
  actualizarUrlDelNavegador();
  establecerPlaceholderLibre();
  mensaje("");
  $("#entrada").focus();
}

/** Deja solo origen y destino; quita el resto de palabras del tablero */
async function limpiarPalabrasDelTablero() {
  if (!origen || !destino) return;
  partidaGanada = false;
  ultimoPuntaje = null;
  ultimaCalidadPuntaje = null;
  ganadaEnDificil = false;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearCampoEntrada(false);
  Tablero.resetearObjetivos(origen, destino);
  await Tablero.reconstruir();
  Tablero.posicionar();
  mensaje("");
  guardarEstadoDiario();
}

/** Reinserta, en orden, las palabras que la persona ya había agregado hoy */
async function restaurarPalabrasGuardadas(palabras) {
  restaurandoPalabras = true;
  try {
    let esPrimera = true;
    for (const palabra of palabras) {
      if (Tablero.tiene(palabra) || !SimilitudService.existeEnDiccionario(palabra)) continue;
      if (!esPrimera) await new Promise((resolver) => setTimeout(resolver, 200));
      esPrimera = false;
      await colocarPalabraEnTablero(palabra);
    }
  } finally {
    restaurandoPalabras = false;
  }
}

function abrirModalHistoricoDiario() {
  const modal = $("#modal-historico-diario");
  if (!modal) return;
  const historico = Saves.cargarHistoricoDiario();
  const racha = Saves.obtenerRachaDiaria();
  const valorEl = $("#modal-racha-diaria-valor");
  if (valorEl) valorEl.textContent = racha;
  const unidadEl = $("#modal-racha-diaria-unidad");
  if (unidadEl) unidadEl.textContent = racha === 1 ? "día" : "días";

  const bloqueGrafico = $("#modal-historico-diario-grafico");
  if (historico.length < 2) {
    bloqueGrafico?.classList.add("oculto");
  } else {
    bloqueGrafico?.classList.remove("oculto");
    requestAnimationFrame(() => {
      dibujarGraficoHistorico(historico, $("#grafico-historico-menu"));
    });
  }
  modal.classList.remove("oculto");
}

function registrarEventosModalHistoricoDiario() {
  const modal = $("#modal-historico-diario");
  if (!modal) return;
  const cerrar = () => modal.classList.add("oculto");
  $("#modal-historico-diario-cerrar")?.addEventListener("click", cerrar);
  modal.querySelector("[data-cerrar-historico-diario]")?.addEventListener("click", cerrar);
  $("#menu-racha-diaria")?.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalHistoricoDiario();
  });
}

let tipoReporteSeleccionado = null;

function abrirModalReportarPalabra() {
  if (!panelPalabraActual) return;
  tipoReporteSeleccionado = null;
  $("#modal-reportar-subtitulo").textContent = panelPalabraActual;
  $("#modal-reportar-comentario").value = "";
  $("#modal-reportar-opciones")
    .querySelectorAll(".menu-modo-opcion")
    .forEach((btn) => btn.classList.remove("activo"));
  $("#modal-reportar-enviar").disabled = true;
  $("#modal-reportar").classList.remove("oculto");
}

function registrarEventosModalReportar() {
  const modal = $("#modal-reportar");
  if (!modal) return;
  const cerrar = () => modal.classList.add("oculto");
  $("#modal-reportar-cerrar")?.addEventListener("click", cerrar);
  $("#modal-reportar-cancelar")?.addEventListener("click", cerrar);
  modal.querySelector("[data-cerrar-reportar]")?.addEventListener("click", cerrar);

  $("#modal-reportar-opciones")
    .querySelectorAll(".menu-modo-opcion")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        tipoReporteSeleccionado = btn.dataset.tipoReporte;
        $("#modal-reportar-opciones")
          .querySelectorAll(".menu-modo-opcion")
          .forEach((b) => b.classList.toggle("activo", b === btn));
        $("#modal-reportar-enviar").disabled = false;
      });
    });

  $("#modal-reportar-enviar")?.addEventListener("click", () => {
    if (!tipoReporteSeleccionado || !panelPalabraActual) return;
    const comentario = $("#modal-reportar-comentario").value.trim().slice(0, 100);
    Goatcounter.palabraReportada(panelPalabraActual, tipoReporteSeleccionado, comentario);
    cerrar();
    mensaje("¡Gracias por tu reporte!");
  });
}

function actualizarMenuModos() {
  const fechaEl = $("#menu-fecha-diario");
  if (fechaEl) fechaEl.textContent = Fechas.formato(Fechas.hoy());
  document.querySelectorAll(".menu-modo-opcion").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modoJuego);
  });
  const racha = Saves.obtenerRachaDiaria();
  const rachaWrap = $("#menu-racha-diaria");
  const rachaValorEl = $("#menu-racha-diaria-valor");
  if (rachaWrap && rachaValorEl) {
    rachaWrap.classList.toggle("oculto", racha <= 0);
    rachaValorEl.textContent = racha;
  }
  actualizarInfoUmbral();
  actualizarInfoRae();
  actualizarInfoPistas();
  actualizarInfoTema();
}


/** Recalcula vecinosOrigen/vecinosDestino para el par origen/destino vigente */
function actualizarVecinosDeObjetivos() {
  vecinosOrigen = SimilitudService.vecinosParaPistas(origen);
  vecinosDestino = SimilitudService.vecinosParaPistas(destino);
}

function obtenerCaminoMasCorto(aristas) {
  const adyacencia = {};
  [...Tablero.getPalabras()].forEach((palabra) => (adyacencia[palabra] = []));
  aristas.forEach((arista) => {
    adyacencia[arista.a].push(arista.b);
    adyacencia[arista.b].push(arista.a);
  });

  const predecesor = { [origen]: null };
  const cola = [origen];
  for (let i = 0; i < cola.length; i++) {
    const actual = cola[i];
    if (actual === destino) break;
    for (const vecino of adyacencia[actual] || []) {
      if (!(vecino in predecesor)) {
        predecesor[vecino] = actual;
        cola.push(vecino);
      }
    }
  }
  if (!(destino in predecesor)) return [];

  const camino = [];
  for (let nodo = destino; nodo != null; nodo = predecesor[nodo]) camino.push(nodo);
  camino.reverse();
  return camino;
}

function actualizarEstadoConexion(aristas) {
  const componenteDe = Tablero.agruparConectadas(aristas);
  const conectados = componenteDe(origen) === componenteDe(destino);
  const flecha = $("#estado-flecha");
  flecha.classList.toggle("ok", conectados);
  flecha.firstElementChild.className = conectados ? "bi bi-arrow-right" : "bi bi-three-dots";

  if (conectados && !partidaGanada) void ganarPartida(aristas);
  else if (!conectados) {
    Tablero.marcarRuta();
  }
}

/**
 * Puntaje al estilo golf (menos es mejor):
 *  x1 por cada palabra puente en la ruta más corta (verde)
 *  x2 por cada palabra conectada a la red principal pero fuera de esa ruta (gris)
 *  x3 por cada palabra suelta, sin conectar a la red principal (roja)
 */
function calcularPuntaje(aristas, ruta) {
  const componenteDe = Tablero.agruparConectadas(aristas);
  const componentePrincipal = componenteDe(origen);
  const palabrasEnRuta = new Set(ruta);
  let verdes = 0;
  let grises = 0;
  let sueltos = 0;
  Tablero.getPalabras().forEach((palabra) => {
    if (palabra === origen || palabra === destino) return;
    if (palabrasEnRuta.has(palabra)) verdes++;
    else if (componenteDe(palabra) === componentePrincipal) grises++;
    else sueltos++;
  });
  const puntaje = verdes * PUNTOS_VERDE + grises * PUNTOS_GRIS + sueltos * PUNTOS_ROJO;
  return { verdes, grises, sueltos, puntaje };
}

/**
 * Clasifica el puntaje final en bueno/regular/malo:
 *  - malo: lo "desperdiciado" (grises + sueltos) triplica o supera a la ruta más corta
 *  - bueno: la ruta más corta pesa más que las palabras conectadas fuera de ruta
 *  - regular: cualquier otro caso intermedio
 */
function clasificarCalidadPuntaje({ verdes, grises, sueltos }) {
  if (verdes === 0 && grises === 0 && sueltos === 0) return "puntaje-bueno";
  if (grises + sueltos > verdes * 2) return "puntaje-malo";
  if (verdes + 1 >= (grises + sueltos)) return "puntaje-bueno";
  return "puntaje-regular";
}

function mostrarResultadoFinal({ verdes, grises, sueltos, puntaje }, calidad) {
  ultimoPuntaje = puntaje;
  ultimaCalidadPuntaje = calidad;
  const total = $("#puntaje-total");
  total.textContent = puntaje;
  total.classList.remove("puntaje-bueno", "puntaje-regular", "puntaje-malo");
  total.classList.add(calidad);
  $("#puntaje-verdes-cant").textContent = verdes;
  $("#puntaje-verdes-total").textContent = verdes * PUNTOS_VERDE;
  $("#puntaje-grises-cant").textContent = grises;
  $("#puntaje-grises-total").textContent = grises * PUNTOS_GRIS;
  $("#puntaje-sueltos-cant").textContent = sueltos;
  $("#puntaje-sueltos-total").textContent = sueltos * PUNTOS_ROJO;
  if (modoJuego !== MODO_DIARIO) $("#estadistica-diaria")?.classList.add("oculto");
  if (!restaurandoPalabras) $("#modal-final").classList.remove("oculto");
}

function dibujarGraficoHistorico(entradas, canvas = $("#grafico-historico")) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const anchoCss = canvas.clientWidth || 360;
  const altoCss = canvas.clientHeight || 120;
  canvas.width = Math.round(anchoCss * dpr);
  canvas.height = Math.round(altoCss * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, anchoCss, altoCss);

  const colores = Theme.colores();
  const margenIzq = 28;
  const margenDer = 8;
  const margenSup = 14;
  const margenInf = 22;
  const anchoUtil = anchoCss - margenIzq - margenDer;
  const altoUtil = altoCss - margenSup - margenInf;

  const puntajesJugados = entradas.filter((entrada) => entrada.jugado).map((entrada) => entrada.puntaje);
  const puntajeMaximo = Math.max(...puntajesJugados, 1);
  const hoy = Fechas.hoy();
  const cantidad = entradas.length;
  const espacioEntreBarras = Math.max(2, (anchoUtil / cantidad) * 0.2);
  const anchoBarra = Math.max(2, (anchoUtil - espacioEntreBarras * (cantidad - 1)) / cantidad);
  const altoSinJugar = 4;
  const lineaBase = margenSup + altoUtil - altoSinJugar;

  // Mayor puntaje arriba (eje Y estándar); días sin jugar = -1 debajo del 0
  const yDePuntaje = (puntaje) => margenSup + (1 - puntaje / puntajeMaximo) * (altoUtil - altoSinJugar);
  const xDeBarra = (indice) => margenIzq + indice * (anchoBarra + espacioEntreBarras);
  const xCentroBarra = (indice) => xDeBarra(indice) + anchoBarra / 2;

  ctx.strokeStyle = colores.borde;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margenIzq, margenSup);
  ctx.lineTo(margenIzq, lineaBase);
  ctx.lineTo(margenIzq + anchoUtil, lineaBase);
  ctx.stroke();

  ctx.fillStyle = colores.textoDebil;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(String(puntajeMaximo), margenIzq - 4, margenSup + 3);
  ctx.fillText("0", margenIzq - 4, lineaBase + 3);

  entradas.forEach((entrada, indice) => {
    const x = xDeBarra(indice);
    if (!entrada.jugado || entrada.puntaje < 0) {
      ctx.save();
      ctx.strokeStyle = colores.acento;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, lineaBase + 0.5, anchoBarra - 1, altoSinJugar - 1);
      ctx.beginPath();
      ctx.rect(x, lineaBase, anchoBarra, altoSinJugar);
      ctx.clip();
      ctx.beginPath();
      for (let raya = -altoSinJugar; raya < anchoBarra; raya += 6) {
        ctx.moveTo(x + raya, lineaBase + altoSinJugar);
        ctx.lineTo(x + raya + altoSinJugar, lineaBase);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    const y = yDePuntaje(entrada.puntaje);
    const altoBarra = Math.max(1, lineaBase - y);
    ctx.fillStyle = entrada.fecha === hoy ? colores.exito : colores.bordeFuerte;
    ctx.fillRect(x, y, anchoBarra, altoBarra);
  });

  ctx.fillStyle = colores.textoDebil;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(Fechas.formato(entradas[0].fecha, "dm"), xCentroBarra(0), altoCss - 4);
  if (cantidad > 2) {
    const indiceMedio = (cantidad / 2) | 0;
    ctx.fillText(Fechas.formato(entradas[indiceMedio].fecha, "dm"), xCentroBarra(indiceMedio), altoCss - 4);
  }
  ctx.fillText(Fechas.formato(entradas[cantidad - 1].fecha, "dm"), xCentroBarra(cantidad - 1), altoCss - 4);
}

function renderizarEstadisticaDiaria() {
  if (modoJuego !== MODO_DIARIO) {
    $("#estadistica-diaria")?.classList.add("oculto");
    return;
  }
  const historico = Saves.cargarHistoricoDiario();
  const hoy = Fechas.hoy();
  if (!historico.some((e) => e.fecha === hoy && e.jugado)) {
    $("#estadistica-diaria")?.classList.add("oculto");
    return;
  }
  const racha = Saves.obtenerRachaDiaria();
  const rachaEl = $("#racha-diaria-valor");
  if (rachaEl) rachaEl.textContent = racha;
  const unidadEl = $("#racha-diaria-unidad");
  if (unidadEl) unidadEl.textContent = racha === 1 ? "día" : "días";
  const seccion = $("#estadistica-diaria");
  if (seccion) seccion.classList.remove("oculto");

  const bloqueHistorico = $("#historico-diario");
  if (historico.length < 2) {
    bloqueHistorico?.classList.add("oculto");
    return;
  }
  bloqueHistorico?.classList.remove("oculto");
  // Esperar un frame para que el canvas tenga ancho CSS al dejar de estar oculto.
  requestAnimationFrame(() => {
    dibujarGraficoHistorico(historico);
  });
}

async function ganarPartida(aristas) {
  partidaGanada = true;
  ganadaEnDificil = modoDificil;
  const ruta = obtenerCaminoMasCorto(aristas);
  const resultado = calcularPuntaje(aristas, ruta);
  const calidad = clasificarCalidadPuntaje(resultado);
  bloquearCampoEntrada(true);

  if (modoJuego === MODO_DIARIO) {
    Saves.guardarPuntajeDiario(Fechas.hoy(), resultado.puntaje);
    Saves.registrarRachaDiaria();
    if (!restaurandoPalabras) renderizarEstadisticaDiaria();
  }

  // Reinicia el tablero y reaparece cada palabra (200 ms) para celebrar la victoria.
  if (!restaurandoPalabras) {
    const puentes = [...Tablero.getPalabras()].filter(
      (palabra) => palabra !== origen && palabra !== destino
    );
    Tablero.resetearObjetivos(origen, destino);
    await Tablero.reconstruir();
    Tablero.posicionar();
    if (puentes.length) await restaurarPalabrasGuardadas(puentes);
  }

  Tablero.marcarRuta(ruta);
  mensaje(`puntaje: ${resultado.puntaje}`, `${calidad} clicable`);
  await new Promise((resolver) => setTimeout(resolver, 1500));
  mostrarResultadoFinal(resultado, calidad);
}

async function agregarPalabra(textoIngresado) {
  if (partidaGanada) return;
  const palabra = normalizarTexto(textoIngresado || "");
  if (!palabra) return;
  if (Tablero.tiene(palabra)) return mensaje(`“${palabra}” ya está en el tablero`, "error");

  if (!SimilitudService.existeEnDiccionario(palabra)) {
    Goatcounter.palabraRechazada(palabra);
    return mostrarMensajeSugerencias(palabra, SimilitudService.sugerenciasOrtograficas(palabra));
  }

  if (modoJuego === MODO_LIBRE && (!origen || !destino)) {
    await definirPalabraModoLibre(palabra);
    return;
  }

  await colocarPalabraEnTablero(palabra);
}

async function colocarPalabraEnTablero(palabra) {
  $("#panel").classList.add("oculto");
  Tablero.insertar(palabra);
  await Tablero.reconstruir();
  Tablero.posicionar();
  guardarEstadoDiario();

  if (partidaGanada) return;
  if (!restaurandoPalabras) mensaje("");
}

let panelPalabraActual = null;
let panelMuestraPistas = false;

function renderizarListaSimilitudesTablero(palabra) {
  const otras = [...Tablero.getPalabras()]
    .filter((otra) => otra !== palabra)
    .map((otra) => ({
      palabra: otra,
      similitud: SimilitudService.obtenerSimilitud(otra, palabra),
    }))
    .sort((a, b) => b.similitud - a.similitud);
  $("#panel-lista").innerHTML = otras
    .map(
      (item) =>
        `<li class="${item.similitud > umbralSimilitudActual() ? "conecta" : ""}"><span>${item.palabra}</span><span>${item.similitud}%</span></li>`
    )
    .join("");
}

function renderizarListaDelPanel() {
  if (!panelPalabraActual) return;
  if (panelMuestraPistas) {
    const vecinos = panelPalabraActual === origen ? vecinosOrigen : vecinosDestino;
    $("#panel-lista").innerHTML = vecinos
      .slice(0, CANTIDAD_PISTAS_PANEL)
      .map(
        (v) =>
          `<li class="${v.sim > umbralSimilitudActual() ? "conecta" : ""}"><span>${v.palabra}</span><span>${v.sim}%</span></li>`
      )
      .join("");
    return;
  }
  renderizarListaSimilitudesTablero(panelPalabraActual);
}

async function mostrarPanelPalabra(palabra) {
  for (const otra of Tablero.getPalabras()) {
    if (otra !== palabra) await SimilitudService.asegurarSimilitud(palabra, otra);
  }

  panelPalabraActual = palabra;
  panelMuestraPistas = false;

  $("#panel").classList.remove("oculto");
  $("#panel-titulo").textContent = palabra;
  const enlaceRae = $("#panel-rae");
  enlaceRae.href = `https://dle.rae.es/${encodeURIComponent(palabra)}`;
  enlaceRae.title = `Ver “${palabra}” en la RAE`;
  enlaceRae.setAttribute("aria-label", `Ver definición de “${palabra}” en la RAE`);

  actualizarVisibilidadBotonPista();
  renderizarListaDelPanel();
}

/** Muestra/oculta el botón de pista según el switch de ajustes y si la palabra abierta es origen/destino. */
function actualizarVisibilidadBotonPista() {
  const botonPista = $("#panel-hint");
  if (!botonPista) return;
  const esObjetivo = panelPalabraActual === origen || panelPalabraActual === destino;
  const visible = pistasVisibles && esObjetivo;
  botonPista.classList.toggle("oculto", !visible);
  if (!visible && panelMuestraPistas) {
    panelMuestraPistas = false;
    renderizarListaDelPanel();
  }
  botonPista.classList.toggle("activo", visible && panelMuestraPistas);
  botonPista.setAttribute("aria-pressed", String(visible && panelMuestraPistas));
}

function mostrarMensajeSugerencias(palabra, sugerencias) {
  const contenedor = $("#mensaje");
  contenedor.className = "mensaje error";
  contenedor.innerHTML = `“${palabra}” no se encuentra en el diccionario.<br>`;
  if (sugerencias.length) {
    contenedor.innerHTML += " ¿Quisiste decir ";
    sugerencias.forEach((sugerencia, indice) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sugerencia";
      chip.textContent = sugerencia;
      chip.addEventListener("mousedown", (evento) => evento.preventDefault());
      chip.addEventListener("click", async () => {
        await agregarPalabra(sugerencia);
        $("#entrada").focus();
      });
      contenedor.appendChild(chip);
      if (indice < sugerencias.length - 1) {
        contenedor.appendChild(document.createTextNode(", "));
      }
    });
    contenedor.appendChild(document.createTextNode("?"));
  }
}

function mensaje(texto, tipo = "") {
  const contenedor = $("#mensaje");
  contenedor.textContent = texto;
  contenedor.className = "mensaje" + (tipo ? " " + tipo : "");
}

function leerParObjetivoDesdeUrl() {
  const params = new URLSearchParams(location.search);
  const palabraOrigen = normalizarTexto(params.get("origen") || "");
  const palabraDestino = normalizarTexto(params.get("destino") || "");
  if (!palabraOrigen || !palabraDestino || palabraOrigen === palabraDestino) return null;
  if (
    !SimilitudService.existeEnDiccionario(palabraOrigen) ||
    !SimilitudService.existeEnDiccionario(palabraDestino)
  ) {
    return null;
  }
  return [palabraOrigen, palabraDestino];
}

function construirUrlActualDelJuego() {
  const url = new URL(location.href);
  url.hash = "";
  if ((modoJuego === MODO_PRACTICA || modoJuego === MODO_LIBRE) && origen && destino) {
    url.searchParams.set("origen", origen);
    url.searchParams.set("destino", destino);
  } else {
    url.search = "";
  }
  return url;
}

function actualizarUrlDelNavegador() {
  const url = construirUrlActualDelJuego();
  const rutaConQuery = `${url.pathname}${url.search}`;
  history.replaceState(null, "", rutaConQuery || "/");
}

function registrarAjustesViewport() {
  const entrada = $("#entrada");
  const contenedor = $("#grafo");
  const esTactil = matchMedia("(pointer: coarse)").matches;
  let debounceTimer = null;
  let syncRaf = 0;
  let ultimoAncho = 0;
  let ultimoAlto = 0;
  let ultimaAlturaBody = -1;
  let ultimoTopBody = -1;

  // Safari iOS desplaza el visualViewport al abrir el teclado (offsetTop > 0), mientras position: fixed sigue anclado al layout viewport, sin sincronizar top + height, el body queda fuera de lo visible (pantalla negra).
  function syncAltura() {
    const vv = window.visualViewport;
    const h = Math.round(vv ? vv.height : window.innerHeight);
    const top = Math.round(vv ? vv.offsetTop : 0);
    if (h === ultimaAlturaBody && top === ultimoTopBody) return;
    ultimaAlturaBody = h;
    ultimoTopBody = top;
    document.body.style.height = `${h}px`;
    document.body.style.top = `${top}px`;
  }

  function programarSyncAltura() {
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(() => {
      syncRaf = 0;
      syncAltura();
    });
  }

  function ajustarGrafoAlContenedor() {
    if (!Tablero.getCy()) return;
    const w = contenedor.clientWidth;
    const h = contenedor.clientHeight;
    if (w === ultimoAncho && h === ultimoAlto) return;
    ultimoAncho = w;
    ultimoAlto = h;
    Tablero.resize();
  }

  function programarAjusteGrafo() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(ajustarGrafoAlContenedor, 80);
  }

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => programarAjusteGrafo()).observe(contenedor);
  }

  if (window.visualViewport) {
    visualViewport.addEventListener("resize", programarSyncAltura);
    visualViewport.addEventListener("scroll", programarSyncAltura);
  }
  syncAltura();

  if (esTactil) {
    entrada.addEventListener("focus", () => {
      document.body.classList.add("entrada-activa");
      window.scrollTo(0, 0);
      syncAltura();
      // Safari anima el teclado con retraso, re-sincronizar tras el layout.
      setTimeout(syncAltura, 50);
      setTimeout(syncAltura, 300);
    });
    entrada.addEventListener("blur", () => {
      document.body.classList.remove("entrada-activa");
      syncAltura();
      setTimeout(syncAltura, 50);
      setTimeout(syncAltura, 300);
    });
  }
}

function registrarEventosMenuModos() {
  const modal = $("#menu-modos");
  const abrir = () => {
    actualizarMenuModos();
    modal.classList.remove("oculto");
  };
  const cerrar = () => modal.classList.add("oculto");

  $("#btn-nuevo").addEventListener("click", abrir);
  $("#menu-modos-cerrar").addEventListener("click", cerrar);
  modal.querySelector("[data-cerrar-menu-modos]").addEventListener("click", cerrar);

  modal.querySelectorAll(".menu-modo-opcion").forEach((opcion) => {
    opcion.addEventListener("click", async () => {
      const elegido = opcion.dataset.modo;
      cerrar();
      if (elegido === MODO_PRACTICA) {
        await nuevoJuego(false);
      } else if (elegido === MODO_LIBRE) {
        if (modoJuego !== MODO_LIBRE) await nuevoJuegoLibre();
      } else if (elegido !== modoJuego) {
        await nuevoJuego(true);
      }
    });
  });

  const modalConfirmar = $("#modal-confirmar-dificultad");
  const switchDificultad = $("#switch-dificultad");

  const aceptarCambioModoDificil = async () => {
    if (modoDificilPendiente == null) return;
    modoDificil = modoDificilPendiente;
    modoDificilPendiente = null;
    modalConfirmar.classList.add("oculto");
    Saves.guardarBooleano(CLAVE_DIFICULTAD, modoDificil);
    actualizarInfoUmbral();
    if (SimilitudService.datosCargados && origen && destino) await limpiarPalabrasDelTablero();
  };

  switchDificultad.addEventListener("change", (e) => {
    modoDificilPendiente = e.target.checked;
    const desde = modoDificilPendiente ? UMBRAL_NORMAL : UMBRAL_DIFICIL;
    const hacia = modoDificilPendiente ? UMBRAL_DIFICIL : UMBRAL_NORMAL;
    const cambio = modoDificilPendiente ? "aumentará" : "disminuirá";
    $("#modal-confirmar-dificultad-texto").textContent =
      `La similitud que tienen que tener 2 palabras para enlazarse ${cambio} (${desde}% → ${hacia}%) y se limpiará el tablero. ¿Continuar?`;
    modalConfirmar.classList.remove("oculto");
  });

  $("#modal-confirmar-dificultad-aceptar").addEventListener("click", () => {
    void aceptarCambioModoDificil();
  });
  $("#modal-confirmar-dificultad-cancelar").addEventListener("click", cancelarCambioModoDificil);
  modalConfirmar.querySelector("[data-cerrar-confirmar-dificultad]").addEventListener("click", cancelarCambioModoDificil);

  $("#switch-rae").addEventListener("change", (e) => {
    raeVisible = e.target.checked;
    Saves.guardarBooleano(CLAVE_RAE, raeVisible);
    actualizarInfoRae();
  });

  $("#switch-hint").addEventListener("change", (e) => {
    pistasVisibles = e.target.checked;
    Saves.guardarBooleano(CLAVE_PISTAS, pistasVisibles);
    actualizarInfoPistas();
  });

  $("#switch-tema").addEventListener("change", (e) => {
    temaClaro = e.target.checked;
    Saves.guardarBooleano(CLAVE_TEMA, temaClaro);
    Theme.aplicar(temaClaro);
    actualizarInfoTema();
    Tablero.aplicarEstilos();
    Share.aplicarEstilos();
  });
}

function registrarEventosInterfaz() {
  registrarAjustesViewport();

  $("#form-palabra").addEventListener("submit", async (e) => {
    e.preventDefault();
    const entrada = $("#entrada");
    const valor = entrada.value;
    entrada.value = "";
    await agregarPalabra(valor);
  });
  registrarEventosMenuModos();
  registrarEventosModalHistoricoDiario();
  registrarEventosModalReportar();
  $("#btn-compartir").addEventListener("click", () => void Share.compartir());
  $("#mensaje").addEventListener("click", () => {
    if (!partidaGanada) return;
    renderizarEstadisticaDiaria();
    $("#modal-final").classList.remove("oculto");
  });
  $("#panel-cerrar").addEventListener("click", () =>
    $("#panel").classList.add("oculto")
  );
  $("#panel-hint").addEventListener("click", () => {
    panelMuestraPistas = !panelMuestraPistas;
    actualizarVisibilidadBotonPista();
    renderizarListaDelPanel();
  });
  $("#panel-reportar")?.addEventListener("click", () => abrirModalReportarPalabra());

  const ayuda = $("#ayuda");
  const menuModos = $("#menu-modos");
  const modalFinal = $("#modal-final");
  const modalConfirmarDificultad = $("#modal-confirmar-dificultad");
  const ayudaIndice = $("#ayuda-indice");
  const ayudaDetalle = $("#ayuda-detalle");
  const ayudaSubtitulo = $("#ayuda-subtitulo");
  const AYUDA_TITULOS = {
    jugar: "Cómo se juega",
    trucos: "Trucos",
    funciona: "Cómo funciona",
    modos: "Modos de juego",
    apoyar: "Cómo apoyar",
  };

  const mostrarAyudaIndice = () => {
    ayudaIndice.classList.remove("oculto");
    ayudaDetalle.classList.add("oculto");
    ayudaSubtitulo.textContent = "Ayuda";
    ayudaDetalle.querySelectorAll(".ayuda-seccion").forEach((s) => s.classList.add("oculto"));
  };

  const mostrarAyudaSeccion = (id) => {
    if (!AYUDA_TITULOS[id]) return;
    ayudaIndice.classList.add("oculto");
    ayudaDetalle.classList.remove("oculto");
    ayudaSubtitulo.textContent = AYUDA_TITULOS[id];
    ayudaDetalle.querySelectorAll(".ayuda-seccion").forEach((s) => {
      s.classList.toggle("oculto", s.dataset.ayudaSeccion !== id);
    });
  };

  const abrirAyuda = (seccion = null) => {
    if (seccion) mostrarAyudaSeccion(seccion);
    else mostrarAyudaIndice();
    ayuda.classList.remove("oculto");
  };
  const cerrarAyuda = () => {
    ayuda.classList.add("oculto");
    mostrarAyudaIndice();
  };
  const cerrarMenuModos = () => menuModos.classList.add("oculto");
  const cerrarModalFinal = () => modalFinal.classList.add("oculto");
  $("#btn-ayuda").addEventListener("click", () => abrirAyuda());
  $("#ayuda-cerrar").addEventListener("click", cerrarAyuda);
  ayuda.querySelector("[data-cerrar-ayuda]").addEventListener("click", cerrarAyuda);
  $("#ayuda-volver").addEventListener("click", mostrarAyudaIndice);
  ayudaIndice.querySelectorAll("[data-ayuda]").forEach((btn) => {
    btn.addEventListener("click", () => mostrarAyudaSeccion(btn.dataset.ayuda));
  });

  if (!ayudaYaMostrada) {
    ayudaYaMostrada = true;
    Saves.guardarBooleano(CLAVE_AYUDA_VISTA, ayudaYaMostrada);
    abrirAyuda("jugar");
  }

  $("#modal-final-cerrar").addEventListener("click", cerrarModalFinal);
  modalFinal.querySelector("[data-cerrar-final]").addEventListener("click", cerrarModalFinal);
  $("#modal-final-compartir").addEventListener("click", () => void Share.compartir());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modalConfirmarDificultad.classList.contains("oculto")) cancelarCambioModoDificil();
    else if (!menuModos.classList.contains("oculto")) cerrarMenuModos();
    else if (!ayuda.classList.contains("oculto")) {
      if (!ayudaDetalle.classList.contains("oculto")) mostrarAyudaIndice();
      else cerrarAyuda();
    }
    else if (!modalFinal.classList.contains("oculto")) cerrarModalFinal();
  });
}

iniciarAplicacion();
