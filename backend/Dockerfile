# Build stage: wheels are resolved here so the final image carries no build tooling.
# Every dependency ships prebuilt wheels for amd64 and arm64, so no compiler is
# installed; add one here (never in the final stage) if a dependency ever needs it.
FROM python:3.12-slim AS builder

WORKDIR /app
COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


FROM python:3.12-slim

WORKDIR /app
COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-cache-dir --no-index --find-links=/wheels -r requirements.txt && rm -rf /wheels

COPY . .

# Non-root: the API parses untrusted binary input from every bridge.
RUN chmod +x /app/entrypoint.sh \
    && addgroup --system app \
    && adduser --system --ingroup app app \
    && mkdir -p /data/captures \
    && chown -R app:app /app /data

USER app

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
# One worker: the live state is in memory until it moves to Redis (P7).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
