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
