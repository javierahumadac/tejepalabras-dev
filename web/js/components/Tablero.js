// Tablero Cytoscape + cola

import { SimilitudService } from "../services/SimilitudService.js";
import { Theme } from "../utils/Theme.js";

const LONGITUD_ARISTA = 100;
const POS_ORIGEN = { x: -220, y: -100 };
const POS_DESTINO = { x: 220, y: 100 };
const POS_ORIGEN_MOVIL = { x: -180, y: -180 };
const POS_DESTINO_MOVIL = { x: 180, y: 180 };

// Opciones de cytoscape-cola
const COLA = {
  name: "cola",
  animate: true, // whether to show the layout as it's running
  refresh: 1, // number of ticks per frame; higher is faster but more jerky
  maxSimulationTime: 4000, // max length in ms to run the layout
  ungrabifyWhileSimulating: false, // so you can't drag nodes during layout
  fit: false, // on every layout reposition of nodes, fit the viewport
  padding: 60, // padding around the simulation
  nodeDimensionsIncludeLabels: true, // whether labels should be included in determining the space used by a node
  infinite: true, // overrides all other options for continuous mode

  // positioning options
  randomize: false, // use random node positions at beginning of layout
  avoidOverlap: true, // if true, prevents overlap of node bounding boxes
  handleDisconnected: true, // if true, avoids disconnected components from overlapping
  convergenceThreshold: 0.01, // when the alpha value (system energy) falls below this value, the layout stops
  // Extra alrededor del nodo: más aire si tiene al menos un enlace
  nodeSpacing: (nodo) => (nodo.connectedEdges().nonempty() ? 25 : 0),
  flow: undefined, // use DAG/tree flow layout if specified, e.g. { axis: 'y', minSeparation: 30 }
  alignment: undefined, // relative alignment constraints on nodes
  gapInequalities: undefined, // list of inequality constraints for the gap between the nodes
  centerGraph: false, // adjusts the node positions initially to center the graph

  // different methods of specifying edge length
  edgeLength: LONGITUD_ARISTA, // sets edge length directly in simulation
  edgeSymDiffLength: undefined, // symmetric diff edge length in simulation
  edgeJaccardLength: undefined, // jaccard edge length in simulation

  // iterations of cola algorithm; uses default values on undefined
  unconstrIter: undefined, // unconstrained initial layout iterations
  userConstIter: undefined, // initial layout iterations with user-specified constraints
  allConstIter: undefined, // initial layout iterations with all constraints including non-overlap
};

let cy = null;
let palabras = new Set();
let layout = null;

let getUmbral = () => 0;
let getOrigen = () => null;
let getDestino = () => null;
let onAristas = () => {};
let onTapNodo = () => {};
let onTapFondo = () => {};

const ANCHO_MOVIL = 520;

function esMovil() {
  if (typeof window === "undefined") return false;
  const ladoMenor = Math.min(window.innerWidth, window.innerHeight);
  return ladoMenor < ANCHO_MOVIL;
}

function getEstilos() {
  const colores = Theme.colores();
  const movil = esMovil();
  return [
    { // Apariencia base de nodos
      selector: "node",
      style: {
        label: "data(id)",
        "font-family": "system-ui, sans-serif",
        "font-size": 16,
        color: colores.texto,
        "text-valign": "center",
        "text-halign": "center",
        width: "label",
        height: 20,
        padding: movil ? 10 : 8,
        shape: "round-rectangle",
        "corner-radius": 2,
        "background-color": colores.superficie,
        "border-width": 1,
        "border-color": colores.bordeFuerte,
        "overlay-opacity": 0,
        "overlay-padding": 0,
      },
    },
    { // Origen / destino 
      selector: "node.objetivo",
      style: {
        "border-color": colores.textoSecundario,
        "border-width": 2,
        "font-weight": 700,
        "font-size": 18,
        height: 22
      },
    },
    { // Nodo fuera de la red de origen/destino
      selector: "node.aislado",
      style: {
        "border-color": colores.acentoOscuro,
        "border-width": 2,
      },
    },
    { // Apariencia base de cualquier arista (enlace por similitud)
      selector: "edge",
      style: {
        width: "data(peso)",
        "line-color": colores.borde,
        "curve-style": "straight",
        "font-size": 9,
        color: colores.textoDebil,
        "text-background-color": colores.fondo,
        "text-background-opacity": 1,
        "text-background-padding": 2,
      },
    },
    { // Arista de la ruta ganadora
      selector: "edge.ruta",
      style: { "line-color": colores.exito, color: colores.exito },
    },
    { // Nodo que forma parte de la ruta ganadora
      selector: "node.conectado",
      style: { "border-color": colores.exito, "border-width": 2 },
    },
  ];
}

function getPadding() {
  return esMovil() ? 28 : 60;
}

function detenerLayout() {
  if (!layout) return;
  try {
    layout.stop();
  } catch (_) {
    /* ya detenido */
  }
  layout = null;
}

function calcularAristas() {
  const nodos = [...palabras];
  const umbral = getUmbral();
  const candidatas = [];

  for (let i = 0; i < nodos.length; i++) {
    for (let j = i + 1; j < nodos.length; j++) {
      const similitud = SimilitudService.obtenerSimilitud(nodos[i], nodos[j]);
      if (similitud > umbral) candidatas.push({ a: nodos[i], b: nodos[j], s: similitud });
    }
  }
  candidatas.sort((x, y) => y.s - x.s);
  return candidatas;
}

export class Tablero {
  static getCy() {
    return cy;
  }

  static getPalabras() {
    return palabras;
  }

  static configurar({
    umbral,
    origen,
    destino,
    alCambiarAristas,
    alTocarNodo,
    alTocarFondo,
  } = {}) {
    if (umbral) getUmbral = umbral;
    if (origen) getOrigen = origen;
    if (destino) getDestino = destino;
    if (alCambiarAristas) onAristas = alCambiarAristas;
    if (alTocarNodo) onTapNodo = alTocarNodo;
    if (alTocarFondo) onTapFondo = alTocarFondo;
  }

  static crear(contenedor) {
    cy = cytoscape({
      container: contenedor,
      minZoom: 0.3,
      maxZoom: 1.5,
      wheelSensitivity: 0.1,
      boxSelectionEnabled: false,
      autounselectify: true,
      style: getEstilos(),
    });

    cy.on("tap", "node", (e) => void onTapNodo(e.target.id()));
    cy.on("tap", (e) => {
      if (e.target === cy) onTapFondo();
    });
  }

  static aplicarEstilos() {
    if (!cy) return;
    cy.style().fromJson(getEstilos()).update();
  }

  static tiene(palabra) {
    return palabras.has(palabra);
  }

  static vaciar() {
    detenerLayout();
    palabras = new Set();
    cy?.elements().remove();
  }

  static resetearObjetivos(origen, destino) {
    detenerLayout();
    palabras = new Set();
    cy.elements().remove();
    Tablero.insertar(origen, { objetivo: true });
    Tablero.insertar(destino, { objetivo: true });
  }

  /** Inserta una palabra en el grafo. `posicion` opcional: `{ x, y }`. */
  static insertar(palabra, { objetivo = false, posicion = null } = {}) {
    palabras.add(palabra);
    cy.add({
      data: { id: palabra },
      ...(objetivo ? { classes: "objetivo" } : {}),
    });
    const nodo = cy.getElementById(palabra);

    if (posicion) {
      nodo.position(posicion);
    } else if (palabra === getOrigen()) {
      nodo.position(esMovil() ? POS_ORIGEN_MOVIL : POS_ORIGEN);
    } else if (palabra === getDestino()) {
      nodo.position(esMovil() ? POS_DESTINO_MOVIL : POS_DESTINO);
    } else {
      const jitter = LONGITUD_ARISTA * 0.35;
      const angulo = Math.random() * Math.PI * 2;
      nodo.position({
        x: Math.cos(angulo) * jitter,
        y: Math.sin(angulo) * jitter,
      });
    }
  }

  /** Agrupa palabras conectadas por aristas. Devuelve `find(palabra)` → id del grupo. */
  static agruparConectadas(aristas) {
    const padre = {};

    for (const palabra of palabras) {
      padre[palabra] = palabra;
    }

    function find(palabra) {
      if (padre[palabra] !== palabra) {
        padre[palabra] = find(padre[palabra]); // comprime el camino
      }
      return padre[palabra];
    }

    function unir(a, b) {
      const grupoA = find(a);
      const grupoB = find(b);
      if (grupoA !== grupoB) padre[grupoA] = grupoB;
    }

    for (const arista of aristas) {
      unir(arista.a, arista.b);
    }

    return find;
  }

  static marcarAislados(aristas) {
    const origen = getOrigen();
    const destino = getDestino();
    const find = Tablero.agruparConectadas(aristas);
    const compOrigen = find(origen);
    const compDestino = find(destino);

    cy.nodes().forEach((nodo) => {
      const id = nodo.id();
      const enRed =
        id === origen ||
        id === destino ||
        find(id) === compOrigen ||
        find(id) === compDestino;
      nodo.toggleClass("aislado", !enRed);
    });
  }

  static async reconstruir() {
    await SimilitudService.asegurarSimilitudesEntrePares([...palabras]);
    cy.edges().remove();

    const umbral = getUmbral();
    const aristas = calcularAristas();
    aristas.forEach((c) => {
      cy.add({
        data: {
          id: `${c.a}__${c.b}`,
          source: c.a,
          target: c.b,
          peso: 1 + (c.s - umbral) / 12,
          etiqueta: `${c.s}%`,
        },
      });
    });

    onAristas(aristas);
    Tablero.marcarAislados(aristas);
    return aristas;
  }

  static marcarRuta(nodos = []) {
    cy.nodes().removeClass("conectado");
    cy.edges().removeClass("ruta");
    if (!nodos.length) return;

    nodos.forEach((id) => cy.getElementById(id).addClass("conectado"));
    for (let i = 0; i < nodos.length - 1; i++) {
      const a = nodos[i];
      const b = nodos[i + 1];
      const arista = cy.getElementById(`${a}__${b}`).nonempty()
        ? cy.getElementById(`${a}__${b}`)
        : cy.getElementById(`${b}__${a}`);
      if (arista.nonempty()) arista.addClass("ruta");
    }
  }

  static detener() {
    detenerLayout();
  }

  /** Bloquea/desbloquea nodos para que cola no los mueva (captura/share). */
  static bloquearNodos(bloquear = true) {
    if (!cy) return;
    if (bloquear) cy.nodes().lock();
    else cy.nodes().unlock();
  }

  /** Arranca (o reinicia) la física cola infinita y encuadra el grafo. */
  static posicionar() {
    if (!cy || cy.nodes().empty()) return;

    detenerLayout();
    cy.nodes().unlock();
    layout = cy.layout({
      ...COLA,
      padding: getPadding(),
    });
    layout.run();
    cy.fit(cy.nodes(), getPadding());
  }

  static resize() {
    if (!cy) return;
    cy.resize();
    if (cy.nodes().length) cy.fit(cy.nodes(), getPadding());
  }
}
