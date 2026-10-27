"""La voz del ingeniero: cada radio pide su audio al servicio de voz y se sirve por su hash."""

import asyncio

import httpx

from app.engineer.voice import VoiceCache, line_id


def _fake_tts(calls):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.read())
        return httpx.Response(200, content=b"ID3-fake-mp3")
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_lines_are_synthesized_once_and_served_by_hash(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "TTS_URL", "http://tts.test")
    calls = []
    cache = VoiceCache()
    cache._client = _fake_tts(calls)

    key = cache.request("Box, box esta vuelta.")
    assert key == line_id("Box, box esta vuelta.")
    assert cache.request("Box, box esta vuelta.") == key  # the same line again: no second call
    assert await cache.get(key) == b"ID3-fake-mp3"
    assert len(calls) == 1 and b"Box, box" in calls[0]
    assert await cache.get("0" * 32) is None  # never produced here


async def test_without_a_voice_service_nothing_is_made(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "TTS_URL", "")
    assert VoiceCache().request("Hola") is None


async def test_radio_messages_carry_their_audio(monkeypatch):
    from app.core.config import settings
    from app.engineer import voice
    from app.engineer.runner import EngineerRunner
    from app.engineer.providers import RulesProvider

    monkeypatch.setattr(settings, "TTS_URL", "http://tts.test")
    cache = VoiceCache()
    cache._client = _fake_tts([])
    monkeypatch.setattr("app.engineer.runner.voice_cache", cache)
    runner = EngineerRunner(tenant_id=1, mode="replay", provider=RulesProvider())
    runner._deliver({"id": 1, "radio": "Safety car, safety car.", "prioridad": "urgente"})
    runner._deliver({"id": 2, "radio": None, "prioridad": "info"})
    first, second = runner.messages
    assert first["audio"] == f"/api/engineer/radio/{voice.line_id('Safety car, safety car.')}.mp3"
    assert "audio" not in second
    await asyncio.sleep(0)


def test_audio_endpoint_only_serves_known_lines(client):
    assert client.get("/api/engineer/radio/notahash.mp3").status_code == 404
    assert client.get(f"/api/engineer/radio/{'a' * 32}.mp3").status_code == 404
