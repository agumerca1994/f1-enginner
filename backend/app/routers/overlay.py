"""Read-only overlay links: the player creates, lists and revokes them from Settings.

The link itself (`/overlay/<panel>?t=rbo_...`) is opened by OBS or the bridge's
floating panels, which then authenticate the live WebSocket with it.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, utcnow
from app.core.database import get_db
from app.core.security import OVERLAY_TOKEN_PREFIX, hash_token, new_token
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


class OverlayTokenCreated(OverlayTokenOut):
    token: str  # shown once


@router.get("/tokens", response_model=list[OverlayTokenOut])
async def list_tokens(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(OverlayToken)
        .where(OverlayToken.tenant_id == user.tenant_id, OverlayToken.revoked_at.is_(None))
        .order_by(OverlayToken.created_at.desc())
    )
    return [OverlayTokenOut.model_validate(r, from_attributes=True) for r in rows]


@router.post("/tokens", response_model=OverlayTokenCreated, status_code=201)
async def create_token(body: OverlayTokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    active = await db.scalars(
        select(OverlayToken.id).where(OverlayToken.tenant_id == user.tenant_id, OverlayToken.revoked_at.is_(None))
    )
    if len(active.all()) >= MAX_ACTIVE_TOKENS:
        raise HTTPException(409, "Too many overlay links; revoke one first")
    raw = new_token(OVERLAY_TOKEN_PREFIX)
    row = OverlayToken(
        tenant_id=user.tenant_id, user_id=user.id, name=body.name.strip(),
        token_hash=hash_token(raw), token_prefix=raw[: len(OVERLAY_TOKEN_PREFIX) + 4],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return OverlayTokenCreated(**OverlayTokenOut.model_validate(row, from_attributes=True).model_dump(), token=raw)


@router.delete("/tokens/{token_id:int}", status_code=204)
async def revoke_token(token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(OverlayToken, token_id)
    if row is None or row.tenant_id != user.tenant_id:
        raise HTTPException(404, "Overlay link not found")
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        await db.commit()
