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


def _frames_until(ws, predicate, limit=2000):
    for _ in range(limit):
        msg = ws.receive_json()
        if predicate(msg):
            return msg
    raise AssertionError("expected message never arrived")


@needs_baku
def test_live_engineer_speaks_when_active(client):
    import itertools
    import time

    from app.ingest.protocol import encode_batch
    from app.telemetry import capture
    from tests.test_ingest import pair_bridge

    email = "engineer-live@example.test"
    token = pair_bridge(client, email)
    headers = {"X-Dev-User": email}
    assert client.get("/api/engineer/live", headers=headers).json() == {"active": False, "provider": "reglas", "messages": []}
    assert client.post("/api/engineer/live", json={"active": True}, headers=headers).json()["active"] is True

    _, records = capture.read(BAKU_RACE)
    t0 = time.time_ns()
    with client.websocket_connect("/ingest/v1", headers={"Authorization": f"Bearer {token}"}) as ws:
        ws.receive_json()
        for _, group in itertools.groupby(records, key=lambda r: r.offset_ns // 100_000_000):
            ws.send_bytes(encode_batch([(t0 + r.offset_ns, r.data) for r in group]))
        ws.send_text(json.dumps({"type": "bye"}))
        assert ws.receive_json() == {"type": "goodbye"}

    state = client.get("/api/engineer/live", headers=headers).json()
    first = state["messages"][0]
    assert first["triggers"] == ["session_start"] and first["provider"] == "reglas"
    assert first["radio"].startswith("Largamos P16")
    assert first["estrategia"]["proximo_compuesto"] is not None  # the two-compound stop is planned


@needs_baku
def test_replay_engineer_only_speaks_during_playback(client):
    from tests.test_replay import _ingest_baku

    email = "engineer-replay@example.test"
    session_id = _ingest_baku(client, email)
    with client.websocket_connect("/replay/v1") as ws:
        ws.send_json({"type": "auth", "dev_user": email, "session_id": session_id})
        _frames_until(ws, lambda m: m["type"] == "engineer_state")
        ws.send_json({"type": "seek", "t": 30})  # jumping ahead says nothing
        ws.send_json({"type": "engineer", "active": True})
        assert _frames_until(ws, lambda m: m["type"] == "engineer_state")["active"] is True
        ws.send_json({"type": "speed", "value": 16})
        ws.send_json({"type": "play"})
        message = _frames_until(ws, lambda m: m["type"] == "engineer_message")["message"]
        assert message["provider"] == "reglas" and "session_start" not in message["triggers"]


def test_rules_pick_a_different_compound_and_do_not_repeat():
    from app.engineer.engine import EngineerRequest
    from app.engineer.history import Trigger
    from app.engineer.providers import rules_response

    facts = {
        "sesion": {"tipo": "Race", "vueltas_restantes": 12, "ventana_box_juego": [8, 17], "vuelta_actual": 7,
                   "safety_car": "None"},
        "piloto": {"posicion": 2, "ers": {"bateria_pct": 5.0}, "advertencias": 0, "penalizacion_s": 0},
        "neumaticos": {"compuesto": "Medium", "edad_vueltas": 6, "desgaste_pct": {"del_der": 12.0}},
        "combustible": {"vueltas_de_sobra": 2.0},
        "ritmo": {},
        "estrategia_calculos": {
            "perdida_box_s": 22.0, "si_para_ahora": {"posicion_estimada_al_salir": 17},
            "regla_dos_compuestos": {"compuestos_secos_usados": ["Medium"], "cumplida": False, "aplica": True},
            "juegos_de_neumaticos": [
                {"compuesto": "Medium", "desgaste_pct": 0, "puesto": False, "cantidad": 1, "vida_util_vueltas": 20, "delta_ritmo_s": -0.6},
                {"compuesto": "Soft", "desgaste_pct": 0, "puesto": False, "cantidad": 3, "vida_util_vueltas": 11, "delta_ritmo_s": -1.2},
                {"compuesto": "Hard", "desgaste_pct": 0, "puesto": False, "cantidad": 1, "vida_util_vueltas": 39, "delta_ritmo_s": 0.2},
            ],
        },
    }
    lap = [Trigger("lap_completed", 500.0, 6)]
    request = EngineerRequest(lap, 500.0, 6, ["vuelta"], "Ninguno todavía.", json.dumps(facts))
    first = rules_response(request)
    # A second medium would not satisfy the rule; softs last 11 < 12 laps, so hards.
    assert first["estrategia"]["proximo_compuesto"] == "Hard"
    assert first["radio"].startswith("Batería al 5%")
    repeat = EngineerRequest(lap, 600.0, 7, ["vuelta"], json.dumps([{"radio": first["radio"]}]), json.dumps(facts))
    assert rules_response(repeat)["radio"] is None
