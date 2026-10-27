"""The engineer's voice: radio lines turned into audio by the TTS service.

The voice runs in its own container (`tts/`, MeloTTS + OpenVoice), reached at
TTS_URL; without it the dashboard falls back to the browser's speech. Audio is
generated as soon as a line exists, while it waits for the next straight, and
kept in memory keyed by the text's hash, so a line the engineer repeats costs
nothing. The audio is public by hash: only lines this server produced are served.
"""

import asyncio
import hashlib
import logging
from collections import OrderedDict

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

MAX_LINES = 300  # ~40 KB each
TIMEOUT_S = 30.0


def line_id(text: str) -> str:
    return hashlib.sha256(f"v1:{text}".encode()).hexdigest()[:32]


class VoiceCache:
    def __init__(self) -> None:
        self._audio: OrderedDict[str, asyncio.Future] = OrderedDict()
        self._client: httpx.AsyncClient | None = None

    @property
    def enabled(self) -> bool:
        return bool(settings.TTS_URL)

    def request(self, text: str) -> str | None:
        """Start (or reuse) the audio for a line; returns its id, or None without a voice service."""
        if not self.enabled or not text.strip():
            return None
        key = line_id(text)
        if key in self._audio:
            self._audio.move_to_end(key)
            return key
        future = asyncio.get_running_loop().create_future()
        self._audio[key] = future
        while len(self._audio) > MAX_LINES:
            self._audio.popitem(last=False)
        asyncio.create_task(self._synthesize(text, future))
        return key

    async def _synthesize(self, text: str, future: asyncio.Future) -> None:
        try:
            self._client = self._client or httpx.AsyncClient(timeout=TIMEOUT_S)
            r = await self._client.post(f"{settings.TTS_URL.rstrip('/')}/synthesize", json={"text": text})
            r.raise_for_status()
            future.set_result(r.content)
        except Exception as e:  # the radio still shows as text and the browser can speak it
            logger.warning("voice synthesis failed", extra={"error": str(e)})
            future.set_result(None)

    async def get(self, key: str) -> bytes | None:
        """The audio for a line this server asked for, waiting for it if still being made."""
        future = self._audio.get(key)
        if future is None:
            return None
        try:
            return await asyncio.wait_for(asyncio.shield(future), TIMEOUT_S)
        except asyncio.TimeoutError:
            return None


voice_cache = VoiceCache()
