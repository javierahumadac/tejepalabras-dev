# Tejepalabras

Juego de asociación de palabras en español. Conecta dos palabras poco relacionadas añadiendo palabras puente cuya similitud semántica supere un umbral.

Inspirado en [Linxicon](https://linxicon.com/) (Trainwreck Labs). Proyecto independiente, no afiliado ni respaldado por sus autores.

## Cómo se juega

1. El juego elige dos palabras objetivo (origen y destino).
2. Escribes palabras en español que actúen de puente entre ellas.
3. Si dos palabras del tablero son semánticamente parecidas (similitud > umbral), se dibuja un enlace.
4. Ganas cuando origen y destino quedan conectados en el grafo.

## Tecnología

Todo corre en el navegador, sin backend:

- **Vocabulario + similitud:** `web/diccionario_es.vocab` + `web/embeddings.bin` (word2vec SBWC, coseno en JS)
- **Grafo:** [Cytoscape.js](https://js.cytoscape.org/)

## Diccionarios usados

`web/diccionario_es.vocab` se construye combinando varias listas de palabras (solo quedan las que además tienen vector en SBWC, ver más abajo):

- [Listado de palabras RAE (23.8.1)](https://github.com/rubenperezm/ListadosPalabrasRAE) de rubenperezm, lemario base derivado del diccionario de la RAE.
- [lemarios](https://github.com/olea/lemarios) de Santiago Olea, lemario general del español y conjugaciones de verbos, dominio público. Usado para completar palabras que el listado RAE no separaba (p. ej. sustantivos con forma propia en -a/-o como "música"/"músico") y para sumar formas verbales conjugadas.
- Marcas/nombres comerciales populares (tecnología, autos, moda, alimentación, aerolíneas, bancos, etc.), curados a mano y verificados uno por uno contra SBWC antes de sumarlos (solo entran las que el corpus reconoce con vector propio).

## Modelo de similitud

La similitud mide **uso compartido en contexto** (hipótesis distribucional), no parecido ortográfico ni subpalabras.

Se usan los embeddings **Word2Vec skip-gram** entrenados por [Cristian Cardellino](https://github.com/crscardellino) sobre el [Spanish Billion Word Corpus](https://crscardellino.ar/SBWCE/) (~1.4B palabras), redistribuidos en [dccuchile/spanish-word-embeddings](https://github.com/dccuchile/spanish-word-embeddings) (CC-BY-4.0).

## Analítica (GoatCounter)

El sitio publicado usa [GoatCounter](https://www.goatcounter.com/) para estadísticas anónimas de visitas y para registrar palabras rechazadas por el diccionario (por ejemplo, términos que un jugador cree que deberían existir). No usa cookies ni identifica a quien juega. El aviso al usuario está en el modal de ayuda.
