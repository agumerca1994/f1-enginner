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


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    x_dev_user: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if settings.AUTH_DEV_MODE and x_dev_user:
        return await get_or_create_user(db, email=x_dev_user, firebase_uid=None, name=None)
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing credentials")
    try:
        claims = _verify_firebase(creds.credentials)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired Firebase token")
    if not claims.get("email"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "The account has no email")
    return await get_or_create_user(
        db, email=claims["email"], firebase_uid=claims["uid"], name=claims.get("name")
    )


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
