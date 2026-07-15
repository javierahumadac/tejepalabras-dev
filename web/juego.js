// Tejepalabras — juego en el navegador (sin backend).
// Vocabulario y similitud: diccionario_es.vocab + embeddings.bin (word2vec SBWC).

// Retocado para word2vec SBWC (pares aleatorios ~p95≈33%; sinónimos 60–80%).
const UMBRAL = 39.5;
const SIM_OBJETIVO_MIN = 5;
const SIM_OBJETIVO_MAX = 10;

const GRADO_MAX = 10; // los enlaces "se rompen" si un nodo acumula demasiados

let palabrasPool = [];     // palabras con vector para elegir objetivos al azar
let extra = {};            // similitudes: extra[a][b] = %
let origen = null;
let destino = null;
let enTablero = new Set();
let cy = null;
let ganado = false;
let ultimoPuntaje = null;
let listo = false;

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

function fechaHoyCorta() {
  const [y, m, d] = fechaHoyStr().split("-");
  return `${d}/${m}/${y}`;
}

function rngDelDia() {
  return mulberry32(seedDesdeTexto(fechaHoyStr()));
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
  const [vocabTxt, buf] = await Promise.all([
    (await fetch(meta.vocab_file || "diccionario_es.vocab", { cache: "no-store" })).text(),
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
  palabrasPool = palabras;
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
  let texto = `Enlace mínimo: ${UMBRAL}% de similitud.`;
  const n = enTablero.size - 2;
  if (n > 0) texto += `<br>Actualmente hay ${n} palabra${n === 1 ? "" : "s"} en el tablero.`;
  $("#umbral-info").innerHTML = texto;
}

async function iniciar() {
  actualizarUmbralInfo();
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

async function nuevoJuego(diario = false, par = null) {
  if (!listo) return;
  ganado = false;
  ultimoPuntaje = null;
  extra = {};
  modo = diario ? MODO_DIARIO : MODO_PRACTICA;
  $("#panel").classList.add("oculto");
  $("#modal-final").classList.add("oculto");
  bloquearEntrada(false);
  mensaje("preparando partida…");
  if (par) {
    [origen, destino] = par;
  } else {
    const rng = diario ? rngDelDia() : Math.random;
    [origen, destino] = await elegirObjetivos(rng);
  }
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
  actualizarMenuModos();
  actualizarUrl();
  mensaje("");
  $("#entrada").focus();
}

function actualizarMenuModos() {
  const fechaEl = $("#menu-fecha-diario");
  if (fechaEl) fechaEl.textContent = fechaHoyCorta();
  document.querySelectorAll(".menu-modo-opcion").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  actualizarUmbralInfo();
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

/**
 * Un nodo está "aislado" (en rojo) si no pertenece a la red de origen ni a
 * la de destino, aunque esté enlazado a otras palabras sueltas.
 */
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

function mostrarResultado({ verdes, grises, sueltos, puntaje }) {
  ultimoPuntaje = puntaje;
  $("#puntaje-total").textContent = puntaje;
  $("#puntaje-verdes-cant").textContent = verdes;
  $("#puntaje-verdes-total").textContent = verdes * PUNTOS_VERDE;
  $("#puntaje-grises-cant").textContent = grises;
  $("#puntaje-grises-total").textContent = grises * PUNTOS_GRIS;
  $("#puntaje-sueltos-cant").textContent = sueltos;
  $("#puntaje-sueltos-total").textContent = sueltos * PUNTOS_ROJO;
  $("#modal-final").classList.remove("oculto");
}

function ganar(aristas) {
  ganado = true;
  const ruta = caminoMasCorto(aristas);
  marcarRuta(ruta);
  const usadas = enTablero.size - 2;
  mensaje(`conectado con ${usadas} palabra${usadas === 1 ? "" : "s"} puente`, "ok");
  bloquearEntrada(true);
  mostrarResultado(calcularPuntaje(aristas, ruta));
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
  asegurarNodosVisibles();

  if (ganado) return;
  mensaje("");
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

function actualizarUrl() {
  const u = new URL(location.href);
  u.hash = "";
  if (modo === MODO_PRACTICA && origen && destino) {
    u.searchParams.set("origen", origen);
    u.searchParams.set("destino", destino);
  } else {
    u.search = "";
  }
  const destinoUrl = `${u.pathname}${u.search}`;
  history.replaceState(null, "", destinoUrl || "/");
}

function urlJuego() {
  const u = new URL(location.href);
  u.hash = "";
  if (modo === MODO_PRACTICA && origen && destino) {
    u.searchParams.set("origen", origen);
    u.searchParams.set("destino", destino);
  } else {
    u.search = "";
  }
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
  return `Conecté '${origen}' con '${destino}'${etiquetaFecha()} en Tejepalabras con ${puntos} punto${puntos === 1 ? "" : "s"}.`;
}

async function copiarPortapapeles(texto) {
  await navigator.clipboard.writeText(texto);
  mensaje("copiado al portapapeles", "ok");
}

async function compartirTextoUrl(texto) {
  const url = urlJuego();
  if (esDispositivoTactil() && puedeUsarWebShare()) {
    await navigator.share({ title: "Tejepalabras", text: texto, url });
  } else {
    await copiarPortapapeles(`${texto}\n${url}`);
  }
}

async function compartirVictoriaTactil() {
  const url = urlJuego();
  const text = textoCompartir();
  const blob = await capturarGrafo();
  const file = new File([blob], "tejepalabras.png", { type: "image/png" });
  const conArchivo = { files: [file], title: "Tejepalabras", text, url };
  if (navigator.canShare?.(conArchivo)) {
    await navigator.share(conArchivo);
  } else {
    await navigator.share({ title: "Tejepalabras", text, url });
  }
}

async function compartir() {
  const btn = $("#btn-compartir");
  btn.disabled = true;
  try {
    if (ganado) {
      const url = urlJuego();
      const text = textoCompartir();
      if (esDispositivoTactil() && puedeUsarWebShare()) {
        await compartirVictoriaTactil();
      } else {
        await copiarPortapapeles(`${text}\n${url}`);
      }
    } else {
      await compartirTextoUrl(textoDesafio());
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
      } else if (elegido !== modo) {
        await nuevoJuego(true);
      }
    });
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
  $("#panel-cerrar").addEventListener("click", () =>
    $("#panel").classList.add("oculto")
  );

  const ayuda = $("#ayuda");
  const menuModos = $("#menu-modos");
  const modalFinal = $("#modal-final");
  const abrirAyuda = () => ayuda.classList.remove("oculto");
  const cerrarAyuda = () => ayuda.classList.add("oculto");
  const cerrarMenuModos = () => menuModos.classList.add("oculto");
  const cerrarModalFinal = () => modalFinal.classList.add("oculto");
  $("#btn-ayuda").addEventListener("click", abrirAyuda);
  $("#ayuda-cerrar").addEventListener("click", cerrarAyuda);
  ayuda.querySelector("[data-cerrar-ayuda]").addEventListener("click", cerrarAyuda);

  $("#modal-final-cerrar").addEventListener("click", cerrarModalFinal);
  modalFinal.querySelector("[data-cerrar-final]").addEventListener("click", cerrarModalFinal);
  $("#modal-final-compartir").addEventListener("click", () => void compartir());

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!menuModos.classList.contains("oculto")) cerrarMenuModos();
    else if (!ayuda.classList.contains("oculto")) cerrarAyuda();
    else if (!modalFinal.classList.contains("oculto")) cerrarModalFinal();
  });
}

iniciar();
