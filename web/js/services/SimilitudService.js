// Embeddings, diccionario y cálculo de similitudes (coseno %)

// Constantes
const SIMILITUD_OBJETIVO_MAXIMA = 5;
const MINIMO_PALABRAS_PUENTE = 5;
const UMBRAL_SIMILITUD_PUENTES = 50;
const MAX_INTENTOS_ELEGIR_OBJETIVOS = 1000;
const SIMILITUD_DESCONOCIDA = -100;

// Estado del servicio
const cacheEmbeddings = new Map();
let diccionario = new Set();
let palabrasDelPool = [];
/** Cache de similitudes entre pares: { palabraA: { palabraB: porcentaje } } */
let cacheSimilitudes = {};
let datosCargados = false;

function normalizarTexto(texto) {
  return texto.trim().toLowerCase().normalize("NFC");
}

/** Normaliza el vector in-place a norma L2 unitaria. */
function normalizarVectorL2(vector) {
  let sumaCuadrados = 0;
  for (let i = 0; i < vector.length; i++) sumaCuadrados += vector[i] * vector[i];
  const norma = Math.sqrt(sumaCuadrados) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= norma;
  return vector;
}

function productoPunto(vectorA, vectorB) {
  let suma = 0;
  for (let i = 0; i < vectorA.length; i++) suma += vectorA[i] * vectorB[i];
  return suma;
}

function distanciaLevenshtein(textoA, textoB, distanciaMaxima = 2) {
  if (textoA === textoB) return 0;
  if (Math.abs(textoA.length - textoB.length) > distanciaMaxima) return distanciaMaxima + 1;

  const filaAnterior = new Array(textoB.length + 1);
  const filaActual = new Array(textoB.length + 1);
  for (let j = 0; j <= textoB.length; j++) filaAnterior[j] = j;

  for (let i = 1; i <= textoA.length; i++) {
    filaActual[0] = i;
    let minimoEnFila = filaActual[0];
    for (let j = 1; j <= textoB.length; j++) {
      const costoSustitucion = textoA[i - 1] === textoB[j - 1] ? 0 : 1;
      filaActual[j] = Math.min(
        filaAnterior[j] + 1,
        filaActual[j - 1] + 1,
        filaAnterior[j - 1] + costoSustitucion
      );
      if (filaActual[j] < minimoEnFila) minimoEnFila = filaActual[j];
    }
    if (minimoEnFila > distanciaMaxima) return distanciaMaxima + 1;
    for (let j = 0; j <= textoB.length; j++) filaAnterior[j] = filaActual[j];
  }
  return filaAnterior[textoB.length];
}

export class SimilitudService {
  static get datosCargados() {
    return datosCargados;
  }

  /** Carga vocabulario, pool de palabras frecuentes y vectores cuantizados. */
  static async cargar() {
    const meta = await (await fetch("data/embeddings.json", { cache: "no-store" })).json();
    const [vocabularioTexto, poolTexto, bufferVectores] = await Promise.all([
      (await fetch(`data/${meta.vocab_file || "diccionario_es.vocab"}`, { cache: "no-store" })).text(),
      (await fetch("data/diccionario_es.pool", { cache: "no-store" })).text(),
      (await fetch(`data/${meta.vectors_file || "embeddings.bin"}`, { cache: "no-store" })).arrayBuffer(),
    ]);

    const palabrasVocabulario = [];
    for (const linea of vocabularioTexto.split("\n")) {
      const palabra = normalizarTexto(linea);
      if (palabra) palabrasVocabulario.push(palabra);
    }
    if (palabrasVocabulario.length !== meta.n) {
      throw new Error(`vocab (${palabrasVocabulario.length}) ≠ meta.n (${meta.n})`);
    }

    const cantidadEsperada = meta.n * meta.dim;
    const vectoresInt8 = new Int8Array(bufferVectores);
    if (vectoresInt8.length !== cantidadEsperada) {
      throw new Error(`bin (${vectoresInt8.length}) ≠ n*dim (${cantidadEsperada})`);
    }

    const escala = meta.scale;
    const dimensiones = meta.dim;
    diccionario = new Set();
    cacheEmbeddings.clear();
    for (let indice = 0; indice < meta.n; indice++) {
      const palabra = palabrasVocabulario[indice];
      const vector = new Float32Array(dimensiones);
      const offset = indice * dimensiones;
      for (let d = 0; d < dimensiones; d++) vector[d] = vectoresInt8[offset + d] * escala;
      normalizarVectorL2(vector);
      cacheEmbeddings.set(palabra, vector);
      diccionario.add(palabra);
    }

    // Origen/destino salen del pool
    palabrasDelPool = [];
    for (const linea of poolTexto.split("\n")) {
      const palabra = normalizarTexto(linea);
      if (palabra && cacheEmbeddings.has(palabra)) palabrasDelPool.push(palabra);
    }
    if (!palabrasDelPool.length) {
      throw new Error("pool vacío o sin solapamiento con el vocab");
    }

    datosCargados = true;
  }

  static existeEnDiccionario(palabra) {
    return diccionario.has(palabra);
  }

  static sugerenciasOrtograficas(palabra, maximo = 4) {
    const candidatas = [];
    const yaIncluidas = new Set();
    for (const palabraDiccionario of diccionario) {
      const distancia = distanciaLevenshtein(palabra, palabraDiccionario, 2);
      if (distancia > 0 && distancia <= 2) {
        candidatas.push({ palabra: palabraDiccionario, distancia });
      }
    }
    candidatas.sort(
      (a, b) => a.distancia - b.distancia || a.palabra.localeCompare(b.palabra)
    );
    const sugerencias = [];
    for (const { palabra: candidata } of candidatas) {
      if (!yaIncluidas.has(candidata)) {
        yaIncluidas.add(candidata);
        sugerencias.push(candidata);
        if (sugerencias.length >= maximo) break;
      }
    }
    return sugerencias;
  }

  static obtenerEmbedding(palabra) {
    const vector = cacheEmbeddings.get(palabra);
    if (!vector) throw new Error(`sin vector: ${palabra}`);
    return vector;
  }

  /** Coseno en % acotado a [0, 100] (los negativos del coseno no aportan al juego) */
  static similitudPorcentaje(embeddingA, embeddingB) {
    const coseno = productoPunto(embeddingA, embeddingB);
    return Math.round(Math.max(0, Math.min(1, coseno)) * 100);
  }

  /** Limpia la caché de pares calculados (nueva partida) */
  static limpiarCacheSimilitudes() {
    cacheSimilitudes = {};
  }

  static leerSimilitudCacheada(palabraA, palabraB) {
    if (cacheSimilitudes[palabraA] && cacheSimilitudes[palabraA][palabraB] != null) {
      return cacheSimilitudes[palabraA][palabraB];
    }
    if (cacheSimilitudes[palabraB] && cacheSimilitudes[palabraB][palabraA] != null) {
      return cacheSimilitudes[palabraB][palabraA];
    }
    return null;
  }

  /** Devuelve la similitud cacheada, o SIMILITUD_DESCONOCIDA si aún no se calculó */
  static obtenerSimilitud(palabraA, palabraB) {
    const cacheada = SimilitudService.leerSimilitudCacheada(palabraA, palabraB);
    return cacheada != null ? cacheada : SIMILITUD_DESCONOCIDA;
  }

  static guardarSimilitud(palabraA, palabraB, porcentaje) {
    (cacheSimilitudes[palabraA] = cacheSimilitudes[palabraA] || {})[palabraB] = porcentaje;
    (cacheSimilitudes[palabraB] = cacheSimilitudes[palabraB] || {})[palabraA] = porcentaje;
  }

  static async asegurarSimilitud(palabraA, palabraB) {
    const cacheada = SimilitudService.leerSimilitudCacheada(palabraA, palabraB);
    if (cacheada != null) return cacheada;
    const porcentaje = SimilitudService.similitudPorcentaje(
      SimilitudService.obtenerEmbedding(palabraA),
      SimilitudService.obtenerEmbedding(palabraB)
    );
    SimilitudService.guardarSimilitud(palabraA, palabraB, porcentaje);
    return porcentaje;
  }

  static async asegurarSimilitudesEntrePares(palabras) {
    for (let i = 0; i < palabras.length; i++) {
      for (let j = i + 1; j < palabras.length; j++) {
        await SimilitudService.asegurarSimilitud(palabras[i], palabras[j]);
      }
    }
  }

  static contarVecinosCercanos(palabra, minimoNecesario, umbral = UMBRAL_SIMILITUD_PUENTES) {
    const embeddingPalabra = SimilitudService.obtenerEmbedding(palabra);
    let cantidad = 0;
    const vecinos = [];
    for (const candidata of palabrasDelPool) {
      if (candidata === palabra) continue;
      const porcentaje = SimilitudService.similitudPorcentaje(
        embeddingPalabra,
        cacheEmbeddings.get(candidata)
      );
      if (porcentaje <= umbral) continue;
      cantidad++;
      vecinos.push({ palabra: candidata, sim: porcentaje });
      if (cantidad >= minimoNecesario) break;
    }
    return { cuenta: cantidad, vecinos };
  }

  static tieneSuficientesPuentes(palabraA, palabraB, minimo = MINIMO_PALABRAS_PUENTE) {
    const { cuenta: vecinosA } = SimilitudService.contarVecinosCercanos(palabraA, minimo);
    const { cuenta: vecinosB } = SimilitudService.contarVecinosCercanos(palabraB, minimo);
    return vecinosA >= minimo && vecinosB >= minimo;
  }

  /** Vecinos del pool ordenados por similitud (para pistas). */
  static vecinosParaPistas(palabra) {
    return SimilitudService.contarVecinosCercanos(palabra, MINIMO_PALABRAS_PUENTE).vecinos.sort(
      (a, b) => b.sim - a.sim
    );
  }

  static async elegirPalabrasObjetivo(rng = Math.random) {
    for (let intento = 0; intento < MAX_INTENTOS_ELEGIR_OBJETIVOS; intento++) {
      const origen = palabrasDelPool[(rng() * palabrasDelPool.length) | 0];
      const destino = palabrasDelPool[(rng() * palabrasDelPool.length) | 0];
      if (origen === destino) continue;
      const similitud = await SimilitudService.asegurarSimilitud(origen, destino);
      if (similitud > SIMILITUD_OBJETIVO_MAXIMA) continue;
      if (SimilitudService.tieneSuficientesPuentes(origen, destino)) return [origen, destino];
    }
    return [palabrasDelPool[0], palabrasDelPool[palabrasDelPool.length - 1]];
  }
}
