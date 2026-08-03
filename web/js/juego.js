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

// Retocado para word2vec SBWC + PCA 256d con "All-but-the-Top" (quita las
// direcciones dominantes comunes a casi toda palabra antes de reducir
// dimensiones; ver scripts/probar_all_but_top.py): pares aleatorios
// ~p95≈14%, ~p99≈22%; sinónimos casi siempre 30–80%.
const UMBRAL_NORMAL = 16.5;
const UMBRAL_DIFICIL = 21.5;

let origen = null;
let destino = null;
let vecinosOrigen = [];
let vecinosDestino = [];

// Estados
let ganado = false;
let ultimoPuntaje = null;
let ultimaCalidad = null; // "puntaje-bueno" | "puntaje-regular" | "puntaje-malo"
let restaurando = false;
let dificil = false;
let pendienteDificil = null;
let raeVisible = true;
let hintVisible = true;
let ayudaVista = false;
let temaClaro = false;

const CLAVE_DIFICULTAD = "tejepalabras-dificultad";

function umbralActual() {
  return dificil ? UMBRAL_DIFICIL : UMBRAL_NORMAL;
}

function textoConfirmarDificultad(haciaDificil) {
  const desde = haciaDificil ? UMBRAL_NORMAL : UMBRAL_DIFICIL;
  const hacia = haciaDificil ? UMBRAL_DIFICIL : UMBRAL_NORMAL;
  const cambio = haciaDificil ? "aumentará" : "disminuirá";
  return `La similitud que tienen que tener 2 palabras para enlazarse ${cambio} (${desde}% → ${hacia}%) y se limpiará el tablero. ¿Continuar?`;
}

const CLAVE_RAE = "tejepalabras-rae";
const CLAVE_HINT = "tejepalabras-hint";
const CLAVE_AYUDA_VISTA = "tejepalabras-ayuda-vista";
const CLAVE_TEMA = "tejepalabras-tema";

function actualizarTemaInfo() {
  const switchTema = $("#switch-tema");
  if (switchTema) switchTema.checked = temaClaro;
}

const MODO_DIARIO = "diario";
const MODO_PRACTICA = "practica";
const MODO_LIBRE = "libre";
let modo = MODO_DIARIO;

/** Persiste el tablero del diario solo si hay partida diaria activa. */
function guardarEstadoDiario() {
  if (modo !== MODO_DIARIO || !origen || !destino) return;
  Saves.guardarEstadoDiario(
    origen,
    destino,
    [...Tablero.getPalabras()].filter((p) => p !== origen && p !== destino)
  );
}

const $ = (sel) => document.querySelector(sel);

function norm(s) {
  return s.trim().toLowerCase().normalize("NFC");
}

function actualizarUmbralInfo() {
  const modo = dificil ? "difícil" : "normal";
  $("#umbral-info").textContent = `Modo ${modo} (Enlace mínimo: ${umbralActual()}% de similitud).`;
  const switchDificultad = $("#switch-dificultad");
  if (switchDificultad) switchDificultad.checked = dificil;
}

function actualizarRaeInfo() {
  const switchRae = $("#switch-rae");
  if (switchRae) switchRae.checked = raeVisible;
  $("#panel-rae")?.classList.toggle("oculto", !raeVisible);
}

function actualizarHintInfo() {
  const switchHint = $("#switch-hint");
  if (switchHint) switchHint.checked = hintVisible;
  actualizarVisibilidadHint();
}

function cancelarCambioDificultad() {
  pendienteDificil = null;
  const switchDificultad = $("#switch-dificultad");
  if (switchDificultad) switchDificultad.checked = dificil;
  $("#modal-confirmar-dificultad")?.classList.add("oculto");
}

async function iniciar() {
  dificil = Saves.cargarBooleano(CLAVE_DIFICULTAD, false);
  actualizarUmbralInfo();
  raeVisible = Saves.cargarBooleano(CLAVE_RAE, true);
  actualizarRaeInfo();
  hintVisible = Saves.cargarBooleano(CLAVE_HINT, true);
  actualizarHintInfo();
  temaClaro = Saves.cargarBooleano(CLAVE_TEMA, false);
  Theme.aplicar(temaClaro);
  actualizarTemaInfo();
  ayudaVista = Saves.cargarBooleano(CLAVE_AYUDA_VISTA, false);
  Tablero.configurar({
    umbral: umbralActual,
    origen: () => origen,
    destino: () => destino,
    alCambiarAristas: (aristas) => actualizarEstado(aristas),
    alTocarNodo: (id) => void mostrarPanel(id),
    alTocarFondo: () => $("#panel").classList.add("oculto"),
  });
  Tablero.crear($("#grafo"));
  Share.configurar({
    origen: () => origen,
    destino: () => destino,
    ganado: () => ganado,
    puntaje: () => ultimoPuntaje,
    calidadPuntaje: () => ultimaCalidad,
    esDiario: () => modo === MODO_DIARIO,
    urlJuego,
    alMensaje: mensaje,
  });
  Share.aplicarEstilos();
  registrarEventos();
  bloquearEntrada(true);
  mensaje("cargando vectores…");
  try {
    await SimilitudService.cargar();
  } catch (e) {
    console.error(e);
    return mensaje("no se pudieron cargar los vectores", "error");
  }
  bloquearEntrada(false);
  const parUrl = leerParamsPractica();
  if (parUrl) await nuevoJuego(false, parUrl);
  else await nuevoJuego(true);
}

function bloquearEntrada(bloquear) {
  $("#entrada").disabled = bloquear;
}

function placeholderPuente() {
  const entrada = $("#entrada");
  if (entrada) entrada.placeholder = "palabra puente…";
}

function placeholderLibre() {
  const entrada = $("#entrada");
  if (!entrada) return;
  if (!origen) entrada.placeholder = "palabra origen…";
  else if (!destino) entrada.placeholder = "palabra destino…";
  else entrada.placeholder = "palabra puente…";
}

async function nuevoJuego(diario = false, par = null) {
  if (!SimilitudService.datosCargados) return;
  ganado = false;
  ultimoPuntaje = null;
  ultimaCalidad = null;
  SimilitudService.limpiarCacheSimilitudes();
  modo = diario ? MODO_DIARIO : MODO_PRACTICA;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  placeholderPuente();
  mensaje("preparando partida…");

  let estadoGuardado = null;
  if (par) {
    [origen, destino] = par;
  } else if (diario && (estadoGuardado = Saves.cargarEstadoDiario())) {
    [origen, destino] = [estadoGuardado.origen, estadoGuardado.destino];
  } else {
    const rng = diario ? Rng.delDia() : Math.random;
    [origen, destino] = await SimilitudService.elegirPalabrasObjetivo(rng);
  }
  actualizarVecinosObjetivos();
  $("#origen").textContent = origen;
  $("#destino").textContent = destino;
  Tablero.resetearObjetivos(origen, destino);
  await Tablero.reconstruir();
  Tablero.posicionar();
  if (estadoGuardado?.palabras.length) await restaurarPalabras(estadoGuardado.palabras);
  actualizarMenuModos();
  actualizarUrl();
  if (!ganado) mensaje("");
  $("#entrada").focus();
  guardarEstadoDiario();
}

async function nuevoJuegoLibre() {
  if (!SimilitudService.datosCargados) return;
  ganado = false;
  ultimoPuntaje = null;
  ultimaCalidad = null;
  SimilitudService.limpiarCacheSimilitudes();
  origen = null;
  destino = null;
  vecinosOrigen = [];
  vecinosDestino = [];
  Tablero.vaciar();
  modo = MODO_LIBRE;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  $("#origen").textContent = "–";
  $("#destino").textContent = "–";
  const flecha = $("#estado-flecha");
  flecha.classList.remove("ok");
  flecha.firstElementChild.className = "bi bi-three-dots";
  placeholderLibre();
  mensaje("elige la palabra origen");
  actualizarMenuModos();
  actualizarUrl();
  $("#entrada").focus();
}

async function definirPalabraLibre(p) {
  if (!origen) {
    origen = p;
    Tablero.insertar(p, { objetivo: true });
    $("#origen").textContent = origen;
    placeholderLibre();
    mensaje("elige la palabra destino");
    $("#entrada").focus();
    return;
  }

  destino = p;
  Tablero.insertar(p, { objetivo: true });
  $("#destino").textContent = destino;
  await SimilitudService.asegurarSimilitud(origen, destino);
  actualizarVecinosObjetivos();
  await Tablero.reconstruir();
  Tablero.posicionar();
  actualizarUrl();
  placeholderLibre();
  if (!ganado) mensaje("");
  $("#entrada").focus();
}

/** Deja solo origen y destino; quita el resto de palabras del tablero */
async function limpiarTablero() {
  if (!origen || !destino) return;
  ganado = false;
  ultimoPuntaje = null;
  ultimaCalidad = null;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  Tablero.resetearObjetivos(origen, destino);
  await Tablero.reconstruir();
  Tablero.posicionar();
  if (!ganado) mensaje("");
  guardarEstadoDiario();
}

/** Reinserta, en orden, las palabras que la persona ya había agregado hoy */
async function restaurarPalabras(palabras) {
  restaurando = true;
  try {
    let primera = true;
    for (const p of palabras) {
      if (Tablero.tiene(p) || !SimilitudService.existeEnDiccionario(p)) continue;
      try {
        SimilitudService.calcularSimilitudesContra(p, Tablero.getPalabras());
      } catch {
        continue;
      }
      if (!primera) await new Promise((r) => setTimeout(r, 200));
      primera = false;
      await colocar(p);
    }
  } finally {
    restaurando = false;
  }
}

function abrirHistoricoDiario() {
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

function registrarModalHistoricoDiario() {
  const modal = $("#modal-historico-diario");
  if (!modal) return;
  const cerrar = () => modal.classList.add("oculto");
  $("#modal-historico-diario-cerrar")?.addEventListener("click", cerrar);
  modal.querySelector("[data-cerrar-historico-diario]")?.addEventListener("click", cerrar);
  $("#menu-racha-diaria")?.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirHistoricoDiario();
  });
}

let reportarTipoSeleccionado = null;

function abrirModalReportar() {
  if (!panelPalabraActual) return;
  reportarTipoSeleccionado = null;
  $("#modal-reportar-subtitulo").textContent = panelPalabraActual;
  $("#modal-reportar-comentario").value = "";
  $("#modal-reportar-opciones")
    .querySelectorAll(".menu-modo-opcion")
    .forEach((btn) => btn.classList.remove("activo"));
  $("#modal-reportar-enviar").disabled = true;
  $("#modal-reportar").classList.remove("oculto");
}

function registrarModalReportar() {
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
        reportarTipoSeleccionado = btn.dataset.tipoReporte;
        $("#modal-reportar-opciones")
          .querySelectorAll(".menu-modo-opcion")
          .forEach((b) => b.classList.toggle("activo", b === btn));
        $("#modal-reportar-enviar").disabled = false;
      });
    });

  $("#modal-reportar-enviar")?.addEventListener("click", () => {
    if (!reportarTipoSeleccionado || !panelPalabraActual) return;
    const comentario = $("#modal-reportar-comentario").value.trim().slice(0, 100);
    Goatcounter.palabraReportada(panelPalabraActual, reportarTipoSeleccionado, comentario);
    cerrar();
    mensaje("¡Gracias por tu reporte!");
  });
}

function actualizarMenuModos() {
  const fechaEl = $("#menu-fecha-diario");
  if (fechaEl) fechaEl.textContent = Fechas.formato(Fechas.hoy());
  document.querySelectorAll(".menu-modo-opcion").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  const racha = Saves.obtenerRachaDiaria();
  const rachaWrap = $("#menu-racha-diaria");
  const rachaValorEl = $("#menu-racha-diaria-valor");
  if (rachaWrap && rachaValorEl) {
    rachaWrap.classList.toggle("oculto", racha <= 0);
    rachaValorEl.textContent = racha;
  }
  actualizarUmbralInfo();
  actualizarRaeInfo();
  actualizarHintInfo();
  actualizarTemaInfo();
}


/** Recalcula vecinosOrigen/vecinosDestino para el par origen/destino vigente */
function actualizarVecinosObjetivos() {
  vecinosOrigen = SimilitudService.vecinosParaPistas(origen);
  vecinosDestino = SimilitudService.vecinosParaPistas(destino);
}

function componenteConecta(aristas) {
  const find = Tablero.agruparConectadas(aristas);
  return find(origen) === find(destino);
}

function caminoMasCorto(aristas) {
  const adj = {};
  [...Tablero.getPalabras()].forEach((n) => (adj[n] = []));
  aristas.forEach((c) => {
    adj[c.a].push(c.b);
    adj[c.b].push(c.a);
  });

  const prev = { [origen]: null };
  const cola = [origen];
  for (let i = 0; i < cola.length; i++) {
    const u = cola[i];
    if (u === destino) break;
    for (const v of adj[u] || []) {
      if (!(v in prev)) {
        prev[v] = u;
        cola.push(v);
      }
    }
  }
  if (!(destino in prev)) return [];

  const nodos = [];
  for (let x = destino; x != null; x = prev[x]) nodos.push(x);
  nodos.reverse();
  return nodos;
}

function actualizarEstado(aristas) {
  const conecta = componenteConecta(aristas);
  const flecha = $("#estado-flecha");
  flecha.classList.toggle("ok", conecta);
  flecha.firstElementChild.className = conecta ? "bi bi-arrow-right" : "bi bi-three-dots";

  if (conecta && !ganado) ganar(aristas);
  else if (!conecta) {
    Tablero.marcarRuta();
  }
}

const PUNTOS_VERDE = 1;
const PUNTOS_GRIS = 2;
const PUNTOS_ROJO = 3;

/**
 * Puntaje al estilo golf (menos es mejor):
 *  x1 por cada palabra puente en la ruta más corta (verde)
 *  x2 por cada palabra conectada a la red principal pero fuera de esa ruta (gris)
 *  x3 por cada palabra suelta, sin conectar a la red principal (roja)
 */
function calcularPuntaje(aristas, ruta) {
  const find = Tablero.agruparConectadas(aristas);
  const compPrincipal = find(origen);
  const rutaSet = new Set(ruta);
  let verdes = 0;
  let grises = 0;
  let sueltos = 0;
  Tablero.getPalabras().forEach((id) => {
    if (id === origen || id === destino) return;
    if (rutaSet.has(id)) verdes++;
    else if (find(id) === compPrincipal) grises++;
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
function colorPuntaje({ verdes, grises, sueltos }) {
  if (verdes === 0 && grises === 0 && sueltos === 0) return "puntaje-bueno";
  if (grises + sueltos > verdes * 2) return "puntaje-malo";
  if (verdes + 1 >= (grises + sueltos)) return "puntaje-bueno";
  return "puntaje-regular";
}

function mostrarResultado({ verdes, grises, sueltos, puntaje }) {
  ultimoPuntaje = puntaje;
  ultimaCalidad = colorPuntaje({ verdes, grises, sueltos });
  const total = $("#puntaje-total");
  total.textContent = puntaje;
  total.classList.remove("puntaje-bueno", "puntaje-regular", "puntaje-malo");
  total.classList.add(ultimaCalidad);
  $("#puntaje-verdes-cant").textContent = verdes;
  $("#puntaje-verdes-total").textContent = verdes * PUNTOS_VERDE;
  $("#puntaje-grises-cant").textContent = grises;
  $("#puntaje-grises-total").textContent = grises * PUNTOS_GRIS;
  $("#puntaje-sueltos-cant").textContent = sueltos;
  $("#puntaje-sueltos-total").textContent = sueltos * PUNTOS_ROJO;
  if (modo !== MODO_DIARIO) $("#estadistica-diaria")?.classList.add("oculto");
  if (!restaurando) $("#modal-final").classList.remove("oculto");
}

function dibujarGraficoHistorico(entradas, canvas = $("#grafico-historico")) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = canvas.clientHeight || 120;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const c = Theme.colores();
  const padL = 28;
  const padR = 8;
  const padT = 14;
  const padB = 22;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  if (!entradas.length) {
    ctx.fillStyle = c.textoDebil;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos aún", cssW / 2, cssH / 2);
    return;
  }

  const puntajesJugados = entradas.filter((e) => e.jugado).map((e) => e.puntaje);
  const maxY = Math.max(...puntajesJugados, 1);
  const hoy = Fechas.hoy();
  const n = entradas.length;
  const gap = Math.max(2, (w / n) * 0.2);
  const barW = Math.max(2, (w - gap * (n - 1)) / n);
  const altoFalta = 4;
  const baseline = padT + h - altoFalta;

  // Mayor puntaje arriba (eje Y estándar); días sin jugar = -1 debajo del 0
  const yDe = (p) => padT + (1 - p / maxY) * (h - altoFalta);
  const xBarra = (i) => padL + i * (barW + gap);
  const xCentro = (i) => xBarra(i) + barW / 2;

  ctx.strokeStyle = c.borde;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, baseline);
  ctx.lineTo(padL + w, baseline);
  ctx.stroke();

  ctx.fillStyle = c.textoDebil;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(String(maxY), padL - 4, padT + 3);
  ctx.fillText("0", padL - 4, baseline + 3);

  entradas.forEach((e, i) => {
    const x = xBarra(i);
    if (!e.jugado || e.puntaje < 0) {
      ctx.save();
      ctx.strokeStyle = c.acento;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, baseline + 0.5, barW - 1, altoFalta - 1);
      ctx.beginPath();
      ctx.rect(x, baseline, barW, altoFalta);
      ctx.clip();
      ctx.beginPath();
      for (let raya = -altoFalta; raya < barW; raya += 6) {
        ctx.moveTo(x + raya, baseline + altoFalta);
        ctx.lineTo(x + raya + altoFalta, baseline);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    const y = yDe(e.puntaje);
    const barH = Math.max(1, baseline - y);
    ctx.fillStyle = e.fecha === hoy ? c.exito : c.bordeFuerte;
    ctx.fillRect(x, y, barW, barH);
  });

  ctx.fillStyle = c.textoDebil;
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(Fechas.formato(entradas[0].fecha, "dm"), xCentro(0), cssH - 4);
  if (n > 2) {
    const mid = (n / 2) | 0;
    ctx.fillText(Fechas.formato(entradas[mid].fecha, "dm"), xCentro(mid), cssH - 4);
  }
  ctx.fillText(Fechas.formato(entradas[n - 1].fecha, "dm"), xCentro(n - 1), cssH - 4);
}

function renderizarEstadisticaDiaria() {
  if (modo !== MODO_DIARIO) {
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

function actualizarEstadisticaDiaria(puntaje) {
  Saves.guardarPuntajeDiario(Fechas.hoy(), puntaje);
  Saves.registrarRachaDiaria();
  if (restaurando) return;
  renderizarEstadisticaDiaria();
}

function ganar(aristas) {
  ganado = true;
  const ruta = caminoMasCorto(aristas);
  Tablero.marcarRuta(ruta);
  const resultado = calcularPuntaje(aristas, ruta);
  mensaje(`puntaje: ${resultado.puntaje}`, `${colorPuntaje(resultado)} clicable`);
  bloquearEntrada(true);
  mostrarResultado(resultado);
  if (modo === MODO_DIARIO) actualizarEstadisticaDiaria(resultado.puntaje);
}

async function anadirPalabra(cruda) {
  if (ganado) return;
  const p = norm(cruda || "");
  if (!p) return;
  if (Tablero.tiene(p)) return mensaje(`“${p}” ya está en el tablero`, "error");

  if (!SimilitudService.existeEnDiccionario(p)) {
    Goatcounter.palabraRechazada(p);
    return mensajeSugerencia(p, SimilitudService.sugerenciasOrtograficas(p));
  }

  if (modo === MODO_LIBRE && (!origen || !destino)) {
    await definirPalabraLibre(p);
    return;
  }

  try {
    SimilitudService.calcularSimilitudesContra(p, Tablero.getPalabras());
  } catch (e) {
    return mensaje("error al calcular la similitud", "error");
  }
  await colocar(p);
}

async function colocar(p) {
  $("#panel").classList.add("oculto");
  Tablero.insertar(p);
  await Tablero.reconstruir();
  Tablero.posicionar();
  guardarEstadoDiario();

  if (ganado) return;
  if (!restaurando) mensaje("");
}

const PISTAS_CANT = 5;
let panelPalabraActual = null;
let panelMostrandoPistas = false;

function renderizarListaTablero(palabra) {
  const otras = [...Tablero.getPalabras()]
    .filter((n) => n !== palabra)
    .map((n) => ({ n, s: SimilitudService.obtenerSimilitud(n, palabra) }))
    .sort((a, b) => b.s - a.s);
  $("#panel-lista").innerHTML = otras
    .map(
      (o) =>
        `<li class="${o.s > umbralActual() ? "conecta" : ""}"><span>${o.n}</span><span>${o.s}%</span></li>`
    )
    .join("");
}

function renderizarListaPistas(palabra) {
  const vecinos = palabra === origen ? vecinosOrigen : vecinosDestino;
  $("#panel-lista").innerHTML = vecinos
    .slice(0, PISTAS_CANT)
    .map(
      (v) =>
        `<li class="${v.sim > umbralActual() ? "conecta" : ""}"><span>${v.palabra}</span><span>${v.sim}%</span></li>`
    )
    .join("");
}

function renderizarPanelLista() {
  if (!panelPalabraActual) return;
  if (panelMostrandoPistas) renderizarListaPistas(panelPalabraActual);
  else renderizarListaTablero(panelPalabraActual);
}

async function mostrarPanel(palabra) {
  mensaje("calculando…");
  for (const n of Tablero.getPalabras()) {
    if (n !== palabra) await SimilitudService.asegurarSimilitud(palabra, n);
  }
  mensaje("");

  panelPalabraActual = palabra;
  panelMostrandoPistas = false;

  $("#panel").classList.remove("oculto");
  $("#panel-titulo").textContent = palabra;
  const rae = $("#panel-rae");
  rae.href = `https://dle.rae.es/${encodeURIComponent(palabra)}`;
  rae.title = `Ver “${palabra}” en la RAE`;
  rae.setAttribute("aria-label", `Ver definición de “${palabra}” en la RAE`);

  actualizarVisibilidadHint();
  renderizarPanelLista();
}

/** Muestra/oculta el botón de pista según el switch de ajustes y si la palabra abierta es origen/destino. */
function actualizarVisibilidadHint() {
  const hint = $("#panel-hint");
  if (!hint) return;
  const esObjetivo = panelPalabraActual === origen || panelPalabraActual === destino;
  const visible = hintVisible && esObjetivo;
  hint.classList.toggle("oculto", !visible);
  if (!visible && panelMostrandoPistas) {
    panelMostrandoPistas = false;
    renderizarPanelLista();
  }
  hint.classList.toggle("activo", visible && panelMostrandoPistas);
  hint.setAttribute("aria-pressed", String(visible && panelMostrandoPistas));
}

function mensajeSugerencia(palabra, sugerencias) {
  const el = $("#mensaje");
  el.className = "mensaje error";
  el.innerHTML = `“${palabra}” no se encuentra en el diccionario.<br>`;
  if (sugerencias.length) {
    el.innerHTML += " ¿Quisiste decir ";
    sugerencias.forEach((s, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sugerencia";
      chip.textContent = s;
      chip.addEventListener("mousedown", (e) => e.preventDefault());
      chip.addEventListener("click", async () => {
        await anadirPalabra(s);
        $("#entrada").focus();
      });
      el.appendChild(chip);
      if (i < sugerencias.length - 1) el.appendChild(document.createTextNode(", "));
    });
    el.appendChild(document.createTextNode("?"));
  }
}

function mensaje(txt, tipo = "") {
  const el = $("#mensaje");
  el.textContent = txt;
  el.className = "mensaje" + (tipo ? " " + tipo : "");
}

function leerParamsPractica() {
  const params = new URLSearchParams(location.search);
  const o = norm(params.get("origen") || "");
  const d = norm(params.get("destino") || "");
  if (!o || !d || o === d) return null;
  if (!SimilitudService.existeEnDiccionario(o) || !SimilitudService.existeEnDiccionario(d)) return null;
  return [o, d];
}

function construirUrlJuego() {
  const u = new URL(location.href);
  u.hash = "";
  if ((modo === MODO_PRACTICA || modo === MODO_LIBRE) && origen && destino) {
    u.searchParams.set("origen", origen);
    u.searchParams.set("destino", destino);
  } else {
    u.search = "";
  }
  return u;
}

function actualizarUrl() {
  const u = construirUrlJuego();
  const destinoUrl = `${u.pathname}${u.search}`;
  history.replaceState(null, "", destinoUrl || "/");
}

function urlJuego() {
  const u = construirUrlJuego();
  return u.href.replace(/\/$/, "") || u.origin;
}

function registrarViewport() {
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

function registrarMenuModos() {
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
        if (modo !== MODO_LIBRE) await nuevoJuegoLibre();
      } else if (elegido !== modo) {
        await nuevoJuego(true);
      }
    });
  });

  const modalConfirmar = $("#modal-confirmar-dificultad");
  const switchDificultad = $("#switch-dificultad");

  const aceptarCambioDificultad = async () => {
    if (pendienteDificil == null) return;
    dificil = pendienteDificil;
    pendienteDificil = null;
    modalConfirmar.classList.add("oculto");
    Saves.guardarBooleano(CLAVE_DIFICULTAD, dificil);
    actualizarUmbralInfo();
    if (SimilitudService.datosCargados && origen && destino) await limpiarTablero();
  };

  switchDificultad.addEventListener("change", (e) => {
    pendienteDificil = e.target.checked;
    $("#modal-confirmar-dificultad-texto").textContent =
      textoConfirmarDificultad(pendienteDificil);
    modalConfirmar.classList.remove("oculto");
  });

  $("#modal-confirmar-dificultad-aceptar").addEventListener("click", () => {
    void aceptarCambioDificultad();
  });
  $("#modal-confirmar-dificultad-cancelar").addEventListener("click", cancelarCambioDificultad);
  modalConfirmar.querySelector("[data-cerrar-confirmar-dificultad]").addEventListener("click", cancelarCambioDificultad);

  $("#switch-rae").addEventListener("change", (e) => {
    raeVisible = e.target.checked;
    Saves.guardarBooleano(CLAVE_RAE, raeVisible);
    actualizarRaeInfo();
  });

  $("#switch-hint").addEventListener("change", (e) => {
    hintVisible = e.target.checked;
    Saves.guardarBooleano(CLAVE_HINT, hintVisible);
    actualizarHintInfo();
  });

  $("#switch-tema").addEventListener("change", (e) => {
    temaClaro = e.target.checked;
    Saves.guardarBooleano(CLAVE_TEMA, temaClaro);
    Theme.aplicar(temaClaro);
    actualizarTemaInfo();
    Tablero.aplicarEstilos();
    Share.aplicarEstilos();
  });
}

function registrarEventos() {
  registrarViewport();

  $("#form-palabra").addEventListener("submit", async (e) => {
    e.preventDefault();
    const entrada = $("#entrada");
    const valor = entrada.value;
    entrada.value = "";
    await anadirPalabra(valor);
  });
  registrarMenuModos();
  registrarModalHistoricoDiario();
  registrarModalReportar();
  $("#btn-compartir").addEventListener("click", () => void Share.compartir());
  $("#mensaje").addEventListener("click", () => {
    if (!ganado) return;
    renderizarEstadisticaDiaria();
    $("#modal-final").classList.remove("oculto");
  });
  $("#panel-cerrar").addEventListener("click", () =>
    $("#panel").classList.add("oculto")
  );
  $("#panel-hint").addEventListener("click", () => {
    panelMostrandoPistas = !panelMostrandoPistas;
    actualizarVisibilidadHint();
    renderizarPanelLista();
  });
  $("#panel-reportar")?.addEventListener("click", () => abrirModalReportar());

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

  if (!ayudaVista) {
    ayudaVista = true;
    Saves.guardarBooleano(CLAVE_AYUDA_VISTA, ayudaVista);
    abrirAyuda("jugar");
  }

  $("#modal-final-cerrar").addEventListener("click", cerrarModalFinal);
  modalFinal.querySelector("[data-cerrar-final]").addEventListener("click", cerrarModalFinal);
  $("#modal-final-compartir").addEventListener("click", () => void Share.compartir());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modalConfirmarDificultad.classList.contains("oculto")) cancelarCambioDificultad();
    else if (!menuModos.classList.contains("oculto")) cerrarMenuModos();
    else if (!ayuda.classList.contains("oculto")) {
      if (!ayudaDetalle.classList.contains("oculto")) mostrarAyudaIndice();
      else cerrarAyuda();
    }
    else if (!modalFinal.classList.contains("oculto")) cerrarModalFinal();
  });
}

iniciar();
