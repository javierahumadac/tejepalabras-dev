#!/usr/bin/env python3
"""Genera web/diccionario_es.txt a partir del lemario DLE 23.8.1 (RAE).

Fuente: https://github.com/rubenperezm/ListadosPalabrasRAE
"""

import re
import unicodedata
from pathlib import Path
from urllib.request import urlretrieve

URL = "https://raw.githubusercontent.com/rubenperezm/ListadosPalabrasRAE/main/23-8-1.txt"
RAIZ = Path(__file__).resolve().parents[1]
SALIDA = RAIZ / "web" / "diccionario_es.txt"


def norm(s: str) -> str:
    return unicodedata.normalize("NFC", s.strip().lower())


def es_palabra_jugable(p: str) -> bool:
    if " " in p or "-" in p:
        return False
    if len(p) < 3 or len(p) > 25:
        return False
    return bool(re.fullmatch(r"[a-záéíóúüñ]+", p))


def main() -> None:
    tmp = Path("/tmp/rae-23-8-1.txt")
    print(f"Descargando {URL} …")
    urlretrieve(URL, tmp)

    palabras = set()
    for linea in tmp.read_text(encoding="utf-8").splitlines():
        p = norm(linea)
        if p and es_palabra_jugable(p):
            palabras.add(p)

    ordenadas = sorted(palabras)
    SALIDA.write_text("\n".join(ordenadas) + "\n", encoding="utf-8")
    print(f"Escrito {SALIDA} ({len(ordenadas)} palabras)")


if __name__ == "__main__":
    main()
