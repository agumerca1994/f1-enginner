"""Freezes a moment of a recorded race for the engineer demo in Plans.

Replays a capture through the live state and an engineer, then stores what each of the
talk tools answers at that moment, so the demo engineer answers from real telemetry
without the capture (the fixtures are not in the server image).

    .venv/bin/python scripts/build_demo_race.py ../fixtures/captures/texas-carrera-temporada2026-formato2024.f1cap.zst
"""

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engineer import talk  # noqa: E402
from app.engineer.providers import RulesProvider  # noqa: E402
from app.engineer.runner import EngineerRunner  # noqa: E402
from app.replay.player import ReplayPlayer, ReplaySource  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "app" / "engineer" / "demo_race.json"


def clean(value):
    """JSON-safe: no infinities (a frozen moment has no data age)."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("capture")
    args = parser.parse_args()

    runner = EngineerRunner(1, "live", provider=RulesProvider())
    player = ReplayPlayer(ReplaySource([args.capture]), on_packet=runner.observe)
    player.seek(float("inf"))
    live = player.live

    def tool(name: str, **kw):
        try:
            return clean(talk.run_tool(runner, live, name, kw))
        except Exception as e:  # a tool without data for this moment
            return {"error": str(e)}

    status = tool("estado_breve")
    status["antiguedad_s"] = 0.3
    lap = status.get("vuelta") or 1
    corners = {}
    for n in range(1, 31):
        out = tool("analisis_curva", numero=n)
        if "error" in out and n > 1 and not corners.get(str(n - 1)):
            break
        corners[str(n)] = out
    corners = {k: v for k, v in corners.items() if "error" not in v}
    data = {
        "pista": status.get("pista"),
        "estado_breve": status,
        "neumaticos": tool("neumaticos"),
        "estrategia": {"ahora": tool("estrategia"),
                       **{str(v): tool("estrategia", vuelta_parada=v) for v in range(lap, lap + 3)}},
        "reglaje": tool("reglaje"),
        "incidentes": tool("incidentes"),
        "sectores": {str(n): tool("sector", n=n) for n in (1, 2, 3)},
        "curvas": corners,
        "vueltas": {f"{a}-{b}": tool("comparar_vueltas", a=a, b=b)
                    for a in range(1, lap) for b in range(a + 1, lap + 1)},
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{OUT.name}: vuelta {lap}, {len(corners)} curvas, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
