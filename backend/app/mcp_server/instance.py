"""The `FastMCP` instance, kept apart from the transport wiring.

Tool modules import `mcp` from here and `transport.py` imports both, so the
decorators never create an import cycle.
"""

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from app.core.config import settings

INSTRUCTIONS = """\
Ingeniero de carrera: telemetría de las sesiones de un jugador de un juego de
autos de carrera (compatible con la telemetría de EA SPORTS F1® 24). Un bridge en
la computadora del jugador manda los datos del juego; acá podés leer la sesión en
vivo y las sesiones grabadas. Es sólo lectura.

Cómo usarlo:
- `list_sessions` trae las sesiones (pista, tipo, fecha, si tiene grabación) con su id.
- `get_session_review` analiza una sesión grabada completa: todas las vueltas del
  jugador, los stints con ritmo y degradación, la clasificación final si se grabó
  y el análisis del ingeniero al cierre. Es la herramienta principal para
  preguntas como "¿cómo me fue en Bakú?" o "¿dónde perdí tiempo?".
- `compare_laps` pone dos vueltas de una sesión lado a lado.
- `get_engineer_radio` trae lo que el ingeniero de IA le dijo al jugador por radio.
- `get_live_session` es la carrera que se está corriendo ahora mismo, si hay una.

Cómo interpretar los datos:
- El PS4 del jugador suele ir por Wi-Fi y llega sólo una parte de la telemetría
  (ver `calidad_datos` y `recepcion_telemetria`). Pueden faltar vueltas: no
  inventes las que no están y decí cuando una conclusión se apoya en pocos datos.
- Un campo en null significa "desconocido" (por ejemplo, datos que un jugador
  online no comparte), nunca cero.
- Las vueltas "limpias" son las válidas, sin safety car, sin box y desde la
  vuelta 2: usalas para comparar ritmo. Una vuelta con safety car es lenta por eso.
- Los neumáticos van en el orden tras_izq, tras_der, del_izq, del_der.
- Una degradación negativa en un stint corto suele ser el combustible bajando,
  no gomas mejorando.
- Respondé en español rioplatense, con el tono de un ingeniero de pista: claro,
  concreto y sin dramatizar.
"""

mcp = FastMCP(
    "ingeniero-de-carrera",
    instructions=INSTRUCTIONS,
    website_url=settings.FRONTEND_URL or None,
    stateless_http=True,
    # Plain JSON instead of SSE: simpler for clients.
    json_response=True,
    # Mandatory: with the default host FastMCP only allows localhost, and behind
    # Traefik every production request becomes a bare 421.
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=settings.mcp_allowed_hosts,
        allowed_origins=settings.mcp_allowed_origins,
    ),
)

# Every tool only reads, so clients need not ask before calling one.
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)
