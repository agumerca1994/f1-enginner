# The engineer's voice (MeloTTS Spanish + OpenVoice v2), CPU only.
FROM python:3.12-slim

ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1 HF_HOME=/models/hf
RUN apt-get update && apt-get install -y --no-install-recommends git libsndfile1 libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
# Pinned to the commits tested; --no-deps keeps MeloTTS from pulling the full Japanese dictionary.
RUN pip install --no-deps \
      "git+https://github.com/myshell-ai/MeloTTS@209145371cff8fc3bd60d7be902ea69cbdb7965a" \
      "git+https://github.com/myshell-ai/OpenVoice@74a1d147b17a8c3092dd5430504bd83ef6c7eb23"

COPY prepare.py .
RUN python prepare.py
COPY normalize.py server.py ./
COPY voices voices
# Warm-up at build time: fetches the Spanish BERT and the NLTK data the models load lazily.
RUN python server.py

# Everything is in the image now: never reach Hugging Face at runtime.
ENV HF_HUB_OFFLINE=1
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
