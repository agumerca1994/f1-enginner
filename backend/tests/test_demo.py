"""The engineer demo in Plans: a frozen race, read-only tools, caps and scripted answers."""

from app.engineer import demo


def test_tools_read_the_frozen_race_and_never_write():
    names = {t["name"] for t in demo.TOOLS}
    assert "estado_breve" in names and "guardar_reporte" not in names and "acordar_reglaje" not in names
    assert demo.run_tool("estado_breve", {})["posicion"] == 8
    assert demo.run_tool("analisis_curva", {"numero": 1})["curva"] == 1
    assert "error" in demo.run_tool("analisis_curva", {"numero": 99})
    assert demo.run_tool("comparar_vueltas", {"a": 3, "b": 2})["vuelta_b"] == 3
    assert "calculos" in demo.run_tool("estrategia", {"vuelta_parada": 5})


def test_scripted_answers_follow_the_question():
    assert demo.scripted_answer("¿Cuándo paro?").startswith("No paramos")
    assert "Gasly" in demo.scripted_answer("¿Cómo viene el de atrás?")
    assert "Verstappen" in demo.scripted_answer("¿Qué hago para pasar a Verstappen?")
    assert "Intermedios" in demo.scripted_answer("cómo están las gomas")
    assert demo.scripted_answer("hola") == demo.SCRIPTED_DEFAULT


def test_caps_per_player_and_per_day():
    limits = demo.DemoLimits()
    for _ in range(demo.PER_PLAYER_PER_DAY):
        limits.take(1)
    assert limits.left(1) == 0 and limits.left(2) == demo.PER_PLAYER_PER_DAY
    limits.total = demo.PER_DAY_TOTAL
    assert limits.left(2) == 0


def test_without_a_key_the_demo_answers_from_the_script(client):
    me = {"X-Dev-User": "demo@example.test"}
    state = client.get("/api/engineer/demo", headers=me).json()
    assert state["pista"] and state["restantes"] == demo.PER_PLAYER_PER_DAY
    r = client.post("/api/engineer/demo", headers=me, json={"texto": "¿Cuándo paro?"}).json()
    assert r["fuente"] == "guion" and r["radio"].startswith("No paramos") and r["pregunta"] == "¿Cuándo paro?"
    assert client.post("/api/engineer/demo", headers=me, json={"texto": ""}).status_code == 422
