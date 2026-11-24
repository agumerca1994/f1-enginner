"""The engineer's memory of a race weekend: what the driver said, what changed, what was agreed.

The telemetry cannot feel the car; the driver can. A real engineer keeps the
driver's words ("se va de cola", "flota en la 1") and crosses them with the data
in the box, keeps the setup history against what was agreed (so a change applied
to the wrong bar is caught), the race plan, and what was already said so it is
not repeated. This lives on the platform, per weekend (one track, a few days),
and goes into every call summarised.
"""

import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EngineerMemory

# Sessions at the same track within this many days belong to the same weekend.
WEEKEND_DAYS = 4
MAX_REPORTS = 30
MAX_SETUP_HISTORY = 30
MAX_SAID = 12
# The same topic is not repeated within this many laps unless the data got worse.
REPEAT_LAPS = 2
REPORT_STATES = ("abierto", "mejoró", "resuelto")
SESSION_ES = {
    1: "Práctica 1", 2: "Práctica 2", 3: "Práctica 3", 4: "Práctica corta", 5: "Clasificación 1",
    6: "Clasificación 2", 7: "Clasificación 3", 8: "Clasificación corta", 9: "Clasificación a una vuelta",
    10: "Clasificación sprint 1", 11: "Clasificación sprint 2", 12: "Clasificación sprint 3",
    13: "Clasificación sprint corta", 14: "Clasificación sprint a una vuelta", 15: "Carrera", 16: "Carrera 2",
    17: "Carrera 3", 18: "Contrarreloj",
}


def session_label(session_type: int) -> str:
    return SESSION_ES.get(session_type, "Sesión")


def _empty() -> dict[str, Any]:
    return {
        "sesiones": [],
        "reportes_piloto": [],
        "historial_reglaje": [],
        "reglaje_acordado": [],
        "plan_carrera": None,
        "ultimo_dicho": [],
        "preferencias": {"silencio": False},
    }


class WeekendMemory:
    def __init__(self, data: dict | None = None, row_id: int | None = None, track_id: int | None = None):
        self.data = {**_empty(), **(data or {})}
        self.row_id = row_id
        self.track_id = track_id
        self.dirty = False
        self.session_label: str | None = None  # "Práctica 1", set when the session opens

    # --- the driver -------------------------------------------------------------------

    def add_report(self, text: str, zone: str | None, lap: int | None) -> dict:
        report = {"n": len(self.data["reportes_piloto"]) + 1, "sesion": self.session_label, "vuelta": lap,
                  "texto": text.strip(), "zona": zone, "estado": "abierto"}
        self.data["reportes_piloto"] = (self.data["reportes_piloto"] + [report])[-MAX_REPORTS:]
        self.dirty = True
        return report

    def set_report_state(self, n: int, state: str) -> dict | None:
        if state not in REPORT_STATES:
            return None
        for r in self.data["reportes_piloto"]:
            if r["n"] == n:
                r["estado"] = state
                self.dirty = True
                return r
        return None

    def set_silence(self, on: bool) -> None:
        if self.data["preferencias"].get("silencio") != on:
            self.data["preferencias"]["silencio"] = on
            self.dirty = True

    @property
    def silenced(self) -> bool:
        return bool(self.data["preferencias"].get("silencio"))

    # --- setup ------------------------------------------------------------------------

    def note_setup(self, before: dict | None, after: dict, lap: int | None) -> dict | None:
        """A setup read from the game that differs from the last one: keep the change, and
        flag it when it does not match what was agreed with the engineer."""
        if before is None:
            return None
        changes = {k: [before.get(k), v] for k, v in after.items()
                   if k != "presiones_psi" and before.get(k) != v}
        if not changes:
            return None
        agreed = {a["parametro"]: a for a in self.data["reglaje_acordado"] if a.get("estado") == "pendiente"}
        applied, wrong = [], []
        for param, a in agreed.items():
            if param in changes and changes[param][1] == a["valor"]:
                a["estado"] = "aplicado"
                applied.append(param)
        for param in changes:
            if agreed and param not in agreed:
                wrong.append(param)
        entry = {"sesion": self.session_label, "vuelta": lap, "cambios": changes,
                 "acordado_aplicado": applied or None,
                 "no_acordado": wrong or None, "resultado": "pendiente"}
        self.data["historial_reglaje"] = (self.data["historial_reglaje"] + [entry])[-MAX_SETUP_HISTORY:]
        self.dirty = True
        return entry

    def agree_setup(self, param: str, value: Any, reason: str) -> dict:
        """A change the driver accepted: what the next setup read is checked against."""
        self.data["reglaje_acordado"] = [a for a in self.data["reglaje_acordado"] if a["parametro"] != param]
        item = {"parametro": param, "valor": value, "motivo": reason, "sesion": self.session_label,
                "estado": "pendiente"}
        self.data["reglaje_acordado"].append(item)
        self.dirty = True
        return item

    def set_setup_result(self, index: int, result: str) -> None:
        hist = self.data["historial_reglaje"]
        if -len(hist) <= index < len(hist):
            hist[index]["resultado"] = result
            self.dirty = True

    # --- race plan and what was said --------------------------------------------------

    def set_plan(self, plan: dict) -> None:
        if plan and plan != self.data.get("plan_carrera"):
            self.data["plan_carrera"] = plan
            self.dirty = True

    def said(self, topic: str | None, text: str, lap: int | None) -> None:
        self.data["ultimo_dicho"] = (self.data["ultimo_dicho"] + [
            {"vuelta": lap, "tema": topic, "texto": text, "t": round(time.time())}])[-MAX_SAID:]
        self.dirty = True

    def said_recently(self, topic: str | None, lap: int | None) -> bool:
        """The same topic in this session within REPEAT_LAPS laps."""
        if not topic or lap is None:
            return False
        for s in reversed(self.data["ultimo_dicho"]):
            if s.get("tema") == topic and s.get("vuelta") is not None and lap - s["vuelta"] < REPEAT_LAPS:
                return True
        return False

    def open_session(self, session_id: int | None, label: str) -> None:
        self.session_label = label
        if not any(s.get("id") == session_id for s in self.data["sesiones"]):
            self.data["sesiones"].append({"id": session_id, "tipo": label})
            self.data["ultimo_dicho"] = []  # a new session: "already said" starts over
            self.data["preferencias"]["silencio"] = False
            self.dirty = True

    # --- for the model ----------------------------------------------------------------

    def summary(self, radio_name: str | None = None) -> dict[str, Any]:
        d = self.data
        return {
            "nombre_radio": radio_name,
            "sesiones_del_fin_de_semana": [s["tipo"] for s in d["sesiones"]],
            "reportes_piloto": [r for r in d["reportes_piloto"] if r["estado"] != "resuelto"][-10:],
            "reportes_resueltos": len([r for r in d["reportes_piloto"] if r["estado"] == "resuelto"]),
            "historial_reglaje": d["historial_reglaje"][-6:],
            "reglaje_acordado_pendiente": [a for a in d["reglaje_acordado"] if a.get("estado") == "pendiente"],
            "plan_carrera": d["plan_carrera"],
            "ultimo_dicho": d["ultimo_dicho"][-6:],
            "piloto_pidio_silencio": self.silenced,
        }


async def load(db: AsyncSession, tenant_id: int, track_id: int) -> WeekendMemory:
    """This weekend's memory at the track, or a fresh one if the last visit was days ago."""
    since = datetime.now(timezone.utc) - timedelta(days=WEEKEND_DAYS)
    row = await db.scalar(
        select(EngineerMemory)
        .where(EngineerMemory.tenant_id == tenant_id, EngineerMemory.track_id == track_id,
               EngineerMemory.updated_at >= since)
        .order_by(EngineerMemory.updated_at.desc()).limit(1))
    if row is None:
        return WeekendMemory(track_id=track_id)
    return WeekendMemory(row.data, row.id, track_id)


async def save(db: AsyncSession, tenant_id: int, memory: WeekendMemory) -> None:
    if not memory.dirty or memory.track_id is None:
        return
    row = await db.get(EngineerMemory, memory.row_id) if memory.row_id else None
    if row is None:
        row = EngineerMemory(tenant_id=tenant_id, track_id=memory.track_id, data=memory.data)
        db.add(row)
        await db.flush()
        memory.row_id = row.id
    else:
        row.data = dict(memory.data)  # a new object, so the JSONB change is noticed
        row.updated_at = datetime.now(timezone.utc)
    memory.dirty = False
