// Retocado para word2vec SBWC + PCA 256d con "All-but-the-Top" (quita las
// direcciones dominantes comunes a casi toda palabra antes de reducir
// dimensiones; ver scripts/probar_all_but_top.py): pares aleatorios
// ~p95≈14%, ~p99≈22%; sinónimos casi siempre 30–80%.
const UMBRAL_NORMAL = 16.5;
const UMBRAL_DIFICIL = 21.5;
const SIM_OBJETIVO_MIN = 0;
const SIM_OBJETIVO_MAX = 5;
const PUENTES_MIN = 5;
const UMBRAL_PUENTES = 50;
const N_INTENTOS_ELECCION_OBJETIVOS = 1000;

const GRADO_MAX = 10; // los enlaces "se rompen" si un nodo acumula demasiados

let palabrasPool = [];     // subset frecuente (pool) para elegir origen/destino
let extra = {};            // similitudes: extra[a][b] = %
let origen = null;
let destino = null;
let vecinosOrigen = [];
let vecinosDestino = [];
let enTablero = new Set();
let cy = null; // Graph visualization

// Estados
let ganado = false;
let ultimoPuntaje = null;
let listo = false;
let restaurando = false;
let dificil = false;
let pendienteDificil = null;
let raeVisible = true;
let hintVisible = true;
let ayudaVista = false;
let temaClaro = false;

const CLAVE_DIFICULTAD = "tejepalabras-dificultad";

/** Lee un token de color definido en estilos.css (:root). */
function colorCss(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function coloresTema() {
  return {
    fondo: colorCss("--fondo"),
    superficie: colorCss("--superficie"),
    borde: colorCss("--borde"),
    bordeFuerte: colorCss("--borde-fuerte"),
    texto: colorCss("--texto"),
    textoSecundario: colorCss("--texto-secundario"),
    textoDebil: colorCss("--texto-debil"),
    exito: colorCss("--exito"),
    acento: colorCss("--acento"),
    acentoOscuro: colorCss("--acento-oscuro"),
  };
}

function cargarBooleano(clave, porDefecto) {
  try {
    const guardado = localStorage.getItem(clave);
    return guardado === null ? porDefecto : guardado === "1";
  } catch {
    return porDefecto;
  }
}

function guardarBooleano(clave, valor) {
  try {
    localStorage.setItem(clave, valor ? "1" : "0");
  } catch {
    // localStorage puede no estar disponible; no persistir no es grave.
  }
}

function cargarDificultad() {
  dificil = cargarBooleano(CLAVE_DIFICULTAD, false);
}

function guardarDificultad() {
  guardarBooleano(CLAVE_DIFICULTAD, dificil);
}

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

function cargarAyudaVista() {
  ayudaVista = cargarBooleano(CLAVE_AYUDA_VISTA, false);
}

function guardarAyudaVista() {
  guardarBooleano(CLAVE_AYUDA_VISTA, ayudaVista);
}

function cargarTema() {
  temaClaro = cargarBooleano(CLAVE_TEMA, false);
}

function guardarTema() {
  guardarBooleano(CLAVE_TEMA, temaClaro);
}

function aplicarTema() {
  if (temaClaro) document.documentElement.dataset.tema = "claro";
  else delete document.documentElement.dataset.tema;
}

function actualizarTemaInfo() {
  const switchTema = $("#switch-tema");
  if (switchTema) switchTema.checked = temaClaro;
}

function cargarRae() {
  raeVisible = cargarBooleano(CLAVE_RAE, true);
}

function guardarRae() {
  guardarBooleano(CLAVE_RAE, raeVisible);
}

function cargarHint() {
  hintVisible = cargarBooleano(CLAVE_HINT, true);
}

function guardarHint() {
  guardarBooleano(CLAVE_HINT, hintVisible);
}

const MODO_DIARIO = "diario";
const MODO_PRACTICA = "practica";
const MODO_LIBRE = "libre";
let modo = MODO_DIARIO;

// Guardamos el progreso del reto diario en localStorage
const CLAVE_DIARIO = "tejepalabras-diario-estado";
const CLAVE_HISTORICO_DIARIO = "tejepalabras-historico-diario";
const HISTORICO_MAX = 90;

// PRNG determinístico (mulberry32) sembrado con la fecha de hoy
function seedDesdeTexto(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(semilla) {
  let a = semilla;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fechaHoyStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function fechaHoyCorta() {
  const [y, m, d] = fechaHoyStr().split("-");
  return `${d}/${m}/${y}`;
}

function fechaAStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

function parseFechaStr(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fechaCortaDesdeStr(str) {
  const [y, m, d] = str.split("-");
  return `${d}/${m}`;
}

function rngDelDia() {
  return mulberry32(seedDesdeTexto(fechaHoyStr()));
}

function cargarEstadoDiario() {
  try {
    const bruto = localStorage.getItem(CLAVE_DIARIO);
    if (!bruto) return null;
    const datos = JSON.parse(bruto);
    if (datos.fecha !== fechaHoyStr()) return null;
    if (!datos.origen || !datos.destino || !Array.isArray(datos.palabras)) return null;
    return datos;
  } catch {
    return null;
  }
}

function guardarEstadoDiario() {
  if (modo !== MODO_DIARIO || !origen || !destino) return;
  try {
    localStorage.setItem(
      CLAVE_DIARIO,
      JSON.stringify({
        fecha: fechaHoyStr(),
        origen,
        destino,
        palabras: [...enTablero].filter((p) => p !== origen && p !== destino),
      })
    );
  } catch {
    // localStorage puede no estar disponible.
  }
}

function cargarHistoricoDiario() {
  try {
    const bruto = localStorage.getItem(CLAVE_HISTORICO_DIARIO);
    if (!bruto) return {};
    const datos = JSON.parse(bruto);
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return {};
    const limpio = {};
    for (const [fecha, puntaje] of Object.entries(datos)) {
      if (typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && Number.isFinite(puntaje)) {
        limpio[fecha] = Number(puntaje);
      }
    }
    return limpio;
  } catch {
    return {};
  }
}

function guardarPuntajeDiario(fecha, puntaje) {
  try {
    const historico = cargarHistoricoDiario();
    historico[fecha] = puntaje;
    const fechas = Object.keys(historico).sort();
    if (fechas.length > HISTORICO_MAX) {
      for (const f of fechas.slice(0, fechas.length - HISTORICO_MAX)) {
        delete historico[f];
      }
    }
    localStorage.setItem(CLAVE_HISTORICO_DIARIO, JSON.stringify(historico));
  } catch {
    // localStorage puede no estar disponible.
  }
}

/** Racha de días diarios ganados consecutivos, contando hacia atrás desde hoy. */
function calcularRacha(historico, hoy = fechaHoyStr()) {
  if (historico[hoy] == null) {
    const ayer = parseFechaStr(hoy);
    ayer.setDate(ayer.getDate() - 1);
    hoy = fechaAStr(ayer);
    if (historico[hoy] == null) return 0;
  }
  let racha = 0;
  let cursor = parseFechaStr(hoy);
  while (historico[fechaAStr(cursor)] != null) {
    racha++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return racha;
}

/** Últimas `cantidad` fechas del calendario hasta hoy, rellenando días sin jugar con 0. */
function entradasHistoricoOrdenadas(historico, cantidad = 14) {
  const fechas = Object.keys(historico).sort();
  if (!fechas.length) return [];

  const hoy = fechaHoyStr();
  const fin = parseFechaStr(hoy);
  const inicioVentana = parseFechaStr(hoy);
  inicioVentana.setDate(inicioVentana.getDate() - (cantidad - 1));
  const primera = parseFechaStr(fechas[0]);
  const inicio = primera > inicioVentana ? new Date(primera) : inicioVentana;

  const out = [];
  for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
    const f = fechaAStr(d);
    const jugado = historico[f] != null;
    out.push({ fecha: f, puntaje: jugado ? historico[f] : -1, jugado });
  }
  return out;
}

/** @type {Map<string, Float32Array>} */
const cacheEmb = new Map();
let diccionario = new Set();

const $ = (sel) => document.querySelector(sel);

function norm(s) {
  return s.trim().toLowerCase().normalize("NFC");
}

function registrarPalabraRechazada(palabra) {
  if (!window.goatcounter?.count) return;
  if (palabra.length < 2 || palabra.length > 25) return;
  if (!/^\p{L}+$/u.test(palabra)) return;
  window.goatcounter.count({
    path: `palabra-rechazada/${encodeURIComponent(palabra)}`,
    title: palabra,
    event: true,
  });
}

function normalizarL2(vec) {
  let n2 = 0;
  for (let i = 0; i < vec.length; i++) n2 += vec[i] * vec[i];
  const n = Math.sqrt(n2) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= n;
  return vec;
}

async function cargarEmbeddings() {
  const meta = await (await fetch("embeddings.json", { cache: "no-store" })).json();
  const [vocabTxt, poolTxt, buf] = await Promise.all([
    (await fetch(meta.vocab_file || "diccionario_es.vocab", { cache: "no-store" })).text(),
    (await fetch("diccionario_es.pool", { cache: "no-store" })).text(),
    (await fetch(meta.vectors_file || "embeddings.bin", { cache: "no-store" })).arrayBuffer(),
  ]);

  const palabras = [];
  for (const linea of vocabTxt.split("\n")) {
    const p = norm(linea);
    if (p) palabras.push(p);
  }
  if (palabras.length !== meta.n) {
    throw new Error(`vocab (${palabras.length}) ≠ meta.n (${meta.n})`);
  }

  const esperado = meta.n * meta.dim;
  const i8 = new Int8Array(buf);
  if (i8.length !== esperado) {
    throw new Error(`bin (${i8.length}) ≠ n*dim (${esperado})`);
  }

  const scale = meta.scale;
  const dim = meta.dim;
  diccionario = new Set();
  cacheEmb.clear();
  for (let i = 0; i < meta.n; i++) {
    const w = palabras[i];
    const vec = new Float32Array(dim);
    const base = i * dim;
    for (let d = 0; d < dim; d++) vec[d] = i8[base + d] * scale;
    normalizarL2(vec);
    cacheEmb.set(w, vec);
    diccionario.add(w);
  }

  // Origen/destino salen del pool (palabras frecuentes ∩ vocab con vector).
  palabrasPool = [];
  for (const linea of poolTxt.split("\n")) {
    const p = norm(linea);
    if (p && cacheEmb.has(p)) palabrasPool.push(p);
  }
  if (!palabrasPool.length) {
    throw new Error("pool vacío o sin solapamiento con el vocab");
  }

  listo = true;
}

function existeEnEspanol(palabra) {
  return diccionario.has(palabra);
}

function distanciaLevenshtein(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let filaMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + costo);
      if (curr[j] < filaMin) filaMin = curr[j];
    }
    if (filaMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function sugerencias(palabra, maximo = 4) {
  const orden = [];
  const visto = new Set();
  for (const w of diccionario) {
    const d = distanciaLevenshtein(palabra, w, 2);
    if (d > 0 && d <= 2) orden.push({ w, d });
  }
  orden.sort((x, y) => x.d - y.d || x.w.localeCompare(y.w));
  const out = [];
  for (const { w } of orden) {
    if (!visto.has(w)) {
      visto.add(w);
      out.push(w);
      if (out.length >= maximo) break;
    }
  }
  return out;
}

function embedding(palabra) {
  const vec = cacheEmb.get(palabra);
  if (!vec) throw new Error(`sin vector: ${palabra}`);
  return vec;
}

function producto(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Coseno en % acotado a [0, 100] (los negativos del coseno no aportan al juego). */
function similitudPct(a, b) {
  return Math.round(Math.max(0, Math.min(1, producto(a, b))) * 100);
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
  cargarDificultad();
  actualizarUmbralInfo();
  cargarRae();
  actualizarRaeInfo();
  cargarHint();
  actualizarHintInfo();
  cargarTema();
  aplicarTema();
  actualizarTemaInfo();
  cargarAyudaVista();
  crearCytoscape();
  registrarEventos();
  bloquearEntrada(true);
  mensaje("cargando vectores…");
  try {
    await cargarEmbeddings();
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

function leerSimCache(a, b) {
  if (extra[a] && extra[a][b] != null) return extra[a][b];
  if (extra[b] && extra[b][a] != null) return extra[b][a];
  return null;
}

function sim(a, b) {
  const c = leerSimCache(a, b);
  return c != null ? c : -100;
}

async function asegurarSim(a, b) {
  const c = leerSimCache(a, b);
  if (c != null) return c;
  const s = similitudPct(embedding(a), embedding(b));
  guardarSim(a, b, s);
  return s;
}

async function asegurarSimsPares(nodos) {
  for (let i = 0; i < nodos.length; i++) {
    for (let j = i + 1; j < nodos.length; j++) {
      await asegurarSim(nodos[i], nodos[j]);
    }
  }
}

function guardarSim(a, b, val) {
  (extra[a] = extra[a] || {})[b] = val;
  (extra[b] = extra[b] || {})[a] = val;
}

function estiloGrafo() {
  const c = coloresTema();
  return [
    {
      selector: "node",
      style: {
        label: "data(id)",
        "font-family": "system-ui, sans-serif",
        "font-size": 14,
        color: c.texto,
        "text-valign": "center",
        "text-halign": "center",
        width: "label",
        height: 32,
        padding: 8,
        shape: "round-rectangle",
        "background-color": c.superficie,
        "border-width": 1,
        "border-color": c.bordeFuerte,
      },
    },
    {
      selector: "node.objetivo",
      style: {
        "border-color": c.textoSecundario,
        "border-width": 2,
        "font-weight": 700,
      },
    },
    {
      selector: "node.aislado",
      style: {
        "border-color": c.acentoOscuro,
        "border-width": 2,
      },
    },
    {
      selector: "edge",
      style: {
        width: "data(peso)",
        "line-color": c.borde,
        "curve-style": "bezier",
        label: "data(etiqueta)",
        "font-size": 9,
        color: c.textoDebil,
        "text-background-color": c.fondo,
        "text-background-opacity": 1,
        "text-background-padding": 2,
      },
    },
    {
      selector: "edge.ruta",
      style: { "line-color": c.exito, color: c.exito },
    },
    {
      selector: "node.conectado",
      style: { "border-color": c.exito, "border-width": 2 },
    },
    {
      selector: "node.captura",
      style: {
        label: "",
        "text-opacity": 0,
        width: 36,
        height: 36,
        padding: 0,
        "border-width": 0,
        "corner-radius": 4,
        "background-color": c.bordeFuerte,
      },
    },
    {
      selector: "node.captura.objetivo",
      style: {
        label: "data(id)",
        "text-opacity": 1,
        color: c.fondo,
        "font-weight": 700,
        width: "label",
        height: 32,
        padding: 8,
        "background-color": c.textoSecundario,
      },
    },
    {
      selector: "node.captura.conectado",
      style: { "background-color": c.exito },
    },
    {
      selector: "node.captura.aislado",
      style: { "background-color": c.acentoOscuro },
    },
    {
      selector: "edge.captura",
      style: { label: "", "text-opacity": 0 },
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
        "line-color": c.borde,
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

function aplicarEstilosGrafo() {
  if (!cy) return;
  cy.style().fromJson(estiloGrafo()).update();
}

function crearCytoscape() {
  cy = cytoscape({
    container: $("#grafo"),
    minZoom: 0.3,
    maxZoom: 1.5,
    style: estiloGrafo(),
  });

  cy.on("tap", "node", (e) => void mostrarPanel(e.target.id()));
  cy.on("tap", (e) => {
    if (e.target === cy) $("#panel").classList.add("oculto");
  });
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
  if (!listo) return;
  ganado = false;
  ultimoPuntaje = null;
  extra = {};
  modo = diario ? MODO_DIARIO : MODO_PRACTICA;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  placeholderPuente();
  mensaje("preparando partida…");

  let estadoGuardado = null;
  if (par) {
    [origen, destino] = par;
  } else if (diario && (estadoGuardado = cargarEstadoDiario())) {
    [origen, destino] = [estadoGuardado.origen, estadoGuardado.destino];
  } else {
    const rng = diario ? rngDelDia() : Math.random;
    [origen, destino] = await elegirObjetivos(rng);
  }
  actualizarVecinosObjetivos();
  enTablero = new Set([origen, destino]);
  $("#origen").textContent = origen;
  $("#destino").textContent = destino;
  cy.elements().remove();
  cy.add([
    { data: { id: origen }, classes: "objetivo" },
    { data: { id: destino }, classes: "objetivo" },
  ]);
  await reconstruir();
  if (estadoGuardado?.palabras.length) await restaurarPalabras(estadoGuardado.palabras);
  ejecutarLayout();
  actualizarMenuModos();
  actualizarUrl();
  if (!ganado) mensaje("");
  $("#entrada").focus();
  guardarEstadoDiario();
}

async function nuevoJuegoLibre() {
  if (!listo) return;
  ganado = false;
  ultimoPuntaje = null;
  extra = {};
  origen = null;
  destino = null;
  vecinosOrigen = [];
  vecinosDestino = [];
  enTablero = new Set();
  modo = MODO_LIBRE;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  $("#origen").textContent = "–";
  $("#destino").textContent = "–";
  const flecha = $("#estado-flecha");
  flecha.classList.remove("ok");
  flecha.firstElementChild.className = "bi bi-three-dots";
  cy.elements().remove();
  placeholderLibre();
  mensaje("elige la palabra origen");
  actualizarMenuModos();
  actualizarUrl();
  $("#entrada").focus();
}

async function definirPalabraLibre(p) {
  if (!origen) {
    origen = p;
    enTablero.add(p);
    cy.add({ data: { id: p }, classes: "objetivo" });
    $("#origen").textContent = origen;
    placeholderLibre();
    mensaje("elige la palabra destino");
    $("#entrada").focus();
    return;
  }

  destino = p;
  enTablero.add(p);
  cy.add({ data: { id: p }, classes: "objetivo" });
  $("#destino").textContent = destino;
  await asegurarSim(origen, destino);
  actualizarVecinosObjetivos();
  await reconstruir();
  ejecutarLayout();
  actualizarUrl();
  placeholderLibre();
  if (!ganado) mensaje("");
  $("#entrada").focus();
}

/** Deja solo origen y destino; quita el resto de palabras del tablero. */
async function limpiarTablero() {
  if (!origen || !destino) return;
  ganado = false;
  ultimoPuntaje = null;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  enTablero = new Set([origen, destino]);
  cy.elements().remove();
  cy.add([
    { data: { id: origen }, classes: "objetivo" },
    { data: { id: destino }, classes: "objetivo" },
  ]);
  await reconstruir();
  ejecutarLayout();
  if (!ganado) mensaje("");
  guardarEstadoDiario();
}

/** Reinserta, en orden, las palabras que la persona ya había agregado hoy. */
async function restaurarPalabras(palabras) {
  restaurando = true;
  try {
    for (const p of palabras) {
      if (enTablero.has(p) || !existeEnEspanol(p)) continue;
      try {
        const embP = embedding(p);
        for (const w of enTablero) {
          if (w === p) continue;
          guardarSim(p, w, similitudPct(embP, embedding(w)));
        }
      } catch {
        continue;
      }
      await colocar(p);
    }
  } finally {
    restaurando = false;
  }
}

function actualizarMenuModos() {
  const fechaEl = $("#menu-fecha-diario");
  if (fechaEl) fechaEl.textContent = fechaHoyCorta();
  document.querySelectorAll(".menu-modo-opcion").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  actualizarUmbralInfo();
  actualizarRaeInfo();
  actualizarHintInfo();
  actualizarTemaInfo();
}


function contarVecinos(palabra, minimo, umbral = UMBRAL_PUENTES) {
  const emb = embedding(palabra);
  let cuenta = 0;
  const vecinos = [];
  for (const w of palabrasPool) {
    if (w === palabra) continue;
    const sim = similitudPct(emb, cacheEmb.get(w));
    if (sim <= umbral) continue;
    cuenta++;
    vecinos.push({ palabra: w, sim });
    if (cuenta >= minimo) break;
  }
  return { cuenta, vecinos };
}

function tieneSuficientesPuentes(a, b, minimo = PUENTES_MIN) {
  const { cuenta: cuentaA, vecinos: vecinosA } = contarVecinos(a, minimo);
  const { cuenta: cuentaB, vecinos: vecinosB } = contarVecinos(b, minimo);
  const ok = cuentaA >= minimo && cuentaB >= minimo;
  // console.log(
  //   `[puentes] "${a}": ${cuentaA}/${minimo}${cuentaA >= minimo ? " ✅" : " ❌"} | ` +
  //     `"${b}": ${cuentaB}/${minimo}${cuentaB >= minimo ? " ✅" : " ❌"} → ${ok ? "✅" : "❌"}`
  // );
  // console.table([...vecinosA.map((v) => ({ de: a, ...v })), ...vecinosB.map((v) => ({ de: b, ...v }))]);
  return ok;
}

async function elegirObjetivos(rng = Math.random) {
  for (let intento = 0; intento < N_INTENTOS_ELECCION_OBJETIVOS; intento++) {
    const a = palabrasPool[(rng() * palabrasPool.length) | 0];
    const b = palabrasPool[(rng() * palabrasPool.length) | 0];
    if (a === b) continue;
    const s = await asegurarSim(a, b);
    // console.log(`[elegirObjetivos] intento ${intento}: "${a}"↔"${b}" sim=${s}%`);
    if (s < SIM_OBJETIVO_MIN || s > SIM_OBJETIVO_MAX) continue;
    // console.log(`[elegirObjetivos] intento ${intento}: sim en rango, revisando puentes…`);
    if (tieneSuficientesPuentes(a, b)) {
      // console.log(`[elegirObjetivos] elegido "${a}" ↔ "${b}" en el intento ${intento}`);
      return [a, b];
    }
  }
  // console.log("[elegirObjetivos] se agotaron los N_INTENTOS_ELECCION_OBJETIVOS intentos, usando fallback fijo");
  return [palabrasPool[0], palabrasPool[palabrasPool.length - 1]];
}

/** Recalcula vecinosOrigen/vecinosDestino para el par origen/destino vigente. */
function actualizarVecinosObjetivos() {
  vecinosOrigen = contarVecinos(origen, PUENTES_MIN).vecinos.sort((x, y) => y.sim - x.sim);
  vecinosDestino = contarVecinos(destino, PUENTES_MIN).vecinos.sort((x, y) => y.sim - x.sim);
  // console.log(`[vecinos] "${origen}" (origen):`, vecinosOrigen);
  // console.log(`[vecinos] "${destino}" (destino):`, vecinosDestino);
}

function calcularAristas() {
  const nodos = [...enTablero];
  const candidatas = [];
  for (let i = 0; i < nodos.length; i++) {
    for (let j = i + 1; j < nodos.length; j++) {
      const s = sim(nodos[i], nodos[j]);
      if (s > umbralActual()) candidatas.push({ a: nodos[i], b: nodos[j], s });
    }
  }
  candidatas.sort((x, y) => y.s - x.s);

  const grado = {};
  nodos.forEach((n) => (grado[n] = 0));
  const finales = [];
  for (const c of candidatas) {
    if (grado[c.a] < GRADO_MAX && grado[c.b] < GRADO_MAX) {
      finales.push(c);
      grado[c.a]++;
      grado[c.b]++;
    }
  }
  return finales;
}

async function reconstruir() {
  await asegurarSimsPares([...enTablero]);
  cy.edges().remove();
  const aristas = calcularAristas();
  aristas.forEach((c) => {
    cy.add({
      data: {
        id: `${c.a}__${c.b}`,
        source: c.a,
        target: c.b,
        peso: 1 + (c.s - umbralActual()) / 12,
        etiqueta: `${c.s}%`,
      },
    });
  });

  actualizarEstado(aristas);
  marcarAislados(aristas);
  return aristas;
}

function construirUnionFind(aristas) {
  const padre = {};
  const find = (x) => (padre[x] === x ? x : (padre[x] = find(padre[x])));
  [...enTablero].forEach((n) => (padre[n] = n));
  aristas.forEach((c) => {
    const ra = find(c.a);
    const rb = find(c.b);
    if (ra !== rb) padre[ra] = rb;
  });
  return find;
}

function marcarAislados(aristas) {
  const find = construirUnionFind(aristas);
  const compOrigen = find(origen);
  const compDestino = find(destino);
  cy.nodes().forEach((n) => {
    const id = n.id();
    const enRedPrincipal =
      id === origen || id === destino || find(id) === compOrigen || find(id) === compDestino;
    n.toggleClass("aislado", !enRedPrincipal);
  });
}

function ejecutarLayout() {
  const layout = cy.layout({
    name: "cose",
    animate: true,
    animationDuration: 400,
    idealEdgeLength: 90,
    nodeRepulsion: 9000,
    padding: 40,
  });
  layout.one("layoutstop", () => asegurarNodosVisibles());
  layout.run();
}

function colocarNodoNuevo(p, aristas) {
  const nodo = cy.getElementById(p);
  const vecinos = aristas
    .filter((c) => c.a === p || c.b === p)
    .map((c) => (c.a === p ? c.b : c.a));

  if (vecinos.length) {
    let x = 0;
    let y = 0;
    vecinos.forEach((id) => {
      const pos = cy.getElementById(id).position();
      x += pos.x;
      y += pos.y;
    });
    x /= vecinos.length;
    y /= vecinos.length;
    const ang = Math.random() * Math.PI * 2;
    nodo.position({ x: x + Math.cos(ang) * 70, y: y + Math.sin(ang) * 70 });
  } else {
    const bb = cy.elements().not(nodo).boundingBox();
    const cx = Number.isFinite(bb.x1) ? (bb.x1 + bb.x2) / 2 : 0;
    const centroY = Number.isFinite(bb.y1) ? (bb.y1 + bb.y2) / 2 : 0;
    const ang = Math.random() * Math.PI * 2;
    nodo.position({
      x: cx + Math.cos(ang) * 120,
      y: centroY + Math.sin(ang) * 120,
    });
  }
}

function nodosDentroDePantalla(margen = 16) {
  const w = cy.width();
  const h = cy.height();
  return cy.nodes().every((n) => {
    const bb = n.renderedBoundingBox({ includeLabels: true });
    return (
      bb.x1 >= margen &&
      bb.y1 >= margen &&
      bb.x2 <= w - margen &&
      bb.y2 <= h - margen
    );
  });
}

function asegurarNodosVisibles({ animar = true } = {}) {
  if (!cy.nodes().length || nodosDentroDePantalla()) return;
  if (animar) {
    cy.animate({
      fit: { eles: cy.nodes(), padding: 40 },
      duration: 280,
      easing: "ease-out",
    });
  } else {
    cy.fit(cy.nodes(), 40);
  }
}

function componenteConecta(aristas) {
  const find = construirUnionFind(aristas);
  return find(origen) === find(destino);
}

function caminoMasCorto(aristas) {
  const adj = {};
  [...enTablero].forEach((n) => (adj[n] = []));
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

function marcarRuta(nodos) {
  cy.nodes().removeClass("conectado");
  cy.edges().removeClass("ruta");
  nodos.forEach((id) => cy.getElementById(id).addClass("conectado"));
  for (let i = 0; i < nodos.length - 1; i++) {
    const a = nodos[i];
    const b = nodos[i + 1];
    const e =
      cy.getElementById(`${a}__${b}`).nonempty()
        ? cy.getElementById(`${a}__${b}`)
        : cy.getElementById(`${b}__${a}`);
    if (e.nonempty()) e.addClass("ruta");
  }
}

function actualizarEstado(aristas) {
  const conecta = componenteConecta(aristas);
  const flecha = $("#estado-flecha");
  flecha.classList.toggle("ok", conecta);
  flecha.firstElementChild.className = conecta ? "bi bi-arrow-right" : "bi bi-three-dots";

  if (conecta && !ganado) ganar(aristas);
  else if (!conecta) {
    cy.nodes().removeClass("conectado");
    cy.edges().removeClass("ruta");
  }
}

const PUNTOS_VERDE = 1;
const PUNTOS_GRIS = 2;
const PUNTOS_ROJO = 3;

/**
 * Puntaje al estilo golf (menos es mejor):
 *  x1 por cada palabra puente en la ruta más corta (verde).
 *  x2 por cada palabra conectada a la red principal pero fuera de esa ruta (gris).
 *  x3 por cada palabra suelta, sin conectar a la red principal (roja).
 */
function calcularPuntaje(aristas, ruta) {
  const find = construirUnionFind(aristas);
  const compPrincipal = find(origen);
  const rutaSet = new Set(ruta);
  let verdes = 0;
  let grises = 0;
  let sueltos = 0;
  enTablero.forEach((id) => {
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
 *  - malo: lo "desperdiciado" (grises + sueltos) triplica o supera a la ruta más corta.
 *  - bueno: la ruta más corta pesa más que las palabras conectadas fuera de ruta
 *    (incluye el caso perfecto de conexión directa, sin palabras extra).
 *  - regular: cualquier otro caso intermedio.
 */
function colorPuntaje({ verdes, grises, sueltos }) {
  if (verdes === 0 && grises === 0 && sueltos === 0) return "puntaje-bueno";
  if (grises + sueltos >= verdes * 3) return "puntaje-malo";
  if (verdes > (grises + sueltos)) return "puntaje-bueno";
  return "puntaje-regular";
}

function mostrarResultado({ verdes, grises, sueltos, puntaje }) {
  ultimoPuntaje = puntaje;
  const total = $("#puntaje-total");
  total.textContent = puntaje;
  total.classList.remove("puntaje-bueno", "puntaje-regular", "puntaje-malo");
  total.classList.add(colorPuntaje({ verdes, grises, sueltos }));
  $("#puntaje-verdes-cant").textContent = verdes;
  $("#puntaje-verdes-total").textContent = verdes * PUNTOS_VERDE;
  $("#puntaje-grises-cant").textContent = grises;
  $("#puntaje-grises-total").textContent = grises * PUNTOS_GRIS;
  $("#puntaje-sueltos-cant").textContent = sueltos;
  $("#puntaje-sueltos-total").textContent = sueltos * PUNTOS_ROJO;
  if (modo !== MODO_DIARIO) $("#estadistica-diaria")?.classList.add("oculto");
  if (!restaurando) $("#modal-final").classList.remove("oculto");
}

function dibujarGraficoHistorico(entradas) {
  const canvas = $("#grafico-historico");
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = canvas.clientHeight || 120;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const c = coloresTema();
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
  const hoy = fechaHoyStr();
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
  ctx.fillText(fechaCortaDesdeStr(entradas[0].fecha), xCentro(0), cssH - 4);
  if (n > 2) {
    const mid = (n / 2) | 0;
    ctx.fillText(fechaCortaDesdeStr(entradas[mid].fecha), xCentro(mid), cssH - 4);
  }
  ctx.fillText(fechaCortaDesdeStr(entradas[n - 1].fecha), xCentro(n - 1), cssH - 4);
}

function renderizarEstadisticaDiaria() {
  if (modo !== MODO_DIARIO) {
    $("#estadistica-diaria")?.classList.add("oculto");
    return;
  }
  const historico = cargarHistoricoDiario();
  if (historico[fechaHoyStr()] == null) {
    $("#estadistica-diaria")?.classList.add("oculto");
    return;
  }
  const racha = calcularRacha(historico);
  const rachaEl = $("#racha-diaria-valor");
  if (rachaEl) rachaEl.textContent = racha;
  const unidadEl = $("#racha-diaria-unidad");
  if (unidadEl) unidadEl.textContent = racha === 1 ? "día" : "días";
  const seccion = $("#estadistica-diaria");
  if (seccion) seccion.classList.remove("oculto");

  const entradas = entradasHistoricoOrdenadas(historico);
  const bloqueHistorico = $("#historico-diario");
  if (entradas.length < 2) {
    bloqueHistorico?.classList.add("oculto");
    return;
  }
  bloqueHistorico?.classList.remove("oculto");
  // Esperar un frame para que el canvas tenga ancho CSS al dejar de estar oculto.
  requestAnimationFrame(() => {
    dibujarGraficoHistorico(entradas);
  });
}

function actualizarEstadisticaDiaria(puntaje) {
  guardarPuntajeDiario(fechaHoyStr(), puntaje);
  if (restaurando) return;
  renderizarEstadisticaDiaria();
}

function ganar(aristas) {
  ganado = true;
  const ruta = caminoMasCorto(aristas);
  marcarRuta(ruta);
  const resultado = calcularPuntaje(aristas, ruta);
  mensaje(`puntaje: ${resultado.puntaje}`, `${colorPuntaje(resultado)} clicable`);
  bloquearEntrada(true);
  mostrarResultado(resultado);
  if (modo === MODO_DIARIO) actualizarEstadisticaDiaria(resultado.puntaje);
}

function esDispositivoTactil() {
  return matchMedia("(pointer: coarse)").matches;
}

function puedeUsarWebShare() {
  return window.isSecureContext && typeof navigator.share === "function";
}

async function anadirPalabra(cruda) {
  if (ganado) return;
  const p = norm(cruda || "");
  if (!p) return;
  if (enTablero.has(p)) return mensaje(`“${p}” ya está en el tablero`, "error");

  if (!existeEnEspanol(p)) {
    registrarPalabraRechazada(p);
    return mensajeSugerencia(p, sugerencias(p));
  }

  if (modo === MODO_LIBRE && (!origen || !destino)) {
    await definirPalabraLibre(p);
    return;
  }

  try {
    const embP = embedding(p);
    for (const w of enTablero) {
      if (w === p) continue;
      guardarSim(p, w, similitudPct(embP, embedding(w)));
    }
  } catch (e) {
    return mensaje("error al calcular la similitud", "error");
  }
  await colocar(p);
}

async function colocar(p) {
  $("#panel").classList.add("oculto");
  enTablero.add(p);
  cy.add({ data: { id: p } });
  const aristas = await reconstruir();
  colocarNodoNuevo(p, aristas);
  if (!restaurando) asegurarNodosVisibles();
  guardarEstadoDiario();

  if (ganado) return;
  if (!restaurando) mensaje("");
}

const PISTAS_CANT = 5;
let panelPalabraActual = null;
let panelMostrandoPistas = false;

function renderizarListaTablero(palabra) {
  const otras = [...enTablero]
    .filter((n) => n !== palabra)
    .map((n) => ({ n, s: sim(n, palabra) }))
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
  for (const n of enTablero) {
    if (n !== palabra) await asegurarSim(palabra, n);
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
  if (!existeEnEspanol(o) || !existeEnEspanol(d)) return null;
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

function etiquetaFecha() {
  if (modo !== MODO_DIARIO) return "";
  const [y, m, d] = fechaHoyStr().split("-");
  return ` (${d}/${m}/${y})`;
}

function textoDesafio() {
  return `Te desafío a unir '${origen}' con '${destino}'${etiquetaFecha()} en Tejepalabras.`;
}

function textoCompartir() {
  const puntos = ultimoPuntaje ?? 0;
  return `Conecté '${origen}' con '${destino}'${etiquetaFecha()} en Tejepalabras con ${puntos} punto${puntos === 1 ? "" : "s"}. Crees que podrías hacerlo mejor?`;
}

async function copiarPortapapeles(texto) {
  await navigator.clipboard.writeText(texto);
  mensaje("copiado al portapapeles", "ok");
}

async function compartirConImagen(texto) {
  const url = urlJuego();
  const blob = await capturarGrafo();
  const file = new File([blob], "tejepalabras.png", { type: "image/png" });
  const conArchivo = { files: [file], title: "Tejepalabras", text: texto, url };
  if (navigator.canShare?.(conArchivo)) {
    await navigator.share(conArchivo);
  } else {
    await navigator.share({ title: "Tejepalabras", text: texto, url });
  }
}

async function compartir() {
  const btn = $("#btn-compartir");
  btn.disabled = true;
  try {
    const text = ganado ? textoCompartir() : textoDesafio();
    const url = urlJuego();
    if (esDispositivoTactil() && puedeUsarWebShare()) {
      await compartirConImagen(text);
    } else {
      await copiarPortapapeles(`${text}\n${url}`);
    }
  } catch (e) {
    if (e.name !== "AbortError") mensaje("no se pudo compartir", "error");
  } finally {
    btn.disabled = false;
  }
}

async function esperarRepintado() {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

const ASPECTO_CAPTURA = 4 / 3;

function fondoCaptura() {
  return colorCss("--fondo") || "#111111";
}

async function ajustarAspecto43(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width: w, height: h } = bitmap;
    const ratio = w / h;
    if (Math.abs(ratio - ASPECTO_CAPTURA) < 0.001) return blob;

    let canvasW = w;
    let canvasH = h;
    if (ratio > ASPECTO_CAPTURA) {
      canvasH = Math.ceil(w / ASPECTO_CAPTURA);
    } else {
      canvasW = Math.ceil(h * ASPECTO_CAPTURA);
    }

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = fondoCaptura();
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.drawImage(bitmap, Math.floor((canvasW - w) / 2), Math.floor((canvasH - h) / 2));

    return await new Promise((resolve, reject) => {
      canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("toBlob falló"))), "image/png");
    });
  } finally {
    bitmap.close();
  }
}

async function superponerSorpresa(blob) {
  const [captura, sorpresa] = await Promise.all([
    createImageBitmap(blob),
    fetch("assets/surprised.png")
      .then((respuesta) => {
        if (!respuesta.ok) throw new Error("no se pudo cargar surprised.png");
        return respuesta.blob();
      })
      .then((imagen) => createImageBitmap(imagen)),
  ]);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = captura.width;
    canvas.height = captura.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(captura, 0, 0);
    ctx.drawImage(sorpresa, 0, 0, canvas.width, canvas.height);

    return await new Promise((resolve, reject) => {
      canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("toBlob falló"))), "image/png");
    });
  } finally {
    captura.close();
    sorpresa.close();
  }
}

async function capturarGrafo() {
  $("#panel").classList.add("oculto");

  const nodoOrigen = cy.getElementById(origen);
  const nodoDestino = cy.getElementById(destino);
  const posOrigen = ganado ? null : { ...nodoOrigen.position() };
  const posDestino = ganado ? null : { ...nodoDestino.position() };
  let elementosInterrogante = null;

  if (ganado) {
    cy.nodes().addClass("captura");
    cy.edges().addClass("captura");
    cy.fit(cy.nodes(), 40);
  } else {
    cy.nodes().difference(nodoOrigen.union(nodoDestino)).addClass("captura-oculto");
    cy.edges().addClass("captura-oculto");

    const separacionHorizontal = 110;
    const separacionVertical = 55;
    nodoOrigen.position({ x: -separacionHorizontal, y: -separacionVertical });
    nodoDestino.position({ x: separacionHorizontal, y: separacionVertical });

    elementosInterrogante = cy.add([
      {
        data: { id: "captura-interrogante" },
        position: { x: 0, y: 0 },
        classes: "captura-interrogante",
      },
      {
        data: {
          id: "captura-interrogante-origen",
          source: origen,
          target: "captura-interrogante",
        },
        classes: "captura-interrogante",
      },
      {
        data: {
          id: "captura-interrogante-destino",
          source: "captura-interrogante",
          target: destino,
        },
        classes: "captura-interrogante",
      },
    ]);

    cy.fit(nodoOrigen.union(nodoDestino).union(elementosInterrogante), 40);
  }

  await esperarRepintado();
  try {
    const blob = await cy.png({
      output: "blob-promise",
      bg: fondoCaptura(),
      full: true,
      scale: 2,
    });
    const captura43 = await ajustarAspecto43(blob);
    return ganado ? captura43 : await superponerSorpresa(captura43);
  } finally {
    if (elementosInterrogante) elementosInterrogante.remove();
    cy.nodes().removeClass("captura captura-oculto");
    cy.edges().removeClass("captura captura-oculto");
    if (posOrigen) nodoOrigen.position(posOrigen);
    if (posDestino) nodoDestino.position(posDestino);
  }
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
    if (!cy) return;
    const w = contenedor.clientWidth;
    const h = contenedor.clientHeight;
    if (w === ultimoAncho && h === ultimoAlto) return;
    ultimoAncho = w;
    ultimoAlto = h;
    cy.stop();
    cy.resize();
    asegurarNodosVisibles({ animar: false });
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
    guardarDificultad();
    actualizarUmbralInfo();
    if (listo && origen && destino) await limpiarTablero();
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
    guardarRae();
    actualizarRaeInfo();
  });

  $("#switch-hint").addEventListener("change", (e) => {
    hintVisible = e.target.checked;
    guardarHint();
    actualizarHintInfo();
  });

  $("#switch-tema").addEventListener("change", (e) => {
    temaClaro = e.target.checked;
    guardarTema();
    aplicarTema();
    actualizarTemaInfo();
    aplicarEstilosGrafo();
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
  $("#btn-compartir").addEventListener("click", () => void compartir());
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
    guardarAyudaVista();
    abrirAyuda("jugar");
  }

  $("#modal-final-cerrar").addEventListener("click", cerrarModalFinal);
  modalFinal.querySelector("[data-cerrar-final]").addEventListener("click", cerrarModalFinal);
  $("#modal-final-compartir").addEventListener("click", () => void compartir());

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
