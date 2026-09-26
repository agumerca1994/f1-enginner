# Ingeniero de carreras IA (telemetría de EA SPORTS F1® 24)

Un asistente de IA que actúa como ingeniero de carreras. Usa la telemetría UDP que emite el juego EA SPORTS F1® 24 en PS4.

Plan completo: [docs/plan.md](docs/plan.md).

| Carpeta | Contenido | Estado |
|---|---|---|
| `bridge/` | Programa en Go que recibe el UDP en la red local | P0 listo |
| `backend/` | API FastAPI: ingest, parser, reglas, agente, MCP | P1 |
| `frontend/` | Dashboard PWA en Next.js | P2 |
| `mcp-logs/` | MCP local para leer los logs de producción | P6 |
| `fixtures/captures/` | Capturas reales para los tests (git-lfs) | a grabar |

## Bridge

```sh
cd bridge && go build -o bin/bridge ./cmd/bridge
```

### 1. Configurar el juego
En F1 24, entrá a *Configuración → Configuración de telemetría* y dejá:
- **Telemetría UDP:** Activada
- **Modo broadcast UDP:** Activado. Si lo desactivás, cargá la IP de la Mac que muestra `bridge doctor`.
- **Puerto UDP:** 20777
- **Frecuencia de envío UDP:** 20 Hz (60 Hz si querés trazas más finas)
- **Formato UDP:** 2024

### 2. Verificar que llegan los datos
```sh
./bin/bridge doctor
```
Muestra las IP de la Mac y el estado del firewall. Después escucha durante 15 s y resume qué paquetes llegaron.

### 3. Grabar sesiones
```sh
./bin/bridge record --out ../fixtures/captures/tt-monza.f1cap.zst --note "contrarreloj Monza, seco"
```
`Ctrl+C` corta la grabación.

### 4. Reproducir y comparar
```sh
./bin/bridge inspect --in ../fixtures/captures/tt-monza.f1cap.zst
./bin/bridge replay  --in ../fixtures/captures/tt-monza.f1cap.zst --to 127.0.0.1:20777 --speed 1
./bin/bridge compare original.f1cap.zst regrabada.f1cap.zst --tolerance 5ms
./bin/bridge synth   --out synth.f1cap.zst --seconds 60 --rate 20
```
`synth` genera paquetes con headers válidos y cuerpos en cero, para probar sin consola.

## Formato de captura `.f1cap`
Empieza con `F1CAP` y un byte de versión. Le sigue un u32 con el largo de la metadata, y después la metadata en JSON. Por último van los registros: `u64 offset_ns | u16 len | datagrama`.

Todos los enteros son little-endian. Si el nombre del archivo termina en `.zst`, todo el contenido va comprimido con zstd.

## Marcas
Este proyecto no está afiliado a EA ni a Formula 1. "EA SPORTS F1®" se usa solo para describir la compatibilidad.
