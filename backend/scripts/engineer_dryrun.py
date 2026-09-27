"""Runs the race engineer over a recorded session without calling any AI.

Every time the engineer would be consulted, the exact request (system prompt
and user message) is written to disk, with an estimate of its size in tokens,
so the analysis and the cost can be reviewed before spending on an API.

    .venv/bin/python scripts/engineer_dryrun.py CAPTURE.f1cap.zst [MORE ...] --out DIR
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engineer.engine import RaceEngineer, system_prompt  # noqa: E402
from app.live.state import LiveSession  # noqa: E402
from app.replay.player import ReplaySource  # noqa: E402
from app.telemetry import registry  # noqa: E402

# Spanish prose and compact JSON run at roughly 3.5 characters per token.
CHARS_PER_TOKEN = 3.5


def tokens(text: str) -> int:
    return round(len(text) / CHARS_PER_TOKEN)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("captures", nargs="+")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    source = ReplaySource(args.captures)
    engineer = RaceEngineer()
    live: LiveSession | None = None
    clock = {"t": 0.0}
    rows = []
    for t, data in source.records():
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
        n = len(rows) + 1
        kinds = "+".join(tr.kind for tr in request.triggers)
        name = f"{n:03d}_v{request.lap or 0:02d}_{kinds}"
        (out / f"{name}.user.md").write_text(request.user, encoding="utf-8")
        rows.append({"n": n, "t_s": round(t, 1), "lap": request.lap, "triggers": kinds,
                     "user_tokens": tokens(request.user), "file": f"{name}.user.md"})

    system = system_prompt()
    (out / "system.md").write_text(system, encoding="utf-8")
    summary = {"requests": len(rows), "system_tokens": tokens(system),
               "avg_user_tokens": round(sum(r["user_tokens"] for r in rows) / max(1, len(rows))),
               "rows": rows}
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, ensure_ascii=False))
    for r in rows:
        print(f"{r['n']:3d}  t={r['t_s']:7.1f}s  vuelta {r['lap']}  {r['triggers']:<32} ~{r['user_tokens']} tokens")


if __name__ == "__main__":
    main()
