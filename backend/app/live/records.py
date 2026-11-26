"""Lap records for the leaderboards: each player's best valid lap per track, game, assists and weather.

Taken from the player's SessionHistory (the game marks every lap and sector valid or not), with
the assists the player drives with (TC, ABS, gearbox, braking assist) and the weather, so a lap
is only ranked against laps driven in the same conditions. Saved in the periodic flush, never per
packet; a lap that does not beat the stored one writes nothing.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import LapRecord
from app.telemetry import constants as c

WET_FROM = 3  # weather 3+ is light rain, heavy rain or storm


def _sector_ms(lap, n: int) -> int:
    return int(lap[f"sector{n}_time_minutes_part"]) * 60000 + int(lap[f"sector{n}_time_ms_part"])


def best_valid_lap(history) -> dict | None:
    """The fastest lap the game counted as valid, with its sectors."""
    if history is None:
        return None
    best = None
    for i in range(min(int(history["num_laps"]), 100)):
        lap = history["lap_history_data"][i]
        ms = int(lap["lap_time_in_ms"])
        if ms <= 0 or not int(lap["lap_valid_bit_flags"]) & 0x01:
            continue
        if best is None or ms < best["lap_ms"]:
            best = {"lap_ms": ms, "s1_ms": _sector_ms(lap, 1), "s2_ms": _sector_ms(lap, 2), "s3_ms": _sector_ms(lap, 3), "lap_num": i + 1}
    return best


def _field(rec, *names, default=None):
    for n in names:
        if n in rec.dtype.names:
            return int(rec[n])
    return default


def assists(live) -> tuple[str, dict]:
    """The assists category: no TC, no ABS, manual gears and no braking assist is "sin_ayudas"."""
    session = live.last.get("session")
    status = live.last.get("car_status")
    info: dict = {}
    if session is not None:
        s = session.body
        info["caja"] = _field(s, "gearbox_assist")
        info["frenado"] = _field(s, "braking_assist")
        info["direccion"] = _field(s, "steering_assist")
        info["linea"] = _field(s, "dynamic_racing_line")
    if status is not None and status.player_car_index < len(status.body["car_status_data"]):
        me = status.body["car_status_data"][status.player_car_index]
        info["tc"] = _field(me, "traction_control")
        info["abs"] = _field(me, "anti_lock_brakes")
    pure = info.get("tc") == 0 and info.get("abs") == 0 and info.get("caja") in (1, 2) and info.get("frenado") == 0
    return ("sin_ayudas" if pure else "con_ayudas"), info


def candidate(live) -> dict | None:
    """This session's record attempt, or None while there is no valid lap or no track yet."""
    session = live.last.get("session")
    lap = best_valid_lap(live.player_history)
    if session is None or lap is None or live.track_id is None:
        return None
    category, info = assists(live)
    team = None
    parts = live.last.get("participants")
    if parts is not None and parts.player_car_index < len(parts.body["participants"]):
        team_id = int(parts.body["participants"][parts.player_car_index]["team_id"])
        team = c.TEAMS.get(team_id)
    return {
        **lap,
        "track_id": int(live.track_id),
        "packet_format": int(live.packet_format),
        "category": category,
        "weather": "mojado" if int(session.body["weather"]) >= WET_FROM else "seco",
        "session_type": int(session.body["session_type"]),
        "team": team,
        "assists": info,
    }


async def save(db: AsyncSession, tenant_id: int, live, game_session_id: int | None) -> LapRecord | None:
    """Keep the attempt if it beats this player's record for the same track and conditions."""
    cand = candidate(live)
    if cand is None or getattr(live, "_record_saved_ms", None) == cand["lap_ms"]:
        return None
    live._record_saved_ms = cand["lap_ms"]
    return await store(db, tenant_id, cand, game_session_id)


async def store(db: AsyncSession, tenant_id: int, cand: dict, game_session_id: int | None) -> LapRecord | None:
    key = dict(tenant_id=tenant_id, track_id=cand["track_id"], packet_format=cand["packet_format"],
               category=cand["category"], weather=cand["weather"])
    row = await db.scalar(select(LapRecord).filter_by(**key))
    if row is not None and row.lap_ms <= cand["lap_ms"]:
        return None
    if row is None:
        row = LapRecord(**key)
        db.add(row)
    row.lap_ms, row.s1_ms, row.s2_ms, row.s3_ms = cand["lap_ms"], cand["s1_ms"], cand["s2_ms"], cand["s3_ms"]
    row.session_type, row.team, row.assists = cand["session_type"], cand["team"], cand["assists"]
    row.game_session_id = game_session_id
    return row
