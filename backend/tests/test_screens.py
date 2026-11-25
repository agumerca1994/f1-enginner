"""Pantallas vinculadas con un código, cockpits guardados en la cuenta y el informe escrito por código."""

import glob
import itertools

_emails = (f"screen{i}@example.test" for i in itertools.count())


def test_a_screen_links_with_a_code_and_gets_its_role(client):
    email, other = next(_emails), next(_emails)
    start = client.post("/api/screens/pair/start").json()
    assert len(start["code"]) == 6 and client.get(f"/api/screens/pair/{start['pairing_id']}").json() == {"status": "pending"}

    bad = client.post("/api/screens/pair/confirm", json={"code": start["code"], "role": "nada", "name": "Tele"},
                      headers={"X-Dev-User": email})
    assert bad.status_code == 422
    code = start["code"][:3] + "·" + start["code"][3:].lower()  # typed as shown on the TV
    ok = client.post("/api/screens/pair/confirm", json={"code": code, "role": "tabla", "name": "Tele del rincón"},
                     headers={"X-Dev-User": email})
    assert ok.status_code == 200 and ok.json()["role"] == "tabla"

    linked = client.get(f"/api/screens/pair/{start['pairing_id']}").json()
    assert linked["status"] == "linked" and linked["token"].startswith("rbo_")
    assert client.get(f"/api/screens/pair/{start['pairing_id']}").json() == {"status": "expired"}  # handed over once

    me = client.get("/api/screens/me", headers={"X-Screen-Token": linked["token"]}).json()
    assert me["name"] == "Tele del rincón" and me["role"] == "tabla" and me["cockpit"] is None
    assert [s["name"] for s in client.get("/api/screens", headers={"X-Dev-User": email}).json()] == ["Tele del rincón"]
    assert client.get("/api/screens", headers={"X-Dev-User": other}).json() == []
    assert client.get("/api/overlay/tokens", headers={"X-Dev-User": email}).json() == []  # not an OBS link

    # The same code cannot be used twice.
    again = client.post("/api/screens/pair/confirm", json={"code": start["code"], "role": "mapa", "name": "x"},
                        headers={"X-Dev-User": other})
    assert again.status_code == 404


def test_cockpits_are_shared_by_the_players_screens(client):
    email = next(_emails)
    layout = {"id": "volante", "name": "Arriba del volante", "cols": 8, "rows": 4,
              "pieces": [{"id": "a", "kind": "delta", "x": 0, "y": 0, "w": 3, "h": 2}]}
    assert client.put("/api/screens/cockpits", json={"cockpits": [layout]}, headers={"X-Dev-User": email}).status_code == 200
    assert client.get("/api/screens/cockpits", headers={"X-Dev-User": email}).json()["cockpits"] == [layout]

    start = client.post("/api/screens/pair/start").json()
    screen = client.post("/api/screens/pair/confirm", headers={"X-Dev-User": email},
                         json={"code": start["code"], "role": "cockpit", "name": "Tablet", "config": {"cockpit": "volante"}}).json()
    token = client.get(f"/api/screens/pair/{start['pairing_id']}").json()["token"]
    assert client.get("/api/screens/me", headers={"X-Screen-Token": token}).json()["cockpit"]["name"] == "Arriba del volante"

    moved = client.patch(f"/api/screens/{screen['id']}", json={"role": "mapa"}, headers={"X-Dev-User": email})
    assert moved.json()["role"] == "mapa"


def test_the_written_report_says_where_time_went():
    from app.engineer import debrief
    from app.engineer.review import review

    r = review(sorted(glob.glob("../fixtures/captures/texas*.zst")))
    report = debrief.run_report(r)
    assert report["mejor_vuelta"] == 2 and report["compuesto"] == "Intermediate"
    assert report["perdidas"] and all(p["perdida_s"] > 0 and p["texto"] for p in report["perdidas"])
    s = debrief.summary(r, "Race")
    assert s["resultado"] == 8 and s["mejor_vuelta_s"] == 116.883
    assert "1:56,883" in s["texto"] and "None" not in s["texto"]


def test_the_players_tyre_sets_stay_in_the_snapshot():
    """The game cycles TyreSets through every car: the player's sets must not blink out between their packets."""
    from app.live import snapshot
    from app.replay.player import ReplayPlayer, ReplaySource

    seen = {"with": 0, "without": 0, "first": False}

    def observe(packet, live):
        if packet.name != "car_telemetry":
            return
        has = "tyre_sets" in snapshot.build(live)
        seen["first"] = seen["first"] or has
        if seen["first"]:
            seen["with" if has else "without"] += 1

    player = ReplayPlayer(ReplaySource(sorted(glob.glob("../fixtures/captures/texas*.zst"))), on_packet=observe)
    player.seek(600)
    assert seen["with"] > 0 and seen["without"] == 0


def test_a_flying_lap_from_the_pit_exit_is_not_a_pit_lap_in_telemetry():
    """Practice and qualifying: the pit exit can sit after the line. Telemetry, runs and setup advice
    must agree with the radio: only a stop or the pit lane in the second half makes a pit lap."""
    import numpy as np

    from app.engineer.review import SessionReview
    from app.engineer.setup_advice import runs
    from app.engineer.traces import LapTrace, TraceCollector
    from app.live.laps import pit_mask, pit_sample

    status = np.array([0, 1, 1, 2, 1])
    dist = np.array([100.0, 300.0, 4000.0, 300.0, 300.0])
    for race in (False, True):
        mask = pit_mask(status, dist, 5000.0, race)
        assert list(mask) == [pit_sample({"pit_status": s, "lap_distance": d}, 5000.0, race) for s, d in zip(status, dist)]
    assert list(pit_mask(status, dist, 5000.0, False)) == [False, False, True, True, False]

    def lap(n, pitted=False, pit_lane=False):
        z = np.zeros(4)
        return LapTrace(car=0, lap=n, time_ms=90000, valid=True, pitted=pitted, pit_lane=pit_lane,
                        speed=z, throttle=z, brake=z, gear=z, times=np.zeros((0, 2)))

    tr = TraceCollector()
    tr.player = 0
    # 1-2 a run, 2 the in-lap; 3 starts at the pit exit but is a flying lap; 4 another flying lap.
    tr.player_laps = {1: lap(1), 2: lap(2, pitted=True, pit_lane=True), 3: lap(3, pit_lane=True), 4: lap(4)}
    r = SessionReview(facts={}, laps=[], stints=[], classification=None, duration_s=0, traces=tr)
    out = runs(r, {})
    assert [x.laps for x in out] == [[1, 2], [3, 4]]
    assert out[1].clean_laps == [3, 4]  # the lap from the pit exit counts


def test_the_licensed_car_model_is_only_served_to_signed_in_players(client):
    key = {"x-internal-key": "test-internal-key"}
    glb = b"glTF" + b"\x00" * 64
    assert client.put("/internal/assets/car.glb", content=b"not a model", headers=key).status_code == 422
    assert client.put("/internal/assets/car.glb", content=glb).status_code == 422  # no key
    assert client.put("/internal/assets/../x.glb", content=glb, headers=key).status_code in (404, 422)
    assert client.put("/internal/assets/car.glb", content=glb, headers=key).status_code == 204
    assert client.get("/api/assets/car.glb").status_code == 401
    r = client.get("/api/assets/car.glb", headers={"X-Dev-User": "model@example.test"})
    assert r.status_code == 200 and r.content == glb and "private" in r.headers["cache-control"]
