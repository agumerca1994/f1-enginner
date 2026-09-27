"""Runs the race engineer over a recorded session calling the real AI, to compare
tiers on quality, cost and latency before offering them.

Spends real money on the Anthropic API: use --limit for a quick check.

    .venv/bin/python scripts/engineer_eval.py CAPTURE.f1cap.zst --tier standard [--limit N] [--out FILE]
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.engineer.engine import RaceEngineer  # noqa: E402
from app.engineer.providers import AnthropicProvider  # noqa: E402
from app.live.state import LiveSession  # noqa: E402
from app.replay.player import ReplaySource  # noqa: E402
from app.telemetry import registry  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("captures", nargs="+")
    parser.add_argument("--tier", choices=["standard", "pro"], default="standard")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many calls (0 = all)")
    parser.add_argument("--out", help="write every request and answer to this JSON file")
    args = parser.parse_args()
    if not settings.ANTHROPIC_API_KEY:
        sys.exit("ANTHROPIC_API_KEY is not set (backend/.env)")

    provider = AnthropicProvider(settings.ANTHROPIC_API_KEY, args.tier)
    engineer = RaceEngineer()
    live: LiveSession | None = None
    clock = {"t": 0.0}
    results = []
    for t, data in ReplaySource(args.captures).records():
        clock["t"] = t
        try:
            packet = registry.parse(data)
        except registry.PacketError:
            continue
        if packet.session_uid == 0:
            continue
        if live is None or live.session_uid != packet.session_uid:
            live = LiveSession(0, 0, packet.session_uid, packet.packet_format, build_layout=False, clock=lambda: clock["t"])
            engineer = RaceEngineer()
        live.update(packet)
        request = engineer.observe(packet, live)
        if request is None:
            continue
        # Calls run one after another, as in a race: each answer feeds the next request's radio history.
        advice = await provider.advise(request)
        engineer.remember(request, advice.response)
        kinds = "+".join(tr.kind for tr in request.triggers)
        r = advice.response
        print(f"\n[{len(results) + 1}] vuelta {request.lap} · {kinds} · {advice.provider} · "
              f"{advice.latency_ms} ms · US$ {advice.cost_usd:.4f} · tokens {advice.usage}")
        print(f"  RADIO ({r['prioridad']}): {r['radio']}")
        print(f"  PLAN: {r['estrategia']['plan']} | box {r['estrategia']['vuelta_box']} "
              f"ventana {r['estrategia']['ventana_box']} → {r['estrategia']['proximo_compuesto']} "
              f"(certeza {r['estrategia']['certeza']})")
        results.append({"lap": request.lap, "triggers": kinds, "model": advice.provider, "latency_ms": advice.latency_ms,
                        "cost_usd": advice.cost_usd, "usage": advice.usage, "response": r})
        if args.limit and len(results) >= args.limit:
            break

    total = sum(x["cost_usd"] for x in results)
    latencies = sorted(x["latency_ms"] for x in results)
    print(f"\n== {args.tier}: {len(results)} llamadas · costo total US$ {total:.4f} · "
          f"latencia mediana {latencies[len(latencies) // 2] if latencies else 0} ms · máxima {max(latencies, default=0)} ms")
    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
