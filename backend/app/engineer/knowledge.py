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

    samples = pit_loss_samples(history.car_laps)
    return {
        "compuestos": compounds,
        "consumo_kg_por_vuelta": _fuel_per_lap(clean),
        "perdida_box_s": round(statistics.median(samples), 1) if samples else None,
        "vueltas_limpias": len(clean),
    }


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
    """Upsert the summary for this track when the session has enough clean laps.

    A session only overwrites the stored one when it is at least as rich (clean
    laps), so a long practice run is not clobbered by a three-lap qualifying out-lap.
    """
    summary = summarize(history)
    if summary is None:
        return False
    row = await db.scalar(
        select(TrackKnowledge).where(TrackKnowledge.tenant_id == tenant_id, TrackKnowledge.track_id == track_id)
    )
    clean = summary["vueltas_limpias"]
    if row is None:
        db.add(TrackKnowledge(tenant_id=tenant_id, track_id=track_id, clean_laps=clean, summary=summary))
    elif clean >= row.clean_laps:
        row.summary, row.clean_laps = summary, clean
    else:
        return False
    return True
