"""Read-only overlay links: the player creates, lists (with the links) and revokes them from Settings.

The link itself (`/overlay/<panel>?t=rbo_...`) is opened by OBS or the bridge's
floating panels, which then authenticate the live WebSocket with it.
"""

import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, utcnow
from app.core.database import get_db
from app.core.config import settings
from app.core.security import OVERLAY_TOKEN_PREFIX, hash_token, overlay_token
from app.models import OverlayToken, User

router = APIRouter(prefix="/api/overlay", tags=["overlay"])

MAX_ACTIVE_TOKENS = 20


class OverlayTokenIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class OverlayTokenOut(BaseModel):
    id: int
    name: str
    token_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    token: str | None  # None for links created before they could be shown again


def _secret() -> str:
    return settings.OVERLAY_LINK_SECRET or settings.INTERNAL_LOG_KEY


def _out(row: OverlayToken) -> OverlayTokenOut:
    return OverlayTokenOut(
        id=row.id, name=row.name, token_prefix=row.token_prefix, created_at=row.created_at,
        last_used_at=row.last_used_at, token=overlay_token(_secret(), row.nonce) if row.nonce else None,
    )


@router.get("/tokens", response_model=list[OverlayTokenOut])
async def list_tokens(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(OverlayToken)
        .where(OverlayToken.tenant_id == user.tenant_id, OverlayToken.revoked_at.is_(None))
        .order_by(OverlayToken.created_at.desc())
    )
    return [_out(r) for r in rows]


@router.post("/tokens", response_model=OverlayTokenOut, status_code=201)
async def create_token(body: OverlayTokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    active = await db.scalars(
        select(OverlayToken.id).where(OverlayToken.tenant_id == user.tenant_id, OverlayToken.revoked_at.is_(None))
    )
    if len(active.all()) >= MAX_ACTIVE_TOKENS:
        raise HTTPException(409, "Too many overlay links; revoke one first")
    nonce = secrets.token_hex(16)
    raw = overlay_token(_secret(), nonce)
    row = OverlayToken(
        tenant_id=user.tenant_id, user_id=user.id, name=body.name.strip(), nonce=nonce,
        token_hash=hash_token(raw), token_prefix=raw[: len(OVERLAY_TOKEN_PREFIX) + 4],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.delete("/tokens/{token_id:int}", status_code=204)
async def revoke_token(token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(OverlayToken, token_id)
    if row is None or row.tenant_id != user.tenant_id:
        raise HTTPException(404, "Overlay link not found")
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        await db.commit()
