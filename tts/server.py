"""The race engineer's voice: Spanish text in, MP3 out.

MeloTTS (Spanish) speaks the line and OpenVoice v2 gives it the timbre of the
engineer's voice, a voice designed from a text description with Qwen3-TTS (no
real person's voice). Both are MIT-licensed. The radio effect and the chime are
added by the client, so the same audio serves the dashboard, OBS and the bridge.

One line at a time: the server is small and shared, and radio calls are few.
"""

import io
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

import lameenc
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from normalize import normalize

MODELS = Path(os.environ.get("TTS_MODELS", "/models"))
VOICE = Path(__file__).parent / "voices" / os.environ.get("TTS_VOICE", "ingeniero.pth")
THREADS = int(os.environ.get("TTS_THREADS", "2"))
SPEED = float(os.environ.get("TTS_SPEED", "1.08"))  # Melo's Spanish is slow for radio
MAX_CHARS = 400

logger = logging.getLogger("tts")
app = FastAPI(title="Ingeniero · voz")
_lock = threading.Lock()
_engine: dict = {}


def load() -> dict:
    """Load the models once; reused by every request."""
    if _engine:
        return _engine
    from melo.api import TTS
    from openvoice.api import ToneColorConverter

    torch.set_num_threads(THREADS)
    started = time.monotonic()
    tts = TTS(language="ES", device="cpu", config_path=str(MODELS / "melo/config.json"),
              ckpt_path=str(MODELS / "melo/checkpoint.pth"))
    conv = ToneColorConverter(str(MODELS / "openvoice/converter/config.json"), device="cpu")
    conv.watermark_model = None
    conv.load_ckpt(str(MODELS / "openvoice/converter/checkpoint.pth"))
    _engine.update(
        tts=tts, conv=conv, speaker=tts.hps.data.spk2id["ES"],
        src_se=torch.load(MODELS / "openvoice/base_speakers/ses/es.pth", map_location="cpu"),
        tgt_se=torch.load(VOICE, map_location="cpu"),
    )
    logger.info("voice loaded in %.1fs", time.monotonic() - started)
    return _engine


def synthesize(text: str) -> bytes:
    e = load()
    with _lock, tempfile.TemporaryDirectory() as tmp:
        base, out = f"{tmp}/base.wav", f"{tmp}/out.wav"
        e["tts"].tts_to_file(normalize(text), e["speaker"], base, speed=SPEED, quiet=True)
        e["conv"].convert(base, e["src_se"], e["tgt_se"], out, tau=0.3)
        audio, rate = sf.read(out, dtype="int16")
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(5)
    return bytes(enc.encode(np.ascontiguousarray(audio).tobytes()) + enc.flush())


class Line(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)


@app.on_event("startup")
def warm() -> None:
    load()


@app.get("/health")
def health() -> dict:
    return {"ok": bool(_engine)}


@app.post("/synthesize")
def speak(line: Line) -> Response:
    started = time.monotonic()
    try:
        mp3 = synthesize(line.text)
    except Exception as e:  # a line the frontend chokes on must not take the service down
        logger.exception("synthesis failed")
        raise HTTPException(500, f"synthesis failed: {e}") from e
    return Response(mp3, media_type="audio/mpeg",
                    headers={"X-Synthesis-Ms": str(int((time.monotonic() - started) * 1000))})


if __name__ == "__main__":  # used at image build time: downloads what the models fetch lazily
    out = io.BytesIO(synthesize("Box, box esta vuelta. Perdés dos décimas en la cinco."))
    print("warm-up ok", len(out.getvalue()), "bytes")
