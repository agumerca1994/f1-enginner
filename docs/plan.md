# Plan: Ingeniero de carreras IA para EA SPORTS F1 24 (PS4)

## Contexto
El usuario juega F1 24 en PS4 y quiere que un asistente de IA sea su ingeniero de carreras. El ingeniero le habla por voz durante la carrera, a partir de la telemetría UDP que emite el juego.

El producto se diseña para publicarse y comercializarse. Por eso es multiusuario desde el día uno y el bridge tiene que ser instalable por cualquier jugador.

La carpeta del proyecto está vacía: es un proyecto nuevo. Se reutiliza la infraestructura y los patrones de `registrapp`:
- el VPS con Easypanel y Traefik;
- FastAPI y Next.js;
- el MCP con OAuth;
- el MCP de logs.

Decisiones tomadas por el usuario:
- el bridge corre en la Mac;
- el ingeniero se comunica por voz;
- el proveedor de LLM es configurable;
- el producto es comercial y multiusuario.

## Estado actual (actualizado 2026-10-05)

| Fase | Estado | Qué hay |
|---|---|---|
| P0 Captura/replay | ✅ Hecha | `bridge doctor/record/replay/inspect/compare/synth`, formato `.f1cap.zst`, estimación de recepción |
| P1 Ingest y parser | ✅ En producción | Parser de los 15 paquetes, WSS `/ingest/v1`, vinculación por código, captura cruda por sesión, probado con una carrera real desde el PS4 |
| P2 Dashboard PWA | ✅ En producción | Login con Google, dashboard en vivo apaisado, mapa del circuito, monoplaza, posiciones, `/pair`, `/settings` |
| Extra: app de la Mac | ✅ Hecha (uso local) | `Ingeniero Bridge.app`: barra de menú y ventana, vincular/desvincular, enviar, abrir al iniciar sesión |
| Extra: repeticiones | ✅ En producción | `/sessions` y `/replay/[id]`: reproducir sesiones grabadas con play, pausa, velocidad y salto |
| P3 Procesamiento e ingeniero | 🟡 En producción (modo reglas) | Motor del ingeniero (`app/engineer/`) y card "Ingeniero de pista" en el dashboard con voz, activable en vivo y en repeticiones. Sin API key responde con reglas (nivel gratuito); con `ANTHROPIC_API_KEY` usa Claude (niveles estándar y pro). Falta cargar la key y comparar los niveles con costo real |
| P4 Agente y voz | ⏳ Pendiente | — |
| P5 MCP público | 🟡 En producción | `/mcp` con OAuth 2.1 (registro dinámico, PKCE, rotación de refresh) y tokens personales `rbm_pat_`, scope `telemetry:read`. Tools: `list_sessions`, `get_session_review`, `compare_laps`, `get_engineer_radio`, `get_live_session`. Consentimiento en `/oauth/authorize` y sección en Ajustes. Discovery, registro y redirección al consentimiento verificados en producción; falta conectarlo desde claude.ai |
| P6 MCP de logs | 🟡 Base lista | Endpoints `/internal/{logs,logs/summary,devices,sessions,live}` con clave interna; falta el servidor MCP stdio |
| P7 Hardening comercial | ⏳ Pendiente | — |

### Producción
- **Web:** https://f1.imanzanastore.com.ar (Next.js, servicio `f1eng-web`).
- **API:** https://f1-api.imanzanastore.com.ar (FastAPI, servicio `f1eng-api`, más `f1eng-db` con Postgres 16).
- **Hosting:** Easypanel en el VPS de registrapp (159.112.147.178), servicio compose `f1-engineer` dentro del proyecto `n8n`, construido desde `github.com/agumerca1994/f1-enginner` (rama `main`, repo **público**).
- **Deploy:** `scripts/deploy.sh`, que verifica el estado de git y dispara el webhook guardado en `.deploy.env`. Las variables viven en Easypanel → Entorno; la copia local es `.env.production`. Ambos archivos están gitignorados.
- **DNS:** registros A `f1` y `f1-api` → VPS, en modo **solo DNS**, sin el proxy de Cloudflare, igual que registrapp. Los certificados los emite Let's Encrypt vía Traefik.
- **Firebase:** proyecto `f1-engineer` con login de Google. La clave de la cuenta de servicio está en `secret/` (gitignorado) y en base64 en `FIREBASE_CREDENTIALS_B64`.

### Decisiones tomadas en el camino
- **Agnóstico a la conexión** (ver abajo). El PS4 del usuario va por Wi-Fi y llega el 19–30% de la telemetría: el sistema trabaja con eso y lo muestra como "Señal X%".
- **Repo público.** Easypanel no pudo leerlo como privado ni con token de GitHub. Por eso los secretos nunca van a git (hay `.gitignore` para `secret/`, `.env*`, `.deploy.env` y claves `*adminsdk*.json`).
- **Mapa del circuito armado con la telemetría.** Se usan las posiciones de todos los autos (Motion) y su distancia en la vuelta (LapData), en bins de 10 m. Se guarda por pista en `track_layouts`, se comparte entre todos los usuarios y se completa entre sesiones. Los tramos no recorridos quedan abiertos. Abrir una repetición completa el trazado con la sesión entera.
- **Dashboard pensado para pantalla apaisada** (tablet, compu o TV) en tres columnas: sesión y posiciones | mapa, tiempos y eventos | telemetría y monoplaza. En el celular vertical las cards se apilan.
- **App de la Mac con Fyne** (Go), ícono en la barra de menú más ventana. Comparte `internal/agent` con `bridge run`. Firma ad hoc; la firma de Apple Developer queda para P7.
- **Repeticiones con el mismo motor del vivo.** Leen las capturas crudas del servidor; los silencios de más de 10 s entre grabaciones se acortan a 1 s.
- **Desvincular** lo puede hacer el propio bridge (`DELETE /api/devices/self`) o el usuario desde Ajustes.
- **MCP público portado de registrapp** (2026-10-05). Es sólo lectura. La sesión grabada se analiza re-jugando sus capturas con el mismo `RaceEngineer` (`app/engineer/review.py`, con caché de 8 sesiones), así las cifras coinciden con las del ingeniero. Los prefijos de token son `rbm_at_`, `rbm_rt_` y `rbm_pat_`. Cada lifespan crea su propio session manager de MCP, porque sólo se puede arrancar una vez y los tests abren uno por cliente. `mcp` 1.29.0 obliga a fijar `sse-starlette==2.1.3` para mantener starlette 0.41.

### Estrategia de IA del ingeniero (definida 2026-09-27)
- **La IA es el ingeniero de pista, no un locutor.** Pone el conocimiento de F1 que el jugador no tiene y toma las decisiones:
  - reglaje, solo en práctica y clasificación;
  - modos de manejo y ERS;
  - estrategia de boxes y compuestos;
  - lectura del ritmo propio y de los rivales;
  - gestión de daños.
- **El código hace de sensores y calculadora.** Calcula ritmos limpios, degradación, desgaste proyectado, consumo, tendencia de gaps y dónde se vuelve a pista si se para, y cumple las reglas. La IA interpreta y decide.
- **El conocimiento sale de tres fuentes:**
  - el modelo;
  - el manual del ingeniero específico de F1 24 (`backend/app/engineer/prompts/manual_es.md`, en caché, mejorable con el tiempo);
  - el historial del jugador (pendiente).
- **Radio "como un ingeniero real":** 1 o 2 frases, como mucho una por vuelta, solo cuando aporta. Lo urgente interrumpe. El análisis largo va al muro de boxes del dashboard.
- **Momentos en que habla:** largada, cada vuelta, safety car, pronóstico de lluvia, daño (confirmado, sin flashback), penalización, parada y final.
- **Niveles de IA** (decididos después de la prueba real del 2026-09-27; Haiku malinterpretaba el estado de la carrera):
  - **Estándar:** Sonnet 5 en todo, con esfuerzo bajo por vuelta y medio en eventos. ~US$ 0,50 por carrera de 18 vueltas.
  - **Pro:** Sonnet 5 por vuelta y Opus 5 en eventos. ~US$ 0,85 por carrera de 18 vueltas.
  - **Reglas:** el nivel gratuito, sin IA.
- **Eventos urgentes** (safety car, daño, lluvia): sale al instante un aviso por reglas y después llega la decisión completa de la IA, que tarda 15–25 s.
- **Costo real medido:** manual de ~6.400 tokens en caché, datos de 3.000–4.400 por pedido y respuestas de 450–2.800. Resultados en `docs/pruebas/ingeniero-ia-real-2026-09-27.md`.
- **Fin de semana completo:** el ingeniero tiene que trabajar desde la primera práctica, con reglaje base, ajustes tanda a tanda, medición de compuestos, clasificación y estrategia de carrera basada en lo medido. El diseño, pendiente de aprobación, está en `docs/diseno-fin-de-semana.md`.
- **Prueba en seco** sobre la carrera real de Bakú, con las respuestas de referencia y los hallazgos: `docs/pruebas/ingeniero-baku-2026-09-27.md`.

### Pendientes conocidos
- Confirmar la orientación del mapa con una vuelta completa. En Bakú parece correcta: rotada, no espejada.
- Ver la ventana de la app de la Mac, que no se pudo capturar por falta de permiso de grabación de pantalla.
- Borrar o filtrar sesiones vacías (sesiones de menú con muy pocos datos).
- Las mejoras de la prueba en seco ya están hechas: pérdida en boxes medida con las paradas en verde, escenario "si paran todos" bajo safety car, juegos de neumáticos y tabla por pista en el manual. Falta persistir la pérdida en boxes por pista cuando el ingeniero corra en vivo.
- El estado en vivo está en memoria y se pierde en cada deploy; pasa a Redis en P7.
- La imagen de la API pesa unos 800 MB (numpy y firebase-admin); se puede optimizar.

## Arquitectura
```
PS4 ──UDP :20777 (broadcast o unicast, 20 Hz)──▶ Bridge (Go, en la Mac)
   parsea solo el header de 29 B → throttle/dedupe por tipo → lotes de 100 ms → zstd → WSS binario
   (opcional: graba .f1cap para reproducir sin consola)
        │  wss://<api>/ingest  (token de dispositivo)
        ▼
Backend FastAPI (VPS, Easypanel)
   Ingest → FormatRegistry[2024 | 2025…] → paquetes tipados (dtypes numpy)
     → SessionState en memoria (por tenant + sessionUID)
         ├─ LiveBus → WS del dashboard (deltas a 10 Hz)
         ├─ Procesadores: vueltas, stints, trazas por distancia → Postgres
         ├─ Motor de reglas → EngineerEvents (prioridad, cooldown, dedupe)
         │     ├─ frase con plantilla → PWA TTS   (camino rápido, sin LLM, <0,6 s)
         │     └─ disparador de estrategia → LLM "profundo" → consejo
         └─ RawSink → capturas .f1cap.zst (volumen/objeto) para reprocesar
   EngineerTools (una sola capa de herramientas)
     ├─ agente in-app (push-to-talk → STT → LLM rápido + tools → TTS)
     └─ MCP público /mcp (OAuth/PAT, portado de registrapp)
   Logs JSON a stdout + tabla app_logs → /internal/logs* ◀─ mcp-logs (stdio local)
PWA Next.js: dashboard en vivo, voz, vinculación del bridge, historial, ajustes/BYOK
```

### Decisiones de stack
- **Bridge en Go.**
  - Es un binario único y compila para macOS, Windows y Raspberry Pi. Eso facilita distribuirlo y firmarlo.
  - Es "tonto": solo lee el header. Todo el parseo vive en el servidor, así que soportar F1 25 es solo un deploy del backend.
  - Escucha en `0.0.0.0:20777`, así recibe tanto broadcast como unicast.
- **Backend en Python 3.12 + FastAPI**, con el mismo stack de registrapp: SQLAlchemy 2, asyncpg, Alembic y Pydantic v2.
  - El parser es propio y declarativo, con un dtype numpy por paquete.
  - Hay un registro por `packetFormat`.
  - Las librerías existentes (crate de Rust, `f1-24-telemetry`) se usan solo para validar cruzado.
- **Postgres 16 solo**, sin Timescale.
  - Guarda vueltas y stints, más las trazas del jugador en arrays float16 muestreados cada 5 m.
  - Las capturas crudas van como archivos, no en la base.
  - Redis entra más adelante, detrás de la interfaz `LiveBus`/`StateStore`.
- **Frontend: Next.js 15 como PWA**, con React 19, Tailwind y Radix.
  - Suma Zustand con selectores y uPlot para los gráficos en vivo.
  - Recharts queda solo para el análisis post-sesión.
  - Usa Wake Lock para que la pantalla no se apague.
- **Auth:** Firebase con login de Google, como en registrapp, y `tenant_id` en todas las tablas.
  - El bridge se vincula con un flujo de código de dispositivo: `bridge pair` muestra un código de 8 caracteres y el usuario lo carga en `/pair`.
  - El token del bridge es `rbd_…` y se guarda como hash sha256, igual que los PAT de registrapp.
- **LLM:** interfaz `LLMProvider` con tres implementaciones: Anthropic (por defecto), una compatible con OpenAI (sirve también para Ollama y LM Studio) y una falsa para tests.
  - Cada tenant configura un modelo rápido y uno profundo.
  - Soporta BYOK con la key cifrada.
  - Usa prompt caching.
  - Todo el uso queda registrado en `llm_usage`.
- **Voz:**
  - TTS con `speechSynthesis` y una cola por prioridad; lo urgente interrumpe lo demás.
  - Push-to-talk con `MediaRecorder` y STT en el servidor. En iOS no se puede depender de Web Speech; se usa solo como atajo en Chrome.
- **Ancho de banda:** alrededor de 12–25 KB/s por carrera con dedupe y zstd.
  - LapData y Telemetry van a 10 Hz, Status a 5 Hz y Motion a 2–5 Hz.
  - Damage, History, TyreSets y Setups solo se envían si cambian.

## Estructura del repo
Lo que existe hoy:
```
bridge/
  cmd/bridge/        CLI: pair | unpair | run | doctor | record | replay | inspect | compare | synth
  cmd/bridge-app/    app de la Mac (Fyne): barra de menú y ventana; Icon.png, tray.svg
  internal/          header, udp, capture (.f1cap, replay, compare, synth), doctor (stats, recepción),
                     throttle, uplink (WSS con reconexión), agent (ciclo compartido CLI/app),
                     pairing (pair, self, unlink), config, autostart (LaunchAgent)
backend/app/
  telemetry/         formats/f2024.py (dtypes), registry.py, capture.py, constants.py
  ingest/            protocol.py (lotes zstd), service.py (por conexión, sesiones, capturas, trazado)
  live/              state.py (LiveSession/LiveStore), snapshot.py, track_layout.py (LayoutBuilder)
  replay/            player.py (ReplaySource, ReplayPlayer)
  engineer/          motor del ingeniero; review.py analiza una sesión grabada completa
  mcp_server/        instance (FastMCP), transport (/mcp + auth), context (quién llama), tools
  routers/           devices, ingest (/ingest/v1), live (/api/me, /api/live, /api/sessions, /api/tracks),
                     live_ws (/live/v1), replay_ws (/replay/v1), internal (/internal/*),
                     engineer (/api/engineer/*), oauth (/.well-known/*, /oauth/*)
  models/, core/ (config, auth, security, database, logging_config)
  services/          pairing, mcp_tokens, oauth_provider, rate_limit
backend/alembic/     05fd98fa34e0 esquema inicial · a7b184d54fc9 track_layouts · de9c03b6f9cf engineer_messages · c50f98e2c6fb tablas del MCP
frontend/            Next.js 15 + Tailwind 4: / (dashboard), /sessions, /replay/[id], /pair, /settings, /usage, /oauth/authorize
  components/dashboard/  Dashboard, Cards, TrackMap, CarTopView, Panel
  lib/               auth (Firebase), api, live, replay, types, format, teams
fixtures/captures/   baku-carrera-wifi.f1cap.zst (git-lfs), la captura real usada en los tests
scripts/             deploy.sh, build-mac-app.sh
```
Lo planificado que todavía no existe: `processing/`, `rules/` y `mcp-logs/`.

Archivos de registrapp que se portan:
- `backend/app/mcp_server/transport.py`
- `backend/app/services/oauth_provider.py`
- `backend/app/services/mcp_tokens.py`
- `backend/app/routers/oauth.py`
- `backend/app/models/mcp_auth.py`
- `backend/app/core/logging_config.py`
- `backend/app/routers/internal_logs.py`
- `mcp/server.py`
- `scripts/deploy.sh`
- `docker-compose.prod.yml`: red `easypanel`, labels de Traefik y `certresolver=letsencrypt`.

## Modelo de datos (resumen)
Tablas que existen hoy:
- `tenants` y `users`, con login de Firebase (`firebase_uid`, email en minúsculas).
- `devices`: bridges vinculados; token `rbd_` guardado solo como hash, `last_seen_at`, `last_reception`, `revoked_at`.
- `pairing_requests`: el flujo de código de dispositivo, con el `device_code` hasheado.
- `game_sessions`: `session_uid` en hexadecimal, formato, versión del juego, pista, tipo, vueltas, contadores de paquetes.
- `session_captures`: una grabación `.f1cap.zst` por conexión y sesión, en el volumen `/data/captures`.
- `track_layouts`: el trazado por pista, compartido entre usuarios (`sums`/`counts` por bin, `points`, `coverage`, `ready`).
- `app_logs`: WARNING o más, para el MCP de logs.

Tablas planificadas:
- `laps`, `lap_traces`, `stints` y `session_events`, en P3.
- `conversations`, `messages`, `llm_usage` y `provider_configs`, en P4.
- las tablas de auth del MCP, en P5.
- `plans`, `subscriptions` y `usage_counters`, en P7.

## Fases
**P0. Base y captura/replay**
- Monorepo y docker-compose local con Postgres.
- Bridge en Go con los comandos `record`, `replay --speed` y `doctor`. `doctor` muestra la IP LAN y verifica el firewall de macOS y la llegada de paquetes.
- Grabar un set de capturas reales desde el PS4: contrarreloj, carrera corta con pit y cambio de clima, lobby online y safety car.
- Criterio de aceptación: el replay reproduce los datagramas byte a byte y en orden, con un error de tiempo de ±5 ms.

**P1. Ingest y parser**
- WSS con token de dispositivo y vinculación.
- Parser del header y de los 15 paquetes del formato 2024.
- Captura cruda en el servidor y detección de sesiones.
- Deploy en el VPS con los subdominios provisorios `f1-api.` y `f1.imanzanastore.com.ar`.

**P2. Dashboard en vivo (PWA)**
- Auto: velocidad, marcha, RPM, DRS, ERS, combustible, temperatura y desgaste de neumáticos, daños.
- Carrera: posición, vuelta, gaps, tabla de tiempos, penalizaciones.
- Clima y pronóstico, y datos de la sesión.
- Reconexión con snapshot, instalación como PWA y Wake Lock.

**P3. Procesamiento y reglas**
- Agregación de vueltas, stints y trazas.
- Reglas: delta de combustible, neumáticos, daños, clima, ventana de pit, tendencia de gaps, banderas y safety car, DRS y penalizaciones.
- Cada regla tiene prioridad, cooldown y dedupe.
- Los campos restringidos online se tratan como "desconocido", no como cero.

**P4. Agente y voz**
- `EngineerTools`: `get_snapshot`, `get_tyres`, `get_fuel`, `get_gaps`, `get_lap_history`, `compare_laps`, `get_weather`, `get_strategy_options` y `get_recent_events`.
- Constructor de contexto compacto.
- Proveedores de LLM y configuración BYOK.
- Push-to-talk → STT → LLM → TTS, con la cola de prioridad.

**P5. MCP público**
- Portar el MCP de registrapp con OAuth 2.1, registro dinámico de clientes y PAT, scope `telemetry:read`.
- Las tools envuelven `EngineerTools` más consultas de historial.
- Configurar los allowed hosts en `transport_security`; si no, Traefik devuelve 421.

**P6. MCP de logs**
- Portar el logging y `mcp-logs` de registrapp.
- Suma heartbeats del bridge y errores del parser.
- Tools: `recent_errors`, `ingest_stats`, `bridge_status` y `session_debug`.

**P7. Hardening comercial**
- Facturación con Paddle o Lemon Squeezy, más Mercado Pago para usuarios locales.
- Límites por plan: minutos en vivo, presupuesto de LLM y retención de capturas.
- Rate limits por tenant.
- Distribución del bridge: firma y notarización en macOS, Authenticode en Windows, goreleaser, auto-update y app de bandeja.
- Redis para `LiveBus`, backups, términos y privacidad, borrado de cuenta.
- Nombre de producto neutral: sin "F1", "EA" ni logos. Usar la fórmula "compatible con la telemetría de EA SPORTS F1® 24".

La implementación arranca por P0 y P1. Cada fase se cierra con su verificación antes de pasar a la siguiente.

## Verificación
- **P0:** `bridge record` durante una sesión real, después `bridge replay` hacia `udp://127.0.0.1:20778` y un listener que compara checksums.
- **P1:**
  - pytest con un test de tamaño por paquete, que tiene que coincidir con los bytes de la spec.
  - Tests "golden" con capturas: cantidad de vueltas, tiempos del jugador iguales a FinalClassification, pista y tipo de sesión correctos.
  - Fuzz con paquetes truncados o desconocidos: no debe romperse nada.
  - Prueba end-to-end: PS4 → Mac → VPS, y el replay de la captura guardada tiene que dar la misma salida parseada.
- **P2:**
  - Playwright contra un backend alimentado por `bridge replay`.
  - Latencia de bridge a UI por debajo de 300 ms en la LAN.
  - Prueba manual en el celular con una carrera real.
- **P3:** snapshots de los eventos esperados para cada captura, con tolerancia de tiempo, un máximo de alertas por vuelta y sin duplicados.
- **P4:**
  - LLM falso para los tests deterministas.
  - Set de alrededor de 30 preguntas evaluadas contra un estado reproducido.
  - Mediana de respuesta de push-to-talk por debajo de 3 s.
- **P5:** conectar Claude Desktop y claude.ai por OAuth mientras corre un replay, y pasar MCP Inspector.
- **P6:** forzar un error del parser y verlo por `mcp-logs` en menos de 10 s.
- **P7:** prueba de carga con 50 bridges simulados en replay, más tests de autorización entre tenants.

## Principio: agnóstico a la conexión
La calidad de la red de la consola es responsabilidad del jugador. El sistema funciona con lo que llegue:
- **Estado con el último valor conocido y su antigüedad.** Nada asume paquetes consecutivos ni una frecuencia fija.
- **Los eventos sueltos no son la única fuente.** Los paquetes de evento (penalización, safety car, vuelta rápida) se pueden perder, así que las reglas también los deducen de los paquetes de estado que se repiten: Session, LapData y SessionHistory.
- **La calidad de la conexión es un dato visible.**
  - El bridge estima el porcentaje recibido a partir de los saltos de `frameIdentifier` y lo envía en su heartbeat.
  - El dashboard muestra un indicador de calidad.
  - El ingeniero adapta lo que promete: con recepción baja no hace análisis fino de trazas.
- **Las capturas con mala conexión son fixtures valiosos.** Son el caso difícil que los tests tienen que cubrir.

## Aprendizajes de las pruebas reales (2026-09-26)
- El PS4 envía el formato 2024 con el juego en la versión 1.21. Los tamaños de todos los paquetes coinciden con la especificación.
- Con el PS4 conectado por Wi-Fi se perdió alrededor del 85–90% de los paquetes, en ráfagas.
  - El ping de la Mac al router dio 6 ms de promedio.
  - El ping de la Mac al PS4 dio 470 ms de promedio y hasta 3 s.
  - La Mac no tuvo descartes y AWDL no influyó.
- Qué implica para el producto:
  - `doctor` tiene que hacer ping automáticamente a la IP de origen, estimar la pérdida y recomendar el cable.
  - El backend y las reglas tienen que tolerar la pérdida de paquetes y la llegada fuera de orden. Se descarta cualquier `frameIdentifier` menor al último visto, salvo flashbacks, que se detectan por evento.
  - El onboarding recomienda conectar el PS4 por Ethernet.

## Riesgos principales
- **Red del PS4:** hay que reservar la IP de la Mac en el DHCP. El firewall de macOS y el aislamiento de clientes en Wi-Fi pueden bloquear el tráfico. `doctor` guía al usuario para resolverlo.
- **Online:** los datos restringidos de los rivales llegan en cero.
- **Cambios de formato:** parches o F1 25 pueden cambiar los paquetes. Por eso se enruta por `packetFormat` y se guardan las capturas crudas.
- **Costo del LLM por carrera:** se controla con plantillas para las alertas, caching, topes por tenant y BYOK.
- **Audio en iOS:** requiere un gesto del usuario para arrancar y se corta con la pantalla bloqueada. Se mitiga con un botón "Iniciar carrera" y Wake Lock, y se recomiendan auriculares.
- **VPS:** posiblemente es ARM (Oracle Ampere), así que las imágenes tienen que ser multi-arch. Los WebSockets detrás de Traefik necesitan timeouts y pings.
- **Privacidad:** los nombres de PSN son datos personales.
