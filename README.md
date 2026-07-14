# Tejepalabras

Juego de asociación de palabras en español. Conecta dos palabras poco relacionadas
añadiendo palabras puente cuya similitud semántica supere un umbral.

Inspirado en [Linxicon](https://linxicon.com/) (Trainwreck Labs). Proyecto independiente,
no afiliado ni respaldado por sus autores.

## Cómo se juega

1. El juego elige dos palabras objetivo (origen y destino).
2. Escribes palabras en español que actúen de puente entre ellas.
3. Si dos palabras del tablero son semánticamente parecidas (similitud > 47,5%), se dibuja un enlace.
4. Ganas cuando origen y destino quedan conectados en el grafo.

## Tecnología

Todo corre en el navegador, sin backend:

- **Similitud semántica:** [transformers.js](https://huggingface.co/docs/transformers.js) + modelo ONNX en [Hugging Face](https://huggingface.co/jotaah/tejepalabras-onnx)
- **Ortografía:** `web/diccionario_es.txt`
- **Grafo:** [Cytoscape.js](https://js.cytoscape.org/)

## Modelo de similitud

El juego usa el modelo **[jotaah/tejepalabras-onnx](https://huggingface.co/jotaah/tejepalabras-onnx)** en Hugging Face. No va dentro del repositorio de GitHub (pesa ~106 MB); el navegador lo descarga la primera vez que juegas y lo guarda en caché.

Está construido a partir de **[hiiamsid/sentence_similarity_spanish_es](https://huggingface.co/hiiamsid/sentence_similarity_spanish_es)**, un modelo preentrenado que convierte palabras y frases en español en vectores numéricos de forma que palabras con significado parecido queden cerca entre sí.

En pocas palabras, el proceso fue:

1. **Partir del modelo base:** Se tomó el modelo de similitud en español ya entrenado por su autor.
2. **Convertirlo a ONNX:** Se exportó a un formato que el navegador puede ejecutar con transformers.js (sin Python ni servidor).
3. **Cuantizarlo:** Se redujo el tamaño del archivo (de ~400 MB a ~106 MB) para que la descarga sea razonable.

En cada partida, el navegador calcula un vector por palabra y mide qué tan parecidas son dos palabras comparando esos vectores (similitud coseno). No compara letras ni ortografía: mira el significado.
