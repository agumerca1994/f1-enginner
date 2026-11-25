"""Screens around the player: a TV, a tablet or another computer linked with a code.

The new screen opens `/pantalla` without signing in and asks for a code
(`POST /pair/start`), which it shows as a QR. The player's phone, signed in, opens
the QR's link and confirms it with a role (`POST /pair/confirm`). That creates a
read-only overlay token (`rbo_`) carrying the role; the screen picks it up by
polling and from then on watches the live socket with it, like an OBS overlay.
Pending codes live in memory for a few minutes: nothing is stored until confirmed.

Cockpit layouts (the grids of pieces) belong to the player and are shared by all
their screens: `GET/PUT /api/screens/cockpits`.
"""

import secrets
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, overlay_from_token
from app.core.database import get_db
from app.core.security import OVERLAY_TOKEN_PREFIX, hash_token, overlay_token
from app.models import OverlayToken, User
from app.routers.overlay import MAX_ACTIVE_TOKENS, _secret

router = APIRouter(prefix="/api/screens", tags=["screens"])

ROLES = ("tabla", "cockpit", "muro", "mapa", "radio", "panel")
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I to misread on a TV
CODE_TTL_S = 300
MAX_PENDING = 500
MAX_COCKPITS = 20


@dataclass
class _Pairing:
    code: str
    created: float = field(default_factory=time.monotonic)
    token: str | None = None
    role: str | None = None
    name: str | None = None

    def expired(self) -> bool:
        return time.monotonic() - self.created > CODE_TTL_S


_pending: dict[str, _Pairing] = {}  # pairing id (secret, the screen's) -> pairing


def _sweep() -> None:
    for pid in [pid for pid, p in _pending.items() if p.expired()]:
        del _pending[pid]


class PairStartOut(BaseModel):
    pairing_id: str
    code: str
    expires_in_s: int


@router.post("/pair/start", response_model=PairStartOut)
async def pair_start():
    """A new screen asks for a code to show. No account involved yet."""
    _sweep()
    if len(_pending) >= MAX_PENDING:
        raise HTTPException(503, "Too many screens pairing right now; try again in a minute")
    codes = {p.code for p in _pending.values()}
    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
    while code in codes:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
    pid = secrets.token_urlsafe(24)
    _pending[pid] = _Pairing(code=code)
    return PairStartOut(pairing_id=pid, code=code, expires_in_s=CODE_TTL_S)


@router.get("/pair/{pairing_id}")
async def pair_poll(pairing_id: str):
    """The screen waits here until a phone confirms its code. The token is handed over once."""
    p = _pending.get(pairing_id)
    if p is None or (p.expired() and p.token is None):
        _pending.pop(pairing_id, None)
        return {"status": "expired"}
    if p.token is None:
        return {"status": "pending"}
    del _pending[pairing_id]
    return {"status": "linked", "token": p.token, "role": p.role, "name": p.name}


class PairConfirmIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    role: str
    name: str = Field(min_length=1, max_length=100)
    config: dict | None = None


@router.post("/pair/confirm")
async def pair_confirm(body: PairConfirmIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The signed-in phone links the screen showing `code` and says what it shows."""
    if body.role not in ROLES:
        raise HTTPException(422, f"role must be one of {', '.join(ROLES)}")
    code = "".join(ch for ch in body.code.upper() if ch.isalnum())
    pairing = next((p for p in _pending.values() if p.code == code and not p.expired() and p.token is None), None)
    if pairing is None:
        raise HTTPException(404, "That code is not on any screen now; it may have expired")
    active = await db.scalars(select(OverlayToken.id).where(OverlayToken.tenant_id == user.tenant_id, OverlayToken.revoked_at.is_(None)))
    if len(active.all()) >= MAX_ACTIVE_TOKENS:
        raise HTTPException(409, "Too many linked screens and panels; remove one first")
    nonce = secrets.token_hex(16)
    raw = overlay_token(_secret(), nonce)
    row = OverlayToken(
        tenant_id=user.tenant_id, user_id=user.id, name=body.name.strip(), nonce=nonce, token_hash=hash_token(raw),
        token_prefix=raw[: len(OVERLAY_TOKEN_PREFIX) + 4], role=body.role, config=body.config or {},
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    pairing.token, pairing.role, pairing.name = raw, body.role, row.name
    return _screen_out(row)


def _screen_out(row: OverlayToken) -> dict:
    return {"id": row.id, "name": row.name, "role": row.role, "config": row.config or {},
            "created_at": row.created_at, "last_used_at": row.last_used_at}


@router.get("")
async def list_screens(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The player's linked screens (overlay links without a role are listed by /api/overlay)."""
    rows = await db.scalars(
        select(OverlayToken).where(OverlayToken.tenant_id == user.tenant_id, OverlayToken.revoked_at.is_(None),
                                   OverlayToken.role.is_not(None)).order_by(OverlayToken.created_at)
    )
    return [_screen_out(r) for r in rows]


class ScreenPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    role: str | None = None
    config: dict | None = None


@router.patch("/{screen_id:int}")
async def update_screen(screen_id: int, body: ScreenPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(OverlayToken, screen_id)
    if row is None or row.tenant_id != user.tenant_id or row.revoked_at is not None or row.role is None:
        raise HTTPException(404, "Screen not found")
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, f"role must be one of {', '.join(ROLES)}")
        row.role = body.role
    if body.name is not None:
        row.name = body.name.strip()
    if body.config is not None:
        row.config = body.config
    await db.commit()
    return _screen_out(row)


@router.get("/me")
async def this_screen(x_screen_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """What a linked screen shows, asked with its own token; the cockpit layout comes resolved."""
    row = await overlay_from_token(db, x_screen_token)
    if row is None:
        raise HTTPException(401, "This screen is not linked")
    owner = await db.get(User, row.user_id)
    cockpits = (owner.cockpits if owner else None) or []
    wanted = (row.config or {}).get("cockpit")
    cockpit = next((k for k in cockpits if k.get("id") == wanted), cockpits[0] if cockpits else None)
    return {**_screen_out(row), "cockpit": cockpit}


@router.get("/tracks/{track_id}/layout")
async def screen_track_layout(track_id: int, x_screen_token: str | None = Header(default=None), db: AsyncSession = Depends(get_db)):
    """The track outline for a linked screen (the map and the corner numbers)."""
    from app.routers.live import layout_for

    row = await overlay_from_token(db, x_screen_token)
    if row is None:
        raise HTTPException(401, "This screen is not linked")
    return await layout_for(row.tenant_id, track_id, db)


class CockpitsIn(BaseModel):
    cockpits: list[dict] = Field(max_length=MAX_COCKPITS)


@router.get("/cockpits")
async def get_cockpits(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    db_user = await db.get(User, user.id)
    return {"cockpits": db_user.cockpits or []}


@router.put("/cockpits")
async def put_cockpits(body: CockpitsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Replace the player's cockpit layouts. Each is {id, name, cols, rows, pieces: [{id, kind, x, y, w, h}]}."""
    for k in body.cockpits:
        if not isinstance(k.get("id"), str) or not isinstance(k.get("pieces"), list) or len(k["pieces"]) > 40:
            raise HTTPException(422, "Each cockpit needs an id and at most 40 pieces")
    db_user = await db.get(User, user.id)
    db_user.cockpits = body.cockpits
    await db.commit()
    return {"cockpits": db_user.cockpits}
