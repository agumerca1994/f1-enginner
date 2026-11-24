"""Talking to the engineer and its weekend memory."""

import asyncio
from types import SimpleNamespace

from app.engineer import memory, talk
from app.engineer.memory import WeekendMemory
from app.engineer.providers import AnthropicProvider, RulesProvider
from app.engineer.runner import EngineerRunner
from app.replay.player import ReplayPlayer, ReplaySource
from tests.test_box import TEXAS
from tests.test_parser import _needs as needs

needs_texas = needs(TEXAS)


def _texas_runner(provider=None):
    runner = EngineerRunner(1, "live", provider=provider or RulesProvider())
    player = ReplayPlayer(ReplaySource([str(TEXAS)]), on_packet=runner.observe)
    player.seek(float("inf"))
    return runner, player.live


def test_quick_commands_need_no_model():
    runner = EngineerRunner(1, "live", provider=RulesProvider())
    assert talk.quick_answer(runner, "Anotalo para boxes: flota en la curva 1") == "Anotado."
    assert runner.memory.data["reportes_piloto"][0]["texto"] == "flota en la curva 1"
    assert talk.quick_answer(runner, "No me hables ahora") == "Anotado, silencio."
    assert runner.memory.silenced
    assert talk.quick_answer(runner, "Hablame") == "Dale, te vuelvo a hablar."
    assert not runner.memory.silenced
    assert talk.quick_answer(runner, "¿Cómo me fue en la 3?") is None


def test_setup_changes_are_checked_against_what_was_agreed():
    m = WeekendMemory(track_id=3)
    m.agree_setup("barra_antivuelco_tras", 8, "cola suelta")
    before = {"barra_antivuelco_del": 10, "barra_antivuelco_tras": 6, "presiones_psi": {}}
    entry = m.note_setup(before, {**before, "barra_antivuelco_del": 8}, lap=4)
    assert entry["no_acordado"] == ["barra_antivuelco_del"] and not entry["acordado_aplicado"]
    entry = m.note_setup({**before, "barra_antivuelco_del": 8}, {**before, "barra_antivuelco_tras": 8}, lap=6)
    assert entry["acordado_aplicado"] == ["barra_antivuelco_tras"]
    assert m.summary()["reglaje_acordado_pendiente"] == []


def test_a_topic_is_not_repeated_within_two_laps():
    m = WeekendMemory()
    m.said("gomas", "La trasera izquierda se gasta más.", 5)
    assert m.said_recently("gomas", 6)
    assert not m.said_recently("gomas", 7)
    assert not m.said_recently("parada", 6)


@needs_texas
def test_tools_answer_from_the_live_session():
    runner, live = _texas_runner()
    status = talk.run_tool(runner, live, "estado_breve", {})
    assert status["posicion"] and status["vuelta"] and status["gomas"]["compuesto"]
    corner = talk.run_tool(runner, live, "analisis_curva", {"numero": 1})
    assert "vueltas" in corner or "error" in corner
    assert "error" in talk.run_tool(runner, live, "analisis_curva", {"numero": 99})
    assert talk.run_tool(runner, live, "comparar_vueltas", {"a": 2, "b": 3})["vuelta_b"] == 3
    saved = talk.run_tool(runner, live, "guardar_reporte", {"texto": "se va de cola", "zona": "curva 1"})
    assert saved["guardado"]["estado"] == "abierto"
    assert "reglaje_leido_del_juego" in talk.run_tool(runner, live, "reglaje", {})


@needs_texas
def test_without_ai_the_answer_is_a_status_and_goes_out_at_once():
    runner, live = _texas_runner()
    runner.memory.set_silence(True)  # a question is answered anyway
    message = asyncio.run(runner.ask("estatus", live))
    assert message["radio"].startswith("P") and message["pregunta"] == "estatus"
    assert runner.messages[-1]["id"] == message["id"]
    assert runner.conversation[-1]["pregunta"] == "estatus"


class _Block(SimpleNamespace):
    pass


class _FakeMessages:
    """First a tool call, then the radio line."""

    def __init__(self):
        self.calls = []

    async def create(self, **params):
        self.calls.append(params)
        usage = SimpleNamespace(input_tokens=100, output_tokens=20, cache_read_input_tokens=0,
                                cache_creation_input_tokens=0)
        if len(self.calls) == 1:
            return SimpleNamespace(stop_reason="tool_use", model="claude-haiku-5-5", usage=usage, content=[
                _Block(type="tool_use", id="t1", name="analisis_curva", input={"numero": 1})])
        return SimpleNamespace(stop_reason="end_turn", model="claude-haiku-5-5", usage=usage, content=[
            _Block(type="text", text="En la 1 perdés una décima en la salida, acelerá antes.")])


@needs_texas
def test_the_talk_loop_runs_tools_then_answers():
    provider = AnthropicProvider("sk-test", talk_model="claude-haiku-5-5")
    fake = _FakeMessages()
    provider.client = SimpleNamespace(messages=fake, beta=SimpleNamespace(messages=fake))
    runner, live = _texas_runner(provider)
    advice = asyncio.run(provider.talk(runner, live, "¿Cómo me fue en la curva 1?"))
    assert advice.response["radio"].startswith("En la 1")
    assert advice.response["herramientas"] == ["analisis_curva"]
    second = fake.calls[1]["messages"]
    assert second[-1]["content"][0]["type"] == "tool_result" and second[-1]["content"][0]["tool_use_id"] == "t1"
    assert "Estado breve" in fake.calls[0]["messages"][0]["content"]


def test_memory_is_kept_per_weekend(database):
    from app.core.database import AsyncSessionLocal
    from app.models import Tenant

    async def go():
        async with AsyncSessionLocal() as db:
            tenant = Tenant(name="memoria")
            db.add(tenant)
            await db.flush()
            m = await memory.load(db, tenant.id, 31)
            m.open_session(1, "Práctica 1")
            m.add_report("se va de cola", None, 4)
            await memory.save(db, tenant.id, m)
            await db.commit()
            again = await memory.load(db, tenant.id, 31)
            assert again.data["reportes_piloto"][0]["texto"] == "se va de cola"
            assert (await memory.load(db, tenant.id, 7)).data["reportes_piloto"] == []

    asyncio.run(go())


def test_ask_endpoint_and_radio_name(client):
    headers = {"X-Dev-User": "piloto@example.com"}
    r = client.put("/api/engineer/settings", json={"nombre_radio": "Flor"}, headers=headers)
    assert r.json() == {"nombre_radio": "Flor"}
    assert client.get("/api/engineer/settings", headers=headers).json()["nombre_radio"] == "Flor"
    r = client.post("/api/engineer/ask", json={"texto": "anotalo: flota en la 1"}, headers=headers)
    assert r.status_code == 200 and r.json()["radio"] == "Anotado."
    mem = client.get("/api/engineer/memory", headers=headers).json()
    assert mem["reportes_piloto"][0]["texto"] == "flota en la 1" and mem["nombre_radio"] == "Flor"
