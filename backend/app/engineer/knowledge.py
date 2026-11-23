"""Track knowledge: what the player learned about a circuit, carried across sessions.

A session's in-memory history is summarised into clean pace and degradation per
compound, fuel use and measured pit loss. It is stored per (tenant, track) and
fed back as `conocimiento_previo` when a race opens, so the first strategy brief
rests on real practice data rather than generic defaults.
"""

import statistics
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engineer import analysis
from app.engineer.history import PlayerLap, SessionHistory, pit_loss_samples
from app.models import TrackKnowledge

# A session needs at least this many clean laps to teach anything worth keeping.
MIN_CLEAN_LAPS = 4
DRY = ("Soft", "Medium", "Hard")


def summarize(history: SessionHistory) -> dict[str, Any] | None:
    """Condense a session's history into per-compound pace and degradation, or None."""
    laps = analysis._dedupe(history.player_laps)
    clean = analysis._clean(laps)
    if len(clean) < MIN_CLEAN_LAPS:
        return None

    compounds: dict[str, Any] = {}
    for compound in DRY:
        group = [pl for pl in clean if pl.compound == compound]
        if len(group) < 2:
            continue
        times = [pl.time_ms / 1000 for pl in group]
        entry = {
            "vueltas_limpias": len(group),
            "ritmo_medio_s": round(statistics.mean(times), 3),
            "mejor_s": round(min(times), 3),
        }
        # Degradation: how lap time trends with tyre age, when we have the spread.
        ages = [pl.tyre_age for pl in group if pl.tyre_age is not None]
        if len(ages) >= 3 and len(set(ages)) >= 2:
            slope = statistics.linear_regression([pl.tyre_age for pl in group if pl.tyre_age is not None], times).slope
            entry["degradacion_s_por_vuelta"] = round(slope, 3)
        compounds[compound] = entry

    if not compounds:
        return None

    return {
        "compuestos": compounds,
        "consumo_kg_por_vuelta": _fuel_per_lap(clean),
        **_pit_loss(history),
        "vueltas_limpias": len(clean),
    }


WET = ("Intermediate", "Wet")


def best_setups(history: SessionHistory) -> dict[str, Any]:
    """The setup of the session's best clean lap, apart for dry and wet running."""
    out: dict[str, Any] = {}
    for laps in (analysis._clean(analysis._dedupe(history.player_laps)),):
        for pl in laps:
            if not pl.setup or not pl.time_ms:
                continue
            key = "lluvia" if pl.compound in WET else "seco"
            if key not in out or pl.time_ms / 1000 < out[key]["vuelta_s"]:
                out[key] = {"valores": pl.setup, "vuelta_s": round(pl.time_ms / 1000, 3), "compuesto": pl.compound,
                            "temp_pista": pl.track_temp, "clima": pl.weather}
    return out


def _pit_loss(history: SessionHistory) -> dict[str, Any]:
    """The green-flag pit loss this session measured, with how many stops back it."""
    samples = pit_loss_samples(history.car_laps)
    if not samples:
        return {"perdida_box_s": None, "perdida_box_paradas": 0}
    return {"perdida_box_s": round(statistics.median(samples), 1), "perdida_box_paradas": len(samples)}


def _fuel_per_lap(clean: list[PlayerLap]) -> float | None:
    """Median fuel burned between consecutive clean laps, in kg."""
    drops = []
    for a, b in zip(clean, clean[1:]):
        if a.fuel_kg is not None and b.fuel_kg is not None and b.lap == a.lap + 1:
            burn = a.fuel_kg - b.fuel_kg
            if burn > 0:
                drops.append(burn)
    return round(statistics.median(drops), 2) if drops else None


async def load(db: AsyncSession, tenant_id: int, track_id: int) -> dict[str, Any] | None:
    """The stored summary for this track, shaped for the facts block, or None."""
    row = await db.scalar(
        select(TrackKnowledge).where(TrackKnowledge.tenant_id == tenant_id, TrackKnowledge.track_id == track_id)
    )
    if row is None:
        return None
    return {**row.summary, "actualizado": row.updated_at.isoformat() if row.updated_at else None}


async def save(db: AsyncSession, tenant_id: int, track_id: int, history: SessionHistory) -> bool:
    """Upsert what this session taught about the track.

    Pace and degradation replace the stored ones only when the session is at least
    as rich (clean laps), so a long practice run is not clobbered by a three-lap
    qualifying out-lap. The pit loss is kept apart: any session can measure it
    (other cars' stops count too, even a race the player did not finish), and the
    measurement backed by more stops wins.
    """
    summary = summarize(history)
    pit = _pit_loss(history)
    setups = best_setups(history)
    if summary is None and not pit["perdida_box_paradas"] and not setups:
        return False
    row = await db.scalar(
        select(TrackKnowledge).where(TrackKnowledge.tenant_id == tenant_id, TrackKnowledge.track_id == track_id)
    )
    stored = dict(row.summary) if row is not None else {}
    # The best setup per condition is kept apart: the fastest clean lap ever wins.
    best = dict(stored.get("mejor_reglaje") or {})
    setups_changed = False
    for key, candidate in setups.items():
        if key not in best or candidate["vuelta_s"] < best[key]["vuelta_s"]:
            best[key], setups_changed = candidate, True
    if summary is None and not pit["perdida_box_paradas"] and not setups_changed:
        return False
    changed = setups_changed
    if summary is not None and (row is None or summary["vueltas_limpias"] >= row.clean_laps):
        stored = {**summary, "perdida_box_s": stored.get("perdida_box_s"),
                  "perdida_box_paradas": stored.get("perdida_box_paradas") or 0}
        clean, changed = summary["vueltas_limpias"], True
    else:
        clean = row.clean_laps if row is not None else 0
    if pit["perdida_box_paradas"] >= (stored.get("perdida_box_paradas") or 0) and pit["perdida_box_paradas"]:
        changed = changed or stored.get("perdida_box_s") != pit["perdida_box_s"]
        stored.update(pit)
    elif not changed:
        return False
    if best:
        stored["mejor_reglaje"] = best
    if row is None:
        db.add(TrackKnowledge(tenant_id=tenant_id, track_id=track_id, clean_laps=clean, summary=stored))
    else:
        row.summary, row.clean_laps = stored, clean  # a new dict, so the JSONB change is saved
    return changed
