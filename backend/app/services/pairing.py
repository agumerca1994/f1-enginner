"""Device-code pairing between a bridge and a player's account.

1. The bridge calls `start`: it gets a secret device code and a short user code.
2. The player, signed in on the web app, enters the user code: `confirm`.
3. The bridge, polling with its device code, receives its token once: `poll`.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import utcnow
from app.core.config import settings
from app.core.security import (
    DEVICE_CODE_PREFIX,
    DEVICE_TOKEN_PREFIX,
    hash_token,
    new_token,
    new_user_code,
    normalize_user_code,
)
from app.models import Device, PairingRequest, User


@dataclass
class Started:
    device_code: str
    user_code: str
    expires_in: int


@dataclass
class PollResult:
    status: str  # "pending" | "complete" | "expired"
    token: str | None = None
    device_id: int | None = None


class PairingError(Exception):
    pass


async def start(db: AsyncSession, *, name: str, os: str | None, arch: str | None, version: str | None) -> Started:
    now = utcnow()
    for _ in range(10):
        code = new_user_code()
        taken = await db.scalar(
            select(PairingRequest.id).where(
                PairingRequest.user_code == code,
                PairingRequest.expires_at > now,
                PairingRequest.completed_at.is_(None),
            )
        )
        if taken is None:
            break
    else:
        raise PairingError("could not allocate a pairing code")

    device_code = new_token(DEVICE_CODE_PREFIX)
    db.add(PairingRequest(
        device_code_hash=hash_token(device_code),
        user_code=code,
        name=name[:120],
        os=os,
        arch=arch,
        bridge_version=version,
        expires_at=now + timedelta(seconds=settings.PAIRING_TTL_SECONDS),
    ))
    await db.commit()
    return Started(device_code, code, settings.PAIRING_TTL_SECONDS)


async def confirm(db: AsyncSession, *, user: User, user_code: str) -> PairingRequest:
    req = await db.scalar(
        select(PairingRequest).where(
            PairingRequest.user_code == normalize_user_code(user_code),
            PairingRequest.expires_at > utcnow(),
            PairingRequest.confirmed_by_user_id.is_(None),
            PairingRequest.completed_at.is_(None),
        )
    )
    if req is None:
        raise PairingError("The code does not exist or has expired. Run `bridge pair` again.")
    req.confirmed_by_user_id = user.id
    await db.commit()
    return req


async def poll(db: AsyncSession, *, device_code: str) -> PollResult:
    req = await db.scalar(
        select(PairingRequest)
        .where(PairingRequest.device_code_hash == hash_token(device_code))
        .with_for_update()
    )
    if req is None or req.completed_at is not None or req.expires_at <= utcnow():
        return PollResult("expired")
    if req.confirmed_by_user_id is None:
        return PollResult("pending")

    user = await db.get(User, req.confirmed_by_user_id)
    token = new_token(DEVICE_TOKEN_PREFIX)
    device = Device(
        tenant_id=user.tenant_id,
        user_id=user.id,
        name=req.name,
        os=req.os,
        arch=req.arch,
        bridge_version=req.bridge_version,
        token_hash=hash_token(token),
        token_prefix=token[:12],
    )
    db.add(device)
    await db.flush()
    req.device_id = device.id
    req.completed_at = utcnow()
    await db.commit()
    return PollResult("complete", token=token, device_id=device.id)
