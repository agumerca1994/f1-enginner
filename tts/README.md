# Voz del ingeniero (en pausa)

Servicio de voz propio: MeloTTS (español) + OpenVoice v2 con el timbre de una voz diseñada con Qwen3-TTS (no es la voz de ninguna persona). Todo con licencia MIT/Apache, apto para vender.

**Está en pausa (2026-10-27):** no se deploya. Generar la voz en el VPS compartido carga demasiado el servidor. Medido en Linux (Docker, CPU):

- 10 s por frase con 2 núcleos y 5,4 s con 4. Mitad MeloTTS, mitad OpenVoice.
- 1,8 GB de RAM, arranque en 7 s, imagen de 3,6 GB.
- En la Mac nativa (Apple Accelerate) tarda 1,2–2,9 s.

El backend ya sabe usar un servicio de voz: con `TTS_URL` apuntando a algo que reciba `POST /synthesize {"text": ...}` y devuelva MP3, cada radio sale con su audio (`app/engineer/voice.py`). El dashboard la pasa por el efecto de radio y, si no hay audio, usa la voz del navegador. Para un servicio externo alcanza con un adaptador con esa misma interfaz.

Probarlo en local:

```sh
docker build -t f1eng-tts tts/ && docker run -p 8020:8000 --cpus 4 -e TTS_THREADS=4 f1eng-tts
# backend con TTS_URL=http://localhost:8020
```
