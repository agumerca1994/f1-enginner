"""Who is calling: signed-in players (Firebase) and paired bridges (device tokens)."""

import logging
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import DEVICE_TOKEN_PREFIX, hash_token
from app.models import Device, Tenant, User

logger = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)
_firebase_ready = False


def _verify_firebase(token: str) -> dict:
    global _firebase_ready
    import firebase_admin
    from firebase_admin import auth, credentials

    if not _firebase_ready:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH))
        _firebase_ready = True
    return auth.verify_id_token(token)


async def get_or_create_user(db: AsyncSession, *, email: str, firebase_uid: str | None, name: str | None) -> User:
    """Find the player by Firebase UID or email, creating their tenant on first sign-in."""
    email = email.strip().lower()
    user = None
    if firebase_uid:
        user = await db.scalar(select(User).where(User.firebase_uid == firebase_uid))
    if user is None:
        user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        tenant = Tenant(name=name or email)
        db.add(tenant)
        await db.flush()
        user = User(tenant_id=tenant.id, email=email, firebase_uid=firebase_uid, display_name=name)
        db.add(user)
        await db.commit()
        logger.info("new player signed up", extra={"user_id": user.id, "tenant_id": tenant.id})
    elif firebase_uid and user.firebase_uid is None:
        user.firebase_uid = firebase_uid
        await db.commit()
    return user


async def authenticate_token(db: AsyncSession, *, token: str | None, dev_email: str | None = None) -> User | None:
    """The player behind a Firebase ID token (or a dev email in AUTH_DEV_MODE), or None."""
    if settings.AUTH_DEV_MODE and dev_email:
        return await get_or_create_user(db, email=dev_email, firebase_uid=None, name=None)
    if not token:
        return None
    try:
        claims = _verify_firebase(token)
    except Exception:
        return None
    if not claims.get("email"):
        return None
    return await get_or_create_user(db, email=claims["email"], firebase_uid=claims["uid"], name=claims.get("name"))


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    x_dev_user: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await authenticate_token(db, token=creds.credentials if creds else None, dev_email=x_dev_user)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing, invalid or expired credentials")
    return user


async def device_from_token(db: AsyncSession, token: str | None) -> Device | None:
    """Resolve a bridge's bearer token to an active device, or None."""
    if not token or not token.startswith(DEVICE_TOKEN_PREFIX):
        return None
    device = await db.scalar(select(Device).where(Device.token_hash == hash_token(token)))
    if device is None or device.revoked_at is not None:
        return None
    return device


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def get_current_device(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> Device:
    """The bridge calling with its own device token."""
    device = await device_from_token(db, creds.credentials if creds else None)
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked device token")
    return device
