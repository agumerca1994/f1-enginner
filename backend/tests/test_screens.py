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
