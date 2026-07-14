// Tejepalabras — juego en el navegador (sin backend).
// Modelo ONNX en Hugging Face; ortografía con diccionario_es.txt.

import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3";

const MODELO_ID = "jotaah/tejepalabras-onnx";
const UMBRAL = 43.5;
const SIM_OBJETIVO_MIN = 20;
const SIM_OBJETIVO_MAX = 25;

const GRADO_MAX = 10; // los enlaces "se rompen" si un nodo acumula demasiados

let palabrasPool = [];     // palabras del diccionario para elegir objetivos al azar
let extra = {};            // similitudes calculadas por el modelo: extra[a][b] = %
let origen = null;
let destino = null;
let enTablero = new Set();
let cy = null;
let ganado = false;

const MODO_DIARIO = "diario";
const MODO_PRACTICA = "practica";
let modo = MODO_DIARIO;

// PRNG determinístico (mulberry32) sembrado con la fecha de hoy: mismo
// resultado para todo el mundo el mismo día, sin backend ni build extra.
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

function rngDelDia() {
  return mulberry32(seedDesdeTexto(fechaHoyStr()));
}

let extractor = null;
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

async function cargarDiccionario() {
  const txt = await (await fetch("diccionario_es.txt", { cache: "no-store" })).text();
  diccionario = new Set();
  for (const linea of txt.split("\n")) {
    const p = norm(linea);
    if (p) diccionario.add(p);
  }
  palabrasPool = [...diccionario];
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

async function cargarModelo() {
  extractor = await pipeline("feature-extraction", MODELO_ID);
}

async function embedding(palabra) {
  if (cacheEmb.has(palabra)) return cacheEmb.get(palabra);
  const salida = await extractor(palabra, { pooling: "mean", normalize: true });
  const vec = salida.data;
  cacheEmb.set(palabra, vec);
  return vec;
}

function producto(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function iniciar() {
  await cargarDiccionario();
  $("#umbral-info").textContent = `Enlace mínimo: ${UMBRAL}% de similitud`;
  crearCytoscape();
  registrarEventos();
  bloquearEntrada(true);
  mensaje("cargando modelo… (solo la primera vez)");
  try {
    await cargarModelo();
  } catch (e) {
    return mensaje("no se pudo cargar el modelo", "error");
  }
  bloquearEntrada(false);
  await nuevoJuego(true);
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
  const embA = await embedding(a);
  const embB = await embedding(b);
  const s = Math.round(producto(embA, embB) * 100);
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

function crearCytoscape() {
  cy = cytoscape({
    container: $("#grafo"),
    minZoom: 0.3,
    maxZoom: 1.5,
    style: [
      {
        selector: "node",
        style: {
          label: "data(id)",
          "font-family": "system-ui, sans-serif",
          "font-size": 14,
          color: "#eee",
          "text-valign": "center",
          "text-halign": "center",
          width: "label",
          height: 32,
          padding: 8,
          shape: "round-rectangle",
          "background-color": "#1a1a1a",
          "border-width": 1,
          "border-color": "#444",
        },
      },
      {
        selector: "node.objetivo",
        style: {
          "border-color": "#ccc",
          "border-width": 2,
          "font-weight": 700,
        },
      },
      {
        selector: "node.aislado",
        style: {
          "border-color": "#8a1c36",
          "border-width": 2,
        },
      },
      {
        selector: "edge",
        style: {
          width: "data(peso)",
          "line-color": "#333",
          "curve-style": "bezier",
          label: "data(etiqueta)",
          "font-size": 9,
          color: "#666",
          "text-background-color": "#111",
          "text-background-opacity": 1,
          "text-background-padding": 2,
        },
      },
      {
        selector: "edge.ruta",
        style: { "line-color": "#3dd68c", color: "#3dd68c" },
      },
      {
        selector: "node.conectado",
        style: { "border-color": "#3dd68c", "border-width": 2 },
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
          "background-color": "#444",
        },
      },
      {
        selector: "node.captura.objetivo",
        style: {
          label: "data(id)",
          "text-opacity": 1,
          color: "#111",
          "font-weight": 700,
          width: "label",
          height: 32,
          padding: 8,
          "background-color": "#ccc",
        },
      },
      {
        selector: "node.captura.conectado",
        style: { "background-color": "#3dd68c" },
      },
      {
        selector: "node.captura.aislado",
        style: { "background-color": "#8a1c36" },
      },
      {
        selector: "edge.captura",
        style: { label: "", "text-opacity": 0 },
      },
    ],
  });

  cy.on("tap", "node", (e) => void mostrarPanel(e.target.id()));
  cy.on("tap", (e) => {
    if (e.target === cy) $("#panel").classList.add("oculto");
  });
}

async function nuevoJuego(diario = false) {
  if (!extractor) return;
  ganado = false;
  extra = {};
  modo = diario ? MODO_DIARIO : MODO_PRACTICA;
  $("#panel").classList.add("oculto");
  ocultarCompartir();
  bloquearEntrada(false);
  mensaje("preparando partida…");
  const rng = diario ? rngDelDia() : Math.random;
  [origen, destino] = await elegirObjetivos(rng);
  enTablero = new Set([origen, destino]);
  $("#origen").textContent = origen;
  $("#destino").textContent = destino;
  cy.elements().remove();
  cy.add([
    { data: { id: origen }, classes: "objetivo" },
    { data: { id: destino }, classes: "objetivo" },
  ]);
  await reconstruir();
  ejecutarLayout();
  actualizarEtiquetaModo();
  mensaje("");
  $("#entrada").focus();
}

function actualizarEtiquetaModo() {
  const el = $("#modo-info");
  if (!el) return;
  if (modo === MODO_DIARIO) {
    const texto = new Date().toLocaleDateString("es", { day: "numeric", month: "long" });
    el.textContent = `Reto del día · ${texto}`;
  } else {
    el.textContent = "Modo práctica (aleatorio)";
  }
}

async function elegirObjetivos(rng = Math.random) {
  for (let intento = 0; intento < 500; intento++) {
    const a = palabrasPool[(rng() * palabrasPool.length) | 0];
    const b = palabrasPool[(rng() * palabrasPool.length) | 0];
    if (a === b) continue;
    const s = await asegurarSim(a, b);
    if (s >= SIM_OBJETIVO_MIN && s <= SIM_OBJETIVO_MAX) return [a, b];
  }
  return [palabrasPool[0], palabrasPool[palabrasPool.length - 1]];
}

function calcularAristas() {
  const nodos = [...enTablero];
  const candidatas = [];
  for (let i = 0; i < nodos.length; i++) {
    for (let j = i + 1; j < nodos.length; j++) {
      const s = sim(nodos[i], nodos[j]);
      if (s > UMBRAL) candidatas.push({ a: nodos[i], b: nodos[j], s });
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
        peso: 1 + (c.s - UMBRAL) / 12,
        etiqueta: `${c.s}%`,
      },
    });
  });

  actualizarEstado(aristas);
  marcarAislados();
  return aristas;
}

function marcarAislados() {
  cy.nodes().forEach((n) => {
    if (n.degree() === 0) n.addClass("aislado");
    else n.removeClass("aislado");
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
  const padre = {};
  const find = (x) => (padre[x] === x ? x : (padre[x] = find(padre[x])));
  [...enTablero].forEach((n) => (padre[n] = n));
  aristas.forEach((c) => (padre[find(c.a)] = find(c.b)));
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

function ganar(aristas) {
  ganado = true;
  marcarRuta(caminoMasCorto(aristas));
  const usadas = enTablero.size - 2;
  mensaje(`conectado con ${usadas} palabra${usadas === 1 ? "" : "s"} puente`, "ok");
  bloquearEntrada(true);
  if (puedeMostrarCompartir()) mostrarCompartir();
}

function puedeMostrarCompartir() {
  return (
    window.isSecureContext &&
    matchMedia("(pointer: coarse)").matches &&
    typeof navigator.share === "function"
  );
}

function mostrarCompartir() {
  $("#btn-compartir")?.classList.remove("oculto");
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

  mensaje("calculando…");
  try {
    const embP = await embedding(p);
    for (const w of enTablero) {
      if (w === p) continue;
      const s = producto(embP, await embedding(w));
      guardarSim(p, w, Math.round(s * 100));
    }
  } catch (e) {
    return mensaje("error al calcular la similitud", "error");
  }
  await colocar(p);
}

async function colocar(p) {
  $("#panel").classList.add("oculto");
  const conecta = [...enTablero].some((n) => sim(n, p) > UMBRAL);
  enTablero.add(p);
  cy.add({ data: { id: p } });
  const aristas = await reconstruir();
  colocarNodoNuevo(p, aristas);
  asegurarNodosVisibles();

  if (ganado) return;
  if (conecta) mensaje(`“${p}” conectada`, "ok");
  else mensaje(`“${p}” sin enlaces todavía`);
}

async function mostrarPanel(palabra) {
  mensaje("calculando…");
  for (const n of enTablero) {
    if (n !== palabra) await asegurarSim(palabra, n);
  }
  mensaje("");

  $("#panel").classList.remove("oculto");
  $("#panel-titulo").textContent = palabra;
  const rae = $("#panel-rae");
  rae.href = `https://dle.rae.es/${encodeURIComponent(palabra)}`;
  rae.title = `Ver “${palabra}” en la RAE`;
  rae.setAttribute("aria-label", `Ver definición de “${palabra}” en la RAE`);
  const otras = [...enTablero]
    .filter((n) => n !== palabra)
    .map((n) => ({ n, s: sim(n, palabra) }))
    .sort((a, b) => b.s - a.s);
  $("#panel-lista").innerHTML = otras
    .map(
      (o) =>
        `<li class="${o.s > UMBRAL ? "conecta" : ""}"><span>${o.n}</span><span>${o.s}%</span></li>`
    )
    .join("");
}

function mensajeSugerencia(palabra, sugerencias) {
  const el = $("#mensaje");
  el.className = "mensaje error";
  el.innerHTML = `“${palabra}” no es una palabra correcta.`;
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

function urlJuego() {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  return u.href.replace(/\/$/, "") || u.origin;
}

function ocultarCompartir() {
  $("#btn-compartir")?.classList.add("oculto");
}

async function esperarRepintado() {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

async function capturarGrafo() {
  $("#panel").classList.add("oculto");
  cy.nodes().addClass("captura");
  cy.edges().addClass("captura");
  cy.fit(cy.nodes(), 40);
  await esperarRepintado();
  try {
    return await cy.png({
      output: "blob-promise",
      bg: "#111111",
      full: true,
      scale: 2,
    });
  } finally {
    cy.nodes().removeClass("captura");
    cy.edges().removeClass("captura");
  }
}

function textoCompartir() {
  const usadas = enTablero.size - 2;
  let etiqueta = "";
  if (modo === MODO_DIARIO) {
    const [y, m, d] = fechaHoyStr().split("-");
    etiqueta = ` (${d}/${m}/${y})`;
  }
  return `Conecté '${origen}' con '${destino}'${etiqueta} en Tejepalabras con ${usadas} palabra${usadas === 1 ? "" : "s"}.`;
}

async function compartirVictoria() {
  if (!ganado || !puedeMostrarCompartir()) return;
  const btn = $("#btn-compartir");
  btn.disabled = true;
  try {
    const blob = await capturarGrafo();
    const file = new File([blob], "tejepalabras.png", { type: "image/png" });
    const url = urlJuego();
    const text = `${textoCompartir()}\n${url}`;
    const conArchivo = { files: [file], title: "Tejepalabras", text };
    if (navigator.canShare?.(conArchivo)) {
      await navigator.share(conArchivo);
    } else {
      await navigator.share({ title: "Tejepalabras", text, url });
    }
  } catch (e) {
    if (e.name !== "AbortError") mensaje("no se pudo compartir", "error");
  } finally {
    btn.disabled = false;
  }
}

function registrarViewport() {
  const entrada = $("#entrada");
  const contenedor = $("#grafo");
  const esTactil = matchMedia("(pointer: coarse)").matches;
  let debounceTimer = null;
  let ultimoAncho = 0;
  let ultimoAlto = 0;

  function syncAltura() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.body.style.height = `${Math.round(h)}px`;
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
    visualViewport.addEventListener("resize", syncAltura);
    visualViewport.addEventListener("scroll", syncAltura);
  }
  syncAltura();

  if (esTactil) {
    entrada.addEventListener("focus", () => {
      document.body.classList.add("entrada-activa");
      syncAltura();
    });
    entrada.addEventListener("blur", () => {
      document.body.classList.remove("entrada-activa");
      syncAltura();
    });
  }
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
  $("#btn-nuevo").addEventListener("click", () => nuevoJuego(false));
  $("#btn-compartir").addEventListener("click", () => void compartirVictoria());
  $("#panel-cerrar").addEventListener("click", () =>
    $("#panel").classList.add("oculto")
  );

  const ayuda = $("#ayuda");
  const abrirAyuda = () => ayuda.classList.remove("oculto");
  const cerrarAyuda = () => ayuda.classList.add("oculto");
  $("#btn-ayuda").addEventListener("click", abrirAyuda);
  $("#ayuda-cerrar").addEventListener("click", cerrarAyuda);
  ayuda.querySelector("[data-cerrar-ayuda]").addEventListener("click", cerrarAyuda);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ayuda.classList.contains("oculto")) cerrarAyuda();
  });
}

iniciar();
