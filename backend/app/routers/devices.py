from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, utcnow
from app.core.config import settings
from app.core.database import get_db
from app.core.security import format_user_code
from app.models import Device, User
from app.services import pairing

router = APIRouter(prefix="/api/devices", tags=["devices"])


class PairStartIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    os: str | None = Field(default=None, max_length=40)
    arch: str | None = Field(default=None, max_length=40)
    bridge_version: str | None = Field(default=None, max_length=40)


class PairStartOut(BaseModel):
    device_code: str
    user_code: str
    verification_url: str
    verification_url_complete: str
    expires_in: int
    interval: int


class PairPollIn(BaseModel):
    device_code: str = Field(max_length=100)


class PairPollOut(BaseModel):
    status: str
    token: str | None = None
    device_id: int | None = None


class PairConfirmIn(BaseModel):
    user_code: str = Field(max_length=20)


class DeviceOut(BaseModel):
    id: int
    name: str
    os: str | None
    arch: str | None
    bridge_version: str | None
    token_prefix: str
    created_at: datetime
    last_seen_at: datetime | None
    last_reception: float | None
    revoked_at: datetime | None


@router.post("/pair/start", response_model=PairStartOut)
async def pair_start(body: PairStartIn, db: AsyncSession = Depends(get_db)):
    """Called by the bridge. No authentication: the device code proves nothing until a player confirms it."""
    try:
        started = await pairing.start(db, name=body.name, os=body.os, arch=body.arch, version=body.bridge_version)
    except pairing.PairingError as e:
        raise HTTPException(503, str(e))
    shown = format_user_code(started.user_code)
    return PairStartOut(
        device_code=started.device_code,
        user_code=shown,
        verification_url=settings.pairing_url,
        verification_url_complete=f"{settings.pairing_url}?code={shown}",
        expires_in=started.expires_in,
        interval=settings.PAIRING_POLL_INTERVAL_SECONDS,
    )


@router.post("/pair/poll", response_model=PairPollOut)
async def pair_poll(body: PairPollIn, db: AsyncSession = Depends(get_db)):
    result = await pairing.poll(db, device_code=body.device_code)
    return PairPollOut(status=result.status, token=result.token, device_id=result.device_id)


@router.post("/pair/confirm")
async def pair_confirm(
    body: PairConfirmIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        req = await pairing.confirm(db, user=user, user_code=body.user_code)
    except pairing.PairingError as e:
        raise HTTPException(404, str(e))
    return {"name": req.name, "os": req.os}


@router.get("", response_model=list[DeviceOut])
async def list_devices(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(
        select(Device).where(Device.tenant_id == user.tenant_id).order_by(Device.created_at.desc())
    )
    return [DeviceOut.model_validate(d, from_attributes=True) for d in rows]


@router.delete("/{device_id}", status_code=204)
async def revoke_device(device_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    device = await db.get(Device, device_id)
    if device is None or device.tenant_id != user.tenant_id:
        raise HTTPException(404, "Device not found")
    if device.revoked_at is None:
        device.revoked_at = utcnow()
        await db.commit()
