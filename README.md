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

`web/diccionario_es.vocab` se construye combinando varias listas de palabras (solo quedan las que además tienen vector en SBWC):

- [Listado de palabras RAE (23.8.1)](https://github.com/rubenperezm/ListadosPalabrasRAE) de rubenperezm, lemario base derivado del diccionario de la RAE.
- [lemarios](https://github.com/olea/lemarios) de Santiago Olea, lemario general del español y conjugaciones de verbos, dominio público. Usado para completar palabras que el listado RAE no separaba (p. ej. sustantivos con forma propia en -a/-o como "música"/"músico") y para sumar formas verbales conjugadas.
- Marcas/nombres comerciales populares. **No provienen de ningún dataset o listado externo**: es una lista obtenida por un LLM.
- Países, territorios y gentilicios (masculino/femenino), a partir del [Anexo:Gentilicios](https://es.wikipedia.org/wiki/Lista_de_gentilicios_ordenada_por_top%C3%B3nimo) de Wikipedia en español.

## Modelo de similitud

La similitud mide **uso compartido en contexto** (hipótesis distribucional), no parecido ortográfico ni subpalabras.

Se usan los embeddings **Word2Vec skip-gram** entrenados por [Cristian Cardellino](https://github.com/crscardellino) sobre el [Spanish Billion Word Corpus](https://crscardellino.ar/SBWCE/) (~1.4B palabras), redistribuidos en [dccuchile/spanish-word-embeddings](https://github.com/dccuchile/spanish-word-embeddings) (CC-BY-4.0).

Los vectores originales (300 dimensiones) pasan por [&#34;All-but-the-Top&#34;](https://arxiv.org/abs/1702.01417) (Mu & Viswanath, 2018) —se les resta la dirección dominante común a casi cualquier palabra— y luego se reducen a 256 dimensiones con PCA y se cuantizan a int8 para achicar el archivo que descarga el navegador (`web/embeddings.bin`, ~31 MB). Ese preprocesado separa mucho mejor el "ruido de fondo" entre palabras no relacionadas de la similitud real entre sinónimos.

## Analítica (GoatCounter)

El sitio publicado usa [GoatCounter](https://www.goatcounter.com/) para estadísticas anónimas de visitas y para registrar palabras rechazadas por el diccionario (por ejemplo, términos que un jugador cree que deberían existir). No usa cookies ni identifica a quien juega. El aviso al usuario está en el modal de ayuda.
