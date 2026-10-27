# Investigación: radio de F1 real, voz y reconocimiento (2026-10-26)

Base para la fase P4 (agente y voz). Resume dos investigaciones: cómo hablan los ingenieros de pista de verdad y qué voz y qué reconocimiento libres sirven. Las fuentes están en las conversaciones de investigación; acá van las conclusiones que usamos.

## Cómo habla un ingeniero de F1

**Cuándo**
- La base es el silencio, pero no total: "das lo que necesitan y nada más" (Alan Permane, Lotus). Sí hay que avisar lo clave: energía, combustible, modos (Andrew Shovlin, Mercedes).
- **Nunca en frenada ni en curva.** Los casos conocidos:
  - Wolff le gritó a Russell en plena frenada (Austria 2024) y después lo llamó "lo más tonto que hice".
  - Verstappen le pidió a Lambiase que no le hablara en las frenadas.
- No repetir lo rutinario cada vuelta: "si me hablás cada vuelta desconecto la radio" (Alonso, Singapur 2025).
- Lo urgente interrumpe. Las explicaciones largas van bajo safety car o VSC, o al final de la carrera.

**Cómo**
- **Largo:** la mediana es de 9 palabras por mensaje, y el 72% tiene 12 o menos. Los largos (25–36 palabras) son explicaciones en momentos tranquilos.
- **Estructura:** dato + instrucción + objetivo. Por ejemplo: "Peleás con Verstappen, objetivo 14.7 si podés."
- **Lo urgente se repite:** "Box, box, box." "Strat five. Strat five."
- **Números:**
  - tiempos sin el minuto ("15.2");
  - gaps sin unidad ("1.4 atrás");
  - diferencias en décimas.
- **Curvas:** siempre con número y fase. "La pérdida principal es la frenada y la salida de la 6" (Lambiase). "Las traseras a la salida de la 6 y la 9" (Will Joseph).
- **Coaching:** dónde + qué muestra el dato + una acción + una herramienta si ayuda. "Saturación adelante en las lentas. Diferencial Mid 3 puede ayudar" (Adami).
- **Preguntas del piloto:** primero la respuesta directa y después una línea de contexto. Si no saben: "Aguantá, lo chequeamos", y después vuelven con el dato.
- **Errores típicos:**
  - contestar otra cosa;
  - dar datos de autos que no pelean con él;
  - el dato tarde;
  - jerga ambigua;
  - motivación vacía ("push now" cuando ya va a fondo);
  - criticar en carrera.
- **En rioplatense:**
  - "Recibido";
  - "Aguantá, lo chequeamos";
  - "Box, box";
  - "Quedate afuera";
  - "Levantá antes de frenar";
  - "Cuidá las traseras a la salida de la 6";
  - "Uno dos con Norris, viene tres décimas más rápido";
  - "Balance de freno, un punto adelante".

**Sonido de radio**
- Es banda telefónica, porque el códec TETRA trabaja a 8 kHz: corte entre 300 y 3.400 Hz, un realce cerca de 1,5 kHz, compresión fuerte y algo de saturación.
- No hay un pitido "oficial" documentado. Usamos dos tonos cortos (1.000 → 1.400 Hz al abrir, 1.400 → 1.000 Hz al cerrar).

## Voz (TTS)

Probado en una Mac M5 con CPU, con la frase "Box, box esta vuelta. Las gomas traseras están al límite y Verstappen viene a dos segundos.":

| Modelo | Tiempo | Licencia | Nota |
|---|---|---|---|
| Supertonic 3 (sherpa-onnx, int8) | 0,7 s con 2 hilos | código MIT, pesos OpenRAIL-M (uso comercial sí; prohíbe suplantar personas y pide avisar que es voz generada) | 10 voces de catálogo, ninguna rioplatense; repo archivado |
| Piper es_MX-claude-high | 0,2 s | dataset Apache-2.0 | más robótica; las voces es_AR/es_ES derivan de "lessac", que **prohíbe uso comercial** |
| Chatterbox Multilingual es-mx-latam | sin medir (necesita GPU) | MIT | clonación desde 10 s de audio, control de emoción |
| Azure es-AR (pago) | — | comercial | la única voz con acento rioplatense real, unos US$ 0,12 por carrera |

**Descartados por licencia no comercial:** XTTS-v2, F5-TTS, Fish Speech, Spark-TTS y Voxtral.

**Elegido por ahora:** Supertonic 3, voz 3, en el servidor. El usuario la eligió como provisoria: todas tienen acento raro.

**Clonación:** nunca de una persona real sin consentimiento escrito (art. 53 del Código Civil y Comercial). Hay dos caminos para una voz propia:
- un locutor argentino con contrato que autorice el uso con IA;
- una voz diseñada que no sea de nadie.

## Reconocimiento de voz (STT)

- **Parakeet TDT 0.6B v3** (CC-BY-4.0, comercial):
  - 0,2 s en la M5; estimo 0,5–1 s en el VPS.
  - Necesita unos 2 GB de RAM.
  - Es el más preciso: entendió "Verstappen".
- **Web Speech API del navegador:** gratis y en Chrome y Safari, pero manda el audio a Google o Apple y no anda en TVs.
- **Plan:** empezar con el navegador y sumar Parakeet si el VPS lo banca.
