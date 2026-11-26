"""Replay a recorded session through the engineer with a given tier and log every call.

Same runner, same facts, same silence rules as production; each answer is awaited before the
next packet, so two tiers see exactly the same moments and can be compared call by call.

    python scripts/engineer_compare.py CAPTURE.f1cap.zst --tier pro --out pro.json            # real API calls
    python scripts/engineer_compare.py CAPTURE.f1cap.zst --tier economico --dry --out e.json # no API: sizes and an estimate

--dry answers with the rules engine and estimates tokens from the prompt sizes, to see how many
calls each lane makes and what they would cost, without spending anything. Without --dry it needs
ANTHROPIC_API_KEY and spends real money (a 10-lap race is under 1 US$ on pro).
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://engineer:engineer@localhost:5433/engineer")

from app.engineer import providers  # noqa: E402
from app.engineer.providers import TIERS, Advice, AnthropicProvider, cost, rules_response  # noqa: E402
from app.engineer.runner import EngineerRunner  # noqa: E402
from app.live.state import LiveSession  # noqa: E402
from app.replay.player import ReplaySource  # noqa: E402
from app.telemetry import registry  # noqa: E402

CHARS_PER_TOKEN = 3.4  # Spanish prose and JSON facts, measured on real calls
# Typical output (with thinking) per lane, from real calls: only used by --dry.
DRY_OUTPUT = {("full", "medium"): 1800, ("full", "low"): 900, ("radio", "low"): 140}


def tokens(text: str) -> int:
    return int(len(text) / CHARS_PER_TOKEN)


class DryProvider:
    """Answers with the rules engine and prices what the real tier would have sent."""

    def __init__(self, tier: str):
        self.tier = tier
        self.name = f"claude ({tier})"
        fast, deep = TIERS[tier]
        self.fast_model, self.deep_model, self.radio_model = fast, deep, providers.RADIO_MODEL
        self._cached: set[str] = set()

    def pick(self, request):
        return AnthropicProvider.pick(self, request)

    def _advice(self, request, lane, model, effort, system_text):
        system_tokens = tokens(system_text)
        warm = (lane, model) in self._cached
        self._cached.add((lane, model))
        usage = {"input": tokens(request.user), "output": DRY_OUTPUT[(lane, effort)],
                 "cache_read": system_tokens if warm else 0, "cache_write": 0 if warm else system_tokens}
        response = rules_response(request)
        return Advice(response, model, 0, usage, cost(model, usage))

    async def advise(self, request):
        model, effort = self.pick(request)
        return self._advice(request, "full", model, effort, request.system)

    async def radio(self, request):
        return self._advice(request, "radio", self.radio_model, "low", request.system + providers.radio_system())


class Recorder:
    """Wraps a provider and keeps every call: lane, model, moments, tokens, cost and radio line."""

    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name
        self.calls: list[dict] = []

    def _log(self, lane, request, advice, started):
        self.calls.append({
            "lane": lane, "lap": request.lap, "t": round(request.session_time, 1),
            "triggers": [t.kind for t in request.triggers], "quiet": bool(getattr(request, "quiet", False)),
            "model": advice.provider, "usage": advice.usage, "cost_usd": advice.cost_usd,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "radio": advice.response.get("radio"), "prioridad": advice.response.get("prioridad"),
            "estrategia": advice.response.get("estrategia"), "manejo": advice.response.get("manejo"),
            "reglaje": advice.response.get("reglaje"), "analisis": advice.response.get("analisis"),
            "facts_tokens": tokens(request.user),
        })

    async def advise(self, request):
        started = time.monotonic()
        advice = await self.inner.advise(request)
        self._log("full", request, advice, started)
        return advice

    async def radio(self, request):
        started = time.monotonic()
        advice = await self.inner.radio(request)
        self._log("radio", request, advice, started)
        return advice


async def run(capture: str, tier: str, dry: bool) -> dict:
    if dry:
        inner = DryProvider(tier)
    else:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise SystemExit("ANTHROPIC_API_KEY is needed for real calls (or pass --dry)")
        inner = AnthropicProvider(key, tier)
    provider = Recorder(inner)
    runner = EngineerRunner(tenant_id=0, mode="replay", provider=provider)
    runner.active = True

    async def no_store(*_a, **_k):
        return None

    runner._store = no_store
    live = None
    clock = {"t": 0.0}
    delivered: list[dict] = []
    runner_deliver = runner._deliver

    def deliver(message):
        delivered.append({k: message.get(k) for k in ("lap", "radio", "prioridad", "provider", "triggers")})
        runner_deliver(message)

    runner._deliver = deliver
    for t, data in ReplaySource([capture]).records():
        clock["t"] = t
        try:
            packet = registry.parse(data)
        except registry.PacketError:
            continue
        if packet.session_uid == 0:
            continue
        if live is None or live.session_uid != packet.session_uid:
            live = LiveSession(tenant_id=0, device_id=0, session_uid=packet.session_uid, packet_format=packet.packet_format,
                               build_layout=False, clock=lambda: clock["t"])
        live.update(packet)
        runner.observe(packet, live)
        runner.dispatch()
        # Wait for the answers before the next packet: both tiers see the same moments.
        pending = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
        if pending:
            await asyncio.gather(*pending)
    runner._flush_outbox()
    calls = provider.calls
    by = {}
    for c in calls:
        k = f"{c['lane']} · {c['model']}"
        b = by.setdefault(k, {"calls": 0, "cost_usd": 0.0, "input": 0, "output": 0, "cache_read": 0})
        b["calls"] += 1
        b["cost_usd"] += c["cost_usd"]
        for f in ("input", "output", "cache_read"):
            b[f] += (c["usage"] or {}).get(f, 0)
    return {"capture": Path(capture).name, "tier": tier, "dry": dry, "total_usd": round(sum(c["cost_usd"] for c in calls), 4),
            "by_lane_model": {k: {**v, "cost_usd": round(v["cost_usd"], 4)} for k, v in by.items()},
            "calls": calls, "radio_heard": delivered}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--tier", default="pro", choices=sorted(TIERS))
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    result = asyncio.run(run(a.capture, a.tier, a.dry))
    Path(a.out).write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str))
    print(f"{result['tier']}{' (dry)' if a.dry else ''}: {len(result['calls'])} calls, US$ {result['total_usd']}")
    for k, v in sorted(result["by_lane_model"].items(), key=lambda kv: -kv[1]["cost_usd"]):
        print(f"  {k:<34} {v['calls']:>3} calls  US$ {v['cost_usd']:.4f}  in {v['input']:>7}  out {v['output']:>6}  cached {v['cache_read']:>7}")


if __name__ == "__main__":
    main()
