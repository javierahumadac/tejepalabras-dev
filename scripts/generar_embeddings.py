#!/usr/bin/env python3
"""Genera embeddings.bin/.json a partir de web/diccionario_es.vocab.

Fuente de vectores: Spanish Billion Word Corpus (SBWC) — Word2Vec skip-gram de
Cristian Cardellino (republicado en dccuchile/spanish-word-embeddings).
Licencia típica de esa redistribución: CC-BY-4.0.

  1. Lee web/diccionario_es.vocab
  2. Descarga (o reutiliza caché) SBW-vectors-300-min5.txt.bz2
  3. Busca coincidencia EXACTA de cada palabra en SBWC
  4. PCA a 64 dims + cuantiza a int8
  5. Reescribe web/diccionario_es.vocab (solo las que sí tienen vector) + .bin + .json

Al final siempre muestra los vecinos más cercanos de una muestra de palabras.

Uso:
  python3 scripts/generar_embeddings.py
"""

from __future__ import annotations

import bz2
import json
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
from sklearn.decomposition import PCA

RAIZ = Path(__file__).resolve().parents[1]
SALIDA_VOCAB = RAIZ / "web" / "diccionario_es.vocab"
SALIDA_JSON = RAIZ / "web" / "embeddings.json"
SALIDA_BIN = RAIZ / "web" / "embeddings.bin"
CACHE_DIR = RAIZ / "data"
CACHE_BZ2 = CACHE_DIR / "SBW-vectors-300-min5.txt.bz2"

URL_VECTORES = "https://cs.famaf.unc.edu.ar/~ccardellino/SBWCE/SBW-vectors-300-min5.txt.bz2"

DIMS = 64
VECINOS_EVAL = 3
MAX_PALABRAS_EVAL = 30


def norm(s: str) -> str:
    return unicodedata.normalize("NFC", s.strip().lower())


def cargar_palabras(path: Path) -> set[str]:
    if not path.exists():
        raise SystemExit(f"No existe {path}")
    palabras: set[str] = set()
    for linea in path.read_text(encoding="utf-8").splitlines():
        p = norm(linea)
        if p:
            palabras.add(p)
    if not palabras:
        raise SystemExit(f"{path} no tiene palabras")
    return palabras


def asegurar_descarga(destino: Path, url: str) -> None:
    if destino.exists() and destino.stat().st_size > 0:
        mb = destino.stat().st_size / (1024 * 1024)
        print(f"Usando caché {destino} ({mb:.1f} MB)")
        return
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".part")
    print(f"Descargando {url}")
    print(f"  → {tmp} (puede tardar: ~800 MB)")

    def progreso(bloque: int, tam_bloque: int, total: int) -> None:
        if total <= 0:
            return
        hecho = bloque * tam_bloque
        pct = min(100.0, 100.0 * hecho / total)
        if bloque % 200 == 0 or hecho >= total:
            print(f"\r  {pct:5.1f}%  ({hecho / 1e6:.0f}/{total / 1e6:.0f} MB)", end="", flush=True)

    urllib.request.urlretrieve(url, tmp, reporthook=progreso)
    print()
    tmp.replace(destino)
    print(f"Guardado en {destino}")


def extraer_vectores(path_bz2: Path, pedido: set[str]) -> tuple[list[str], np.ndarray]:
    """Coincidencia exacta palabra ↔ vector SBWC (sin remapear tildes)."""
    print(f"Buscando {len(pedido)} palabras en SBWC (coincidencia exacta)…")
    palabras: list[str] = []
    filas: list[np.ndarray] = []
    vistas = 0
    pendientes = set(pedido)
    dim = None

    with bz2.open(path_bz2, "rt", encoding="utf-8", errors="strict") as f:
        cabecera = f.readline().strip().split()
        if len(cabecera) != 2:
            raise ValueError(f"Cabecera word2vec inválida: {cabecera!r}")
        n_vocab, dim = int(cabecera[0]), int(cabecera[1])
        print(f"  vocabulario fuente: {n_vocab:,} × {dim}d")

        for linea in f:
            vistas += 1
            if not pendientes:
                break
            partes = linea.split()
            if len(partes) != dim + 1:
                continue
            w = norm(partes[0])
            if w not in pendientes:
                continue
            vec = np.fromiter((float(x) for x in partes[1:]), dtype=np.float32, count=dim)
            palabras.append(w)
            filas.append(vec)
            pendientes.discard(w)
            if len(palabras) % 5000 == 0:
                print(
                    f"\r  encontradas: {len(palabras):,}  (líneas leídas: {vistas:,})",
                    end="",
                    flush=True,
                )

    print(f"\r  encontradas: {len(palabras):,}  (líneas leídas: {vistas:,})")
    if not filas:
        raise RuntimeError("Ninguna de las palabras pedidas apareció en los vectores")

    if pendientes:
        muestra = ", ".join(sorted(pendientes)[:40])
        mas = f" … (+{len(pendientes) - 40})" if len(pendientes) > 40 else ""
        print(f"  sin vector en SBWC, se descartan ({len(pendientes)}): {muestra}{mas}")

    cobertura = 100.0 * len(palabras) / len(pedido)
    print(f"  cobertura: {cobertura:.1f}% ({len(palabras)}/{len(pedido)})")
    return palabras, np.stack(filas, axis=0)


def reducir_y_cuantizar(
    matriz: np.ndarray, dims: int, semilla: int = 42
) -> tuple[np.ndarray, float, np.ndarray]:
    d_orig = matriz.shape[1]
    if dims >= d_orig:
        reducida = matriz.astype(np.float32, copy=True)
        print(f"  sin PCA (dims={dims} >= {d_orig})")
    else:
        print(f"  PCA {d_orig} → {dims}…")
        pca = PCA(n_components=dims, random_state=semilla)
        reducida = pca.fit_transform(matriz).astype(np.float32)
        var = float(pca.explained_variance_ratio_.sum())
        print(f"  varianza explicada: {100.0 * var:.1f}%")

    normas = np.linalg.norm(reducida, axis=1, keepdims=True)
    normas = np.maximum(normas, 1e-12)
    unitaria = reducida / normas

    max_abs = float(np.max(np.abs(unitaria)))
    scale = max_abs / 127.0 if max_abs > 0 else 1.0
    cuantizada = np.clip(np.rint(unitaria / scale), -127, 127).astype(np.int8)
    print(f"  cuantización int8: scale={scale:.6g}, max|v|={max_abs:.4f}")
    return cuantizada, scale, unitaria


def ordenar_alfabetico(
    palabras: list[str], matriz: np.ndarray
) -> tuple[list[str], np.ndarray]:
    orden = sorted(range(len(palabras)), key=lambda i: palabras[i])
    return [palabras[i] for i in orden], matriz[orden]


def escribir_salida(
    palabras: list[str],
    cuantizada: np.ndarray,
    scale: float,
    dims_orig: int,
    dims: int,
) -> None:
    meta = {
        "version": 1,
        "source": "SBWC word2vec (Cardellino / dccuchile)",
        "source_url": URL_VECTORES,
        "license": "CC-BY-4.0 (redistribución dccuchile/spanish-word-embeddings)",
        "dim_original": dims_orig,
        "dim": int(cuantizada.shape[1]),
        "dims_pca": dims,
        "n": len(palabras),
        "scale": scale,
        "dtype": "int8",
        "vocab_file": "diccionario_es.vocab",
        "vectors_file": "embeddings.bin",
    }
    SALIDA_JSON.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    SALIDA_BIN.write_bytes(cuantizada.tobytes(order="C"))
    SALIDA_VOCAB.write_text("\n".join(palabras) + "\n", encoding="utf-8")
    json_kb = SALIDA_JSON.stat().st_size / 1024
    bin_mb = SALIDA_BIN.stat().st_size / (1024 * 1024)
    vocab_kb = SALIDA_VOCAB.stat().st_size / 1024
    print(f"Escrito {SALIDA_JSON} ({json_kb:.1f} KB)")
    print(f"Escrito {SALIDA_BIN} ({bin_mb:.2f} MB)")
    print(f"Escrito {SALIDA_VOCAB} ({len(palabras)} palabras, {vocab_kb:.0f} KB)")
    print(f"Total: {bin_mb + (json_kb + vocab_kb) / 1024:.2f} MB")


def evaluar(palabras: list[str], unitaria: np.ndarray) -> None:
    """Imprime los vecinos más cercanos de una muestra de palabras del vocab."""
    indice = {w: i for i, w in enumerate(palabras)}
    objetivo = palabras[:MAX_PALABRAS_EVAL]
    if not objetivo:
        print("\n(nada que evaluar: vocab vacío)")
        return

    print(f"\nVecinos más cercanos (cosine %) para {len(objetivo)} palabra(s):")
    if len(palabras) > MAX_PALABRAS_EVAL:
        print(f"  (mostrando las primeras {MAX_PALABRAS_EVAL} de {len(palabras)})")

    indices_objetivo = [indice[w] for w in objetivo]
    similitudes = unitaria[indices_objetivo] @ unitaria.T
    for fila, w in enumerate(objetivo):
        i = indices_objetivo[fila]
        orden = np.argsort(-similitudes[fila])
        vecinos = [j for j in orden if j != i][:VECINOS_EVAL]
        texto = ", ".join(f"{palabras[j]} ({100 * similitudes[fila, j]:.1f}%)" for j in vecinos)
        print(f"  {w:16} → {texto}")


def main() -> None:
    pedido = cargar_palabras(SALIDA_VOCAB)
    print(f"Pedido: {SALIDA_VOCAB} ({len(pedido)} palabras)")

    asegurar_descarga(CACHE_BZ2, URL_VECTORES)
    palabras, matriz = extraer_vectores(CACHE_BZ2, pedido)
    palabras, matriz = ordenar_alfabetico(palabras, matriz)
    dims_orig = int(matriz.shape[1])
    cuantizada, scale, unitaria = reducir_y_cuantizar(matriz, DIMS)
    escribir_salida(palabras, cuantizada, scale, dims_orig, DIMS)

    evaluar(palabras, unitaria)


if __name__ == "__main__":
    main()
