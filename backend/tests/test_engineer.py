import json

from app.engineer.engine import RaceEngineer, system_prompt
from app.live.state import LiveSession
from app.replay.player import ReplaySource
from app.telemetry import registry
from tests.test_parser import BAKU_RACE, needs_baku


@needs_baku
def test_engineer_requests_over_a_real_race():
    engineer = RaceEngineer()
    live = None
    clock = {"t": 0.0}
    requests = []
    for t, data in ReplaySource([str(BAKU_RACE)]).records():
        clock["t"] = t
        packet = registry.parse(data)
        if live is None:
            live = LiveSession(0, 0, packet.session_uid, 2024, build_layout=False, clock=lambda: clock["t"])
        live.update(packet)
        if (request := engineer.observe(packet, live)) is not None:
            requests.append(request)

    kinds = [tr.kind for r in requests for tr in r.triggers]
    assert kinds[0] == "session_start"
    facts = json.loads(requests[-1].user.split("## Datos de la sesión\n", 1)[1])
    assert facts["sesion"]["pista"] == "Baku (Azerbaijan)"
    assert facts["piloto"]["piloto"] == "GASLY"
    assert facts["estrategia_calculos"]["regla_dos_compuestos"] == {
        "compuestos_secos_usados": ["Medium"], "cumplida": False, "aplica": True,
    }
    # Events name the drivers, and the player is "VOS".
    assert all("_idx" not in key for e in facts["eventos_recientes"] for key in e)
    assert "Formato de respuesta" in system_prompt()


def test_pit_loss_from_green_flag_stops():
    from app.engineer.history import CarLap, pit_loss_samples

    def lap(n, t, stops, sc=False):
        return CarLap(lap=n, time_ms=t, position=5, gap_ahead_ms=0, gap_leader_ms=0, pit_stops=stops,
                      compound=None, tyre_age=None, safety_car=sc)

    normal = 100_000
    green = [lap(1, 110_000, 0), lap(2, normal, 0), lap(3, normal, 0), lap(4, normal + 12_000, 1),
             lap(5, normal + 9_000, 1), lap(6, normal, 1), lap(7, normal, 1)]
    under_sc = [lap(1, 110_000, 0), lap(2, normal, 0), lap(3, normal, 0), lap(4, 130_000, 1, sc=True),
                lap(5, 125_000, 1, sc=True), lap(6, normal, 1)]
    assert pit_loss_samples({0: green, 1: under_sc}) == [21.0]
