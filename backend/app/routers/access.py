"""Early access: a signed-in player redeems an invite code, or asks for one.

Players sign in with Google as always; until they redeem a code every other endpoint answers
403 `access_pending` (see core/auth.py). Codes are generated and requests listed with the
internal key, so they can be sent by mail in this first stage.
"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_signed_in_user, has_access
from app.core.database import get_db
from app.core.security import hash_token
from app.models import AccessRequest, InviteCode, User
from app.routers.internal import require_internal_key

router = APIRouter(tags=["access"])
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, read over the phone or a mail


def _normalise(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def new_code() -> str:
    body = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"ING-{body[:4]}-{body[4:]}"


def _request_out(r: AccessRequest | None) -> dict | None:
    if r is None:
        return None
    return {"tipo": r.kind, "juego": r.game, "plataforma": r.platform, "local": r.venue_name, "ciudad": r.city,
            "butacas": r.rigs, "nota": r.note, "fecha": r.created_at.isoformat() if r.created_at else None}


@router.get("/api/access")
async def access_status(user: User = Depends(get_signed_in_user), db: AsyncSession = Depends(get_db)) -> dict:
    req = await db.scalar(select(AccessRequest).where(AccessRequest.user_id == user.id))
    return {"habilitado": has_access(user), "solicitud": _request_out(req)}


class Redeem(BaseModel):
    code: str = Field(min_length=4, max_length=40)


@router.post("/api/access/redeem")
async def redeem(body: Redeem, user: User = Depends(get_signed_in_user), db: AsyncSession = Depends(get_db)) -> dict:
    if user.access_granted_at is not None:
        return {"habilitado": True}
    raw = _normalise(body.code)
    code = await db.scalar(select(InviteCode).where(InviteCode.code_hash == hash_token(raw)))
    if code is None or code.revoked_at is not None or code.uses >= code.max_uses:
        raise HTTPException(400, "El código no es válido o ya se usó.")
    # Count the use atomically so two players cannot share a single-use code.
    done = await db.execute(
        update(InviteCode).where(InviteCode.id == code.id, InviteCode.uses < InviteCode.max_uses).values(uses=InviteCode.uses + 1)
    )
    if done.rowcount != 1:
        raise HTTPException(400, "El código no es válido o ya se usó.")
    user.access_granted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"habilitado": True}


class RequestIn(BaseModel):
    tipo: str = Field(pattern="^(jugador|local)$")
    juego: str | None = Field(default=None, max_length=60)
    plataforma: str | None = Field(default=None, max_length=30)
    local: str | None = Field(default=None, max_length=120)
    ciudad: str | None = Field(default=None, max_length=80)
    butacas: int | None = Field(default=None, ge=1, le=500)
    nota: str | None = Field(default=None, max_length=1000)


@router.post("/api/access/request")
async def request_access(body: RequestIn, user: User = Depends(get_signed_in_user), db: AsyncSession = Depends(get_db)) -> dict:
    req = await db.scalar(select(AccessRequest).where(AccessRequest.user_id == user.id))
    if req is None:
        req = AccessRequest(user_id=user.id, kind=body.tipo)
        db.add(req)
    req.kind, req.game, req.platform = body.tipo, body.juego, body.plataforma
    req.venue_name, req.city, req.rigs, req.note = body.local, body.ciudad, body.butacas, body.nota
    await db.commit()
    await db.refresh(req)
    return {"habilitado": has_access(user), "solicitud": _request_out(req)}


# --- internal: hand out codes, see who asked ----------------------------------------

class CodesIn(BaseModel):
    cantidad: int = Field(default=1, ge=1, le=200)
    usos: int = Field(default=1, ge=1, le=1000)
    etiqueta: str | None = Field(default=None, max_length=120)


@router.post("/internal/access/codes", dependencies=[Depends(require_internal_key)])
async def create_codes(body: CodesIn, db: AsyncSession = Depends(get_db)) -> dict:
    """New codes, shown once: only their hash is kept."""
    codes = [new_code() for _ in range(body.cantidad)]
    for c in codes:
        db.add(InviteCode(code_hash=hash_token(_normalise(c)), label=body.etiqueta, max_uses=body.usos))
    await db.commit()
    return {"codigos": codes, "usos_por_codigo": body.usos, "etiqueta": body.etiqueta}


@router.get("/internal/access/requests", dependencies=[Depends(require_internal_key)])
async def list_requests(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(AccessRequest, User).join(User, User.id == AccessRequest.user_id).order_by(AccessRequest.created_at.desc()))).all()
    return {"solicitudes": [{"email": u.email, "nombre": u.display_name, "habilitado": u.access_granted_at is not None, **_request_out(r)} for r, u in rows]}


class GrantIn(BaseModel):
    email: str = Field(max_length=255)


@router.post("/internal/access/grant", dependencies=[Depends(require_internal_key)])
async def grant(body: GrantIn, db: AsyncSession = Depends(get_db)) -> dict:
    user = await db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user is None:
        raise HTTPException(404, "No hay una cuenta con ese mail: tiene que entrar una vez con Google.")
    if user.access_granted_at is None:
        user.access_granted_at = datetime.now(timezone.utc)
        await db.commit()
    return {"email": user.email, "habilitado": True}
