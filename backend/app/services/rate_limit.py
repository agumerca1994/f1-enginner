"""A small in-process rate limiter for the public OAuth endpoints (from registrapp).

`/oauth/register` is unauthenticated by definition (that's what dynamic client
registration means), so it needs a brake or anyone can fill the table. Same for
`/oauth/token` and the consent endpoint.

In-process is enough here: the container runs a single uvicorn worker. If that
ever changes, each worker gets its own counters and the effective limit becomes
N times what's configured — worth moving to Postgres at that point.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_hits: dict[str, deque[float]] = defaultdict(deque)


def _prune(bucket: deque[float], window: float, now: float) -> None:
    while bucket and now - bucket[0] > window:
        bucket.popleft()


def check(key: str, limit: int, window_seconds: float) -> bool:
    """Record a hit; False when `key` is over its allowance."""
    now = time.monotonic()
    bucket = _hits[key]
    _prune(bucket, window_seconds, now)
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True


def client_ip(request: Request) -> str:
    """Caller IP, honouring the proxy header Traefik sets in production."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def enforce(request: Request, scope: str, limit: int, window_seconds: float) -> None:
    """Raise 429 when the caller has burned through its allowance."""
    if not check(f"{scope}:{client_ip(request)}", limit, window_seconds):
        raise HTTPException(status_code=429, detail="Demasiadas solicitudes, probá más tarde")

